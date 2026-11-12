import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { FirestoreDocument } from "./firestore-store.js";
import type { StoreTransaction } from "./firestore-store.js";
import type { FirestoreDb } from "./database.js";
import { DEFAULT_SHOP_ID } from "./database.js";
import { ApiError } from "./errors.js";
import { formatPickupNumber, pickupDateForShop } from "./pickup-number.js";
import type { OrderLineRow, OrderRow, OrderState, ReservationInput, ReservedOrder } from "./order-state.js";

type OrderLine = OrderLineRow & { shopId: string };
type OrderDoc = FirestoreDocument & {
  id: string; shopId: string; sessionHash: string; clientRequestKey: string; requestFingerprint: string;
  cartVersion: number; catalogRevision: number; state: OrderState; currency: string; totalMinor: number;
  paypalCreateRequestId: string; paypalCaptureRequestId: string; paypalRefundRequestId: string;
  paypalOrderId: string | null; paypalApproveUrl?: string | null; paypalCaptureId: string | null; paypalRefundId: string | null;
  pickupCode: string | null; pickupNumber?: string | null; pickupDate?: string | null;
  expiresAt: string; refundRestockRequested: number | null; restockAppliedAt: string | null;
  createAttemptStartedAt: string | null; capturedAt: string | null; refundedAt: string | null;
  createdAt: string; updatedAt: string; items: OrderLine[];
};
type ProductDoc = FirestoreDocument & { id: string; shopId: string; stockOnHand: number; reservedQuantity: number; name: string; priceMinor: number };
type ShopDoc = FirestoreDocument & { catalogRevision: number; timeZone?: string };
type SessionDoc = FirestoreDocument & { shopId: string; cartVersion: number };
type CartLineDoc = FirestoreDocument & { id: string; shopId: string; sessionHash: string; productId: string; quantity: number };

function orderKey(sessionHash: string, requestKey: string): string {
  return createHash("sha256").update(`${sessionHash}\0${requestKey}`).digest("hex");
}

function orderRow(doc: OrderDoc): OrderRow {
  return {
    id: doc.id, shop_id: doc.shopId, session_hash: doc.sessionHash, client_request_key: doc.clientRequestKey,
    request_fingerprint: doc.requestFingerprint, cart_version: doc.cartVersion, catalog_revision: doc.catalogRevision,
    state: doc.state, currency: doc.currency as OrderRow["currency"], total_minor: doc.totalMinor,
    paypal_create_request_id: doc.paypalCreateRequestId, paypal_capture_request_id: doc.paypalCaptureRequestId,
    paypal_refund_request_id: doc.paypalRefundRequestId, paypal_order_id: doc.paypalOrderId, paypal_approve_url: doc.paypalApproveUrl ?? null,
    paypal_capture_id: doc.paypalCaptureId, paypal_refund_id: doc.paypalRefundId, pickup_code: doc.pickupCode,
    pickup_number: doc.pickupNumber ?? null, pickup_date: doc.pickupDate ?? null,
    expires_at: doc.expiresAt, refund_restock_requested: doc.refundRestockRequested,
    restock_applied_at: doc.restockAppliedAt, create_attempt_started_at: doc.createAttemptStartedAt,
    captured_at: doc.capturedAt, refunded_at: doc.refundedAt, created_at: doc.createdAt, updated_at: doc.updatedAt,
  };
}

function lineRows(doc: OrderDoc): OrderLineRow[] {
  return (doc.items ?? []).map(({ product_id, display_name, unit_price_minor, quantity }) => ({
    product_id, display_name, unit_price_minor, quantity,
  })).sort((left, right) => left.display_name.localeCompare(right.display_name));
}

async function orderById(db: FirestoreDb, id: string, shopId?: string): Promise<OrderDoc | undefined> {
  const order = await db.firestoreStore.get<OrderDoc>("orders", id);
  return order && (!shopId || order.shopId === shopId) ? order : undefined;
}

async function releaseReservations(transaction: StoreTransaction, order: OrderDoc,
  products: Array<ProductDoc | undefined>): Promise<void> {
  for (let index = 0; index < order.items.length; index += 1) {
    const line = order.items[index]!;
    const product = products[index];
    if (!product || product.shopId !== order.shopId || product.reservedQuantity < line.quantity) {
      throw new ApiError(409, "stock_invariant", "Reserved inventory could not be released safely.");
    }
    transaction.update("products", line.product_id, { reservedQuantity: product.reservedQuantity - line.quantity, updatedAt: new Date().toISOString() });
  }
}

export async function findOrder(db: FirestoreDb, orderId: string, shopId?: string): Promise<OrderRow | undefined> {
  const order = await orderById(db, orderId, shopId);
  return order ? orderRow(order) : undefined;
}

export async function findOrderByClientRequest(db: FirestoreDb, sessionHash: string, requestKey: string, shopId: string): Promise<OrderRow | undefined> {
  const key = orderKey(sessionHash, requestKey);
  const index = await db.firestoreStore.get<{ orderId: string } & FirestoreDocument>("orderRequestKeys", key);
  if (!index) return undefined;
  const order = await orderById(db, index.orderId, shopId);
  return order ? orderRow(order) : undefined;
}

export async function findOrderByPaypalOrderId(db: FirestoreDb, paypalOrderId: string): Promise<OrderRow | undefined> {
  const index = await db.firestoreStore.get<{ orderId: string } & FirestoreDocument>("paypalOrderIds", paypalOrderId);
  if (!index) return undefined;
  const order = await orderById(db, index.orderId);
  return order ? orderRow(order) : undefined;
}

export async function findOrderByCaptureId(db: FirestoreDb, captureId: string): Promise<OrderRow | undefined> {
  const index = await db.firestoreStore.get<{ orderId: string } & FirestoreDocument>("paypalCaptureIds", captureId);
  if (!index) return undefined;
  const order = await orderById(db, index.orderId);
  return order ? orderRow(order) : undefined;
}

export async function listOrderLines(db: FirestoreDb, orderId: string, shopId?: string): Promise<OrderLineRow[]> {
  const order = await orderById(db, orderId, shopId);
  return order ? lineRows(order) : [];
}

export async function listPendingPaymentOrders(db: FirestoreDb, shopId: string): Promise<OrderRow[]> {
  const rows = await db.firestoreStore.query<OrderDoc>("orders", [
    { field: "shopId", op: "==", value: shopId },
    { field: "state", op: "==", value: "pending_payment" },
  ], { field: "createdAt", direction: "asc" }, 50);
  const now = Date.now();
  return rows.filter((order) => Date.parse(order.expiresAt) > now).map(orderRow);
}

export async function normalizeExpiredOrders(db: FirestoreDb, shopId = DEFAULT_SHOP_ID, now = new Date().toISOString()): Promise<number> {
  const expired = await db.firestoreStore.query<OrderDoc>("orders", [
    { field: "shopId", op: "==", value: shopId },
    { field: "state", op: "in", value: ["creating_payment", "pending_payment", "create_unknown"] },
    { field: "expiresAt", op: "<=", value: now },
  ], { field: "expiresAt", direction: "asc" }, 50);
  let changed = 0;
  for (const candidate of expired) {
    const didChange = await db.firestoreStore.runTransaction(async (transaction) => {
      const order = await transaction.get<OrderDoc>("orders", candidate.id);
      if (!order || !["creating_payment", "pending_payment", "create_unknown"].includes(order.state) || order.expiresAt > now) return false;
      const [shop, products] = await Promise.all([
        transaction.get<ShopDoc>("shops", shopId),
        Promise.all(order.items.map((line) => transaction.get<ProductDoc>("products", line.product_id))),
      ]);
      if (!shop) throw new Error("Shop was not found");
      await releaseReservations(transaction, order, products);
      transaction.update("orders", order.id, { state: "expired", updatedAt: now });
      transaction.update("shops", shopId, { catalogRevision: shop.catalogRevision + 1, updatedAt: now });
      return true;
    });
    if (didChange) changed += 1;
  }
  return changed;
}

export async function reserveOrder(db: FirestoreDb, input: ReservationInput): Promise<ReservedOrder> {
  const shopId = input.shopId ?? DEFAULT_SHOP_ID;
  const key = orderKey(input.sessionHash, input.clientRequestKey);
  const id = randomUUID();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  return db.firestoreStore.runTransaction(async (transaction) => {
    const idempotency = await transaction.get<{ orderId: string } & FirestoreDocument>("orderRequestKeys", key);
    if (idempotency) {
      const existing = await transaction.get<OrderDoc>("orders", idempotency.orderId);
      if (existing && existing.shopId === shopId) {
        if (existing.cartVersion !== input.cartVersion || existing.catalogRevision !== input.catalogRevision) {
          throw new ApiError(409, "idempotency_conflict", "This request key was already used with different cart versions.");
        }
        return { order: orderRow(existing), fingerprint: existing.requestFingerprint };
      }
    }
    const [session, shop, cartRows] = await Promise.all([
      transaction.get<SessionDoc>("visitorSessions", input.sessionHash),
      transaction.get<ShopDoc & { currency: OrderDoc["currency"] }>("shops", shopId),
      transaction.query<CartLineDoc>("cartItems", [{ field: "sessionHash", op: "==", value: input.sessionHash }]),
    ]);
    if (!session || session.shopId !== shopId) throw new ApiError(401, "visitor_session_required", "Refresh the page to start a new session.");
    if (!shop) throw new ApiError(404, "shop_not_found", "The requested shop was not found.");
    if (session.cartVersion !== input.cartVersion || shop.catalogRevision !== input.catalogRevision) {
      throw new ApiError(409, "cart_changed", "The menu or cart changed. Review the current cart.");
    }
    const items = cartRows.filter((item) => item.shopId === shopId);
    if (!items.length) throw new ApiError(400, "empty_cart", "Add an item before checkout.");
    const products = await Promise.all(items.map((item) => transaction.get<ProductDoc>("products", item.productId)));
    const lines: OrderLine[] = items.map((item, index) => {
      const product = products[index];
      if (!product || product.shopId !== shopId) throw new ApiError(400, "unknown_product", "One selected item is no longer available.");
      const available = product.stockOnHand - product.reservedQuantity;
      if (!product.active || item.quantity > available) throw new ApiError(409, "stock_changed", "An item is no longer available in that quantity.");
      return { shopId, product_id: product.id, display_name: product.name, unit_price_minor: product.priceMinor, quantity: item.quantity };
    });
    const totalMinor = lines.reduce((sum, line) => sum + line.unit_price_minor * line.quantity, 0);
    const fingerprint = JSON.stringify({ cartVersion: input.cartVersion, catalogRevision: input.catalogRevision,
      items: lines.map(({ product_id, quantity, unit_price_minor }) => ({ id: product_id, quantity, priceMinor: unit_price_minor })) });
    const order: OrderDoc = {
      id, shopId, sessionHash: input.sessionHash, clientRequestKey: input.clientRequestKey,
      requestFingerprint: fingerprint, cartVersion: input.cartVersion, catalogRevision: input.catalogRevision,
      state: "creating_payment", currency: shop.currency as OrderDoc["currency"], totalMinor,
      paypalCreateRequestId: randomUUID(), paypalCaptureRequestId: randomUUID(), paypalRefundRequestId: randomUUID(),
      paypalOrderId: null, paypalApproveUrl: null, paypalCaptureId: null, paypalRefundId: null, pickupCode: null, expiresAt,
      refundRestockRequested: null, restockAppliedAt: null, createAttemptStartedAt: now, capturedAt: null,
      refundedAt: null, createdAt: now, updatedAt: now, items: lines,
    };
    lines.forEach((line, index) => transaction.update("products", line.product_id, {
      reservedQuantity: products[index]!.reservedQuantity + line.quantity, updatedAt: now,
    }));
    transaction.create("orders", id, order);
    transaction.create("orderRequestKeys", key, { orderId: id });
    transaction.update("shops", shopId, { catalogRevision: shop.catalogRevision + 1, updatedAt: now });
    return { order: orderRow(order), fingerprint };
  });
}

export async function setCreatedOrder(db: FirestoreDb, orderId: string, paypalOrderId: string, shopId = DEFAULT_SHOP_ID,
  approveUrl: string | null = null): Promise<OrderRow> {
  return db.firestoreStore.runTransaction(async (transaction) => {
    const order = await transaction.get<OrderDoc>("orders", orderId);
    if (order?.shopId === shopId && order.state === "pending_payment" && order.paypalOrderId === paypalOrderId) return orderRow(order);
    if (!order || order.shopId !== shopId || !["creating_payment", "create_unknown"].includes(order.state)) {
      throw new ApiError(409, "order_state_conflict", "This order is no longer awaiting PayPal checkout.");
    }
    const index = await transaction.get<{ orderId: string } & FirestoreDocument>("paypalOrderIds", paypalOrderId);
    if (index && index.orderId !== orderId) throw new ApiError(409, "paypal_order_conflict", "This PayPal order is already linked to another checkout.");
    const shop = await transaction.get<ShopDoc>("shops", shopId);
    const now = new Date().toISOString();
    transaction.set("paypalOrderIds", paypalOrderId, { orderId });
    transaction.update("orders", orderId, { paypalOrderId, paypalApproveUrl: approveUrl, state: "pending_payment", updatedAt: now });
    if (shop) transaction.update("shops", shopId, { catalogRevision: shop.catalogRevision + 1, updatedAt: now });
    return orderRow({ ...order, paypalOrderId, paypalApproveUrl: approveUrl, state: "pending_payment", updatedAt: now });
  });
}

export async function failOrderCreate(db: FirestoreDb, orderId: string, unknown: boolean, shopId = DEFAULT_SHOP_ID): Promise<void> {
  await db.firestoreStore.runTransaction(async (transaction) => {
    const order = await transaction.get<OrderDoc>("orders", orderId);
    if (!order || order.shopId !== shopId || !["creating_payment", "create_unknown"].includes(order.state)) return;
    const [shop, products] = await Promise.all([
      transaction.get<ShopDoc>("shops", shopId),
      unknown ? Promise.resolve([] as Array<ProductDoc | undefined>) : Promise.all(order.items.map((line) => transaction.get<ProductDoc>("products", line.product_id))),
    ]);
    const now = new Date().toISOString();
    if (!unknown) await releaseReservations(transaction, order, products);
    transaction.update("orders", orderId, { state: unknown ? "create_unknown" : "create_failed", updatedAt: now });
    if (shop) transaction.update("shops", shopId, { catalogRevision: shop.catalogRevision + 1, updatedAt: now });
  });
}

export async function markCaptureUnknown(db: FirestoreDb, orderId: string, shopId = DEFAULT_SHOP_ID): Promise<void> {
  await db.firestoreStore.runTransaction(async (transaction) => {
    const order = await transaction.get<OrderDoc>("orders", orderId);
    if (!order || order.shopId !== shopId || order.state !== "pending_payment") return;
    const shop = await transaction.get<ShopDoc>("shops", shopId);
    const now = new Date().toISOString();
    transaction.update("orders", orderId, { state: "capture_unknown", updatedAt: now });
    if (shop) transaction.update("shops", shopId, { catalogRevision: shop.catalogRevision + 1, updatedAt: now });
  });
}

export async function claimCaptureCheck(db: FirestoreDb, orderId: string, shopId = DEFAULT_SHOP_ID): Promise<void> {
  await db.firestoreStore.runTransaction(async (transaction) => {
    const order = await transaction.get<OrderDoc>("orders", orderId);
    if (!order || order.shopId !== shopId || !["pending_payment", "capture_unknown"].includes(order.state)) {
      throw new ApiError(409, "order_state_conflict", "This order is no longer awaiting payment verification.");
    }
    if (order.state === "pending_payment" && Date.parse(order.expiresAt) <= Date.now()) {
      throw new ApiError(409, "order_expired", "This checkout has expired. Start a new order.");
    }
    if (order.state === "pending_payment") {
      const shop = await transaction.get<ShopDoc>("shops", shopId);
      const now = new Date().toISOString();
      transaction.update("orders", orderId, { state: "capture_unknown", updatedAt: now });
      if (shop) transaction.update("shops", shopId, { catalogRevision: shop.catalogRevision + 1, updatedAt: now });
    }
  });
}

export async function resolveNoCapture(db: FirestoreDb, orderId: string, shopId = DEFAULT_SHOP_ID): Promise<"pending_payment" | "expired" | null> {
  return db.firestoreStore.runTransaction(async (transaction) => {
    const order = await transaction.get<OrderDoc>("orders", orderId);
    if (!order || order.shopId !== shopId || order.state !== "capture_unknown") return null;
    const expired = Date.parse(order.expiresAt) <= Date.now();
    const [shop, products] = await Promise.all([
      transaction.get<ShopDoc>("shops", shopId),
      expired ? Promise.all(order.items.map((line) => transaction.get<ProductDoc>("products", line.product_id))) : Promise.resolve([] as Array<ProductDoc | undefined>),
    ]);
    if (expired) await releaseReservations(transaction, order, products);
    const state = expired ? "expired" : "pending_payment";
    const now = new Date().toISOString();
    transaction.update("orders", orderId, { state, updatedAt: now });
    if (shop) transaction.update("shops", shopId, { catalogRevision: shop.catalogRevision + 1, updatedAt: now });
    return state;
  });
}

export async function completeCapture(db: FirestoreDb, orderId: string, captureId: string, shopId?: string): Promise<OrderRow> {
  const pickupCandidates = Array.from({ length: 5 }, () => randomBytes(4).toString("hex").toUpperCase());
  return db.firestoreStore.runTransaction(async (transaction) => {
    const order = await transaction.get<OrderDoc>("orders", orderId);
    if (!order || shopId && order.shopId !== shopId) throw new ApiError(404, "order_not_found", "Order was not found.");
    if (order.state === "paid" || order.state === "collected") {
      if (order.paypalCaptureId !== captureId) throw new ApiError(409, "paypal_capture_conflict", "This PayPal capture is already linked to another order.");
      return orderRow(order);
    }
    if (!["pending_payment", "capture_unknown"].includes(order.state)) throw new ApiError(409, "order_state_conflict", "This order cannot be captured in its current state.");
    const shop = await transaction.get<ShopDoc>("shops", order.shopId);
    const capturedAt = new Date();
    const now = capturedAt.toISOString();
    const pickupDate = pickupDateForShop(capturedAt, shop?.timeZone ?? "Asia/Tokyo");
    const pickupCounterId = `${order.shopId}_${pickupDate}`;
    const [products, session, cartRows, captureIndex, pickupIndexes, pickupCounter] = await Promise.all([
      Promise.all(order.items.map((line) => transaction.get<ProductDoc>("products", line.product_id))),
      transaction.get<SessionDoc>("visitorSessions", order.sessionHash),
      transaction.query<CartLineDoc>("cartItems", [{ field: "sessionHash", op: "==", value: order.sessionHash }]),
      transaction.get<{ orderId: string } & FirestoreDocument>("paypalCaptureIds", captureId),
      Promise.all(pickupCandidates.map((code) => transaction.get("pickupCodes", code))),
      transaction.get<{ count: number } & FirestoreDocument>("pickupCounters", pickupCounterId),
    ]);
    const currentCart = cartRows.filter((item) => item.shopId === order.shopId);
    const extraProducts = currentCart.filter((item) => !order.items.some((line) => line.product_id === item.productId));
    const extraRows = await Promise.all(extraProducts.map((item) => transaction.get<ProductDoc>("products", item.productId)));
    if (captureIndex && captureIndex.orderId !== orderId) throw new ApiError(409, "paypal_capture_conflict", "This PayPal capture is already linked to another order.");
    const pickupCode = pickupCandidates[pickupIndexes.findIndex((item) => !item)];
    if (!pickupCode) throw new Error("Unable to allocate pickup code");
    const pickupNumber = formatPickupNumber((pickupCounter?.count ?? 0) + 1);
    let cartUnchanged = !!session && session.cartVersion === order.cartVersion;
    if (cartUnchanged) {
      const itemMap = new Map(order.items.map((item) => [item.product_id, item]));
      cartUnchanged = currentCart.length === order.items.length && currentCart.every((item) => {
        const line = itemMap.get(item.productId);
        const product = itemMap.has(item.productId)
          ? products[order.items.findIndex((entry) => entry.product_id === item.productId)]
          : extraRows[extraProducts.findIndex((extra) => extra.productId === item.productId)];
        return !!line && !!product && item.quantity === line.quantity && product.name === line.display_name && product.priceMinor === line.unit_price_minor;
      });
    }
    for (let index = 0; index < order.items.length; index += 1) {
      const line = order.items[index]!;
      const product = products[index];
      if (!product || product.shopId !== order.shopId || product.stockOnHand < line.quantity || product.reservedQuantity < line.quantity) {
        throw new ApiError(409, "stock_invariant", "Reserved inventory could not be finalized.");
      }
      transaction.update("products", line.product_id, { stockOnHand: product.stockOnHand - line.quantity,
        reservedQuantity: product.reservedQuantity - line.quantity, updatedAt: now });
    }
    if (cartUnchanged) {
      currentCart.forEach((item) => transaction.delete("cartItems", item.id));
      transaction.update("visitorSessions", order.sessionHash, { cartVersion: order.cartVersion + 1 });
    }
    transaction.create("paypalCaptureIds", captureId, { orderId });
    transaction.create("pickupCodes", pickupCode, { orderId });
    transaction.set("pickupCounters", pickupCounterId, { count: (pickupCounter?.count ?? 0) + 1, updatedAt: now });
    transaction.update("orders", orderId, { state: "paid", paypalCaptureId: captureId, pickupCode, pickupNumber, pickupDate,
      capturedAt: now, updatedAt: now });
    if (shop) transaction.update("shops", order.shopId, { catalogRevision: shop.catalogRevision + 1, updatedAt: now });
    return orderRow({ ...order, state: "paid", paypalCaptureId: captureId, pickupCode, pickupNumber, pickupDate,
      capturedAt: now, updatedAt: now });
  });
}

export async function cancelOrder(db: FirestoreDb, orderId: string, shopId = DEFAULT_SHOP_ID): Promise<OrderRow> {
  return db.firestoreStore.runTransaction(async (transaction) => {
    const order = await transaction.get<OrderDoc>("orders", orderId);
    if (!order || order.shopId !== shopId) throw new ApiError(404, "order_not_found", "Order was not found.");
    if (order.state === "cancelled" || order.state === "expired") return orderRow(order);
    if (order.state !== "pending_payment") throw new ApiError(409, "order_state_conflict", "This order cannot be cancelled in its current state.");
    const [shop, products] = await Promise.all([
      transaction.get<ShopDoc>("shops", shopId),
      Promise.all(order.items.map((line) => transaction.get<ProductDoc>("products", line.product_id))),
    ]);
    await releaseReservations(transaction, order, products);
    const now = new Date().toISOString();
    transaction.update("orders", orderId, { state: "cancelled", updatedAt: now });
    if (shop) transaction.update("shops", shopId, { catalogRevision: shop.catalogRevision + 1, updatedAt: now });
    return orderRow({ ...order, state: "cancelled", updatedAt: now });
  });
}

export async function beginRefund(db: FirestoreDb, orderId: string, restock: boolean, shopId = DEFAULT_SHOP_ID): Promise<OrderRow> {
  return db.firestoreStore.runTransaction(async (transaction) => {
    const order = await transaction.get<OrderDoc>("orders", orderId);
    if (!order || order.shopId !== shopId) throw new ApiError(404, "order_not_found", "Order was not found.");
    if (order.state === "refunded" || order.state === "refund_unknown") {
      if (order.refundRestockRequested !== Number(restock)) throw new ApiError(409, "refund_choice_conflict", "Retry with the original stock-restoration choice.");
      return orderRow(order);
    }
    if (order.state !== "paid") throw new ApiError(409, "order_state_conflict", "Only an uncollected paid order can be refunded.");
    if (order.refundRestockRequested !== null && order.refundRestockRequested !== Number(restock)) {
      throw new ApiError(409, "refund_choice_conflict", "Retry with the original stock-restoration choice.");
    }
    const now = new Date().toISOString();
    transaction.update("orders", orderId, { state: "refund_unknown", refundRestockRequested: Number(restock), updatedAt: now });
    return orderRow({ ...order, state: "refund_unknown", refundRestockRequested: Number(restock), updatedAt: now });
  });
}

export async function refundRejected(db: FirestoreDb, orderId: string, shopId = DEFAULT_SHOP_ID): Promise<void> {
  await db.firestoreStore.runTransaction(async (transaction) => {
    const order = await transaction.get<OrderDoc>("orders", orderId);
    if (order?.shopId === shopId && order.state === "refund_unknown") transaction.update("orders", orderId, { state: "paid", updatedAt: new Date().toISOString() });
  });
}

export async function completeRefund(db: FirestoreDb, orderId: string, refundId: string, shopId?: string): Promise<OrderRow> {
  return db.firestoreStore.runTransaction(async (transaction) => {
    const order = await transaction.get<OrderDoc>("orders", orderId);
    if (!order || shopId && order.shopId !== shopId) throw new ApiError(404, "order_not_found", "Order was not found.");
    if (order.state === "refunded") {
      if (order.paypalRefundId !== refundId) throw new ApiError(409, "paypal_refund_conflict", "This PayPal refund is already linked to another order.");
      return orderRow(order);
    }
    if (order.state !== "refund_unknown" || order.refundRestockRequested === null) throw new ApiError(409, "order_state_conflict", "This order is not awaiting a refund result.");
    const [shop, products, refundIndex] = await Promise.all([
      transaction.get<ShopDoc>("shops", order.shopId),
      order.refundRestockRequested === 1 && !order.restockAppliedAt
        ? Promise.all(order.items.map((line) => transaction.get<ProductDoc>("products", line.product_id)))
        : Promise.resolve([] as Array<ProductDoc | undefined>),
      transaction.get<{ orderId: string } & FirestoreDocument>("paypalRefundIds", refundId),
    ]);
    if (refundIndex && refundIndex.orderId !== orderId) throw new ApiError(409, "paypal_refund_conflict", "This PayPal refund is already linked to another order.");
    const now = new Date().toISOString();
    if (order.refundRestockRequested === 1 && !order.restockAppliedAt) {
      order.items.forEach((line, index) => {
        const product = products[index];
        if (!product || product.shopId !== order.shopId) throw new ApiError(409, "stock_invariant", "Refund inventory could not be restored safely.");
        transaction.update("products", line.product_id, { stockOnHand: product.stockOnHand + line.quantity, updatedAt: now });
      });
    }
    transaction.create("paypalRefundIds", refundId, { orderId });
    transaction.update("orders", orderId, { state: "refunded", paypalRefundId: refundId,
      restockAppliedAt: order.refundRestockRequested === 1 ? now : null, refundedAt: now, updatedAt: now });
    if (shop) transaction.update("shops", order.shopId, { catalogRevision: shop.catalogRevision + 1, updatedAt: now });
    return orderRow({ ...order, state: "refunded", paypalRefundId: refundId,
      restockAppliedAt: order.refundRestockRequested === 1 ? now : null, refundedAt: now, updatedAt: now });
  });
}

export async function transitionCollected(db: FirestoreDb, orderId: string, shopId = DEFAULT_SHOP_ID): Promise<OrderRow> {
  return db.firestoreStore.runTransaction(async (transaction) => {
    const order = await transaction.get<OrderDoc>("orders", orderId);
    if (!order || order.shopId !== shopId) throw new ApiError(404, "order_not_found", "Order was not found.");
    if (order.state === "collected") return orderRow(order);
    if (order.state !== "paid") throw new ApiError(409, "order_state_conflict", "Only a paid order can be collected.");
    const now = new Date().toISOString();
    transaction.update("orders", orderId, { state: "collected", updatedAt: now });
    return orderRow({ ...order, state: "collected", updatedAt: now });
  });
}
