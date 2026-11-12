import type { Db, FirestoreDb, SqliteDb } from "./database.js";
import { DEFAULT_SHOP_ID } from "./database.js";
import { listProducts } from "./inventory.js";
import { listOrderLines, type OrderRow } from "./order-state.js";
import * as firestoreAnalytics from "./firestore-analytics.js";
import { dailySalesTrend } from "./sales-trend.js";

function wallClockParts(date: Date, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, Number(value)]));
  return { year: values.year!, month: values.month!, day: values.day!, hour: values.hour!, minute: values.minute!, second: values.second! };
}

function utcForWallTime(year: number, month: number, day: number, timeZone: string): Date {
  const target = Date.UTC(year, month - 1, day, 0, 0, 0);
  let guess = target;
  for (let i = 0; i < 3; i += 1) {
    const wall = wallClockParts(new Date(guess), timeZone);
    const represented = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
    guess += target - represented;
  }
  return new Date(guess);
}

export function eventDayBounds(now: Date, timeZone: string): { start: string; end: string } {
  const day = wallClockParts(now, timeZone);
  const next = new Date(Date.UTC(day.year, day.month - 1, day.day + 1));
  return {
    start: utcForWallTime(day.year, day.month, day.day, timeZone).toISOString(),
    end: utcForWallTime(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timeZone).toISOString(),
  };
}

export function eventDayWindowBounds(now: Date, timeZone: string, days: number): { start: string; end: string } {
  const day = wallClockParts(now, timeZone);
  const firstDay = new Date(Date.UTC(day.year, day.month - 1, day.day - Math.max(1, Math.floor(days)) + 1));
  return {
    start: utcForWallTime(firstDay.getUTCFullYear(), firstDay.getUTCMonth() + 1, firstDay.getUTCDate(), timeZone).toISOString(),
    end: now.toISOString(),
  };
}

export type OrganizerFactsOptions = { includeSalesTrend?: boolean };

export function organizerFacts(db: FirestoreDb, timeZone: string, now?: Date, shopId?: string, options?: OrganizerFactsOptions): ReturnType<typeof firestoreAnalytics.organizerFacts>;
export function organizerFacts(db: SqliteDb, timeZone: string, now?: Date, shopId?: string, options?: OrganizerFactsOptions): ReturnType<typeof organizerFactsSqlite>;
export function organizerFacts(db: Db, timeZone: string, now?: Date, shopId?: string, options?: OrganizerFactsOptions): ReturnType<typeof organizerFactsSqlite> | ReturnType<typeof firestoreAnalytics.organizerFacts>;
export function organizerFacts(db: Db, timeZone: string, now = new Date(), shopId = DEFAULT_SHOP_ID, options: OrganizerFactsOptions = {}) {
  if ((db as FirestoreDb).firestoreBrand) return firestoreAnalytics.organizerFacts(db as FirestoreDb, timeZone, now, shopId, options);
  return organizerFactsSqlite(db as SqliteDb, timeZone, now, shopId, options);
}

function organizerFactsSqlite(db: SqliteDb, timeZone: string, now = new Date(), shopId = DEFAULT_SHOP_ID, options: OrganizerFactsOptions = {}) {
  const bounds = eventDayBounds(now, timeZone);
  const localDay = wallClockParts(now, timeZone);
  const shop = db.prepare("SELECT currency FROM shops WHERE id = ?").get(shopId) as { currency: string };
  const metrics = db.prepare(`SELECT
      COALESCE(SUM(total_minor), 0) AS gross_captured_minor,
      COALESCE(SUM(CASE WHEN state <> 'refunded' THEN total_minor ELSE 0 END), 0) AS net_captured_minor,
      SUM(CASE WHEN state IN ('paid', 'collected', 'refund_unknown') THEN 1 ELSE 0 END) AS net_order_count,
      SUM(CASE WHEN state = 'refunded' THEN 1 ELSE 0 END) AS refunded_order_count
    FROM orders WHERE shop_id = ? AND captured_at >= ? AND captured_at < ?
      AND state IN ('paid', 'collected', 'refund_unknown', 'refunded')`).get(shopId, bounds.start, bounds.end) as {
        gross_captured_minor: number; net_captured_minor: number; net_order_count: number | null; refunded_order_count: number | null;
      };
  const products = listProducts(db, shopId).map((product) => ({
    id: product.id, name: product.name, stockOnHand: product.stockOnHand,
    reserved: product.reserved, available: product.available, priceMinor: product.priceMinor,
  }));
  const soldRows = db.prepare(`SELECT oi.product_id AS id, oi.display_name AS name, SUM(oi.quantity) AS units_sold
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE o.shop_id = ? AND oi.shop_id = ? AND o.captured_at >= ? AND o.captured_at < ? AND o.state IN ('paid', 'collected', 'refund_unknown')
    GROUP BY oi.product_id ORDER BY units_sold DESC, name COLLATE NOCASE`).all(shopId, shopId, bounds.start, bounds.end) as Array<{ id: string; name: string; units_sold: number }>;
  const salesWindow = options.includeSalesTrend ? eventDayWindowBounds(now, timeZone, 7) : null;
  const unitsSoldLast7Days = salesWindow ? db.prepare(`SELECT oi.product_id AS id, oi.display_name AS name, SUM(oi.quantity) AS units_sold
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE o.shop_id = ? AND oi.shop_id = ? AND o.captured_at >= ? AND o.captured_at < ? AND o.state IN ('paid', 'collected', 'refund_unknown')
    GROUP BY oi.product_id ORDER BY units_sold DESC, name COLLATE NOCASE`).all(shopId, shopId, salesWindow.start, salesWindow.end) as Array<{ id: string; name: string; units_sold: number }> : [];
  const salesTrend = salesWindow ? dailySalesTrend(now, timeZone, 7, db.prepare(`SELECT captured_at AS capturedAt, total_minor AS totalMinor, state
    FROM orders WHERE shop_id = ? AND captured_at >= ? AND captured_at < ?`).all(shopId, salesWindow.start, salesWindow.end) as Array<{ capturedAt: string; totalMinor: number; state: string }>) : [];
  const lowStock = products.filter((product) => product.available <= 5);
  return {
    date: `${localDay.year}-${String(localDay.month).padStart(2, "0")}-${String(localDay.day).padStart(2, "0")}`, timeZone, currency: shop.currency,
    grossCapturedMinor: metrics.gross_captured_minor,
    netCapturedMinor: metrics.net_captured_minor,
    netOrderCount: metrics.net_order_count ?? 0,
    refundedOrderCount: metrics.refunded_order_count ?? 0,
    lowStockCount: lowStock.length,
    lowStockItems: lowStock,
    products,
    unitsSold: soldRows,
    unitsSoldLast7Days,
    salesTrend,
  };
}

export function organizerSummary(db: FirestoreDb, timeZone: string, shopId?: string): ReturnType<typeof firestoreAnalytics.organizerSummary>;
export function organizerSummary(db: SqliteDb, timeZone: string, shopId?: string): ReturnType<typeof organizerSummarySqlite>;
export function organizerSummary(db: Db, timeZone: string, shopId?: string): ReturnType<typeof organizerSummarySqlite> | ReturnType<typeof firestoreAnalytics.organizerSummary>;
export function organizerSummary(db: Db, timeZone: string, shopId = DEFAULT_SHOP_ID) {
  if ((db as FirestoreDb).firestoreBrand) return firestoreAnalytics.organizerSummary(db as FirestoreDb, timeZone, shopId);
  return organizerSummarySqlite(db as SqliteDb, timeZone, shopId);
}

function organizerSummarySqlite(db: SqliteDb, timeZone: string, shopId = DEFAULT_SHOP_ID) {
  const facts = organizerFacts(db, timeZone, new Date(), shopId);
  const rows = db.prepare("SELECT * FROM orders WHERE shop_id = ? ORDER BY created_at DESC LIMIT 50").all(shopId) as OrderRow[];
  const orders = rows.map((order) => ({
    orderId: order.id, state: order.state, totalMinor: order.total_minor, currency: order.currency,
    ...(order.state === "paid" || order.state === "collected" ? { pickupCode: order.pickup_number ?? order.pickup_code } : {}),
    createdAt: order.created_at,
    items: listOrderLines(db, order.id, shopId).map((item) => ({ name: item.display_name, quantity: item.quantity })),
  }));
  return {
    metrics: {
      grossSalesMinor: facts.grossCapturedMinor, netSalesMinor: facts.netCapturedMinor,
      paidOrderCount: facts.netOrderCount, lowStockCount: facts.lowStockCount,
    },
    orders,
    products: listProducts(db, shopId, false).map(({ active: _active, ...product }) => product),
  };
}
