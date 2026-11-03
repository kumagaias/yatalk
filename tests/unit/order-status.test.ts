import assert from "node:assert/strict";
import test from "node:test";
import { isReceiptReady } from "../../src/lib/order-status.js";

test("paid and collected orders both retain a customer pickup receipt", () => {
  assert.equal(isReceiptReady("paid", "1A2B3C4D"), true);
  assert.equal(isReceiptReady("collected", "1A2B3C4D"), true);
  assert.equal(isReceiptReady("capture_unknown", "1A2B3C4D"), false);
  assert.equal(isReceiptReady("paid", null), false);
});
