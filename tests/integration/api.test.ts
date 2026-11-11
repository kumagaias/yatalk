import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { FakePayPal, json, origin, postHeaders, visitorSession, withServer } from "./support.js";

test("browser writes require the exact origin and order GET remains read-only", async () => {
  const paypal = new FakePayPal();
  await withServer(paypal, async (url) => {
    const visitor = await visitorSession(url);
    const wrongOrigin = await json(`${url}/api/cart/items`, { method: "POST", headers: { ...postHeaders(visitor.cookie), origin: "https://attacker.example" },
      body: JSON.stringify({ action: "add", productId: "yakisoba", quantity: 1, cartVersion: 0, catalogRevision: visitor.cart.catalogRevision }) });
    assert.equal(wrongOrigin.response.status, 403);

    for (const invalid of [
      { action: "set", quantity: 0 },
      { action: "remove", quantity: 1 },
    ]) {
      const response = await json(`${url}/api/cart/items`, { method: "POST", headers: postHeaders(visitor.cookie),
        body: JSON.stringify({ ...invalid, productId: "yakisoba", cartVersion: 0, catalogRevision: visitor.cart.catalogRevision }) });
      assert.equal(response.response.status, 400);
    }

    const added = await json(`${url}/api/cart/items`, { method: "POST", headers: postHeaders(visitor.cookie),
      body: JSON.stringify({ action: "add", productId: "yakisoba", quantity: 2, cartVersion: 0, catalogRevision: visitor.cart.catalogRevision }) });
    assert.equal(added.response.status, 200);
    assert.equal(added.body.totalMinor, 1500);
    const deleteWithUnknownFields = await json(`${url}/api/cart`, { method: "DELETE", headers: postHeaders(visitor.cookie), body: JSON.stringify({ unexpected: true }) });
    assert.equal(deleteWithUnknownFields.response.status, 400);

    const payload = { cartVersion: added.body.cartVersion, catalogRevision: added.body.catalogRevision, clientRequestKey: "00000000-0000-4000-8000-000000000001" };
    const created = await json(`${url}/api/orders`, { method: "POST", headers: postHeaders(visitor.cookie), body: JSON.stringify(payload) });
    assert.equal(created.response.status, 201);
    assert.equal(paypal.createCalls.length, 1);
    const duplicate = await json(`${url}/api/orders`, { method: "POST", headers: postHeaders(visitor.cookie), body: JSON.stringify(payload) });
    assert.equal(duplicate.response.status, 200);
    assert.equal(paypal.createCalls.length, 1);

    const beforeReads = { create: paypal.createCalls.length, capture: paypal.captureCalls.length, refund: paypal.refundCalls.length };
    const receipt = await json(`${url}/api/orders/${created.body.orderId}`, { headers: { cookie: visitor.cookie } });
    assert.equal(receipt.body.state, "pending_payment");
    await json(`${url}/api/config`);
    await json(`${url}/api/menu`);
    assert.deepEqual({ create: paypal.createCalls.length, capture: paypal.captureCalls.length, refund: paypal.refundCalls.length }, beforeReads);

    const captured = await json(`${url}/api/orders/${created.body.orderId}/capture`, { method: "POST", headers: postHeaders(visitor.cookie), body: "{}" });
    assert.equal(captured.response.status, 200);
    assert.equal(captured.body.state, "paid");
    assert.equal(paypal.captureCalls.length, 1);
    const repeated = await json(`${url}/api/orders/${created.body.orderId}/capture`, { method: "POST", headers: postHeaders(visitor.cookie), body: "{}" });
    assert.equal(repeated.body.state, "paid");
    assert.equal(paypal.captureCalls.length, 1);
    const cartAfterCapture = await json(`${url}/api/cart`, { headers: { cookie: visitor.cookie } });
    assert.deepEqual(cartAfterCapture.body.items, []);
    assert.equal(cartAfterCapture.body.totalMinor, 0);
    assert.equal(cartAfterCapture.body.cartVersion, added.body.cartVersion + 1);
  });
});

test("untyped API request bodies are still subject to the JSON route size limit", async () => {
  await withServer(new FakePayPal(), async (url) => {
    const oversized = await fetch(`${url}/api/cart/items`, { method: "POST", headers: { origin }, body: new Uint8Array(32 * 1024 + 1) });
    assert.equal(oversized.status, 413);
  });
});

test("capture preserves a visitor cart edited while PayPal checkout was pending", async () => {
  const paypal = new FakePayPal();
  await withServer(paypal, async (url) => {
    const visitor = await visitorSession(url);
    const added = await json(`${url}/api/cart/items`, { method: "POST", headers: postHeaders(visitor.cookie),
      body: JSON.stringify({ action: "add", productId: "yakisoba", quantity: 2, cartVersion: 0, catalogRevision: visitor.cart.catalogRevision }) });
    const created = await json(`${url}/api/orders`, { method: "POST", headers: postHeaders(visitor.cookie),
      body: JSON.stringify({ cartVersion: added.body.cartVersion, catalogRevision: added.body.catalogRevision, clientRequestKey: "00000000-0000-4000-8000-000000000002" }) });

    const current = await json(`${url}/api/cart`, { headers: { cookie: visitor.cookie } });
    const edited = await json(`${url}/api/cart/items`, { method: "POST", headers: postHeaders(visitor.cookie),
      body: JSON.stringify({ action: "add", productId: "ramune", quantity: 1,
        cartVersion: current.body.cartVersion, catalogRevision: current.body.catalogRevision }) });
    assert.equal(edited.response.status, 200);

    const captured = await json(`${url}/api/orders/${created.body.orderId}/capture`, { method: "POST", headers: postHeaders(visitor.cookie), body: "{}" });
    assert.equal(captured.response.status, 200);
    assert.equal(captured.body.state, "paid");
    const cartAfterCapture = await json(`${url}/api/cart`, { headers: { cookie: visitor.cookie } });
    assert.equal(cartAfterCapture.body.cartVersion, edited.body.cartVersion);
    assert.deepEqual(cartAfterCapture.body.items.map((item: { id: string; quantity: number }) => ({ id: item.id, quantity: item.quantity })), [
      { id: "ramune", quantity: 1 }, { id: "yakisoba", quantity: 2 },
    ]);
  });
});

test("cart bootstrap is rate limited before it can create unbounded visitor sessions", async () => {
  const paypal = new FakePayPal();
  await withServer(paypal, async (url, db) => {
    let lastStatus = 0;
    for (let index = 0; index < 61; index += 1) {
      lastStatus = (await fetch(`${url}/api/cart`)).status;
    }
    assert.equal(lastStatus, 429);
    const sessions = db.prepare("SELECT COUNT(*) AS count FROM visitor_sessions").get() as { count: number };
    assert.equal(sessions.count, 60);
  });
});

test("organizer authentication gates summary and full refund follows saved restock choice", async () => {
  const paypal = new FakePayPal();
  await withServer(paypal, async (url) => {
    const visitor = await visitorSession(url);
    const added = await json(`${url}/api/cart/items`, { method: "POST", headers: postHeaders(visitor.cookie),
      body: JSON.stringify({ action: "add", productId: "yakisoba", quantity: 1, cartVersion: 0, catalogRevision: visitor.cart.catalogRevision }) });
    const created = await json(`${url}/api/orders`, { method: "POST", headers: postHeaders(visitor.cookie),
      body: JSON.stringify({ cartVersion: added.body.cartVersion, catalogRevision: added.body.catalogRevision, clientRequestKey: "00000000-0000-4000-8000-000000000003" }) });
    await json(`${url}/api/orders/${created.body.orderId}/capture`, { method: "POST", headers: postHeaders(visitor.cookie), body: "{}" });

    const unauthorized = await json(`${url}/api/organizer/summary`);
    assert.equal(unauthorized.response.status, 401);
    const login = await fetch(`${url}/api/organizer/session`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ accessCode: "local-test-code!!" }) });
    assert.equal(login.status, 204);
    const adminCookie = login.headers.get("set-cookie")!.split(";", 1)[0]!;
    const before = await json(`${url}/api/organizer/summary`, { headers: { cookie: adminCookie } });
    assert.equal(before.body.metrics.grossSalesMinor, 750);
    assert.equal(before.body.orders[0].pickupCode, (await json(`${url}/api/orders/${created.body.orderId}`, { headers: { cookie: visitor.cookie } })).body.pickupCode);

    const refunded = await json(`${url}/api/organizer/orders/${created.body.orderId}/refund`, { method: "POST",
      headers: postHeaders(adminCookie), body: JSON.stringify({ restock: true }) });
    assert.equal(refunded.response.status, 200);
    assert.equal(refunded.body.restocked, true);
    assert.equal(paypal.refundCalls.length, 1);
    const detail = await json(`${url}/api/organizer/orders/${created.body.orderId}`, { headers: { cookie: adminCookie } });
    assert.equal(detail.body.refundRestockRequested, true);
    assert.equal(detail.body.state, "refunded");
    const summary = await json(`${url}/api/organizer/summary`, { headers: { cookie: adminCookie } });
    assert.equal(summary.body.products.find((item: { id: string }) => item.id === "yakisoba").stockOnHand, 24);
    assert.equal("pickupCode" in summary.body.orders[0], false);
  });
});

test("uncertain create retries the saved operation with its stable PayPal request ID", async () => {
  const paypal = new FakePayPal();
  paypal.failFirstCreate = true;
  await withServer(paypal, async (url) => {
    const visitor = await visitorSession(url);
    const added = await json(`${url}/api/cart/items`, { method: "POST", headers: postHeaders(visitor.cookie),
      body: JSON.stringify({ action: "add", productId: "iced-tea", quantity: 1, cartVersion: 0, catalogRevision: visitor.cart.catalogRevision }) });
    const payload = { cartVersion: added.body.cartVersion, catalogRevision: added.body.catalogRevision, clientRequestKey: "00000000-0000-4000-8000-000000000004" };
    const first = await json(`${url}/api/orders`, { method: "POST", headers: postHeaders(visitor.cookie), body: JSON.stringify(payload) });
    assert.equal(first.response.status, 202);
    assert.equal(first.body.state, "create_unknown");
    const second = await json(`${url}/api/orders`, { method: "POST", headers: postHeaders(visitor.cookie), body: JSON.stringify(payload) });
    assert.equal(second.response.status, 200);
    assert.equal(paypal.createCalls.length, 2);
    assert.equal(paypal.createCalls[0]?.requestId, paypal.createCalls[1]?.requestId);
  });
});

test("capture timeout retries with its saved request ID and amount mismatches remain unconfirmed", async () => {
  const paypal = new FakePayPal();
  paypal.failFirstCapture = true;
  await withServer(paypal, async (url) => {
    const visitor = await visitorSession(url);
    const added = await json(`${url}/api/cart/items`, { method: "POST", headers: postHeaders(visitor.cookie),
      body: JSON.stringify({ action: "add", productId: "iced-tea", quantity: 1, cartVersion: 0, catalogRevision: visitor.cart.catalogRevision }) });
    const created = await json(`${url}/api/orders`, { method: "POST", headers: postHeaders(visitor.cookie),
      body: JSON.stringify({ cartVersion: added.body.cartVersion, catalogRevision: added.body.catalogRevision, clientRequestKey: "00000000-0000-4000-8000-000000000005" }) });
    const first = await json(`${url}/api/orders/${created.body.orderId}/capture`, { method: "POST", headers: postHeaders(visitor.cookie), body: "{}" });
    assert.equal(first.response.status, 202);
    assert.equal(first.body.state, "capture_unknown");
    const second = await json(`${url}/api/orders/${created.body.orderId}/capture`, { method: "POST", headers: postHeaders(visitor.cookie), body: "{}" });
    assert.equal(second.body.state, "paid");
    assert.equal(paypal.captureRequestIds.length, 2);
    assert.equal(paypal.captureRequestIds[0], paypal.captureRequestIds[1]);
  });

  const mismatchPaypal = new FakePayPal();
  mismatchPaypal.mismatchAmount = true;
  await withServer(mismatchPaypal, async (url) => {
    const visitor = await visitorSession(url);
    const added = await json(`${url}/api/cart/items`, { method: "POST", headers: postHeaders(visitor.cookie),
      body: JSON.stringify({ action: "add", productId: "iced-tea", quantity: 1, cartVersion: 0, catalogRevision: visitor.cart.catalogRevision }) });
    const created = await json(`${url}/api/orders`, { method: "POST", headers: postHeaders(visitor.cookie),
      body: JSON.stringify({ cartVersion: added.body.cartVersion, catalogRevision: added.body.catalogRevision, clientRequestKey: "00000000-0000-4000-8000-000000000006" }) });
    const mismatch = await json(`${url}/api/orders/${created.body.orderId}/capture`, { method: "POST", headers: postHeaders(visitor.cookie), body: "{}" });
    assert.equal(mismatch.response.status, 502);
    const stored = await json(`${url}/api/orders/${created.body.orderId}`, { headers: { cookie: visitor.cookie } });
    assert.equal(stored.body.state, "capture_unknown");
    assert.equal(mismatchPaypal.captureCalls.length, 0);
  });
});

test("refund retry reuses the original request ID and restock choice", async () => {
  const paypal = new FakePayPal();
  paypal.failFirstRefund = true;
  await withServer(paypal, async (url) => {
    const visitor = await visitorSession(url);
    const added = await json(`${url}/api/cart/items`, { method: "POST", headers: postHeaders(visitor.cookie),
      body: JSON.stringify({ action: "add", productId: "ramune", quantity: 1, cartVersion: 0, catalogRevision: visitor.cart.catalogRevision }) });
    const created = await json(`${url}/api/orders`, { method: "POST", headers: postHeaders(visitor.cookie),
      body: JSON.stringify({ cartVersion: added.body.cartVersion, catalogRevision: added.body.catalogRevision, clientRequestKey: "00000000-0000-4000-8000-000000000007" }) });
    await json(`${url}/api/orders/${created.body.orderId}/capture`, { method: "POST", headers: postHeaders(visitor.cookie), body: "{}" });
    const login = await fetch(`${url}/api/organizer/session`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ accessCode: "local-test-code!!" }) });
    const adminCookie = login.headers.get("set-cookie")!.split(";", 1)[0]!;
    const refundPath = `${url}/api/organizer/orders/${created.body.orderId}/refund`;
    const first = await json(refundPath, { method: "POST", headers: postHeaders(adminCookie), body: JSON.stringify({ restock: true }) });
    assert.equal(first.response.status, 202);
    const conflictingChoice = await json(refundPath, { method: "POST", headers: postHeaders(adminCookie), body: JSON.stringify({ restock: false }) });
    assert.equal(conflictingChoice.response.status, 409);
    const retry = await json(refundPath, { method: "POST", headers: postHeaders(adminCookie), body: JSON.stringify({ restock: true }) });
    assert.equal(retry.body.state, "refunded");
    assert.equal(paypal.refundRequestIds.length, 2);
    assert.equal(paypal.refundRequestIds[0], paypal.refundRequestIds[1]);
  });
});

test("PayPal webhook postback verification rejects bad signatures and acknowledges duplicate verified events", async () => {
  const paypal = new FakePayPal();
  await withServer(paypal, async (url) => {
    const headers = { "content-type": "application/json", "paypal-auth-algo": "test", "paypal-cert-url": "https://example.test/cert",
      "paypal-transmission-id": "tx1", "paypal-transmission-sig": "sig", "paypal-transmission-time": "now" };
    const payload = JSON.stringify({ id: "event-1", event_type: "OTHER.EVENT", resource: {} });
    paypal.allowWebhook = false;
    const rejected = await fetch(`${url}/api/webhooks/paypal`, { method: "POST", headers, body: payload });
    assert.equal(rejected.status, 400);
    paypal.failWebhookVerification = true;
    const temporaryFailure = await fetch(`${url}/api/webhooks/paypal`, { method: "POST", headers, body: payload });
    assert.equal(temporaryFailure.status, 500);
    paypal.failWebhookVerification = false;
    paypal.allowWebhook = true;
    const first = await fetch(`${url}/api/webhooks/paypal`, { method: "POST", headers, body: payload });
    const duplicate = await fetch(`${url}/api/webhooks/paypal`, { method: "POST", headers, body: payload });
    assert.equal(first.status, 204);
    assert.equal(duplicate.status, 204);
    assert.equal(paypal.verifyCalls, 4);

    const oversizedWithoutContentType = await fetch(`${url}/api/webhooks/paypal`, { method: "POST", body: new Uint8Array(64 * 1024 + 1) });
    assert.equal(oversizedWithoutContentType.status, 413);
  });
});

test("state-changing order and organizer routes reject foreign origins", async () => {
  const paypal = new FakePayPal();
  await withServer(paypal, async (url) => {
    const visitor = await visitorSession(url);
    const added = await json(`${url}/api/cart/items`, { method: "POST", headers: postHeaders(visitor.cookie),
      body: JSON.stringify({ action: "add", productId: "yakisoba", quantity: 1, cartVersion: 0, catalogRevision: visitor.cart.catalogRevision }) });
    const orderBody = { cartVersion: added.body.cartVersion, catalogRevision: added.body.catalogRevision,
      clientRequestKey: "00000000-0000-4000-8000-000000000008" };

    const deniedCreate = await json(`${url}/api/orders`, { method: "POST", headers: { ...postHeaders(visitor.cookie), origin: "https://attacker.example" }, body: JSON.stringify(orderBody) });
    assert.equal(deniedCreate.response.status, 403);
    assert.equal(paypal.createCalls.length, 0);
    const created = await json(`${url}/api/orders`, { method: "POST", headers: postHeaders(visitor.cookie), body: JSON.stringify(orderBody) });

    const deniedCapture = await json(`${url}/api/orders/${created.body.orderId}/capture`, { method: "POST",
      headers: { ...postHeaders(visitor.cookie), origin: "https://attacker.example" }, body: "{}" });
    assert.equal(deniedCapture.response.status, 403);
    assert.equal(paypal.captureCalls.length, 0);
    const captured = await json(`${url}/api/orders/${created.body.orderId}/capture`, { method: "POST", headers: postHeaders(visitor.cookie), body: "{}" });

    const deniedLogin = await json(`${url}/api/organizer/session`, { method: "POST",
      headers: { origin: "https://attacker.example", "content-type": "application/json" }, body: JSON.stringify({ accessCode: "local-test-code!!" }) });
    assert.equal(deniedLogin.response.status, 403);
    const login = await fetch(`${url}/api/organizer/session`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ accessCode: "local-test-code!!" }) });
    const adminCookie = login.headers.get("set-cookie")!.split(";", 1)[0]!;
    for (const path of [
      `/api/organizer/products/yakisoba`,
      `/api/organizer/orders/${created.body.orderId}/collect`,
      `/api/organizer/orders/${created.body.orderId}/refund`,
    ]) {
      const denied = await json(`${url}${path}`, { method: path.includes("products/") ? "PATCH" : "POST",
        headers: { ...postHeaders(adminCookie), origin: "https://attacker.example" }, body: path.includes("products/") ? JSON.stringify({ available: false }) : path.endsWith("/refund") ? JSON.stringify({ restock: true }) : "{}" });
      assert.equal(denied.response.status, 403);
    }
    assert.equal(captured.body.state, "paid");
    assert.equal(paypal.refundCalls.length, 0);
  });
});

test("verified capture and refund webhooks reconcile once and apply the saved restock choice", async () => {
  const paypal = new FakePayPal();
  paypal.failFirstRefund = true;
  await withServer(paypal, async (url, db) => {
    const visitor = await visitorSession(url);
    const added = await json(`${url}/api/cart/items`, { method: "POST", headers: postHeaders(visitor.cookie),
      body: JSON.stringify({ action: "add", productId: "taiyaki", quantity: 1, cartVersion: 0, catalogRevision: visitor.cart.catalogRevision }) });
    const created = await json(`${url}/api/orders`, { method: "POST", headers: postHeaders(visitor.cookie),
      body: JSON.stringify({ cartVersion: added.body.cartVersion, catalogRevision: added.body.catalogRevision, clientRequestKey: "00000000-0000-4000-8000-000000000009" }) });
    const webhookHeaders = { "content-type": "application/json", "paypal-auth-algo": "test", "paypal-cert-url": "https://example.test/cert",
      "paypal-transmission-id": "tx1", "paypal-transmission-sig": "sig", "paypal-transmission-time": "now" };
    const captureEvent = { id: "capture-event", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: {
      id: `CAPTURE-${created.body.orderId}`, status: "COMPLETED", amount: { currency_code: "JPY", value: "450" },
      supplementary_data: { related_ids: { order_id: created.body.paypalOrderId } },
    } };
    for (let count = 0; count < 2; count += 1) {
      const response = await fetch(`${url}/api/webhooks/paypal`, { method: "POST", headers: webhookHeaders, body: JSON.stringify(captureEvent) });
      assert.equal(response.status, 204);
    }
    assert.equal((await json(`${url}/api/orders/${created.body.orderId}`, { headers: { cookie: visitor.cookie } })).body.state, "paid");
    assert.equal((db.prepare("SELECT stock_on_hand FROM products WHERE id = 'taiyaki'").get() as { stock_on_hand: number }).stock_on_hand, 14);
    const mismatchedCapture = { ...captureEvent, id: "mismatched-capture-event", resource: { ...captureEvent.resource, id: "CAPTURE-WRONG" } };
    const mismatchResponse = await fetch(`${url}/api/webhooks/paypal`, { method: "POST", headers: webhookHeaders, body: JSON.stringify(mismatchedCapture) });
    assert.equal(mismatchResponse.status, 500);
    assert.equal(db.prepare("SELECT 1 FROM webhook_events WHERE id = 'mismatched-capture-event'").get(), undefined);

    const login = await fetch(`${url}/api/organizer/session`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ accessCode: "local-test-code!!" }) });
    const adminCookie = login.headers.get("set-cookie")!.split(";", 1)[0]!;
    const refund = await json(`${url}/api/organizer/orders/${created.body.orderId}/refund`, { method: "POST", headers: postHeaders(adminCookie), body: JSON.stringify({ restock: true }) });
    assert.equal(refund.response.status, 202);
    const captureDuringRefund = { ...captureEvent, id: "capture-event-during-refund" };
    const duringRefundResponse = await fetch(`${url}/api/webhooks/paypal`, { method: "POST", headers: webhookHeaders, body: JSON.stringify(captureDuringRefund) });
    assert.equal(duringRefundResponse.status, 204);
    assert.equal((await json(`${url}/api/organizer/orders/${created.body.orderId}`, { headers: { cookie: adminCookie } })).body.state, "refund_unknown");
    const refundEvent = { id: "refund-event", event_type: "PAYMENT.CAPTURE.REFUNDED", resource: {
      id: `REFUND-CAPTURE-${created.body.orderId}`, status: "COMPLETED", amount: { currency_code: "JPY", value: "450" },
      supplementary_data: { related_ids: { capture_id: `CAPTURE-${created.body.orderId}` } },
    } };
    for (let count = 0; count < 2; count += 1) {
      const response = await fetch(`${url}/api/webhooks/paypal`, { method: "POST", headers: webhookHeaders, body: JSON.stringify(refundEvent) });
      assert.equal(response.status, 204);
    }
    assert.equal((db.prepare("SELECT stock_on_hand FROM products WHERE id = 'taiyaki'").get() as { stock_on_hand: number }).stock_on_hand, 15);
    assert.equal((await json(`${url}/api/organizer/orders/${created.body.orderId}`, { headers: { cookie: adminCookie } })).body.state, "refunded");
    const captureAfterRefund = { ...captureEvent, id: "capture-event-after-refund" };
    const afterRefundResponse = await fetch(`${url}/api/webhooks/paypal`, { method: "POST", headers: webhookHeaders, body: JSON.stringify(captureAfterRefund) });
    assert.equal(afterRefundResponse.status, 204);
    assert.equal((await json(`${url}/api/organizer/orders/${created.body.orderId}`, { headers: { cookie: adminCookie } })).body.state, "refunded");
  });
});

test("a verified PayPal approval webhook captures once and issues a pickup number", async () => {
  const paypal = new FakePayPal();
  await withServer(paypal, async (url) => {
    const visitor = await visitorSession(url);
    const added = await json(`${url}/api/cart/items`, { method: "POST", headers: postHeaders(visitor.cookie),
      body: JSON.stringify({ action: "add", productId: "iced-tea", quantity: 1, cartVersion: 0, catalogRevision: visitor.cart.catalogRevision }) });
    const created = await json(`${url}/api/orders`, { method: "POST", headers: postHeaders(visitor.cookie),
      body: JSON.stringify({ cartVersion: added.body.cartVersion, catalogRevision: added.body.catalogRevision, clientRequestKey: "00000000-0000-4000-8000-000000000099" }) });
    const headers = { "content-type": "application/json", "paypal-auth-algo": "test", "paypal-cert-url": "https://example.test/cert",
      "paypal-transmission-id": "approval-tx", "paypal-transmission-sig": "sig", "paypal-transmission-time": "now" };
    const approved = { id: "approval-event", event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: created.body.paypalOrderId } };
    assert.equal((await fetch(`${url}/api/webhooks/paypal`, { method: "POST", headers, body: JSON.stringify(approved) })).status, 204);
    assert.equal((await fetch(`${url}/api/webhooks/paypal`, { method: "POST", headers, body: JSON.stringify(approved) })).status, 204);
    const receipt = await json(`${url}/api/orders/${created.body.orderId}`, { headers: { cookie: visitor.cookie } });
    assert.equal(receipt.body.state, "paid");
    assert.match(receipt.body.pickupCode, /^\d{3}$/);
    assert.deepEqual(paypal.captureCalls, [created.body.paypalOrderId]);
  });
});

test("capture reservation cannot expire while PayPal status is being checked", async () => {
  const paypal = new FakePayPal();
  let markReadStarted!: () => void;
  let releaseRead!: () => void;
  const readStarted = new Promise<void>((resolve) => { markReadStarted = resolve; });
  paypal.getOrderGate = new Promise<void>((resolve) => { releaseRead = resolve; });
  paypal.onGetOrder = () => markReadStarted();
  await withServer(paypal, async (url, db) => {
    const visitor = await visitorSession(url);
    const added = await json(`${url}/api/cart/items`, { method: "POST", headers: postHeaders(visitor.cookie),
      body: JSON.stringify({ action: "add", productId: "yakisoba", quantity: 1, cartVersion: 0, catalogRevision: visitor.cart.catalogRevision }) });
    const payload = { cartVersion: added.body.cartVersion, catalogRevision: added.body.catalogRevision, clientRequestKey: "00000000-0000-4000-8000-000000000010" };
    const created = await json(`${url}/api/orders`, { method: "POST", headers: postHeaders(visitor.cookie), body: JSON.stringify(payload) });
    const capture = json(`${url}/api/orders/${created.body.orderId}/capture`, { method: "POST", headers: postHeaders(visitor.cookie), body: "{}" });
    await readStarted;
    db.prepare("UPDATE orders SET expires_at = ? WHERE id = ?").run(new Date(Date.now() - 1_000).toISOString(), created.body.orderId);
    const otherVisitor = await visitorSession(url);
    const expirySweep = await json(`${url}/api/orders`, { method: "POST", headers: postHeaders(otherVisitor.cookie),
      body: JSON.stringify({ cartVersion: 0, catalogRevision: 0, clientRequestKey: "00000000-0000-4000-8000-000000000011" }) });
    assert.equal(expirySweep.response.status, 409);
    assert.equal((db.prepare("SELECT state FROM orders WHERE id = ?").get(created.body.orderId) as { state: string }).state, "capture_unknown");
    releaseRead();
    const captured = await capture;
    assert.equal(captured.body.state, "paid");
  });
});

test("parallel capture retries share one PayPal verification and capture request", async () => {
  const paypal = new FakePayPal();
  let markReadStarted!: () => void;
  let releaseRead!: () => void;
  const readStarted = new Promise<void>((resolve) => { markReadStarted = resolve; });
  paypal.getOrderGate = new Promise<void>((resolve) => { releaseRead = resolve; });
  paypal.onGetOrder = () => markReadStarted();

  await withServer(paypal, async (url) => {
    const visitor = await visitorSession(url);
    const added = await json(`${url}/api/cart/items`, { method: "POST", headers: postHeaders(visitor.cookie),
      body: JSON.stringify({ action: "add", productId: "yakisoba", quantity: 1, cartVersion: 0, catalogRevision: visitor.cart.catalogRevision }) });
    const created = await json(`${url}/api/orders`, { method: "POST", headers: postHeaders(visitor.cookie),
      body: JSON.stringify({ cartVersion: added.body.cartVersion, catalogRevision: added.body.catalogRevision, clientRequestKey: "00000000-0000-4000-8000-000000000012" }) });
    const request = { method: "POST", headers: postHeaders(visitor.cookie), body: "{}" };
    const firstCapture = json(`${url}/api/orders/${created.body.orderId}/capture`, request);
    await readStarted;
    const secondCapture = await json(`${url}/api/orders/${created.body.orderId}/capture`, request);
    assert.equal(secondCapture.response.status, 202);
    releaseRead();
    assert.equal((await firstCapture).body.state, "paid");
    assert.equal(paypal.getOrderCalls, 1);
    assert.equal(paypal.captureCalls.length, 1);
  });
});

test("confirmed no-capture expires an order when its checkout deadline passed during verification", async () => {
  const paypal = new FakePayPal();
  paypal.orderStatusOverride = "CREATED";
  let markReadStarted!: () => void;
  let releaseRead!: () => void;
  const readStarted = new Promise<void>((resolve) => { markReadStarted = resolve; });
  paypal.getOrderGate = new Promise<void>((resolve) => { releaseRead = resolve; });
  paypal.onGetOrder = () => markReadStarted();

  await withServer(paypal, async (url, db) => {
    const visitor = await visitorSession(url);
    const added = await json(`${url}/api/cart/items`, { method: "POST", headers: postHeaders(visitor.cookie),
      body: JSON.stringify({ action: "add", productId: "yakisoba", quantity: 1, cartVersion: 0, catalogRevision: visitor.cart.catalogRevision }) });
    const created = await json(`${url}/api/orders`, { method: "POST", headers: postHeaders(visitor.cookie),
      body: JSON.stringify({ cartVersion: added.body.cartVersion, catalogRevision: added.body.catalogRevision, clientRequestKey: "00000000-0000-4000-8000-000000000013" }) });
    const capture = json(`${url}/api/orders/${created.body.orderId}/capture`, { method: "POST", headers: postHeaders(visitor.cookie), body: "{}" });
    await readStarted;
    db.prepare("UPDATE orders SET expires_at = ? WHERE id = ?").run(new Date(Date.now() - 1_000).toISOString(), created.body.orderId);
    releaseRead();
    const result = await capture;
    assert.equal(result.response.status, 409);
    assert.equal(result.body.error.code, "order_expired");
    assert.equal((db.prepare("SELECT state FROM orders WHERE id = ?").get(created.body.orderId) as { state: string }).state, "expired");
    assert.equal((await json(`${url}/api/menu`)).body.products.find((product: { id: string }) => product.id === "yakisoba").available, 24);
  });
});

test("expired anonymous sessions are pruned while sessions with orders are retained", async () => {
  const paypal = new FakePayPal();
  await withServer(paypal, async (url, db) => {
    const orderedVisitor = await visitorSession(url);
    const added = await json(`${url}/api/cart/items`, { method: "POST", headers: postHeaders(orderedVisitor.cookie),
      body: JSON.stringify({ action: "add", productId: "iced-tea", quantity: 1, cartVersion: 0, catalogRevision: orderedVisitor.cart.catalogRevision }) });
    const created = await json(`${url}/api/orders`, { method: "POST", headers: postHeaders(orderedVisitor.cookie),
      body: JSON.stringify({ cartVersion: added.body.cartVersion, catalogRevision: added.body.catalogRevision, clientRequestKey: "00000000-0000-4000-8000-000000000014" }) });
    const ownerHash = createHash("sha256").update(orderedVisitor.cookie.split("=", 2)[1]!).digest("hex");
    db.prepare("UPDATE visitor_sessions SET expires_at = ? WHERE session_hash = ?").run(new Date(Date.now() - 1_000).toISOString(), ownerHash);

    const abandonedVisitor = await visitorSession(url);
    const abandonedHash = createHash("sha256").update(abandonedVisitor.cookie.split("=", 2)[1]!).digest("hex");
    db.prepare("UPDATE visitor_sessions SET expires_at = ? WHERE session_hash = ?").run(new Date(Date.now() - 1_000).toISOString(), abandonedHash);
    await visitorSession(url);

    assert.ok(db.prepare("SELECT 1 FROM orders WHERE id = ? AND session_hash = ?").get(created.body.orderId, ownerHash));
    assert.ok(db.prepare("SELECT 1 FROM visitor_sessions WHERE session_hash = ?").get(ownerHash));
    assert.equal(db.prepare("SELECT 1 FROM visitor_sessions WHERE session_hash = ?").get(abandonedHash), undefined);
  });
});

test("webhook verification has per-IP and concurrent request limits", async () => {
  const paypal = new FakePayPal();
  paypal.verificationDelayMs = 30;
  await withServer(paypal, async (url) => {
    const headers = { "content-type": "application/json", "paypal-auth-algo": "test", "paypal-cert-url": "https://example.test/cert",
      "paypal-transmission-id": "tx1", "paypal-transmission-sig": "sig", "paypal-transmission-time": "now" };
    const deliver = (id: number) => fetch(`${url}/api/webhooks/paypal`, { method: "POST", headers,
      body: JSON.stringify({ id: `limited-event-${id}`, event_type: "OTHER.EVENT", resource: {} }) });
    const burst = await Promise.all(Array.from({ length: 9 }, (_, index) => deliver(index)));
    assert.equal(burst.filter((response) => response.status === 503).length, 1);
    assert.equal(burst.filter((response) => response.status === 204).length, 8);
    assert.equal(paypal.verifyCalls, 8);

    paypal.verificationDelayMs = 0;
    for (let index = 9; index < 30; index += 1) assert.equal((await deliver(index)).status, 204);
    assert.equal((await deliver(30)).status, 429);
    assert.equal(paypal.verifyCalls, 29);
  });
});

test("expired checkout reports an explicit terminal code", async () => {
  const paypal = new FakePayPal();
  await withServer(paypal, async (url, db) => {
    const visitor = await visitorSession(url);
    const added = await json(`${url}/api/cart/items`, { method: "POST", headers: postHeaders(visitor.cookie),
      body: JSON.stringify({ action: "add", productId: "ramune", quantity: 1, cartVersion: 0, catalogRevision: visitor.cart.catalogRevision }) });
    const created = await json(`${url}/api/orders`, { method: "POST", headers: postHeaders(visitor.cookie),
      body: JSON.stringify({ cartVersion: added.body.cartVersion, catalogRevision: added.body.catalogRevision, clientRequestKey: "00000000-0000-4000-8000-000000000015" }) });
    db.prepare("UPDATE orders SET expires_at = ? WHERE id = ?").run(new Date(Date.now() - 1_000).toISOString(), created.body.orderId);
    const response = await json(`${url}/api/orders/${created.body.orderId}/capture`, { method: "POST", headers: postHeaders(visitor.cookie), body: "{}" });
    assert.equal(response.response.status, 409);
    assert.equal(response.body.error.code, "order_expired");
    assert.equal(paypal.captureCalls.length, 0);
  });
});

test("oversized JSON is rejected before route handling", async () => {
  const paypal = new FakePayPal();
  await withServer(paypal, async (url) => {
    const response = await fetch(`${url}/api/organizer/session`, { method: "POST", headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ accessCode: "x".repeat(40_000) }) });
    assert.equal(response.status, 413);
  });
});
