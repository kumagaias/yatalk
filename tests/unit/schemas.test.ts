import assert from "node:assert/strict";
import test from "node:test";
import { accessCodeRequestSchema, cartItemRequestSchema, cartOperationSchema } from "../../shared/schemas.js";

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
