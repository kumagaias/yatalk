import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { AppConfig } from "./config.js";
import type { Db, FirestoreDb, SqliteDb } from "./database.js";
import { ApiError } from "./errors.js";
import { getCookie } from "./security.js";

const OWNER_COOKIE = "yatalk_owner";
const OWNER_TTL_SECONDS = 8 * 60 * 60;
const SCRYPT_N = 1 << 14;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_BYTES = 64;

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, SCRYPT_BYTES, {
      N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024,
    }, (error, derived) => {
      if (error) reject(error);
      else resolve(derived as Buffer);
    });
  });
}

export async function hashOwnerPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyOwnerPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt" || Number(parts[1]) !== SCRYPT_N ||
      Number(parts[2]) !== SCRYPT_R || Number(parts[3]) !== SCRYPT_P) return false;
  const salt = Buffer.from(parts[4]!, "base64url");
  const expected = Buffer.from(parts[5]!, "base64url");
  if (salt.length !== 16 || expected.length !== SCRYPT_BYTES) return false;
  const actual = await scrypt(password, salt);
  return timingSafeEqual(actual, expected);
}

function cookieOptions(config: AppConfig, maxAge: number): string {
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.nodeEnv === "production" ? "; Secure" : ""}`;
}

export function startOwnerSession(db: FirestoreDb, response: Response, config: AppConfig, userId: string): Promise<void>;
export function startOwnerSession(db: SqliteDb, response: Response, config: AppConfig, userId: string): void;
export function startOwnerSession(db: Db, response: Response, config: AppConfig, userId: string): void | Promise<void>;
export function startOwnerSession(db: Db, response: Response, config: AppConfig, userId: string): void | Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OWNER_TTL_SECONDS * 1000).toISOString();
  if ((db as FirestoreDb).firestoreBrand) {
    const hash = digest(token);
    return (db as FirestoreDb).firestoreStore.set("ownerSessions", hash,
      { id: hash, userId, expiresAt, expiresAtTtl: new Date(expiresAt), createdAt: now.toISOString() }).then(() => {
        response.append("Set-Cookie", `${OWNER_COOKIE}=${token}; ${cookieOptions(config, OWNER_TTL_SECONDS)}`);
      });
  }
  db.prepare("DELETE FROM owner_sessions WHERE expires_at <= ?").run(now.toISOString());
  db.prepare("INSERT INTO owner_sessions(token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .run(digest(token), userId, expiresAt, now.toISOString());
  response.append("Set-Cookie", `${OWNER_COOKIE}=${token}; ${cookieOptions(config, OWNER_TTL_SECONDS)}`);
}

export function clearOwnerSession(db: FirestoreDb, request: Request, response: Response, config: AppConfig): Promise<void>;
export function clearOwnerSession(db: SqliteDb, request: Request, response: Response, config: AppConfig): void;
export function clearOwnerSession(db: Db, request: Request, response: Response, config: AppConfig): void | Promise<void>;
export function clearOwnerSession(db: Db, request: Request, response: Response, config: AppConfig): void | Promise<void> {
  const token = getCookie(request, OWNER_COOKIE);
  if ((db as FirestoreDb).firestoreBrand) {
    const operation = token && /^[A-Za-z0-9_-]{40,64}$/.test(token)
      ? (db as FirestoreDb).firestoreStore.delete("ownerSessions", digest(token)) : Promise.resolve();
    return operation.then(() => { response.append("Set-Cookie", `${OWNER_COOKIE}=; ${cookieOptions(config, 0)}`); });
  }
  if (token && /^[A-Za-z0-9_-]{40,64}$/.test(token)) {
    db.prepare("DELETE FROM owner_sessions WHERE token_hash = ?").run(digest(token));
  }
  response.append("Set-Cookie", `${OWNER_COOKIE}=; ${cookieOptions(config, 0)}`);
}

export type OwnerAccount = { id: string; email: string; displayName: string; ownerSlug: string | null; defaultCurrency: import("../shared/currency.js").CurrencyCode };
export function ownerFromRequest(db: FirestoreDb, request: Request): Promise<OwnerAccount | undefined>;
export function ownerFromRequest(db: SqliteDb, request: Request): OwnerAccount | undefined;
export function ownerFromRequest(db: Db, request: Request): OwnerAccount | undefined | Promise<OwnerAccount | undefined>;
export function ownerFromRequest(db: Db, request: Request): OwnerAccount | undefined | Promise<OwnerAccount | undefined> {
  const token = getCookie(request, OWNER_COOKIE);
  if (!token || !/^[A-Za-z0-9_-]{40,64}$/.test(token)) return undefined;
  if ((db as FirestoreDb).firestoreBrand) return firestoreOwnerFromRequest(db as FirestoreDb, token);
  const row = db.prepare(`SELECT users.id, users.email, users.display_name, users.owner_slug, users.default_currency FROM owner_sessions
    JOIN users ON users.id = owner_sessions.user_id
    WHERE owner_sessions.token_hash = ? AND owner_sessions.expires_at > ?`)
    .get(digest(token), new Date().toISOString()) as { id: string; email: string; display_name: string; owner_slug: string | null; default_currency: import("../shared/currency.js").CurrencyCode } | undefined;
  return row ? { id: row.id, email: row.email, displayName: row.display_name, ownerSlug: row.owner_slug, defaultCurrency: row.default_currency } : undefined;
}

export function requireOwner(db: Db) {
  return async (request: Request, _response: Response, next: NextFunction): Promise<void> => {
    const owner = await ownerFromRequest(db, request);
    if (!owner) {
      next(new ApiError(401, "owner_session_required", "Sign in to manage your shops."));
      return;
    }
    request.ownerUserId = owner.id;
    request.ownerSlug = owner.ownerSlug ?? undefined;
    request.ownerDisplayName = owner.displayName;
    request.ownerCurrency = owner.defaultCurrency;
    next();
  };
}

export function requireShopMember(db: Db) {
  return async (request: Request, _response: Response, next: NextFunction): Promise<void> => {
    const shop = request.shop;
    const userId = request.ownerUserId;
    if (!shop || !userId) {
      next(new ApiError(404, "shop_not_found", "The requested shop was not found."));
      return;
    }
    const membership = (db as FirestoreDb).firestoreBrand
      ? await (db as FirestoreDb).firestoreStore.get<{ role: "owner" | "staff" } & Record<string, unknown>>("shopMemberships", `${shop.id}_${userId}`)
      : db.prepare("SELECT role FROM shop_memberships WHERE shop_id = ? AND user_id = ?")
        .get(shop.id, userId) as { role: "owner" | "staff" } | undefined;
    if (!membership) {
      next(new ApiError(404, "shop_not_found", "The requested shop was not found."));
      return;
    }
    request.shopRole = membership.role;
    next();
  };
}

export function createOwnerId(): string {
  return randomUUID();
}

export const ownerCookieName = OWNER_COOKIE;

async function firestoreOwnerFromRequest(db: FirestoreDb, token: string): Promise<OwnerAccount | undefined> {
  const session = await db.firestoreStore.get<{ userId: string; expiresAt: string } & Record<string, unknown>>("ownerSessions", digest(token));
  if (!session || session.expiresAt <= new Date().toISOString()) return undefined;
  const user = await db.firestoreStore.get<{ email: string; displayName: string; ownerSlug: string; defaultCurrency: OwnerAccount["defaultCurrency"] } & Record<string, unknown>>("users", session.userId);
  return user ? { id: session.userId, email: user.email, displayName: user.displayName, ownerSlug: user.ownerSlug,
    defaultCurrency: user.defaultCurrency } : undefined;
}
