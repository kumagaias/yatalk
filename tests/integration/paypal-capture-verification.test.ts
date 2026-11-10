import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { FakePayPal, json, postHeaders, visitorSession, withServer } from "./support.js";

test("capture verification accepts omitted optional PayPal references and rejects conflicts", async () => {
  const scenarios: Array<{ name: string; expectedStatus: number; omit?: boolean; referenceId?: string; customId?: string }> = [
    { name: "omitted references", expectedStatus: 200, omit: true },
    { name: "conflicting references", expectedStatus: 502, referenceId: "other-order", customId: "other-order" },
  ];
  for (const scenario of scenarios) {
    const paypal = new FakePayPal();
    paypal.omitOrderReferences = scenario.omit ?? false;
    paypal.referenceIdOverride = scenario.referenceId ?? null;
    paypal.customIdOverride = scenario.customId ?? null;
    await withServer(paypal, async (url) => {
      const visitor = await visitorSession(url);
      const added = await json(`${url}/api/cart/items`, {
        method: "POST", headers: postHeaders(visitor.cookie),
        body: JSON.stringify({ action: "add", productId: "yakisoba", quantity: 1, cartVersion: 0, catalogRevision: visitor.cart.catalogRevision }),
      });
      const created = await json(`${url}/api/orders`, {
        method: "POST", headers: postHeaders(visitor.cookie),
        body: JSON.stringify({ cartVersion: added.body.cartVersion, catalogRevision: added.body.catalogRevision,
          clientRequestKey: randomUUID() }),
      });
      const captured = await json(`${url}/api/orders/${created.body.orderId}/capture`, {
        method: "POST", headers: postHeaders(visitor.cookie), body: "{}",
      });
      assert.equal(captured.response.status, scenario.expectedStatus, scenario.name);
      if (scenario.expectedStatus === 200) assert.equal(captured.body.state, "paid");
      else assert.equal(captured.body.error.code, "payment_verification_failed");
    });
  }
});
