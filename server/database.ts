import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { SUPPORTED_CURRENCIES, type CurrencyCode } from "../shared/currency.js";
import type { FirestoreStore } from "./firestore-store.js";
import { seedProducts } from "./seed-data.js";
import {
  createShopRecord as createFirestoreShopRecord, getShopById as getFirestoreShopById,
  getShopBySlug as getFirestoreShopBySlug, getShopByOwnerAndSlug as getFirestoreShopByOwnerAndSlug,
  getCatalogRevision as getFirestoreCatalogRevision, incrementCatalogRevision as incrementFirestoreCatalogRevision,
} from "./firestore-shops.js";

type SqliteConnection = InstanceType<typeof Database>;
export type SqliteDb = SqliteConnection & { readonly backend: "sqlite" };
export type FirestoreDb = SqliteConnection & { readonly backend: "firestore"; readonly firestoreStore: FirestoreStore; readonly firestoreBrand: true };
export type Db = SqliteDb | FirestoreDb;
export const DEFAULT_SHOP_ID = "little-harbor-market";
export const DEFAULT_SHOP_SLUG = "little-harbor-market";
export const DEFAULT_SHOP_NAME = "Little Harbor Market";

export type Shop = {
  id: string;
  slug: string;
  ownerUserId: string | null;
  name: string;
  timeZone: string;
  currency: CurrencyCode;
  ownerSlug: string | null;
  status: "active" | "inactive";
};

const schema = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS shops (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL COLLATE NOCASE CHECK(length(slug) BETWEEN 3 AND 40),
  owner_user_id TEXT REFERENCES users(id),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
  time_zone TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  currency TEXT NOT NULL DEFAULT 'JPY' CHECK(currency IN ('AUD', 'CAD', 'EUR', 'GBP', 'JPY', 'SGD', 'USD')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
  catalog_revision INTEGER NOT NULL DEFAULT 1 CHECK(catalog_revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_user_id, slug)
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(email) <= 254),
  display_name TEXT NOT NULL DEFAULT 'Shop owner' CHECK(length(display_name) BETWEEN 1 AND 80),
  owner_slug TEXT NOT NULL UNIQUE CHECK(length(owner_slug) BETWEEN 3 AND 40),
  default_currency TEXT NOT NULL DEFAULT 'JPY' CHECK(default_currency IN ('AUD', 'CAD', 'EUR', 'GBP', 'JPY', 'SGD', 'USD')),
  password_hash TEXT NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 1 CHECK(email_verified IN (0, 1)),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS owner_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK(purpose IN ('verify_email', 'password_reset')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_owner_tokens_user_purpose ON owner_tokens(user_id, purpose);
CREATE TABLE IF NOT EXISTS owner_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_owner_sessions_expiry ON owner_sessions(expires_at);
CREATE TABLE IF NOT EXISTS shop_memberships (
  shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('owner', 'staff')),
  created_at TEXT NOT NULL,
  PRIMARY KEY(shop_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_shop_memberships_user ON shop_memberships(user_id, shop_id);
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL DEFAULT '${DEFAULT_SHOP_ID}' REFERENCES shops(id),
  name TEXT NOT NULL CHECK(length(name) <= 80),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 240),
  price_minor INTEGER NOT NULL CHECK(price_minor > 0),
  currency TEXT NOT NULL CHECK(currency IN ('AUD', 'CAD', 'EUR', 'GBP', 'JPY', 'SGD', 'USD')),
  stock_on_hand INTEGER NOT NULL CHECK(stock_on_hand >= 0),
  dietary_note TEXT NOT NULL DEFAULT '' CHECK(length(dietary_note) <= 160),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  updated_at TEXT NOT NULL,
  UNIQUE(shop_id, id)
);
CREATE TRIGGER IF NOT EXISTS products_currency_insert
BEFORE INSERT ON products WHEN NEW.currency <> (SELECT currency FROM shops WHERE id = NEW.shop_id)
BEGIN SELECT RAISE(ABORT, 'product currency must match shop currency'); END;
CREATE TRIGGER IF NOT EXISTS products_currency_update
BEFORE UPDATE OF currency, shop_id ON products WHEN NEW.currency <> (SELECT currency FROM shops WHERE id = NEW.shop_id)
BEGIN SELECT RAISE(ABORT, 'product currency must match shop currency'); END;
CREATE TABLE IF NOT EXISTS visitor_sessions (
  session_hash TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL DEFAULT '${DEFAULT_SHOP_ID}' REFERENCES shops(id),
  cart_version INTEGER NOT NULL DEFAULT 0 CHECK(cart_version >= 0),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(shop_id, session_hash)
);
CREATE INDEX IF NOT EXISTS idx_visitor_sessions_expires ON visitor_sessions(expires_at);
CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
INSERT OR IGNORE INTO app_meta(key, value) VALUES ('catalog_revision', 1);
CREATE TABLE IF NOT EXISTS cart_items (
  session_hash TEXT NOT NULL REFERENCES visitor_sessions(session_hash) ON DELETE CASCADE,
  shop_id TEXT NOT NULL DEFAULT '${DEFAULT_SHOP_ID}' REFERENCES shops(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 20),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(session_hash, product_id),
  FOREIGN KEY(shop_id, session_hash) REFERENCES visitor_sessions(shop_id, session_hash) ON DELETE CASCADE,
  FOREIGN KEY(shop_id, product_id) REFERENCES products(shop_id, id)
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL DEFAULT '${DEFAULT_SHOP_ID}' REFERENCES shops(id),
  session_hash TEXT NOT NULL REFERENCES visitor_sessions(session_hash),
  client_request_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  cart_version INTEGER NOT NULL,
  catalog_revision INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN (
    'creating_payment', 'create_unknown', 'create_failed', 'pending_payment',
    'capture_unknown', 'paid', 'cancelled', 'expired', 'collected',
    'refund_unknown', 'refunded'
  )),
  currency TEXT NOT NULL CHECK(currency IN ('AUD', 'CAD', 'EUR', 'GBP', 'JPY', 'SGD', 'USD')),
  total_minor INTEGER NOT NULL CHECK(total_minor > 0),
  paypal_create_request_id TEXT NOT NULL,
  paypal_capture_request_id TEXT NOT NULL,
  paypal_refund_request_id TEXT NOT NULL,
  paypal_order_id TEXT UNIQUE,
  paypal_capture_id TEXT UNIQUE,
  paypal_refund_id TEXT UNIQUE,
  pickup_code TEXT UNIQUE,
  expires_at TEXT NOT NULL,
  refund_restock_requested INTEGER CHECK(refund_restock_requested IN (0, 1)),
  restock_applied_at TEXT,
  create_attempt_started_at TEXT,
  captured_at TEXT,
  refunded_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(session_hash, client_request_key),
  UNIQUE(shop_id, id),
  FOREIGN KEY(shop_id, session_hash) REFERENCES visitor_sessions(shop_id, session_hash)
);
CREATE TRIGGER IF NOT EXISTS orders_currency_insert
BEFORE INSERT ON orders WHEN NEW.currency <> (SELECT currency FROM shops WHERE id = NEW.shop_id)
BEGIN SELECT RAISE(ABORT, 'order currency must match shop currency'); END;
CREATE TRIGGER IF NOT EXISTS orders_currency_update
BEFORE UPDATE OF currency, shop_id ON orders WHEN NEW.currency <> (SELECT currency FROM shops WHERE id = NEW.shop_id)
BEGIN SELECT RAISE(ABORT, 'order currency must match shop currency'); END;
CREATE TABLE IF NOT EXISTS order_items (
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  shop_id TEXT NOT NULL DEFAULT '${DEFAULT_SHOP_ID}' REFERENCES shops(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  display_name TEXT NOT NULL,
  unit_price_minor INTEGER NOT NULL CHECK(unit_price_minor > 0),
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 20),
  PRIMARY KEY(order_id, product_id),
  FOREIGN KEY(shop_id, order_id) REFERENCES orders(shop_id, id) ON DELETE CASCADE,
  FOREIGN KEY(shop_id, product_id) REFERENCES products(shop_id, id)
);
CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL DEFAULT '${DEFAULT_SHOP_ID}' REFERENCES shops(id),
  actor_user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  target_id TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS inventory_receipts (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  product_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 999),
  stock_on_hand INTEGER NOT NULL CHECK(stock_on_hand BETWEEN 0 AND 999),
  created_at TEXT NOT NULL,
  FOREIGN KEY(shop_id, product_id) REFERENCES products(shop_id, id)
);
CREATE INDEX IF NOT EXISTS idx_orders_session_created ON orders(session_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_state_expiry ON orders(state, expires_at);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);
`;

export function createDatabase(databasePath = ":memory:", seed = true): SqliteDb {
  if (databasePath !== ":memory:") fs.mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
  const db = new Database(databasePath) as SqliteDb;
  Object.defineProperty(db, "backend", { value: "sqlite", enumerable: false });
  db.pragma("foreign_keys = ON");
  if (databasePath !== ":memory:") db.pragma("journal_mode = WAL");
  db.exec(schema);
  ensureLegacyTenantColumns(db);
  backfillOwnerSlugs(db);
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO shops(id, slug, name, time_zone, currency, status, catalog_revision, created_at, updated_at)
    VALUES (?, ?, ?, 'Asia/Tokyo', 'JPY', 'active', 1, ?, ?)`).run(DEFAULT_SHOP_ID, DEFAULT_SHOP_SLUG, DEFAULT_SHOP_NAME, now, now);
  migrateCurrencyConstraints(db);
  createCurrencyTriggers(db);
  migrateLegacyCatalogRevision(db);
  if (seed) seedDefaultShop(db);
  return db;
}

function ensureLegacyTenantColumns(db: Db): void {
  const defaultValue = `TEXT NOT NULL DEFAULT '${DEFAULT_SHOP_ID}'`;
  for (const table of ["products", "visitor_sessions", "cart_items", "orders", "order_items", "admin_audit_log"]) {
    ensureColumn(db, table, "shop_id", defaultValue);
  }
  ensureColumn(db, "admin_audit_log", "actor_user_id", "TEXT");
  ensureColumn(db, "shops", "owner_user_id", "TEXT REFERENCES users(id)");
  ensureColumn(db, "users", "display_name", "TEXT NOT NULL DEFAULT 'Shop owner'");
  ensureColumn(db, "users", "owner_slug", "TEXT");
  ensureColumn(db, "users", "default_currency", "TEXT NOT NULL DEFAULT 'JPY'");
  ensureColumn(db, "users", "email_verified", "INTEGER NOT NULL DEFAULT 1 CHECK(email_verified IN (0, 1))");
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_products_shop_id_id ON products(shop_id, id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_visitor_sessions_shop_hash ON visitor_sessions(shop_id, session_hash);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_shop_id_id ON orders(shop_id, id);
    CREATE INDEX IF NOT EXISTS idx_products_shop_active ON products(shop_id, active, name);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_owner_slug ON users(owner_slug) WHERE owner_slug IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_shops_owner_slug ON shops(owner_user_id, slug);`);
}

function backfillOwnerSlugs(db: Db): void {
  const owners = db.prepare("SELECT id, email FROM users WHERE owner_slug IS NULL ORDER BY created_at, id").all() as Array<{ id: string; email: string }>;
  const exists = db.prepare("SELECT 1 FROM users WHERE owner_slug = ?");
  const update = db.prepare("UPDATE users SET owner_slug = ? WHERE id = ?");
  const transaction = db.transaction(() => {
    for (const owner of owners) {
      const localPart = owner.email.split("@", 1)[0] ?? "";
      const base = localPart.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
        .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || `owner-${owner.id.slice(0, 8)}`;
      let candidate = base.length >= 3 ? base : `${base}-owner`;
      let suffix = 2;
      while (exists.get(candidate)) {
        const ending = `-${suffix++}`;
        candidate = `${base.slice(0, 40 - ending.length)}${ending}`;
      }
      update.run(candidate, owner.id);
    }
  });
  transaction.immediate();
}

function migrateCurrencyConstraints(db: Db): void {
  const tableSql = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name IN ('shops', 'products', 'orders')")
    .all() as Array<{ name: string; sql: string | null }>;
  const oldShopUrlConstraint = tableSql.find(({ name }) => name === "shops")?.sql?.includes("COLLATE NOCASE UNIQUE") ?? false;
  const currencyChecksMissing = tableSql.some(({ sql }) => !sql?.includes("currency IN ("));
  if (!oldShopUrlConstraint && !currencyChecksMissing) return;

  const allowed = SUPPORTED_CURRENCIES.map((currency) => `'${currency}'`).join(", ");
  db.pragma("foreign_keys = OFF");
  db.pragma("legacy_alter_table = ON");
  try {
    db.exec(`DROP TRIGGER IF EXISTS products_currency_insert;
      DROP TRIGGER IF EXISTS products_currency_update;
      DROP TRIGGER IF EXISTS orders_currency_insert;
      DROP TRIGGER IF EXISTS orders_currency_update;`);
    db.exec("BEGIN IMMEDIATE");
    db.exec(`
      CREATE TABLE shops__currency (
        id TEXT PRIMARY KEY, slug TEXT NOT NULL COLLATE NOCASE CHECK(length(slug) BETWEEN 3 AND 40),
        owner_user_id TEXT REFERENCES users(id),
        name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80), time_zone TEXT NOT NULL DEFAULT 'Asia/Tokyo',
        currency TEXT NOT NULL DEFAULT 'JPY' CHECK(currency IN (${allowed})),
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
        catalog_revision INTEGER NOT NULL DEFAULT 1 CHECK(catalog_revision > 0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(owner_user_id, slug)
      );
      INSERT INTO shops__currency(id, slug, owner_user_id, name, time_zone, currency, status, catalog_revision, created_at, updated_at)
        SELECT id, slug, COALESCE(owner_user_id,
          (SELECT user_id FROM shop_memberships WHERE shop_id = shops.id AND role = 'owner' ORDER BY created_at LIMIT 1)),
          name, time_zone, currency, status, catalog_revision, created_at, updated_at FROM shops;
      DROP TABLE shops;
      ALTER TABLE shops__currency RENAME TO shops;

      CREATE TABLE products__currency (
        id TEXT PRIMARY KEY, shop_id TEXT NOT NULL DEFAULT '${DEFAULT_SHOP_ID}' REFERENCES shops(id),
        name TEXT NOT NULL CHECK(length(name) <= 80), description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 240),
        price_minor INTEGER NOT NULL CHECK(price_minor > 0), currency TEXT NOT NULL CHECK(currency IN (${allowed})),
        stock_on_hand INTEGER NOT NULL CHECK(stock_on_hand >= 0), dietary_note TEXT NOT NULL DEFAULT '' CHECK(length(dietary_note) <= 160),
        active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)), updated_at TEXT NOT NULL, UNIQUE(shop_id, id)
      );
      INSERT INTO products__currency(id, shop_id, name, description, price_minor, currency, stock_on_hand, dietary_note, active, updated_at)
        SELECT id, shop_id, name, description, price_minor, currency, stock_on_hand, dietary_note, active, updated_at FROM products;
      DROP TABLE products;
      ALTER TABLE products__currency RENAME TO products;

      CREATE TABLE orders__currency (
        id TEXT PRIMARY KEY, shop_id TEXT NOT NULL DEFAULT '${DEFAULT_SHOP_ID}' REFERENCES shops(id),
        session_hash TEXT NOT NULL REFERENCES visitor_sessions(session_hash), client_request_key TEXT NOT NULL,
        request_fingerprint TEXT NOT NULL, cart_version INTEGER NOT NULL, catalog_revision INTEGER NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('creating_payment', 'create_unknown', 'create_failed', 'pending_payment', 'capture_unknown', 'paid', 'cancelled', 'expired', 'collected', 'refund_unknown', 'refunded')),
        currency TEXT NOT NULL CHECK(currency IN (${allowed})), total_minor INTEGER NOT NULL CHECK(total_minor > 0),
        paypal_create_request_id TEXT NOT NULL, paypal_capture_request_id TEXT NOT NULL, paypal_refund_request_id TEXT NOT NULL,
        paypal_order_id TEXT UNIQUE, paypal_capture_id TEXT UNIQUE, paypal_refund_id TEXT UNIQUE, pickup_code TEXT UNIQUE,
        expires_at TEXT NOT NULL, refund_restock_requested INTEGER CHECK(refund_restock_requested IN (0, 1)), restock_applied_at TEXT,
        create_attempt_started_at TEXT, captured_at TEXT, refunded_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(session_hash, client_request_key), UNIQUE(shop_id, id),
        FOREIGN KEY(shop_id, session_hash) REFERENCES visitor_sessions(shop_id, session_hash)
      );
      INSERT INTO orders__currency(id, shop_id, session_hash, client_request_key, request_fingerprint, cart_version, catalog_revision,
        state, currency, total_minor, paypal_create_request_id, paypal_capture_request_id, paypal_refund_request_id,
        paypal_order_id, paypal_capture_id, paypal_refund_id, pickup_code, expires_at, refund_restock_requested,
        restock_applied_at, create_attempt_started_at, captured_at, refunded_at, created_at, updated_at)
        SELECT id, shop_id, session_hash, client_request_key, request_fingerprint, cart_version, catalog_revision,
          state, currency, total_minor, paypal_create_request_id, paypal_capture_request_id, paypal_refund_request_id,
          paypal_order_id, paypal_capture_id, paypal_refund_id, pickup_code, expires_at, refund_restock_requested,
          restock_applied_at, create_attempt_started_at, captured_at, refunded_at, created_at, updated_at FROM orders;
      DROP TABLE orders;
      ALTER TABLE orders__currency RENAME TO orders;
      CREATE INDEX idx_products_shop_active ON products(shop_id, active, name);
      CREATE INDEX idx_orders_session_created ON orders(session_hash, created_at DESC);
      CREATE INDEX idx_orders_state_expiry ON orders(state, expires_at);
    `);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.pragma("legacy_alter_table = OFF");
    db.pragma("foreign_keys = ON");
  }
  const violations = db.pragma("foreign_key_check") as Array<Record<string, unknown>>;
  if (violations.length) throw new Error(`Currency migration left invalid references: ${violations.map((row) => `${String(row.table)}->${String(row.parent)}`).join(", ")}`);
}

function createCurrencyTriggers(db: Db): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_shops_owner_slug ON shops(owner_user_id, slug);
    CREATE INDEX IF NOT EXISTS idx_shops_slug ON shops(slug);
    CREATE INDEX IF NOT EXISTS idx_orders_shop_captured ON orders(shop_id, captured_at);
    CREATE TRIGGER IF NOT EXISTS products_currency_insert BEFORE INSERT ON products
      WHEN NEW.currency <> (SELECT currency FROM shops WHERE id = NEW.shop_id)
      BEGIN SELECT RAISE(ABORT, 'product currency must match shop currency'); END;
    CREATE TRIGGER IF NOT EXISTS products_currency_update BEFORE UPDATE OF currency, shop_id ON products
      WHEN NEW.currency <> (SELECT currency FROM shops WHERE id = NEW.shop_id)
      BEGIN SELECT RAISE(ABORT, 'product currency must match shop currency'); END;
    CREATE TRIGGER IF NOT EXISTS orders_currency_insert BEFORE INSERT ON orders
      WHEN NEW.currency <> (SELECT currency FROM shops WHERE id = NEW.shop_id)
      BEGIN SELECT RAISE(ABORT, 'order currency must match shop currency'); END;
    CREATE TRIGGER IF NOT EXISTS orders_currency_update BEFORE UPDATE OF currency, shop_id ON orders
      WHEN NEW.currency <> (SELECT currency FROM shops WHERE id = NEW.shop_id)
      BEGIN SELECT RAISE(ABORT, 'order currency must match shop currency'); END;
  `);
}

function ensureColumn(db: Db, table: string, column: string, definition: string): void {
  const found = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!found.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function migrateLegacyCatalogRevision(db: Db): void {
  const legacy = db.prepare("SELECT value FROM app_meta WHERE key = 'catalog_revision'").get() as { value?: number } | undefined;
  if (legacy?.value) db.prepare("UPDATE shops SET catalog_revision = MAX(catalog_revision, ?) WHERE id = ?").run(legacy.value, DEFAULT_SHOP_ID);
}

function seedDefaultShop(db: Db): void {
  const insert = db.prepare(`INSERT OR IGNORE INTO products
    (id, shop_id, name, description, price_minor, currency, stock_on_hand, dietary_note, active, updated_at)
    VALUES (?, ?, ?, ?, ?, 'JPY', ?, ?, 1, ?)`);
  const now = new Date().toISOString();
  const transaction = db.transaction(() => {
    for (const product of seedProducts) {
      insert.run(product.id, DEFAULT_SHOP_ID, product.name, product.description, product.price, product.stock, product.note, now);
    }
  });
  transaction();
}

export function createShopRecord(db: FirestoreDb, input: { id?: string; slug: string; name: string; timeZone?: string; currency?: CurrencyCode; ownerUserId?: string }): Promise<Shop>;
export function createShopRecord(db: SqliteDb, input: { id?: string; slug: string; name: string; timeZone?: string; currency?: CurrencyCode; ownerUserId?: string }): Shop;
export function createShopRecord(db: Db, input: { id?: string; slug: string; name: string; timeZone?: string; currency?: CurrencyCode; ownerUserId?: string }): Shop | Promise<Shop>;
export function createShopRecord(db: Db, input: { id?: string; slug: string; name: string; timeZone?: string; currency?: CurrencyCode; ownerUserId?: string }): Shop | Promise<Shop> {
  if ((db as FirestoreDb).firestoreBrand) return createFirestoreShopRecord(db as FirestoreDb, input);
  const id = input.id ?? randomUUID();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO shops
    (id, slug, owner_user_id, name, time_zone, currency, status, catalog_revision, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', 1, ?, ?)`)
    .run(id, input.slug, input.ownerUserId ?? null, input.name, input.timeZone ?? "Asia/Tokyo", input.currency ?? "JPY", now, now);
  return getShopById(db as SqliteDb, id)!;
}

export function getShopById(db: FirestoreDb, id: string): Promise<Shop | undefined>;
export function getShopById(db: SqliteDb, id: string): Shop | undefined;
export function getShopById(db: Db, id: string): Shop | undefined | Promise<Shop | undefined>;
export function getShopById(db: Db, id: string): Shop | undefined | Promise<Shop | undefined> {
  if ((db as FirestoreDb).firestoreBrand) return getFirestoreShopById(db as FirestoreDb, id);
  const row = db.prepare(`SELECT shops.id, shops.slug, shops.owner_user_id, shops.name, shops.time_zone, shops.currency, shops.status,
      users.owner_slug FROM shops LEFT JOIN users ON users.id = shops.owner_user_id WHERE shops.id = ?`).get(id) as ShopRow | undefined;
  return row ? toShop(row) : undefined;
}

export function getShopBySlug(db: FirestoreDb, slug: string): Promise<Shop | undefined>;
export function getShopBySlug(db: SqliteDb, slug: string): Shop | undefined;
export function getShopBySlug(db: Db, slug: string): Shop | undefined | Promise<Shop | undefined>;
export function getShopBySlug(db: Db, slug: string): Shop | undefined | Promise<Shop | undefined> {
  if ((db as FirestoreDb).firestoreBrand) return getFirestoreShopBySlug(db as FirestoreDb, slug);
  const row = db.prepare(`SELECT shops.id, shops.slug, shops.owner_user_id, shops.name, shops.time_zone, shops.currency, shops.status,
      users.owner_slug FROM shops LEFT JOIN users ON users.id = shops.owner_user_id
    WHERE shops.slug = ? AND (SELECT COUNT(*) FROM shops AS matching WHERE matching.slug = ?) = 1`)
    .get(slug, slug) as ShopRow | undefined;
  return row ? toShop(row) : undefined;
}

type ShopRow = { id: string; slug: string; owner_user_id: string | null; name: string; time_zone: string; currency: CurrencyCode; status: "active" | "inactive"; owner_slug: string | null };
function toShop(row: ShopRow): Shop {
  return { id: row.id, slug: row.slug, ownerUserId: row.owner_user_id, name: row.name, timeZone: row.time_zone, currency: row.currency, status: row.status, ownerSlug: row.owner_slug };
}

export function getShopByOwnerAndSlug(db: FirestoreDb, ownerSlug: string, slug: string): Promise<Shop | undefined>;
export function getShopByOwnerAndSlug(db: SqliteDb, ownerSlug: string, slug: string): Shop | undefined;
export function getShopByOwnerAndSlug(db: Db, ownerSlug: string, slug: string): Shop | undefined | Promise<Shop | undefined>;
export function getShopByOwnerAndSlug(db: Db, ownerSlug: string, slug: string): Shop | undefined | Promise<Shop | undefined> {
  if ((db as FirestoreDb).firestoreBrand) return getFirestoreShopByOwnerAndSlug(db as FirestoreDb, ownerSlug, slug);
  const row = db.prepare(`SELECT shops.id, shops.slug, shops.owner_user_id, shops.name, shops.time_zone, shops.currency, shops.status,
      users.owner_slug FROM shops JOIN users ON users.id = shops.owner_user_id
      WHERE users.owner_slug = ? AND shops.slug = ?`)
    .get(ownerSlug, slug) as ShopRow | undefined;
  return row ? toShop(row) : undefined;
}

export function getCatalogRevision(db: FirestoreDb, shopId?: string): Promise<number>;
export function getCatalogRevision(db: SqliteDb, shopId?: string): number;
export function getCatalogRevision(db: Db, shopId?: string): number | Promise<number>;
export function getCatalogRevision(db: Db, shopId = DEFAULT_SHOP_ID): number | Promise<number> {
  if ((db as FirestoreDb).firestoreBrand) return getFirestoreCatalogRevision(db as FirestoreDb, shopId);
  const result = db.prepare("SELECT catalog_revision FROM shops WHERE id = ?").get(shopId) as { catalog_revision: number };
  return result.catalog_revision;
}

export function incrementCatalogRevision(db: FirestoreDb, shopId?: string): Promise<number>;
export function incrementCatalogRevision(db: SqliteDb, shopId?: string): number;
export function incrementCatalogRevision(db: Db, shopId?: string): number | Promise<number>;
export function incrementCatalogRevision(db: Db, shopId = DEFAULT_SHOP_ID): number | Promise<number> {
  if ((db as FirestoreDb).firestoreBrand) return incrementFirestoreCatalogRevision(db as FirestoreDb, shopId);
  db.prepare("UPDATE shops SET catalog_revision = catalog_revision + 1, updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), shopId);
  return getCatalogRevision(db as SqliteDb, shopId);
}

export function createTransaction<T>(db: Db, work: () => T): () => T {
  return db.transaction(work).immediate;
}
