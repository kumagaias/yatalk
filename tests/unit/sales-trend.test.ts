import assert from "node:assert/strict";
import test from "node:test";
import { dailySalesTrend } from "../../server/sales-trend.js";

test("daily sales trend fills missing local days and excludes refunded orders", () => {
  const result = dailySalesTrend(new Date("2026-11-13T12:00:00.000Z"), "Asia/Tokyo", 3, [
    { capturedAt: "2026-11-10T15:30:00.000Z", totalMinor: 700, state: "paid" },
    { capturedAt: "2026-11-12T02:00:00.000Z", totalMinor: 500, state: "collected" },
    { capturedAt: "2026-11-12T04:00:00.000Z", totalMinor: 800, state: "refunded" },
  ]);

  assert.deepEqual(result, [
    { date: "2026-11-11", netSalesMinor: 700 },
    { date: "2026-11-12", netSalesMinor: 500 },
    { date: "2026-11-13", netSalesMinor: 0 },
  ]);
});
