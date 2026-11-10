import { ImageUp } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { putImage } from "../lib/api";
import { Alert } from "./Feedback";

export function ShopImageCard({ ownerSlug, shopSlug, shopName, enabled }: {
  ownerSlug: string; shopSlug: string; shopName: string; enabled: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [updatedAt, setUpdatedAt] = useState(0);
  const [remoteImageMissing, setRemoteImageMissing] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const imageUrl = `/api/v1/owners/${encodeURIComponent(ownerSlug)}/shops/${encodeURIComponent(shopSlug)}/image`;

  useEffect(() => {
    if (!file) { setPreview(""); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!file || busy) return;
    setBusy(true); setError("");
    try {
      await putImage<{ imageUrl: string }>(`/api/v1/dashboard/${encodeURIComponent(ownerSlug)}/${encodeURIComponent(shopSlug)}/image`, file);
      setUpdatedAt(Date.now()); setFile(null); setRemoteImageMissing(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The shop image could not be saved."); }
    finally { setBusy(false); }
  };

  return <section className="dashboard-card shop-image-card" aria-labelledby="shop-image-heading">
    <div className="section-heading"><div><p className="eyebrow">Your storefront</p><h2 id="shop-image-heading"><ImageUp size={19} aria-hidden="true" />Shop photo</h2></div></div>
    {preview ? <img className="shop-image-preview" src={preview} alt={`Preview of ${shopName}`} /> : !remoteImageMissing
      ? <img className="shop-image-preview" src={`${imageUrl}${updatedAt ? `?updated=${updatedAt}` : ""}`} alt={`${shopName} storefront`} onError={() => setRemoteImageMissing(true)} />
      : <div className="shop-image-empty">Add a photo to make your storefront easy to recognize.</div>}
    <p>Choose a JPEG, PNG, or WebP photo up to 2 MB. The image is stored in Cloud Storage and shown on your public shop page.</p>
    {!enabled && <p className="form-help form-help-error" role="status">Image storage is not configured for this deployment yet.</p>}
    <form onSubmit={(event) => void submit(event)}>
      <div className="form-field"><label htmlFor="shop-image-file">Shop image</label><input id="shop-image-file" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
        const selected = event.target.files?.[0] ?? null;
        setError("");
        if (selected && selected.size > 2 * 1024 * 1024) { setFile(null); setError("Shop photos must be 2 MB or smaller."); return; }
        setFile(selected);
      }} /></div>
      {error && <Alert>{error}</Alert>}
      <button className="button button-secondary full-width" type="submit" disabled={!enabled || !file || busy}>{busy ? "Saving photo…" : "Save shop photo"}</button>
    </form>
  </section>;
}
