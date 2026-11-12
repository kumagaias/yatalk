import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MAX_FREE_OWNER_SHOPS } from "../../shared/owner-limits.js";
import { FakeEmailSender, FakePayPal, json, origin, postHeaders, withServer } from "./support.js";

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

function emailToken(message: string): string {
  const link = message.match(/https?:\/\/\S+/)?.[0];
  if (!link) throw new Error("Test email did not include a link");
  return new URL(link).hash.slice("#token=".length);
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

test("an owner can delete only a confirmed shop", async () => {
  await withServer(new FakePayPal(), async (url) => {
    const suffix = Math.random().toString(36).slice(2, 10);
    const owner = await createOwner(url, `delete-me-${suffix}`, `delete-${suffix}@example.test`);
    const path = `${url}/api/v1/dashboard/shops/${owner.shop.slug}`;
    const rejected = await json(path, {
      method: "DELETE", headers: postHeaders(owner.cookie), body: JSON.stringify({ confirmation: "wrong name" }),
    });
    assert.equal(rejected.response.status, 400);
    const deleted = await json(path, {
      method: "DELETE", headers: postHeaders(owner.cookie), body: JSON.stringify({ confirmation: owner.shop.name }),
    });
    assert.equal(deleted.response.status, 200);
    assert.equal(deleted.body.deleted, true);
    const list = await json(`${url}/api/v1/dashboard/shops`, { headers: { cookie: owner.cookie } });
    assert.deepEqual(list.body.shops, []);
    const storefront = await json(`${url}/api/v1/shops/${owner.shop.slug}/menu`);
    assert.equal(storefront.response.status, 404);
  });
});

test("AG Studio accepts extended conversation metadata before invoking its adapter", async () => {
  await withServer(new FakePayPal(), async (url) => {
    const suffix = Math.random().toString(36).slice(2, 10);
    const owner = await createOwner(url, `studio-${suffix}`, `studio-${suffix}@example.test`);
    const studioData = await json(`${url}/api/v1/dashboard/shops/${owner.shop.slug}/studio/data`, { headers: { cookie: owner.cookie } });
    assert.equal(studioData.response.status, 200);
    assert.equal(studioData.body.salesTrend.length, 7);
    assert.deepEqual(studioData.body.salesTrend.map((point: { netSales: number }) => point.netSales), [0, 0, 0, 0, 0, 0, 0]);
    const result = await json(`${url}/api/v1/dashboard/shops/${owner.shop.slug}/studio/turn`, {
      method: "POST", headers: postHeaders(owner.cookie), body: JSON.stringify({
        input: Array.from({ length: 81 }, () => ({ kind: "input", type: "message", role: "user", content: [{ type: "text", text: "Show sales." }] })),
        instructions: null,
        tools: [{ name: "view_report", description: "View the current report.", parameters: {}, kind: "future-agent", clientVersion: "3.1" }],
        toolChoice: { name: "view_report", futureMetadata: true },
        responseFormat: { type: "text", clientVersion: "3.1" },
      }),
    });
    assert.equal(result.response.status, 503);
    assert.equal(result.body.error.code, "assistant_unavailable");
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

test("a shop owner sees only its pending counter QR payments", async () => {
  const paypal = new FakePayPal();
  paypal.approveUrl = "https://www.sandbox.paypal.com/checkoutnow?token=test";
  await withServer(paypal, async (url) => {
    const suffix = Math.random().toString(36).slice(2, 10);
    const first = await createOwner(url, `counter-a-${suffix}`, `counter-a-${suffix}@example.test`);
    const second = await createOwner(url, `counter-b-${suffix}`, `counter-b-${suffix}@example.test`);
    const item = await addMenuItem(url, first.shop.slug, first.cookie, "Counter tea");
    const customer = await visitor(url, first.shop.slug);
    const added = await json(`${url}/api/v1/shops/${first.shop.slug}/cart/items`, { method: "POST", headers: postHeaders(customer.cookie),
      body: JSON.stringify({ action: "add", productId: item.id, quantity: 1, cartVersion: customer.cart.cartVersion, catalogRevision: customer.cart.catalogRevision }) });
    const created = await json(`${url}/api/v1/shops/${first.shop.slug}/orders`, { method: "POST", headers: postHeaders(customer.cookie),
      body: JSON.stringify({ cartVersion: added.body.cartVersion, catalogRevision: added.body.catalogRevision, clientRequestKey: "00000000-0000-4000-8000-000000000098" }) });

    const unauthenticated = await json(`${url}/api/v1/dashboard/shops/${first.shop.slug}/counter-orders`);
    assert.equal(unauthenticated.response.status, 401);
    const queue = await json(`${url}/api/v1/dashboard/shops/${first.shop.slug}/counter-orders`, { headers: { cookie: first.cookie } });
    assert.deepEqual(queue.body.orders, [{ orderId: created.body.orderId, totalMinor: item.priceMinor, currency: "JPY",
      createdAt: queue.body.orders[0].createdAt, expiresAt: queue.body.orders[0].expiresAt,
      approveUrl: paypal.approveUrl, items: [{ name: "Counter tea", quantity: 1 }] }]);
    const otherQueue = await json(`${url}/api/v1/dashboard/shops/${second.shop.slug}/counter-orders`, { headers: { cookie: second.cookie } });
    assert.deepEqual(otherQueue.body.orders, []);
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

test("AI restock plan uses recent sales and only updates inventory after the owner confirms receipt", async () => {
  await withServer(new FakePayPal(), async (url) => {
    const suffix = Math.random().toString(36).slice(2, 10);
    const owner = await createOwner(url, `shop-stock-ai-${suffix}`, `stock-ai-${suffix}@example.test`);
    const dashboard = `/api/v1/dashboard/${owner.ownerSlug}/${owner.shop.slug}`;
    const created = await json(`${url}${dashboard}/products/bulk`, {
      method: "POST", headers: postHeaders(owner.cookie),
      body: JSON.stringify({ products: [{ name: "Mikan tea", description: "", priceMinor: 450, stockOnHand: 3, dietaryNote: "" }] }),
    });
    assert.equal(created.response.status, 201);

    const storefront = `/api/v1/owners/${owner.ownerSlug}/shops/${owner.shop.slug}`;
    const cart = await json(`${url}${storefront}/cart`);
    const visitorCookie = cart.response.headers.get("set-cookie")!.split(";", 1)[0]!;
    const item = created.body.products[0];
    const added = await json(`${url}${storefront}/cart/items`, {
      method: "POST", headers: postHeaders(visitorCookie),
      body: JSON.stringify({ action: "add", productId: item.id, quantity: 1,
        cartVersion: cart.body.cartVersion, catalogRevision: cart.body.catalogRevision }),
    });
    const order = await json(`${url}${storefront}/orders`, {
      method: "POST", headers: postHeaders(visitorCookie),
      body: JSON.stringify({ cartVersion: added.body.cartVersion, catalogRevision: added.body.catalogRevision,
        clientRequestKey: "00000000-0000-4000-8000-000000000091" }),
    });
    const captured = await json(`${url}${storefront}/orders/${order.body.orderId}/capture`, {
      method: "POST", headers: postHeaders(visitorCookie), body: "{}",
    });
    assert.equal(captured.response.status, 200);

    const answer = await json(`${url}${dashboard}/ask`, {
      method: "POST", headers: postHeaders(owner.cookie), body: JSON.stringify({ question: "What should I restock first?" }),
    });
    assert.equal(answer.response.status, 200);
    assert.equal(answer.body.sourceFacts.lowStockItems[0].name, "Mikan tea");
    assert.equal(answer.body.sourceFacts.lowStockItems[0].available, 2);
    assert.equal(answer.body.sourceFacts.unitsSold[0].units_sold, 1);
    assert.equal(answer.body.sourceFacts.unitsSoldLast7Days[0].units_sold, 1);
    assert.deepEqual(answer.body.inventoryPriority.map((priority: { id: string; suggestedQuantity: number; targetStock: number }) => ({
      id: priority.id, suggestedQuantity: priority.suggestedQuantity, targetStock: priority.targetStock,
    })), [
      { id: item.id, suggestedQuantity: 3, targetStock: 5 },
    ]);
    const summary = await json(`${url}${dashboard}/summary`, { headers: { cookie: owner.cookie } });
    assert.equal(summary.body.products[0].available, 2);

    const receiptId = "00000000-0000-4000-8000-000000000091";
    const receivePayload = { quantity: answer.body.inventoryPriority[0].suggestedQuantity, receiptId };
    const received = await json(`${url}${dashboard}/products/${item.id}/receive`, {
      method: "POST", headers: postHeaders(owner.cookie), body: JSON.stringify(receivePayload),
    });
    assert.equal(received.response.status, 200);
    assert.equal(received.body.product.stockOnHand, 5);
    assert.equal(received.body.product.available, 5);
    assert.equal(received.body.applied, true);
    const retried = await json(`${url}${dashboard}/products/${item.id}/receive`, {
      method: "POST", headers: postHeaders(owner.cookie), body: JSON.stringify(receivePayload),
    });
    assert.equal(retried.body.applied, false);
    assert.equal(retried.body.product.stockOnHand, 5);
    const receiptAudit = await json(`${url}${dashboard}/summary`, { headers: { cookie: owner.cookie } });
    assert.equal(receiptAudit.body.products[0].stockOnHand, 5);
  });
});

test("shop menu photo extraction requires the owner, checks image content, and saves only reviewed menu items", async () => {
  await withServer(new FakePayPal(), async (url) => {
    const suffix = Math.random().toString(36).slice(2, 10);
    const owner = await createOwner(url, `shop-menu-${suffix}`, `menu-${suffix}@example.test`);
    const image = readFileSync(new URL("../../public/menu-ocr-sample.webp", import.meta.url));
    const scanUrl = `${url}/api/v1/dashboard/shops/${owner.shop.slug}/menu/scan`;

    const unauthenticated = await fetch(scanUrl, { method: "POST", headers: { origin, "content-type": "image/webp" }, body: image });
    assert.equal(unauthenticated.status, 401);
    const wrongOrigin = await fetch(scanUrl, { method: "POST", headers: { cookie: owner.cookie, origin: "https://attacker.example", "content-type": "image/webp" }, body: image });
    assert.equal(wrongOrigin.status, 403);
    const mismatched = await fetch(scanUrl, { method: "POST", headers: { cookie: owner.cookie, origin, "content-type": "image/jpeg" }, body: image });
    assert.equal(mismatched.status, 415);

    const scanned = await json(scanUrl, { method: "POST", headers: { cookie: owner.cookie, origin, "content-type": "image/webp" }, body: image });
    assert.equal(scanned.response.status, 200);
    assert.deepEqual(scanned.body.items.map((item: { name: string; priceMinor: number }) => [item.name, item.priceMinor]), [
      ["Grilled Onigiri", 400], ["Iced Tea", 300], ["Mikan Jelly", 500],
    ]);
    const nestedScanUrl = `${url}/api/v1/dashboard/${owner.ownerSlug}/${owner.shop.slug}/menu/scan`;
    const nestedScanned = await json(nestedScanUrl, { method: "POST", headers: { cookie: owner.cookie, origin, "content-type": "image/webp" }, body: image });
    assert.equal(nestedScanned.response.status, 200);
    assert.equal(nestedScanned.body.items.length, 3);
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

test("free owner accounts can create at most three shops", async () => {
  await withServer(new FakePayPal(), async (url) => {
    const suffix = Math.random().toString(36).slice(2, 10);
    const owner = await createOwner(url, `limit-first-${suffix}`, `limit-${suffix}@example.test`);
    for (let index = 2; index <= MAX_FREE_OWNER_SHOPS; index += 1) {
      const created = await json(`${url}/api/v1/dashboard/shops`, {
        method: "POST", headers: postHeaders(owner.cookie),
        body: JSON.stringify({ name: `Shop ${index}`, slug: `limit-${index}-${suffix}` }),
      });
      assert.equal(created.response.status, 201);
    }
    const rejected = await json(`${url}/api/v1/dashboard/shops`, {
      method: "POST", headers: postHeaders(owner.cookie),
      body: JSON.stringify({ name: "Extra shop", slug: `limit-extra-${suffix}` }),
    });
    assert.equal(rejected.response.status, 409);
    assert.equal(rejected.body.error.code, "shop_limit_reached");
    const list = await json(`${url}/api/v1/dashboard/shops`, { headers: { cookie: owner.cookie } });
    assert.equal(list.body.shops.length, MAX_FREE_OWNER_SHOPS);
  });
});

test("owner registration allows ten attempts from one IP and blocks the eleventh", async () => {
  await withServer(new FakePayPal(), async (url) => {
    const register = () => json(`${url}/api/v1/owners`, {
      method: "POST", headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    for (let index = 0; index < 10; index += 1) assert.equal((await register()).response.status, 400);
    const limited = await register();
    assert.equal(limited.response.status, 429);
    assert.equal(limited.body.error.code, "rate_limited");
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

test("owner registration verifies email through a single-use link", async () => {
  const mailer = new FakeEmailSender();
  await withServer(new FakePayPal(), async (url) => {
    const suffix = Math.random().toString(36).slice(2, 10);
    const email = `verify-${suffix}@example.test`;
    const registration = await json(`${url}/api/v1/owners`, {
      method: "POST", headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Verify Owner", ownerSlug: `verify-${suffix}`, email, password: "a-test-password-123", defaultCurrency: "JPY" }),
    });
    assert.equal(registration.response.status, 201);
    assert.equal(registration.body.emailVerified, false);
    assert.equal(registration.body.verificationEmailSent, true);
    assert.equal(mailer.messages.length, 1);
    assert.equal(mailer.messages[0]?.to, email);
    assert.ok(new URL(mailer.messages[0]!.text.match(/https?:\/\/\S+/)![0]!).hash.startsWith("#token="));
    const token = emailToken(mailer.messages[0]!.text);
    const verified = await fetch(`${url}/api/v1/auth/verification/confirm`, {
      method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ token }),
    });
    assert.equal(verified.status, 204);
    const cookie = registration.response.headers.get("set-cookie")!.split(";", 1)[0]!;
    const session = await json(`${url}/api/v1/auth/session`, { headers: { cookie } });
    assert.equal(session.body.emailVerified, true);
    const reused = await json(`${url}/api/v1/auth/verification/confirm`, {
      method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ token }),
    });
    assert.equal(reused.response.status, 400);
  }, undefined, mailer);
});

test("password reset response is generic, one-time, and revokes prior owner sessions", async () => {
  const mailer = new FakeEmailSender();
  await withServer(new FakePayPal(), async (url) => {
    const suffix = Math.random().toString(36).slice(2, 10);
    const email = `reset-${suffix}@example.test`;
    const password = "a-test-password-123";
    const owner = await createOwner(url, `reset-shop-${suffix}`, email, password);
    const extraSession = await json(`${url}/api/v1/auth/session`, { headers: { cookie: owner.cookie } });
    assert.equal(extraSession.body.authenticated, true);
    const login = await fetch(`${url}/api/v1/auth/session`, {
      method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ email, password }),
    });
    assert.equal(login.status, 204);
    const secondCookie = login.headers.get("set-cookie")!.split(";", 1)[0]!;

    const requested = await json(`${url}/api/v1/auth/password-reset/request`, {
      method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ email }),
    });
    const unknown = await json(`${url}/api/v1/auth/password-reset/request`, {
      method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ email: `missing-${suffix}@example.test` }),
    });
    assert.equal(requested.response.status, 202);
    assert.deepEqual(requested.body, unknown.body);
    assert.equal(mailer.messages.filter((message) => message.subject.includes("Reset")).length, 1);
    const message = mailer.messages.find((item) => item.subject.includes("Reset"))!;
    const token = emailToken(message.text);
    const completed = await fetch(`${url}/api/v1/auth/password-reset/complete`, {
      method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ token, password: "a-new-test-password-456" }),
    });
    assert.equal(completed.status, 204);
    for (const cookie of [owner.cookie, secondCookie]) {
      const session = await json(`${url}/api/v1/auth/session`, { headers: { cookie } });
      assert.equal(session.body.authenticated, false);
    }
    const oldLogin = await fetch(`${url}/api/v1/auth/session`, {
      method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ email, password }),
    });
    const newLogin = await fetch(`${url}/api/v1/auth/session`, {
      method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ email, password: "a-new-test-password-456" }),
    });
    assert.equal(oldLogin.status, 401);
    assert.equal(newLogin.status, 204);
    const reused = await json(`${url}/api/v1/auth/password-reset/complete`, {
      method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ token, password: "another-new-password-789" }),
    });
    assert.equal(reused.response.status, 400);
  }, undefined, mailer);
});
