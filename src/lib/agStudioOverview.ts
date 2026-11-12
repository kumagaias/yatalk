import type { AgAiSchemaMeta, AgMultiKpiWidget, AgReportState, AgWidgetLayoutState } from "ag-studio";

const overviewWidgetId = "yatalk-today-overview";
const overviewFieldNames = ["Net Sales", "Paid Orders", "Low Stock Items"];

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

function resolveOverviewFieldIds(schema: AgAiSchemaMeta): string[] {
  const table = schema.tables.find(({ id }) => id === "today_overview");
  if (!table) throw new Error("Today's overview data is not available yet.");

  return overviewFieldNames.map((name) => {
    const field = table.fields.find(({ name: fieldName }) => normalize(fieldName) === normalize(name));
    if (!field) throw new Error(`${name} is not available in today's overview.`);
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
