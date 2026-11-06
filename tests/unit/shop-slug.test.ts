import assert from "node:assert/strict";
import test from "node:test";
import { isValidShopSlug, shopSlugFromName } from "../../src/lib/shop-slug.js";

test("shop names produce normalized URL slugs", () => {
  assert.equal(shopSlugFromName(""), "");
  assert.equal(shopSlugFromName("Little Harbor Market"), "little-harbor-market");
  assert.equal(shopSlugFromName("Café & Tea"), "cafe-tea");
  assert.equal(shopSlugFromName("New"), "new-shop");
  assert.equal(shopSlugFromName("東京の店"), "shop");
});

test("slug validation follows the public shop address rules", () => {
  assert.equal(isValidShopSlug("little-harbor-market"), true);
  assert.equal(isValidShopSlug("new"), false);
  assert.equal(isValidShopSlug("two--hyphens"), false);
  assert.equal(isValidShopSlug("ab"), false);
});
