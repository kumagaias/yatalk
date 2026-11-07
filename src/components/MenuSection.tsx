import { CupSoda, Leaf, Plus, Soup, Utensils } from "lucide-react";
import type { Product } from "../types";
import { money } from "../lib/format";

const foodIcon = (name: string) => {
  const key = name.toLowerCase();
  if (key.includes("tea") || key.includes("drink") || key.includes("soda")) return CupSoda;
  if (key.includes("cookie") || key.includes("cake") || key.includes("bread")) return Utensils;
  return Soup;
};

export function MenuSection({ products, loading, busy, mutationBusy, onAdd }: {
  products: Product[];
  loading: boolean;
  busy: string | null;
  mutationBusy: boolean;
  onAdd: (product: Product) => void;
}) {
  return (
    <section className="menu-section" id="market-menu" aria-labelledby="menu-heading">
      <div className="menu-title-row">
        <div><p className="eyebrow">Fresh from our neighborhood</p><h2 id="menu-heading">Today’s menu</h2></div>
        <span className="menu-count">{products.length} market favorites</span>
      </div>
      {loading ? <div className="menu-loading" role="status">Setting out the good stuff…</div> : products.length === 0 ? (
        <div className="panel empty-menu"><Soup size={26} aria-hidden="true" /><h3>We’re setting up the stall.</h3><p>The menu is on its way. Check back soon.</p></div>
      ) : (
        <div className="product-grid">
          {products.map((product, index) => {
            const Icon = foodIcon(product.name);
            const outOfStock = product.available <= 0;
            return (
              <article className={`product-card ${outOfStock ? "product-sold-out" : ""}`} key={product.id}>
                <div className={`product-art art-${index % 4}`} aria-hidden="true"><Icon size={30} strokeWidth={1.55} /><span>{String(index + 1).padStart(2, "0")}</span></div>
                <div className="product-copy">
                  <div className="product-name-row"><h3>{product.name}</h3><strong>{money(product.priceMinor, product.currency)}</strong></div>
                  <p className="product-description">{product.description}</p>
                  <div className="product-meta">
                    {product.dietaryNote ? <span className="dietary-note"><Leaf size={13} aria-hidden="true" />{product.dietaryNote}</span> : <span className="dietary-note no-note">Ask us about ingredients</span>}
                    <span className={`availability ${outOfStock ? "unavailable" : ""}`}><i aria-hidden="true" />{outOfStock ? "Sold out" : `${product.available} available`}</span>
                  </div>
                  <button className="button button-add" type="button" onClick={() => onAdd(product)} disabled={outOfStock || mutationBusy || busy === product.id}>
                    <Plus size={17} aria-hidden="true" />{busy === product.id ? "Adding…" : outOfStock ? "Unavailable" : "Add to order"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
