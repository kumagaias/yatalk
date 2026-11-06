import assert from "node:assert/strict";
import test from "node:test";
import { persistCheckoutAttempt } from "../../src/lib/checkout-storage.js";

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
