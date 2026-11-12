import assert from "node:assert/strict";
import test from "node:test";
import { defaultShopCover, publicShopImageUrl } from "../../src/lib/shop-cover.js";

test("shops receive a stable bundled cover until a custom image is available", () => {
  assert.equal(defaultShopCover("owner/stall"), defaultShopCover("owner/stall"));
  assert.match(defaultShopCover("owner/stall"), /^\/shop-covers\/[a-z]+\.webp$/);
});

test("public image paths preserve tenant scope", () => {
  assert.equal(publicShopImageUrl("little-harbor", "market"), "/api/v1/owners/little-harbor/shops/market/image");
  assert.equal(publicShopImageUrl(undefined, "market"), "/api/v1/shops/market/image");
});
