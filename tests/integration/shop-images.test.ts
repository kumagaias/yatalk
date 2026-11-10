import assert from "node:assert/strict";
import test from "node:test";
import { FakePayPal, FakeShopImageStorage, json, origin, postHeaders, withServer } from "./support.js";

const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/H1sAAAAASUVORK5CYII=", "base64");

test("shop owners can upload a validated cover image for their own public storefront", async () => {
  const storage = new FakeShopImageStorage();
  await withServer(new FakePayPal(), async (url) => {
    const suffix = Math.random().toString(36).slice(2, 10);
    const ownerSlug = `image-owner-${suffix}`;
    const shopSlug = `image-shop-${suffix}`;
    const registration = await json(`${url}/api/v1/owners`, {
      method: "POST", headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Image owner", ownerSlug, email: `${suffix}@example.test`,
        password: "a-test-password-123", defaultCurrency: "JPY" }),
    });
    assert.equal(registration.response.status, 201);
    const ownerCookie = registration.response.headers.get("set-cookie")?.split(";", 1)[0];
    assert.ok(ownerCookie);
    const created = await json(`${url}/api/v1/dashboard/shops`, {
      method: "POST", headers: postHeaders(ownerCookie!), body: JSON.stringify({ name: "Image Shop", slug: shopSlug }),
    });
    assert.equal(created.response.status, 201);

    const uploadUrl = `${url}/api/v1/dashboard/${ownerSlug}/${shopSlug}/image`;
    const unauthorized = await fetch(uploadUrl, { method: "PUT", headers: { origin, "content-type": "image/png" }, body: tinyPng });
    assert.equal(unauthorized.status, 401);

    const wrongType = await fetch(uploadUrl, { method: "PUT", headers: { cookie: ownerCookie!, origin, "content-type": "image/png" }, body: new Uint8Array([1, 2, 3]) });
    assert.equal(wrongType.status, 415);
    assert.equal(storage.images.size, 0);

    const uploaded = await json(uploadUrl, { method: "PUT", headers: { cookie: ownerCookie!, origin, "content-type": "image/png" }, body: tinyPng });
    assert.equal(uploaded.response.status, 200);
    assert.equal(uploaded.body.imageUrl, `/api/v1/owners/${ownerSlug}/shops/${shopSlug}/image`);
    assert.equal(storage.images.size, 1);

    const publicImage = await fetch(`${url}${uploaded.body.imageUrl}`);
    assert.equal(publicImage.status, 200);
    assert.equal(publicImage.headers.get("content-type"), "image/png");
    assert.equal(publicImage.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(Buffer.from(await publicImage.arrayBuffer()), tinyPng);
  }, undefined, undefined, storage);
});

test("shop image upload enforces the 2 MB limit before storage", async () => {
  const storage = new FakeShopImageStorage();
  await withServer(new FakePayPal(), async (url) => {
    const suffix = Math.random().toString(36).slice(2, 10);
    const ownerSlug = `image-limit-${suffix}`;
    const shopSlug = `image-limit-shop-${suffix}`;
    const registration = await json(`${url}/api/v1/owners`, {
      method: "POST", headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Image owner", ownerSlug, email: `${suffix}@example.test`,
        password: "a-test-password-123", defaultCurrency: "JPY" }),
    });
    const ownerCookie = registration.response.headers.get("set-cookie")?.split(";", 1)[0];
    assert.ok(ownerCookie);
    const created = await json(`${url}/api/v1/dashboard/shops`, {
      method: "POST", headers: postHeaders(ownerCookie!), body: JSON.stringify({ name: "Image Shop", slug: shopSlug }),
    });
    assert.equal(created.response.status, 201);

    const oversized = await fetch(`${url}/api/v1/dashboard/${ownerSlug}/${shopSlug}/image`, {
      method: "PUT", headers: { cookie: ownerCookie!, origin, "content-type": "image/png" },
      body: new Uint8Array(2 * 1024 * 1024 + 1),
    });
    assert.equal(oversized.status, 413);
    assert.equal(storage.images.size, 0);
  }, undefined, undefined, storage);
});
