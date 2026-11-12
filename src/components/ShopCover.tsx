import { useState } from "react";
import { defaultShopCover, publicShopImageUrl } from "../lib/shop-cover";

export function ShopCover({ shopName, shopSlug, ownerSlug }: { shopName: string; shopSlug: string; ownerSlug?: string }) {
  const [customImageMissing, setCustomImageMissing] = useState(false);
  const fallback = defaultShopCover(`${ownerSlug ?? "legacy"}/${shopSlug}`);
  const imageUrl = publicShopImageUrl(ownerSlug, shopSlug);
  return <div className="shop-cover customer-shop-cover">
    <img src={customImageMissing ? fallback : imageUrl} alt={`${shopName} storefront`} onError={() => setCustomImageMissing(true)} />
  </div>;
}
