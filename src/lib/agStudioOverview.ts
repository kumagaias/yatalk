import type { AgAiSchemaMeta, AgBarChartGrouped, AgLineChart, AgMultiKpiWidget, AgReportState, AgWidgetLayoutState } from "ag-studio";

const overviewWidgetId = "yatalk-today-overview";
const salesTrendWidgetId = "yatalk-daily-sales-trend";
const stockComparisonWidgetId = "yatalk-stock-demand-comparison";
const overviewFieldNames = ["Net Sales", "Paid Orders", "Low Stock Items"];

export type AnalyticsPreset = "overview" | "salesTrend" | "stockHealth";
export type DashboardTemplate = "operations" | "detailed" | "sales" | "inventory";

export function createDashboardTemplate(schema: AgAiSchemaMeta, template: DashboardTemplate): AgReportState {
  const empty: AgReportState = { selectedPageId: "overview", pages: [{ id: "overview" }] };
  if (template === "detailed") return createDetailedDashboard(schema, empty);
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

export function createDetailedDashboard(schema: AgAiSchemaMeta, state: AgReportState): AgReportState {
  const page = state.pages.find(({ id }) => id === state.selectedPageId);
  if (!page) throw new Error("The selected report page is not available.");
  const [grossSales, netSales, paidOrders, , lowStockItems] = resolveFields(schema, "today_overview", ["Gross Sales", "Net Sales", "Paid Orders", "Refunded Orders", "Low Stock Items"]);
  const [itemName, unitPrice, stockOnHand, reservedUnits, availableUnits, unitsSoldToday, unitsSoldLast7Days] = resolveFields(schema, "menu_performance", ["Item Name", "Unit Price", "Stock On Hand", "Reserved Units", "Available Units", "Units Sold Today", "Units Sold Last7Days"]);
  const widget = (fieldId: string, title: string): AgMultiKpiWidget => ({
    type: "multi-kpi",
    dataMapping: { values: [{ id: fieldId, aggregation: "sum" }] },
    format: { title: { enabled: true, text: title }, style: { columns: 1, textAlign: "center", label: { enabled: true, position: "below" } } },
  });
  const chart = (title: string, values: string[]): AgBarChartGrouped => ({
    type: "bar-chart-grouped",
    dataMapping: { categoryKey: [{ id: itemName! }], valueKey: values.map((value) => ({ id: value, aggregation: "sum" as const })) },
    format: { title: { enabled: true, text: title } },
  });
  const dailySales = salesTrendChart(schema);
  const charts: Record<string, AgBarChartGrouped | AgLineChart | AgMultiKpiWidget> = {
    "detail-net-sales": widget(netSales!, "Net sales"),
    "detail-gross-sales": widget(grossSales!, "Gross sales"),
    "detail-paid-orders": widget(paidOrders!, "Paid orders"),
    "detail-low-stock": widget(lowStockItems!, "Low stock items"),
    "detail-daily-sales": dailySales,
    "detail-stock-demand": chart("Available stock vs 7-day demand", [availableUnits!, unitsSoldLast7Days!]),
    "detail-today-demand": chart("Units sold today by item", [unitsSoldToday!]),
    "detail-stock-on-hand": chart("Stock on hand by item", [stockOnHand!]),
    "detail-reserved": chart("Reserved units by item", [reservedUnits!]),
    "detail-prices": chart("Menu price by item", [unitPrice!]),
  };
  const layout = page.widgetLayout ?? {};
  const start = nextAvailableRow(layout);
  const positions: Record<string, AgWidgetLayoutState> = {
    "detail-net-sales": { xTrack: 0, yTrack: start, xSpan: 6, ySpan: 7 },
    "detail-gross-sales": { xTrack: 6, yTrack: start, xSpan: 6, ySpan: 7 },
    "detail-paid-orders": { xTrack: 12, yTrack: start, xSpan: 6, ySpan: 7 },
    "detail-low-stock": { xTrack: 18, yTrack: start, xSpan: 6, ySpan: 7 },
    "detail-daily-sales": { xTrack: 0, yTrack: start + 7, xSpan: 12, ySpan: 10 },
    "detail-stock-demand": { xTrack: 12, yTrack: start + 7, xSpan: 12, ySpan: 10 },
    "detail-today-demand": { xTrack: 0, yTrack: start + 17, xSpan: 8, ySpan: 10 },
    "detail-stock-on-hand": { xTrack: 8, yTrack: start + 17, xSpan: 8, ySpan: 10 },
    "detail-reserved": { xTrack: 16, yTrack: start + 17, xSpan: 8, ySpan: 10 },
    "detail-prices": { xTrack: 0, yTrack: start + 27, xSpan: 24, ySpan: 10 },
  };
  return {
    ...state,
    pages: state.pages.map((candidate) => candidate.id !== state.selectedPageId ? candidate : ({
      ...candidate,
      widgets: { ...candidate.widgets, ...charts },
      widgetLayout: { ...layout, ...Object.fromEntries(Object.entries(positions).map(([id, position]) => [id, layout[id] ?? position])) },
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
