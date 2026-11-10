import assert from "node:assert/strict";
import test from "node:test";
import { accessCodeRequestSchema, cartItemRequestSchema, cartOperationSchema, ownerRegistrationRequestSchema } from "../../shared/schemas.js";

test("cart operation actions enforce their quantity rules in model and browser requests", () => {
  for (const schema of [cartOperationSchema, cartItemRequestSchema]) {
    const input = (action: "add" | "set" | "remove", quantity: number) => ({ action, productId: "yakisoba", quantity,
      ...(schema === cartItemRequestSchema ? { cartVersion: 0, catalogRevision: 1 } : {}) });
    assert.equal(schema.safeParse(input("remove", 0)).success, true);
    assert.equal(schema.safeParse(input("remove", 1)).success, false);
    assert.equal(schema.safeParse(input("set", 0)).success, false);
    assert.equal(schema.safeParse(input("add", 1)).success, true);
  }
});

test("organizer access codes reject short passphrases", () => {
  assert.equal(accessCodeRequestSchema.safeParse({ accessCode: "too-short" }).success, false);
  assert.equal(accessCodeRequestSchema.safeParse({ accessCode: "a-random-passphrase" }).success, true);
  assert.equal(accessCodeRequestSchema.safeParse({ accessCode: "x".repeat(129) }).success, false);
});

test("free owner registration requires a five-character address", () => {
  const input = { displayName: "Shop owner", email: "owner@example.test", password: "long-enough-password", defaultCurrency: "JPY" };
  assert.equal(ownerRegistrationRequestSchema.safeParse({ ...input, ownerSlug: "four" }).success, false);
  assert.equal(ownerRegistrationRequestSchema.safeParse({ ...input, ownerSlug: "first" }).success, true);
});
