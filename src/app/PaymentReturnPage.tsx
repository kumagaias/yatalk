import { Check, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BrandHeader } from "../components/BrandHeader";
import { Alert } from "../components/Feedback";
import { ApiError, post } from "../lib/api";
import { isReceiptReady } from "../lib/order-status";
import { money } from "../lib/format";
import type { OrderState } from "../types";

type PaymentReceipt = {
  orderId: string;
  state: OrderState;
  totalMinor: number;
  currency: string;
  pickupCode?: string | null;
  items?: Array<{ name: string; quantity: number }>;
};

export function PaymentReturnPage() {
  const paypalOrderId = useRef(new URLSearchParams(window.location.search).get("token") ?? "").current;
  const [receipt, setReceipt] = useState<PaymentReceipt | null>(null);
  const [feedback, setFeedback] = useState("Confirming your PayPal payment…");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const active = useRef(false);

  const confirm = useCallback(async (attempt = 0) => {
    if (!paypalOrderId || active.current) return;
    active.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await post<PaymentReceipt>("/api/payment-return/capture", { paypalOrderId });
      setReceipt(result);
      if (isReceiptReady(result.state, result.pickupCode)) {
        setFeedback("Payment confirmed");
        window.history.replaceState(null, "", "/payment/return");
        return;
      }
      setFeedback("Payment is still being confirmed.");
      if (attempt < 11) window.setTimeout(() => void confirm(attempt + 1), 3_000);
      else setFeedback("Payment is still being checked. Retry to update this page.");
    } catch (reason) {
      const retryable = reason instanceof ApiError && reason.code === "payment_not_approved";
      if (retryable && attempt < 11) {
        setFeedback("Waiting for PayPal to confirm the payment…");
        window.setTimeout(() => void confirm(attempt + 1), 3_000);
      } else {
        setError(reason instanceof Error ? reason.message : "Payment status could not be checked.");
        setFeedback("");
      }
    } finally {
      active.current = false;
      setBusy(false);
    }
  }, [paypalOrderId]);

  useEffect(() => {
    if (paypalOrderId) void confirm();
    else setError("This payment link is missing its PayPal order reference.");
  }, [confirm, paypalOrderId]);

  const paid = receipt && isReceiptReady(receipt.state, receipt.pickupCode);
  return <div className="payment-return-page">
    <BrandHeader />
    <main className="payment-return-shell">
      <section className="payment-return-card" aria-live="polite">
        {paid ? <>
          <div className="payment-return-heading"><Check size={24} aria-hidden="true" /><p>Payment confirmed</p></div>
          <h1>Your order is ready</h1>
          <div className="pickup-code pickup-code-large"><span>Pickup number</span><strong>{receipt.pickupCode}</strong></div>
          <ul className="payment-order-items">{receipt.items?.map((item, index) => <li key={`${item.name}-${index}`}><span>{item.name}</span><strong>× {item.quantity}</strong></li>)}</ul>
          <p className="payment-total">Total <strong>{money(receipt.totalMinor, receipt.currency)}</strong></p>
          <p className="payment-order-id">Order {receipt.orderId.slice(0, 8).toUpperCase()}</p>
        </> : <>
          <div className="payment-return-heading"><RefreshCw size={22} aria-hidden="true" /><p>PayPal checkout</p></div>
          <h1>{receipt ? "Payment pending" : "Checking payment"}</h1>
          {feedback && <p className="payment-return-status" role="status">{feedback}</p>}
          {error && <Alert>{error}</Alert>}
          {paypalOrderId && <button className="button button-primary full-width" type="button" onClick={() => void confirm()} disabled={busy}>
            <RefreshCw size={16} aria-hidden="true" />{busy ? "Checking…" : "Check payment"}
          </button>}
          <Link className="back-link" to="/">Back to shop</Link>
        </>}
      </section>
    </main>
  </div>;
}

export function PaymentCancelPage() {
  return <div className="payment-return-page">
    <BrandHeader />
    <main className="payment-return-shell">
      <section className="payment-return-card">
        <p className="eyebrow">PayPal checkout</p>
        <h1>Payment cancelled</h1>
        <p className="payment-return-status">The order has not been paid.</p>
        <Link className="button button-primary full-width" to="/">Back to shop</Link>
      </section>
    </main>
  </div>;
}
