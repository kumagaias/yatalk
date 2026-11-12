import assert from "node:assert/strict";
import test from "node:test";
import { dashboardRecommendations, salesForecast, stockProjection } from "../../src/lib/dashboardInsights.js";

test("sales forecast uses the transparent seven-day daily average", () => {
  assert.equal(salesForecast([{ date: "2026-11-10", netSales: 10 }, { date: "2026-11-11", netSales: 20 }]), 15);
  assert.equal(salesForecast([{ date: "2026-11-10", netSales: 0 }]), null);
});

test("stock projection selects the item with the least cover", () => {
  assert.deepEqual(stockProjection([
    { itemName: "Tea", availableUnits: 3, unitsSoldLast7Days: 14 },
    { itemName: "Fries", availableUnits: 12, unitsSoldLast7Days: 7 },
  ], 2), { itemName: "Tea", daysOfCover: 1.5, projectedAvailable: [3, 1, 0] });
});

test("recommendations prioritize the most urgent restock", () => {
  assert.deepEqual(dashboardRecommendations([
    { itemName: "Tea", availableUnits: 1, unitsSoldLast7Days: 14 },
  ]), [{ title: "Restock Tea", detail: "1 available covers about less than 1 day of recent demand.", tone: "urgent" }]);
});
