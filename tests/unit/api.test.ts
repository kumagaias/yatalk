import assert from "node:assert/strict";
import test from "node:test";
import { resolveApiPath } from "../../src/lib/api.js";

test("shop pages scope existing customer API calls to the path tenant", () => {
  assert.equal(resolveApiPath("/api/menu", "/shops/omise-example"), "/api/v1/shops/omise-example/menu");
  assert.equal(resolveApiPath("/api/orders/order-1/capture", "/shops/omise-example/orders/order-1"),
    "/api/v1/shops/omise-example/orders/order-1/capture");
});

test("shop dashboards scope organizer operations to their shop", () => {
  assert.equal(resolveApiPath("/api/organizer/summary", "/dashboard/shops/omise-example"),
    "/api/v1/dashboard/shops/omise-example/summary");
  assert.equal(resolveApiPath("/api/organizer/products/p-1", "/dashboard/shops/omise-example"),
    "/api/v1/dashboard/shops/omise-example/products/p-1");
});

test("platform and legacy routes keep their existing API paths", () => {
  assert.equal(resolveApiPath("/api/menu", "/"), "/api/menu");
  assert.equal(resolveApiPath("/api/organizer/summary", "/dashboard"), "/api/organizer/summary");
});

test("explicit versioned API paths are not rewritten from the shop setup route", () => {
  assert.equal(resolveApiPath("/api/v1/shops", "/shops/new"), "/api/v1/shops");
  assert.equal(resolveApiPath("/api/v1/shops/slug-availability/sample", "/shops/new"),
    "/api/v1/shops/slug-availability/sample");
});
