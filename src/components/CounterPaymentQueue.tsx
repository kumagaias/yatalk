import { Bell, BellOff, RefreshCw } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CurrencyCode } from "../../shared/currency.js";
import { ApiError, get } from "../lib/api";
import { money, shortTime } from "../lib/format";
import { Alert } from "./Feedback";

type CounterOrder = {
  orderId: string;
  totalMinor: number;
  currency: CurrencyCode;
  createdAt: string;
  expiresAt: string;
  approveUrl: string | null;
  items: Array<{ name: string; quantity: number }>;
};

type CounterQueueResponse = { orders: CounterOrder[] };
type AudioContextConstructor = typeof AudioContext;
type AudioWindow = Window & { webkitAudioContext?: AudioContextConstructor };

function playChime(context: AudioContext): void {
  const now = context.currentTime;
  for (const [index, frequency] of [880, 1175].entries()) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, now + index * 0.16);
    gain.gain.exponentialRampToValueAtTime(0.16, now + index * 0.16 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.16 + 0.13);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now + index * 0.16);
    oscillator.stop(now + index * 0.16 + 0.14);
  }
}

function isSafeApprovalUrl(value: string | null): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "paypal.com" || url.hostname.endsWith(".paypal.com"));
  } catch {
    return false;
  }
}

export function CounterPaymentQueue({ apiBase }: { apiBase: string }) {
  const [orders, setOrders] = useState<CounterOrder[]>([]);
  const [error, setError] = useState("");
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [updatedAt, setUpdatedAt] = useState("");
  const ordersRef = useRef<CounterOrder[]>([]);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const soundEnabledRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const loadingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (loadingRef.current || document.visibilityState !== "visible") return;
    loadingRef.current = true;
    try {
      const result = await get<CounterQueueResponse>(`${apiBase}/counter-orders`);
      const freshOrders = result.orders.filter((order) => Date.parse(order.expiresAt) > Date.now());
      const freshIds = new Set(freshOrders.map((order) => order.orderId));
      const hasNewOrder = [...freshIds].some((id) => !seenIdsRef.current.has(id));
      ordersRef.current = freshOrders;
      setOrders(freshOrders);
      setUpdatedAt(new Date().toISOString());
      setError("");
      if (hasNewOrder && soundEnabledRef.current && audioContextRef.current) playChime(audioContextRef.current);
      seenIdsRef.current = freshIds;
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) {
        ordersRef.current = [];
        seenIdsRef.current.clear();
        setOrders([]);
      }
      setError(reason instanceof Error ? reason.message : "The payment queue could not refresh.");
    } finally {
      loadingRef.current = false;
    }
  }, [apiBase]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3_000);
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
      void audioContextRef.current?.close().catch(() => undefined);
    };
  }, [refresh]);

  const enableSound = async () => {
    const AudioContextType = window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
    if (!AudioContextType) { setError("Sound alerts are unavailable in this browser."); return; }
    try {
      const context = audioContextRef.current ?? new AudioContextType();
      await context.resume();
      audioContextRef.current = context;
      seenIdsRef.current = new Set(ordersRef.current.map((order) => order.orderId));
      soundEnabledRef.current = !soundEnabledRef.current;
      setSoundEnabled(soundEnabledRef.current);
      if (soundEnabledRef.current) playChime(context);
    } catch {
      setError("Sound alerts are unavailable in this browser.");
    }
  };

  return <section className="dashboard-card counter-queue" aria-labelledby="counter-queue-heading">
    <div className="section-heading">
      <div><p className="eyebrow">PayPal · Live</p><h2 id="counter-queue-heading">Waiting for payment</h2></div>
      <div className="counter-queue-actions">
        <span className="status-pill">{orders.length} waiting</span>
        <button className="text-button" type="button" onClick={() => void enableSound()} aria-pressed={soundEnabled}>
          {soundEnabled ? <Bell size={16} aria-hidden="true" /> : <BellOff size={16} aria-hidden="true" />}
          {soundEnabled ? "Sound on" : "Enable sound"}
        </button>
        <button className="icon-button" type="button" onClick={() => void refresh()} aria-label="Refresh payment queue">
          <RefreshCw size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
    {error && <Alert onRetry={() => void refresh()}>{error}</Alert>}
    {orders.length === 0 ? <div className="empty-state"><strong>No payment waiting</strong>New orders will appear here.</div> :
      <div className="counter-order-list">{orders.map((order) => <article className="counter-order-card" key={order.orderId}>
        <div className="counter-order-copy">
          <div className="counter-order-top"><strong>Order {order.orderId.slice(0, 6).toUpperCase()}</strong><span>{shortTime(order.createdAt)}</span></div>
          <ul className="counter-order-items">{order.items.map((item, index) => <li key={`${item.name}-${index}`}><span>{item.name}</span><strong>× {item.quantity}</strong></li>)}</ul>
          <strong className="counter-order-total">{money(order.totalMinor, order.currency)}</strong>
          {!isSafeApprovalUrl(order.approveUrl) && <p className="counter-order-note" role="status">Preparing the PayPal link…</p>}
        </div>
        {isSafeApprovalUrl(order.approveUrl) && <div className="counter-order-qr">
          <QRCodeSVG value={order.approveUrl} size={150} level="M" marginSize={3} title="PayPal payment QR code" />
          <span>Scan to pay</span>
        </div>}
      </article>)}</div>}
    {updatedAt && <p className="counter-queue-updated" aria-live="off">Updated {new Date(updatedAt).toLocaleTimeString()}</p>}
  </section>;
}
