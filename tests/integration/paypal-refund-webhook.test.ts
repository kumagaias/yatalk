import assert from "node:assert/strict";
import test from "node:test";
import { FakePayPal, json, origin, postHeaders, visitorSession, withServer } from "./support.js";

const webhookHeaders = { "content-type": "application/json", "paypal-auth-algo": "test", "paypal-cert-url": "https://example.test/cert",
  "paypal-transmission-id": "tx-refund", "paypal-transmission-sig": "sig", "paypal-transmission-time": "now" };

async function prepareRefundUnknown(url: string, clientRequestKey: string) {
  const visitor = await visitorSession(url);
  const added = await json(`${url}/api/cart/items`, { method: "POST", headers: postHeaders(visitor.cookie),
    body: JSON.stringify({ action: "add", productId: "iced-tea", quantity: 1, cartVersion: 0, catalogRevision: visitor.cart.catalogRevision }) });
  const created = await json(`${url}/api/orders`, { method: "POST", headers: postHeaders(visitor.cookie),
    body: JSON.stringify({ cartVersion: added.body.cartVersion, catalogRevision: added.body.catalogRevision, clientRequestKey }) });
  const captureId = "6RW7654321098765";
  const captureEvent = { id: "capture-before-refund", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: {
    id: captureId, status: "COMPLETED", amount: { currency_code: "JPY", value: "300" },
    supplementary_data: { related_ids: { order_id: created.body.paypalOrderId } },
  } };
  const captured = await fetch(`${url}/api/webhooks/paypal`, { method: "POST", headers: webhookHeaders, body: JSON.stringify(captureEvent) });
  assert.equal(captured.status, 204);
  const login = await fetch(`${url}/api/organizer/session`, { method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ accessCode: "local-test-code!!" }) });
  const adminCookie = login.headers.get("set-cookie")!.split(";", 1)[0]!;
  const refundAttempt = await json(`${url}/api/organizer/orders/${created.body.orderId}/refund`, { method: "POST",
    headers: postHeaders(adminCookie), body: JSON.stringify({ restock: true }) });
  assert.equal(refundAttempt.response.status, 202);
  return { orderId: created.body.orderId as string, captureId, adminCookie };
}

function refundEvent(orderId: string, captureId: string, overrides: Record<string, unknown> = {}) {
  return { id: "refund-edge-event", event_type: "PAYMENT.CAPTURE.REFUNDED", resource: {
    id: "4A867654321098765", status: "COMPLETED", amount: { currency_code: "JPY", value: "300" },
    invoice_id: orderId, custom_id: orderId,
    links: [{ rel: "up", href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${captureId}` }],
    ...overrides,
  } };
}

test("PayPal refund webhooks match invoice IDs and the capture link", async () => {
  const paypal = new FakePayPal();
  paypal.failFirstRefund = true;
  await withServer(paypal, async (url, db) => {
    const visitor = await visitorSession(url);
    const added = await json(`${url}/api/cart/items`, { method: "POST", headers: postHeaders(visitor.cookie),
      body: JSON.stringify({ action: "add", productId: "iced-tea", quantity: 1, cartVersion: 0, catalogRevision: visitor.cart.catalogRevision }) });
    const created = await json(`${url}/api/orders`, { method: "POST", headers: postHeaders(visitor.cookie),
      body: JSON.stringify({ cartVersion: added.body.cartVersion, catalogRevision: added.body.catalogRevision,
        clientRequestKey: "00000000-0000-4000-8000-000000000021" }) });

    const captureId = "6RW7654321098765";
    const captureEvent = { id: "capture-before-refund", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: {
      id: captureId, status: "COMPLETED", amount: { currency_code: "JPY", value: "300" },
      supplementary_data: { related_ids: { order_id: created.body.paypalOrderId } },
    } };
    const captured = await fetch(`${url}/api/webhooks/paypal`, { method: "POST", headers: webhookHeaders, body: JSON.stringify(captureEvent) });
    assert.equal(captured.status, 204);
    assert.equal((db.prepare("SELECT stock_on_hand FROM products WHERE id = 'iced-tea'").get() as { stock_on_hand: number }).stock_on_hand, 29);

    const login = await fetch(`${url}/api/organizer/session`, { method: "POST", headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ accessCode: "local-test-code!!" }) });
    const adminCookie = login.headers.get("set-cookie")!.split(";", 1)[0]!;
    const refundAttempt = await json(`${url}/api/organizer/orders/${created.body.orderId}/refund`, { method: "POST",
      headers: postHeaders(adminCookie), body: JSON.stringify({ restock: true }) });
    assert.equal(refundAttempt.response.status, 202);
    assert.equal((await json(`${url}/api/organizer/orders/${created.body.orderId}`, { headers: { cookie: adminCookie } })).body.state, "refund_unknown");

    const refundEvent = { id: "paypal-refund-event-shape", event_type: "PAYMENT.CAPTURE.REFUNDED", resource: {
      id: "4A867654321098765", status: "COMPLETED", amount: { currency_code: "JPY", value: "300" },
      invoice_id: created.body.orderId, custom_id: created.body.orderId,
      links: [{ rel: "up", href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${captureId}` }],
    } };
    for (let count = 0; count < 2; count += 1) {
      const response = await fetch(`${url}/api/webhooks/paypal`, { method: "POST", headers: webhookHeaders, body: JSON.stringify(refundEvent) });
      assert.equal(response.status, 204);
    }

    const order = await json(`${url}/api/organizer/orders/${created.body.orderId}`, { headers: { cookie: adminCookie } });
    assert.equal(order.body.state, "refunded");
    assert.equal(order.body.restocked, true);
    assert.equal((db.prepare("SELECT stock_on_hand FROM products WHERE id = 'iced-tea'").get() as { stock_on_hand: number }).stock_on_hand, 30);
  });
});

test("PayPal refund webhooks reject mismatched references, capture links, status, amount, and currency", async () => {
  const invalidEvents: Array<[string, (orderId: string, captureId: string) => ReturnType<typeof refundEvent>]> = [
    ["invoice/custom mismatch", (orderId, captureId) => ({ ...refundEvent(orderId, captureId), resource: {
      ...refundEvent(orderId, captureId).resource, custom_id: "00000000-0000-4000-8000-000000000099",
    } })],
    ["capture link mismatch", (orderId, captureId) => refundEvent(orderId, `${captureId}WRONG`)],
    ["non-completed status", (orderId, captureId) => refundEvent(orderId, captureId, { status: "PENDING" })],
    ["amount mismatch", (orderId, captureId) => refundEvent(orderId, captureId, { amount: { currency_code: "JPY", value: "301" } })],
    ["currency mismatch", (orderId, captureId) => refundEvent(orderId, captureId, { amount: { currency_code: "USD", value: "300" } })],
    ["empty refund ID", (orderId, captureId) => refundEvent(orderId, captureId, { id: "" })],
  ];

  for (const [label, buildEvent] of invalidEvents) {
    const paypal = new FakePayPal();
    paypal.failFirstRefund = true;
    await withServer(paypal, async (url, db) => {
      const { orderId, captureId, adminCookie } = await prepareRefundUnknown(url, "00000000-0000-4000-8000-000000000022");
      const event = buildEvent(orderId, captureId);
      const response = await fetch(`${url}/api/webhooks/paypal`, { method: "POST", headers: webhookHeaders, body: JSON.stringify(event) });
      assert.equal(response.status, 500, label);
      assert.equal((await json(`${url}/api/organizer/orders/${orderId}`, { headers: { cookie: adminCookie } })).body.state, "refund_unknown", label);
      assert.equal((db.prepare("SELECT 1 FROM webhook_events WHERE id = ?").get(event.id)), undefined, label);
      assert.equal((db.prepare("SELECT stock_on_hand FROM products WHERE id = 'iced-tea'").get() as { stock_on_hand: number }).stock_on_hand, 29, label);
    });
  }
});

test("a distinct PayPal refund event cannot restock the same refunded order twice", async () => {
  const paypal = new FakePayPal();
  paypal.failFirstRefund = true;
  await withServer(paypal, async (url, db) => {
    const { orderId, captureId, adminCookie } = await prepareRefundUnknown(url, "00000000-0000-4000-8000-000000000023");
    const firstEvent = refundEvent(orderId, captureId);
    const firstResponse = await fetch(`${url}/api/webhooks/paypal`, { method: "POST", headers: webhookHeaders, body: JSON.stringify(firstEvent) });
    assert.equal(firstResponse.status, 204);
    const secondEvent = { ...firstEvent, id: "refund-distinct-event-id" };
    const secondResponse = await fetch(`${url}/api/webhooks/paypal`, { method: "POST", headers: webhookHeaders, body: JSON.stringify(secondEvent) });
    assert.equal(secondResponse.status, 204);
    assert.equal((await json(`${url}/api/organizer/orders/${orderId}`, { headers: { cookie: adminCookie } })).body.state, "refunded");
    assert.equal((db.prepare("SELECT stock_on_hand FROM products WHERE id = 'iced-tea'").get() as { stock_on_hand: number }).stock_on_hand, 30);
  });
});
