import { ArrowRight, ArrowUpRight, Leaf, LogOut, Plus, Store } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Alert, Loading } from "../components/Feedback";
import { BrandHeader } from "../components/BrandHeader";
import { del, get, post } from "../lib/api";
import { isValidOwnerSlug, isValidShopSlug, ownerSlugFromName, shopSlugFromName } from "../lib/shop-slug";
import type { Order } from "../types";
import { money } from "../lib/format";
import { MAX_FREE_OWNER_SHOPS } from "../../shared/owner-limits.js";
import { useParams } from "react-router-dom";
import type { MenuExtraction } from "../../shared/schemas.js";
import { postImage } from "../lib/api";
import { loadSampleMenuFile } from "../lib/sample-menu";
import { SampleMenuPreview } from "../components/SampleMenuPreview";
import { ShopDangerZone } from "../components/ShopDangerZone";

type ShopSummary = { slug: string; name: string; status: "active" | "inactive"; ownerSlug?: string; currency?: string };
type OwnerSession = { authenticated: boolean; email?: string; displayName?: string; ownerSlug?: string; defaultCurrency?: string; emailVerified?: boolean };
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
      const result = await post<{ verificationEmailSent: boolean }>("/api/v1/owners", { displayName, ownerSlug, email, password, defaultCurrency });
      navigate("/dashboard/shops", { replace: true, state: { verificationEmailSent: result.verificationEmailSent } });
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
        {slugAvailability === "invalid" && <p className="form-help form-help-error" role="status">Use 5–40 lowercase letters, numbers, or single hyphens.</p>}
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
  const [menuPhoto, setMenuPhoto] = useState<File | null>(null);
  const slug = shopSlugFromName(name);
  const [slugAvailability, setSlugAvailability] = useState<"idle" | "checking" | "available" | "taken" | "invalid" | "error">("idle");
  const [owner, setOwner] = useState<OwnerSession | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
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
      const ownerSlug = owner?.ownerSlug;
      if (!ownerSlug) throw new Error("Sign in again to create your shop.");
      const result = await post<{ shop: ShopSummary }>("/api/v1/dashboard/shops", { name, slug });
      const dashboardPath = `/dashboard/${encodeURIComponent(ownerSlug)}/${encodeURIComponent(result.shop.slug)}`;
      let nextState: { initialPhotoSuggestions?: MenuExtraction["items"]; initialPhotoError?: string } = {};
      if (menuPhoto) {
        setStatus("Shop created. Reading your menu photo…");
        try {
          const extraction = await postImage<MenuExtraction>(`/api/v1${dashboardPath}/menu/scan`, menuPhoto);
          if (extraction.items.length) nextState = { initialPhotoSuggestions: extraction.items };
          else nextState = { initialPhotoError: "The shop is ready, but no menu items could be read. Try another photo or add items manually." };
        } catch (reason) {
          nextState = { initialPhotoError: reason instanceof Error ? reason.message : "The shop is ready, but the menu photo could not be read. Try again or add items manually." };
        }
      }
      navigate(dashboardPath, { replace: true, state: nextState });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The shop could not be created. Please retry.");
    } finally { setBusy(false); }
  };

  const chooseSampleMenu = async () => {
    setError("");
    setStatus("");
    try {
      setMenuPhoto(await loadSampleMenuFile());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The sample menu could not be loaded. Choose another photo.");
    }
  };

  return <div>
    <BrandHeader />
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="shop-setup-heading">
        <span className="auth-symbol"><Leaf size={22} aria-hidden="true" /></span>
        <p className="eyebrow">{owner?.displayName ?? "Your owner account"} · {owner?.defaultCurrency ?? ""}</p>
        <h1 id="shop-setup-heading">Create your shop</h1>
        <p className="auth-intro">Your public page will be at <strong>yatalk.kumagaias.com/{owner?.ownerSlug ?? "your-owner"}/{slug || "your-shop"}</strong>.</p>
        <p className="auth-intro shop-setup-next-step">Add your menu photo now. AI will read it after your shop is created; review every suggestion and enter the current stock before publishing.</p>
        <form onSubmit={(event) => void submit(event)}>
          <div className="form-field"><label htmlFor="shop-name">Shop name</label><input id="shop-name" autoComplete="organization" maxLength={80} required value={name} onChange={(event) => { setName(event.target.value); setError(""); }} /></div>
          <div className="form-field"><label htmlFor="shop-slug">Shop address</label><div className="slug-input"><span>yatalk.kumagaias.com/{owner?.ownerSlug ?? "your-owner"}/</span><output id="shop-slug">{slug || "your-shop"}</output></div><p className="form-help">Generated automatically from your shop name and owner address.</p>
            {slugAvailability === "checking" && <p className="form-help" role="status">Checking address availability…</p>}
            {slugAvailability === "available" && <p className="form-help slug-status form-help-success" role="status">This address is available.</p>}
            {slugAvailability === "taken" && <p className="form-help slug-status form-help-error" role="status">This address is already in use.</p>}
            {slugAvailability === "invalid" && <p className="form-help slug-status form-help-error" role="status">Use 3–40 lowercase letters, numbers, or single hyphens.</p>}
            {slugAvailability === "error" && <p className="form-help slug-status" role="status">Address availability could not be checked. We’ll verify it when you create your shop.</p>}
          </div>
          <div className="shop-menu-start">
            <div className="form-field"><label htmlFor="shop-menu-photo">Menu photo (optional)</label><input id="shop-menu-photo" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment"
              onChange={(event) => { const file = event.target.files?.[0] ?? null; setError(""); setMenuPhoto(file && file.size <= 4 * 1024 * 1024 ? file : null); if (file && file.size > 4 * 1024 * 1024) setError("Menu photos must be 4 MB or smaller."); }} />
              <p className="form-help">JPEG, PNG, WebP, HEIC, or HEIF · 4 MB max. Photos are sent to Google Cloud for menu reading and are not stored by Yatalk.</p>
            </div>
            <div className="sample-menu-choice"><SampleMenuPreview /><div><strong>Try the sample menu</strong><button className="button button-secondary" type="button" onClick={() => void chooseSampleMenu()} disabled={busy}>Use sample photo</button></div></div>
            {menuPhoto && <p className="form-help" role="status">Selected: {menuPhoto.name}</p>}
          </div>
          {status && <p className="form-help" role="status">{status}</p>}
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
      <div className="auth-links">
        <Link className="back-link" to="/password-reset">Forgot your password?</Link>
        <Link className="back-link" to="/owners/new">Create an owner account</Link>
      </div>
    </section></main>
  </div>;
}

export function PasswordResetPage() {
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const hash = window.location.hash;
    const value = new URLSearchParams(hash.slice(1)).get("token");
    if (value) {
      setToken(value);
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(""); setFeedback("");
    try {
      if (token) {
        await post<void>("/api/v1/auth/password-reset/complete", { token, password });
        setToken(""); setPassword("");
        setFeedback("Your password has been reset. Sign in with your new password.");
      } else {
        const result = await post<{ message: string }>("/api/v1/auth/password-reset/request", { email });
        setFeedback(result.message);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The request could not be completed."); }
    finally { setBusy(false); }
  };

  return <div><BrandHeader /><main className="auth-shell"><section className="auth-card" aria-labelledby="password-reset-heading">
    <span className="auth-symbol"><Store size={22} aria-hidden="true" /></span><p className="eyebrow">Account recovery</p>
    <h1 id="password-reset-heading">{token ? "Choose a new password" : "Reset your password"}</h1>
    <p className="auth-intro">{token ? "Use at least 12 characters. This link can only be used once." : "Enter your owner email and we’ll send a reset link if an account matches."}</p>
    <form onSubmit={(event) => void submit(event)}>
      {token ? <div className="form-field"><label htmlFor="reset-password">New password</label><input id="reset-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} /></div>
        : <div className="form-field"><label htmlFor="reset-email">Owner email</label><input id="reset-email" type="email" autoComplete="email" maxLength={254} required value={email} onChange={(event) => setEmail(event.target.value)} /></div>}
      {error && <Alert>{error}</Alert>}{feedback && <p className="auth-feedback" role="status">{feedback}</p>}
      <button className="button button-primary" type="submit" disabled={busy}>{busy ? "Working…" : token ? "Reset password" : "Send reset link"}</button>
    </form><Link className="back-link" to="/dashboard/login">Back to sign in</Link>
  </section></main></div>;
}

export function VerifyEmailPage() {
  const [token, setToken] = useState("");
  const [feedback, setFeedback] = useState("Open your link to confirm your email address.");
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get("token");
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    if (value) setToken(value);
    else setFeedback("This verification link is missing or has already been used.");
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!token || busy) return;
    setBusy(true);
    try { await post<void>("/api/v1/auth/verification/confirm", { token }); setToken(""); setVerified(true); setFeedback("Your owner email is verified."); }
    catch (reason) { setFeedback(reason instanceof Error ? reason.message : "This verification link is invalid or expired."); }
    finally { setBusy(false); }
  };

  return <div><BrandHeader /><main className="auth-shell"><section className="auth-card" aria-labelledby="verify-email-heading">
    <span className="auth-symbol"><Store size={22} aria-hidden="true" /></span><p className="eyebrow">Owner account</p><h1 id="verify-email-heading">Email verification</h1>
    <p className={`auth-feedback ${verified ? "success" : ""}`} role="status">{feedback}</p>
    {token && !verified && <form onSubmit={(event) => void submit(event)}><button className="button button-primary" type="submit" disabled={busy}>{busy ? "Verifying…" : "Verify email"}</button></form>}
    <Link className="back-link" to={verified ? "/dashboard/login" : "/dashboard/shops"}>{verified ? "Sign in" : "Go to owner dashboard"}</Link>
  </section></main></div>;
}

export function OwnerShopsPage() {
  const [shops, setShops] = useState<ShopSummary[]>([]);
  const [owner, setOwner] = useState<OwnerSession | null>(null);
  const [error, setError] = useState("");
  const [verificationFeedback, setVerificationFeedback] = useState("");
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const registrationEmailSent = (location.state as { verificationEmailSent?: boolean } | null)?.verificationEmailSent;
  const canAddShop = shops.length < MAX_FREE_OWNER_SHOPS;
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const session = await get<OwnerSession>("/api/v1/auth/session");
      if (!session.authenticated) { navigate("/dashboard/login", { replace: true }); return; }
      setOwner(session);
      setShops((await get<{ shops: ShopSummary[] }>("/api/v1/dashboard/shops")).shops);
    }
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

  const resendVerification = async () => {
    setVerificationFeedback("");
    try {
      const result = await post<{ emailVerified: boolean; sent: boolean }>("/api/v1/auth/verification/resend", {});
      setOwner((current) => current ? { ...current, emailVerified: result.emailVerified } : current);
      setVerificationFeedback(result.emailVerified ? "Your email is already verified." : result.sent
        ? `Verification link sent to ${owner?.email ?? "your email"}.` : "Email could not be sent. Check the email service configuration and retry.");
    } catch (reason) { setVerificationFeedback(reason instanceof Error ? reason.message : "Verification email could not be sent."); }
  };

  return <div>
    <BrandHeader eventName="Your shops" />
    <main className="dashboard-main">
      <div className="dashboard-top"><div><p className="eyebrow">Shop owner</p><h1 className="page-title">Your shops</h1><p className="dashboard-subtitle">Open a storefront or manage its orders and inventory.</p></div><div className="dashboard-actions">{canAddShop ? <Link className="button button-primary" to="/dashboard/shops/new"><Plus size={16} />Add a shop</Link> : <p className="form-help" role="status">Free accounts can create up to {MAX_FREE_OWNER_SHOPS} shops.</p>}<button className="text-button" type="button" disabled={signingOut} onClick={() => void signOut()}><LogOut size={15} />{signingOut ? "Signing out…" : "Sign out"}</button></div></div>
      {owner && !owner.emailVerified && <section className="verification-banner" aria-labelledby="verification-heading"><div><strong id="verification-heading">Verify your owner email</strong><p>{registrationEmailSent === false ? "We could not send the verification email. You can still create your shop; request a new link after checking the mail service." : "Check your inbox for a verification link. You can create your shop now; verifying helps confirm account ownership."}</p>{verificationFeedback && <p className="form-help" role="status">{verificationFeedback}</p>}</div><button className="button button-secondary" type="button" onClick={() => void resendVerification()}>Resend link</button></section>}
      {owner?.emailVerified && registrationEmailSent === true && <p className="form-help form-help-success" role="status">Verification email sent. Check your inbox to confirm your address.</p>}
      {loading && <Loading>Loading your shops…</Loading>}
      {error && <Alert onRetry={() => void load()}>{error}</Alert>}
      {!loading && !error && shops.length === 0 && <div className="empty-state"><strong>No shops yet</strong><Link className="text-button" to="/dashboard/shops/new">Create your first shop</Link></div>}
      <div className="tenant-shop-grid">{shops.map((shop) => <article className="tenant-shop-card" key={shop.slug}><p className="eyebrow">{shop.status === "active" ? "Open" : "Paused"}</p><h2>{shop.name}</h2><p>yatalk.kumagaias.com/{shop.ownerSlug}/{shop.slug}</p><div className="tenant-actions"><Link className="button button-primary" to={`/dashboard/${encodeURIComponent(shop.ownerSlug ?? "")}/${encodeURIComponent(shop.slug)}`}>Manage shop <ArrowRight size={16} /></Link><Link className="text-button" to={`/${encodeURIComponent(shop.ownerSlug ?? "")}/${encodeURIComponent(shop.slug)}`} target="_blank" rel="noreferrer">Open storefront <ArrowUpRight size={15} /></Link></div><ShopDangerZone name={shop.name} slug={shop.slug} onDeleted={() => void load()} /></article>)}</div>
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
        {order.pickupCode && <div className="pickup-code"><span>Pickup number</span><strong>{order.pickupCode}</strong></div>}
      </>}
      <Link className="button button-secondary full-width" to={shopSlug ? ownerSlug ? `/${encodeURIComponent(ownerSlug)}/${encodeURIComponent(shopSlug)}` : `/shops/${encodeURIComponent(shopSlug)}` : "/"}>Back to the shop</Link>
    </main>
  </div>;
}
