import { ArrowRight, ShoppingBag, Trash2 } from "lucide-react";
import type { Cart, CartLine, AppConfig } from "../types";
import { money } from "../lib/format";
import { QuantityControl } from "./QuantityControl";
import { CheckoutPanel } from "./CheckoutPanel";
import { Alert } from "./Feedback";

type Props = {
  cart: Cart | null;
  config: AppConfig | null;
  busy: boolean;
  error: string;
  onChange: (line: CartLine, quantity: number) => void;
  onClear: () => void;
  onRetry: () => void;
  onCart: (cart: Cart) => void;
  kioskMode?: boolean;
  confirmOrderKey?: number;
  onCheckoutActiveChange?: (active: boolean) => void;
};

export function CartPanel({ cart, config, busy, error, onChange, onClear, onRetry, onCart, kioskMode = false, confirmOrderKey = 0, onCheckoutActiveChange }: Props) {
  return (
    <section className="panel cart-panel" aria-labelledby="cart-heading">
      <div className="panel-heading cart-heading">
        <div className="heading-icon bag-icon"><ShoppingBag size={18} aria-hidden="true" /></div>
        <div><p className="eyebrow">Made to order</p><h2 id="cart-heading">Your order</h2></div>
        <span className="cart-count" aria-label={`${cart?.items.length ?? 0} items`}>{cart?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0}</span>
      </div>
      {error && <Alert onRetry={onRetry} retryDisabled={busy}>{error}</Alert>}
      {!cart ? (
        <p className="empty-cart">Your order is getting ready…</p>
      ) : cart.items.length === 0 ? (
        <div className="empty-cart">
          <span className="empty-cart-illustration" aria-hidden="true">🥡</span>
          <h3>Your bag is taking a stroll.</h3>
          <p>Add a market favorite or ask the chat helper to find something good.</p>
          <a className="text-button menu-jump" href="#market-menu"><ArrowRight size={16} aria-hidden="true" />Browse the menu</a>
        </div>
      ) : (
        <>
          <ul className="cart-lines">
            {cart.items.map((line) => (
              <li className="cart-line" key={line.productId ?? line.id ?? line.name}>
                <div className="cart-line-copy"><strong>{line.name}</strong><span>{money(line.lineTotalMinor, cart.currency)}</span></div>
                <div className="cart-line-tools"><QuantityControl label={line.name} quantity={line.quantity} max={Math.min(20, line.available)} disabled={busy} onChange={(quantity) => onChange(line, quantity)} /><span className="unit-price">{money(line.unitPriceMinor ?? line.priceMinor ?? 0, cart.currency)} each</span></div>
              </li>
            ))}
          </ul>
          <button className="text-button clear-cart" type="button" onClick={onClear} disabled={busy}><Trash2 size={15} aria-hidden="true" />Clear cart</button>
          <div className="cart-total"><span>Total</span><strong>{money(cart.totalMinor, cart.currency)}</strong></div>
          {cart.items.some((item) => item.quantity > item.available) && <p className="stock-note">One or more quantities exceed current availability. Update your order before checkout.</p>}
        </>
      )}
      {cart && <CheckoutPanel config={config} cart={cart} cartBusy={busy} onCart={onCart} kioskMode={kioskMode}
        confirmOrderKey={confirmOrderKey} onActiveChange={onCheckoutActiveChange} />}
    </section>
  );
}
