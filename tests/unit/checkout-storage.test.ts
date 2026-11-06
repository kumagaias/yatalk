import assert from "node:assert/strict";
import test from "node:test";
import { checkoutStorageKey, persistCheckoutAttempt, readCheckoutAttempt } from "../../src/lib/checkout-storage.js";

test("paid checkout receipts stay available after a page return or reload", () => {
  const values = new Map<string, string>();
  const storage = {
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };

  persistCheckoutAttempt(storage, "checkout", {
    state: "paid", orderId: "local-order", pickupCode: "ABCD1234",
  });

  assert.deepEqual(JSON.parse(values.get("checkout")!), {
    state: "paid", orderId: "local-order", pickupCode: "ABCD1234",
  });
});

test("cancelled checkout attempts are removed from session storage", () => {
  const values = new Map<string, string>([["checkout", "stale"]]);
  const storage = {
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };

  persistCheckoutAttempt(storage, "checkout", { state: "cancelled" });

  assert.equal(values.has("checkout"), false);
});

test("shop checkout restoration never reads another shop or an unscoped legacy receipt", () => {
  const values = new Map<string, string>([["yatalk.checkout.v1", JSON.stringify({ state: "paid", orderId: "legacy" })]]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  assert.equal(readCheckoutAttempt(storage, "little-harbor-market"), null);
  persistCheckoutAttempt(storage, checkoutStorageKey("shop-a"), { state: "paid", orderId: "order-a" });
  assert.equal(readCheckoutAttempt(storage, "shop-b"), null);
  assert.equal(JSON.parse(readCheckoutAttempt(storage, "shop-a")!).orderId, "order-a");
  persistCheckoutAttempt(storage, checkoutStorageKey("shop-b"), { state: "ready", orderId: "order-b" });
  persistCheckoutAttempt(storage, checkoutStorageKey("shop-a"), { state: "cancelled" });
  assert.equal(JSON.parse(readCheckoutAttempt(storage, "shop-b")!).orderId, "order-b");
});
