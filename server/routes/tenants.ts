import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { AppConfig } from "../config.js";
import { createShopRecord, getShopByOwnerAndSlug, getShopBySlug, type Db, type Shop } from "../database.js";
import { ApiError } from "../errors.js";
import { logStage } from "../logging.js";
import { clearOwnerSession, hashOwnerPassword, ownerFromRequest, requireOwner, startOwnerSession, verifyOwnerPassword } from "../owner-auth.js";
import { createRateLimit, ipKey } from "../rate-limit.js";
import type { CurrencyCode } from "../../shared/currency.js";
import { requireExactOrigin } from "../security.js";
import { parseBody, requireEmptyBody, requireJson } from "../http.js";
import { addShopRequestSchema, ownerLoginRequestSchema, ownerRegistrationRequestSchema, ownerSlugSchema, shopSlugSchema } from "../../shared/schemas.js";

const dummyPasswordHash = `scrypt$16384$8$1$${Buffer.alloc(16).toString("base64url")}$${Buffer.alloc(64).toString("base64url")}`;

function publicShop(shop: Shop) {
  return { slug: shop.slug, name: shop.name, status: shop.status, ownerSlug: shop.ownerSlug, currency: shop.currency };
}

function createShopForOwner(db: Db, owner: { id: string; currency: CurrencyCode }, slug: string, name: string): Shop {
  const transaction = db.transaction(() => {
    const shop = createShopRecord(db, { slug, name, ownerUserId: owner.id, currency: owner.currency });
    db.prepare("INSERT INTO shop_memberships(shop_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)")
      .run(shop.id, owner.id, new Date().toISOString());
    return shop;
  });
  try { return transaction.immediate(); }
  catch (error) {
    if (error instanceof Error && error.message.includes("shops.owner_user_id, shops.slug")) {
      throw new ApiError(409, "shop_slug_taken", "That shop address is already in use for this owner.");
    }
    throw error;
  }
}

export function tenantRoutes(db: Db, config: AppConfig): Router {
  const router = Router();
  const originOnly = requireExactOrigin(config);
  const ownerOnly = requireOwner(db);
  const signupPerIp = createRateLimit(3, 60 * 60_000, ipKey);
  const slugCheckPerIp = createRateLimit(60, 60_000, ipKey);
  const loginPerIp = createRateLimit(5, 15 * 60_000, ipKey);
  const loginPerEmail = createRateLimit(10, 15 * 60_000, (request) => {
    const email = request.body && typeof request.body === "object" ? (request.body as Record<string, unknown>).email : "";
    return typeof email === "string" ? email.trim().toLowerCase().slice(0, 254) : "missing";
  });
  const addShopPerOwner = createRateLimit(6, 60 * 60_000, (request) => request.ownerUserId ?? ipKey(request));

  router.get("/owners/slug-availability/:slug", slugCheckPerIp, (request, response) => {
    const parsed = ownerSlugSchema.safeParse(request.params.slug);
    const found = parsed.success && !!db.prepare("SELECT 1 FROM users WHERE owner_slug = ?").get(parsed.data);
    response.json({ available: parsed.success && !found });
  });

  router.get("/owners/:ownerSlug/shops/slug-availability/:slug", slugCheckPerIp, (request, response) => {
    const owner = ownerSlugSchema.safeParse(request.params.ownerSlug);
    const slug = shopSlugSchema.safeParse(request.params.slug);
    response.json({ available: owner.success && slug.success && !getShopByOwnerAndSlug(db, owner.data, slug.data) });
  });

  router.get("/shops/slug-availability/:slug", slugCheckPerIp, (request, response) => {
    const parsed = shopSlugSchema.safeParse(request.params.slug);
    response.json({ available: parsed.success && !getShopBySlug(db, parsed.data) });
  });

  router.post("/owners", originOnly, signupPerIp, async (request, response) => {
    requireJson(request);
    const input = parseBody(ownerRegistrationRequestSchema, request);
    logStage(request.requestId, "owner_registration", "start");
    let passwordHash: string;
    try { passwordHash = await hashOwnerPassword(input.password); }
    catch (error) {
      logStage(request.requestId, "owner_password_hash", "failure", error);
      throw error;
    }
    const now = new Date().toISOString();
    const userId = randomUUID();
    try {
      db.prepare(`INSERT INTO users(id, email, display_name, owner_slug, default_currency, password_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(userId, input.email, input.displayName, input.ownerSlug, input.defaultCurrency, passwordHash, now);
      startOwnerSession(db, response, config, userId);
      logStage(request.requestId, "owner_registration", "success");
      response.status(201).json({ owner: { displayName: input.displayName, ownerSlug: input.ownerSlug, defaultCurrency: input.defaultCurrency }, nextUrl: "/dashboard/shops/new" });
    } catch (error) {
      logStage(request.requestId, "owner_registration", "failure", error);
      if (error instanceof Error && error.message.includes("users.email")) throw new ApiError(409, "owner_email_taken", "An account already uses that email address.");
      if (error instanceof Error && error.message.includes("users.owner_slug")) throw new ApiError(409, "owner_slug_taken", "That owner address is already in use.");
      throw error;
    }
  });

  router.post("/auth/session", originOnly, loginPerIp, loginPerEmail, async (request, response) => {
    requireJson(request);
    const input = parseBody(ownerLoginRequestSchema, request);
    logStage(request.requestId, "owner_sign_in", "start");
    try {
      const user = db.prepare("SELECT id, password_hash FROM users WHERE email = ? COLLATE NOCASE")
        .get(input.email) as { id: string; password_hash: string } | undefined;
      const valid = await verifyOwnerPassword(input.password, user?.password_hash ?? dummyPasswordHash);
      if (!user || !valid) throw new ApiError(401, "owner_credentials_invalid", "Email or password is incorrect.");
      startOwnerSession(db, response, config, user.id);
      logStage(request.requestId, "owner_sign_in", "success");
      response.status(204).end();
    } catch (error) {
      logStage(request.requestId, "owner_sign_in", "failure", error);
      throw error;
    }
  });

  router.get("/auth/session", (request, response) => {
    const owner = ownerFromRequest(db, request);
    response.json(owner ? { authenticated: true, email: owner.email, displayName: owner.displayName,
      ownerSlug: owner.ownerSlug, defaultCurrency: owner.defaultCurrency } : { authenticated: false });
  });

  router.delete("/auth/session", originOnly, (request, response) => {
    requireEmptyBody(request);
    clearOwnerSession(db, request, response, config);
    response.status(204).end();
  });

  router.get("/dashboard/shops", ownerOnly, (request, response) => {
    const shops = db.prepare(`SELECT shops.id, shops.slug, shops.name, shops.status, shops.currency, users.owner_slug AS ownerSlug
      FROM shops JOIN shop_memberships ON shop_memberships.shop_id = shops.id
      JOIN users ON users.id = shop_memberships.user_id
      WHERE shop_memberships.user_id = ? ORDER BY shops.created_at`)
      .all(request.ownerUserId) as Shop[];
    response.json({ shops: shops.map(publicShop) });
  });

  router.post("/dashboard/shops", originOnly, ownerOnly, addShopPerOwner, (request, response) => {
    requireJson(request);
    const input = parseBody(addShopRequestSchema, request);
    if (!request.ownerUserId || !request.ownerCurrency) throw new ApiError(409, "owner_setup_incomplete", "Sign in again to finish setting up your owner account.");
    const shop = createShopForOwner(db, { id: request.ownerUserId, currency: request.ownerCurrency }, input.slug, input.name);
    response.status(201).json({ shop: publicShop(shop), dashboardUrl: `/dashboard/${shop.ownerSlug}/${shop.slug}` });
  });

  return router;
}
