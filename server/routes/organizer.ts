import { Router } from "express";
import type { AppConfig } from "../config.js";
import { DEFAULT_SHOP_ID, type Db } from "../database.js";
import { ApiError } from "../errors.js";
import { accessCodeRequestSchema } from "../../shared/schemas.js";
import { parseBody, requireEmptyBody, requireJson } from "../http.js";
import { createRateLimit, ipKey } from "../rate-limit.js";
import { clearAdminSession, requireAdmin, requireExactOrigin, setAdminSession, verifyAccessCode } from "../security.js";
import type { AiProvider } from "../services/ai.js";
import type { PayPalProvider } from "../services/paypal.js";
import { managementOperations } from "./management-operations.js";

export function organizerRoutes(db: Db, config: AppConfig, paypal: PayPalProvider, ai: AiProvider): Router {
  const router = Router();
  const originOnly = requireExactOrigin(config);
  const loginLimit = createRateLimit(5, 15 * 60_000, ipKey);

  router.post("/session", originOnly, loginLimit, (request, response) => {
    requireJson(request);
    const { accessCode } = parseBody(accessCodeRequestSchema, request);
    if (!verifyAccessCode(accessCode, config.adminAccessCode)) {
      throw new ApiError(401, "organizer_credentials_invalid", "The access code is incorrect.");
    }
    setAdminSession(response, config);
    response.status(204).end();
  });
  router.get("/session", requireAdmin(config), (_request, response) => response.status(204).end());
  router.delete("/session", originOnly, (request, response) => {
    requireEmptyBody(request);
    clearAdminSession(response, config);
    response.status(204).end();
  });

  router.use(requireAdmin(config));
  router.use(managementOperations(db, config, paypal, ai, () => DEFAULT_SHOP_ID));
  return router;
}
