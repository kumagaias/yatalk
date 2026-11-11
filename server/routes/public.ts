import { Router } from "express";
import { cartItemRequestSchema, chatModelOutputSchema, chatRequestSchema } from "../../shared/schemas.js";
import type { AppConfig } from "../config.js";
import type { Db } from "../database.js";
import { DEFAULT_SHOP_ID } from "../database.js";
import { ApiError } from "../errors.js";
import { clearCart, applyCartOperations, ensureVersions, listProducts, menuResponse, readCart } from "../inventory.js";
import { createVisitorSession, attachVisitorIfPresent, requireExactOrigin, requireVisitor } from "../security.js";
import { createRateLimit, ipKey } from "../rate-limit.js";
import { parseBody, requireJson, requireEmptyBody } from "../http.js";
import { logStage } from "../logging.js";
import type { AiProvider } from "../services/ai.js";

export function publicRoutes(db: Db, config: AppConfig, ai: AiProvider): Router {
  const router = Router();
  const visitorOnly = requireVisitor(db, config);
  const originOnly = requireExactOrigin(config);
  const chatPerIp = createRateLimit(30, 60_000, ipKey);
  const chatPerSession = createRateLimit(12, 60_000, (request) => request.visitorSession?.hash ?? ipKey(request));
  const cartPerIp = createRateLimit(60, 60_000, ipKey);
  const shopId = (request: import("express").Request) => request.shop?.id ?? DEFAULT_SHOP_ID;
  const shopName = (request: import("express").Request) => request.shop?.name ?? config.eventName;

  router.get("/config", (request, response) => {
    response.json({ eventName: shopName(request), currency: request.shop?.currency ?? config.currency,
      paypalClientId: config.paypalClientId, paypalEnabled: !!(config.paypalClientId && config.paypalClientSecret) });
  });
  router.get("/menu", async (request, response) => response.json(await menuResponse(db, shopName(request), shopId(request))));
  router.get("/cart", cartPerIp, async (request, response) => {
    const existing = await attachVisitorIfPresent(db, request);
    const session = existing ?? await createVisitorSession(db, response, config, request.shop);
    request.visitorSession = session;
    response.json(await readCart(db, session.hash, shopId(request)));
  });

  router.post("/cart/items", originOnly, visitorOnly, cartPerIp, async (request, _response, next) => {
    try {
      requireJson(request);
      const input = parseBody(cartItemRequestSchema, request);
      await ensureVersions(db, request.visitorSession!.hash, input.cartVersion, input.catalogRevision, shopId(request));
      const cart = await applyCartOperations(db, request.visitorSession!.hash, [input], shopId(request));
      _response.json(cart);
    } catch (error) { next(error); }
  });

  router.delete("/cart", originOnly, visitorOnly, cartPerIp, async (request, response, next) => {
    try {
      requireEmptyBody(request);
      response.json(await clearCart(db, request.visitorSession!.hash, shopId(request)));
    }
    catch (error) { next(error); }
  });

  router.post("/chat", originOnly, visitorOnly, chatPerIp, chatPerSession, async (request, response) => {
    requireJson(request);
    const input = parseBody(chatRequestSchema, request);
    const sessionHash = request.visitorSession!.hash;
    await ensureVersions(db, sessionHash, input.cartVersion, input.catalogRevision, shopId(request));
    const cart = await readCart(db, sessionHash, shopId(request));
    const products = (await listProducts(db, shopId(request))).map(({ id, name, description, available, dietaryNote }) => ({ id, name, description, available, dietaryNote }));
    logStage(request.requestId, "gemini_cart_intent", "start");
    let model;
    try {
      model = chatModelOutputSchema.parse(await ai.interpretCart({ message: input.message, replyLanguage: input.replyLanguage, history: input.history, cart, products }));
      logStage(request.requestId, "gemini_cart_intent", "success");
    } catch (error) {
      logStage(request.requestId, "gemini_cart_intent", "failure", error);
      throw new ApiError(503, "assistant_unavailable", "The assistant is unavailable. Your cart has not changed.");
    }
    let nextCart = cart;
    if (model.operations.length) {
      await ensureVersions(db, sessionHash, input.cartVersion, input.catalogRevision, shopId(request));
      nextCart = await applyCartOperations(db, sessionHash, model.operations, shopId(request));
    }
    response.json({ reply: model.reply, clarification: model.clarification, cart: nextCart });
  });

  return router;
}
