import { randomUUID } from "node:crypto";
import type { Db, FirestoreDb, SqliteDb } from "../database.js";
import { ApiError, ProviderError } from "../errors.js";
import { parseAmountToMinor } from "../../shared/currency.js";
import { DEFAULT_SHOP_ID, getCatalogRevision, incrementCatalogRevision } from "../database.js";
import { readCart } from "../inventory.js";
import { logStage } from "../logging.js";
import {
  beginRefund, cancelOrder, claimCaptureCheck, completeCapture, completeRefund, failOrderCreate, findOrder,
  findOrderByCaptureId, findOrderByClientRequest, findOrderByPaypalOrderId,
  listOrderLines, markCaptureUnknown, normalizeExpiredOrders, resolveNoCapture,
  refundRejected, reserveOrder, setCreatedOrder, transitionCollected,
  type OrderRow,
} from "../order-state.js";
import type { PayPalProvider, WebhookHeaders } from "./paypal.js";

const createInFlight = new Set<string>();
const captureInFlight = new Set<string>();
const refundInFlight = new Set<string>();

function orderReceipt(order: OrderRow) {
  return { orderId: order.id, state: order.state, totalMinor: order.total_minor,
    currency: order.currency,
    pickupCode: order.state === "paid" || order.state === "collected" ? order.pickup_code : null };
}

async function paypalItems(db: Db, order: OrderRow) {
  return (await listOrderLines(db, order.id, order.shop_id)).map((line) => ({ id: line.product_id, name: line.display_name,
    quantity: line.quantity, unitAmount: line.unit_price_minor }));
}

function referenceIdMatches(order: OrderRow, result: Awaited<ReturnType<PayPalProvider["getOrder"]>>): boolean {
  return result.referenceId === null || result.referenceId === "default" || result.referenceId === order.id;
}

function customIdMatches(order: OrderRow, result: Awaited<ReturnType<PayPalProvider["getOrder"]>>): boolean {
  return result.customId === null || result.customId === order.id;
}

function ensureCaptureMatches(
  order: OrderRow,
  result: Awaited<ReturnType<PayPalProvider["getOrder"]>>,
  requestId: string,
): string {
  const verification = {
    orderIdMatches: result.orderId === order.paypal_order_id,
    referenceIdMatches: referenceIdMatches(order, result),
    customIdMatches: customIdMatches(order, result),
    currencyMatches: result.currency === order.currency,
    amountMatches: result.amountMinor === order.total_minor,
    orderCompleted: result.orderStatus === "COMPLETED",
    captureCompleted: result.captureStatus === "COMPLETED",
    captureIdPresent: !!result.captureId,
  };
  logStage(requestId, "paypal_capture_verification", "start");
  if (Object.values(verification).some((matches) => !matches)) {
    const error = new ApiError(502, "payment_verification_failed", "Payment status could not be verified. Please retry or contact the organizer.");
    logStage(requestId, "paypal_capture_verification", "failure", error, verification);
    throw error;
  }
  logStage(requestId, "paypal_capture_verification", "success");
  return result.captureId!;
}

function providerMessage(error: unknown): ApiError {
  if (error instanceof ProviderError && error.httpStatus === 503) return new ApiError(503, "payments_not_configured", "PayPal checkout is not configured.");
  return new ApiError(502, "payment_provider_error", "PayPal could not complete the request. Retry using the same order.");
}

export async function createOrRetryOrder(db: Db, paypal: PayPalProvider, input: {
  sessionHash: string; cartVersion: number; catalogRevision: number; clientRequestKey: string; shopId?: string;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const shopId = input.shopId ?? DEFAULT_SHOP_ID;
  await normalizeExpiredOrders(db, shopId);
  const existing = db.backend === "firestore"
    ? await findOrderByClientRequest(db, input.sessionHash, input.clientRequestKey, shopId)
    : findOrderByClientRequest(db as SqliteDb, input.sessionHash, input.clientRequestKey, shopId);
  let order: OrderRow;
  let isNew = false;
  if (existing) {
    if (existing.cart_version !== input.cartVersion || existing.catalog_revision !== input.catalogRevision) {
      throw new ApiError(409, "idempotency_conflict", "This request key was already used with different cart versions.");
    }
    order = existing;
    if (order.state === "pending_payment") return { status: 200, body: { orderId: order.id, paypalOrderId: order.paypal_order_id,
      expiresAt: order.expires_at, totalMinor: order.total_minor, currency: order.currency } };
    if (["paid", "collected", "refunded", "refund_unknown", "capture_unknown", "cancelled", "expired", "create_failed"].includes(order.state)) {
      return { status: 200, body: orderReceipt(order) };
    }
    if (createInFlight.has(order.id)) {
      return { status: 202, body: { orderId: order.id, state: "create_unknown" } };
    }
    if (order.state === "create_unknown" && Date.parse(order.expires_at) <= Date.now()) {
      await normalizeExpiredOrders(db, shopId);
      return { status: 409, body: { ...orderReceipt((await findOrder(db, order.id, shopId))!), code: "order_expired" } };
    }
    if (order.state !== "creating_payment" && order.state !== "create_unknown") {
      throw new ApiError(409, "order_state_conflict", "This order cannot be retried.");
    }
  } else {
    if (input.catalogRevision !== await getCatalogRevision(db, shopId)) {
      throw new ApiError(409, "cart_changed", "The menu changed. Review the current cart.", { cart: await readCart(db, input.sessionHash, shopId) });
    }
    const reserved = await reserveOrder(db, { ...input, shopId });
    order = reserved.order;
    isNew = true;
    if (createInFlight.has(order.id)) return { status: 202, body: { orderId: order.id, state: "creating_payment" } };
  }

  createInFlight.add(order.id);
  try {
    const created = await paypal.createOrder({
      localOrderId: order.id, currency: order.currency, totalMinor: order.total_minor,
      items: await paypalItems(db, order), requestId: order.paypal_create_request_id,
    });
    if (!created.id || created.status !== "CREATED" && created.status !== "PAYER_ACTION_REQUIRED") {
      await failOrderCreate(db, order.id, true, shopId);
      return { status: 202, body: { orderId: order.id, state: "create_unknown" } };
    }
    const saved = await setCreatedOrder(db, order.id, created.id, shopId);
    return { status: isNew ? 201 : 200, body: { orderId: saved.id, paypalOrderId: created.id,
      expiresAt: saved.expires_at, totalMinor: saved.total_minor, currency: saved.currency } };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const unknown = !(error instanceof ProviderError) || !error.definite;
    await failOrderCreate(db, order.id, unknown, shopId);
    if (unknown) return { status: 202, body: { orderId: order.id, state: "create_unknown" } };
    throw providerMessage(error);
  } finally {
    createInFlight.delete(order.id);
  }
}

export async function captureOrder(db: Db, paypal: PayPalProvider, sessionHash: string, orderId: string, shopId = DEFAULT_SHOP_ID, requestId = "missing"): Promise<Record<string, unknown>> {
  await normalizeExpiredOrders(db, shopId);
  const order = await findOrder(db, orderId, shopId);
  if (!order || order.session_hash !== sessionHash) throw new ApiError(404, "order_not_found", "Order was not found.");
  if (order.state === "paid" || order.state === "collected") return orderReceipt(order);
  if (order.state === "expired") throw new ApiError(409, "order_expired", "This checkout has expired. Start a new order.");
  if (order.state !== "pending_payment" && order.state !== "capture_unknown") throw new ApiError(409, "order_state_conflict", "This order cannot be captured in its current state.");
  if (order.state === "pending_payment" && Date.parse(order.expires_at) <= Date.now()) {
    await normalizeExpiredOrders(db, shopId);
    throw new ApiError(409, "order_expired", "This checkout has expired. Start a new order.");
  }
  if (captureInFlight.has(order.id)) {
    throw new ApiError(202, "capture_unknown", "Payment status is being checked. Retry to refresh it.");
  }
  captureInFlight.add(order.id);
  try {
    await claimCaptureCheck(db, order.id, shopId);
    let observed;
    logStage(requestId, "paypal_order_status", "start");
    try {
      observed = await paypal.getOrder(order.paypal_order_id!);
      logStage(requestId, "paypal_order_status", "success");
    }
    catch (error) {
      logStage(requestId, "paypal_order_status", "failure", error);
      await markCaptureUnknown(db, order.id, shopId);
      throw new ApiError(202, "capture_unknown", "Payment status is being checked. Retry to refresh it.");
    }
    if (observed.orderId !== order.paypal_order_id || !referenceIdMatches(order, observed) || !customIdMatches(order, observed) ||
        observed.currency !== order.currency || observed.amountMinor !== order.total_minor) {
      await markCaptureUnknown(db, order.id, shopId);
      throw new ApiError(502, "payment_verification_failed", "Payment details could not be verified. Contact the organizer.");
    }
    if (observed.orderStatus === "COMPLETED" && observed.captureStatus === "COMPLETED" && observed.captureId) {
      const captureId = ensureCaptureMatches(order, observed, requestId);
      return orderReceipt(await completeCapture(db, order.id, captureId, shopId));
    }
    if (observed.orderStatus !== "APPROVED") {
      if (observed.orderStatus !== "COMPLETED") {
        const resolved = await resolveNoCapture(db, order.id, shopId);
        if (resolved === "expired") throw new ApiError(409, "order_expired", "This checkout has expired. Start a new order.");
      }
      throw new ApiError(409, "payment_not_approved", "Approve this order in PayPal before retrying capture.");
    }

    try {
      await markCaptureUnknown(db, order.id, shopId);
      logStage(requestId, "paypal_capture_request", "start");
      const captured = await paypal.captureOrder(order.paypal_order_id!, order.paypal_capture_request_id);
      logStage(requestId, "paypal_capture_request", "success");
      const captureId = ensureCaptureMatches(order, captured, requestId);
      return orderReceipt(await completeCapture(db, order.id, captureId, shopId));
    } catch (error) {
      logStage(requestId, "paypal_capture_request", "failure", error);
      await markCaptureUnknown(db, order.id, shopId);
      if (error instanceof ApiError) throw error;
      throw new ApiError(202, "capture_unknown", "Payment status is being checked. Retry to refresh it.");
    }
  } finally {
    captureInFlight.delete(order.id);
  }
}

export async function readOwnedOrder(db: Db, sessionHash: string, orderId: string, shopId = DEFAULT_SHOP_ID): Promise<Record<string, unknown>> {
  const order = await findOrder(db, orderId, shopId);
  if (!order || order.session_hash !== sessionHash) throw new ApiError(404, "order_not_found", "Order was not found.");
  return orderReceipt(order);
}

export async function cancelOwnedOrder(db: Db, sessionHash: string, orderId: string, shopId = DEFAULT_SHOP_ID): Promise<Record<string, unknown>> {
  const order = await findOrder(db, orderId, shopId);
  if (!order || order.session_hash !== sessionHash) throw new ApiError(404, "order_not_found", "Order was not found.");
  return orderReceipt(await cancelOrder(db, orderId, shopId));
}

export async function refundOrder(db: Db, paypal: PayPalProvider, orderId: string, restock: boolean, shopId = DEFAULT_SHOP_ID, requestId = "missing"): Promise<{ status: number; body: Record<string, unknown> }> {
  const original = await findOrder(db, orderId, shopId);
  if (!original) throw new ApiError(404, "order_not_found", "Order was not found.");
  const order = await beginRefund(db, orderId, restock, shopId);
  if (order.state === "refunded") return { status: 200, body: { state: order.state, restocked: !!order.restock_applied_at } };
  if (refundInFlight.has(orderId)) return { status: 202, body: { state: "refund_unknown" } };
  refundInFlight.add(orderId);
  try {
    logStage(requestId, "paypal_refund_request", "start");
    const result = await paypal.refundCapture(order.paypal_capture_id!, order.total_minor, order.currency, order.paypal_refund_request_id);
    if (result.status !== "COMPLETED" || result.currency !== order.currency || result.amountMinor !== order.total_minor || !result.refundId) {
      logStage(requestId, "paypal_refund_request", "failure");
      return { status: 202, body: { state: "refund_unknown" } };
    }
    const saved = await completeRefund(db, orderId, result.refundId, shopId);
    logStage(requestId, "paypal_refund_request", "success");
    return { status: 200, body: { state: saved.state, restocked: !!saved.restock_applied_at } };
  } catch (error) {
    logStage(requestId, "paypal_refund_request", "failure", error);
    if (error instanceof ProviderError && error.definite) {
      await refundRejected(db, orderId, shopId);
      throw providerMessage(error);
    }
    return { status: 202, body: { state: "refund_unknown" } };
  } finally { refundInFlight.delete(orderId); }
}

function webhookObject(event: unknown) { return event && typeof event === "object" ? event as Record<string, unknown> : {}; }
function nested(value: unknown) { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }

function refundCaptureId(resource: Record<string, unknown>): string {
  const related = nested(nested(resource.supplementary_data).related_ids);
  if (typeof related.capture_id === "string" && related.capture_id) return related.capture_id;
  const links = Array.isArray(resource.links) ? resource.links.map(nested) : [];
  const href = links.find((link) => link.rel === "up")?.href;
  if (typeof href !== "string") return "";
  const match = /^https:\/\/(?:api-m\.|api\.)?(?:sandbox\.)?paypal\.com\/v2\/payments\/captures\/([A-Za-z0-9]+)\/?$/.exec(href);
  return match?.[1] ?? "";
}

export async function processPaypalWebhook(db: Db, paypal: PayPalProvider, headers: WebhookHeaders, event: unknown): Promise<"processed" | "duplicate"> {
  if (!(await paypal.verifyWebhook(headers, event))) throw new ApiError(400, "webhook_signature_invalid", "Webhook signature verification failed.");
  const root = webhookObject(event);
  if (typeof root.id !== "string" || typeof root.event_type !== "string") throw new ApiError(400, "webhook_invalid", "Webhook event is invalid.");
  const resource = nested(root.resource);
  if (db.backend === "firestore") return processFirestoreWebhook(db, root.id, root.event_type, resource);
  const existed = db.prepare("SELECT 1 FROM webhook_events WHERE id = ?").get(root.id);
  if (existed) return "duplicate";
  const now = new Date().toISOString();
  const transaction = db.transaction(() => {
    if (root.event_type === "PAYMENT.CAPTURE.COMPLETED") {
      const related = nested(nested(resource.supplementary_data).related_ids);
      const paypalOrderId = typeof related.order_id === "string" ? related.order_id : "";
      const order = db.prepare("SELECT * FROM orders WHERE paypal_order_id = ?").get(paypalOrderId) as OrderRow | undefined;
      if (order) {
        const captureId = typeof resource.id === "string" ? resource.id : "";
        const amount = nested(resource.amount);
        if (resource.status !== "COMPLETED" || !captureId || amount.currency_code !== order.currency ||
            typeof amount.value !== "string" || parseAmountToMinor(amount.value, order.currency) !== order.total_minor) {
          throw new ApiError(500, "webhook_reconciliation_failed", "Verified event did not match its local order.");
        }
        if (order.state === "pending_payment" || order.state === "capture_unknown") {
          completeCapture(db, order.id, captureId);
        } else if (["paid", "collected", "refund_unknown", "refunded"].includes(order.state)) {
          if (order.paypal_capture_id !== captureId) {
            throw new ApiError(500, "webhook_reconciliation_failed", "Verified event did not match its local order.");
          }
        } else {
          throw new ApiError(500, "webhook_reconciliation_failed", "Verified event did not match its local order.");
        }
      }
    } else if (root.event_type === "PAYMENT.CAPTURE.REFUNDED") {
      const captureId = refundCaptureId(resource);
      const invoiceId = typeof resource.invoice_id === "string" ? resource.invoice_id : "";
      const customId = typeof resource.custom_id === "string" ? resource.custom_id : "";
      if (invoiceId && customId && invoiceId !== customId) {
        throw new ApiError(500, "webhook_reconciliation_failed", "Verified event did not match its local refund.");
      }
      const localOrderId = invoiceId || customId;
      const byCapture = captureId ? db.prepare("SELECT * FROM orders WHERE paypal_capture_id = ?").get(captureId) as OrderRow | undefined : undefined;
      const byReference = localOrderId ? findOrder(db, localOrderId) : undefined;
      if (byCapture && byReference && byCapture.id !== byReference.id) {
        throw new ApiError(500, "webhook_reconciliation_failed", "Verified event did not match its local refund.");
      }
      const order = byCapture ?? byReference;
      if (order && order.state !== "refunded") {
        const amount = nested(resource.amount);
        if (order.state !== "refund_unknown" || !captureId || order.paypal_capture_id !== captureId ||
            (localOrderId && order.id !== localOrderId) || resource.status !== "COMPLETED" ||
            amount.currency_code !== order.currency || typeof amount.value !== "string" || parseAmountToMinor(amount.value, order.currency) !== order.total_minor ||
            typeof resource.id !== "string" || !resource.id) {
          throw new ApiError(500, "webhook_reconciliation_failed", "Verified event did not match its local refund.");
        }
        completeRefund(db, order.id, resource.id);
      }
    }
    db.prepare("INSERT INTO webhook_events(id, event_type, processed_at) VALUES (?, ?, ?)").run(root.id, root.event_type, now);
  });
  try { transaction.immediate(); }
  catch (error) {
    const duplicate = db.prepare("SELECT 1 FROM webhook_events WHERE id = ?").get(root.id);
    if (duplicate) return "duplicate";
    throw error;
  }
  return "processed";
}

async function processFirestoreWebhook(db: FirestoreDb, eventId: string, eventType: string, resource: Record<string, unknown>): Promise<"processed" | "duplicate"> {
  const alreadyProcessed = await db.firestoreStore.get("webhookEvents", eventId);
  if (alreadyProcessed) return "duplicate";
  if (eventType === "PAYMENT.CAPTURE.COMPLETED") {
    const related = nested(nested(resource.supplementary_data).related_ids);
    const paypalOrderId = typeof related.order_id === "string" ? related.order_id : "";
    const order = paypalOrderId ? await findOrderByPaypalOrderId(db, paypalOrderId) : undefined;
    if (order) {
      const captureId = typeof resource.id === "string" ? resource.id : "";
      const amount = nested(resource.amount);
      if (resource.status !== "COMPLETED" || !captureId || amount.currency_code !== order.currency ||
          typeof amount.value !== "string" || parseAmountToMinor(amount.value, order.currency) !== order.total_minor) {
        throw new ApiError(500, "webhook_reconciliation_failed", "Verified event did not match its local order.");
      }
      if (order.state === "pending_payment" || order.state === "capture_unknown") {
        await completeCapture(db, order.id, captureId, order.shop_id);
      } else if (["paid", "collected", "refund_unknown", "refunded"].includes(order.state)) {
        if (order.paypal_capture_id !== captureId) {
          throw new ApiError(500, "webhook_reconciliation_failed", "Verified event did not match its local order.");
        }
      } else {
        throw new ApiError(500, "webhook_reconciliation_failed", "Verified event did not match its local order.");
      }
    }
  } else if (eventType === "PAYMENT.CAPTURE.REFUNDED") {
    const captureId = refundCaptureId(resource);
    const invoiceId = typeof resource.invoice_id === "string" ? resource.invoice_id : "";
    const customId = typeof resource.custom_id === "string" ? resource.custom_id : "";
    if (invoiceId && customId && invoiceId !== customId) {
      throw new ApiError(500, "webhook_reconciliation_failed", "Verified event did not match its local refund.");
    }
    const localOrderId = invoiceId || customId;
    const [byCapture, byReference] = await Promise.all([
      captureId ? findOrderByCaptureId(db, captureId) : Promise.resolve(undefined),
      localOrderId ? findOrder(db, localOrderId) : Promise.resolve(undefined),
    ]);
    if (byCapture && byReference && byCapture.id !== byReference.id) {
      throw new ApiError(500, "webhook_reconciliation_failed", "Verified event did not match its local refund.");
    }
    const order = byCapture ?? byReference;
    if (order && order.state !== "refunded") {
      const amount = nested(resource.amount);
      if (order.state !== "refund_unknown" || !captureId || order.paypal_capture_id !== captureId ||
          (localOrderId && order.id !== localOrderId) || resource.status !== "COMPLETED" ||
          amount.currency_code !== order.currency || typeof amount.value !== "string" ||
          parseAmountToMinor(amount.value, order.currency) !== order.total_minor ||
          typeof resource.id !== "string" || !resource.id) {
        throw new ApiError(500, "webhook_reconciliation_failed", "Verified event did not match its local refund.");
      }
      await completeRefund(db, order.id, resource.id, order.shop_id);
    }
  }
  try {
    await db.firestoreStore.create("webhookEvents", eventId, { eventType, processedAt: new Date().toISOString() });
  } catch (error) {
    if (await db.firestoreStore.get("webhookEvents", eventId)) return "duplicate";
    throw error;
  }
  return "processed";
}

export async function collectOrder(db: Db, orderId: string, shopId = DEFAULT_SHOP_ID): Promise<Record<string, unknown>> {
  return { state: (await transitionCollected(db, orderId, shopId)).state };
}

export async function adminOrder(db: Db, orderId: string, shopId = DEFAULT_SHOP_ID): Promise<Record<string, unknown>> {
  const order = await findOrder(db, orderId, shopId);
  if (!order) throw new ApiError(404, "order_not_found", "Order was not found.");
  return { orderId: order.id, state: order.state, totalMinor: order.total_minor,
    currency: order.currency,
    ...(order.state === "paid" || order.state === "collected" ? { pickupCode: order.pickup_code } : {}),
    createdAt: order.created_at,
    expiresAt: order.expires_at, restocked: !!order.restock_applied_at,
    refundRestockRequested: order.refund_restock_requested === null ? null : order.refund_restock_requested === 1 };
}

export async function audit(db: Db, action: string, targetId: string, metadata: unknown = {}, shopId = DEFAULT_SHOP_ID, actorUserId: string | null = null): Promise<void> {
  if (db.backend === "firestore") {
    const id = randomUUID();
    await db.firestoreStore.create("adminAuditLogs", id, {
      id, shopId, actorUserId, action, targetId, metadata: JSON.stringify(metadata), createdAt: new Date().toISOString(),
    });
    return;
  }
  db.prepare("INSERT INTO admin_audit_log(id, shop_id, actor_user_id, action, target_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(randomUUID(), shopId, actorUserId, action, targetId, JSON.stringify(metadata), new Date().toISOString());
}

export async function catalogChanged(db: Db, shopId = DEFAULT_SHOP_ID): Promise<number> { return incrementCatalogRevision(db, shopId); }
