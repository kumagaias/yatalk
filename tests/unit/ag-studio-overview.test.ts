import assert from "node:assert/strict";
import test from "node:test";
import type { AgAiSchemaMeta, AgReportState } from "ag-studio";
import { createTodayOverviewPlan, upsertTodayOverview } from "../../src/lib/agStudioOverview.js";

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
    { id: "today_overview.netSales" },
    { id: "today_overview.paidOrders" },
    { id: "today_overview.lowStockItems" },
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
