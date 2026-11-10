import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../../server/database.js";
import { applyCartOperations, readCart, listProducts, patchProduct, receiveProductStock } from "../../server/inventory.js";
import { beginRefund, cancelOrder, completeCapture, completeRefund, reserveOrder, setCreatedOrder } from "../../server/order-state.js";
import { ApiError } from "../../server/errors.js";

function session(db: ReturnType<typeof createDatabase>): string {
  const hash = "a".repeat(64);
  const now = new Date().toISOString();
  db.prepare("INSERT INTO visitor_sessions(session_hash, cart_version, expires_at, created_at) VALUES (?, 0, ?, ?)")
    .run(hash, new Date(Date.now() + 86_400_000).toISOString(), now);
  return hash;
}

function reserveYak(db: ReturnType<typeof createDatabase>, hash: string, quantity = 2) {
  const cart = applyCartOperations(db, hash, [{ action: "add", productId: "yakisoba", quantity }]);
  const order = reserveOrder(db, { sessionHash: hash, cartVersion: cart.cartVersion,
    catalogRevision: cart.catalogRevision, clientRequestKey: randomUUID() }).order;
  return setCreatedOrder(db, order.id, `PAYPAL-${order.id}`);
}

test("cart totals use catalog prices and adding a line reserves it atomically", () => {
  const db = createDatabase(":memory:");
  try {
    const hash = session(db);
    const cart = applyCartOperations(db, hash, [{ action: "add", productId: "yakisoba", quantity: 2 }]);
    assert.equal(cart.totalMinor, 1500);
    assert.equal(cart.items[0]?.lineTotalMinor, 1500);
    assert.equal(cart.cartVersion, 1);
    const reserved = reserveOrder(db, { sessionHash: hash, cartVersion: cart.cartVersion,
      catalogRevision: cart.catalogRevision, clientRequestKey: randomUUID() });
    assert.equal(listProducts(db).find((item) => item.id === "yakisoba")?.available, 22);
    assert.equal(reserved.order.total_minor, 1500);
  } finally { db.close(); }
});

test("capture moves reserved units into physical sales once; refund restores only by saved choice", () => {
  const db = createDatabase(":memory:");
  try {
    const hash = session(db);
    const order = reserveYak(db, hash);
    assert.equal(listProducts(db).find((item) => item.id === "yakisoba")?.available, 22);
    const paid = completeCapture(db, order.id, "CAPTURE-1");
    assert.equal(paid.state, "paid");
    assert.equal(paid.pickup_code?.length, 8);
    assert.equal(listProducts(db).find((item) => item.id === "yakisoba")?.stockOnHand, 22);
    assert.equal(listProducts(db).find((item) => item.id === "yakisoba")?.available, 22);
    assert.equal(completeCapture(db, order.id, "CAPTURE-1").state, "paid");
    beginRefund(db, order.id, true);
    assert.equal(completeRefund(db, order.id, "REFUND-1").state, "refunded");
    assert.equal(listProducts(db).find((item) => item.id === "yakisoba")?.stockOnHand, 24);
    assert.equal(completeRefund(db, order.id, "REFUND-1").restock_applied_at !== null, true);
  } finally { db.close(); }
});

test("cancellation releases the reservation without reducing on-hand stock", () => {
  const db = createDatabase(":memory:");
  try {
    const hash = session(db);
    const order = reserveYak(db, hash);
    assert.equal(listProducts(db).find((item) => item.id === "yakisoba")?.available, 22);
    assert.equal(cancelOrder(db, order.id).state, "cancelled");
    assert.equal(listProducts(db).find((item) => item.id === "yakisoba")?.stockOnHand, 24);
    assert.equal(listProducts(db).find((item) => item.id === "yakisoba")?.available, 24);
    assert.equal(cancelOrder(db, order.id).state, "cancelled");
  } finally { db.close(); }
});

test("stock edits cannot go below reservations and stale cart versions are rejected", () => {
  const db = createDatabase(":memory:");
  try {
    const hash = session(db);
    const cart = applyCartOperations(db, hash, [{ action: "add", productId: "yakisoba", quantity: 2 }]);
    reserveOrder(db, { sessionHash: hash, cartVersion: cart.cartVersion,
      catalogRevision: cart.catalogRevision, clientRequestKey: randomUUID() });
    assert.throws(() => patchProduct(db, "yakisoba", { stockOnHand: 1 }), (error: unknown) => error instanceof ApiError && error.status === 409);
    assert.equal(patchProduct(db, "yakisoba", { stockOnHand: 2 }).available, 0);
    const current = readCart(db, hash);
    assert.equal(current.cartVersion, 1);
  } finally { db.close(); }
});

test("received stock increments atomically within the catalog limit", () => {
  const db = createDatabase(":memory:");
  try {
    const receiptId = randomUUID();
    const receipt = receiveProductStock(db, "yakisoba", 3, receiptId);
    assert.equal(receipt.product.stockOnHand, 27);
    assert.equal(receipt.product.available, 27);
    assert.equal(receipt.applied, true);
    assert.equal(receiveProductStock(db, "yakisoba", 3, receiptId).applied, false);
    assert.equal(listProducts(db).find((item) => item.id === "yakisoba")?.stockOnHand, 27);
    assert.throws(() => receiveProductStock(db, "yakisoba", 2, receiptId), (error: unknown) => error instanceof ApiError && error.code === "stock_receipt_conflict");
    assert.throws(() => receiveProductStock(db, "yakisoba", 999, randomUUID()), (error: unknown) => error instanceof ApiError && error.code === "stock_limit");
    assert.throws(() => receiveProductStock(db, "missing", 1, randomUUID()), (error: unknown) => error instanceof ApiError && error.status === 404);
  } finally { db.close(); }
});
