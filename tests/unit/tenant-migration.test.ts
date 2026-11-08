import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { createDatabase, DEFAULT_SHOP_ID } from "../../server/database.js";

test("single-shop databases migrate old rows into the default tenant", () => {
  const directory = mkdtempSync(join(tmpdir(), "yatalk-tenant-migration-"));
  const databasePath = join(directory, "legacy.sqlite");
  const legacy = new Database(databasePath);
  legacy.exec(`
    CREATE TABLE products (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      price_minor INTEGER NOT NULL, currency TEXT NOT NULL, stock_on_hand INTEGER NOT NULL,
      dietary_note TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL);
    CREATE TABLE visitor_sessions (session_hash TEXT PRIMARY KEY, cart_version INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE app_meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
    CREATE TABLE cart_items (session_hash TEXT NOT NULL, product_id TEXT NOT NULL, quantity INTEGER NOT NULL,
      updated_at TEXT NOT NULL, PRIMARY KEY(session_hash, product_id));
    CREATE TABLE orders (id TEXT PRIMARY KEY, session_hash TEXT NOT NULL, client_request_key TEXT NOT NULL,
      request_fingerprint TEXT NOT NULL, cart_version INTEGER NOT NULL, catalog_revision INTEGER NOT NULL,
      state TEXT NOT NULL, currency TEXT NOT NULL, total_minor INTEGER NOT NULL,
      paypal_create_request_id TEXT NOT NULL, paypal_capture_request_id TEXT NOT NULL,
      paypal_refund_request_id TEXT NOT NULL, paypal_order_id TEXT UNIQUE, paypal_capture_id TEXT UNIQUE,
      paypal_refund_id TEXT UNIQUE, pickup_code TEXT UNIQUE, expires_at TEXT NOT NULL,
      refund_restock_requested INTEGER, restock_applied_at TEXT, create_attempt_started_at TEXT,
      captured_at TEXT, refunded_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(session_hash, client_request_key));
    CREATE TABLE order_items (order_id TEXT NOT NULL, product_id TEXT NOT NULL, display_name TEXT NOT NULL,
      unit_price_minor INTEGER NOT NULL, quantity INTEGER NOT NULL, PRIMARY KEY(order_id, product_id));
    CREATE TABLE webhook_events (id TEXT PRIMARY KEY, event_type TEXT NOT NULL, processed_at TEXT NOT NULL);
    CREATE TABLE admin_audit_log (id TEXT PRIMARY KEY, action TEXT NOT NULL, target_id TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
  `);
  legacy.prepare(`INSERT INTO products(id, name, description, price_minor, currency, stock_on_hand, dietary_note, active, updated_at)
    VALUES ('legacy-product', 'Legacy item', '', 125, 'JPY', 4, '', 1, ?)`).run(new Date().toISOString());
  legacy.prepare("INSERT INTO visitor_sessions(session_hash, cart_version, expires_at, created_at) VALUES ('legacy-session', 2, ?, ?)")
    .run(new Date(Date.now() + 60_000).toISOString(), new Date().toISOString());
  legacy.prepare("INSERT INTO app_meta(key, value) VALUES ('catalog_revision', 7)").run();
  legacy.close();

  let db: ReturnType<typeof createDatabase> | undefined;
  try {
    db = createDatabase(databasePath, false);
    const product = db.prepare("SELECT shop_id FROM products WHERE id = 'legacy-product'").get() as { shop_id: string };
    const session = db.prepare("SELECT shop_id, cart_version FROM visitor_sessions WHERE session_hash = 'legacy-session'")
      .get() as { shop_id: string; cart_version: number };
    const shop = db.prepare("SELECT catalog_revision FROM shops WHERE id = ?").get(DEFAULT_SHOP_ID) as { catalog_revision: number };
    assert.equal(product.shop_id, DEFAULT_SHOP_ID);
    assert.equal((db.prepare("SELECT currency FROM products WHERE id = 'legacy-product'").get() as { currency: string }).currency, "JPY");
    assert.equal(session.shop_id, DEFAULT_SHOP_ID);
    assert.equal(session.cart_version, 2);
    assert.equal(shop.catalog_revision, 7);
    assert.deepEqual(db.pragma("foreign_key_check"), []);
  } finally {
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
