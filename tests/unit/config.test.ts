import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../../server/config.js";

test("runtime configuration fixes the demo to PayPal sandbox and JPY", () => {
  const base = { NODE_ENV: "test", APP_ORIGIN: "http://127.0.0.1:5173" };
  const config = loadConfig(base);
  assert.equal(config.paypalMode, "sandbox");
  assert.equal(config.currency, "JPY");
  assert.equal(config.databaseBackend, "sqlite");
  assert.equal(config.googleCloudProject, null);
  assert.equal(config.googleCloudLocation, "global");
  assert.equal(config.geminiModel, "gemini-3.5-flash-lite");
  assert.equal(config.resendApiKey, null);
  assert.equal(config.resendFromEmail, null);
  assert.equal(loadConfig({ ...base, RESEND_API_KEY: "resend-test", RESEND_FROM_EMAIL: "owner@example.test" }).resendFromEmail, "owner@example.test");
  assert.throws(() => loadConfig({ ...base, RESEND_FROM_EMAIL: "not-an-email" }), /RESEND_FROM_EMAIL is invalid/);
  assert.throws(() => loadConfig({ ...base, GOOGLE_CLOUD_PROJECT: "bad/project" }), /GOOGLE_CLOUD_PROJECT is invalid/);
  assert.equal(loadConfig({ ...base, GOOGLE_CLOUD_PROJECT: "s-yatalk", GOOGLE_CLOUD_LOCATION: "global" }).googleCloudProject, "s-yatalk");
  assert.throws(() => loadConfig({ ...base, PAYPAL_MODE: "live" }), /PAYPAL_MODE must be sandbox/);
  assert.equal(loadConfig({ ...base, DATABASE_BACKEND: "firestore" }).databaseBackend, "firestore");
  assert.throws(() => loadConfig({ ...base, DATABASE_BACKEND: "mysql" }), /DATABASE_BACKEND must be sqlite or firestore/);
  assert.equal(loadConfig({ NODE_ENV: "production", APP_ORIGIN: "https://yatalk.kumagaias.com", GOOGLE_CLOUD_PROJECT: "s-yatalk" }).databaseBackend, "firestore");
  assert.equal(loadConfig({ ...base, PAYPAL_CURRENCY: "USD" }).currency, "JPY");
  assert.throws(() => loadConfig({ ...base, ADMIN_SESSION_SECRET: "too-short" }), /at least 32 bytes/);
  assert.throws(() => loadConfig({ ...base, ADMIN_ACCESS_CODE: "weak-code" }), /at least 16 characters/);
  assert.throws(() => loadConfig({ ...base, ADMIN_ACCESS_CODE: "x".repeat(129) }), /no more than 128 characters/);
  assert.equal(loadConfig({ ...base, ADMIN_ACCESS_CODE: "a-long-random-passphrase" }).adminAccessCode, "a-long-random-passphrase");
});
