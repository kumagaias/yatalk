import { ArrowUpRight, CircleHelp, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import type { AppConfig, Cart, CartLine, MenuResponse, Product } from "../types";
import { ApiError, del, get, post } from "../lib/api";
import { createSerialMutationQueue } from "../lib/serial-mutation-queue";
import { BrandHeader } from "../components/BrandHeader";
import { ChatPanel } from "../components/ChatPanel";
import { CartPanel } from "../components/CartPanel";
import { CounterOrderQr } from "../components/CounterOrderQr";
import { ShopCover } from "../components/ShopCover";
import { ProductCarousel } from "../components/ProductCarousel";
import { MenuSection } from "../components/MenuSection";
import { Loading } from "../components/Feedback";
import { useScreenWakeLock } from "../lib/use-screen-wake-lock";

type ChatHistoryItem = { role: "user" | "assistant"; content: string };

export function MarketPage() {
  const { ownerSlug, shopSlug } = useParams();
  return <ShopMarketPage key={`${ownerSlug ?? "legacy"}/${shopSlug ?? "default"}`} shopSlug={shopSlug} ownerSlug={ownerSlug} />;
}

function ShopMarketPage({ shopSlug, ownerSlug }: { shopSlug?: string; ownerSlug?: string }) {
  const location = useLocation();
  const counterMode = new URLSearchParams(location.search).get("counter") === "1";
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [cart, setCart] = useState<Cart | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [eventName, setEventName] = useState("Little Harbor Market");
  const [confirmOrderKey, setConfirmOrderKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [menuError, setMenuError] = useState("");
  const [configError, setConfigError] = useState("");
  const [cartError, setCartError] = useState("");
  const [cartMutationBusy, setCartMutationBusy] = useState(false);
  const [productBusy, setProductBusy] = useState<string | null>(null);
  const [cartBusyError, setCartBusyError] = useState("");
  const [checkoutActive, setCheckoutActive] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const cartRef = useRef<Cart | null>(null);
  const mutationQueueRef = useRef(createSerialMutationQueue());
  useScreenWakeLock(counterMode);

  const setCurrentCart = useCallback((next: Cart) => {
    const latest = cartRef.current;
    if (latest && (next.cartVersion < latest.cartVersion ||
      next.cartVersion === latest.cartVersion && next.catalogRevision < latest.catalogRevision)) return;
    cartRef.current = next;
    setCart(next);
  }, []);

  const runCartMutation = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    setCartMutationBusy(true);
    return mutationQueueRef.current.run(operation).finally(() => {
      if (!mutationQueueRef.current.isBusy()) setCartMutationBusy(false);
    });
  }, []);

  const loadMenu = useCallback(async () => {
    const result = await get<MenuResponse>("/api/menu");
    setProducts(result.products);
    setMenuError("");
    setEventName(typeof result.event === "string" ? result.event : result.event.name ?? "Little Harbor Market");
  }, []);
  const loadCart = useCallback(async () => {
    const result = await get<Cart>("/api/cart");
    setCurrentCart(result);
    setCartError("");
    return result;
  }, [setCurrentCart]);
  const refreshMenu = useCallback(async () => {
    try { await loadMenu(); }
    catch (error) {
      setMenuError(error instanceof Error ? error.message : "Menu unavailable. Please retry.");
    }
  }, [loadMenu]);
  const loadAll = useCallback(async () => {
    setLoading(true);
    setMenuError("");
    setConfigError("");
    const [configResult, menuResult, cartResult] = await Promise.allSettled([
      get<AppConfig>("/api/config"), loadMenu(), loadCart(),
    ]);
    if (configResult.status === "fulfilled") setConfig(configResult.value);
    else setConfigError("Payment setup could not be checked. Reload to try again; manual ordering is still available.");
    if (menuResult.status === "rejected") setMenuError(menuResult.reason instanceof Error ? menuResult.reason.message : "Menu unavailable. Please retry.");
    if (cartResult.status === "rejected") setCartError(cartResult.reason instanceof Error ? cartResult.reason.message : "Order summary unavailable.");
    setLoading(false);
  }, [loadCart, loadMenu]);

  useEffect(() => { void loadAll(); }, [loadAll]);
  useEffect(() => {
    if (!checkoutActive || confirmOrderKey === 0) return;
    window.requestAnimationFrame(() => document.getElementById("checkout-panel")?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }, [checkoutActive, confirmOrderKey]);

  const refreshCartAndMenu = useCallback(async () => {
    const [cartResult, menuResult] = await Promise.allSettled([loadCart(), loadMenu()]);
    if (cartResult.status === "rejected") setCartError(cartResult.reason instanceof Error ? cartResult.reason.message : "Order summary unavailable.");
    if (menuResult.status === "rejected") setMenuError(menuResult.reason instanceof Error ? menuResult.reason.message : "Menu unavailable. Please retry.");
  }, [loadCart, loadMenu]);

  const mutateCart = (action: "add" | "set" | "remove", productId: string, quantity: number, busyKey?: string) => {
    void runCartMutation(async () => {
      const current = cartRef.current;
      if (!current) return;
      setCartBusyError("");
      setProductBusy(busyKey ?? null);
      try {
        const result = await post<Cart>("/api/cart/items", {
          action, productId, quantity,
          cartVersion: current.cartVersion,
          catalogRevision: current.catalogRevision,
        });
        setCurrentCart(result);
        if (action === "add") await refreshMenu();
      } catch (error) {
        setCartBusyError(error instanceof ApiError ? error.message : "Your order could not be updated. Please retry.");
        if (error instanceof ApiError && error.status === 409) await refreshCartAndMenu();
      } finally {
        setProductBusy(null);
      }
    });
  };

  const clearCart = () => {
    void runCartMutation(async () => {
      setCartBusyError("");
      try { setCurrentCart(await del<Cart>("/api/cart")); }
      catch (error) {
        setCartBusyError(error instanceof Error ? error.message : "Your order could not be cleared.");
        if (error instanceof ApiError && error.status === 409) await refreshCartAndMenu();
      }
    });
  };

  const sendChat = useCallback(async (message: string, history: ChatHistoryItem[]) => runCartMutation(async () => {
    const current = cartRef.current;
    if (!current) throw new Error("Your order is unavailable. Reload the order summary and try again.");
    setCartBusyError("");
    try {
      const result = await post<{ reply: string; clarification: string | null; cart: Cart }>("/api/chat", {
        message, history,
        replyLanguage: document.documentElement.lang.toLowerCase().startsWith("ja") ? "ja" : "en",
        cartVersion: current.cartVersion,
        catalogRevision: current.catalogRevision,
      });
      setCurrentCart(result.cart);
      return result;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) await refreshCartAndMenu();
      throw error;
    }
  }), [refreshCartAndMenu, runCartMutation, setCurrentCart]);

  const updateLine = (line: CartLine, quantity: number) => {
    const productId = line.productId ?? line.id;
    if (productId) mutateCart(quantity === 0 ? "remove" : "set", productId, quantity);
  };
  const addProduct = (product: Product) => mutateCart("add", product.id, 1, product.id);
  const retryCart = () => {
    setCartBusyError("");
    void refreshCartAndMenu();
  };
  const finishVoiceOrder = useCallback(() => {
    if (!cartRef.current?.items.length) return false;
    setConfirmOrderKey((value) => value + 1);
    return true;
  }, []);
  const currentName = config?.eventName || eventName;
  const marketUrl = ownerSlug && shopSlug
    ? `/${encodeURIComponent(ownerSlug)}/${encodeURIComponent(shopSlug)}`
    : shopSlug ? `/shops/${encodeURIComponent(shopSlug)}` : "/shops/little-harbor-market";
  const dashboardUrl = ownerSlug && shopSlug
    ? `/dashboard/${encodeURIComponent(ownerSlug)}/${encodeURIComponent(shopSlug)}`
    : shopSlug ? `/dashboard/shops/${encodeURIComponent(shopSlug)}` : "/dashboard/login";
  const shopOrderUrl = new URL(marketUrl, window.location.origin).toString();

  return (
    <div className={`market-page${counterMode ? " counter-mode" : ""}`}>
      <BrandHeader eventName={currentName} counterPath={counterMode ? marketUrl : `${marketUrl}?counter=1`} counterMode={counterMode} shopperMode={!counterMode} menuOpen={menuOpen} onMenuOpen={counterMode ? undefined : () => setMenuOpen(true)} />
      <main className="market-main">
        {loading && !products.length && <Loading>Opening the market…</Loading>}
        {menuError && <div className="page-alert" role="alert"><CircleHelp size={18} aria-hidden="true" /><span>{menuError}</span><button className="text-button" onClick={() => void loadAll()}><RefreshCw size={15} aria-hidden="true" />Retry</button></div>}
        {configError && <div className="setup-banner" role="status"><CircleHelp size={17} aria-hidden="true" />{configError}</div>}
        {counterMode ? <CounterOrderQr shopName={currentName} shopUrl={shopOrderUrl} /> : <>
          <ShopCover shopName={currentName} shopSlug={shopSlug ?? "little-harbor-market"} ownerSlug={ownerSlug} />
          <ProductCarousel products={products} disabled={checkoutActive || cartMutationBusy || cart === null} onAdd={addProduct} />
          <div className="customer-order-layout">
            <button className={`menu-drawer-backdrop${menuOpen ? " open" : ""}`} type="button" aria-label="Close menu" onClick={() => setMenuOpen(false)} />
            <aside className={`menu-drawer${menuOpen ? " open" : ""}`} id="market-menu-drawer" aria-label="Menu">
              <button className="menu-drawer-close" type="button" onClick={() => setMenuOpen(false)}>Close</button>
              <MenuSection products={products} loading={loading && products.length === 0} busy={productBusy} mutationBusy={checkoutActive || cartMutationBusy || cart === null} onAdd={addProduct} />
            </aside>
            <aside className="market-sidebar" aria-label="Voice order and checkout">
            <ChatPanel cart={cart} mutationBusy={cartMutationBusy} orderLocked={checkoutActive} onSend={sendChat}
              voiceConversation onFinishOrder={finishVoiceOrder} />
            <CartPanel
              cart={cart} config={config} busy={checkoutActive || cartMutationBusy || loading} error={cartError || cartBusyError}
              onChange={updateLine} onClear={clearCart} onRetry={retryCart} onCart={setCurrentCart} kioskMode={counterMode}
              confirmOrderKey={confirmOrderKey} onCheckoutActiveChange={setCheckoutActive}
            />
            </aside>
          </div>
          <footer className="market-footer"><span>{currentName}</span><Link to={dashboardUrl}>For the people behind the stall <ArrowUpRight size={14} aria-hidden="true" /></Link><span>Order with care. Pick up with a smile.</span></footer>
        </>}
      </main>
    </div>
  );
}
