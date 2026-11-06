import assert from "node:assert/strict";
import test from "node:test";
import { FakePayPal, json, postHeaders, visitorSession, withServer } from "./support.js";

test("overlapping retries of an uncertain create share one provider operation", async () => {
  const paypal = new FakePayPal();
  paypal.failFirstCreate = true;
  const create = paypal.createOrder.bind(paypal);
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { entered = resolve; });
  let providerCalls = 0;
  paypal.createOrder = async (input) => {
    providerCalls += 1;
    if (providerCalls === 2) {
      entered();
      await gate;
    }
    return create(input);
  };
  await withServer(paypal, async (url) => {
    const visitor = await visitorSession(url);
    const added = await json(`${url}/api/cart/items`, { method: "POST", headers: postHeaders(visitor.cookie),
      body: JSON.stringify({ action: "add", productId: "iced-tea", quantity: 1, cartVersion: 0, catalogRevision: visitor.cart.catalogRevision }) });
    const payload = { cartVersion: added.body.cartVersion, catalogRevision: added.body.catalogRevision,
      clientRequestKey: "00000000-0000-4000-8000-000000000099" };
    const submit = () => json(`${url}/api/orders`, { method: "POST", headers: postHeaders(visitor.cookie), body: JSON.stringify(payload) });
    const initial = await submit();
    assert.equal(initial.body.state, "create_unknown");
    const retry = submit();
    await started;
    try {
      const overlapping = await submit();
      assert.equal(overlapping.response.status, 202);
      assert.equal(overlapping.body.state, "create_unknown");
      assert.equal(providerCalls, 2);
    } finally {
      release();
      const completed = await retry;
      assert.equal(completed.response.status, 200);
    }
    const saved = await submit();
    assert.equal(saved.response.status, 200);
    assert.equal(providerCalls, 2);
    assert.equal(paypal.createCalls[0]?.requestId, paypal.createCalls[1]?.requestId);
    const receipt = await json(`${url}/api/orders/${initial.body.orderId}`, { headers: { cookie: visitor.cookie } });
    assert.equal(receipt.body.state, "pending_payment");
  });
});
