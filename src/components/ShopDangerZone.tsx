import { AlertTriangle, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { del } from "../lib/api";

type ShopDangerZoneProps = {
  name: string;
  slug: string;
  onDeleted: () => void;
};

export function ShopDangerZone({ name, slug, onDeleted }: ShopDangerZoneProps) {
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || confirmation !== name) return;
    setBusy(true);
    setError("");
    try {
      await del<void>(`/api/v1/dashboard/shops/${encodeURIComponent(slug)}`, { confirmation });
      onDeleted();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "This shop could not be deleted. Please retry.");
    } finally {
      setBusy(false);
    }
  };

  return <details className="shop-danger-zone">
    <summary><AlertTriangle size={15} aria-hidden="true" />Danger zone</summary>
    <form onSubmit={(event) => void submit(event)}>
      <p>Delete this shop from Yatalk. Its storefront and dashboard will no longer be reachable.</p>
      <label htmlFor={`delete-${slug}`}>Type <strong>{name}</strong> to delete</label>
      <input id={`delete-${slug}`} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} maxLength={80} autoComplete="off" />
      <button className="button button-danger" type="submit" disabled={busy || confirmation !== name}>
        <Trash2 size={16} aria-hidden="true" />{busy ? "Deleting…" : "Delete shop"}
      </button>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  </details>;
}
