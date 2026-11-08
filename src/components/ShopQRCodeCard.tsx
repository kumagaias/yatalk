import { Check, Copy, QrCode } from "lucide-react";
import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";

export function ShopQRCodeCard({ shopSlug, ownerSlug }: { shopSlug: string; ownerSlug?: string | null }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const shopPath = ownerSlug ? `/${encodeURIComponent(ownerSlug)}/${encodeURIComponent(shopSlug)}` : `/shops/${encodeURIComponent(shopSlug)}`;
  const shopUrl = new URL(shopPath, window.location.origin).toString();

  const copyLink = async () => {
    setCopyError("");
    const correlationId = crypto.randomUUID();
    console.info(JSON.stringify({ timestamp: new Date().toISOString(), correlationId, stage: "shop_link_copy", outcome: "start" }));
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable.");
      await navigator.clipboard.writeText(shopUrl);
      setCopied(true);
      console.info(JSON.stringify({ timestamp: new Date().toISOString(), correlationId, stage: "shop_link_copy", outcome: "success" }));
    } catch (reason) {
      const errorName = reason instanceof Error ? reason.name : undefined;
      console.info(JSON.stringify({ timestamp: new Date().toISOString(), correlationId, stage: "shop_link_copy", outcome: "failure", ...(errorName ? { errorName } : {}) }));
      setCopied(false);
      setCopyError("Could not copy the link. Select it below to copy manually.");
    }
  };

  return (
    <section className="dashboard-card shop-qr-card" aria-labelledby="shop-qr-heading">
      <div className="section-heading"><div><p className="eyebrow">Share your storefront</p><h2 id="shop-qr-heading"><QrCode size={19} aria-hidden="true" />Shop QR code</h2></div></div>
      <p>Customers can scan this code to open your menu, order by voice or chat, and continue to PayPal checkout.</p>
      <div className="shop-qr-code"><QRCodeSVG value={shopUrl} size={200} level="Q" marginSize={3} title={`QR code for ${shopSlug}`} /></div>
      <a className="shop-qr-link" href={shopUrl}>{shopUrl}</a>
      <button className="button button-secondary full-width" type="button" onClick={() => void copyLink()}>
        {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}{copied ? "Link copied" : "Copy shop link"}
      </button>
      {copyError && <p className="shop-qr-error" role="status">{copyError}</p>}
    </section>
  );
}
