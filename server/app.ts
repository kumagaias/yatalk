import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import type { AppConfig } from "./config.js";
import { createDatabase, type Db } from "./database.js";
import { ApiError, errorResponse, ProviderError } from "./errors.js";
import { logStage } from "./logging.js";
import { publicRoutes } from "./routes/public.js";
import { orderRoutes } from "./routes/orders.js";
import { organizerRoutes } from "./routes/organizer.js";
import { tenantRoutes } from "./routes/tenants.js";
import { managementOperations } from "./routes/management-operations.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { voiceRoutes } from "./routes/voice.js";
import { GeminiVertex, type AiProvider } from "./services/ai.js";
import { PayPalClient, type PayPalProvider } from "./services/paypal.js";
import { trustedProxyHops } from "./network.js";
import { requireOwner, requireShopMember } from "./owner-auth.js";
import { requireShopSlug, useDefaultShop } from "./shop-context.js";

export interface CreateAppOptions {
  config: AppConfig;
  db?: Db;
  paypal?: PayPalProvider;
  ai?: AiProvider;
  serveStatic?: boolean;
}

export function createApp(options: CreateAppOptions): express.Express {
  const { config } = options;
  const db = options.db ?? createDatabase(config.databasePath);
  const paypal = options.paypal ?? new PayPalClient(config);
  const ai = options.ai ?? new GeminiVertex(config);
  const app = express();
  app.set("trust proxy", trustedProxyHops(config.nodeEnv));
  app.disable("x-powered-by");
  app.use((request, response, next) => {
    request.requestId = crypto.randomUUID();
    response.setHeader("X-Request-Id", request.requestId);
    next();
  });
  app.use(helmet({
    contentSecurityPolicy: { directives: {
      "default-src": ["'self'"],
      "base-uri": ["'self'"],
      "object-src": ["'none'"],
      "frame-ancestors": ["'self'"],
      "script-src": ["'self'", "https://*.paypal.com", "https://*.paypalobjects.com"],
      "connect-src": ["'self'", "https://*.paypal.com", "https://*.paypalobjects.com"],
      "frame-src": ["'self'", "https://*.paypal.com", "https://*.paypalobjects.com"],
      "img-src": ["'self'", "data:", "https://*.paypalobjects.com"],
      "style-src": ["'self'", "'unsafe-inline'"],
    } },
  }));
  app.use("/api/webhooks", webhookRoutes(db, config, paypal));
  app.use("/api/v1/webhooks", webhookRoutes(db, config, paypal));
  app.use(express.json({ limit: "32kb", type: "application/json", strict: true }));
  app.use((request, response, next) => {
    if (request.path === "/api/voice/transcribe" || /^\/api\/v1\/shops\/[^/]+\/voice\/transcribe$/.test(request.path)) { next(); return; }
    express.raw({ type: () => true, limit: "32kb" })(request, response, next);
  });
  app.get("/api/health", (_request, response) => response.json({ ok: true }));
  const v1 = express.Router();
  v1.use(tenantRoutes(db, config));
  v1.use("/shops/:shopSlug", requireShopSlug(db), publicRoutes(db, config, ai), voiceRoutes(db, config, ai), orderRoutes(db, config, paypal));
  v1.use("/dashboard/shops/:shopSlug", requireShopSlug(db, true), requireOwner(db), requireShopMember(db),
    managementOperations(db, config, paypal, ai, (request) => request.shop!.id, (request) => request.ownerUserId ?? null));
  app.use("/api/v1", v1);

  app.use("/api", useDefaultShop(db));
  app.use("/api", publicRoutes(db, config, ai));
  app.use("/api", voiceRoutes(db, config, ai));
  app.use("/api", orderRoutes(db, config, paypal));
  app.use("/api/organizer", organizerRoutes(db, config, paypal, ai));
  app.use("/api", (_request, _response, next) => next(new ApiError(404, "not_found", "The requested API route was not found.")));
  app.use("/api/v1", (_request, _response, next) => next(new ApiError(404, "not_found", "The requested API route was not found.")));

  if (options.serveStatic) {
    const dist = path.resolve(process.cwd(), "dist");
    if (fs.existsSync(dist)) {
      app.use(express.static(dist, { index: false, fallthrough: true, maxAge: config.nodeEnv === "production" ? "1h" : 0 }));
      app.use((request, response, next) => {
        if (request.method === "GET" && !request.path.startsWith("/api/")) {
          response.sendFile(path.join(dist, "index.html"), (error) => { if (error) next(error); });
        } else next();
      });
    }
  }

  const errorHandler: ErrorRequestHandler = (error: unknown, request, response, next) => {
    if (response.headersSent) { next(error); return; }
    let apiError: ApiError;
    if (error instanceof ApiError) apiError = error;
    else if (error instanceof ProviderError) apiError = new ApiError(error.httpStatus === 503 ? 503 : 502, "provider_error", "A service could not complete the request.");
    else {
      const parser = error as { status?: number; statusCode?: number; type?: string };
      const status = parser.statusCode ?? parser.status;
      if (status === 413 || parser.type === "entity.too.large") apiError = new ApiError(413, "request_too_large", "The request body is too large.");
      else if (status === 400 || parser.type === "entity.parse.failed") apiError = new ApiError(400, "invalid_json", "The JSON request body is invalid.");
      else apiError = new ApiError(500, "internal_error", "The request could not be completed.");
    }
    const route = request.route?.path ? String(request.route.path) : "unmatched";
    logStage(request.requestId ?? "missing", `${request.method}:${route}`, "failure", error);
    response.status(apiError.status).json(errorResponse(apiError, request.requestId ?? "missing"));
  };
  app.use(errorHandler);
  return app;
}
