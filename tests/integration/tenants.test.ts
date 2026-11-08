import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FakePayPal, json, origin, postHeaders, withServer } from "./support.js";

type ShopCreated = { shop: { slug: string; name: string }; dashboardUrl: string };

async function createOwner(url: string, slug: string, email: string, password = "a-test-password-123", defaultCurrency = "JPY") {
  const ownerSlug = `owner-${Math.random().toString(36).slice(2, 10)}`;
  const registration = await json(`${url}/api/v1/owners`, {
    method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ displayName: `Owner ${slug}`, ownerSlug, email, password, defaultCurrency }),
  });
  assert.equal(registration.response.status, 201);
  const cookie = registration.response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie?.startsWith("yatalk_owner=")) throw new Error("Owner session cookie was not issued");
  const created = await json(`${url}/api/v1/dashboard/shops`, {
    method: "POST", headers: postHeaders(cookie), body: JSON.stringify({ name: `Shop ${slug}`, slug }),
  });
  assert.equal(created.response.status, 201);
  return { cookie, ownerSlug, shop: (created.body as ShopCreated).shop };
}

async function visitor(url: string, slug: string) {
  const { response, body } = await json(`${url}/api/v1/shops/${slug}/cart`);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie?.startsWith("yatalk_v_") && !cookie?.startsWith("yatalk_visitor=")) throw new Error("Shop visitor cookie was not issued");
  return { cookie, cart: body };
}

async function addMenuItem(url: string, slug: string, cookie: string, name = "Test yakisoba") {
  const created = await json(`${url}/api/v1/dashboard/shops/${slug}/products/bulk`, {
    method: "POST", headers: postHeaders(cookie), body: JSON.stringify({ products: [{
      name, description: "A test menu item", priceMinor: 750, stockOnHand: 12, dietaryNote: "Contains wheat.",
    }] }),
  });
  assert.equal(created.response.status, 201);
  return created.body.products[0];
}

test("store registration creates path-addressed shops with separate menus and carts", async () => {
  await withServer(new FakePayPal(), async (url) => {
    const suffix = Math.random().toString(36).slice(2, 10);
    const first = await createOwner(url, `shop-alpha-${suffix}`, `alpha-${suffix}@example.test`);
    const second = await createOwner(url, `shop-bravo-${suffix}`, `bravo-${suffix}@example.test`);
    const firstMenu = await json(`${url}/api/v1/shops/${first.shop.slug}/menu`);
    const secondMenu = await json(`${url}/api/v1/shops/${second.shop.slug}/menu`);
    assert.equal(firstMenu.response.status, 200);
    assert.equal(secondMenu.response.status, 200);
    assert.equal(firstMenu.body.event.name, first.shop.name);
    assert.equal(secondMenu.body.event.name, second.shop.name);
    assert.deepEqual(firstMenu.body.products, []);
    assert.deepEqual(secondMenu.body.products, []);
    const firstItem = await addMenuItem(url, first.shop.slug, first.cookie);
    const secondItem = await addMenuItem(url, second.shop.slug, second.cookie);
    assert.notEqual(firstItem.id, secondItem.id);
    const updatedFirstMenu = await json(`${url}/api/v1/shops/${first.shop.slug}/menu`);
    const updatedSecondMenu = await json(`${url}/api/v1/shops/${second.shop.slug}/menu`);

    const firstVisitor = await visitor(url, first.shop.slug);
    const secondVisitor = await visitor(url, second.shop.slug);
    const added = await json(`${url}/api/v1/shops/${first.shop.slug}/cart/items`, {
      method: "POST", headers: postHeaders(firstVisitor.cookie),
      body: JSON.stringify({ action: "add", productId: updatedFirstMenu.body.products[0].id, quantity: 1,
        cartVersion: firstVisitor.cart.cartVersion, catalogRevision: firstVisitor.cart.catalogRevision }),
    });
    assert.equal(added.response.status, 200);
    const untouched = await json(`${url}/api/v1/shops/${second.shop.slug}/cart`, { headers: { cookie: secondVisitor.cookie } });
    assert.deepEqual(untouched.body.items, []);
    const foreignProduct = await json(`${url}/api/v1/shops/${first.shop.slug}/cart/items`, {
      method: "POST", headers: postHeaders(firstVisitor.cookie),
      body: JSON.stringify({ action: "add", productId: updatedSecondMenu.body.products[0].id, quantity: 1,
        cartVersion: added.body.cartVersion, catalogRevision: added.body.catalogRevision }),
    });
    assert.equal(foreignProduct.response.status, 400);
  });
});

test("shop owners can manage only their own orders, inventory, and summaries", async () => {
  await withServer(new FakePayPal(), async (url) => {
    const suffix = Math.random().toString(36).slice(2, 10);
    const first = await createOwner(url, `shop-owner-a-${suffix}`, `owner-a-${suffix}@example.test`);
    const second = await createOwner(url, `shop-owner-b-${suffix}`, `owner-b-${suffix}@example.test`);
    await addMenuItem(url, first.shop.slug, first.cookie);
    const menu = await json(`${url}/api/v1/shops/${first.shop.slug}/menu`);
    const customer = await visitor(url, first.shop.slug);
    const added = await json(`${url}/api/v1/shops/${first.shop.slug}/cart/items`, {
      method: "POST", headers: postHeaders(customer.cookie),
      body: JSON.stringify({ action: "add", productId: menu.body.products[0].id, quantity: 1,
        cartVersion: customer.cart.cartVersion, catalogRevision: customer.cart.catalogRevision }),
    });
    const created = await json(`${url}/api/v1/shops/${first.shop.slug}/orders`, {
      method: "POST", headers: postHeaders(customer.cookie),
      body: JSON.stringify({ cartVersion: added.body.cartVersion, catalogRevision: added.body.catalogRevision,
        clientRequestKey: "00000000-0000-4000-8000-000000000091" }),
    });
    assert.equal(created.response.status, 201);
    const captured = await json(`${url}/api/v1/shops/${first.shop.slug}/orders/${created.body.orderId}/capture`, {
      method: "POST", headers: postHeaders(customer.cookie), body: "{}",
    });
    assert.equal(captured.response.status, 200);
    const otherCustomer = await visitor(url, second.shop.slug);
    const hiddenOrder = await json(`${url}/api/v1/shops/${second.shop.slug}/orders/${created.body.orderId}`, { headers: { cookie: otherCustomer.cookie } });
    assert.equal(hiddenOrder.response.status, 404);
    const foreignCapture = await json(`${url}/api/v1/shops/${second.shop.slug}/orders/${created.body.orderId}/capture`, {
      method: "POST", headers: postHeaders(otherCustomer.cookie), body: "{}",
    });
    assert.equal(foreignCapture.response.status, 404);

    const firstSummary = await json(`${url}/api/v1/dashboard/shops/${first.shop.slug}/summary`, { headers: { cookie: first.cookie } });
    const secondSummary = await json(`${url}/api/v1/dashboard/shops/${second.shop.slug}/summary`, { headers: { cookie: second.cookie } });
    assert.equal(firstSummary.response.status, 200);
    assert.equal(secondSummary.response.status, 200);
    assert.equal(firstSummary.body.metrics.grossSalesMinor, menu.body.products[0].priceMinor);
    assert.equal(secondSummary.body.metrics.grossSalesMinor, 0);

    const foreignDashboard = await json(`${url}/api/v1/dashboard/shops/${second.shop.slug}/summary`, { headers: { cookie: first.cookie } });
    assert.equal(foreignDashboard.response.status, 404);
    const foreignProduct = await json(`${url}/api/v1/dashboard/shops/${second.shop.slug}/products/${menu.body.products[0].id}`, {
      method: "PATCH", headers: postHeaders(second.cookie), body: JSON.stringify({ stockOnHand: 99 }),
    });
    assert.equal(foreignProduct.response.status, 404);
  });
});

test("menu assistant requires shop ownership and returns editable drafts without publishing them", async () => {
  await withServer(new FakePayPal(), async (url) => {
    const suffix = Math.random().toString(36).slice(2, 10);
    const owner = await createOwner(url, `shop-menu-ai-${suffix}`, `menu-ai-${suffix}@example.test`);
    const endpoint = `${url}/api/v1/dashboard/${owner.ownerSlug}/${owner.shop.slug}/menu/assistant`;
    const body = { message: "Suggest a citrus tea", history: [], draft: [] };
    const unauthorized = await json(endpoint, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
    assert.equal(unauthorized.response.status, 401);
    const suggested = await json(endpoint, { method: "POST", headers: postHeaders(owner.cookie), body: JSON.stringify(body) });
    assert.equal(suggested.response.status, 200);
    assert.equal(suggested.body.suggestions[0].name, "Citrus tea");
    assert.equal(suggested.body.suggestions[0].priceMinor, null);
    assert.equal("stockOnHand" in suggested.body.suggestions[0], false);
    const menu = await json(`${url}/api/v1/owners/${owner.ownerSlug}/shops/${owner.shop.slug}/menu`);
    assert.deepEqual(menu.body.products, []);
  });
});

test("shop menu photo extraction requires the owner, checks image content, and saves only reviewed menu items", async () => {
  await withServer(new FakePayPal(), async (url) => {
    const suffix = Math.random().toString(36).slice(2, 10);
    const owner = await createOwner(url, `shop-menu-${suffix}`, `menu-${suffix}@example.test`);
    const image = readFileSync(new URL("../fixtures/menu-ocr-test.png", import.meta.url));
    const scanUrl = `${url}/api/v1/dashboard/shops/${owner.shop.slug}/menu/scan`;

    const unauthenticated = await fetch(scanUrl, { method: "POST", headers: { origin, "content-type": "image/png" }, body: image });
    assert.equal(unauthenticated.status, 401);
    const wrongOrigin = await fetch(scanUrl, { method: "POST", headers: { cookie: owner.cookie, origin: "https://attacker.example", "content-type": "image/png" }, body: image });
    assert.equal(wrongOrigin.status, 403);
    const mismatched = await fetch(scanUrl, { method: "POST", headers: { cookie: owner.cookie, origin, "content-type": "image/jpeg" }, body: image });
    assert.equal(mismatched.status, 415);

    const scanned = await json(scanUrl, { method: "POST", headers: { cookie: owner.cookie, origin, "content-type": "image/png" }, body: image });
    assert.equal(scanned.response.status, 200);
    assert.deepEqual(scanned.body.items.map((item: { name: string; priceMinor: number }) => [item.name, item.priceMinor]), [
      ["Grilled Onigiri", 400], ["Iced Tea", 300], ["Mikan Jelly", 500],
    ]);
    const emptyMenu = await json(`${url}/api/v1/shops/${owner.shop.slug}/menu`);
    assert.deepEqual(emptyMenu.body.products, []);

    const unreviewed = await json(`${url}/api/v1/dashboard/shops/${owner.shop.slug}/products/bulk`, {
      method: "POST", headers: postHeaders(owner.cookie),
      body: JSON.stringify({ products: [{ name: "Grilled Onigiri", description: "", priceMinor: null, stockOnHand: 10, dietaryNote: "Contains soy" }] }),
    });
    assert.equal(unreviewed.response.status, 400);
    const saved = await json(`${url}/api/v1/dashboard/shops/${owner.shop.slug}/products/bulk`, {
      method: "POST", headers: postHeaders(owner.cookie),
      body: JSON.stringify({ products: [{ name: "Grilled Onigiri", description: "", priceMinor: 400, stockOnHand: 10, dietaryNote: "Contains soy" }] }),
    });
    assert.equal(saved.response.status, 201);
    const published = await json(`${url}/api/v1/shops/${owner.shop.slug}/menu`);
    assert.equal(published.body.products[0].name, "Grilled Onigiri");
    assert.equal(published.body.products[0].available, 10);
  });
});

test("tenant routes reject invalid shops and writes without the exact origin", async () => {
  await withServer(new FakePayPal(), async (url) => {
    const invalidSlug = await fetch(`${url}/api/v1/shops/Unknown/menu`);
    const missingShop = await fetch(`${url}/api/v1/shops/no-such-shop/menu`);
    assert.equal(invalidSlug.status, 404);
    assert.equal(missingShop.status, 404);
    const noOrigin = await fetch(`${url}/api/v1/shops/little-harbor-market/cart`, {
      method: "DELETE", headers: { cookie: "yatalk_visitor=invalid" },
    });
    assert.equal(noOrigin.status, 403);
  });
});

test("shop slug availability reports reserved and existing addresses", async () => {
  await withServer(new FakePayPal(), async (url) => {
    const slug = `available-${Math.random().toString(36).slice(2, 10)}`;
    const available = await json(`${url}/api/v1/shops/slug-availability/${slug}`);
    assert.equal(available.response.status, 200);
    assert.deepEqual(available.body, { available: true });

    const created = await createOwner(url, slug, `availability-${slug}@example.test`);
    const taken = await json(`${url}/api/v1/shops/slug-availability/${created.shop.slug}`);
    assert.equal(taken.response.status, 200);
    assert.deepEqual(taken.body, { available: false });

    const duplicate = await json(`${url}/api/v1/dashboard/shops`, {
      method: "POST", headers: postHeaders(created.cookie),
      body: JSON.stringify({ name: "Duplicate", slug }),
    });
    assert.equal(duplicate.response.status, 409);
    assert.equal(duplicate.body.error.code, "shop_slug_taken");

    const reserved = await json(`${url}/api/v1/shops/slug-availability/new`);
    assert.equal(reserved.response.status, 200);
    assert.deepEqual(reserved.body, { available: false });
  });
});

test("owner sign-in, session revocation, reserved slugs, and webhook alias behave as designed", async () => {
  await withServer(new FakePayPal(), async (url) => {
    const suffix = Math.random().toString(36).slice(2, 10);
    const email = `account-${suffix}@example.test`;
    const password = "an-owner-password-456";
    await createOwner(url, `shop-auth-${suffix}`, email, password);

    const invalidLogin = await fetch(`${url}/api/v1/auth/session`, {
      method: "POST", headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ email, password: "incorrect-password" }),
    });
    assert.equal(invalidLogin.status, 401);
    const login = await fetch(`${url}/api/v1/auth/session`, {
      method: "POST", headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(login.status, 204);
    const ownerCookie = login.headers.get("set-cookie")?.split(";")[0];
    if (!ownerCookie?.startsWith("yatalk_owner=")) throw new Error("Owner sign-in cookie was not issued");
    const shops = await json(`${url}/api/v1/dashboard/shops`, { headers: { cookie: ownerCookie } });
    assert.equal(shops.response.status, 200);
    assert.equal(shops.body.shops.length, 1);

    const logout = await fetch(`${url}/api/v1/auth/session`, { method: "DELETE", headers: postHeaders(ownerCookie) });
    assert.equal(logout.status, 204);
    const afterLogout = await json(`${url}/api/v1/dashboard/shops`, { headers: { cookie: ownerCookie } });
    assert.equal(afterLogout.response.status, 401);

    const owner = await createOwner(url, `shop-reserved-${suffix}`, `reserved-${suffix}@example.test`, password);
    const reserved = await json(`${url}/api/v1/dashboard/shops`, {
      method: "POST", headers: postHeaders(owner.cookie),
      body: JSON.stringify({ name: "Reserved", slug: "new" }),
    });
    assert.equal(reserved.response.status, 400);

    const webhook = await fetch(`${url}/api/v1/webhooks/paypal`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: `TENANT-EVENT-${suffix}`, event_type: "UNHANDLED.TEST", resource: {} }),
    });
    assert.equal(webhook.status, 204);
  });
});
