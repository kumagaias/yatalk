import { Check, PackageCheck, RotateCcw } from "lucide-react";
import type { FormEvent } from "react";
import type { OrganizerProduct, Order } from "../types";
import { amountFromMinor } from "../../shared/currency.js";
import { money, shortTime } from "../lib/format";
import { Alert } from "./Feedback";

type OrderCardProps = {
  order: Order;
  saving: boolean;
  actionMessage: string;
  refundOpen: boolean;
  restock: boolean;
  refundUnknown: boolean;
  refundDetailLoading: boolean;
  refundDetailError: string;
  onCollect: () => void;
  onOpenRefund: () => void;
  onCloseRefund: () => void;
  onRestock: (value: boolean) => void;
  onRefund: () => void;
  onRetryDetails: () => void;
};

export function OrderCard({
  order, saving, actionMessage, refundOpen, restock, refundUnknown, refundDetailLoading, refundDetailError,
  onCollect, onOpenRefund, onCloseRefund, onRestock, onRefund, onRetryDetails,
}: OrderCardProps) {
  const displayedState = refundUnknown ? "refund_unknown" : order.state;
  const itemSummary = order.items?.map((item) => `${item.quantity} × ${item.name}`).join(" · ");
  return (
    <article className="order-card">
      <div className="order-topline">
        <div><span className="order-number">Order {order.orderId.slice(0, 8).toUpperCase()}</span><div className="order-meta"><span>{shortTime(order.createdAt)}</span><span>{money(order.totalMinor, order.currency)}</span></div></div>
        <span className={`status-pill status-${displayedState}`}>{displayedState.replaceAll("_", " ")}</span>
      </div>
      {itemSummary && <p className="order-items">{itemSummary}</p>}
      {order.state === "paid" && order.pickupCode && <p className="order-pickup"><span>Pickup code</span><strong>{order.pickupCode}</strong></p>}
      <div className="order-controls">
        {order.state === "paid" && <>
          <button className="button button-secondary" type="button" onClick={onCollect} disabled={saving}><PackageCheck size={16} aria-hidden="true" />{saving ? "Saving…" : "Mark collected"}</button>
          <button className="text-button refund-trigger" type="button" onClick={onOpenRefund}><RotateCcw size={15} aria-hidden="true" />Refund</button>
        </>}
        {(order.state === "refund_unknown" || refundUnknown) && <button className="button button-secondary" type="button" onClick={onOpenRefund}><RotateCcw size={15} aria-hidden="true" />{refundOpen ? "Refund retry ready" : "Review refund status"}</button>}
      </div>
      {actionMessage && <Alert tone={actionMessage.startsWith("Refund complete") || actionMessage.startsWith("Refund checking") ? "success" : "error"}>{actionMessage}</Alert>}
      {refundOpen && (order.state === "paid" || order.state === "refund_unknown" || refundUnknown) && (
        <div className="refund-box">
          <p><strong>{refundUnknown || order.state === "refund_unknown" ? "Retry the full refund" : "Confirm full refund"}</strong> of {money(order.totalMinor, order.currency)} for this paid order.</p>
          {(refundUnknown || order.state === "refund_unknown") ? (
            <p className="refund-retry-note">The saved stock choice will {restock ? "return items to stock" : "leave stock unchanged"}. The order remains captured until PayPal confirms.</p>
          ) : (
            <label className="checkbox-row"><input type="checkbox" checked={restock} onChange={(event) => onRestock(event.target.checked)} /><span>Return the items to available stock after the refund completes.</span></label>
          )}
          {refundDetailLoading && <p className="refund-retry-note" role="status">Checking the saved stock choice…</p>}
          {refundDetailError && <Alert onRetry={onRetryDetails}>{refundDetailError}</Alert>}
          <div className="order-controls">
            <button className="button button-primary" type="button" onClick={onRefund} disabled={saving || refundDetailLoading || Boolean(refundDetailError)}><RotateCcw size={15} aria-hidden="true" />{saving ? "Sending…" : refundUnknown || order.state === "refund_unknown" ? "Retry refund" : "Confirm refund"}</button>
            <button className="text-button" type="button" onClick={onCloseRefund}>Close</button>
          </div>
        </div>
      )}
    </article>
  );
}

export function InventoryCard({ products, saving, feedback, onSave }: {
  products: OrganizerProduct[];
  saving: string | null;
  feedback: Record<string, string>;
  onSave: (event: FormEvent<HTMLFormElement>, product: OrganizerProduct) => void;
}) {
  return (
    <section className="dashboard-card" aria-labelledby="inventory-heading">
      <div className="section-heading"><div><p className="eyebrow">Live quantities</p><h2 id="inventory-heading">Inventory</h2></div><span className="status-pill">{products.length} items</span></div>
      {products.length === 0 ? <div className="empty-state"><strong>No active products</strong>Items can be added to the menu from the stall setup.</div> : (
        <div className="dashboard-table-wrap">
          <table className="inventory-table">
            <thead><tr><th scope="col">Item</th><th scope="col">Price &amp; physical count</th><th scope="col">Reserved</th><th scope="col">Available</th></tr></thead>
            <tbody>{products.map((product) => <tr key={`${product.id}-${product.stockOnHand}-${product.priceMinor}`}>
              <td className="inventory-name">{product.name}<span className="inventory-note">{product.dietaryNote || "No dietary note"}</span></td>
              <td>
                <form className="inventory-edit-form" onSubmit={(event) => onSave(event, product)}>
                  <div className="inventory-edit">
                    <label className="sr-only" htmlFor={`price-${product.id}`}>Price for {product.name} in {product.currency}</label>
                    <input id={`price-${product.id}`} name="price" type="number" inputMode="decimal" min={product.currency === "JPY" ? 1 : 0.01} max={amountFromMinor(1000000, product.currency)} step={product.currency === "JPY" ? 1 : 0.01} defaultValue={amountFromMinor(product.priceMinor, product.currency)} required />
                    <span className="input-separator" aria-hidden="true">·</span>
                    <label className="sr-only" htmlFor={`stock-${product.id}`}>Physical stock count for {product.name}</label>
                    <input id={`stock-${product.id}`} name="stockOnHand" type="number" inputMode="numeric" min={product.reserved} max={999} step={1} defaultValue={product.stockOnHand} required />
                    <button type="submit" aria-label={`Save price and stock for ${product.name}`} disabled={saving === product.id}>{saving === product.id ? "…" : <Check size={16} aria-hidden="true" />}</button>
                  </div>
                </form>
                {feedback[product.id] && <span className={`inventory-feedback ${feedback[product.id].startsWith("Saved") ? "saved" : ""}`} role="status">{feedback[product.id]}</span>}
              </td>
              <td className="stock-count">{product.reserved}</td><td className="stock-count">{product.available}</td>
            </tr>)}</tbody>
          </table>
        </div>
      )}
      <p className="inventory-help">Price is in {products[0]?.currency ?? "event currency"}. Physical count cannot fall below reserved quantities.</p>
    </section>
  );
}
