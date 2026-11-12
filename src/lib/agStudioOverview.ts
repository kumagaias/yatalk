import type { AgAiSchemaMeta, AgBarChartGrouped, AgLineChart, AgMultiKpiWidget, AgReportState, AgWidgetLayoutState } from "ag-studio";

const overviewWidgetId = "yatalk-today-overview";
const salesTrendWidgetId = "yatalk-daily-sales-trend";
const stockComparisonWidgetId = "yatalk-stock-demand-comparison";
const overviewFieldNames = ["Net Sales", "Paid Orders", "Low Stock Items"];

export type AnalyticsPreset = "overview" | "salesTrend" | "stockHealth";
export type DashboardTemplate = "operations" | "sales" | "inventory";

export function createDashboardTemplate(schema: AgAiSchemaMeta, template: DashboardTemplate): AgReportState {
  const empty: AgReportState = { selectedPageId: "overview", pages: [{ id: "overview" }] };
  if (template === "operations") return upsertAnalyticsBoard(schema, empty);
  return upsertAnalyticsPreset(schema, empty, template === "sales" ? "salesTrend" : "stockHealth");
}

export type OverviewWidgetPlan = {
  widgetId: string;
  widget: AgMultiKpiWidget;
  layout: { xTrack: number; yTrack: number; xSpan: number; ySpan: number };
};

export function createTodayOverviewPlan(
  schema: AgAiSchemaMeta,
  state: AgReportState,
): OverviewWidgetPlan {
  const fieldIds = resolveOverviewFieldIds(schema);
  const page = state.pages.find(({ id }) => id === state.selectedPageId);
  if (!page) throw new Error("The selected report page is not available.");

  return {
    widgetId: overviewWidgetId,
    widget: {
      type: "multi-kpi",
      // Multi KPI slots accept measures. Numeric source columns must therefore
      // include an aggregation, even though today's overview is a single row.
      dataMapping: { values: fieldIds.map((id) => ({ id, aggregation: "sum" as const })) },
      format: {
        title: { enabled: true, text: "Today's sales overview" },
        style: {
          columns: 3,
          textAlign: "center",
          label: { enabled: true, position: "below" },
        },
      },
    },
    layout: page.widgetLayout?.[overviewWidgetId] ?? {
      xTrack: 0,
      yTrack: nextAvailableRow(page.widgetLayout),
      xSpan: 24,
      ySpan: 9,
    },
  };
}

export function upsertTodayOverview(
  schema: AgAiSchemaMeta,
  state: AgReportState,
): AgReportState {
  const plan = createTodayOverviewPlan(schema, state);

  return {
    ...state,
    pages: state.pages.map((page) => page.id !== state.selectedPageId ? page : ({
      ...page,
      widgets: { ...page.widgets, [plan.widgetId]: plan.widget },
      widgetLayout: { ...page.widgetLayout, [plan.widgetId]: plan.layout },
    })),
  };
}

export function upsertAnalyticsBoard(schema: AgAiSchemaMeta, state: AgReportState): AgReportState {
  const overview = createTodayOverviewPlan(schema, state);
  const page = state.pages.find(({ id }) => id === state.selectedPageId);
  if (!page) throw new Error("The selected report page is not available.");
  const [salesDate, netSales] = resolveFields(schema, "daily_sales_trend", ["Date", "Net Sales"]);
  const [itemName, availableUnits, unitsSoldLast7Days] = resolveFields(schema, "menu_performance", ["Item Name", "Available Units", "Units Sold Last7Days"]);
  const layout = page.widgetLayout ?? {};
  const chartY = Math.max(overview.layout.yTrack + overview.layout.ySpan, nextAvailableRow(layout));
  const salesTrend: AgLineChart = {
    type: "line-chart",
    dataMapping: { categoryKey: [{ id: salesDate! }], valueKey: [{ id: netSales!, aggregation: "sum" }] },
    format: { title: { enabled: true, text: "Daily net sales" }, style: { theme: { line: { series: { marker: { enabled: true, shape: "circle" } } } } } },
  };
  const stockComparison: AgBarChartGrouped = {
    type: "bar-chart-grouped",
    dataMapping: {
      categoryKey: [{ id: itemName! }],
      valueKey: [{ id: availableUnits!, aggregation: "sum" }, { id: unitsSoldLast7Days!, aggregation: "sum" }],
    },
    format: { title: { enabled: true, text: "Available stock vs 7-day demand" } },
  };
  return {
    ...state,
    pages: state.pages.map((candidate) => candidate.id !== state.selectedPageId ? candidate : ({
      ...candidate,
      widgets: { ...candidate.widgets, [overviewWidgetId]: overview.widget, [salesTrendWidgetId]: salesTrend, [stockComparisonWidgetId]: stockComparison },
      widgetLayout: {
        ...layout,
        [overviewWidgetId]: overview.layout,
        [salesTrendWidgetId]: layout[salesTrendWidgetId] ?? { xTrack: 0, yTrack: chartY, xSpan: 12, ySpan: 10 },
        [stockComparisonWidgetId]: layout[stockComparisonWidgetId] ?? { xTrack: 12, yTrack: chartY, xSpan: 12, ySpan: 10 },
      },
    })),
  };
}

export function upsertAnalyticsPreset(schema: AgAiSchemaMeta, state: AgReportState, preset: AnalyticsPreset): AgReportState {
  if (preset === "overview") return upsertTodayOverview(schema, state);
  const page = state.pages.find(({ id }) => id === state.selectedPageId);
  if (!page) throw new Error("The selected report page is not available.");
  const layout = page.widgetLayout ?? {};
  const chart = preset === "salesTrend" ? salesTrendChart(schema) : stockHealthChart(schema);
  const widgetId = preset === "salesTrend" ? salesTrendWidgetId : stockComparisonWidgetId;
  return {
    ...state,
    pages: state.pages.map((candidate) => candidate.id !== state.selectedPageId ? candidate : ({
      ...candidate,
      widgets: { ...candidate.widgets, [widgetId]: chart },
      widgetLayout: { ...layout, [widgetId]: layout[widgetId] ?? { xTrack: 0, yTrack: nextAvailableRow(layout), xSpan: 24, ySpan: 11 } },
    })),
  };
}

function salesTrendChart(schema: AgAiSchemaMeta): AgLineChart {
  const [salesDate, netSales] = resolveFields(schema, "daily_sales_trend", ["Date", "Net Sales"]);
  return {
    type: "line-chart",
    dataMapping: { categoryKey: [{ id: salesDate! }], valueKey: [{ id: netSales!, aggregation: "sum" }] },
    format: { title: { enabled: true, text: "Daily net sales" }, style: { theme: { line: { series: { marker: { enabled: true, shape: "circle" } } } } } },
  };
}

function stockHealthChart(schema: AgAiSchemaMeta): AgBarChartGrouped {
  const [itemName, availableUnits, unitsSoldLast7Days] = resolveFields(schema, "menu_performance", ["Item Name", "Available Units", "Units Sold Last7Days"]);
  return {
    type: "bar-chart-grouped",
    dataMapping: { categoryKey: [{ id: itemName! }], valueKey: [{ id: availableUnits!, aggregation: "sum" }, { id: unitsSoldLast7Days!, aggregation: "sum" }] },
    format: { title: { enabled: true, text: "Available stock vs 7-day demand" } },
  };
}

function resolveOverviewFieldIds(schema: AgAiSchemaMeta): string[] {
  return resolveFields(schema, "today_overview", overviewFieldNames);
}

function resolveFields(schema: AgAiSchemaMeta, tableId: string, names: string[]): string[] {
  const table = schema.tables.find(({ id }) => id === tableId);
  if (!table) throw new Error(`${tableId} data is not available yet.`);
  return names.map((name) => {
    const field = table.fields.find(({ name: fieldName }) => normalize(fieldName) === normalize(name));
    if (!field) throw new Error(`${name} is not available in ${table.name}.`);
    return field.fieldId;
  });
}

function nextAvailableRow(layout: Partial<Record<string, AgWidgetLayoutState>> | undefined): number {
  return Math.max(0, ...Object.values(layout ?? {})
    .filter((entry): entry is AgWidgetLayoutState => entry != null)
    .map(({ yTrack, ySpan }) => yTrack + ySpan));
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
}
