import path from "node:path";
import dotenv from "dotenv";
import type { CurrencyCode } from "../shared/currency.js";

dotenv.config();

export interface AppConfig {
  nodeEnv: "development" | "production" | "test";
  port: number;
  appOrigin: string;
  eventName: string;
  eventTimeZone: string;
  currency: CurrencyCode;
  databaseBackend: "sqlite" | "firestore";
  databasePath: string;
  paypalMode: "sandbox";
  paypalClientId: string | null;
  paypalClientSecret: string | null;
  paypalWebhookId: string | null;
  googleCloudProject: string | null;
  googleCloudLocation: string;
  geminiModel: string;
  adminAccessCode: string | null;
  adminSessionSecret: string | null;
  resendApiKey: string | null;
  resendFromEmail: string | null;
  shopImageBucket: string | null;
}

function optionalSecret(value: string | undefined): string | null {
  const candidate = value?.trim();
  return candidate && !candidate.toLowerCase().startsWith("replace-with") ? candidate : null;
}

function parseOrigin(value: string | undefined): string {
  const raw = value?.trim() || "http://127.0.0.1:5173";
  const parsed = new URL(raw);
  if (parsed.origin !== raw.replace(/\/$/, "")) {
    throw new Error("APP_ORIGIN must be an exact origin without a path");
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    throw new Error("APP_ORIGIN must use HTTPS outside localhost");
  }
  return parsed.origin;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV === "production" || env.NODE_ENV === "test" ? env.NODE_ENV : "development";
  const port = Number(env.APP_PORT ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("APP_PORT is invalid");

  const timeZone = env.EVENT_TIME_ZONE?.trim() || "Asia/Tokyo";
  try {
    new Intl.DateTimeFormat("en", { timeZone });
  } catch {
    throw new Error("EVENT_TIME_ZONE is invalid");
  }
  if (env.PAYPAL_MODE?.trim() && env.PAYPAL_MODE.trim().toLowerCase() !== "sandbox") {
    throw new Error("PAYPAL_MODE must be sandbox for this demo");
  }
  const adminSessionSecret = optionalSecret(env.ADMIN_SESSION_SECRET);
  if (adminSessionSecret && Buffer.byteLength(adminSessionSecret, "utf8") < 32) {
    throw new Error("ADMIN_SESSION_SECRET must contain at least 32 bytes");
  }
  const adminAccessCode = optionalSecret(env.ADMIN_ACCESS_CODE);
  if (adminAccessCode && Array.from(adminAccessCode).length < 16) {
    throw new Error("ADMIN_ACCESS_CODE must contain at least 16 characters");
  }
  if (adminAccessCode && Array.from(adminAccessCode).length > 128) {
    throw new Error("ADMIN_ACCESS_CODE must contain no more than 128 characters");
  }
  const googleCloudProject = env.GOOGLE_CLOUD_PROJECT?.trim() || null;
  if (googleCloudProject && !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(googleCloudProject)) {
    throw new Error("GOOGLE_CLOUD_PROJECT is invalid");
  }
  const googleCloudLocation = env.GOOGLE_CLOUD_LOCATION?.trim() || "global";
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(googleCloudLocation)) {
    throw new Error("GOOGLE_CLOUD_LOCATION is invalid");
  }
  const geminiModel = env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite";
  if (!/^[a-z0-9][a-z0-9.-]{0,127}$/.test(geminiModel)) throw new Error("GEMINI_MODEL is invalid");
  const databaseBackend = env.DATABASE_BACKEND?.trim() || (nodeEnv === "production" ? "firestore" : "sqlite");
  if (databaseBackend !== "sqlite" && databaseBackend !== "firestore") throw new Error("DATABASE_BACKEND must be sqlite or firestore");
  const resendFromEmail = env.RESEND_FROM_EMAIL?.trim() || null;
  if (resendFromEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resendFromEmail)) throw new Error("RESEND_FROM_EMAIL is invalid");
  const shopImageBucket = env.SHOP_IMAGE_BUCKET?.trim() || null;
  if (shopImageBucket && !/^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/.test(shopImageBucket)) throw new Error("SHOP_IMAGE_BUCKET is invalid");

  return {
    nodeEnv,
    port,
    appOrigin: parseOrigin(env.APP_ORIGIN),
    eventName: "Little Harbor Market",
    eventTimeZone: timeZone,
    currency: "JPY",
    databaseBackend,
    databasePath: env.DATABASE_PATH?.trim() || path.resolve(process.cwd(), ".data/yatalk.sqlite"),
    paypalMode: "sandbox",
    paypalClientId: optionalSecret(env.PAYPAL_CLIENT_ID),
    paypalClientSecret: optionalSecret(env.PAYPAL_CLIENT_SECRET),
    paypalWebhookId: optionalSecret(env.PAYPAL_WEBHOOK_ID),
    googleCloudProject,
    googleCloudLocation,
    geminiModel,
    adminAccessCode,
    adminSessionSecret,
    resendApiKey: optionalSecret(env.RESEND_API_KEY),
    resendFromEmail,
    shopImageBucket,
  };
}
