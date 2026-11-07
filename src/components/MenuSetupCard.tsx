import { Plus, ScanLine, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { MenuExtraction } from "../../shared/schemas.js";
import type { OrganizerProduct } from "../types";
import { ApiError, post, postImage } from "../lib/api";
import { Alert } from "./Feedback";

type Draft = {
  key: string;
  name: string;
  description: string;
  priceMinor: string;
  stockOnHand: string;
  dietaryNote: string;
  fromPhoto: boolean;
};

function emptyDraft(): Draft {
  return { key: crypto.randomUUID(), name: "", description: "", priceMinor: "", stockOnHand: "", dietaryNote: "", fromPhoto: false };
}

function logMenuFlow(correlationId: string, stage: string, outcome: "start" | "success" | "failure", reason?: unknown) {
  const errorName = reason instanceof Error ? reason.name : undefined;
  console.info(JSON.stringify({ timestamp: new Date().toISOString(), correlationId, stage, outcome, ...(errorName ? { errorName } : {}) }));
}

export function MenuSetupCard({ onSaved }: { onSaved: () => Promise<void> }) {
  const [photo, setPhoto] = useState<File | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const scanPhoto = async () => {
    if (!photo || reading || saving) return;
    if (photo.size > 4 * 1024 * 1024) {
      setError("Menu photos must be 4 MB or smaller.");
      return;
    }
    setReading(true);
    setError("");
    setStatus("");
    const correlationId = crypto.randomUUID();
    logMenuFlow(correlationId, "menu_photo_scan", "start");
    try {
      const result = await postImage<MenuExtraction>("/api/organizer/menu/scan", photo);
      const suggestions = result.items.map((item) => ({
        key: crypto.randomUUID(), name: item.name, description: item.description,
        priceMinor: item.priceMinor === null ? "" : String(item.priceMinor), stockOnHand: "",
        dietaryNote: item.dietaryNote, fromPhoto: true,
      }));
      setDrafts((current) => [...current, ...suggestions]);
      setPhoto(null);
      const fileInput = document.getElementById("menu-photo") as HTMLInputElement | null;
      if (fileInput) fileInput.value = "";
      setStatus(suggestions.length ? `${suggestions.length} suggestions ready. Review every field before saving.` : "No menu items could be read. Try another photo or add an item manually.");
      logMenuFlow(correlationId, "menu_photo_scan", "success");
    } catch (reason) {
      logMenuFlow(correlationId, "menu_photo_scan", "failure", reason);
      setError(reason instanceof Error ? reason.message : "The menu photo could not be read. Try another photo or add items manually.");
    } finally {
      setReading(false);
    }
  };

  const updateDraft = (key: string, field: keyof Omit<Draft, "key" | "fromPhoto">, value: string) => {
    setDrafts((current) => current.map((draft) => draft.key === key ? { ...draft, [field]: value } : draft));
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || reading || drafts.length === 0) return;
    const products = drafts.map(({ name, description, priceMinor, stockOnHand, dietaryNote }) => ({
      name: name.trim(), description: description.trim(), priceMinor: Number(priceMinor),
      stockOnHand: Number(stockOnHand), dietaryNote: dietaryNote.trim(),
    }));
    if (products.some((item) => !item.name || !Number.isInteger(item.priceMinor) || item.priceMinor < 1 ||
        !Number.isInteger(item.stockOnHand) || item.stockOnHand < 0)) {
      setError("Enter each item name, price, and current stock before saving.");
      return;
    }
    setSaving(true);
    setError("");
    setStatus("");
    const correlationId = crypto.randomUUID();
    logMenuFlow(correlationId, "menu_products_save", "start");
    try {
      await post<{ products: OrganizerProduct[] }>("/api/organizer/products/bulk", { products });
      setDrafts([]);
      setStatus(`${products.length} ${products.length === 1 ? "item" : "items"} added to the menu.`);
      logMenuFlow(correlationId, "menu_products_save", "success");
      await onSaved();
    } catch (reason) {
      logMenuFlow(correlationId, "menu_products_save", "failure", reason);
      setError(reason instanceof ApiError ? reason.message : reason instanceof Error ? reason.message : "The menu could not be saved. Your entries are still here.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="dashboard-card menu-setup-card" aria-labelledby="menu-setup-heading">
      <div className="section-heading"><div><p className="eyebrow">Get your menu ready</p><h2 id="menu-setup-heading">Menu setup</h2></div></div>
      <p className="menu-setup-intro">Take a clear photo of your menu or enter items yourself. Review the suggested prices and add the stock count before publishing.</p>
      <div className="menu-photo-row">
        <div className="form-field menu-photo-field">
          <label htmlFor="menu-photo">Menu photo</label>
          <input id="menu-photo" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment"
            onChange={(event) => { setPhoto(event.target.files?.[0] ?? null); setError(""); setStatus(""); }} />
          <p className="form-help">JPEG, PNG, WebP, HEIC, or HEIF · 4 MB max</p>
        </div>
        <button className="button button-secondary menu-scan-button" type="button" onClick={() => void scanPhoto()} disabled={!photo || reading || saving}>
          <ScanLine size={17} aria-hidden="true" />{reading ? "Reading menu…" : "Read menu photo"}
        </button>
      </div>
      <p className="menu-privacy-note">The photo is sent to Google Cloud for menu reading and is not stored by Yatalk.</p>
      <div className="menu-manual-row">
        <span>Or add menu items manually</span>
        <button className="button button-secondary" type="button" onClick={() => { setDrafts((current) => [...current, emptyDraft()]); setError(""); setStatus(""); }} disabled={saving || reading}>
          <Plus size={17} aria-hidden="true" />Add item
        </button>
      </div>
      {error && <Alert>{error}</Alert>}
      {status && <p className="menu-setup-status" role="status">{status}</p>}
      {drafts.length > 0 && <form className="menu-draft-form" onSubmit={(event) => void save(event)}>
        {drafts.map((draft, index) => <fieldset className="menu-draft" key={draft.key}>
          <legend>{draft.fromPhoto ? `Photo suggestion ${index + 1}` : `Menu item ${index + 1}`}</legend>
          <button className="menu-draft-remove" type="button" aria-label={`Remove menu item ${index + 1}`} onClick={() => setDrafts((current) => current.filter((item) => item.key !== draft.key))} disabled={saving}>
            <Trash2 size={16} aria-hidden="true" />
          </button>
          <div className="menu-draft-grid">
            <div className="form-field"><label htmlFor={`${draft.key}-name`}>Item name</label><input id={`${draft.key}-name`} value={draft.name} maxLength={80} required onChange={(event) => updateDraft(draft.key, "name", event.target.value)} /></div>
            <div className="form-field"><label htmlFor={`${draft.key}-price`}>Price (JPY)</label><input id={`${draft.key}-price`} type="number" min={1} max={1000000} step={1} inputMode="numeric" value={draft.priceMinor} required onChange={(event) => updateDraft(draft.key, "priceMinor", event.target.value)} /></div>
            <div className="form-field"><label htmlFor={`${draft.key}-stock`}>Stock count</label><input id={`${draft.key}-stock`} type="number" min={0} max={999} step={1} inputMode="numeric" value={draft.stockOnHand} required onChange={(event) => updateDraft(draft.key, "stockOnHand", event.target.value)} /></div>
            <div className="form-field"><label htmlFor={`${draft.key}-dietary`}>Allergen or dietary note</label><input id={`${draft.key}-dietary`} value={draft.dietaryNote} maxLength={160} onChange={(event) => updateDraft(draft.key, "dietaryNote", event.target.value)} /></div>
            <div className="form-field menu-draft-description"><label htmlFor={`${draft.key}-description`}>Description</label><textarea id={`${draft.key}-description`} value={draft.description} maxLength={240} rows={2} onChange={(event) => updateDraft(draft.key, "description", event.target.value)} /></div>
          </div>
        </fieldset>)}
        <button className="button button-primary full-width" type="submit" disabled={saving || reading}>{saving ? "Saving menu…" : `Review and add ${drafts.length} ${drafts.length === 1 ? "item" : "items"}`}</button>
      </form>}
    </section>
  );
}
