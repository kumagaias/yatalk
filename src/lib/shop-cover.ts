const defaultCovers = [
  "/shop-covers/ramen.webp",
  "/shop-covers/coffee.webp",
  "/shop-covers/produce.webp",
  "/shop-covers/bakery.webp",
  "/shop-covers/soda.webp",
];

export function defaultShopCover(shopKey: string): string {
  const hash = [...shopKey].reduce((value, character) => ((value * 31) + character.charCodeAt(0)) | 0, 0);
  return defaultCovers[Math.abs(hash) % defaultCovers.length]!;
}

export function publicShopImageUrl(ownerSlug: string | undefined, shopSlug: string): string {
  if (ownerSlug) return `/api/v1/owners/${encodeURIComponent(ownerSlug)}/shops/${encodeURIComponent(shopSlug)}/image`;
  return `/api/v1/shops/${encodeURIComponent(shopSlug)}/image`;
}
