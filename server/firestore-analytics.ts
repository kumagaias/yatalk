import type { FirestoreDb } from "./database.js";
import { DEFAULT_SHOP_ID } from "./database.js";
import type { FirestoreDocument } from "./firestore-store.js";
import { listProducts } from "./inventory.js";
import type { OrderRow } from "./order-state.js";
import { eventDayBounds, eventDayWindowBounds, type OrganizerFactsOptions } from "./analytics.js";

type ShopDoc = FirestoreDocument & { currency: string };
type LineDoc = FirestoreDocument & { product_id: string; display_name: string; quantity: number };
type OrderDoc = FirestoreDocument & {
  id: string; shopId: string; state: OrderRow["state"]; totalMinor: number; capturedAt: string | null;
  createdAt: string; expiresAt: string; pickupCode: string | null; pickupNumber?: string | null; currency: string; items: LineDoc[];
};

function wallClockParts(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, Number(value)]));
  return { year: values.year!, month: values.month!, day: values.day! };
}

export async function organizerFacts(db: FirestoreDb, timeZone: string, now = new Date(), shopId = DEFAULT_SHOP_ID, options: OrganizerFactsOptions = {}) {
  const bounds = eventDayBounds(now, timeZone);
  const salesWindow = options.includeSalesTrend ? eventDayWindowBounds(now, timeZone, 7) : null;
  const localDay = wallClockParts(now, timeZone);
  const [shop, orders, products] = await Promise.all([
    db.firestoreStore.get<ShopDoc>("shops", shopId),
    db.firestoreStore.query<OrderDoc>("orders", [
      { field: "shopId", op: "==", value: shopId },
      { field: "capturedAt", op: ">=", value: salesWindow?.start ?? bounds.start },
      { field: "capturedAt", op: "<", value: salesWindow?.end ?? bounds.end },
    ]),
    listProducts(db, shopId),
  ]);
  if (!shop) throw new Error("Shop was not found");
  const captured = orders.filter((order) => order.capturedAt && order.capturedAt >= (salesWindow?.start ?? bounds.start) && order.capturedAt < (salesWindow?.end ?? bounds.end) &&
    ["paid", "collected", "refund_unknown", "refunded"].includes(order.state));
  const capturedToday = captured.filter((order) => order.capturedAt! >= bounds.start && order.capturedAt! < bounds.end);
  const grossCapturedMinor = capturedToday.reduce((sum, order) => sum + order.totalMinor, 0);
  const netCapturedMinor = capturedToday.filter((order) => order.state !== "refunded").reduce((sum, order) => sum + order.totalMinor, 0);
  const units = new Map<string, { id: string; name: string; units_sold: number }>();
  const weeklyUnits = new Map<string, { id: string; name: string; units_sold: number }>();
  const salesOrders = captured.filter((item) => ["paid", "collected", "refund_unknown"].includes(item.state));
  for (const order of salesOrders) {
    for (const line of order.items ?? []) {
      const weekSold = weeklyUnits.get(line.product_id) ?? { id: line.product_id, name: line.display_name, units_sold: 0 };
      weekSold.units_sold += line.quantity;
      weeklyUnits.set(line.product_id, weekSold);
      if (order.capturedAt! >= bounds.start && order.capturedAt! < bounds.end) {
        const daySold = units.get(line.product_id) ?? { id: line.product_id, name: line.display_name, units_sold: 0 };
        daySold.units_sold += line.quantity;
        units.set(line.product_id, daySold);
      }
    }
  }
  const lowStockItems = products.filter((product) => product.available <= 5);
  return {
    date: `${localDay.year}-${String(localDay.month).padStart(2, "0")}-${String(localDay.day).padStart(2, "0")}`,
    timeZone, currency: shop.currency, grossCapturedMinor, netCapturedMinor,
    netOrderCount: capturedToday.filter((order) => ["paid", "collected", "refund_unknown"].includes(order.state)).length,
    refundedOrderCount: capturedToday.filter((order) => order.state === "refunded").length,
    lowStockCount: lowStockItems.length,
    lowStockItems: lowStockItems.map(({ id, name, stockOnHand, reserved, available, priceMinor }) => ({ id, name, stockOnHand, reserved, available, priceMinor })),
    products: products.map(({ id, name, stockOnHand, reserved, available, priceMinor }) => ({ id, name, stockOnHand, reserved, available, priceMinor })),
    unitsSold: [...units.values()].sort((left, right) => right.units_sold - left.units_sold || left.name.localeCompare(right.name)),
    unitsSoldLast7Days: salesWindow ? [...weeklyUnits.values()].sort((left, right) => right.units_sold - left.units_sold || left.name.localeCompare(right.name)) : [],
  };
}

export async function organizerSummary(db: FirestoreDb, timeZone: string, shopId = DEFAULT_SHOP_ID) {
  const [facts, rows] = await Promise.all([
    organizerFacts(db, timeZone, new Date(), shopId),
    db.firestoreStore.query<OrderDoc>("orders", [{ field: "shopId", op: "==", value: shopId }], { field: "createdAt", direction: "desc" }, 50),
  ]);
  const orders = rows.map((order) => ({
    orderId: order.id, state: order.state, totalMinor: order.totalMinor, currency: order.currency,
    ...(order.state === "paid" || order.state === "collected" ? { pickupCode: order.pickupNumber ?? order.pickupCode } : {}),
    createdAt: order.createdAt, items: (order.items ?? []).map((item) => ({ name: item.display_name, quantity: item.quantity })),
  }));
  return {
    metrics: { grossSalesMinor: facts.grossCapturedMinor, netSalesMinor: facts.netCapturedMinor,
      paidOrderCount: facts.netOrderCount, lowStockCount: facts.lowStockCount },
    orders,
    products: (await listProducts(db, shopId, false)).map(({ active: _active, ...product }) => product),
  };
}
