import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createFirestoreDatabase } from "../../server/firestore-bootstrap.js";
import { findOrder } from "../../server/order-state.js";
import { FakePayPal, json, origin, postHeaders, withFirestoreServer } from "./support.js";

const webhookHeaders = {
  "content-type": "application/json", "paypal-auth-algo": "test", "paypal-cert-url": "https://example.test/cert",
  "paypal-transmission-id": "tx-firestore", "paypal-transmission-sig": "sig", "paypal-transmission-time": "now",
};

test("Firestore stores owner shops, currency, menu, cart, PayPal state, refunds, and analytics", {
  skip: !process.env.FIRESTORE_EMULATOR_HOST,
}, async () => {
  const paypal = new FakePayPal();
  paypal.failFirstRefund = true;
  const projectId = `yatalk-test-${randomUUID().slice(0, 8)}`;
  await withFirestoreServer(paypal, async (url, db) => {
    const suffix = Math.random().toString(36).slice(2, 10);
    const ownerSlug = `owner-${suffix}`;
    const shopSlug = `stall-${suffix}`;
    const email = `firestore-${suffix}@example.test`;
    const registration = await json(`${url}/api/v1/owners`, {
      method: "POST", headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Firestore owner", ownerSlug, email, password: "a-test-password-123", defaultCurrency: "USD" }),
    });
    assert.equal(registration.response.status, 201);
    const ownerCookie = registration.response.headers.get("set-cookie")!.split(";", 1)[0]!;

    const createdShop = await json(`${url}/api/v1/dashboard/shops`, {
      method: "POST", headers: postHeaders(ownerCookie), body: JSON.stringify({ name: "Cloud Stall", slug: shopSlug }),
    });
    assert.equal(createdShop.response.status, 201);
    assert.equal(createdShop.body.shop.currency, "USD");

    const dashboard = `${url}/api/v1/dashboard/${ownerSlug}/${shopSlug}`;
    const products = await json(`${dashboard}/products/bulk`, {
      method: "POST", headers: postHeaders(ownerCookie),
      body: JSON.stringify({ products: [{ name: "Iced tea", description: "Cold black tea", priceMinor: 1234, stockOnHand: 1, dietaryNote: "" }] }),
    });
    assert.equal(products.response.status, 201);
    const productId = products.body.products[0].id as string;
    assert.equal(products.body.products[0].currency, "USD");

    const publicShop = `${url}/api/v1/owners/${ownerSlug}/shops/${shopSlug}`;
    const cartResponse = await json(`${publicShop}/cart`);
    const visitorCookie = cartResponse.response.headers.get("set-cookie")!.split(";", 1)[0]!;
    const added = await json(`${publicShop}/cart/items`, {
      method: "POST", headers: postHeaders(visitorCookie),
      body: JSON.stringify({ action: "add", productId, quantity: 1,
        cartVersion: cartResponse.body.cartVersion, catalogRevision: cartResponse.body.catalogRevision }),
    });
    assert.equal(added.response.status, 200);
    const shopRows = await db.firestoreStore.query<{ slug: string } & Record<string, unknown>>("shops", [
      { field: "slug", op: "==", value: shopSlug },
    ], undefined, 1);
    const storedCart = await db.firestoreStore.query("cartItems", [
      { field: "shopId", op: "==", value: shopRows[0]!.id },
    ]);
    const cartExpiry = storedCart[0]?.expiresAtTtl as { toDate?: () => Date } | undefined;
    assert.equal(typeof cartExpiry?.toDate, "function");
    const ownerSessions = await db.firestoreStore.query("ownerSessions");
    assert.equal(typeof (ownerSessions[0]?.expiresAtTtl as { toDate?: () => Date } | undefined)?.toDate, "function");

    const requestBody = { cartVersion: added.body.cartVersion, catalogRevision: added.body.catalogRevision,
      clientRequestKey: "00000000-0000-4000-8000-000000000702" };
    const createdOrder = await json(`${publicShop}/orders`, {
      method: "POST", headers: postHeaders(visitorCookie), body: JSON.stringify(requestBody),
    });
    assert.equal(createdOrder.response.status, 201);
    assert.equal(paypal.createCalls[0]?.currency, "USD");
    assert.equal(paypal.createCalls[0]?.totalMinor, 1234);
    const retriedOrder = await json(`${publicShop}/orders`, {
      method: "POST", headers: postHeaders(visitorCookie), body: JSON.stringify(requestBody),
    });
    assert.equal(retriedOrder.response.status, 200);
    assert.equal(retriedOrder.body.orderId, createdOrder.body.orderId);
    assert.equal(paypal.createCalls.length, 1);

    const captureId = `CAPTURE${String(createdOrder.body.orderId).replaceAll("-", "")}`;
    const captureEvent = { id: `firestore-capture-${suffix}`, event_type: "PAYMENT.CAPTURE.COMPLETED", resource: {
      id: captureId, status: "COMPLETED", amount: { currency_code: "USD", value: "12.34" },
      supplementary_data: { related_ids: { order_id: createdOrder.body.paypalOrderId } },
    } };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(`${url}/api/webhooks/paypal`, { method: "POST", headers: webhookHeaders, body: JSON.stringify(captureEvent) });
      assert.equal(response.status, 204);
    }
    const soldOut = await json(`${publicShop}/menu`);
    assert.equal(soldOut.body.products.find((item: { id: string }) => item.id === productId).available, 0);

    const refund = await json(`${dashboard}/orders/${createdOrder.body.orderId}/refund`, {
      method: "POST", headers: postHeaders(ownerCookie), body: JSON.stringify({ restock: true }),
    });
    assert.equal(refund.response.status, 202);
    assert.equal(refund.body.state, "refund_unknown");

    const refundEvent = { id: `firestore-refund-${suffix}`, event_type: "PAYMENT.CAPTURE.REFUNDED", resource: {
      id: `REFUND-${suffix}`, status: "COMPLETED", amount: { currency_code: "USD", value: "12.34" },
      invoice_id: createdOrder.body.orderId, custom_id: createdOrder.body.orderId,
      links: [{ rel: "up", href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${captureId}` }],
    } };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(`${url}/api/webhooks/paypal`, { method: "POST", headers: webhookHeaders, body: JSON.stringify(refundEvent) });
      assert.equal(response.status, 204);
    }

    const restored = await json(`${publicShop}/menu`);
    assert.equal(restored.body.products.find((item: { id: string }) => item.id === productId).available, 1);
    const summary = await json(`${dashboard}/summary`, { headers: { cookie: ownerCookie } });
    assert.equal(summary.response.status, 200);
    assert.equal(summary.body.metrics.grossSalesMinor, 1234);
    assert.equal(summary.body.metrics.netSalesMinor, 0);
    assert.equal(summary.body.metrics.paidOrderCount, 0);
    const restartedDb = createFirestoreDatabase(projectId);
    try {
      const persistedOrder = await findOrder(restartedDb, createdOrder.body.orderId, shopRows[0]!.id);
      const persistedProduct = await restartedDb.firestoreStore.get<{ stockOnHand: number } & Record<string, unknown>>("products", productId);
      assert.equal(persistedOrder?.state, "refunded");
      assert.equal(persistedProduct?.stockOnHand, 1);
    } finally {
      await restartedDb.firestoreStore.client.terminate();
      restartedDb.close();
    }
  }, undefined, projectId);
});

test("Firestore transactions reserve one unit only once when checkouts race", {
  skip: !process.env.FIRESTORE_EMULATOR_HOST,
}, async () => {
  const paypal = new FakePayPal();
  await withFirestoreServer(paypal, async (url) => {
    const suffix = Math.random().toString(36).slice(2, 10);
    const ownerSlug = `owner-race-${suffix}`;
    const shopSlug = `race-${suffix}`;
    const registration = await json(`${url}/api/v1/owners`, {
      method: "POST", headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Race owner", ownerSlug, email: `race-${suffix}@example.test`,
        password: "a-test-password-123", defaultCurrency: "JPY" }),
    });
    const ownerCookie = registration.response.headers.get("set-cookie")!.split(";", 1)[0]!;
    const createdShop = await json(`${url}/api/v1/dashboard/shops`, {
      method: "POST", headers: postHeaders(ownerCookie), body: JSON.stringify({ name: "Race stall", slug: shopSlug }),
    });
    const dashboard = `${url}/api/v1/dashboard/${ownerSlug}/${shopSlug}`;
    const products = await json(`${dashboard}/products/bulk`, {
      method: "POST", headers: postHeaders(ownerCookie),
      body: JSON.stringify({ products: [{ name: "Last tea", description: "", priceMinor: 200, stockOnHand: 1, dietaryNote: "" }] }),
    });
    assert.equal(createdShop.response.status, 201);
    assert.equal(products.response.status, 201);

    const publicShop = `${url}/api/v1/owners/${ownerSlug}/shops/${shopSlug}`;
    const carts = await Promise.all([json(`${publicShop}/cart`), json(`${publicShop}/cart`)]);
    const sessions = carts.map((cart) => ({
      cookie: cart.response.headers.get("set-cookie")!.split(";", 1)[0]!,
      cart: cart.body,
    }));
    const added = await Promise.all(sessions.map((session) => json(`${publicShop}/cart/items`, {
      method: "POST", headers: postHeaders(session.cookie),
      body: JSON.stringify({ action: "add", productId: products.body.products[0].id, quantity: 1,
        cartVersion: session.cart.cartVersion, catalogRevision: session.cart.catalogRevision }),
    })));
    assert.deepEqual(added.map((result) => result.response.status), [200, 200]);

    const attempts = await Promise.all(sessions.map((session, index) => json(`${publicShop}/orders`, {
      method: "POST", headers: postHeaders(session.cookie),
      body: JSON.stringify({ cartVersion: added[index]!.body.cartVersion, catalogRevision: added[index]!.body.catalogRevision,
        clientRequestKey: `00000000-0000-4000-8000-${String(index + 711).padStart(12, "0")}` }),
    })));
    assert.deepEqual(attempts.map((result) => result.response.status).sort(), [201, 409]);
    assert.equal(paypal.createCalls.length, 1);
    const menu = await json(`${publicShop}/menu`);
    assert.equal(menu.body.products[0].available, 0);
  });
});
