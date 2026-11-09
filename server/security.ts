import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import type { AppConfig } from "./config.js";
import { DEFAULT_SHOP_ID, type Db, type FirestoreDb, type Shop, type SqliteDb } from "./database.js";
import { ApiError } from "./errors.js";

const VISITOR_COOKIE = "yatalk_visitor";
const ADMIN_COOKIE = "yatalk_admin";
const VISITOR_TTL_SECONDS = 7 * 24 * 60 * 60;
const ADMIN_TTL_SECONDS = 8 * 60 * 60;
const MAX_EXPIRED_SESSIONS_PER_CLEANUP = 100;

export interface VisitorSession {
  token: string;
  hash: string;
  shopId: string;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function getCookie(request: Request, cookieName: string): string | undefined {
  const result = new Map<string, string>();
  for (const part of (request.headers.cookie ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (/^[a-zA-Z0-9_-]+$/.test(name)) result.set(name, value);
  }
  return result.get(cookieName);
}

function cookieOptions(config: AppConfig, maxAge: number): string {
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.nodeEnv === "production" ? "; Secure" : ""}`;
}

function constantEqual(left: string, right: string): boolean {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  const digestMatches = timingSafeEqual(a, b);
  return Boolean(Number(digestMatches) & Number(left.length === right.length));
}

function visitorCookieName(shop: Pick<Shop, "id">): string {
  return shop.id === DEFAULT_SHOP_ID ? VISITOR_COOKIE : `yatalk_v_${shop.id}`;
}

function requestShop(request: Request): Pick<Shop, "id"> {
  return request.shop ? { id: request.shop.id } : { id: DEFAULT_SHOP_ID };
}

export function createVisitorSession(db: FirestoreDb, response: Response, config: AppConfig, shop?: Pick<Shop, "id">): Promise<VisitorSession>;
export function createVisitorSession(db: SqliteDb, response: Response, config: AppConfig, shop?: Pick<Shop, "id">): VisitorSession;
export function createVisitorSession(db: Db, response: Response, config: AppConfig, shop?: Pick<Shop, "id">): VisitorSession | Promise<VisitorSession>;
export function createVisitorSession(db: Db, response: Response, config: AppConfig, shop: Pick<Shop, "id"> = { id: DEFAULT_SHOP_ID }): VisitorSession | Promise<VisitorSession> {
  if ((db as FirestoreDb).firestoreBrand) return createFirestoreVisitorSession(db as FirestoreDb, response, config, shop);
  db.prepare(`DELETE FROM visitor_sessions WHERE session_hash IN (
    SELECT session_hash FROM visitor_sessions
    WHERE expires_at <= ?
      AND NOT EXISTS (SELECT 1 FROM orders WHERE orders.session_hash = visitor_sessions.session_hash)
    ORDER BY expires_at LIMIT ?
  )`).run(new Date().toISOString(), MAX_EXPIRED_SESSIONS_PER_CLEANUP);
  const token = randomBytes(32).toString("base64url");
  const hash = sha256(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + VISITOR_TTL_SECONDS * 1000).toISOString();
  db.prepare(`INSERT INTO visitor_sessions(session_hash, shop_id, cart_version, expires_at, created_at)
    VALUES (?, ?, 0, ?, ?)`).run(hash, shop.id, expiresAt, now.toISOString());
  response.append("Set-Cookie", `${visitorCookieName(shop)}=${token}; ${cookieOptions(config, VISITOR_TTL_SECONDS)}`);
  return { token, hash, shopId: shop.id };
}

export function requireVisitor(db: Db, _config: AppConfig) {
  return async (request: Request, _response: Response, next: NextFunction): Promise<void> => {
    const shop = requestShop(request);
    const token = getCookie(request, visitorCookieName(shop));
    const tokenIsValid = token && /^[A-Za-z0-9_-]{40,64}$/.test(token);
    const hash = tokenIsValid ? sha256(token) : "";
    const session = hash ? (await getVisitorSession(db, hash, shop.id)) : undefined;
    if (!session || !token) {
      next(new ApiError(401, "visitor_session_required", "Refresh the page to start a new session."));
      return;
    }
    request.visitorSession = { token, hash, shopId: shop.id };
    next();
  };
}

export function attachVisitorIfPresent(db: FirestoreDb, request: Request): Promise<VisitorSession | undefined>;
export function attachVisitorIfPresent(db: SqliteDb, request: Request): VisitorSession | undefined;
export function attachVisitorIfPresent(db: Db, request: Request): VisitorSession | undefined | Promise<VisitorSession | undefined>;
export function attachVisitorIfPresent(db: Db, request: Request): VisitorSession | undefined | Promise<VisitorSession | undefined> {
  const shop = requestShop(request);
  const token = getCookie(request, visitorCookieName(shop));
  if (!token || !/^[A-Za-z0-9_-]{40,64}$/.test(token)) return undefined;
  const hash = sha256(token);
  if ((db as FirestoreDb).firestoreBrand) return getVisitorSession(db, hash, shop.id).then((session) => session ? { token, hash, shopId: shop.id } : undefined);
  const session = db.prepare(`SELECT session_hash FROM visitor_sessions WHERE session_hash = ? AND shop_id = ? AND expires_at > ?`)
    .get(hash, shop.id, new Date().toISOString()) as { session_hash: string } | undefined;
  return session ? { token, hash, shopId: shop.id } : undefined;
}

async function createFirestoreVisitorSession(db: FirestoreDb, response: Response, config: AppConfig, shop: Pick<Shop, "id">): Promise<VisitorSession> {
  const token = randomBytes(32).toString("base64url");
  const hash = sha256(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + VISITOR_TTL_SECONDS * 1000).toISOString();
  await db.firestoreStore.create("visitorSessions", hash, {
    id: hash, shopId: shop.id, cartVersion: 0, expiresAt, expiresAtTtl: new Date(expiresAt), createdAt: now.toISOString(),
  });
  response.append("Set-Cookie", `${visitorCookieName(shop)}=${token}; ${cookieOptions(config, VISITOR_TTL_SECONDS)}`);
  return { token, hash, shopId: shop.id };
}

async function getVisitorSession(db: Db, hash: string, shopId: string): Promise<{ session_hash: string } | undefined> {
  if ((db as FirestoreDb).firestoreBrand) {
    const session = await (db as FirestoreDb).firestoreStore.get<{ shopId: string; expiresAt: string } & Record<string, unknown>>("visitorSessions", hash);
    return session?.shopId === shopId && session.expiresAt > new Date().toISOString() ? { session_hash: hash } : undefined;
  }
  return db.prepare(`SELECT session_hash FROM visitor_sessions
      WHERE session_hash = ? AND shop_id = ? AND expires_at > ?`)
    .get(hash, shopId, new Date().toISOString()) as { session_hash: string } | undefined;
}

function adminSignature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function setAdminSession(response: Response, config: AppConfig): void {
  if (!config.adminSessionSecret) throw new ApiError(503, "organizer_unavailable", "Organizer access is not configured.");
  const payload = `${Date.now() + ADMIN_TTL_SECONDS * 1000}.${randomBytes(18).toString("base64url")}`;
  const value = `${payload}.${adminSignature(payload, config.adminSessionSecret)}`;
  response.append("Set-Cookie", `${ADMIN_COOKIE}=${value}; ${cookieOptions(config, ADMIN_TTL_SECONDS)}`);
}

export function clearAdminSession(response: Response, config: AppConfig): void {
  response.append("Set-Cookie", `${ADMIN_COOKIE}=; ${cookieOptions(config, 0)}`);
}

export function validAdminSession(request: Request, config: AppConfig): boolean {
  if (!config.adminSessionSecret) return false;
  const raw = getCookie(request, ADMIN_COOKIE);
  if (!raw || raw.length > 256) return false;
  const lastDot = raw.lastIndexOf(".");
  if (lastDot < 1) return false;
  const payload = raw.slice(0, lastDot);
  const signature = raw.slice(lastDot + 1);
  const expiry = Number(payload.split(".", 1)[0]);
  if (!Number.isSafeInteger(expiry) || expiry <= Date.now()) return false;
  return constantEqual(signature, adminSignature(payload, config.adminSessionSecret));
}

export function organizerRateKey(request: Request): string {
  const raw = getCookie(request, ADMIN_COOKIE) ?? "missing";
  return sha256(raw);
}

export function requireAdmin(config: AppConfig) {
  return (request: Request, _response: Response, next: NextFunction): void => {
    if (!validAdminSession(request, config)) {
      next(new ApiError(401, "organizer_session_required", "Organizer sign-in is required."));
      return;
    }
    request.isOrganizer = true;
    next();
  };
}

export function requireExactOrigin(config: AppConfig) {
  return (request: Request, _response: Response, next: NextFunction): void => {
    const origin = request.get("origin");
    if (origin !== config.appOrigin) {
      next(new ApiError(403, "origin_rejected", "This request origin is not allowed."));
      return;
    }
    next();
  };
}

export function verifyAccessCode(input: string, configured: string | null): boolean {
  if (!configured) return false;
  return constantEqual(input, configured);
}

export const sessionCookieNames = { visitor: VISITOR_COOKIE, admin: ADMIN_COOKIE };
