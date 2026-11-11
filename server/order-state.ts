import { randomBytes, randomUUID } from "node:crypto";
import type { Db, FirestoreDb, SqliteDb } from "./database.js";
import { DEFAULT_SHOP_ID, incrementCatalogRevision } from "./database.js";
import { ApiError } from "./errors.js";
import { readCart } from "./inventory.js";
import type { CurrencyCode } from "../shared/currency.js";
import { formatPickupNumber, pickupDateForShop } from "./pickup-number.js";
import * as firestoreOrderState from "./firestore-order-state.js";

export type OrderState = "creating_payment" | "create_unknown" | "create_failed" | "pending_payment" | "capture_unknown" | "paid" | "cancelled" | "expired" | "collected" | "refund_unknown" | "refunded";
export interface OrderRow {
  id: string; shop_id: string; session_hash: string; client_request_key: string; request_fingerprint: string;
  cart_version: number; catalog_revision: number; state: OrderState; currency: CurrencyCode;
  total_minor: number; paypal_create_request_id: string; paypal_capture_request_id: string;
  paypal_refund_request_id: string; paypal_order_id: string | null; paypal_approve_url: string | null; paypal_capture_id: string | null;
  paypal_refund_id: string | null; pickup_code: string | null; pickup_number: string | null; pickup_date: string | null; expires_at: string;
  refund_restock_requested: number | null; restock_applied_at: string | null;
  create_attempt_started_at: string | null; captured_at: string | null; refunded_at: string | null;
  created_at: string; updated_at: string;
}

export interface OrderLineRow { product_id: string; display_name: string; unit_price_minor: number; quantity: number }

export function normalizeExpiredOrders(db: FirestoreDb, shopId?: string, now?: string): Promise<number>;
export function normalizeExpiredOrders(db: SqliteDb, shopId?: string, now?: string): number;
export function normalizeExpiredOrders(db: Db, shopId?: string, now?: string): number | Promise<number>;
export function normalizeExpiredOrders(db: Db, shopId = DEFAULT_SHOP_ID, now = new Date().toISOString()): number | Promise<number> {
  if ((db as FirestoreDb).firestoreBrand) return firestoreOrderState.normalizeExpiredOrders(db as FirestoreDb, shopId, now);
  const result = db.prepare(`UPDATE orders SET state = 'expired', updated_at = ?
    WHERE shop_id = ? AND state IN ('creating_payment', 'pending_payment', 'create_unknown') AND expires_at <= ?`).run(now, shopId, now);
  if (result.changes > 0) incrementCatalogRevision(db as SqliteDb, shopId);
  return result.changes;
}

export function findOrder(db: FirestoreDb, orderId: string, shopId?: string): Promise<OrderRow | undefined>;
export function findOrder(db: SqliteDb, orderId: string, shopId?: string): OrderRow | undefined;
export function findOrder(db: Db, orderId: string, shopId?: string): OrderRow | undefined | Promise<OrderRow | undefined>;
export function findOrder(db: Db, orderId: string, shopId?: string): OrderRow | undefined | Promise<OrderRow | undefined> {
  if ((db as FirestoreDb).firestoreBrand) return firestoreOrderState.findOrder(db as FirestoreDb, orderId, shopId);
  const query = shopId ? "SELECT * FROM orders WHERE id = ? AND shop_id = ?" : "SELECT * FROM orders WHERE id = ?";
  return (shopId ? db.prepare(query).get(orderId, shopId) : db.prepare(query).get(orderId)) as OrderRow | undefined;
}

export function findOrderByClientRequest(db: FirestoreDb, sessionHash: string, requestKey: string, shopId: string): Promise<OrderRow | undefined>;
export function findOrderByClientRequest(db: SqliteDb, sessionHash: string, requestKey: string, shopId: string): OrderRow | undefined;
export function findOrderByClientRequest(db: Db, sessionHash: string, requestKey: string, shopId: string): OrderRow | undefined | Promise<OrderRow | undefined>;
export function findOrderByClientRequest(db: Db, sessionHash: string, requestKey: string, shopId: string): OrderRow | undefined | Promise<OrderRow | undefined> {
  if ((db as FirestoreDb).firestoreBrand) return firestoreOrderState.findOrderByClientRequest(db as FirestoreDb, sessionHash, requestKey, shopId);
  return db.prepare("SELECT * FROM orders WHERE shop_id = ? AND session_hash = ? AND client_request_key = ?")
    .get(shopId, sessionHash, requestKey) as OrderRow | undefined;
}

export function findOrderByPaypalOrderId(db: FirestoreDb, paypalOrderId: string): Promise<OrderRow | undefined>;
export function findOrderByPaypalOrderId(db: SqliteDb, paypalOrderId: string): OrderRow | undefined;
export function findOrderByPaypalOrderId(db: Db, paypalOrderId: string): OrderRow | undefined | Promise<OrderRow | undefined>;
export function findOrderByPaypalOrderId(db: Db, paypalOrderId: string): OrderRow | undefined | Promise<OrderRow | undefined> {
  if ((db as FirestoreDb).firestoreBrand) return firestoreOrderState.findOrderByPaypalOrderId(db as FirestoreDb, paypalOrderId);
  return db.prepare("SELECT * FROM orders WHERE paypal_order_id = ?").get(paypalOrderId) as OrderRow | undefined;
}

export function findOrderByCaptureId(db: FirestoreDb, captureId: string): Promise<OrderRow | undefined>;
export function findOrderByCaptureId(db: SqliteDb, captureId: string): OrderRow | undefined;
export function findOrderByCaptureId(db: Db, captureId: string): OrderRow | undefined | Promise<OrderRow | undefined>;
export function findOrderByCaptureId(db: Db, captureId: string): OrderRow | undefined | Promise<OrderRow | undefined> {
  if ((db as FirestoreDb).firestoreBrand) return firestoreOrderState.findOrderByCaptureId(db as FirestoreDb, captureId);
  return db.prepare("SELECT * FROM orders WHERE paypal_capture_id = ?").get(captureId) as OrderRow | undefined;
}

export function listOrderLines(db: FirestoreDb, orderId: string, shopId?: string): Promise<OrderLineRow[]>;
export function listOrderLines(db: SqliteDb, orderId: string, shopId?: string): OrderLineRow[];
export function listOrderLines(db: Db, orderId: string, shopId?: string): OrderLineRow[] | Promise<OrderLineRow[]>;
export function listOrderLines(db: Db, orderId: string, shopId?: string): OrderLineRow[] | Promise<OrderLineRow[]> {
  if ((db as FirestoreDb).firestoreBrand) return firestoreOrderState.listOrderLines(db as FirestoreDb, orderId, shopId);
  const query = shopId
    ? "SELECT product_id, display_name, unit_price_minor, quantity FROM order_items WHERE order_id = ? AND shop_id = ? ORDER BY display_name COLLATE NOCASE"
    : "SELECT product_id, display_name, unit_price_minor, quantity FROM order_items WHERE order_id = ? ORDER BY display_name COLLATE NOCASE";
  return (shopId ? db.prepare(query).all(orderId, shopId) : db.prepare(query).all(orderId)) as OrderLineRow[];
}

export function listPendingPaymentOrders(db: FirestoreDb, shopId: string): Promise<OrderRow[]>;
export function listPendingPaymentOrders(db: SqliteDb, shopId: string): OrderRow[];
export function listPendingPaymentOrders(db: Db, shopId: string): OrderRow[] | Promise<OrderRow[]>;
export function listPendingPaymentOrders(db: Db, shopId: string): OrderRow[] | Promise<OrderRow[]> {
  if ((db as FirestoreDb).firestoreBrand) return firestoreOrderState.listPendingPaymentOrders(db as FirestoreDb, shopId);
  return db.prepare(`SELECT * FROM orders WHERE shop_id = ? AND state = 'pending_payment'
    AND expires_at > ? ORDER BY created_at ASC LIMIT 50`).all(shopId, new Date().toISOString()) as OrderRow[];
}

export interface ReservationInput {
  sessionHash: string; clientRequestKey: string; cartVersion: number; catalogRevision: number; shopId?: string;
}

export interface ReservedOrder { order: OrderRow; fingerprint: string; }

export function reserveOrder(db: FirestoreDb, input: ReservationInput): Promise<ReservedOrder>;
export function reserveOrder(db: SqliteDb, input: ReservationInput): ReservedOrder;
export function reserveOrder(db: Db, input: ReservationInput): ReservedOrder | Promise<ReservedOrder>;
export function reserveOrder(db: Db, input: ReservationInput): ReservedOrder | Promise<ReservedOrder> {
  if ((db as FirestoreDb).firestoreBrand) return firestoreOrderState.reserveOrder(db as FirestoreDb, input);
  const shopId = input.shopId ?? DEFAULT_SHOP_ID;
  const transaction = db.transaction(() => {
    normalizeExpiredOrders(db as SqliteDb, shopId);
    const cart = readCart(db as SqliteDb, input.sessionHash, shopId);
    if (cart.cartVersion !== input.cartVersion || cart.catalogRevision !== input.catalogRevision) {
      throw new ApiError(409, "cart_changed", "The menu or cart changed. Review the current cart.", { cart });
    }
    if (!cart.items.length) throw new ApiError(400, "empty_cart", "Add an item before checkout.");
    for (const item of cart.items) {
      if (!item.active || item.quantity > item.available) {
        throw new ApiError(409, "stock_changed", "An item is no longer available in that quantity.", { cart });
      }
    }
    const fingerprint = JSON.stringify({ cartVersion: input.cartVersion, catalogRevision: input.catalogRevision,
      items: cart.items.map(({ id, quantity, priceMinor }) => ({ id, quantity, priceMinor })) });
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const id = randomUUID();
    db.prepare(`INSERT INTO orders(id, shop_id, session_hash, client_request_key, request_fingerprint, cart_version, catalog_revision,
      state, currency, total_minor, paypal_create_request_id, paypal_capture_request_id, paypal_refund_request_id,
      expires_at, create_attempt_started_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'creating_payment', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, shopId, input.sessionHash, input.clientRequestKey, fingerprint, input.cartVersion, input.catalogRevision,
        cart.currency, cart.totalMinor, randomUUID(), randomUUID(), randomUUID(), expiresAt, now, now, now);
    const insertLine = db.prepare(`INSERT INTO order_items(order_id, shop_id, product_id, display_name, unit_price_minor, quantity)
      VALUES (?, ?, ?, ?, ?, ?)`);
    for (const item of cart.items) insertLine.run(id, shopId, item.id, item.name, item.priceMinor, item.quantity);
    incrementCatalogRevision(db as SqliteDb, shopId);
    return { order: findOrder(db as SqliteDb, id, shopId)!, fingerprint };
  });
  return transaction.immediate();
}

export function setCreatedOrder(db: FirestoreDb, orderId: string, paypalOrderId: string, shopId?: string, approveUrl?: string | null): Promise<OrderRow>;
export function setCreatedOrder(db: SqliteDb, orderId: string, paypalOrderId: string, shopId?: string, approveUrl?: string | null): OrderRow;
export function setCreatedOrder(db: Db, orderId: string, paypalOrderId: string, shopId?: string, approveUrl?: string | null): OrderRow | Promise<OrderRow>;
export function setCreatedOrder(db: Db, orderId: string, paypalOrderId: string, shopId = DEFAULT_SHOP_ID, approveUrl: string | null = null): OrderRow | Promise<OrderRow> {
  if ((db as FirestoreDb).firestoreBrand) return firestoreOrderState.setCreatedOrder(db as FirestoreDb, orderId, paypalOrderId, shopId, approveUrl);
  const transaction = db.transaction(() => {
    const order = findOrder(db as SqliteDb, orderId, shopId);
    if (!order || order.state !== "creating_payment" && order.state !== "create_unknown") {
      throw new ApiError(409, "order_state_conflict", "This order is no longer awaiting PayPal checkout.");
    }
    db.prepare(`UPDATE orders SET paypal_order_id = ?, paypal_approve_url = ?, state = 'pending_payment', updated_at = ? WHERE id = ? AND shop_id = ?`)
      .run(paypalOrderId, approveUrl, new Date().toISOString(), orderId, shopId);
    incrementCatalogRevision(db as SqliteDb, shopId);
    return findOrder(db as SqliteDb, orderId, shopId)!;
  });
  return transaction.immediate();
}

export function failOrderCreate(db: FirestoreDb, orderId: string, unknown: boolean, shopId?: string): Promise<void>;
export function failOrderCreate(db: SqliteDb, orderId: string, unknown: boolean, shopId?: string): void;
export function failOrderCreate(db: Db, orderId: string, unknown: boolean, shopId?: string): void | Promise<void>;
export function failOrderCreate(db: Db, orderId: string, unknown: boolean, shopId = DEFAULT_SHOP_ID): void | Promise<void> {
  if ((db as FirestoreDb).firestoreBrand) return firestoreOrderState.failOrderCreate(db as FirestoreDb, orderId, unknown, shopId);
  const next: OrderState = unknown ? "create_unknown" : "create_failed";
  const transaction = db.transaction(() => {
    db.prepare(`UPDATE orders SET state = ?, updated_at = ? WHERE id = ? AND shop_id = ? AND state IN ('creating_payment', 'create_unknown')`)
      .run(next, new Date().toISOString(), orderId, shopId);
    incrementCatalogRevision(db as SqliteDb, shopId);
  });
  transaction.immediate();
}

export function markCaptureUnknown(db: FirestoreDb, orderId: string, shopId?: string): Promise<void>;
export function markCaptureUnknown(db: SqliteDb, orderId: string, shopId?: string): void;
export function markCaptureUnknown(db: Db, orderId: string, shopId?: string): void | Promise<void>;
export function markCaptureUnknown(db: Db, orderId: string, shopId = DEFAULT_SHOP_ID): void | Promise<void> {
  if ((db as FirestoreDb).firestoreBrand) return firestoreOrderState.markCaptureUnknown(db as FirestoreDb, orderId, shopId);
  const transaction = db.transaction(() => {
    const result = db.prepare(`UPDATE orders SET state = 'capture_unknown', updated_at = ? WHERE id = ? AND shop_id = ? AND state = 'pending_payment'`)
      .run(new Date().toISOString(), orderId, shopId);
    if (result.changes > 0) incrementCatalogRevision(db as SqliteDb, shopId);
  });
  transaction.immediate();
}

export function claimCaptureCheck(db: FirestoreDb, orderId: string, shopId?: string): Promise<void>;
export function claimCaptureCheck(db: SqliteDb, orderId: string, shopId?: string): void;
export function claimCaptureCheck(db: Db, orderId: string, shopId?: string): void | Promise<void>;
export function claimCaptureCheck(db: Db, orderId: string, shopId = DEFAULT_SHOP_ID): void | Promise<void> {
  if ((db as FirestoreDb).firestoreBrand) return firestoreOrderState.claimCaptureCheck(db as FirestoreDb, orderId, shopId);
  const transaction = db.transaction(() => {
    const order = findOrder(db as SqliteDb, orderId, shopId);
    if (!order || order.state !== "pending_payment" && order.state !== "capture_unknown") {
      throw new ApiError(409, "order_state_conflict", "This order is no longer awaiting payment verification.");
    }
    if (order.state === "pending_payment" && Date.parse(order.expires_at) <= Date.now()) {
      throw new ApiError(409, "order_expired", "This checkout has expired. Start a new order.");
    }
    if (order.state !== "capture_unknown") {
      db.prepare("UPDATE orders SET state = 'capture_unknown', updated_at = ? WHERE id = ? AND shop_id = ? AND state = 'pending_payment'")
        .run(new Date().toISOString(), orderId, shopId);
      incrementCatalogRevision(db as SqliteDb, shopId);
    }
  });
  transaction.immediate();
}

export function resolveNoCapture(db: FirestoreDb, orderId: string, shopId?: string): Promise<"pending_payment" | "expired" | null>;
export function resolveNoCapture(db: SqliteDb, orderId: string, shopId?: string): "pending_payment" | "expired" | null;
export function resolveNoCapture(db: Db, orderId: string, shopId?: string): "pending_payment" | "expired" | null | Promise<"pending_payment" | "expired" | null>;
export function resolveNoCapture(db: Db, orderId: string, shopId = DEFAULT_SHOP_ID): "pending_payment" | "expired" | null | Promise<"pending_payment" | "expired" | null> {
  if ((db as FirestoreDb).firestoreBrand) return firestoreOrderState.resolveNoCapture(db as FirestoreDb, orderId, shopId);
  const transaction = db.transaction(() => {
    const order = findOrder(db as SqliteDb, orderId, shopId);
    if (order?.state !== "capture_unknown") return null;
    const nextState = Date.parse(order.expires_at) <= Date.now() ? "expired" : "pending_payment";
    const result = db.prepare("UPDATE orders SET state = ?, updated_at = ? WHERE id = ? AND shop_id = ? AND state = 'capture_unknown'")
      .run(nextState, new Date().toISOString(), orderId, shopId);
    if (result.changes > 0) incrementCatalogRevision(db as SqliteDb, shopId);
    return result.changes > 0 ? nextState : null;
  });
  return transaction.immediate();
}

function newPickupCode(db: Db): string {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomBytes(4).toString("hex").toUpperCase();
    if (!db.prepare("SELECT 1 FROM orders WHERE pickup_code = ?").get(code)) return code;
  }
  throw new Error("Unable to allocate pickup code");
}

function clearCartIfUnchanged(db: Db, order: OrderRow): void {
  const session = db.prepare("SELECT cart_version FROM visitor_sessions WHERE session_hash = ? AND shop_id = ?")
    .get(order.session_hash, order.shop_id) as { cart_version: number } | undefined;
  if (!session || session.cart_version !== order.cart_version) return;

  const cartItems = db.prepare(`SELECT ci.product_id, ci.quantity, p.name AS display_name, p.price_minor AS unit_price_minor
    FROM cart_items ci JOIN products p ON p.id = ci.product_id AND p.shop_id = ci.shop_id
    WHERE ci.session_hash = ? AND ci.shop_id = ? ORDER BY ci.product_id`).all(order.session_hash, order.shop_id) as OrderLineRow[];
    const orderItems = listOrderLines(db as SqliteDb, order.id, order.shop_id).sort((left, right) => left.product_id.localeCompare(right.product_id));
  if (cartItems.length !== orderItems.length || cartItems.some((item, index) => {
    const ordered = orderItems[index];
    return !ordered || item.product_id !== ordered.product_id || item.quantity !== ordered.quantity ||
      item.display_name !== ordered.display_name || item.unit_price_minor !== ordered.unit_price_minor;
  })) return;

  const deleted = db.prepare("DELETE FROM cart_items WHERE session_hash = ? AND shop_id = ?").run(order.session_hash, order.shop_id);
  if (deleted.changes !== cartItems.length) throw new Error("Captured order cart changed during finalization");
  const updated = db.prepare(`UPDATE visitor_sessions SET cart_version = cart_version + 1
    WHERE session_hash = ? AND shop_id = ? AND cart_version = ?`).run(order.session_hash, order.shop_id, order.cart_version);
  if (updated.changes !== 1) throw new Error("Captured order cart version changed during finalization");
}

export function completeCapture(db: FirestoreDb, orderId: string, captureId: string, shopId?: string): Promise<OrderRow>;
export function completeCapture(db: SqliteDb, orderId: string, captureId: string, shopId?: string): OrderRow;
export function completeCapture(db: Db, orderId: string, captureId: string, shopId?: string): OrderRow | Promise<OrderRow>;
export function completeCapture(db: Db, orderId: string, captureId: string, shopId?: string): OrderRow | Promise<OrderRow> {
  if ((db as FirestoreDb).firestoreBrand) return firestoreOrderState.completeCapture(db as FirestoreDb, orderId, captureId, shopId);
  const transaction = db.transaction(() => {
    const order = findOrder(db as SqliteDb, orderId, shopId);
    if (!order) throw new ApiError(404, "order_not_found", "Order was not found.");
    if (order.state === "paid" || order.state === "collected") return order;
    if (order.state !== "pending_payment" && order.state !== "capture_unknown") {
      throw new ApiError(409, "order_state_conflict", "This order cannot be captured in its current state.");
    }
    const lines = listOrderLines(db as SqliteDb, orderId, order.shop_id);
    const deduct = db.prepare("UPDATE products SET stock_on_hand = stock_on_hand - ?, updated_at = ? WHERE id = ? AND shop_id = ? AND stock_on_hand >= ?");
    for (const line of lines) {
      const result = deduct.run(line.quantity, new Date().toISOString(), line.product_id, order.shop_id, line.quantity);
      if (result.changes !== 1) throw new ApiError(409, "stock_invariant", "Reserved inventory could not be finalized.");
    }
    clearCartIfUnchanged(db, order);
    const capturedAt = new Date().toISOString();
    const shop = db.prepare("SELECT time_zone FROM shops WHERE id = ?").get(order.shop_id) as { time_zone: string } | undefined;
    const pickupDate = pickupDateForShop(new Date(capturedAt), shop?.time_zone ?? "Asia/Tokyo");
    const current = db.prepare(`SELECT MAX(CAST(pickup_number AS INTEGER)) AS current FROM orders
      WHERE shop_id = ? AND pickup_date = ?`).get(order.shop_id, pickupDate) as { current: number | null };
    const pickupNumber = formatPickupNumber((current.current ?? 0) + 1);
    db.prepare(`UPDATE orders SET state = 'paid', paypal_capture_id = ?, pickup_code = ?, pickup_number = ?, pickup_date = ?,
      captured_at = ?, updated_at = ? WHERE id = ? AND shop_id = ?`)
      .run(captureId, newPickupCode(db), pickupNumber, pickupDate, capturedAt, capturedAt, orderId, order.shop_id);
    incrementCatalogRevision(db as SqliteDb, order.shop_id);
    return findOrder(db as SqliteDb, orderId, order.shop_id)!;
  });
  return transaction.immediate();
}

export function cancelOrder(db: FirestoreDb, orderId: string, shopId?: string): Promise<OrderRow>;
export function cancelOrder(db: SqliteDb, orderId: string, shopId?: string): OrderRow;
export function cancelOrder(db: Db, orderId: string, shopId?: string): OrderRow | Promise<OrderRow>;
export function cancelOrder(db: Db, orderId: string, shopId = DEFAULT_SHOP_ID): OrderRow | Promise<OrderRow> {
  if ((db as FirestoreDb).firestoreBrand) return firestoreOrderState.cancelOrder(db as FirestoreDb, orderId, shopId);
  const transaction = db.transaction(() => {
    const order = findOrder(db as SqliteDb, orderId, shopId);
    if (!order) throw new ApiError(404, "order_not_found", "Order was not found.");
    if (order.state === "cancelled" || order.state === "expired") return order;
    if (order.state !== "pending_payment") throw new ApiError(409, "order_state_conflict", "This order cannot be cancelled in its current state.");
    db.prepare("UPDATE orders SET state = 'cancelled', updated_at = ? WHERE id = ? AND shop_id = ? AND state = 'pending_payment'")
      .run(new Date().toISOString(), orderId, shopId);
    incrementCatalogRevision(db as SqliteDb, shopId);
    return findOrder(db as SqliteDb, orderId, shopId)!;
  });
  return transaction.immediate();
}

export function beginRefund(db: FirestoreDb, orderId: string, restock: boolean, shopId?: string): Promise<OrderRow>;
export function beginRefund(db: SqliteDb, orderId: string, restock: boolean, shopId?: string): OrderRow;
export function beginRefund(db: Db, orderId: string, restock: boolean, shopId?: string): OrderRow | Promise<OrderRow>;
export function beginRefund(db: Db, orderId: string, restock: boolean, shopId = DEFAULT_SHOP_ID): OrderRow | Promise<OrderRow> {
  if ((db as FirestoreDb).firestoreBrand) return firestoreOrderState.beginRefund(db as FirestoreDb, orderId, restock, shopId);
  const transaction = db.transaction(() => {
    const order = findOrder(db as SqliteDb, orderId, shopId);
    if (!order) throw new ApiError(404, "order_not_found", "Order was not found.");
    if (order.state === "refunded" || order.state === "refund_unknown") {
      if (order.refund_restock_requested !== Number(restock)) throw new ApiError(409, "refund_choice_conflict", "Retry with the original stock-restoration choice.");
      return order;
    }
    if (order.state !== "paid") throw new ApiError(409, "order_state_conflict", "Only an uncollected paid order can be refunded.");
    if (order.refund_restock_requested !== null && order.refund_restock_requested !== Number(restock)) {
      throw new ApiError(409, "refund_choice_conflict", "Retry with the original stock-restoration choice.");
    }
    db.prepare(`UPDATE orders SET state = 'refund_unknown', refund_restock_requested = ?, updated_at = ?
      WHERE id = ? AND shop_id = ? AND state = 'paid'`).run(Number(restock), new Date().toISOString(), orderId, shopId);
    return findOrder(db as SqliteDb, orderId, shopId)!;
  });
  return transaction.immediate();
}

export function refundRejected(db: FirestoreDb, orderId: string, shopId?: string): Promise<void>;
export function refundRejected(db: SqliteDb, orderId: string, shopId?: string): void;
export function refundRejected(db: Db, orderId: string, shopId?: string): void | Promise<void>;
export function refundRejected(db: Db, orderId: string, shopId = DEFAULT_SHOP_ID): void | Promise<void> {
  if ((db as FirestoreDb).firestoreBrand) return firestoreOrderState.refundRejected(db as FirestoreDb, orderId, shopId);
  const transaction = db.transaction(() => {
    db.prepare(`UPDATE orders SET state = 'paid', updated_at = ? WHERE id = ? AND shop_id = ? AND state = 'refund_unknown'`)
      .run(new Date().toISOString(), orderId, shopId);
  });
  transaction.immediate();
}

export function completeRefund(db: FirestoreDb, orderId: string, refundId: string, shopId?: string): Promise<OrderRow>;
export function completeRefund(db: SqliteDb, orderId: string, refundId: string, shopId?: string): OrderRow;
export function completeRefund(db: Db, orderId: string, refundId: string, shopId?: string): OrderRow | Promise<OrderRow>;
export function completeRefund(db: Db, orderId: string, refundId: string, shopId?: string): OrderRow | Promise<OrderRow> {
  if ((db as FirestoreDb).firestoreBrand) return firestoreOrderState.completeRefund(db as FirestoreDb, orderId, refundId, shopId);
  const transaction = db.transaction(() => {
    const order = findOrder(db as SqliteDb, orderId, shopId);
    if (!order) throw new ApiError(404, "order_not_found", "Order was not found.");
    if (order.state === "refunded") return order;
    if (order.state !== "refund_unknown" || order.refund_restock_requested === null) {
      throw new ApiError(409, "order_state_conflict", "This order is not awaiting a refund result.");
    }
    const now = new Date().toISOString();
    if (order.refund_restock_requested === 1 && !order.restock_applied_at) {
      const lines = listOrderLines(db as SqliteDb, orderId, order.shop_id);
      const restock = db.prepare("UPDATE products SET stock_on_hand = stock_on_hand + ?, updated_at = ? WHERE id = ? AND shop_id = ?");
      for (const line of lines) restock.run(line.quantity, now, line.product_id, order.shop_id);
    }
    db.prepare(`UPDATE orders SET state = 'refunded', paypal_refund_id = ?, restock_applied_at = ?, refunded_at = ?, updated_at = ?
      WHERE id = ? AND shop_id = ? AND state = 'refund_unknown'`)
      .run(refundId, order.refund_restock_requested === 1 ? now : null, now, now, orderId, order.shop_id);
    incrementCatalogRevision(db as SqliteDb, order.shop_id);
    return findOrder(db as SqliteDb, orderId, order.shop_id)!;
  });
  return transaction.immediate();
}

export function transitionCollected(db: FirestoreDb, orderId: string, shopId?: string): Promise<OrderRow>;
export function transitionCollected(db: SqliteDb, orderId: string, shopId?: string): OrderRow;
export function transitionCollected(db: Db, orderId: string, shopId?: string): OrderRow | Promise<OrderRow>;
export function transitionCollected(db: Db, orderId: string, shopId = DEFAULT_SHOP_ID): OrderRow | Promise<OrderRow> {
  if ((db as FirestoreDb).firestoreBrand) return firestoreOrderState.transitionCollected(db as FirestoreDb, orderId, shopId);
  const transaction = db.transaction(() => {
    const order = findOrder(db as SqliteDb, orderId, shopId);
    if (!order) throw new ApiError(404, "order_not_found", "Order was not found.");
    if (order.state === "collected") return order;
    if (order.state !== "paid") throw new ApiError(409, "order_state_conflict", "Only a paid order can be collected.");
    db.prepare("UPDATE orders SET state = 'collected', updated_at = ? WHERE id = ? AND shop_id = ? AND state = 'paid'")
      .run(new Date().toISOString(), orderId, shopId);
    return findOrder(db as SqliteDb, orderId, shopId)!;
  });
  return transaction.immediate();
}
