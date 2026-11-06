import { ArrowRight, ArrowUpRight, Leaf, LogOut, Plus, Store } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Alert, Loading } from "../components/Feedback";
import { BrandHeader } from "../components/BrandHeader";
import { del, get, post } from "../lib/api";
import { isValidShopSlug, shopSlugFromName } from "../lib/shop-slug";
import type { Order } from "../types";
import { money } from "../lib/format";
import { useParams } from "react-router-dom";

type ShopSummary = { slug: string; name: string; status: "active" | "inactive" };

export function PlatformHome() {
  return <div>
    <BrandHeader />
    <main className="landing-main">
      <section className="landing-hero">
        <p className="hero-kicker"><span />A voice-first order desk for local shops</p>
        <h1>Open your shop.<br /><span>Let customers order their way.</span></h1>
        <p className="hero-description">Create a simple storefront with a menu, voice and chat ordering, and PayPal checkout.</p>
        <div className="tenant-actions">
          <Link className="button button-primary" to="/shops/new">Create a shop <ArrowRight size={17} /></Link>
          <Link className="button button-secondary" to="/shops/little-harbor-market">Visit the sample shop <ArrowUpRight size={16} /></Link>
        </div>
      </section>
      <section className="landing-owner"><Store size={21} aria-hidden="true" /><div><strong>Already run a shop?</strong><span>Sign in to manage your orders and menu.</span></div><Link className="text-button" to="/dashboard/login">Owner sign in <ArrowRight size={15} /></Link></section>
    </main>
  </div>;
}

export function ShopSetupPage({ addAnother = false }: { addAnother?: boolean }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [slugAvailability, setSlugAvailability] = useState<"idle" | "checking" | "available" | "taken" | "invalid" | "error">("idle");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!slug) {
      setSlugAvailability("idle");
      return;
    }
    if (!isValidShopSlug(slug)) {
      setSlugAvailability("invalid");
      return;
    }

    let current = true;
    setSlugAvailability("checking");
    const timer = window.setTimeout(() => {
      void get<{ available: boolean }>(`/api/v1/shops/slug-availability/${encodeURIComponent(slug)}`)
        .then(({ available }) => {
          if (current) setSlugAvailability(available ? "available" : "taken");
        })
        .catch(() => {
          if (current) setSlugAvailability("error");
        });
    }, 300);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [slug]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const payload = addAnother ? { name, slug } : { name, slug, email, password };
      const path = addAnother ? "/api/v1/dashboard/shops" : "/api/v1/shops";
      const result = await post<{ shop: ShopSummary }>(path, payload);
      navigate(`/dashboard/shops/${encodeURIComponent(result.shop.slug)}`, { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The shop could not be created. Please retry.");
    } finally { setBusy(false); }
  };

  return <div>
    <BrandHeader />
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="shop-setup-heading">
        <span className="auth-symbol"><Leaf size={22} aria-hidden="true" /></span>
        <p className="eyebrow">{addAnother ? "Your owner account" : "Start your storefront"}</p>
        <h1 id="shop-setup-heading">{addAnother ? "Add a shop" : "Create your shop"}</h1>
        <p className="auth-intro">Your public page will be at <strong>yatalk.kumagaias.com/shops/{slug || "your-shop"}</strong>.</p>
        <form onSubmit={(event) => void submit(event)}>
          <div className="form-field"><label htmlFor="shop-name">Shop name</label><input id="shop-name" autoComplete="organization" maxLength={80} required value={name} onChange={(event) => { const value = event.target.value; setName(value); if (!slugEdited) setSlug(shopSlugFromName(value)); setError(""); }} /></div>
          <div className="form-field"><label htmlFor="shop-slug">Shop address</label><div className="slug-input"><span>yatalk.kumagaias.com/shops/</span><input id="shop-slug" autoComplete="off" minLength={3} maxLength={40} pattern="[a-z0-9]+(-[a-z0-9]+)*" required value={slug} onChange={(event) => { setSlug(event.target.value.toLowerCase()); setSlugEdited(true); setError(""); }} /></div><p className="form-help">Generated from your shop name. You can edit it before creating your shop.</p>
            {slugAvailability === "checking" && <p className="form-help" role="status">Checking address availability…</p>}
            {slugAvailability === "available" && <p className="form-help slug-status form-help-success" role="status">This address is available.</p>}
            {slugAvailability === "taken" && <p className="form-help slug-status form-help-error" role="status">This address is already in use.</p>}
            {slugAvailability === "invalid" && <p className="form-help slug-status form-help-error" role="status">Use 3–40 lowercase letters, numbers, or single hyphens.</p>}
            {slugAvailability === "error" && <p className="form-help slug-status" role="status">Address availability could not be checked. We’ll verify it when you create your shop.</p>}
          </div>
          {!addAnother && <>
            <div className="form-field"><label htmlFor="owner-email">Owner email</label><input id="owner-email" type="email" autoComplete="email" maxLength={254} required value={email} onChange={(event) => setEmail(event.target.value)} /></div>
            <div className="form-field"><label htmlFor="owner-password">Password</label><input id="owner-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} /><p className="form-help">Use at least 12 characters.</p></div>
          </>}
          {error && <Alert>{error}</Alert>}
          <button className="button button-primary" type="submit" disabled={busy || slugAvailability === "checking" || slugAvailability === "taken" || slugAvailability === "invalid"}>{busy ? "Creating shop…" : addAnother ? "Add shop" : "Create shop"}</button>
        </form>
        <Link className="back-link" to={addAnother ? "/dashboard/shops" : "/dashboard/login"}>{addAnother ? "Back to your shops" : "Already have an account? Sign in"}</Link>
      </section>
    </main>
  </div>;
}

export function OwnerLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await post<void>("/api/v1/auth/session", { email, password });
      navigate("/dashboard/shops", { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "We could not sign you in. Please retry.");
    } finally { setBusy(false); }
  };

  return <div>
    <BrandHeader />
    <main className="auth-shell"><section className="auth-card" aria-labelledby="owner-login-heading">
      <span className="auth-symbol"><Store size={22} aria-hidden="true" /></span><p className="eyebrow">Shop management</p><h1 id="owner-login-heading">Owner sign in</h1>
      <p className="auth-intro">Open your shops, orders, and inventory.</p>
      <form onSubmit={(event) => void submit(event)}>
        <div className="form-field"><label htmlFor="login-email">Email</label><input id="login-email" type="email" autoComplete="username" maxLength={254} required value={email} onChange={(event) => setEmail(event.target.value)} /></div>
        <div className="form-field"><label htmlFor="login-password">Password</label><input id="login-password" type="password" autoComplete="current-password" maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} /></div>
        {error && <Alert>{error}</Alert>}
        <button className="button button-primary" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
      <Link className="back-link" to="/shops/new">Create a shop</Link>
    </section></main>
  </div>;
}

export function OwnerShopsPage() {
  const [shops, setShops] = useState<ShopSummary[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const navigate = useNavigate();
  const load = async () => {
    setLoading(true);
    setError("");
    try { setShops((await get<{ shops: ShopSummary[] }>("/api/v1/dashboard/shops")).shops); }
    catch (reason) {
      if (reason instanceof Error && "status" in reason && reason.status === 401) navigate("/dashboard/login", { replace: true });
      else setError(reason instanceof Error ? reason.message : "Your shops could not be loaded.");
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const signOut = async () => {
    setSigningOut(true);
    setError("");
    try { await del<void>("/api/v1/auth/session"); navigate("/", { replace: true }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Sign out failed. Please retry."); }
    finally { setSigningOut(false); }
  };

  return <div>
    <BrandHeader eventName="Your shops" />
    <main className="dashboard-main">
      <div className="dashboard-top"><div><p className="eyebrow">Shop owner</p><h1 className="page-title">Your shops</h1><p className="dashboard-subtitle">Open a storefront or manage its orders and inventory.</p></div><div className="dashboard-actions"><Link className="button button-primary" to="/dashboard/shops/new"><Plus size={16} />Add a shop</Link><button className="text-button" type="button" disabled={signingOut} onClick={() => void signOut()}><LogOut size={15} />{signingOut ? "Signing out…" : "Sign out"}</button></div></div>
      {loading && <Loading>Loading your shops…</Loading>}
      {error && <Alert onRetry={() => void load()}>{error}</Alert>}
      {!loading && !error && shops.length === 0 && <div className="empty-state"><strong>No shops yet</strong><Link className="text-button" to="/dashboard/shops/new">Create your first shop</Link></div>}
      <div className="tenant-shop-grid">{shops.map((shop) => <article className="tenant-shop-card" key={shop.slug}><p className="eyebrow">{shop.status === "active" ? "Open" : "Paused"}</p><h2>{shop.name}</h2><p>yatalk.kumagaias.com/shops/{shop.slug}</p><div className="tenant-actions"><Link className="button button-primary" to={`/dashboard/shops/${encodeURIComponent(shop.slug)}`}>Manage shop <ArrowRight size={16} /></Link><Link className="text-button" to={`/shops/${encodeURIComponent(shop.slug)}`} target="_blank" rel="noreferrer">Open storefront <ArrowUpRight size={15} /></Link></div></article>)}</div>
    </main>
  </div>;
}

export function ShopOrderPage() {
  const { shopSlug, orderId } = useParams();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = async () => {
    if (!orderId) return;
    setLoading(true);
    setError("");
    try { setOrder(await get<Order>(`/api/orders/${encodeURIComponent(orderId)}`)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Order status could not be loaded."); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [orderId, shopSlug]);

  return <div>
    <BrandHeader />
    <main className="shop-order-card">
      <p className="eyebrow">Order status</p>
      <h1>Your order</h1>
      {loading && <Loading>Checking your order…</Loading>}
      {error && <Alert onRetry={() => void load()}>{error}</Alert>}
      {order && <>
        <p>Order <strong>{order.orderId}</strong> · {order.state.replaceAll("_", " ")}</p>
        <p>Total: <strong>{money(order.totalMinor)}</strong></p>
        {order.pickupCode && <div className="pickup-code"><span>Pickup code</span><strong>{order.pickupCode}</strong></div>}
      </>}
      <Link className="button button-secondary full-width" to={`/shops/${encodeURIComponent(shopSlug ?? "")}`}>Back to the shop</Link>
    </main>
  </div>;
}
