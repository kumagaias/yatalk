import { randomUUID } from "node:crypto";
import type { CartOperation, CreateProduct, ProductPatch } from "../shared/schemas.js";
import type { CurrencyCode } from "../shared/currency.js";
import { getCatalogRevision, type FirestoreDb } from "./database.js";
import { ApiError } from "./errors.js";
import type { Cart, CartItem, Product } from "./inventory.js";
import type { FirestoreDocument } from "./firestore-store.js";

type ProductDoc = FirestoreDocument & {
  id: string; shopId: string; name: string; description: string; priceMinor: number; currency: CurrencyCode;
  stockOnHand: number; reservedQuantity: number; dietaryNote: string; active: boolean;
};
type CartDoc = FirestoreDocument & { id: string; sessionHash: string; shopId: string; productId: string; quantity: number };
type SessionDoc = FirestoreDocument & { id: string; shopId: string; cartVersion: number; expiresAt: string; expiresAtTtl?: Date };
type ShopDoc = FirestoreDocument & { id: string; currency: CurrencyCode; catalogRevision: number };

function asProduct(row: ProductDoc): Product {
  const reserved = row.reservedQuantity ?? 0;
  return { id: row.id, name: row.name, description: row.description, priceMinor: row.priceMinor,
    currency: row.currency, stockOnHand: row.stockOnHand, reserved, available: Math.max(0, row.stockOnHand - reserved),
    dietaryNote: row.dietaryNote, active: row.active };
}

function cartItem(row: ProductDoc, quantity: number): CartItem {
  const product = asProduct(row);
  return { ...product, quantity, lineTotalMinor: product.priceMinor * quantity };
}

export async function reservedForProduct(db: FirestoreDb, productId: string, shopId: string): Promise<number> {
  const product = await db.firestoreStore.get<ProductDoc>("products", productId);
  return product?.shopId === shopId ? product.reservedQuantity ?? 0 : 0;
}

export async function listProducts(db: FirestoreDb, shopId: string, activeOnly = true): Promise<Product[]> {
  const filters = [{ field: "shopId", op: "==" as const, value: shopId },
    ...(activeOnly ? [{ field: "active", op: "==" as const, value: true }] : [])];
  const rows = await db.firestoreStore.query<ProductDoc>("products", filters);
  return rows.sort((left, right) => left.name.localeCompare(right.name)).map(asProduct);
}

export async function getProduct(db: FirestoreDb, productId: string, shopId: string): Promise<Product | undefined> {
  const row = await db.firestoreStore.get<ProductDoc>("products", productId);
  return row?.shopId === shopId ? asProduct(row) : undefined;
}

export async function createProducts(db: FirestoreDb, inputs: CreateProduct[], shopId: string): Promise<Product[]> {
  const ids = inputs.map(() => randomUUID());
  const now = new Date().toISOString();
  const rows = await db.firestoreStore.runTransaction(async (transaction) => {
    const shop = await transaction.get<ShopDoc>("shops", shopId);
    if (!shop) throw new ApiError(404, "shop_not_found", "The requested shop was not found.");
    const existing = await transaction.query<ProductDoc>("products", [
      { field: "shopId", op: "==", value: shopId }, { field: "active", op: "==", value: true },
    ], undefined, 31);
    if (existing.length + inputs.length > 30) {
      throw new ApiError(409, "menu_item_limit", "A shop can have up to 30 active menu items.");
    }
    const created = inputs.map((input, index): ProductDoc => ({
      id: ids[index]!, shopId, name: input.name, description: input.description, priceMinor: input.priceMinor,
      currency: shop.currency, stockOnHand: input.stockOnHand, reservedQuantity: 0,
      dietaryNote: input.dietaryNote, active: true, updatedAt: now,
    }));
    created.forEach((product) => transaction.create("products", product.id, product));
    transaction.update("shops", shopId, { catalogRevision: shop.catalogRevision + 1, updatedAt: now });
    return created;
  });
  return rows.map(asProduct);
}

export async function menuResponse(db: FirestoreDb, eventName: string, shopId: string) {
  const products = (await listProducts(db, shopId)).slice(0, 30).map(({ stockOnHand: _onHand,
    reserved: _reserved, active: _active, ...product }) => product);
  return { event: { name: eventName }, products, catalogRevision: await getCatalogRevision(db, shopId) };
}

export async function readCart(db: FirestoreDb, sessionHash: string, shopId: string): Promise<Cart> {
  const [cartRows, session, shop] = await Promise.all([
    db.firestoreStore.query<CartDoc>("cartItems", [{ field: "sessionHash", op: "==", value: sessionHash }]),
    db.firestoreStore.get<SessionDoc>("visitorSessions", sessionHash),
    db.firestoreStore.get<ShopDoc>("shops", shopId),
  ]);
  if (!session || session.shopId !== shopId) throw new ApiError(401, "visitor_session_required", "Refresh the page to start a new session.");
  if (!shop) throw new ApiError(404, "shop_not_found", "The requested shop was not found.");
  const items = (await Promise.all(cartRows.filter((item) => item.shopId === shopId).map(async (item) => {
    const product = await db.firestoreStore.get<ProductDoc>("products", item.productId);
    return product?.shopId === shopId ? cartItem(product, item.quantity) : undefined;
  }))).filter((item): item is CartItem => !!item).sort((left, right) => left.name.localeCompare(right.name));
  return { items, totalMinor: items.reduce((sum, item) => sum + item.lineTotalMinor, 0),
    currency: shop.currency, cartVersion: session.cartVersion, catalogRevision: shop.catalogRevision };
}

export async function ensureVersions(db: FirestoreDb, sessionHash: string, cartVersion: number, catalogRevision: number, shopId: string): Promise<void> {
  const cart = await readCart(db, sessionHash, shopId);
  if (cart.cartVersion !== cartVersion || cart.catalogRevision !== catalogRevision) {
    throw new ApiError(409, "cart_changed", "The menu or cart changed. Review the current cart.", { cart });
  }
}

export async function applyCartOperations(db: FirestoreDb, sessionHash: string, operations: CartOperation[], shopId: string): Promise<Cart> {
  return db.firestoreStore.runTransaction(async (transaction) => {
    const [session, shop, cartRows] = await Promise.all([
      transaction.get<SessionDoc>("visitorSessions", sessionHash),
      transaction.get<ShopDoc>("shops", shopId),
      transaction.query<CartDoc>("cartItems", [{ field: "sessionHash", op: "==", value: sessionHash }]),
    ]);
    if (!session || session.shopId !== shopId) throw new ApiError(401, "visitor_session_required", "Refresh the page to start a new session.");
    if (!shop) throw new ApiError(404, "shop_not_found", "The requested shop was not found.");
    const existingCart = cartRows.filter((item) => item.shopId === shopId);
    const productIds = [...new Set([...existingCart.map((item) => item.productId), ...operations.map((op) => op.productId)])];
    const products = await Promise.all(productIds.map((id) => transaction.get<ProductDoc>("products", id)));
    const byId = new Map(products.filter((item): item is ProductDoc => !!item && item.shopId === shopId).map((item) => [item.id, item]));
    const current = new Map(existingCart.map((item) => [item.productId, item.quantity]));
    for (const operation of operations) {
      const product = byId.get(operation.productId);
      if (!product) throw new ApiError(400, "unknown_product", "One selected item is no longer available.");
      if (operation.action === "remove") current.delete(product.id);
      else {
        if (!product.active) throw new ApiError(400, "unknown_product", "One selected item is no longer available.");
        const oldQuantity = current.get(product.id) ?? 0;
        const nextQuantity = operation.action === "add" ? oldQuantity + operation.quantity : operation.quantity;
        const available = Math.max(0, product.stockOnHand - (product.reservedQuantity ?? 0));
        if (nextQuantity > 20) throw new ApiError(400, "quantity_limit", "Each item is limited to 20.");
        if (nextQuantity > available) throw new ApiError(409, "stock_changed", `Only ${available} ${product.name} available.`, { available });
        current.set(product.id, nextQuantity);
      }
    }
    if (current.size > 12) throw new ApiError(400, "cart_line_limit", "A cart can contain at most 12 items.");
    const now = new Date().toISOString();
    existingCart.forEach((item) => transaction.delete("cartItems", item.id));
    for (const [productId, quantity] of current) {
      transaction.set("cartItems", `${sessionHash}_${productId}`, {
        sessionHash, shopId, productId, quantity, expiresAtTtl: session.expiresAtTtl ?? new Date(session.expiresAt), updatedAt: now,
      });
    }
    const nextVersion = session.cartVersion + 1;
    transaction.update("visitorSessions", sessionHash, { cartVersion: nextVersion });
    const items = [...current.entries()].flatMap(([id, quantity]) => {
      const product = byId.get(id);
      return product ? [cartItem(product, quantity)] : [];
    }).sort((left, right) => left.name.localeCompare(right.name));
    return { items, totalMinor: items.reduce((sum, item) => sum + item.lineTotalMinor, 0),
      currency: shop.currency, cartVersion: nextVersion, catalogRevision: shop.catalogRevision };
  });
}

export async function clearCart(db: FirestoreDb, sessionHash: string, shopId: string): Promise<Cart> {
  return db.firestoreStore.runTransaction(async (transaction) => {
    const [session, shop, cartRows] = await Promise.all([
      transaction.get<SessionDoc>("visitorSessions", sessionHash),
      transaction.get<ShopDoc>("shops", shopId),
      transaction.query<CartDoc>("cartItems", [{ field: "sessionHash", op: "==", value: sessionHash }]),
    ]);
    if (!session || session.shopId !== shopId) throw new ApiError(401, "visitor_session_required", "Refresh the page to start a new session.");
    if (!shop) throw new ApiError(404, "shop_not_found", "The requested shop was not found.");
    cartRows.filter((item) => item.shopId === shopId).forEach((item) => transaction.delete("cartItems", item.id));
    const cartVersion = session.cartVersion + 1;
    transaction.update("visitorSessions", sessionHash, { cartVersion });
    return { items: [], totalMinor: 0, currency: shop.currency, cartVersion, catalogRevision: shop.catalogRevision };
  });
}

export async function patchProduct(db: FirestoreDb, productId: string, patch: ProductPatch, shopId: string): Promise<Product> {
  return db.firestoreStore.runTransaction(async (transaction) => {
    const [row, shop] = await Promise.all([
      transaction.get<ProductDoc>("products", productId),
      transaction.get<ShopDoc>("shops", shopId),
    ]);
    if (!row || row.shopId !== shopId) throw new ApiError(404, "product_not_found", "Product was not found.");
    if (!shop) throw new ApiError(404, "shop_not_found", "The requested shop was not found.");
    if (patch.stockOnHand !== undefined && patch.stockOnHand < (row.reservedQuantity ?? 0)) {
      throw new ApiError(409, "stock_reserved", "On-hand stock cannot be lower than reserved stock.", { reserved: row.reservedQuantity ?? 0 });
    }
    const changes: FirestoreDocument = { updatedAt: new Date().toISOString() };
    if (patch.name !== undefined) changes.name = patch.name;
    if (patch.description !== undefined) changes.description = patch.description;
    if (patch.priceMinor !== undefined) changes.priceMinor = patch.priceMinor;
    if (patch.stockOnHand !== undefined) changes.stockOnHand = patch.stockOnHand;
    if (patch.dietaryNote !== undefined) changes.dietaryNote = patch.dietaryNote;
    if (patch.active !== undefined) changes.active = patch.active;
    transaction.update("products", productId, changes);
    transaction.update("shops", shopId, { catalogRevision: shop.catalogRevision + 1, updatedAt: changes.updatedAt });
    return asProduct({ ...row, ...changes } as ProductDoc);
  });
}

export async function receiveProductStock(db: FirestoreDb, productId: string, quantity: number, receiptId: string, shopId: string): Promise<{ product: Product; applied: boolean }> {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
    throw new ApiError(400, "invalid_received_quantity", "Received quantity must be a whole number between 1 and 999.");
  }
  return db.firestoreStore.runTransaction(async (transaction) => {
    const receipt = await transaction.get<FirestoreDocument>("inventoryReceipts", receiptId);
    if (receipt) {
      if (receipt.shopId !== shopId || receipt.productId !== productId || receipt.quantity !== quantity) {
        throw new ApiError(409, "stock_receipt_conflict", "This receipt has already been applied with different details.");
      }
      const current = await transaction.get<ProductDoc>("products", productId);
      if (!current || current.shopId !== shopId) throw new ApiError(404, "product_not_found", "Product was not found.");
      return { product: asProduct(current), applied: false };
    }
    const [row, shop] = await Promise.all([
      transaction.get<ProductDoc>("products", productId),
      transaction.get<ShopDoc>("shops", shopId),
    ]);
    if (!row || row.shopId !== shopId) throw new ApiError(404, "product_not_found", "Product was not found.");
    if (!shop) throw new ApiError(404, "shop_not_found", "The requested shop was not found.");
    const stockOnHand = row.stockOnHand + quantity;
    if (stockOnHand > 999) throw new ApiError(400, "stock_limit", "Stock cannot exceed 999 units.");
    const updatedAt = new Date().toISOString();
    transaction.update("products", productId, { stockOnHand, updatedAt });
    transaction.update("shops", shopId, { catalogRevision: shop.catalogRevision + 1, updatedAt });
    transaction.create("inventoryReceipts", receiptId, { shopId, productId, quantity, stockOnHand, createdAt: updatedAt });
    return { product: asProduct({ ...row, stockOnHand, updatedAt }), applied: true };
  });
}
