import assert from "node:assert/strict";
import test from "node:test";
import { FakePayPal, json, origin, postHeaders, withServer } from "./support.js";

async function register(url: string, shopSlug: string, suffix: string, currency: string) {
  const ownerSlug = `owner-${suffix}`;
  const registration = await json(`${url}/api/v1/owners`, {
    method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ displayName: `Owner ${suffix}`, ownerSlug, email: `${suffix}@example.test`, password: "a-test-password-123", defaultCurrency: currency }),
  });
  assert.equal(registration.response.status, 201);
  const cookie = registration.response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie?.startsWith("yatalk_owner="));
  const owner = await json(`${url}/api/v1/auth/session`, { headers: { cookie: cookie! } });
  assert.deepEqual(owner.body, { authenticated: true, email: `${suffix}@example.test`, displayName: `Owner ${suffix}`, ownerSlug, defaultCurrency: currency, emailVerified: false });
  const shop = await json(`${url}/api/v1/dashboard/shops`, {
    method: "POST", headers: postHeaders(cookie!), body: JSON.stringify({ name: `Shop ${shopSlug}`, slug: shopSlug }),
  });
  assert.equal(shop.response.status, 201);
  return { ownerSlug, cookie: cookie!, shop: shop.body.shop as { slug: string; currency: string } };
}

test("owner currency flows through nested storefront, isolated visitor sessions, and PayPal checkout", async () => {
  const paypal = new FakePayPal();
  await withServer(paypal, async (url) => {
    const suffix = Math.random().toString(36).slice(2, 10);
    const first = await register(url, "shared-stall", `first-${suffix}`, "USD");
    const second = await register(url, "shared-stall", `second-${suffix}`, "EUR");
    assert.equal(first.shop.currency, "USD");
    assert.equal(second.shop.currency, "EUR");

    const nestedDash = `${url}/api/v1/dashboard/${first.ownerSlug}/${first.shop.slug}`;
    const product = await json(`${nestedDash}/products/bulk`, {
      method: "POST", headers: postHeaders(first.cookie),
      body: JSON.stringify({ products: [{ name: "Tea", description: "Iced tea", priceMinor: 1234, stockOnHand: 4, dietaryNote: "" }] }),
    });
    assert.equal(product.response.status, 201);
    assert.equal(product.body.products[0].currency, "USD");

    const nestedShop = `${url}/api/v1/owners/${first.ownerSlug}/shops/${first.shop.slug}`;
    const menu = await json(`${nestedShop}/menu`);
    assert.equal(menu.body.products[0].currency, "USD");
    const cartResponse = await json(`${nestedShop}/cart`);
    assert.equal(cartResponse.body.currency, "USD");
    const visitorCookie = cartResponse.response.headers.get("set-cookie")?.split(";")[0];
    assert.ok(visitorCookie?.startsWith("yatalk_v_"));

    const added = await json(`${nestedShop}/cart/items`, {
      method: "POST", headers: postHeaders(visitorCookie!),
      body: JSON.stringify({ action: "add", productId: product.body.products[0].id, quantity: 1,
        cartVersion: cartResponse.body.cartVersion, catalogRevision: cartResponse.body.catalogRevision }),
    });
    const order = await json(`${nestedShop}/orders`, {
      method: "POST", headers: postHeaders(visitorCookie!),
      body: JSON.stringify({ cartVersion: added.body.cartVersion, catalogRevision: added.body.catalogRevision,
        clientRequestKey: "00000000-0000-4000-8000-000000000701" }),
    });
    assert.equal(order.response.status, 201);
    assert.equal(paypal.createCalls[0]?.currency, "USD");
    assert.equal(paypal.createCalls[0]?.totalMinor, 1234);

    const captured = await json(`${nestedShop}/orders/${order.body.orderId}/capture`, {
      method: "POST", headers: postHeaders(visitorCookie!), body: "{}",
    });
    assert.equal(captured.response.status, 200);
    assert.equal(captured.body.currency, "USD");
    assert.equal(captured.body.totalMinor, 1234);

    const crossOwner = await json(`${url}/api/v1/dashboard/${first.ownerSlug}/${first.shop.slug}/summary`, { headers: { cookie: second.cookie } });
    assert.equal(crossOwner.response.status, 404);
    assert.notEqual(visitorCookie, (await json(`${url}/api/v1/owners/${second.ownerSlug}/shops/${second.shop.slug}/cart`)).response.headers.get("set-cookie")?.split(";")[0]);
  });
});
