import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, ProviderError } from "../../server/errors.js";
import { logStage } from "../../server/logging.js";

function loggedRecord(write: () => void): Record<string, unknown> {
  const original = console.info;
  let line = "";
  console.info = (...values: unknown[]) => { line = values.map(String).join(" "); };
  try { write(); }
  finally { console.info = original; }
  return JSON.parse(line) as Record<string, unknown>;
}

test("stage logs include bounded API error context without messages or details", () => {
  const record = loggedRecord(() => logStage("request-123", "paypal_webhook_verification", "failure",
    new ApiError(500, "webhook_reconciliation_failed", "Sensitive payload must not be logged.", { token: "private" })));
  assert.equal(record.correlationId, "request-123");
  assert.equal(record.errorClass, "ApiError");
  assert.equal(record.errorCode, "webhook_reconciliation_failed");
  assert.equal(record.errorStatus, 500);
  assert.equal(record.message, undefined);
  assert.equal(record.details, undefined);
  assert.equal(JSON.stringify(record).includes("Sensitive payload"), false);
  assert.equal(JSON.stringify(record).includes("private"), false);
});

test("provider stage logs exclude provider error messages", () => {
  const record = loggedRecord(() => logStage("request-456", "gemini_transcription", "failure",
    new ProviderError("gemini", "transcription", false, 502)));
  assert.equal(record.provider, "gemini");
  assert.equal(record.providerStage, "transcription");
  assert.equal(record.providerHttpStatus, 502);
  assert.equal(record.providerDefinite, false);
  assert.equal(record.message, undefined);
});

test("stage logs can include safe boolean diagnostics without values", () => {
  const record = loggedRecord(() => logStage("request-789", "paypal_capture_verification", "failure",
    new ApiError(502, "payment_verification_failed"), { amountMatches: false, orderCompleted: true }));
  assert.equal(record.amountMatches, false);
  assert.equal(record.orderCompleted, true);
  assert.equal(JSON.stringify(record).includes("paypal_order_id"), false);
});
