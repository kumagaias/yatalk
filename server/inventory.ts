import { randomUUID } from "node:crypto";
import type { Db, FirestoreDb, SqliteDb } from "./database.js";
import { ApiError } from "./errors.js";
import { DEFAULT_SHOP_ID, getCatalogRevision, incrementCatalogRevision } from "./database.js";
import * as firestoreInventory from "./firestore-inventory.js";
import type { CartOperation, CreateProduct, ProductPatch } from "../shared/schemas.js";
import type { CurrencyCode } from "../shared/currency.js";

export type Product = {
  id: string;
  name: string;
  description: string;
  priceMinor: number;
  currency: CurrencyCode;
  stockOnHand: number;
  reserved: number;
  available: number;
  dietaryNote: string;
  active: boolean;
};

type ProductRow = {
  id: string; name: string; description: string; price_minor: number; currency: CurrencyCode;
  stock_on_hand: number; dietary_note: string; active: number;
};

export function reservedForProduct(db: FirestoreDb, productId: string, shopId?: string, at?: string): Promise<number>;
export function reservedForProduct(db: SqliteDb, productId: string, shopId?: string, at?: string): number;
export function reservedForProduct(db: Db, productId: string, shopId?: string, at?: string): number | Promise<number>;
export function reservedForProduct(db: Db, productId: string, shopId = DEFAULT_SHOP_ID, at = new Date().toISOString()): number | Promise<number> {
  if ((db as FirestoreDb).firestoreBrand) return firestoreInventory.reservedForProduct(db as FirestoreDb, productId, shopId);
  const row = db.prepare(`SELECT COALESCE(SUM(oi.quantity), 0) AS reserved
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE oi.product_id = ? AND oi.shop_id = ? AND o.shop_id = ? AND (
      (o.state IN ('creating_payment', 'pending_payment', 'create_unknown') AND o.expires_at > ?)
      OR o.state = 'capture_unknown'
    )`).get(productId, shopId, shopId, at) as { reserved: number };
  return row.reserved;
}

export function listProducts(db: FirestoreDb, shopId?: string, activeOnly?: boolean): Promise<Product[]>;
export function listProducts(db: SqliteDb, shopOrActive?: string | boolean, activeOnlyArg?: boolean): Product[];
export function listProducts(db: Db, shopOrActive?: string | boolean, activeOnlyArg?: boolean): Product[] | Promise<Product[]>;
export function listProducts(db: Db, shopOrActive: string | boolean = DEFAULT_SHOP_ID, activeOnlyArg = true): Product[] | Promise<Product[]> {
  if ((db as FirestoreDb).firestoreBrand) {
    return firestoreInventory.listProducts(db as FirestoreDb, typeof shopOrActive === "string" ? shopOrActive : DEFAULT_SHOP_ID,
      typeof shopOrActive === "boolean" ? shopOrActive : activeOnlyArg);
  }
  const shopId = typeof shopOrActive === "string" ? shopOrActive : DEFAULT_SHOP_ID;
  const activeOnly = typeof shopOrActive === "boolean" ? shopOrActive : activeOnlyArg;
  const rows = db.prepare(`SELECT * FROM products WHERE shop_id = ? ${activeOnly ? "AND active = 1" : ""} ORDER BY name COLLATE NOCASE`)
    .all(shopId) as ProductRow[];
  return rows.map((row) => {
    const reserved = reservedForProduct(db as SqliteDb, row.id, shopId);
    return {
      id: row.id, name: row.name, description: row.description,
      priceMinor: row.price_minor, currency: row.currency, stockOnHand: row.stock_on_hand,
      reserved, available: Math.max(0, row.stock_on_hand - reserved),
      dietaryNote: row.dietary_note, active: row.active === 1,
    };
  });
}

export function getProduct(db: FirestoreDb, productId: string, shopId?: string): Promise<Product | undefined>;
export function getProduct(db: SqliteDb, productId: string, shopId?: string): Product | undefined;
export function getProduct(db: Db, productId: string, shopId?: string): Product | undefined | Promise<Product | undefined>;
export function getProduct(db: Db, productId: string, shopId = DEFAULT_SHOP_ID): Product | undefined | Promise<Product | undefined> {
  if ((db as FirestoreDb).firestoreBrand) return firestoreInventory.getProduct(db as FirestoreDb, productId, shopId);
  const row = db.prepare("SELECT * FROM products WHERE id = ? AND shop_id = ?").get(productId, shopId) as ProductRow | undefined;
  if (!row) return undefined;
  const reserved = reservedForProduct(db as SqliteDb, row.id, shopId);
  return {
    id: row.id, name: row.name, description: row.description, priceMinor: row.price_minor,
    currency: row.currency, stockOnHand: row.stock_on_hand, reserved,
    available: Math.max(0, row.stock_on_hand - reserved), dietaryNote: row.dietary_note,
    active: row.active === 1,
  };
}

export function createProducts(db: FirestoreDb, inputs: CreateProduct[], shopId?: string): Promise<Product[]>;
export function createProducts(db: SqliteDb, inputs: CreateProduct[], shopId?: string): Product[];
export function createProducts(db: Db, inputs: CreateProduct[], shopId?: string): Product[] | Promise<Product[]>;
export function createProducts(db: Db, inputs: CreateProduct[], shopId = DEFAULT_SHOP_ID): Product[] | Promise<Product[]> {
  if ((db as FirestoreDb).firestoreBrand) return firestoreInventory.createProducts(db as FirestoreDb, inputs, shopId);
  const transaction = db.transaction(() => {
    const row = db.prepare(`SELECT COUNT(products.id) AS count, shops.currency FROM shops
      LEFT JOIN products ON products.shop_id = shops.id AND products.active = 1 WHERE shops.id = ?`).get(shopId) as { count: number; currency: CurrencyCode };
    if (row.count + inputs.length > 30) {
      throw new ApiError(409, "menu_item_limit", "A shop can have up to 30 active menu items.");
    }
    const now = new Date().toISOString();
    const insert = db.prepare(`INSERT INTO products
      (id, shop_id, name, description, price_minor, currency, stock_on_hand, dietary_note, active, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`);
    const ids = inputs.map(() => randomUUID());
    inputs.forEach((product, index) => insert.run(ids[index], shopId, product.name, product.description,
      product.priceMinor, row.currency, product.stockOnHand, product.dietaryNote, now));
    incrementCatalogRevision(db as SqliteDb, shopId);
    return ids.map((id) => getProduct(db as SqliteDb, id, shopId)!);
  });
  return transaction.immediate();
}

export type MenuResponse = { event: { name: string }; products: Array<Omit<Product, "stockOnHand" | "reserved" | "available" | "active">>; catalogRevision: number };
export function menuResponse(db: FirestoreDb, eventName: string, shopId?: string): Promise<MenuResponse>;
export function menuResponse(db: SqliteDb, eventName: string, shopId?: string): MenuResponse;
export function menuResponse(db: Db, eventName: string, shopId?: string): MenuResponse | Promise<MenuResponse>;
export function menuResponse(db: Db, eventName: string, shopId = DEFAULT_SHOP_ID): MenuResponse | Promise<MenuResponse> {
  if ((db as FirestoreDb).firestoreBrand) return firestoreInventory.menuResponse(db as FirestoreDb, eventName, shopId);
  const products = listProducts(db as SqliteDb, shopId).slice(0, 30).map(({ stockOnHand: _onHand, reserved: _reserved, active: _active, ...product }) => product);
  return { event: { name: eventName }, products, catalogRevision: getCatalogRevision(db as SqliteDb, shopId) };
}

export interface CartItem extends Product { quantity: number; lineTotalMinor: number }
export interface Cart {
  items: CartItem[];
  totalMinor: number;
  currency: CurrencyCode;
  cartVersion: number;
  catalogRevision: number;
}

export function readCart(db: FirestoreDb, sessionHash: string, shopId?: string): Promise<Cart>;
export function readCart(db: SqliteDb, sessionHash: string, shopId?: string): Cart;
export function readCart(db: Db, sessionHash: string, shopId?: string): Cart | Promise<Cart>;
export function readCart(db: Db, sessionHash: string, shopId = DEFAULT_SHOP_ID): Cart | Promise<Cart> {
  if ((db as FirestoreDb).firestoreBrand) return firestoreInventory.readCart(db as FirestoreDb, sessionHash, shopId);
  const rows = db.prepare(`SELECT ci.quantity, p.* FROM cart_items ci
    JOIN products p ON p.id = ci.product_id AND p.shop_id = ci.shop_id
    WHERE ci.session_hash = ? AND ci.shop_id = ? ORDER BY p.name COLLATE NOCASE`).all(sessionHash, shopId) as Array<ProductRow & { quantity: number }>;
  const items: CartItem[] = rows.map((row) => {
    const reserved = reservedForProduct(db as SqliteDb, row.id, shopId);
    return {
      id: row.id, name: row.name, description: row.description, priceMinor: row.price_minor,
      currency: row.currency, stockOnHand: row.stock_on_hand, reserved,
      available: Math.max(0, row.stock_on_hand - reserved), dietaryNote: row.dietary_note,
      active: row.active === 1, quantity: row.quantity, lineTotalMinor: row.price_minor * row.quantity,
    };
  });
  const session = db.prepare("SELECT cart_version FROM visitor_sessions WHERE session_hash = ? AND shop_id = ?")
    .get(sessionHash, shopId) as { cart_version: number };
  const shop = db.prepare("SELECT currency FROM shops WHERE id = ?").get(shopId) as { currency: CurrencyCode };
  return { items, totalMinor: items.reduce((sum, item) => sum + item.lineTotalMinor, 0), currency: shop.currency, cartVersion: session.cart_version, catalogRevision: getCatalogRevision(db as SqliteDb, shopId) };
}

export function ensureVersions(db: FirestoreDb, sessionHash: string, cartVersion: number, catalogRevision: number, shopId?: string): Promise<void>;
export function ensureVersions(db: SqliteDb, sessionHash: string, cartVersion: number, catalogRevision: number, shopId?: string): void;
export function ensureVersions(db: Db, sessionHash: string, cartVersion: number, catalogRevision: number, shopId?: string): void | Promise<void>;
export function ensureVersions(db: Db, sessionHash: string, cartVersion: number, catalogRevision: number, shopId = DEFAULT_SHOP_ID): void | Promise<void> {
  if ((db as FirestoreDb).firestoreBrand) return firestoreInventory.ensureVersions(db as FirestoreDb, sessionHash, cartVersion, catalogRevision, shopId);
  const cart = readCart(db as SqliteDb, sessionHash, shopId);
  if (cart.cartVersion !== cartVersion || cart.catalogRevision !== catalogRevision) {
    throw new ApiError(409, "cart_changed", "The menu or cart changed. Review the current cart.", { cart });
  }
}

export function applyCartOperations(db: FirestoreDb, sessionHash: string, operations: CartOperation[], shopId?: string): Promise<Cart>;
export function applyCartOperations(db: SqliteDb, sessionHash: string, operations: CartOperation[], shopId?: string): Cart;
export function applyCartOperations(db: Db, sessionHash: string, operations: CartOperation[], shopId?: string): Cart | Promise<Cart>;
export function applyCartOperations(db: Db, sessionHash: string, operations: CartOperation[], shopId = DEFAULT_SHOP_ID): Cart | Promise<Cart> {
  if ((db as FirestoreDb).firestoreBrand) return firestoreInventory.applyCartOperations(db as FirestoreDb, sessionHash, operations, shopId);
  const transaction = db.transaction(() => {
    const now = new Date().toISOString();
    const current = new Map((db.prepare("SELECT product_id, quantity FROM cart_items WHERE session_hash = ? AND shop_id = ?")
      .all(sessionHash, shopId) as Array<{ product_id: string; quantity: number }>)
      .map((item) => [item.product_id, item.quantity]));
    for (const operation of operations) {
      const product = getProduct(db as SqliteDb, operation.productId, shopId);
      if (!product) throw new ApiError(400, "unknown_product", "One selected item is no longer available.");
      if (operation.action === "remove") current.delete(product.id);
      else {
        if (!product.active) throw new ApiError(400, "unknown_product", "One selected item is no longer available.");
        const oldQuantity = current.get(product.id) ?? 0;
        const nextQuantity = operation.action === "add" ? oldQuantity + operation.quantity : operation.quantity;
        if (nextQuantity > 20) throw new ApiError(400, "quantity_limit", "Each item is limited to 20.");
        if (nextQuantity > product.available) throw new ApiError(409, "stock_changed", `Only ${product.available} ${product.name} available.`, { available: product.available });
        current.set(product.id, nextQuantity);
      }
    }
    if (current.size > 12) throw new ApiError(400, "cart_line_limit", "A cart can contain at most 12 items.");
    db.prepare("DELETE FROM cart_items WHERE session_hash = ? AND shop_id = ?").run(sessionHash, shopId);
    const insert = db.prepare(`INSERT INTO cart_items(session_hash, shop_id, product_id, quantity, updated_at) VALUES (?, ?, ?, ?, ?)`);
    for (const [productId, quantity] of current) insert.run(sessionHash, shopId, productId, quantity, now);
    db.prepare("UPDATE visitor_sessions SET cart_version = cart_version + 1 WHERE session_hash = ? AND shop_id = ?").run(sessionHash, shopId);
    return readCart(db as SqliteDb, sessionHash, shopId);
  });
  return transaction.immediate();
}

export function clearCart(db: FirestoreDb, sessionHash: string, shopId?: string): Promise<Cart>;
export function clearCart(db: SqliteDb, sessionHash: string, shopId?: string): Cart;
export function clearCart(db: Db, sessionHash: string, shopId?: string): Cart | Promise<Cart>;
export function clearCart(db: Db, sessionHash: string, shopId = DEFAULT_SHOP_ID): Cart | Promise<Cart> {
  if ((db as FirestoreDb).firestoreBrand) return firestoreInventory.clearCart(db as FirestoreDb, sessionHash, shopId);
  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM cart_items WHERE session_hash = ? AND shop_id = ?").run(sessionHash, shopId);
    db.prepare("UPDATE visitor_sessions SET cart_version = cart_version + 1 WHERE session_hash = ? AND shop_id = ?").run(sessionHash, shopId);
    return readCart(db as SqliteDb, sessionHash, shopId);
  });
  return transaction.immediate();
}

export function patchProduct(db: FirestoreDb, productId: string, patch: ProductPatch, shopId?: string): Promise<Product>;
export function patchProduct(db: SqliteDb, productId: string, patch: ProductPatch, shopId?: string): Product;
export function patchProduct(db: Db, productId: string, patch: ProductPatch, shopId?: string): Product | Promise<Product>;
export function patchProduct(db: Db, productId: string, patch: ProductPatch, shopId = DEFAULT_SHOP_ID): Product | Promise<Product> {
  if ((db as FirestoreDb).firestoreBrand) return firestoreInventory.patchProduct(db as FirestoreDb, productId, patch, shopId);
  const transaction = db.transaction(() => {
    const product = getProduct(db as SqliteDb, productId, shopId);
    if (!product) throw new ApiError(404, "product_not_found", "Product was not found.");
    if (patch.stockOnHand !== undefined && patch.stockOnHand < product.reserved) {
      throw new ApiError(409, "stock_reserved", "On-hand stock cannot be lower than reserved stock.", { reserved: product.reserved });
    }
    const fields: Record<string, string | number> = {};
    if (patch.name !== undefined) fields.name = patch.name;
    if (patch.description !== undefined) fields.description = patch.description;
    if (patch.priceMinor !== undefined) fields.price_minor = patch.priceMinor;
    if (patch.stockOnHand !== undefined) fields.stock_on_hand = patch.stockOnHand;
    if (patch.dietaryNote !== undefined) fields.dietary_note = patch.dietaryNote;
    if (patch.active !== undefined) fields.active = patch.active ? 1 : 0;
    const assignments = Object.keys(fields).map((field) => `${field} = @${field}`).join(", ");
    db.prepare(`UPDATE products SET ${assignments}, updated_at = @updated_at WHERE id = @id AND shop_id = @shop_id`)
      .run({ ...fields, id: productId, shop_id: shopId, updated_at: new Date().toISOString() });
    incrementCatalogRevision(db as SqliteDb, shopId);
    return getProduct(db as SqliteDb, productId, shopId)!;
  });
  return transaction.immediate();
}

export function currentCatalogRevision(db: FirestoreDb, shopId?: string): Promise<number>;
export function currentCatalogRevision(db: SqliteDb, shopId?: string): number;
export function currentCatalogRevision(db: Db, shopId?: string): number | Promise<number>;
export function currentCatalogRevision(db: Db, shopId = DEFAULT_SHOP_ID): number | Promise<number> { return getCatalogRevision(db, shopId); }
