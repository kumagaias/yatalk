import { randomUUID } from "node:crypto";
import type { CurrencyCode } from "../shared/currency.js";
import { MAX_FREE_OWNER_SHOPS } from "../shared/owner-limits.js";
import type { FirestoreDb, Shop } from "./database.js";
import { getShopById } from "./firestore-shops.js";
import type { FirestoreDocument } from "./firestore-store.js";

type UserDoc = FirestoreDocument & {
  id: string; email: string; displayName: string; ownerSlug: string;
  defaultCurrency: CurrencyCode; passwordHash: string; createdAt: string; shopCount?: number; emailVerified?: boolean;
};
type MembershipDoc = FirestoreDocument & { id: string; shopId: string; userId: string; role: "owner" | "staff" };
type ShopDoc = FirestoreDocument & {
  id: string; slug: string; ownerUserId: string; name: string; timeZone: string;
  currency: CurrencyCode; status: "active" | "inactive"; catalogRevision: number;
};

export async function isOwnerSlugAvailable(db: FirestoreDb, slug: string): Promise<boolean> {
  return !(await db.firestoreStore.get("ownerSlugKeys", slug));
}

export async function createOwnerAccount(db: FirestoreDb, input: UserDoc): Promise<void> {
  const emailKey = input.email.trim().toLowerCase();
  await db.firestoreStore.runTransaction(async (transaction) => {
    const [email, slug] = await Promise.all([
      transaction.get("ownerEmailKeys", emailKey),
      transaction.get("ownerSlugKeys", input.ownerSlug),
    ]);
    if (email) throw new Error("users.email");
    if (slug) throw new Error("users.owner_slug");
    transaction.create("ownerEmailKeys", emailKey, { userId: input.id });
    transaction.create("ownerSlugKeys", input.ownerSlug, { userId: input.id });
    transaction.create("users", input.id, { ...input, email: emailKey });
  });
}

export async function getOwnerByEmail(db: FirestoreDb, email: string): Promise<UserDoc | undefined> {
  const key = email.trim().toLowerCase();
  const index = await db.firestoreStore.get<{ userId: string } & Record<string, unknown>>("ownerEmailKeys", key);
  return index ? db.firestoreStore.get<UserDoc>("users", index.userId) : undefined;
}

export async function createOwnedShop(db: FirestoreDb, owner: { id: string; currency: CurrencyCode }, slug: string, name: string): Promise<Shop> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const key = `${owner.id}_${slug}`;
  await db.firestoreStore.runTransaction(async (transaction) => {
    const [existing, ownerAccount, ownedShops] = await Promise.all([
      transaction.get("shopSlugKeys", key),
      transaction.get<UserDoc>("users", owner.id),
      transaction.query<ShopDoc>("shops", [{ field: "ownerUserId", op: "==", value: owner.id }], undefined, MAX_FREE_OWNER_SHOPS),
    ]);
    const shopCount = typeof ownerAccount?.shopCount === "number" ? ownerAccount.shopCount : ownedShops.length;
    if (shopCount >= MAX_FREE_OWNER_SHOPS) throw new Error("shop_limit_reached");
    if (!ownerAccount) throw new Error("owner_not_found");
    if (existing) throw new Error("shops.owner_user_id, shops.slug");
    transaction.update("users", owner.id, { shopCount: shopCount + 1 });
    transaction.create("shopSlugKeys", key, { shopId: id, ownerUserId: owner.id, slug });
    transaction.create("shops", id, {
      id, slug, ownerUserId: owner.id, name, timeZone: "Asia/Tokyo", currency: owner.currency,
      status: "active", catalogRevision: 1, createdAt: now, updatedAt: now,
    });
    transaction.create("shopMemberships", `${id}_${owner.id}`, {
      shopId: id, userId: owner.id, role: "owner", createdAt: now,
    });
  });
  return (await getShopById(db, id))!;
}

export async function listOwnerShops(db: FirestoreDb, userId: string): Promise<Shop[]> {
  const [memberships, user] = await Promise.all([
    db.firestoreStore.query<MembershipDoc>("shopMemberships", [{ field: "userId", op: "==", value: userId }]),
    db.firestoreStore.get<UserDoc>("users", userId),
  ]);
  const shops = await Promise.all(memberships.map(({ shopId }) => db.firestoreStore.get<ShopDoc>("shops", shopId)));
  return shops.filter((shop): shop is ShopDoc => !!shop).map((shop) => ({
    id: shop.id, slug: shop.slug, ownerUserId: shop.ownerUserId, name: shop.name,
    timeZone: shop.timeZone, currency: shop.currency, status: shop.status, ownerSlug: user?.ownerSlug ?? null,
  }));
}
