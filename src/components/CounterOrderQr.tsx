import { QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

export function CounterOrderQr({ shopName, shopUrl }: { shopName: string; shopUrl: string }) {
  return (
    <section className="counter-order-qr-screen" aria-labelledby="counter-qr-heading">
      <p className="eyebrow">{shopName}</p>
      <h1 id="counter-qr-heading">Scan to order</h1>
      <div className="counter-shop-qr">
        <QRCodeSVG value={shopUrl} size={300} level="Q" marginSize={3} title={`Order at ${shopName}`} />
      </div>
      <span><QrCode size={18} aria-hidden="true" />Open the menu on your phone</span>
      <a href={shopUrl}>{shopUrl}</a>
    </section>
  );
}
