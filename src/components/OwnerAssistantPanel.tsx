import { ArrowUpRight, Send, ShieldCheck, Sparkles } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { MenuExtraction } from "../../shared/schemas.js";
import { post } from "../lib/api";
import { Alert } from "./Feedback";
import { formatMinor } from "../../shared/currency.js";

type Role = "assistant" | "user";
type AssistantMessage = { role: Role; content: string; suggestions?: MenuExtraction["items"]; sourceFacts?: Record<string, unknown> };
type Mode = "menu" | "operations";
const prompts: Record<Mode, string[]> = {
  menu: ["Suggest 3 simple items for a tea stall", "Help me describe my signature dish"],
  operations: ["What is almost sold out?", "Which item sold most?"],
};

export function OwnerAssistantPanel({ currency, draft, onAddToMenu }: {
  currency: string;
  draft: MenuExtraction["items"];
  onAddToMenu: (items: MenuExtraction["items"]) => void;
}) {
  const [mode, setMode] = useState<Mode>("menu");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<AssistantMessage[]>([
    { role: "assistant", content: "Tell me about your stall or the food you serve. I can help draft menu descriptions, then you can review every field before saving." },
  ]);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  const send = async (event?: FormEvent, suggested?: string) => {
    event?.preventDefault();
    const message = (suggested ?? input).trim();
    if (!message || sending) return;
    setSending(true); setError(""); setInput("");
    const nextMessages = [...messages, { role: "user" as const, content: message }];
    setMessages(nextMessages);
    try {
      if (mode === "menu") {
        const result = await post<{ reply: string; suggestions: MenuExtraction["items"] }>("/api/organizer/menu/assistant", {
          message,
          history: messages.slice(-8).map(({ role, content }) => ({ role, content })),
          draft,
        });
        setMessages((current) => [...current, { role: "assistant", content: result.reply, suggestions: result.suggestions }]);
      } else {
        const result = await post<{ answer: string; sourceFacts: Record<string, unknown> }>("/api/organizer/ask", { question: message });
        setMessages((current) => [...current, { role: "assistant", content: result.answer, sourceFacts: result.sourceFacts }]);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The assistant could not reply. Your menu and orders are unchanged.");
    } finally { setSending(false); }
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
        {message.sourceFacts && <div className="assistant-facts">{Object.entries(message.sourceFacts).map(([key, value]) => <span key={key}><strong>{key.replace(/([a-z])([A-Z])/g, "$1 $2")}:</strong> {key.endsWith("Minor") && typeof value === "number" ? formatMinor(value, currency) : factText(value)}</span>)}</div>}
      </article>)}
      {sending && <p className="assistant-status" role="status">{mode === "menu" ? "Thinking about your menu…" : "Checking live shop data…"}</p>}
    </div>
    {error && <Alert>{error}</Alert>}
    <div className="assistant-prompts">{prompts[mode].map((prompt) => <button key={prompt} type="button" onClick={() => void send(undefined, prompt)} disabled={sending}>{prompt}</button>)}</div>
    <form className="assistant-compose" onSubmit={(event) => void send(event)}>
      <label className="sr-only" htmlFor="owner-assistant-input">{mode === "menu" ? "Ask about your menu" : "Ask about orders and stock"}</label>
      <textarea id="owner-assistant-input" rows={2} maxLength={800} value={input} placeholder={mode === "menu" ? "Describe your stall or ask for menu ideas…" : "Ask about today's orders or stock…"} onChange={(event) => setInput(event.target.value)} />
      <button className="button button-primary" type="submit" disabled={!input.trim() || sending} aria-label="Send message"><Send size={16} aria-hidden="true" /></button>
    </form>
    <p className="assistant-guardrail"><ShieldCheck size={14} aria-hidden="true" /> AI suggestions are drafts. Review them in the menu form before saving. Operations answers use live order and stock figures.</p>
  </section>;
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
