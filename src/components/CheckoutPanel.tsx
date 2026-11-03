import { INSTANCE_LOADING_STATE, PayPalOneTimePaymentButton, PayPalProvider, usePayPal } from "@paypal/react-paypal-js/sdk-v6";
import { Check, CircleHelp, LockKeyhole, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { AppConfig, Cart, CreateOrderResponse, Order } from "../types";
import { ApiError, get, post } from "../lib/api";
import { createRequestKey, money } from "../lib/format";
import { isReceiptReady } from "../lib/order-status";
import { Alert } from "./Feedback";

const STORAGE_KEY = "yatalk.checkout.v1";
type CheckoutState = "idle" | "creating" | "create_unknown" | "ready" | "capturing" | "capture_unknown" | "canceling" | "cancel_unknown" | "paid" | "cancelled" | "error";
type Attempt = {
  clientRequestKey: string;
  orderId?: string;
  paypalOrderId?: string;
  totalMinor?: number;
  currency?: string;
  cartVersion?: number;
  catalogRevision?: number;
  pickupCode?: string;
  state: CheckoutState;
  message?: string;
};

function restoreAttempt(): Attempt {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const restored = JSON.parse(raw) as Attempt;
      if (restored.state === "creating") restored.state = "create_unknown";
      if (restored.state === "capturing") restored.state = "capture_unknown";
      if (restored.state === "canceling") restored.state = "cancel_unknown";
      return restored;
    }
  } catch { /* Session storage is optional; the server still owns order state. */ }
  return { clientRequestKey: createRequestKey(), state: "idle" };
}

function PayPalControls({ attempt, onCapture, onCancel, onSdkError, onRetrySdk }: {
  attempt: Attempt;
  onCapture: () => Promise<void>;
  onCancel: () => Promise<void>;
  onSdkError: () => void;
  onRetrySdk: () => void;
}) {
  const { loadingStatus, error } = usePayPal();
  if (error) return <Alert onRetry={onRetrySdk}>{"PayPal checkout could not load. Retry the sandbox button. Your order remains pending."}</Alert>;
  return (
    <div>
      {loadingStatus === INSTANCE_LOADING_STATE.PENDING && <p className="checkout-status" role="status">Loading PayPal checkout…</p>}
      <PayPalOneTimePaymentButton
        type="pay"
        createOrder={async () => ({ orderId: attempt.paypalOrderId! })}
        onApprove={onCapture}
        onCancel={onCancel}
        onError={onSdkError}
      />
    </div>
  );
}

function CheckoutButtons({ attempt, clientId, onCapture, onCancel, onSdkError, onRetrySdk }: {
  attempt: Attempt;
  clientId: string;
  onCapture: () => Promise<void>;
  onCancel: () => Promise<void>;
  onSdkError: () => void;
  onRetrySdk: () => void;
}) {
  if (!attempt.paypalOrderId) return null;
  return (
    <PayPalProvider clientId={clientId} environment="sandbox" components={["paypal-payments"]} pageType="checkout">
      <PayPalControls attempt={attempt} onCapture={onCapture} onCancel={onCancel} onSdkError={onSdkError} onRetrySdk={onRetrySdk} />
    </PayPalProvider>
  );
}

export function CheckoutPanel({ config, cart, cartBusy, onCart }: { config: AppConfig | null; cart: Cart; cartBusy: boolean; onCart: (cart: Cart) => void }) {
  const [attempt, setAttempt] = useState<Attempt>(restoreAttempt);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [sdkRevision, setSdkRevision] = useState(0);

  useEffect(() => {
    try {
      if (attempt.state === "paid" || attempt.state === "cancelled") {
        sessionStorage.removeItem(STORAGE_KEY);
        return;
      }
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(attempt));
    } catch {
      setStatusMessage("This browser cannot save retry details. Keep this tab open while checkout is in progress.");
    }
  }, [attempt]);

  const update = (patch: Partial<Attempt>) => setAttempt((current) => ({ ...current, ...patch }));

  const create = async (retry: boolean) => {
    if (busy || !config?.paypalEnabled || !config.paypalClientId || cart.items.length === 0) return;
    const clientRequestKey = retry ? attempt.clientRequestKey : createRequestKey();
    const requestCartVersion = retry ? attempt.cartVersion ?? cart.cartVersion : cart.cartVersion;
    const requestCatalogRevision = retry ? attempt.catalogRevision ?? cart.catalogRevision : cart.catalogRevision;
    setBusy(true);
    setStatusMessage("");
    setAttempt({ clientRequestKey, orderId: retry ? attempt.orderId : undefined, cartVersion: requestCartVersion, catalogRevision: requestCatalogRevision, state: "creating" });
    try {
      const result = await post<CreateOrderResponse>("/api/orders", {
        cartVersion: requestCartVersion,
        catalogRevision: requestCatalogRevision,
        clientRequestKey,
      });
      if (result.state === "create_failed") {
        setAttempt({ clientRequestKey, orderId: result.orderId, cartVersion: requestCartVersion, catalogRevision: requestCatalogRevision, state: "error", message: "PayPal could not create this checkout. The reservation was released; start a fresh order when you’re ready." });
        setStatusMessage("This checkout could not be created. Your cart is still available for a fresh attempt.");
      } else if (result.state === "expired" || result.state === "cancelled") {
        setAttempt({ clientRequestKey, orderId: result.orderId, cartVersion: requestCartVersion, catalogRevision: requestCatalogRevision, state: "cancelled", message: "This checkout has ended. Your cart is still available." });
        setStatusMessage("This checkout has ended. Start a new order to try again.");
      } else if (isReceiptReady(result.state, result.pickupCode)) {
        setAttempt({ clientRequestKey, orderId: result.orderId, cartVersion: requestCartVersion, catalogRevision: requestCatalogRevision, state: "paid", totalMinor: result.totalMinor, currency: result.currency, pickupCode: result.pickupCode });
      } else if (result.state === "capture_unknown") {
        setAttempt({ clientRequestKey, orderId: result.orderId, cartVersion: requestCartVersion, catalogRevision: requestCatalogRevision, state: "capture_unknown", totalMinor: result.totalMinor, currency: result.currency, message: "This order’s payment status needs checking. Use the explicit capture retry below." });
      } else if (result.state === "create_unknown" || !result.paypalOrderId) {
        setAttempt({ clientRequestKey, orderId: result.orderId, cartVersion: requestCartVersion, catalogRevision: requestCatalogRevision, state: "create_unknown", message: "The order is still being created. Retry safely to recover the same checkout." });
      } else {
        setAttempt({
          clientRequestKey,
          cartVersion: requestCartVersion,
          catalogRevision: requestCatalogRevision,
          orderId: result.orderId,
          paypalOrderId: result.paypalOrderId,
          totalMinor: result.totalMinor ?? cart.totalMinor,
          currency: result.currency ?? cart.currency,
          state: "ready",
        });
      }
    } catch (error) {
      const uncertain = !(error instanceof ApiError) || error.status === 0 || error.status >= 500 || error.code === "idempotency_conflict";
      if (error instanceof ApiError && error.code === "cart_changed") {
        void refreshCart();
        setAttempt({ clientRequestKey, cartVersion: requestCartVersion, catalogRevision: requestCatalogRevision, state: "error", message: error.message });
        setStatusMessage(`${error.message} Your order was not reserved. Review the updated cart, then confirm again.`);
      } else {
        setAttempt((current) => ({ ...current, clientRequestKey, cartVersion: requestCartVersion, catalogRevision: requestCatalogRevision, state: uncertain ? "create_unknown" : "error", message: error instanceof Error ? error.message : "We could not confirm order creation. Retry the same request." }));
        if (!uncertain) setStatusMessage(error instanceof Error ? error.message : "Order creation failed. Your cart is unchanged.");
      }
    } finally {
      setBusy(false);
    }
  };

  const capture = async () => {
    if (!attempt.orderId || busy) return;
    setBusy(true);
    setStatusMessage("");
    update({ state: "capturing" });
    try {
      const result = await post<Order>(`/api/orders/${encodeURIComponent(attempt.orderId)}/capture`);
      if (isReceiptReady(result.state, result.pickupCode)) {
        setAttempt((current) => ({ ...current, state: "paid", pickupCode: result.pickupCode ?? undefined, totalMinor: result.totalMinor, currency: result.currency }));
        setStatusMessage("Payment complete. Your order is ready for pickup.");
        void refreshCart();
      } else {
        update({ state: "capture_unknown", message: "Payment approval was received. We are checking the capture; your pickup code will appear only after it is confirmed." });
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === "order_expired") {
        setAttempt((current) => ({ ...current, state: "cancelled", orderId: undefined, paypalOrderId: undefined, message: "This checkout expired. Your cart is still available." }));
        setStatusMessage("This checkout expired. Start a new order to continue.");
        void refreshCart();
        return;
      }
      const uncertain = !(error instanceof ApiError) || error.status === 0 || error.status >= 500;
      update({ state: uncertain ? "capture_unknown" : "ready", message: error instanceof Error ? error.message : "We could not confirm the payment. Check its status, then retry capture if needed." });
      if (!uncertain && error instanceof Error) setStatusMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!attempt.orderId || busy) return;
    setBusy(true);
    update({ state: "canceling" });
    try {
      await post(`/api/orders/${encodeURIComponent(attempt.orderId)}/cancel`);
      setAttempt((current) => ({ ...current, state: "cancelled", paypalOrderId: undefined, orderId: undefined }));
      setStatusMessage("Checkout was cancelled. Your cart is still here.");
      void refreshCart();
    } catch (error) {
      update({ state: "cancel_unknown", message: error instanceof Error ? error.message : "We could not confirm cancellation. Retry the cancel request." });
    } finally {
      setBusy(false);
    }
  };

  const refreshCart = async () => {
    try {
      onCart(await get<Cart>("/api/cart"));
    } catch {
      setStatusMessage("Payment status was saved, but the cart could not refresh. You can retry from the page.");
    }
  };

  const readStatus = async () => {
    if (!attempt.orderId || busy) return;
    setBusy(true);
    try {
      const order = await get<Order>(`/api/orders/${encodeURIComponent(attempt.orderId)}`);
      if (isReceiptReady(order.state, order.pickupCode)) {
        setAttempt((current) => ({ ...current, ...order, state: "paid", pickupCode: order.pickupCode! }));
        setStatusMessage("Payment is confirmed. Your pickup code is ready.");
      } else if (order.state === "pending_payment") {
        update({ state: "ready", message: "Payment is still pending. You can continue checkout or retry capture after approval." });
      } else if (order.state === "capture_unknown") {
        update({ state: "capture_unknown", message: "Payment is still being checked. You can explicitly retry capture below." });
      } else if (order.state === "cancelled" || order.state === "expired") {
        setAttempt((current) => ({ ...current, state: "cancelled", message: "This checkout has ended. Your cart is still available." }));
      } else {
        update({ message: `Current order status: ${order.state.replaceAll("_", " ")}.` });
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not read the saved order status.");
    } finally {
      setBusy(false);
    }
  };

  const resetForNewOrder = () => setAttempt({ clientRequestKey: createRequestKey(), state: "idle" });
  const start = () => { if (attempt.state === "paid") resetForNewOrder(); else void create(false); };
  const retryCreate = () => void create(true);
  const retryCapture = () => void capture();
  const retryCancel = () => void cancel();
  const sdkError = () => setStatusMessage("PayPal checkout had a problem. Your order is still pending; retry the PayPal button or cancel checkout.");
  const retrySdk = () => setSdkRevision((value) => value + 1);
  const isAvailable = Boolean(config?.paypalEnabled && config.paypalClientId);
  const shopSlug = /^\/shops\/([a-z0-9-]+)(?:\/|$)/.exec(globalThis.location?.pathname ?? "")?.[1] ?? "little-harbor-market";

  return (
    <section className="checkout-panel" aria-labelledby="checkout-heading">
      <div className="checkout-heading"><LockKeyhole size={17} aria-hidden="true" /><h3 id="checkout-heading">Secure checkout</h3><span>PayPal sandbox</span></div>
      {!isAvailable ? (
        <div className="setup-notice"><CircleHelp size={19} aria-hidden="true" /><p>PayPal sandbox is not configured yet. Add the public sandbox client ID and server credentials to enable checkout. No payment has been started.</p></div>
      ) : attempt.state === "idle" || attempt.state === "cancelled" || attempt.state === "error" ? (
        <button className="button button-primary checkout-start" type="button" onClick={start} disabled={busy || cartBusy || cart.items.length === 0}>{busy ? "Preparing your order…" : "Confirm order & continue"}</button>
      ) : null}
      {attempt.state === "creating" && <p className="checkout-status" role="status">Reserving your items and opening checkout…</p>}
      {attempt.state === "create_unknown" && <div className="checkout-recovery"><Alert>{attempt.message ?? "The result is uncertain. Retry the same order request."}</Alert><button className="button button-secondary full-width" onClick={retryCreate} disabled={busy || cartBusy}><RefreshCw size={16} aria-hidden="true" />Retry order creation</button></div>}
      {attempt.state === "ready" && isAvailable && (
        <div className="paypal-area">
          <p className="checkout-status" role="status">Your order is reserved. Approve the total in PayPal to complete payment.</p>
          <CheckoutButtons key={sdkRevision} attempt={attempt} clientId={config!.paypalClientId!} onCapture={capture} onCancel={cancel} onSdkError={sdkError} onRetrySdk={retrySdk} />
          {statusMessage && <Alert>{statusMessage}</Alert>}
          {attempt.orderId && <button className="text-button" type="button" onClick={cancel} disabled={busy}>Cancel checkout</button>}
        </div>
      )}
      {attempt.state === "capturing" && <p className="checkout-status" role="status">Confirming your PayPal payment…</p>}
      {attempt.state === "capture_unknown" && (
        <div className="checkout-recovery">
          <Alert>{attempt.message ?? "Payment status is uncertain. Your reserved items are safe while we check."}</Alert>
          <div className="recovery-actions"><button className="button button-secondary" onClick={readStatus} disabled={busy}><CircleHelp size={16} aria-hidden="true" />Check saved status</button><button className="button button-primary" onClick={retryCapture} disabled={busy}><RefreshCw size={16} aria-hidden="true" />Retry capture</button></div>
        </div>
      )}
      {attempt.state === "canceling" && <p className="checkout-status" role="status">Releasing this reservation…</p>}
      {attempt.state === "cancel_unknown" && <div className="checkout-recovery"><Alert>{attempt.message ?? "Cancellation is not confirmed yet."}</Alert><div className="recovery-actions"><button className="button button-secondary" onClick={readStatus} disabled={busy}><CircleHelp size={16} aria-hidden="true" />Check saved status</button><button className="button button-primary" onClick={retryCancel} disabled={busy}><RefreshCw size={16} aria-hidden="true" />Retry cancellation</button></div></div>}
      {attempt.state === "paid" && (
        <div className="receipt" role="status">
          <div className="receipt-stamp"><Check size={20} aria-hidden="true" />Payment confirmed</div>
          <p className="eyebrow">Your market order</p>
          <h4>See you at the stall!</h4>
          <div className="receipt-summary"><span>Order <strong>#{attempt.orderId?.slice(0, 8).toUpperCase()}</strong></span><span>Total <strong>{money(attempt.totalMinor ?? cart.totalMinor, attempt.currency ?? cart.currency)}</strong></span></div>
          <p>Show this pickup code to the organizer.</p>
          <div className="pickup-code"><span>Pickup code</span><strong>{attempt.pickupCode}</strong></div>
          {attempt.orderId && <Link className="text-button" to={`/shops/${encodeURIComponent(shopSlug)}/orders/${encodeURIComponent(attempt.orderId)}`}>Open order status</Link>}
        </div>
      )}
      {statusMessage && (attempt.state !== "ready") && <p className="checkout-status" role="status">{statusMessage}</p>}
      {(attempt.state === "cancelled" || attempt.state === "paid") && <button className="text-button new-order" onClick={start} type="button">{attempt.state === "paid" ? "Start another order" : "Try checkout again"}</button>}
      <p className="checkout-footnote">Your payment details stay with PayPal. The market never stores card information.</p>
    </section>
  );
}
