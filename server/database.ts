import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

export type Db = InstanceType<typeof Database>;
export const DEFAULT_SHOP_ID = "little-harbor-market";
export const DEFAULT_SHOP_SLUG = "little-harbor-market";
export const DEFAULT_SHOP_NAME = "Little Harbor Market";

export type Shop = {
  id: string;
  slug: string;
  name: string;
  timeZone: string;
  currency: "JPY";
  status: "active" | "inactive";
};

const seedProducts = [
  { id: "yakisoba", name: "Yakisoba", description: "Savory market noodles with vegetables.", price: 750, stock: 24, note: "Contains wheat and soy." },
  { id: "taiyaki", name: "Taiyaki", description: "Warm fish-shaped cake with sweet red bean filling.", price: 450, stock: 15, note: "Contains wheat and egg." },
  { id: "iced-tea", name: "Iced tea", description: "Chilled, unsweetened black tea.", price: 300, stock: 30, note: "No listed allergens." },
  { id: "ramune", name: "Ramune", description: "A crisp, lightly sweet sparkling drink.", price: 350, stock: 18, note: "No listed allergens." },
  { id: "onigiri", name: "Grilled onigiri", description: "Rice grilled with a light soy glaze.", price: 400, stock: 20, note: "Contains soy." },
  { id: "mikan-jelly", name: "Mikan jelly", description: "A cool mandarin orange dessert.", price: 500, stock: 12, note: "No listed allergens." },
];

const schema = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS shops (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(slug) BETWEEN 3 AND 40),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
  time_zone TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  currency TEXT NOT NULL DEFAULT 'JPY' CHECK(currency = 'JPY'),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
  catalog_revision INTEGER NOT NULL DEFAULT 1 CHECK(catalog_revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(email) <= 254),
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
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
  currency TEXT NOT NULL CHECK(currency = 'JPY'),
  stock_on_hand INTEGER NOT NULL CHECK(stock_on_hand >= 0),
  dietary_note TEXT NOT NULL DEFAULT '' CHECK(length(dietary_note) <= 160),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  updated_at TEXT NOT NULL,
  UNIQUE(shop_id, id)
);
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
  currency TEXT NOT NULL CHECK(currency = 'JPY'),
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
CREATE INDEX IF NOT EXISTS idx_orders_session_created ON orders(session_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_state_expiry ON orders(state, expires_at);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);
`;

export function createDatabase(databasePath = ":memory:", seed = true): Db {
  if (databasePath !== ":memory:") fs.mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
  const db = new Database(databasePath);
  db.pragma("foreign_keys = ON");
  if (databasePath !== ":memory:") db.pragma("journal_mode = WAL");
  db.exec(schema);
  ensureLegacyTenantColumns(db);
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO shops(id, slug, name, time_zone, currency, status, catalog_revision, created_at, updated_at)
    VALUES (?, ?, ?, 'Asia/Tokyo', 'JPY', 'active', 1, ?, ?)`).run(DEFAULT_SHOP_ID, DEFAULT_SHOP_SLUG, DEFAULT_SHOP_NAME, now, now);
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
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_products_shop_id_id ON products(shop_id, id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_visitor_sessions_shop_hash ON visitor_sessions(shop_id, session_hash);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_shop_id_id ON orders(shop_id, id);
    CREATE INDEX IF NOT EXISTS idx_products_shop_active ON products(shop_id, active, name);`);
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

export function createShopRecord(db: Db, input: { id?: string; slug: string; name: string; timeZone?: string }): Shop {
  const id = input.id ?? randomUUID();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO shops(id, slug, name, time_zone, currency, status, catalog_revision, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'JPY', 'active', 1, ?, ?)`)
    .run(id, input.slug, input.name, input.timeZone ?? "Asia/Tokyo", now, now);
  const templates = db.prepare(`SELECT name, description, price_minor, currency, stock_on_hand, dietary_note, active
    FROM products WHERE shop_id = ? ORDER BY id`).all(DEFAULT_SHOP_ID) as Array<{
      name: string; description: string; price_minor: number; currency: string;
      stock_on_hand: number; dietary_note: string; active: number;
    }>;
  const insert = db.prepare(`INSERT INTO products
    (id, shop_id, name, description, price_minor, currency, stock_on_hand, dietary_note, active, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const product of templates) {
    insert.run(randomUUID(), id, product.name, product.description, product.price_minor, product.currency,
      product.stock_on_hand, product.dietary_note, product.active, now);
  }
  return getShopById(db, id)!;
}

export function getShopById(db: Db, id: string): Shop | undefined {
  const row = db.prepare("SELECT id, slug, name, time_zone, currency, status FROM shops WHERE id = ?")
    .get(id) as { id: string; slug: string; name: string; time_zone: string; currency: "JPY"; status: "active" | "inactive" } | undefined;
  return row ? { id: row.id, slug: row.slug, name: row.name, timeZone: row.time_zone, currency: row.currency, status: row.status } : undefined;
}

export function getShopBySlug(db: Db, slug: string): Shop | undefined {
  const row = db.prepare("SELECT id, slug, name, time_zone, currency, status FROM shops WHERE slug = ?")
    .get(slug) as { id: string; slug: string; name: string; time_zone: string; currency: "JPY"; status: "active" | "inactive" } | undefined;
  return row ? { id: row.id, slug: row.slug, name: row.name, timeZone: row.time_zone, currency: row.currency, status: row.status } : undefined;
}

export function getCatalogRevision(db: Db, shopId = DEFAULT_SHOP_ID): number {
  const result = db.prepare("SELECT catalog_revision FROM shops WHERE id = ?").get(shopId) as { catalog_revision: number };
  return result.catalog_revision;
}

export function incrementCatalogRevision(db: Db, shopId = DEFAULT_SHOP_ID): number {
  db.prepare("UPDATE shops SET catalog_revision = catalog_revision + 1, updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), shopId);
  return getCatalogRevision(db, shopId);
}

export function createTransaction<T>(db: Db, work: () => T): () => T {
  return db.transaction(work).immediate;
}
