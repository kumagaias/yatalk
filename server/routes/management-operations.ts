import express, { Router, type Request } from "express";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { Db } from "../database.js";
import { ApiError } from "../errors.js";
import { organizerFacts, organizerSummary } from "../analytics.js";
import { currencyDigits } from "../../shared/currency.js";
import { createProducts, patchProduct, receiveProductStock } from "../inventory.js";
import { buildRestockPlan, isInventoryQuestion } from "../restock-plan.js";
import { requireExactOrigin, organizerRateKey } from "../security.js";
import { createRateLimit } from "../rate-limit.js";
import { parseBody, requireJson, requireEmptyBody, routeParam } from "../http.js";
import { logStage } from "../logging.js";
import { adminOrder, audit, collectOrder, refundOrder } from "../services/orders.js";
import { counterPaymentQueue } from "../services/payment-queue.js";
import type { AiProvider } from "../services/ai.js";
import type { AgLlmRequest } from "ag-studio";
import type { PayPalProvider } from "../services/paypal.js";
import { createProductsRequestSchema, menuAssistantRequestSchema, menuAssistantResponseSchema, menuExtractionSchema, organizerQuestionSchema, productPatchSchema, receiveStockSchema, refundRequestSchema } from "../../shared/schemas.js";
import { detectMenuImageMimeType, MAX_MENU_IMAGE_BYTES, MENU_IMAGE_MIME_TYPES, type MenuImageMimeType } from "../menu-image.js";

const menuScansInFlight = new Set<string>();
const studioTurnRequestSchema = z.object({
  input: z.array(z.unknown()).max(240),
  instructions: z.string().max(64_000).nullish().transform((value) => value ?? undefined),
  tools: z.array(z.object({
    name: z.string().min(1).max(128),
    description: z.string().max(4_000),
    parameters: z.unknown(),
    kind: z.enum(["client", "server", "provided"]).optional(),
    provider: z.unknown().optional(),
  }).passthrough()).max(128).nullish().transform((value) => value ?? undefined),
  toolChoice: z.union([
    z.enum(["auto", "none", "required"]),
    z.object({ name: z.string().min(1).max(128) }).strict(),
  ]).nullish().transform((value) => value ?? undefined),
  responseFormat: z.union([
    z.object({ type: z.literal("text") }).passthrough(),
    z.object({ type: z.literal("json"), name: z.string().min(1).max(128), description: z.string().max(1_000).optional(), schema: z.record(z.string(), z.unknown()) }).passthrough(),
  ]),
}).passthrough();

export function managementOperations(db: Db, config: AppConfig, paypal: PayPalProvider, ai: AiProvider,
  shopIdOf: (request: Request) => string, actorIdOf: (request: Request) => string | null = () => null,
  studioEnabled = false): Router {
  const router = Router();
  const originOnly = requireExactOrigin(config);
  const askLimit = createRateLimit(10, 60_000, (request) => request.ownerUserId ?? organizerRateKey(request));
  const mutationLimit = createRateLimit(30, 60_000, (request) => request.ownerUserId ?? organizerRateKey(request));
  const menuScanLimit = createRateLimit(4, 15 * 60_000, (request) => request.ownerUserId ?? organizerRateKey(request));
  const menuAssistantLimit = createRateLimit(12, 60_000, (request) => request.ownerUserId ?? organizerRateKey(request));
  const studioTurnLimit = createRateLimit(24, 60_000, (request) => request.ownerUserId ?? organizerRateKey(request));
  const counterQueueLimit = createRateLimit(60, 60_000, (request) => request.ownerUserId ?? organizerRateKey(request));
  const parseMenuImage = express.raw({
    type: (request) => MENU_IMAGE_MIME_TYPES.includes((request.headers["content-type"] ?? "").split(";", 1)[0]!.trim().toLowerCase() as MenuImageMimeType),
    limit: MAX_MENU_IMAGE_BYTES,
  });

  router.get("/summary", async (request, response) => {
    const shopId = shopIdOf(request);
    response.json({ shop: request.shop ? { slug: request.shop.slug, ownerSlug: request.shop.ownerSlug, name: request.shop.name, currency: request.shop.currency, status: request.shop.status } : undefined,
      ...await organizerSummary(db, request.shop?.timeZone ?? config.eventTimeZone, shopId),
      shopImageEnabled: !!config.shopImageBucket });
  });

  router.get("/studio/data", async (request, response) => {
    if (!studioEnabled || !request.shop || !request.ownerUserId) throw new ApiError(404, "not_found", "The requested resource was not found.");
    const facts = await organizerFacts(db, request.shop.timeZone, new Date(), shopIdOf(request), { includeSalesTrend: true });
    const divisor = currencyDigits(facts.currency) === 0 ? 1 : 100;
    const todayByProduct = new Map(facts.unitsSold.map((item) => [item.id, item.units_sold]));
    const weekByProduct = new Map(facts.unitsSoldLast7Days.map((item) => [item.id, item.units_sold]));
    response.setHeader("Cache-Control", "private, no-store");
    response.json({
      overview: {
        businessDate: facts.date,
        currency: facts.currency,
        grossSales: facts.grossCapturedMinor / divisor,
        netSales: facts.netCapturedMinor / divisor,
        paidOrders: facts.netOrderCount,
        refundedOrders: facts.refundedOrderCount,
        lowStockItems: facts.lowStockCount,
      },
      items: facts.products.map((product) => ({
        itemName: product.name,
        unitPrice: product.priceMinor / divisor,
        stockOnHand: product.stockOnHand,
        reservedUnits: product.reserved,
        availableUnits: product.available,
        unitsSoldToday: todayByProduct.get(product.id) ?? 0,
        unitsSoldLast7Days: weekByProduct.get(product.id) ?? 0,
      })),
    });
  });

  router.post("/studio/turn", originOnly, studioTurnLimit, async (request, response) => {
    if (!studioEnabled || !request.shop || !request.ownerUserId) throw new ApiError(404, "not_found", "The requested resource was not found.");
    requireJson(request);
    const turn = parseBody(studioTurnRequestSchema, request) as AgLlmRequest;
    if (!ai.runStudioTurn) throw new ApiError(503, "assistant_unavailable", "The analytics assistant is not configured. The dashboard remains available.");
    logStage(request.requestId, "gemini_ag_studio_turn", "start");
    try {
      const result = await ai.runStudioTurn(turn);
      logStage(request.requestId, "gemini_ag_studio_turn", "success");
      response.json(result);
    } catch (error) {
      logStage(request.requestId, "gemini_ag_studio_turn", "failure", error);
      throw new ApiError(503, "assistant_unavailable", "The analytics assistant is unavailable. The dashboard remains available.");
    }
  });

  router.get("/orders/:id", async (request, response) => {
    response.json(await adminOrder(db, routeParam(request, "id"), shopIdOf(request)));
  });

  router.get("/counter-orders", counterQueueLimit, async (request, response) => {
    response.setHeader("Cache-Control", "private, no-store");
    response.json({ orders: await counterPaymentQueue(db, paypal, shopIdOf(request)) });
  });

  router.post("/menu/scan", originOnly, menuScanLimit, parseMenuImage, async (request, response) => {
    const mimeType = (request.get("content-type") ?? "").split(";", 1)[0]!.trim().toLowerCase();
    if (!MENU_IMAGE_MIME_TYPES.includes(mimeType as MenuImageMimeType)) {
      throw new ApiError(415, "unsupported_menu_image", "Choose a JPEG, PNG, WebP, HEIC, or HEIF menu photo.");
    }
    if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
      throw new ApiError(400, "invalid_menu_image", "No menu photo was received. Choose a photo and try again.");
    }
    if (request.body.length > MAX_MENU_IMAGE_BYTES) {
      throw new ApiError(413, "menu_image_too_large", "Menu photos must be 4 MB or smaller.");
    }
    if (detectMenuImageMimeType(request.body) !== mimeType) {
      throw new ApiError(415, "invalid_menu_image", "The file content does not match its image type. Choose a menu photo and retry.");
    }

    const actorId = request.ownerUserId ?? `organizer:${organizerRateKey(request)}`;
    if (menuScansInFlight.has(actorId)) {
      throw new ApiError(429, "menu_scan_in_progress", "A menu photo is already being read. Wait for it to finish, then retry.");
    }
    menuScansInFlight.add(actorId);
    logStage(request.requestId, "gemini_menu_extraction", "start");
    try {
      const result = menuExtractionSchema.parse(await ai.extractMenu(request.body, mimeType as MenuImageMimeType, request.shop?.currency ?? config.currency));
      logStage(request.requestId, "gemini_menu_extraction", "success");
      response.json(result);
    } catch (error) {
      logStage(request.requestId, "gemini_menu_extraction", "failure", error);
      throw new ApiError(503, "menu_extraction_unavailable", "The menu photo could not be read. Try another photo or add items manually.");
    } finally {
      menuScansInFlight.delete(actorId);
    }
  });

  router.post("/products/bulk", originOnly, mutationLimit, async (request, response) => {
    requireJson(request);
    const { products: input } = parseBody(createProductsRequestSchema, request);
    const shopId = shopIdOf(request);
    const products = await createProducts(db, input, shopId);
    for (const product of products) await audit(db, "product_created", product.id, {}, shopId, actorIdOf(request));
    response.status(201).json({ products });
  });

  router.patch("/products/:id", originOnly, mutationLimit, async (request, response) => {
    requireJson(request);
    const patch = parseBody(productPatchSchema, request);
    const id = routeParam(request, "id");
    const shopId = shopIdOf(request);
    const product = await patchProduct(db, id, patch, shopId);
    await audit(db, "product_updated", id, { fields: Object.keys(patch).sort() }, shopId, actorIdOf(request));
    response.json(product);
  });

  router.post("/products/:id/receive", originOnly, mutationLimit, async (request, response) => {
    requireJson(request);
    const { quantity, receiptId } = parseBody(receiveStockSchema, request);
    const shopId = shopIdOf(request);
    const receipt = await receiveProductStock(db, routeParam(request, "id"), quantity, receiptId, shopId);
    if (receipt.applied) await audit(db, "product_stock_received", receipt.product.id, { quantity, stockOnHand: receipt.product.stockOnHand }, shopId, actorIdOf(request));
    response.json(receipt);
  });

  router.post("/orders/:id/collect", originOnly, mutationLimit, async (request, response) => {
    requireEmptyBody(request);
    const id = routeParam(request, "id");
    const shopId = shopIdOf(request);
    const result = await collectOrder(db, id, shopId);
    await audit(db, "order_collected", id, {}, shopId, actorIdOf(request));
    response.json(result);
  });

  router.post("/orders/:id/refund", originOnly, mutationLimit, async (request, response) => {
    requireJson(request);
    const { restock } = parseBody(refundRequestSchema, request);
    logStage(request.requestId, "paypal_refund", "start");
    try {
      const id = routeParam(request, "id");
      const shopId = shopIdOf(request);
      const result = await refundOrder(db, paypal, id, restock, shopId, request.requestId);
      await audit(db, "refund_requested", id, { restock, resultState: result.body.state }, shopId, actorIdOf(request));
      logStage(request.requestId, "paypal_refund", result.status < 300 ? "success" : "failure");
      response.status(result.status).json(result.body);
    } catch (error) {
      logStage(request.requestId, "paypal_refund", "failure", error);
      throw error;
    }
  });

  router.post("/ask", originOnly, askLimit, async (request, response) => {
    requireJson(request);
    const { question } = parseBody(organizerQuestionSchema, request);
    const shopId = shopIdOf(request);
    const includeSalesTrend = isInventoryQuestion(question);
    const sourceFacts = await organizerFacts(db, request.shop?.timeZone ?? config.eventTimeZone, new Date(), shopId, { includeSalesTrend });
    const restockCandidates = includeSalesTrend ? buildRestockPlan(sourceFacts.products, sourceFacts.unitsSoldLast7Days) : [];
    logStage(request.requestId, "gemini_organizer_answer", "start");
    try {
      const result = await ai.explainFacts(question, { ...sourceFacts, restockCandidates });
      if (!result || typeof result.answer !== "string" || result.answer.length > 500 || !Array.isArray(result.restockPriorityIds)) {
        throw new Error("Invalid model response");
      }
      const candidateById = new Map(restockCandidates.map((item) => [item.id, item]));
      const seen = new Set<string>();
      const orderedCandidates = [...result.restockPriorityIds, ...restockCandidates.map(({ id }) => id)].flatMap((id) => {
        const item = candidateById.get(id);
        if (!item || seen.has(id) || seen.size >= 5) return [];
        seen.add(id);
        return [item];
      });
      logStage(request.requestId, "gemini_organizer_answer", "success");
      response.json({ answer: result.answer, inventoryPriority: orderedCandidates, sourceFacts });
    } catch (error) {
      logStage(request.requestId, "gemini_organizer_answer", "failure", error);
      throw new ApiError(503, "assistant_unavailable", "The assistant is unavailable. The dashboard remains available.");
    }
  });

  router.post("/menu/assistant", originOnly, menuAssistantLimit, async (request, response) => {
    requireJson(request);
    const input = parseBody(menuAssistantRequestSchema, request);
    const currency = request.shop?.currency ?? config.currency;
    logStage(request.requestId, "gemini_menu_assistant", "start");
    try {
      const result = menuAssistantResponseSchema.parse(await ai.assistMenu({ ...input, currency }));
      logStage(request.requestId, "gemini_menu_assistant", "success");
      response.json(result);
    } catch (error) {
      logStage(request.requestId, "gemini_menu_assistant", "failure", error);
      throw new ApiError(503, "menu_assistant_unavailable", "The menu assistant is unavailable. Your draft is unchanged.");
    }
  });

  return router;
}
