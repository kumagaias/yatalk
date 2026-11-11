import type { Db } from "../database.js";
import { listOrderLines, listPendingPaymentOrders, normalizeExpiredOrders } from "../order-state.js";
import type { PayPalProvider } from "./paypal.js";

function safeApprovalUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "paypal.com" || url.hostname.endsWith(".paypal.com"))
      ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function counterPaymentQueue(db: Db, paypal: PayPalProvider, shopId: string) {
  await normalizeExpiredOrders(db, shopId);
  const orders = await listPendingPaymentOrders(db, shopId);
  return Promise.all(orders.map(async (order) => {
    let approveUrl = safeApprovalUrl(order.paypal_approve_url);
    if (!approveUrl && order.paypal_order_id) {
      try { approveUrl = safeApprovalUrl((await paypal.getOrder(order.paypal_order_id)).approveUrl); }
      catch { /* Keep the order visible with a retry state if PayPal is temporarily unavailable. */ }
    }
    const items = await listOrderLines(db, order.id, shopId);
    return {
      orderId: order.id,
      totalMinor: order.total_minor,
      currency: order.currency,
      createdAt: order.created_at,
      expiresAt: order.expires_at,
      approveUrl,
      items: items.map((line) => ({ name: line.display_name, quantity: line.quantity })),
    };
  }));
}
