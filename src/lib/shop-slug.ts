export function shopSlugFromName(name: string): string {
  if (!name.trim()) return "";
  const slug = name.normalize("NFKD").toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  if (!slug) return "shop";
  return slug === "new" ? "new-shop" : slug;
}

export function isValidShopSlug(slug: string): boolean {
  return slug.length >= 3 && slug.length <= 40 && slug !== "new" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

export function ownerSlugFromName(name: string): string {
  if (!name.trim()) return "";
  return name.normalize("NFKD").toLowerCase().replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "") || "my-owner";
}

export function isValidOwnerSlug(slug: string): boolean {
  return slug.length >= 3 && slug.length <= 40 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) &&
    !["api", "dashboard", "shops", "organizer", "owners", "new"].includes(slug);
}
