import { Router, type Request } from "express";
import type { AppConfig } from "../config.js";
import type { Db } from "../database.js";
import { ApiError } from "../errors.js";
import { organizerFacts, organizerSummary } from "../analytics.js";
import { patchProduct } from "../inventory.js";
import { requireExactOrigin, organizerRateKey } from "../security.js";
import { createRateLimit } from "../rate-limit.js";
import { parseBody, requireJson, requireEmptyBody, routeParam } from "../http.js";
import { logStage } from "../logging.js";
import { adminOrder, audit, collectOrder, refundOrder } from "../services/orders.js";
import type { AiProvider } from "../services/ai.js";
import type { PayPalProvider } from "../services/paypal.js";
import { organizerQuestionSchema, productPatchSchema, refundRequestSchema } from "../../shared/schemas.js";

export function managementOperations(db: Db, config: AppConfig, paypal: PayPalProvider, ai: AiProvider,
  shopIdOf: (request: Request) => string, actorIdOf: (request: Request) => string | null = () => null): Router {
  const router = Router();
  const originOnly = requireExactOrigin(config);
  const askLimit = createRateLimit(10, 60_000, (request) => request.ownerUserId ?? organizerRateKey(request));
  const mutationLimit = createRateLimit(30, 60_000, (request) => request.ownerUserId ?? organizerRateKey(request));

  router.get("/summary", (request, response) => {
    const shopId = shopIdOf(request);
    response.json({ shop: request.shop ? { slug: request.shop.slug, name: request.shop.name, status: request.shop.status } : undefined,
      ...organizerSummary(db, request.shop?.timeZone ?? config.eventTimeZone, shopId) });
  });

  router.get("/orders/:id", (request, response) => {
    response.json(adminOrder(db, routeParam(request, "id"), shopIdOf(request)));
  });

  router.patch("/products/:id", originOnly, mutationLimit, (request, response) => {
    requireJson(request);
    const patch = parseBody(productPatchSchema, request);
    const id = routeParam(request, "id");
    const shopId = shopIdOf(request);
    const product = patchProduct(db, id, patch, shopId);
    audit(db, "product_updated", id, { fields: Object.keys(patch).sort() }, shopId, actorIdOf(request));
    response.json(product);
  });

  router.post("/orders/:id/collect", originOnly, mutationLimit, (request, response) => {
    requireEmptyBody(request);
    const id = routeParam(request, "id");
    const shopId = shopIdOf(request);
    const result = collectOrder(db, id, shopId);
    audit(db, "order_collected", id, {}, shopId, actorIdOf(request));
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
      audit(db, "refund_requested", id, { restock, resultState: result.body.state }, shopId, actorIdOf(request));
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
    const sourceFacts = organizerFacts(db, request.shop?.timeZone ?? config.eventTimeZone, new Date(), shopId);
    logStage(request.requestId, "gemini_organizer_answer", "start");
    try {
      const answer = await ai.explainFacts(question, sourceFacts);
      if (typeof answer !== "string" || answer.length > 500) throw new Error("Invalid model response");
      logStage(request.requestId, "gemini_organizer_answer", "success");
      response.json({ answer, sourceFacts });
    } catch (error) {
      logStage(request.requestId, "gemini_organizer_answer", "failure", error);
      throw new ApiError(503, "assistant_unavailable", "The assistant is unavailable. The dashboard remains available.");
    }
  });

  return router;
}
