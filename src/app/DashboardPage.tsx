import { ArrowLeft, ArrowUpRight, CircleHelp, LogOut, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { OrganizerProduct, OrganizerSummary, Order } from "../types";
import { ApiError, del, get, patch, post } from "../lib/api";
import { money } from "../lib/format";
import { BrandHeader } from "../components/BrandHeader";
import { InventoryCard, OrderCard } from "../components/OrganizerPanels";
import { MenuSetupCard } from "../components/MenuSetupCard";
import { ShopQRCodeCard } from "../components/ShopQRCodeCard";
import { Alert, Loading } from "../components/Feedback";

const prompts = ["What is almost sold out?", "Which item sold most?"];
type AskResult = { answer: string; sourceFacts: Record<string, unknown> };

export function DashboardPage() {
  const [summary, setSummary] = useState<OrganizerSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [productFeedback, setProductFeedback] = useState<Record<string, string>>({});
  const [actionFeedback, setActionFeedback] = useState<Record<string, string>>({});
  const [openRefund, setOpenRefund] = useState<string | null>(null);
  const [refundRestock, setRefundRestock] = useState<Record<string, boolean>>({});
  const [refundUnknown, setRefundUnknown] = useState<Record<string, boolean>>({});
  const [refundDetailLoading, setRefundDetailLoading] = useState<Record<string, boolean>>({});
  const [refundDetailError, setRefundDetailError] = useState<Record<string, string>>({});
  const [question, setQuestion] = useState("");
  const [askResult, setAskResult] = useState<AskResult | null>(null);
  const [askError, setAskError] = useState("");
  const [asking, setAsking] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const navigate = useNavigate();
  const { shopSlug } = useParams();
  const shopUrl = shopSlug ? `/shops/${encodeURIComponent(shopSlug)}` : "/shops/little-harbor-market";
  const shopName = summary?.shop?.name ?? "Little Harbor Market";

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const data = await get<OrganizerSummary>("/api/organizer/summary");
      setSummary(data);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        navigate(shopSlug ? "/dashboard/login" : "/organizer", { replace: true });
        return;
      }
      setLoadError(error instanceof Error ? error.message : "The organizer desk could not load.");
    } finally {
      setLoading(false);
    }
  }, [navigate, shopSlug]);

  useEffect(() => { void loadSummary(); }, [loadSummary]);

  const logout = async () => {
    setSigningOut(true);
    try {
      await del<void>(shopSlug ? "/api/v1/auth/session" : "/api/organizer/session");
      navigate(shopSlug ? "/dashboard/login" : "/organizer", { replace: true });
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not end the session. Retry.");
    } finally { setSigningOut(false); }
  };

  const saveProduct = async (event: FormEvent<HTMLFormElement>, product: OrganizerProduct) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const stockOnHand = Number(formData.get("stockOnHand"));
    const priceMinor = Number(formData.get("priceMinor"));
    setSaving(product.id);
    setProductFeedback((value) => ({ ...value, [product.id]: "" }));
    try {
      await patch(`/api/organizer/products/${encodeURIComponent(product.id)}`, { stockOnHand, priceMinor });
      setProductFeedback((value) => ({ ...value, [product.id]: "Saved" }));
      await loadSummary();
    } catch (error) {
      setProductFeedback((value) => ({ ...value, [product.id]: error instanceof Error ? error.message : "Save failed. Your entries are still here." }));
    } finally { setSaving(null); }
  };

  const collect = async (order: Order) => {
    setSaving(order.orderId);
    setActionFeedback((value) => ({ ...value, [order.orderId]: "" }));
    try {
      await post(`/api/organizer/orders/${encodeURIComponent(order.orderId)}/collect`);
      await loadSummary();
    } catch (error) {
      setActionFeedback((value) => ({ ...value, [order.orderId]: error instanceof Error ? error.message : "Could not mark this order collected." }));
    } finally { setSaving(null); }
  };

  const openRefundPanel = async (order: Order) => {
    setOpenRefund(order.orderId);
    setRefundDetailError((value) => ({ ...value, [order.orderId]: "" }));
    if (typeof refundRestock[order.orderId] === "boolean") return;
    setRefundDetailLoading((value) => ({ ...value, [order.orderId]: true }));
    try {
      const detail = await get<Order>(`/api/organizer/orders/${encodeURIComponent(order.orderId)}`);
      if (typeof detail.refundRestockRequested === "boolean") {
        setRefundRestock((value) => ({ ...value, [order.orderId]: detail.refundRestockRequested! }));
      } else if (order.state === "refund_unknown") {
        setRefundDetailError((value) => ({ ...value, [order.orderId]: "The saved stock-restoration choice could not be read. Retry loading the order before retrying its refund." }));
      }
    } catch (error) {
      setRefundDetailError((value) => ({ ...value, [order.orderId]: error instanceof Error ? error.message : "Could not read the saved refund choice." }));
    } finally {
      setRefundDetailLoading((value) => ({ ...value, [order.orderId]: false }));
    }
  };

  const submitRefund = async (order: Order) => {
    const restock = refundRestock[order.orderId] ?? false;
    if (order.state === "refund_unknown" && typeof refundRestock[order.orderId] !== "boolean") return;
    setSaving(order.orderId);
    setActionFeedback((value) => ({ ...value, [order.orderId]: "" }));
    try {
      const result = await post<{ state: string; restocked?: boolean }>(`/api/organizer/orders/${encodeURIComponent(order.orderId)}/refund`, { restock });
      if (result.state === "refund_unknown") {
        setRefundUnknown((value) => ({ ...value, [order.orderId]: true }));
        setActionFeedback((value) => ({ ...value, [order.orderId]: "Refund checking. The order remains captured until PayPal confirms the result. Retry with the same stock choice." }));
      } else {
        setRefundUnknown((value) => ({ ...value, [order.orderId]: false }));
        setActionFeedback((value) => ({ ...value, [order.orderId]: result.restocked ? "Refund complete. Items were returned to stock." : "Refund complete." }));
        await loadSummary();
      }
    } catch (error) {
      if (!(error instanceof ApiError) || error.status === 0 || error.status >= 500) {
        setRefundUnknown((value) => ({ ...value, [order.orderId]: true }));
        setActionFeedback((value) => ({ ...value, [order.orderId]: "We could not confirm the refund result. Check the saved order state, then retry with the same stock choice." }));
      } else {
        setActionFeedback((value) => ({ ...value, [order.orderId]: error.message }));
      }
    } finally { setSaving(null); }
  };

  const ask = async (event: FormEvent) => {
    event.preventDefault();
    if (!question.trim() || asking) return;
    setAsking(true);
    setAskError("");
    try {
      setAskResult(await post<AskResult>("/api/organizer/ask", { question: question.trim() }));
    } catch (error) {
      setAskError(error instanceof Error ? error.message : "The assistant could not answer. The order desk is still available.");
    } finally { setAsking(false); }
  };

  const usePrompt = (value: string) => { setQuestion(value); setAskError(""); };

  return (
    <div>
      <BrandHeader eventName={shopName} />
      <main className="dashboard-main">
        <div className="dashboard-top">
          <div><p className="eyebrow">{shopName} · Tokyo</p><h1 className="page-title">Organizer desk</h1><p className="dashboard-subtitle">A clear view of today’s orders, stock, and service.</p></div>
          <div className="dashboard-actions"><Link className="text-button" to={shopUrl}><ArrowLeft size={15} aria-hidden="true" />Back to market</Link>{shopSlug && <Link className="text-button" to="/dashboard/shops">All shops</Link>}<button className="text-button" type="button" onClick={() => void loadSummary()} disabled={loading}><RefreshCw size={15} aria-hidden="true" />Refresh</button><button className="text-button" type="button" onClick={() => void logout()} disabled={signingOut}><LogOut size={15} aria-hidden="true" />{signingOut ? "Ending…" : "Sign out"}</button></div>
        </div>
        {loading && !summary && <Loading>Opening the organizer desk…</Loading>}
        {loadError && <Alert onRetry={() => void loadSummary()}>{loadError}</Alert>}
        {summary && <>
          <section className="metric-grid" aria-label="Today at a glance">
            <article className="metric-card"><span className="metric-label">Gross captured today</span><strong>{money(summary.metrics.grossSalesMinor)}</strong><span className="metric-footnote">Before completed refunds</span></article>
            <article className="metric-card"><span className="metric-label">Net captured sales</span><strong>{money(summary.metrics.netSalesMinor)}</strong><span className="metric-footnote">After completed refunds</span></article>
            <article className="metric-card"><span className="metric-label">Paid orders · low stock</span><strong>{summary.metrics.paidOrderCount} <span aria-hidden="true">·</span> {summary.metrics.lowStockCount}</strong><span className="metric-footnote">Includes collected orders</span></article>
          </section>
          <div className="dashboard-grid">
            <div className="dashboard-column">
              <section className="dashboard-card" aria-labelledby="orders-heading">
                <div className="section-heading"><div><p className="eyebrow">Service queue</p><h2 id="orders-heading">Recent orders</h2></div><span className="status-pill">{summary.orders.length} latest</span></div>
                {summary.orders.length === 0 ? <div className="empty-state"><strong>No orders yet</strong>New orders will appear here as guests check out.</div> : <div className="order-list">
                  {summary.orders.map((order) => <OrderCard
                    key={order.orderId} order={order} saving={saving === order.orderId}
                    actionMessage={actionFeedback[order.orderId] ?? ""}
                    refundOpen={openRefund === order.orderId} restock={refundRestock[order.orderId] ?? false}
                    refundUnknown={refundUnknown[order.orderId] ?? order.state === "refund_unknown"}
                    refundDetailLoading={refundDetailLoading[order.orderId] ?? false}
                    refundDetailError={refundDetailError[order.orderId] ?? ""}
                    onCollect={() => void collect(order)} onOpenRefund={() => void openRefundPanel(order)}
                    onCloseRefund={() => setOpenRefund(null)} onRestock={(value) => setRefundRestock((current) => ({ ...current, [order.orderId]: value }))}
                    onRefund={() => void submitRefund(order)} onRetryDetails={() => void openRefundPanel(order)}
                  />)}
                </div>}
              </section>
              <MenuSetupCard onSaved={loadSummary} />
              <InventoryCard products={summary.products} saving={saving} feedback={productFeedback} onSave={saveProduct} />
            </div>
            <div className="dashboard-column">
              <ShopQRCodeCard shopSlug={summary.shop?.slug ?? shopSlug ?? "little-harbor-market"} />
              <section className="dashboard-card ai-card" aria-labelledby="ops-heading">
                <div className="section-heading"><div><p className="eyebrow">Grounded in live sales and stock</p><h2 id="ops-heading"><Sparkles size={20} aria-hidden="true" /> Operations helper</h2><p>Ask a question. Source figures come from the order book.</p></div></div>
                <div className="ai-prompts">{prompts.map((prompt) => <button key={prompt} type="button" onClick={() => usePrompt(prompt)}>{prompt}</button>)}</div>
                <form onSubmit={ask}>
                  <div className="form-field"><label className="sr-only" htmlFor="ops-question">Ask about stock or sales</label><textarea id="ops-question" rows={3} maxLength={500} placeholder="Ask about stock or sales…" value={question} onChange={(event) => setQuestion(event.target.value)} /></div>
                  <button className="button button-primary" type="submit" disabled={!question.trim() || asking}>{asking ? "Checking the order book…" : "Ask the assistant"}</button>
                </form>
                {askError && <Alert>{askError}</Alert>}
                {askResult && <div className="ai-answer" aria-live="polite"><h3>Answer</h3><p>{askResult.answer}</p><div className="source-facts" aria-label="Source figures">{Object.entries(askResult.sourceFacts).map(([key, value]) => <span key={key}><strong>{formatFactName(key)}:</strong> {formatFactValue(value)}</span>)}</div></div>}
                <p className="form-help"><ShieldCheck size={14} aria-hidden="true" /> The assistant explains verified totals; it cannot change payments, refunds, or stock.</p>
              </section>
              <section className="dashboard-card service-note"><div className="section-heading"><div><p className="eyebrow">Pickup reminder</p><h2>Keep the line moving</h2></div><CircleHelp size={20} aria-hidden="true" /></div><p>Confirm the pickup code with the guest before marking an order collected. Only paid, uncollected orders can be refunded.</p><Link to={shopUrl} className="text-button">Preview the market <ArrowUpRight size={14} aria-hidden="true" /></Link></section>
            </div>
          </div>
        </>}
      </main>
    </div>
  );
}

function formatFactName(value: string) { return value.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " "); }
function formatFactValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.length ? value.map((entry) => {
    if (!entry || typeof entry !== "object") return String(entry);
    const row = entry as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name : typeof row.id === "string" ? row.id : "item";
    const count = row.available ?? row.units_sold ?? row.quantity;
    return count === undefined ? name : `${name} (${count})`;
  }).join("; ") : "None";
  return "See the live dashboard totals";
}
