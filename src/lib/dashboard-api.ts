export function dashboardApiBase(ownerSlug?: string, shopSlug?: string): string {
  if (ownerSlug && shopSlug) return `/api/v1/dashboard/${encodeURIComponent(ownerSlug)}/${encodeURIComponent(shopSlug)}`;
  if (shopSlug) return `/api/v1/dashboard/shops/${encodeURIComponent(shopSlug)}`;
  return "/api/organizer";
}
