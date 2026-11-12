import assert from "node:assert/strict";
import test from "node:test";
import type { AgAiSchemaMeta, AgReportState } from "ag-studio";
import { createTodayOverviewPlan, upsertAnalyticsBoard, upsertAnalyticsPreset, upsertTodayOverview } from "../../src/lib/agStudioOverview.js";

const schema: AgAiSchemaMeta = {
  tables: [{
    id: "today_overview",
    name: "Today's overview",
    reference: "@table[today_overview]",
    fields: [
      field("today_overview.netSales", "Net Sales"),
      field("today_overview.paidOrders", "Paid Orders"),
      field("today_overview.lowStockItems", "Low Stock Items"),
    ],
  }, {
    id: "daily_sales_trend",
    name: "Daily net sales",
    reference: "@table[daily_sales_trend]",
    fields: [field("daily_sales_trend.date", "Date"), field("daily_sales_trend.netSales", "Net Sales")],
  }, {
    id: "menu_performance",
    name: "Menu performance",
    reference: "@table[menu_performance]",
    fields: [
      field("menu_performance.itemName", "Item Name"),
      field("menu_performance.availableUnits", "Available Units"),
      field("menu_performance.unitsSoldLast7Days", "Units Sold Last7Days"),
    ],
  }],
  relationships: [],
};

const state: AgReportState = {
  selectedPageId: "page-1",
  pages: [{
    id: "page-1",
    widgets: { existing: { type: "text", dataMapping: { value: [] } } },
    widgetLayout: { existing: { xTrack: 0, yTrack: 0, xSpan: 12, ySpan: 4 } },
  }],
};

test("today overview is a deterministic three-metric AG Studio widget", () => {
  const plan = createTodayOverviewPlan(schema, state);

  assert.equal(plan.widget.type, "multi-kpi");
  assert.deepEqual(plan.widget.dataMapping.values, [
    { id: "today_overview.netSales", aggregation: "sum" },
    { id: "today_overview.paidOrders", aggregation: "sum" },
    { id: "today_overview.lowStockItems", aggregation: "sum" },
  ]);
  assert.deepEqual(plan.layout, { xTrack: 0, yTrack: 4, xSpan: 24, ySpan: 9 });
});

test("today overview is updated in place instead of duplicating widgets", () => {
  const once = upsertTodayOverview(schema, state);
  const twice = upsertTodayOverview(schema, once);
  const page = twice.pages[0];

  assert.deepEqual(Object.keys(page.widgets ?? {}).sort(), ["existing", "yatalk-today-overview"]);
  assert.deepEqual(page.widgetLayout?.["yatalk-today-overview"], { xTrack: 0, yTrack: 4, xSpan: 24, ySpan: 9 });
});

test("analytics board adds editable sales and stock charts", () => {
  const page = upsertAnalyticsBoard(schema, state).pages[0]!;
  const widgets = page.widgets!;

  assert.equal(widgets["yatalk-daily-sales-trend"]?.type, "line-chart");
  assert.deepEqual((widgets["yatalk-daily-sales-trend"] as { dataMapping: unknown }).dataMapping, {
    categoryKey: [{ id: "daily_sales_trend.date" }],
    valueKey: [{ id: "daily_sales_trend.netSales", aggregation: "sum" }],
  });
  assert.equal(widgets["yatalk-stock-demand-comparison"]?.type, "bar-chart-grouped");
  assert.deepEqual(page.widgetLayout?.["yatalk-daily-sales-trend"], { xTrack: 0, yTrack: 13, xSpan: 12, ySpan: 10 });
  assert.deepEqual(page.widgetLayout?.["yatalk-stock-demand-comparison"], { xTrack: 12, yTrack: 13, xSpan: 12, ySpan: 10 });
});

test("chart presets add one full-width editable chart at a time", () => {
  const salesTrend = upsertAnalyticsPreset(schema, state, "salesTrend").pages[0]!;
  const stockHealth = upsertAnalyticsPreset(schema, state, "stockHealth").pages[0]!;

  assert.equal(salesTrend.widgets?.["yatalk-daily-sales-trend"]?.type, "line-chart");
  assert.deepEqual(salesTrend.widgetLayout?.["yatalk-daily-sales-trend"], { xTrack: 0, yTrack: 4, xSpan: 24, ySpan: 11 });
  assert.equal(stockHealth.widgets?.["yatalk-stock-demand-comparison"]?.type, "bar-chart-grouped");
  assert.deepEqual(stockHealth.widgetLayout?.["yatalk-stock-demand-comparison"], { xTrack: 0, yTrack: 4, xSpan: 24, ySpan: 11 });
});

function field(fieldId: string, name: string): AgAiSchemaMeta["tables"][number]["fields"][number] {
  return {
    fieldId,
    name,
    reference: `@field[${fieldId}]`,
    dataType: "number",
    roles: ["numeric"],
    kind: "column",
    aggregations: ["sum"],
  };
}
