import express, { Router, type RequestHandler } from "express";
import type { AppConfig } from "../config.js";
import type { Db } from "../database.js";
import { ApiError } from "../errors.js";
import { logStage } from "../logging.js";
import { createRateLimit, ipKey } from "../rate-limit.js";
import { processPaypalWebhook } from "../services/orders.js";
import type { PayPalProvider, WebhookHeaders } from "../services/paypal.js";

export function webhookRoutes(db: Db, config: AppConfig, paypal: PayPalProvider): Router {
  const router = Router();
  const perIpLimit = createRateLimit(30, 60_000, ipKey);
  const maxConcurrentVerifications = 8;
  let activeVerifications = 0;
  const concurrencyLimit: RequestHandler = (_request, response, next) => {
    if (activeVerifications >= maxConcurrentVerifications) {
      next(new ApiError(503, "webhook_busy", "Webhook verification is busy. Retry this delivery."));
      return;
    }
    activeVerifications += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      activeVerifications -= 1;
    };
    response.once("finish", release);
    response.once("close", release);
    next();
  };
  router.post("/paypal", perIpLimit, concurrencyLimit, express.raw({ type: () => true, limit: "64kb" }), async (request, response) => {
    if (!request.is("application/json")) throw new ApiError(415, "webhook_content_type", "Webhook payload must be JSON.");
    if (!Buffer.isBuffer(request.body)) throw new ApiError(415, "webhook_content_type", "Webhook payload must be JSON.");
    let event: unknown;
    try { event = JSON.parse(request.body.toString("utf8")); }
    catch { throw new ApiError(400, "webhook_invalid", "Webhook payload is invalid."); }
    const headers: WebhookHeaders = {
      authAlgorithm: request.get("paypal-auth-algo") ?? "",
      certUrl: request.get("paypal-cert-url") ?? "",
      transmissionId: request.get("paypal-transmission-id") ?? "",
      transmissionSig: request.get("paypal-transmission-sig") ?? "",
      transmissionTime: request.get("paypal-transmission-time") ?? "",
      webhookId: config.paypalWebhookId ?? "",
    };
    logStage(request.requestId, "paypal_webhook_verification", "start");
    try {
      const result = await processPaypalWebhook(db, paypal, headers, event);
      logStage(request.requestId, "paypal_webhook_verification", "success");
      response.status(204).end();
      void result;
    } catch (error) {
      logStage(request.requestId, "paypal_webhook_verification", "failure", error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, "webhook_processing_failed", "Webhook processing failed. PayPal can retry this event.");
    }
  });
  return router;
}
