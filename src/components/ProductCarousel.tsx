import { Plus } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Product } from "../types";
import { money } from "../lib/format";

export function ProductCarousel({ products, disabled, onAdd }: { products: Product[]; disabled: boolean; onAdd: (product: Product) => void }) {
  const railRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (products.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      const rail = railRef.current;
      if (!rail) return;
      const next = rail.scrollLeft + Math.round(rail.clientWidth * .82);
      rail.scrollTo({ left: next >= rail.scrollWidth - rail.clientWidth - 4 ? 0 : next, behavior: "smooth" });
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [products.length]);

  if (!products.length) return null;
  return <section className="product-carousel" aria-label="Popular menu items">
    <div className="product-carousel-rail" ref={railRef}>
      {products.map((product) => <article className="product-carousel-card" key={product.id}>
        <div><strong>{product.name}</strong><span>{money(product.priceMinor, product.currency)}</span></div>
        <button type="button" aria-label={`Add ${product.name}`} disabled={disabled || product.available <= 0} onClick={() => onAdd(product)}><Plus size={19} aria-hidden="true" /></button>
      </article>)}
    </div>
  </section>;
}
