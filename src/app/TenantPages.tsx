import { ArrowRight, ArrowUpRight, Leaf, LogOut, Plus, Store } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Alert, Loading } from "../components/Feedback";
import { BrandHeader } from "../components/BrandHeader";
import { del, get, post } from "../lib/api";
import { isValidOwnerSlug, isValidShopSlug, ownerSlugFromName, shopSlugFromName } from "../lib/shop-slug";
import type { Order } from "../types";
import { money } from "../lib/format";
import { useParams } from "react-router-dom";

type ShopSummary = { slug: string; name: string; status: "active" | "inactive"; ownerSlug?: string; currency?: string };
type OwnerSession = { authenticated: boolean; displayName?: string; ownerSlug?: string; defaultCurrency?: string };
const currencyOptions = ["AUD", "CAD", "EUR", "GBP", "JPY", "SGD", "USD"];

export function PlatformHome() {
  return <div>
    <BrandHeader />
    <main className="landing-main">
      <section className="landing-hero">
        <p className="hero-kicker"><span />A voice-first order desk for local shops</p>
        <h1>Open your shop.<br /><span>Let customers order their way.</span></h1>
        <p className="hero-description">Create a simple storefront, add your menu by photo or by hand, and share it with a QR code.</p>
        <div className="tenant-actions">
          <Link className="button button-primary" to="/owners/new">Create a shop <ArrowRight size={17} /></Link>
          <Link className="button button-secondary" to="/shops/little-harbor-market">Visit the sample shop <ArrowUpRight size={16} /></Link>
        </div>
      </section>
      <section className="landing-owner"><Store size={21} aria-hidden="true" /><div><strong>Already run a shop?</strong><span>Sign in to manage your orders and menu.</span></div><Link className="text-button" to="/dashboard/login">Owner sign in <ArrowRight size={15} /></Link></section>
    </main>
  </div>;
}

export function OwnerRegistrationPage() {
  const [displayName, setDisplayName] = useState("");
  const [ownerSlug, setOwnerSlug] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [defaultCurrency, setDefaultCurrency] = useState("JPY");
  const [slugAvailability, setSlugAvailability] = useState<"idle" | "checking" | "available" | "taken" | "invalid" | "error">("idle");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  useEffect(() => { setOwnerSlug(ownerSlugFromName(displayName) || (displayName.trim() ? "owner" : "")); }, [displayName]);

  useEffect(() => {
    if (!ownerSlug) { setSlugAvailability("idle"); return; }
    if (!isValidOwnerSlug(ownerSlug)) { setSlugAvailability("invalid"); return; }
    let current = true;
    setSlugAvailability("checking");
    const timer = window.setTimeout(() => void get<{ available: boolean }>(`/api/v1/owners/slug-availability/${encodeURIComponent(ownerSlug)}`)
      .then(({ available }) => { if (current) setSlugAvailability(available ? "available" : "taken"); })
      .catch(() => { if (current) setSlugAvailability("error"); }), 300);
    return () => { current = false; window.clearTimeout(timer); };
  }, [ownerSlug]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      await post("/api/v1/owners", { displayName, ownerSlug, email, password, defaultCurrency });
      navigate("/dashboard/shops/new", { replace: true });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Your owner account could not be created."); }
    finally { setBusy(false); }
  };

  return <div><BrandHeader /><main className="auth-shell"><section className="auth-card" aria-labelledby="owner-register-heading">
    <span className="auth-symbol"><Store size={22} aria-hidden="true" /></span><p className="eyebrow">Start your storefront</p><h1 id="owner-register-heading">Create your owner account</h1>
    <p className="auth-intro">First set up your owner profile and default currency. Then add your shop.</p>
    <form onSubmit={(event) => void submit(event)}>
      <div className="form-field"><label htmlFor="owner-name">Owner or stall name</label><input id="owner-name" autoComplete="name" maxLength={80} required value={displayName} onChange={(event) => { setDisplayName(event.target.value); setError(""); }} /></div>
      <div className="form-field"><label htmlFor="owner-slug">Owner address</label><div className="slug-input"><span>yatalk.kumagaias.com/</span><input id="owner-slug" autoComplete="username" maxLength={40} required value={ownerSlug} onChange={(event) => setOwnerSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} /></div><p className="form-help">Generated from your name; edit it for a custom address or non-English name.</p>
        {slugAvailability === "checking" && <p className="form-help" role="status">Checking address availability…</p>}
        {slugAvailability === "available" && <p className="form-help form-help-success" role="status">This owner address is available.</p>}
        {slugAvailability === "taken" && <p className="form-help form-help-error" role="status">This owner address is already in use.</p>}
        {slugAvailability === "invalid" && <p className="form-help form-help-error" role="status">Use 3–40 lowercase letters, numbers, or single hyphens.</p>}
        {slugAvailability === "error" && <p className="form-help" role="status">Availability could not be checked. We’ll verify it when you continue.</p>}
      </div>
      <div className="form-field"><label htmlFor="owner-currency">Default currency</label><select id="owner-currency" value={defaultCurrency} onChange={(event) => setDefaultCurrency(event.target.value)}>{currencyOptions.map((currency) => <option key={currency}>{currency}</option>)}</select><p className="form-help">Your shops and PayPal checkout will use this currency.</p></div>
      <div className="form-field"><label htmlFor="owner-email">Owner email</label><input id="owner-email" type="email" autoComplete="email" maxLength={254} required value={email} onChange={(event) => setEmail(event.target.value)} /></div>
      <div className="form-field"><label htmlFor="owner-password">Password</label><input id="owner-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} /><p className="form-help">Use at least 12 characters.</p></div>
      {error && <Alert>{error}</Alert>}
      <button className="button button-primary" type="submit" disabled={busy || slugAvailability === "checking" || slugAvailability === "taken" || slugAvailability === "invalid"}>{busy ? "Creating account…" : "Create account"}</button>
    </form><Link className="back-link" to="/dashboard/login">Already have an account? Sign in</Link>
  </section></main></div>;
}

export function ShopSetupPage() {
  const [name, setName] = useState("");
  const slug = shopSlugFromName(name);
  const [slugAvailability, setSlugAvailability] = useState<"idle" | "checking" | "available" | "taken" | "invalid" | "error">("idle");
  const [owner, setOwner] = useState<OwnerSession | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  useEffect(() => { void get<OwnerSession>("/api/v1/auth/session").then((session) => {
    if (!session.authenticated || !session.ownerSlug || !session.defaultCurrency) { navigate("/dashboard/login", { replace: true }); return; }
    setOwner(session);
  }).catch(() => navigate("/dashboard/login", { replace: true })); }, [navigate]);

  useEffect(() => {
    if (!slug || !owner?.ownerSlug) {
      setSlugAvailability("idle");
      return;
    }
    if (!isValidShopSlug(slug)) {
      setSlugAvailability("invalid");
      return;
    }

    const currentOwnerSlug = owner.ownerSlug;
    let current = true;
    setSlugAvailability("checking");
    const timer = window.setTimeout(() => {
      void get<{ available: boolean }>(`/api/v1/owners/${encodeURIComponent(currentOwnerSlug)}/shops/slug-availability/${encodeURIComponent(slug)}`)
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
  }, [slug, owner?.ownerSlug]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await post<{ shop: ShopSummary }>("/api/v1/dashboard/shops", { name, slug });
      navigate(`/dashboard/${encodeURIComponent(owner?.ownerSlug ?? "")}/${encodeURIComponent(result.shop.slug)}`, { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The shop could not be created. Please retry.");
    } finally { setBusy(false); }
  };

  return <div>
    <BrandHeader />
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="shop-setup-heading">
        <span className="auth-symbol"><Leaf size={22} aria-hidden="true" /></span>
        <p className="eyebrow">{owner?.displayName ?? "Your owner account"} · {owner?.defaultCurrency ?? ""}</p>
        <h1 id="shop-setup-heading">Create your shop</h1>
        <p className="auth-intro">Your public page will be at <strong>yatalk.kumagaias.com/{owner?.ownerSlug ?? "your-name"}/{slug || "your-shop"}</strong>.</p>
        <p className="auth-intro shop-setup-next-step">After creation, add menu items from a photo or enter them yourself.</p>
        <form onSubmit={(event) => void submit(event)}>
          <div className="form-field"><label htmlFor="shop-name">Shop name</label><input id="shop-name" autoComplete="organization" maxLength={80} required value={name} onChange={(event) => { setName(event.target.value); setError(""); }} /></div>
          <div className="form-field"><label htmlFor="shop-slug">Shop address</label><div className="slug-input"><span>yatalk.kumagaias.com/shops/</span><output id="shop-slug">{slug || "your-shop"}</output></div><p className="form-help">Generated automatically from your shop name.</p>
            {slugAvailability === "checking" && <p className="form-help" role="status">Checking address availability…</p>}
            {slugAvailability === "available" && <p className="form-help slug-status form-help-success" role="status">This address is available.</p>}
            {slugAvailability === "taken" && <p className="form-help slug-status form-help-error" role="status">This address is already in use.</p>}
            {slugAvailability === "invalid" && <p className="form-help slug-status form-help-error" role="status">Use 3–40 lowercase letters, numbers, or single hyphens.</p>}
            {slugAvailability === "error" && <p className="form-help slug-status" role="status">Address availability could not be checked. We’ll verify it when you create your shop.</p>}
          </div>
          {error && <Alert>{error}</Alert>}
          <button className="button button-primary" type="submit" disabled={!owner || busy || slugAvailability === "checking" || slugAvailability === "taken" || slugAvailability === "invalid"}>{busy ? "Creating shop…" : "Create shop"}</button>
        </form>
        <Link className="back-link" to="/dashboard/shops">Back to your shops</Link>
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
      <Link className="back-link" to="/owners/new">Create an owner account</Link>
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
      <div className="tenant-shop-grid">{shops.map((shop) => <article className="tenant-shop-card" key={shop.slug}><p className="eyebrow">{shop.status === "active" ? "Open" : "Paused"}</p><h2>{shop.name}</h2><p>yatalk.kumagaias.com/{shop.ownerSlug}/{shop.slug}</p><div className="tenant-actions"><Link className="button button-primary" to={`/dashboard/${encodeURIComponent(shop.ownerSlug ?? "")}/${encodeURIComponent(shop.slug)}`}>Manage shop <ArrowRight size={16} /></Link><Link className="text-button" to={`/${encodeURIComponent(shop.ownerSlug ?? "")}/${encodeURIComponent(shop.slug)}`} target="_blank" rel="noreferrer">Open storefront <ArrowUpRight size={15} /></Link></div></article>)}</div>
    </main>
  </div>;
}

export function ShopOrderPage() {
  const { ownerSlug, shopSlug, orderId } = useParams();
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
        <p>Total: <strong>{money(order.totalMinor, order.currency)}</strong></p>
        {order.pickupCode && <div className="pickup-code"><span>Pickup code</span><strong>{order.pickupCode}</strong></div>}
      </>}
      <Link className="button button-secondary full-width" to={shopSlug ? ownerSlug ? `/${encodeURIComponent(ownerSlug)}/${encodeURIComponent(shopSlug)}` : `/shops/${encodeURIComponent(shopSlug)}` : "/"}>Back to the shop</Link>
    </main>
  </div>;
}
