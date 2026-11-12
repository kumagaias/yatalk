import assert from "node:assert/strict";
import test from "node:test";
import { kioskApprovalQrUrl } from "../../src/lib/checkout-display.js";

test("only a counter kiosk displays a PayPal approval QR code", () => {
  const approvalUrl = "https://www.sandbox.paypal.com/checkoutnow?token=example";
  assert.equal(kioskApprovalQrUrl(true, approvalUrl), approvalUrl);
  assert.equal(kioskApprovalQrUrl(false, approvalUrl), null);
  assert.equal(kioskApprovalQrUrl(true, "https://paypal.example/checkout"), null);
});
