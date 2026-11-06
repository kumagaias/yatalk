import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { AppConfig } from "../config.js";
import { createShopRecord, getShopBySlug, type Db, type Shop } from "../database.js";
import { ApiError } from "../errors.js";
import { logStage } from "../logging.js";
import { clearOwnerSession, hashOwnerPassword, ownerFromRequest, requireOwner, startOwnerSession, verifyOwnerPassword } from "../owner-auth.js";
import { createRateLimit, ipKey } from "../rate-limit.js";
import { requireExactOrigin } from "../security.js";
import { parseBody, requireEmptyBody, requireJson } from "../http.js";
import { addShopRequestSchema, createShopRequestSchema, ownerLoginRequestSchema, shopSlugSchema } from "../../shared/schemas.js";

const dummyPasswordHash = `scrypt$16384$8$1$${Buffer.alloc(16).toString("base64url")}$${Buffer.alloc(64).toString("base64url")}`;

function publicShop(shop: Shop) {
  return { slug: shop.slug, name: shop.name, status: shop.status };
}

function createShopForOwner(db: Db, ownerId: string, slug: string, name: string): Shop {
  const transaction = db.transaction(() => {
    const shop = createShopRecord(db, { slug, name });
    db.prepare("INSERT INTO shop_memberships(shop_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)")
      .run(shop.id, ownerId, new Date().toISOString());
    return shop;
  });
  try { return transaction.immediate(); }
  catch (error) {
    if (error instanceof Error && error.message.includes("shops.slug")) {
      throw new ApiError(409, "shop_slug_taken", "That shop address is already in use.");
    }
    throw error;
  }
}

function createAccountAndShop(db: Db, input: { email: string; passwordHash: string; slug: string; name: string }): { userId: string; shop: Shop } {
  const transaction = db.transaction(() => {
    const userId = randomUUID();
    db.prepare("INSERT INTO users(id, email, password_hash, created_at) VALUES (?, ?, ?, ?)")
      .run(userId, input.email, input.passwordHash, new Date().toISOString());
    const shop = createShopRecord(db, { slug: input.slug, name: input.name });
    db.prepare("INSERT INTO shop_memberships(shop_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)")
      .run(shop.id, userId, new Date().toISOString());
    return { userId, shop };
  });
  try { return transaction.immediate(); }
  catch (error) {
    if (error instanceof Error && error.message.includes("users.email")) {
      throw new ApiError(409, "shop_creation_conflict", "A shop could not be created with those details.");
    }
    if (error instanceof Error && error.message.includes("shops.slug")) {
      throw new ApiError(409, "shop_slug_taken", "That shop address is already in use.");
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

  router.get("/shops/slug-availability/:slug", slugCheckPerIp, (request, response) => {
    const parsed = shopSlugSchema.safeParse(request.params.slug);
    response.json({ available: parsed.success && !getShopBySlug(db, parsed.data) });
  });

  router.post("/shops", originOnly, signupPerIp, async (request, response) => {
    requireJson(request);
    const input = parseBody(createShopRequestSchema, request);
    logStage(request.requestId, "shop_registration", "start");
    let passwordHash: string;
    try { passwordHash = await hashOwnerPassword(input.password); }
    catch (error) {
      logStage(request.requestId, "owner_password_hash", "failure", error);
      throw error;
    }
    try {
      const { userId, shop } = createAccountAndShop(db, { ...input, passwordHash });
      startOwnerSession(db, response, config, userId);
      logStage(request.requestId, "shop_registration", "success");
      response.status(201).json({ shop: publicShop(shop), dashboardUrl: `/dashboard/shops/${shop.slug}` });
    } catch (error) {
      logStage(request.requestId, "shop_registration", "failure", error);
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
    response.json(owner ? { authenticated: true, email: owner.email } : { authenticated: false });
  });

  router.delete("/auth/session", originOnly, (request, response) => {
    requireEmptyBody(request);
    clearOwnerSession(db, request, response, config);
    response.status(204).end();
  });

  router.get("/dashboard/shops", ownerOnly, (request, response) => {
    const shops = db.prepare(`SELECT shops.id, shops.slug, shops.name, shops.status
      FROM shops JOIN shop_memberships ON shop_memberships.shop_id = shops.id
      WHERE shop_memberships.user_id = ? ORDER BY shops.created_at`)
      .all(request.ownerUserId) as Shop[];
    response.json({ shops: shops.map(publicShop) });
  });

  router.post("/dashboard/shops", originOnly, ownerOnly, addShopPerOwner, (request, response) => {
    requireJson(request);
    const input = parseBody(addShopRequestSchema, request);
    const shop = createShopForOwner(db, request.ownerUserId!, input.slug, input.name);
    response.status(201).json({ shop: publicShop(shop), dashboardUrl: `/dashboard/shops/${shop.slug}` });
  });

  return router;
}
