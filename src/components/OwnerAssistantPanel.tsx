import { ArrowUpRight, Send, ShieldCheck, Sparkles } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { MenuExtraction } from "../../shared/schemas.js";
import { post } from "../lib/api";
import { Alert } from "./Feedback";
import { formatMinor } from "../../shared/currency.js";
import { VoiceAssistantButton } from "./VoiceAssistantButton";

type Role = "assistant" | "user";
type StockPriority = { id: string; name: string; available: number; unitsSoldLast7Days: number; daysOfCover: number; targetStock: number; suggestedQuantity: number };
type AssistantMessage = { role: Role; content: string; suggestions?: MenuExtraction["items"]; sourceFacts?: Record<string, unknown>; inventoryPriority?: StockPriority[] };
type Mode = "menu" | "operations";
const prompts: Record<Mode, string[]> = {
  menu: ["Suggest 3 simple items for a tea stall", "Help me describe my signature dish"],
  operations: ["What are today's sales?", "Which paid orders are awaiting pickup?", "What is the next customer's menu?", "Forecast tomorrow's sales"],
};

export function OwnerAssistantPanel({ apiBase, currency, draft, onAddToMenu, onReceiveStock }: {
  apiBase: string;
  currency: string;
  draft: MenuExtraction["items"];
  onAddToMenu: (items: MenuExtraction["items"]) => void;
  onReceiveStock: (productId: string, quantity: number, receiptId: string) => Promise<"received" | "cancelled" | "unknown" | "failed">;
}) {
  const [mode, setMode] = useState<Mode>("menu");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<AssistantMessage[]>([
    { role: "assistant", content: "Tell me about your stall or the food you serve. I can help draft menu descriptions, then you can review every field before saving." },
  ]);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [receivingStockId, setReceivingStockId] = useState<string | null>(null);
  const [receivedStock, setReceivedStock] = useState<Record<string, number>>({});
  const [receiptIds, setReceiptIds] = useState<Record<string, string>>({});

  const sendMessage = async (message: string, targetMode: Mode = mode): Promise<string | null> => {
    const trimmed = message.trim();
    if (!trimmed || sending) return null;
    setSending(true); setError(""); setInput("");
    const nextMessages = [...messages, { role: "user" as const, content: trimmed }];
    setMessages(nextMessages);
    try {
      if (targetMode === "menu") {
        const result = await post<{ reply: string; suggestions: MenuExtraction["items"] }>(`${apiBase}/menu/assistant`, {
          message: trimmed,
          history: messages.slice(-8).map(({ role, content }) => ({ role, content })),
          draft,
        });
        setMessages((current) => [...current, { role: "assistant", content: result.reply, suggestions: result.suggestions }]);
        return result.reply;
      }
      const result = await post<{ answer: string; inventoryPriority: StockPriority[]; sourceFacts: Record<string, unknown> }>(`${apiBase}/ask`, { question: trimmed });
      setMessages((current) => [...current, { role: "assistant", content: result.answer, inventoryPriority: result.inventoryPriority, sourceFacts: result.sourceFacts }]);
      return result.answer;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The assistant could not reply. Your menu and orders are unchanged.");
      return null;
    } finally { setSending(false); }
  };

  const send = async (event?: FormEvent, suggested?: string) => {
    event?.preventDefault();
    await sendMessage(suggested ?? input);
  };

  return <section className="dashboard-card owner-assistant" aria-labelledby="owner-assistant-heading">
    <div className="section-heading"><div><p className="eyebrow">Menu ideas and live shop data</p><h2 id="owner-assistant-heading"><Sparkles size={19} aria-hidden="true" /> Shop assistant</h2></div></div>
    <div className="assistant-tabs" role="tablist" aria-label="Assistant topic">
      <button type="button" role="tab" aria-selected={mode === "menu"} onClick={() => setMode("menu")}>Build menu</button>
      <button type="button" role="tab" aria-selected={mode === "operations"} onClick={() => setMode("operations")}>Orders &amp; stock</button>
    </div>
    <div className="assistant-transcript" aria-live="polite">
      {messages.map((message, index) => <article className={`assistant-message ${message.role}`} key={`${index}-${message.content.slice(0, 18)}`}>
        <p>{message.content}</p>
        {!!message.suggestions?.length && <div className="assistant-suggestions">
          {message.suggestions.map((item, suggestionIndex) => <div className="assistant-suggestion" key={`${item.name}-${suggestionIndex}`}>
            <strong>{item.name}</strong><span>{item.description || "Add a description after reviewing this suggestion."}</span>
            <small>{item.priceMinor === null ? "Price needed" : "Price suggested"} · {currency}</small>
          </div>)}
          <button type="button" className="button button-secondary" onClick={() => onAddToMenu(message.suggestions!)}>
            Add {message.suggestions.length} editable {message.suggestions.length === 1 ? "draft" : "drafts"} <ArrowUpRight size={15} aria-hidden="true" />
          </button>
        </div>}
        {!!message.inventoryPriority?.length && <div className="assistant-stock-priority" aria-label="AI restock review priorities">
          <strong>AI restock plan · 7-day sales · 2-day cover</strong>
          {message.inventoryPriority.map((item, priorityIndex) => {
            const receiptKey = `${index}-${item.id}`;
            return <div className="assistant-stock-item" key={item.id}>
            <span><b>{priorityIndex + 1}. {item.name}</b><small>{item.available} available · {item.unitsSoldLast7Days} sold in 7 days · {item.daysOfCover} days of cover</small><small>Target {item.targetStock} units · suggest +{item.suggestedQuantity}</small></span>
            <span className="assistant-stock-actions">
              <button type="button" className="text-button" onClick={() => focusInventoryItem(item.id)}>Review stock</button>
              <button type="button" className="text-button" disabled={receivingStockId === receiptKey || Boolean(receivedStock[receiptKey]) || item.suggestedQuantity < 1}
                onClick={() => void receiveStock(item, receiptKey)}>{receivingStockId === receiptKey ? "Saving…" : receivedStock[receiptKey] === -1 ? "Check stock before retrying" : receivedStock[receiptKey] ? `Received +${receivedStock[receiptKey]}` : `Mark +${item.suggestedQuantity} received`}</button>
            </span>
          </div>;
          })}
          <small className="assistant-stock-note">Confirm only after the items physically arrive. The target is the greater of 5 units or 2 days of average sales.</small>
        </div>}
        {message.sourceFacts && <div className="assistant-facts">{Object.entries(message.sourceFacts).map(([key, value]) => <span key={key}><strong>{key.replace(/([a-z])([A-Z])/g, "$1 $2")}:</strong> {key.endsWith("Minor") && typeof value === "number" ? formatMinor(value, currency) : factText(value)}</span>)}</div>}
      </article>)}
      {sending && <p className="assistant-status" role="status">{mode === "menu" ? "Thinking about your menu…" : "Checking live shop data…"}</p>}
    </div>
    {error && <Alert>{error}</Alert>}
    <div className="assistant-prompts">{prompts[mode].map((prompt) => <button key={prompt} type="button" onClick={() => void sendMessage(prompt)} disabled={sending}>{prompt}</button>)}</div>
    {mode === "operations" && <VoiceAssistantButton disabled={sending} onVoiceTurn={(transcript) => sendMessage(transcript, "operations")} />}
    <form className="assistant-compose" onSubmit={(event) => void send(event)}>
      <label className="sr-only" htmlFor="owner-assistant-input">{mode === "menu" ? "Ask about your menu" : "Ask about orders and stock"}</label>
      <textarea id="owner-assistant-input" rows={2} maxLength={800} value={input} placeholder={mode === "menu" ? "Describe your stall or ask for menu ideas…" : "Ask about today's orders or stock…"} onChange={(event) => setInput(event.target.value)} />
      <button className="button button-primary" type="submit" disabled={!input.trim() || sending} aria-label="Send message"><Send size={16} aria-hidden="true" /></button>
    </form>
    <p className="assistant-guardrail"><ShieldCheck size={14} aria-hidden="true" /> Voice answers use live shop data. They never change stock, payment, pickup, or refunds.</p>
  </section>;

  async function receiveStock(item: StockPriority, receiptKey: string): Promise<void> {
    setReceivingStockId(receiptKey);
    try {
      const receiptId = receiptIds[receiptKey] ?? crypto.randomUUID();
      setReceiptIds((current) => ({ ...current, [receiptKey]: receiptId }));
      const result = await onReceiveStock(item.id, item.suggestedQuantity, receiptId);
      if (result === "received") {
        setReceivedStock((current) => ({ ...current, [receiptKey]: item.suggestedQuantity }));
        setReceiptIds((current) => { const next = { ...current }; delete next[receiptKey]; return next; });
      } else if (result === "unknown") {
        setReceivedStock((current) => ({ ...current, [receiptKey]: -1 }));
      }
    } finally { setReceivingStockId(null); }
  }
}

function factText(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.length ? value.map((entry) => {
    if (!entry || typeof entry !== "object") return String(entry);
    const row = entry as Record<string, unknown>;
    return `${String(row.name ?? row.id ?? "item")} (${String(row.available ?? row.units_sold ?? row.quantity ?? "—")})`;
  }).join("; ") : "None";
  return "See dashboard figures";
}

function focusInventoryItem(productId: string): void {
  const stockInput = document.getElementById(`stock-${productId}`);
  stockInput?.scrollIntoView({ behavior: "smooth", block: "center" });
  if (stockInput instanceof HTMLInputElement) stockInput.focus();
}
