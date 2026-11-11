import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { AppConfig } from "../config.js";
import { createShopRecord, getShopByOwnerAndSlug, getShopBySlug, type Db, type FirestoreDb, type Shop } from "../database.js";
import { ApiError } from "../errors.js";
import { logStage } from "../logging.js";
import { clearOwnerSession, hashOwnerPassword, ownerFromRequest, requireOwner, startOwnerSession, verifyOwnerPassword } from "../owner-auth.js";
import { createRateLimit, ipKey } from "../rate-limit.js";
import type { CurrencyCode } from "../../shared/currency.js";
import { MAX_FREE_OWNER_SHOPS } from "../../shared/owner-limits.js";
import { requireExactOrigin } from "../security.js";
import { parseBody, requireEmptyBody, requireJson } from "../http.js";
import { addShopRequestSchema, ownerLoginRequestSchema, ownerRegistrationRequestSchema, ownerRegistrationSlugSchema, ownerSlugSchema, shopSlugSchema } from "../../shared/schemas.js";
import { createOwnerAccount, createOwnedShop, getOwnerByEmail, isOwnerSlugAvailable, listOwnerShops } from "../firestore-owners.js";
import type { EmailSender } from "../email.js";
import { consumeEmailVerification, consumePasswordReset, issueAccountToken } from "../account-tokens.js";
import { emailVerificationTokenSchema, passwordResetCompleteSchema, passwordResetRequestSchema } from "../../shared/schemas.js";

const dummyPasswordHash = `scrypt$16384$8$1$${Buffer.alloc(16).toString("base64url")}$${Buffer.alloc(64).toString("base64url")}`;

function publicShop(shop: Shop) {
  return { slug: shop.slug, name: shop.name, status: shop.status, ownerSlug: shop.ownerSlug, currency: shop.currency };
}

async function createShopForOwner(db: Db, owner: { id: string; currency: CurrencyCode }, slug: string, name: string): Promise<Shop> {
  if ((db as FirestoreDb).firestoreBrand) {
    try { return await createOwnedShop(db as FirestoreDb, owner, slug, name); }
    catch (error) {
      if (error instanceof Error && error.message === "shop_limit_reached") {
        throw new ApiError(409, "shop_limit_reached", "Free owner accounts can create up to 3 shops.");
      }
      if (error instanceof Error && error.message.includes("shops.owner_user_id, shops.slug")) {
        throw new ApiError(409, "shop_slug_taken", "That shop address is already in use for this owner.");
      }
      throw error;
    }
  }
  const transaction = db.transaction(() => {
    const count = db.prepare("SELECT COUNT(*) AS count FROM shops WHERE owner_user_id = ?")
      .get(owner.id) as { count: number };
    if (count.count >= MAX_FREE_OWNER_SHOPS) throw new ApiError(409, "shop_limit_reached", "Free owner accounts can create up to 3 shops.");
    const shop = createShopRecord(db as import("../database.js").SqliteDb, { slug, name, ownerUserId: owner.id, currency: owner.currency });
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

export function tenantRoutes(db: Db, config: AppConfig, emailSender: EmailSender): Router {
  const router = Router();
  const originOnly = requireExactOrigin(config);
  const ownerOnly = requireOwner(db);
  const signupPerIp = createRateLimit(10, 60 * 60_000, ipKey);
  const slugCheckPerIp = createRateLimit(60, 60_000, ipKey);
  const loginPerIp = createRateLimit(10, 15 * 60_000, ipKey);
  const loginPerEmail = createRateLimit(10, 15 * 60_000, (request) => {
    const email = request.body && typeof request.body === "object" ? (request.body as Record<string, unknown>).email : "";
    return typeof email === "string" ? email.trim().toLowerCase().slice(0, 254) : "missing";
  });
  const addShopPerOwner = createRateLimit(6, 60 * 60_000, (request) => request.ownerUserId ?? ipKey(request));
  const verificationPerOwner = createRateLimit(3, 60 * 60_000, (request) => request.ownerUserId ?? ipKey(request));
  const resetPerIp = createRateLimit(5, 60 * 60_000, ipKey);
  const resetPerEmail = createRateLimit(5, 60 * 60_000, (request) => {
    const email = request.body && typeof request.body === "object" ? (request.body as Record<string, unknown>).email : "";
    return typeof email === "string" ? email.trim().toLowerCase().slice(0, 254) : "missing";
  });

  const sendAccountEmail = async (email: { to: string; subject: string; text: string }): Promise<boolean> => {
    try { await emailSender.send(email); return true; }
    catch { return false; }
  };

  const tokenLink = (route: string, token: string): string => {
    const url = new URL(route, config.appOrigin);
    url.hash = new URLSearchParams({ token }).toString();
    return url.toString();
  };

  router.get("/owners/slug-availability/:slug", slugCheckPerIp, async (request, response) => {
    const parsed = ownerRegistrationSlugSchema.safeParse(request.params.slug);
    const available = parsed.success && ((db as FirestoreDb).firestoreBrand
      ? await isOwnerSlugAvailable(db as FirestoreDb, parsed.data)
      : !db.prepare("SELECT 1 FROM users WHERE owner_slug = ?").get(parsed.data));
    response.json({ available });
  });

  router.get("/owners/:ownerSlug/shops/slug-availability/:slug", slugCheckPerIp, async (request, response) => {
    const owner = ownerSlugSchema.safeParse(request.params.ownerSlug);
    const slug = shopSlugSchema.safeParse(request.params.slug);
    response.json({ available: owner.success && slug.success && !await getShopByOwnerAndSlug(db, owner.data, slug.data) });
  });

  router.get("/shops/slug-availability/:slug", slugCheckPerIp, async (request, response) => {
    const parsed = shopSlugSchema.safeParse(request.params.slug);
    response.json({ available: parsed.success && !await getShopBySlug(db, parsed.data) });
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
      if ((db as FirestoreDb).firestoreBrand) {
        await createOwnerAccount(db as FirestoreDb, { id: userId, email: input.email, displayName: input.displayName,
          ownerSlug: input.ownerSlug, defaultCurrency: input.defaultCurrency, passwordHash, createdAt: now, shopCount: 0, emailVerified: false });
      } else {
        db.prepare(`INSERT INTO users(id, email, display_name, owner_slug, default_currency, password_hash, email_verified, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 0, ?)`)
          .run(userId, input.email, input.displayName, input.ownerSlug, input.defaultCurrency, passwordHash, now);
      }
      await startOwnerSession(db, response, config, userId);
      let verificationEmailSent = false;
      try {
        const token = await issueAccountToken(db, userId, "verify_email");
        verificationEmailSent = await sendAccountEmail({ to: input.email, subject: "Verify your Yatalk owner email",
          text: `Hello ${input.displayName},\n\nVerify your owner email within 24 hours: ${tokenLink("/verify-email", token)}\n\nIf you did not create this account, you can ignore this message.` });
      } catch (error) { logStage(request.requestId, "owner_verification_email", "failure", error); }
      logStage(request.requestId, "owner_registration", "success");
      response.status(201).json({ owner: { displayName: input.displayName, ownerSlug: input.ownerSlug, defaultCurrency: input.defaultCurrency },
        emailVerified: false, verificationEmailSent, nextUrl: "/dashboard/shops" });
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
      let user: { id: string; passwordHash: string } | undefined;
      if ((db as FirestoreDb).firestoreBrand) {
        const account = await getOwnerByEmail(db as FirestoreDb, input.email);
        user = account ? { id: account.id, passwordHash: account.passwordHash } : undefined;
      } else {
        const account = db.prepare("SELECT id, password_hash FROM users WHERE email = ? COLLATE NOCASE")
          .get(input.email) as { id: string; password_hash: string } | undefined;
        user = account ? { id: account.id, passwordHash: account.password_hash } : undefined;
      }
      const valid = await verifyOwnerPassword(input.password, user?.passwordHash ?? dummyPasswordHash);
      if (!user || !valid) throw new ApiError(401, "owner_credentials_invalid", "Email or password is incorrect.");
      await startOwnerSession(db, response, config, user.id);
      logStage(request.requestId, "owner_sign_in", "success");
      response.status(204).end();
    } catch (error) {
      logStage(request.requestId, "owner_sign_in", "failure", error);
      throw error;
    }
  });

  router.get("/auth/session", async (request, response) => {
    const owner = await ownerFromRequest(db, request);
    response.json(owner ? { authenticated: true, email: owner.email, displayName: owner.displayName,
      ownerSlug: owner.ownerSlug, defaultCurrency: owner.defaultCurrency, emailVerified: owner.emailVerified } : { authenticated: false });
  });

  router.post("/auth/verification/resend", originOnly, ownerOnly, verificationPerOwner, async (request, response) => {
    requireJson(request);
    const owner = await ownerFromRequest(db, request);
    if (!owner) throw new ApiError(401, "owner_session_required", "Sign in to manage your shops.");
    if (owner.emailVerified) { response.json({ emailVerified: true, sent: false }); return; }
    const token = await issueAccountToken(db, owner.id, "verify_email");
    const sent = await sendAccountEmail({ to: owner.email, subject: "Verify your Yatalk owner email",
      text: `Hello ${owner.displayName},\n\nVerify your owner email within 24 hours: ${tokenLink("/verify-email", token)}\n\nIf you did not create this account, you can ignore this message.` });
    if (!sent) logStage(request.requestId, "owner_verification_email", "failure");
    response.status(202).json({ emailVerified: false, sent });
  });

  router.post("/auth/verification/confirm", originOnly, async (request, response) => {
    requireJson(request);
    const { token } = parseBody(emailVerificationTokenSchema, request);
    if (!await consumeEmailVerification(db, token)) throw new ApiError(400, "verification_link_invalid", "This verification link is invalid or expired. Request a new one from your owner dashboard.");
    response.status(204).end();
  });

  router.post("/auth/password-reset/request", originOnly, resetPerIp, resetPerEmail, async (request, response) => {
    requireJson(request);
    const { email } = parseBody(passwordResetRequestSchema, request);
    let userId: string | undefined;
    if ((db as FirestoreDb).firestoreBrand) {
      userId = (await getOwnerByEmail(db as FirestoreDb, email))?.id;
    } else {
      const row = (db as import("../database.js").SqliteDb).prepare("SELECT id FROM users WHERE email = ? COLLATE NOCASE")
        .get(email) as { id: string } | undefined;
      userId = row?.id;
    }
    if (userId) {
      try {
        const token = await issueAccountToken(db, userId, "password_reset");
        const sent = await sendAccountEmail({ to: email, subject: "Reset your Yatalk password",
          text: `Use this link within 30 minutes to reset your Yatalk owner password: ${tokenLink("/password-reset", token)}\n\nIf you did not request this, you can ignore this message.` });
        if (!sent) logStage(request.requestId, "password_reset_email", "failure");
      } catch (error) { logStage(request.requestId, "password_reset_email", "failure", error); }
    }
    response.status(202).json({ message: "If an account uses that email, a password reset link will arrive shortly." });
  });

  router.post("/auth/password-reset/complete", originOnly, async (request, response) => {
    requireJson(request);
    const { token, password } = parseBody(passwordResetCompleteSchema, request);
    const passwordHash = await hashOwnerPassword(password);
    if (!await consumePasswordReset(db, token, passwordHash)) throw new ApiError(400, "reset_link_invalid", "This password reset link is invalid or expired. Request a new one.");
    response.status(204).end();
  });

  router.delete("/auth/session", originOnly, async (request, response) => {
    requireEmptyBody(request);
    await clearOwnerSession(db, request, response, config);
    response.status(204).end();
  });

  router.get("/dashboard/shops", ownerOnly, async (request, response) => {
    const shops = (db as FirestoreDb).firestoreBrand
      ? await listOwnerShops(db as FirestoreDb, request.ownerUserId!)
      : db.prepare(`SELECT shops.id, shops.slug, shops.name, shops.status, shops.currency, users.owner_slug AS ownerSlug
      FROM shops JOIN shop_memberships ON shop_memberships.shop_id = shops.id
      JOIN users ON users.id = shop_memberships.user_id
      WHERE shop_memberships.user_id = ? ORDER BY shops.created_at`)
      .all(request.ownerUserId) as Shop[];
    response.json({ shops: shops.map(publicShop) });
  });

  router.post("/dashboard/shops", originOnly, ownerOnly, addShopPerOwner, async (request, response) => {
    requireJson(request);
    const input = parseBody(addShopRequestSchema, request);
    if (!request.ownerUserId || !request.ownerCurrency) throw new ApiError(409, "owner_setup_incomplete", "Sign in again to finish setting up your owner account.");
    const shop = await createShopForOwner(db, { id: request.ownerUserId, currency: request.ownerCurrency }, input.slug, input.name);
    response.status(201).json({ shop: publicShop(shop), dashboardUrl: `/dashboard/${shop.ownerSlug}/${shop.slug}` });
  });

  return router;
}
