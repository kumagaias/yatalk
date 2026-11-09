import { randomUUID } from "node:crypto";
import type { CurrencyCode } from "../shared/currency.js";
import { DEFAULT_SHOP_ID, DEFAULT_SHOP_NAME, DEFAULT_SHOP_SLUG, type FirestoreDb, type Shop } from "./database.js";
import type { FirestoreDocument } from "./firestore-store.js";

type ShopDoc = FirestoreDocument & {
  id: string; slug: string; ownerUserId: string | null; name: string; timeZone: string;
  currency: CurrencyCode; status: "active" | "inactive"; catalogRevision: number;
};
type UserDoc = FirestoreDocument & { ownerSlug?: string | null };

export async function createShopRecord(db: FirestoreDb, input: {
  id?: string; slug: string; name: string; timeZone?: string; currency?: CurrencyCode; ownerUserId?: string;
}): Promise<Shop> {
  const id = input.id ?? randomUUID();
  const ownerUserId = input.ownerUserId ?? null;
  const key = `${ownerUserId ?? "default"}_${input.slug}`;
  const now = new Date().toISOString();
  await db.firestoreStore.runTransaction(async (transaction) => {
    const existing = await transaction.get("shopSlugKeys", key);
    if (existing) throw new Error("shops.owner_user_id, shops.slug");
    transaction.create("shopSlugKeys", key, { shopId: id, ownerUserId, slug: input.slug });
    transaction.create("shops", id, {
      id, slug: input.slug, ownerUserId, name: input.name, timeZone: input.timeZone ?? "Asia/Tokyo",
      currency: input.currency ?? "JPY", status: "active", catalogRevision: 1, createdAt: now, updatedAt: now,
    });
  });
  return (await getShopById(db, id))!;
}

export async function getShopById(db: FirestoreDb, id: string): Promise<Shop | undefined> {
  const row = await db.firestoreStore.get<ShopDoc>("shops", id);
  if (!row) return undefined;
  const owner = row.ownerUserId ? await db.firestoreStore.get<UserDoc>("users", row.ownerUserId) : undefined;
  return { id: row.id, slug: row.slug, ownerUserId: row.ownerUserId, name: row.name, timeZone: row.timeZone,
    currency: row.currency, status: row.status, ownerSlug: owner?.ownerSlug ?? null };
}

export async function getShopBySlug(db: FirestoreDb, slug: string): Promise<Shop | undefined> {
  const matches = await db.firestoreStore.query<ShopDoc>("shops", [{ field: "slug", op: "==", value: slug }], undefined, 2);
  return matches.length === 1 ? getShopById(db, matches[0]!.id) : undefined;
}

export async function getShopByOwnerAndSlug(db: FirestoreDb, ownerSlug: string, slug: string): Promise<Shop | undefined> {
  const owners = await db.firestoreStore.query<UserDoc>("users", [{ field: "ownerSlug", op: "==", value: ownerSlug }], undefined, 1);
  if (!owners[0]) return undefined;
  const key = await db.firestoreStore.get<{ shopId: string } & FirestoreDocument>("shopSlugKeys", `${owners[0].id}_${slug}`);
  return key ? getShopById(db, key.shopId) : undefined;
}

export async function getCatalogRevision(db: FirestoreDb, shopId = DEFAULT_SHOP_ID): Promise<number> {
  const shop = await db.firestoreStore.get<ShopDoc>("shops", shopId);
  if (!shop) throw new Error("Shop was not found");
  return shop.catalogRevision;
}

export async function incrementCatalogRevision(db: FirestoreDb, shopId = DEFAULT_SHOP_ID): Promise<number> {
  return db.firestoreStore.runTransaction(async (transaction) => {
    const shop = await transaction.get<ShopDoc>("shops", shopId);
    if (!shop) throw new Error("Shop was not found");
    const catalogRevision = shop.catalogRevision + 1;
    transaction.update("shops", shopId, { catalogRevision, updatedAt: new Date().toISOString() });
    return catalogRevision;
  });
}

export async function initializeDefaultShop(db: FirestoreDb): Promise<void> {
  const shop = await db.firestoreStore.get<ShopDoc>("shops", DEFAULT_SHOP_ID);
  if (shop) return;
  const now = new Date().toISOString();
  await db.firestoreStore.create("shops", DEFAULT_SHOP_ID, {
    id: DEFAULT_SHOP_ID, slug: DEFAULT_SHOP_SLUG, ownerUserId: null, name: DEFAULT_SHOP_NAME,
    timeZone: "Asia/Tokyo", currency: "JPY", status: "active", catalogRevision: 1, createdAt: now, updatedAt: now,
  });
}
