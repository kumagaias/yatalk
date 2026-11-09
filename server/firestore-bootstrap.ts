import Database from "better-sqlite3";
import type { FirestoreDb } from "./database.js";
import { DEFAULT_SHOP_ID, DEFAULT_SHOP_NAME, DEFAULT_SHOP_SLUG } from "./database.js";
import { createFirestoreStore } from "./firestore-store.js";
import { seedProducts } from "./seed-data.js";

export function createFirestoreDatabase(projectId: string): FirestoreDb {
  const db = new Database(":memory:") as FirestoreDb;
  Object.defineProperties(db, {
    backend: { value: "firestore", enumerable: false },
    firestoreStore: { value: createFirestoreStore(projectId), enumerable: false },
    firestoreBrand: { value: true, enumerable: false },
  });
  return db;
}

export async function initializeFirestoreDatabase(db: FirestoreDb): Promise<void> {
  await db.firestoreStore.runTransaction(async (transaction) => {
    const shop = await transaction.get<{ currency?: string }>("shops", DEFAULT_SHOP_ID);
    const products = await Promise.all(seedProducts.map((product) => transaction.get("products", product.id)));
    const now = new Date().toISOString();
    if (!shop) transaction.create("shops", DEFAULT_SHOP_ID, {
      id: DEFAULT_SHOP_ID, slug: DEFAULT_SHOP_SLUG, ownerUserId: null, name: DEFAULT_SHOP_NAME,
      timeZone: "Asia/Tokyo", currency: "JPY", status: "active", catalogRevision: 1,
      createdAt: now, updatedAt: now,
    });
    seedProducts.forEach((product, index) => {
      if (!products[index]) transaction.create("products", product.id, {
        id: product.id, shopId: DEFAULT_SHOP_ID, name: product.name, description: product.description,
        priceMinor: product.price, stockOnHand: product.stock, reservedQuantity: 0, dietaryNote: product.note,
        currency: shop?.currency ?? "JPY", active: true, updatedAt: now,
      });
    });
  });
}
