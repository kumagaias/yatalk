import { Router } from "express";
import { createOrderRequestSchema, paymentReturnCaptureSchema } from "../../shared/schemas.js";
import type { AppConfig } from "../config.js";
import type { Db } from "../database.js";
import { ApiError } from "../errors.js";
import { requireExactOrigin, requireVisitor } from "../security.js";
import { parseBody, requireJson, requireEmptyBody, routeParam } from "../http.js";
import { logStage } from "../logging.js";
import { createRateLimit, ipKey } from "../rate-limit.js";
import { DEFAULT_SHOP_ID } from "../database.js";
import { captureOrder, capturePayPalReturn, cancelOwnedOrder, createOrRetryOrder, readOwnedOrder } from "../services/orders.js";
import type { PayPalProvider } from "../services/paypal.js";

export function orderRoutes(db: Db, config: AppConfig, paypal: PayPalProvider): Router {
  const router = Router();
  const visitorOnly = requireVisitor(db, config);
  const originOnly = requireExactOrigin(config);
  const orderPerIp = createRateLimit(30, 60_000, ipKey);
  const orderPerSession = createRateLimit(12, 60_000, (request) => request.visitorSession?.hash ?? ipKey(request));
  const shopId = (request: import("express").Request) => request.shop?.id ?? DEFAULT_SHOP_ID;

  router.post("/orders", originOnly, visitorOnly, orderPerIp, orderPerSession, async (request, response) => {
    requireJson(request);
    const input = parseBody(createOrderRequestSchema, request);
    logStage(request.requestId, "paypal_order_create", "start");
    try {
      const result = await createOrRetryOrder(db, paypal, { ...input, sessionHash: request.visitorSession!.hash, shopId: shopId(request) });
      logStage(request.requestId, "paypal_order_create", result.status < 300 ? "success" : "failure");
      response.status(result.status).json(result.body);
    } catch (error) {
      logStage(request.requestId, "paypal_order_create", "failure", error);
      throw error;
    }
  });

  router.post("/payment-return/capture", originOnly, orderPerIp, async (request, response) => {
    requireJson(request);
    const { paypalOrderId } = parseBody(paymentReturnCaptureSchema, request);
    logStage(request.requestId, "paypal_return_capture", "start");
    try {
      const result = await capturePayPalReturn(db, paypal, paypalOrderId, request.requestId);
      logStage(request.requestId, "paypal_return_capture", "success");
      response.json(result);
    } catch (error) {
      if (error instanceof ApiError && error.status === 202) {
        logStage(request.requestId, "paypal_return_capture", "failure", error);
        response.status(202).json({ state: "capture_unknown" });
        return;
      }
      logStage(request.requestId, "paypal_return_capture", "failure", error);
      throw error;
    }
  });

  router.get("/orders/:id", visitorOnly, async (request, response) => {
    response.json(await readOwnedOrder(db, request.visitorSession!.hash, routeParam(request, "id"), shopId(request)));
  });

  router.post("/orders/:id/capture", originOnly, visitorOnly, orderPerIp, orderPerSession, async (request, response) => {
    requireEmptyBody(request);
    logStage(request.requestId, "paypal_capture", "start");
    try {
      const body = await captureOrder(db, paypal, request.visitorSession!.hash, routeParam(request, "id"), shopId(request), request.requestId);
      logStage(request.requestId, "paypal_capture", "success");
      response.json(body);
    } catch (error) {
      if (error instanceof ApiError && error.status === 202) {
        logStage(request.requestId, "paypal_capture", "failure", error);
        response.status(202).json({ orderId: routeParam(request, "id"), state: "capture_unknown" });
        return;
      }
      logStage(request.requestId, "paypal_capture", "failure", error);
      throw error;
    }
  });

  router.post("/orders/:id/cancel", originOnly, visitorOnly, orderPerIp, orderPerSession, async (request, response) => {
    requireEmptyBody(request);
    response.json(await cancelOwnedOrder(db, request.visitorSession!.hash, routeParam(request, "id"), shopId(request)));
  });

  return router;
}
