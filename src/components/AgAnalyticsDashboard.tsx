import { createAiHarness, directLlmRunner, studioTheme, type AgAiHarness, type AgAiHarnessSetupParams, type AgAiPromptStarter, type AgDataSourcesDefinition, type AgReportState, type AgStudioApi, type AgStudioStateUpdatedEvent } from "ag-studio";
import { AgStudio, type AgRegistry } from "ag-studio-react";
import { BarChart3, Boxes, ChartLine, LayoutDashboard, Plus, RefreshCw, Sparkles, Square } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CurrencyCode } from "../../shared/currency.js";
import { get } from "../lib/api";
import { AgStudioGeminiAdapter } from "../lib/agStudioGeminiAdapter";
import { createDashboardTemplate, type AnalyticsPreset, type DashboardTemplate, upsertAnalyticsBoard, upsertAnalyticsPreset } from "../lib/agStudioOverview";
import { readDashboardLibrary, replaceDashboardState, type DashboardLibrary } from "../lib/dashboardLibrary";

type AnalyticsData = {
  overview: {
    businessDate: string;
    currency: CurrencyCode;
    grossSales: number;
    netSales: number;
    paidOrders: number;
    refundedOrders: number;
    lowStockItems: number;
  };
  salesTrend: Array<{ date: string; netSales: number }>;
  items: Array<{
    itemName: string;
    unitPrice: number;
    stockOnHand: number;
    reservedUnits: number;
    availableUnits: number;
    unitsSoldToday: number;
    unitsSoldLast7Days: number;
  }>;
};

type Props = { shopKey: string; shopName: string; apiBase: string };

const promptStarters: AgAiPromptStarter[] = [
  {
    label: "10-widget dashboard",
    prompt: "Create a new named Detailed dashboard called Operations command center. Use the create_dashboard tool exactly once with the detailed template. It must create all ten widgets immediately, then summarize the dashboard.",
  },
  {
    label: "Forecast tomorrow",
    prompt: "Estimate tomorrow's net sales from the daily sales data. State the 7-day average calculation, call it an estimate, and give one concise operational recommendation. Do not create or change dashboard widgets.",
  },
  {
    label: "What should I prep?",
    prompt: "Review each menu item's seven-day demand and available stock. Give the three most useful preparation or restock actions, explaining the evidence. Do not create or change dashboard widgets.",
  },
  {
    label: "Explain the trend",
    prompt: "Summarize the daily sales trend in plain language. Mention any high or low day shown in the data and one thing to watch tomorrow. Do not create or change dashboard widgets.",
  },
];

// The AG Studio defaults allow 100 rounds per agent. That is useful for open-ended
// assistants, but an overview of a small market should resolve in a few tool calls.
const agentTurnLimits: Record<string, number> = {
  lead: 6,
  data: 3,
  page: 3,
  planning: 3,
  // A valid widget can need one corrective configure pass after AG Studio reports
  // health checks, before its final verification and completion.
  widget: 5,
};

const analyticsTheme = studioTheme.withParams({
  backgroundColor: "#f8f7f1",
  fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
  studioCanvasBackgroundColor: "#edf2ed",
  studioWidgetBackgroundColor: "#fffefa",
  studioWidgetBorderRadius: 14,
  studioWidgetShadow: { offsetY: 3, radius: 12, color: "#173d3418" },
  studioWidgetTitleFontWeight: 650,
  studioWidgetTitleTextColor: "#193d36",
  chartAccentColor: "#287966",
  chartGridLineColor: "#e1e9e2",
  chartPaletteFills1Color: "#287966",
  chartPaletteFills2Color: "#e4a944",
  chartPaletteFills3Color: "#cc6944",
  chartPaletteFills4Color: "#739b8d",
  chartPaletteStrokes1Color: "#1f6656",
  chartPaletteStrokes2Color: "#b37b20",
  chartPaletteStrokes3Color: "#a34c30",
  chartPaletteStrokes4Color: "#527c6f",
});

export function AgAnalyticsDashboard({ shopKey, shopName, apiBase }: Props) {
  const [result, setResult] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [aiRunning, setAiRunning] = useState(false);
  const [overviewStatus, setOverviewStatus] = useState("");
  const harnessRef = useRef<AgAiHarness | null>(null);
  const studioApiRef = useRef<AgStudioApi | null>(null);
  const storageKey = `yatalk.ag-studio.v2.${shopKey}`;
  const legacyStorageKey = `yatalk.ag-studio.v1.${shopKey}`;
  const [dashboardLibrary, setDashboardLibrary] = useState<DashboardLibrary>(() => readSavedState(storageKey, legacyStorageKey));
  const dashboardLibraryRef = useRef(dashboardLibrary);
  const activeDashboard = dashboardLibrary.dashboards.find(({ id }) => id === dashboardLibrary.activeId) ?? dashboardLibrary.dashboards[0]!;
  const [initialState] = useState<AgReportState<AgRegistry> | undefined>(() => activeDashboard.state as AgReportState<AgRegistry>);
  const adapter = useMemo(() => new AgStudioGeminiAdapter(`${apiBase}/studio/turn`), [apiBase]);

  const saveDashboardLibrary = useCallback((next: DashboardLibrary) => {
    dashboardLibraryRef.current = next;
    setDashboardLibrary(next);
    try { window.localStorage.setItem(storageKey, JSON.stringify(next)); }
    catch { /* Dashboard editing remains available when browser storage is unavailable. */ }
  }, [storageKey]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setResult(await get<AnalyticsData>(`${apiBase}/studio/data`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Shop analytics could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => { void loadData(); }, [loadData]);

  const syncAiStatus = useCallback(() => {
    const harness = harnessRef.current;
    setAiRunning(!!harness?.threads.some(({ threadId }) => harness.getSession?.(threadId)?.status === "running"));
  }, []);

  useEffect(() => {
    const timer = window.setInterval(syncAiStatus, 300);
    return () => window.clearInterval(timer);
  }, [syncAiStatus]);

  const data = useMemo<AgDataSourcesDefinition<AgRegistry> | undefined>(() => result ? ({
    description: `Read-only sales and stock aggregates for ${shopName}. Sales and prices are expressed in ${result.overview.currency}. Do not infer customer or order details from these totals.`,
    sources: [
      {
        id: "today_overview",
        name: "Today's overview",
        description: "One row with today's captured sales, paid order count, refunds, and low stock count.",
        data: [result.overview],
      },
      {
        id: "menu_performance",
        name: "Menu performance",
        description: "Current available stock and units sold by menu item today and over the last seven days. Prices are in the shop currency.",
        data: result.items,
      },
      {
        id: "daily_sales_trend",
        name: "Daily net sales",
        description: "Seven daily net-sales observations ending today. Use this source for short-term sales forecasts and sales trend charts; clearly label forecasts as estimates.",
        data: result.salesTrend,
      },
    ],
  }) : undefined, [result, shopName]);

  // AG Studio's React registry narrows the wrapper API, while createAiHarness currently accepts
  // the base Studio API only. Both are the same runtime Studio API.
  const createDashboard = useCallback((template: DashboardTemplate, requestedName?: string) => {
    const studioApi = studioApiRef.current;
    if (!studioApi) throw new Error("The report is still loading. Try again in a moment.");
    const id = `dashboard-${crypto.randomUUID()}`;
    const fallbackName = template === "detailed" ? "Operations command center" : template === "operations" ? "Operations dashboard" : template === "sales" ? "Sales dashboard" : "Inventory dashboard";
    const name = normalizeDashboardName(requestedName, fallbackName);
    const state = collapseEditorPanels(createDashboardTemplate(studioApi.getAiContext().schema(), template));
    const next = {
      activeId: id,
      dashboards: [...dashboardLibraryRef.current.dashboards, { id, name, state }],
    };
    saveDashboardLibrary(next);
    studioApi.setState(state, { historyLabel: `Created ${name}`, source: { type: "api" } });
    setOverviewStatus(`${name} is ready. Use the edge arrows in AG Studio whenever you want to edit it.`);
    return { id, name };
  }, [saveDashboardLibrary]);

  const configureAi = useCallback((params: AgAiHarnessSetupParams) => {
    const api = params.api as unknown as AgStudioApi;
    const createDashboardTool = api.defineAiTool({
      name: "create_dashboard",
      description: "Create a separate named dashboard for this shop. Use this when the user asks for a new dashboard or report, not when they only want to modify the dashboard already open.",
      params: (shape) => shape.object({
        name: shape.string({ description: "Short dashboard name" }),
        template: shape.enum(["detailed", "operations", "sales", "inventory"] as const, { description: "detailed immediately creates a 10-widget operations command center; operations combines three widgets; sales is a daily line chart; inventory compares available stock and seven-day demand" }),
      }),
      execute: (args, context) => {
        try {
          const dashboard = createDashboard(args.template, args.name);
          return context.success(`Created and opened the ${dashboard.name} dashboard.`, dashboard);
        } catch (cause) {
          return context.error(cause instanceof Error ? cause.message : "The dashboard could not be created.");
        }
      },
    });
    const harness = createAiHarness(api, ({ builtIn }) => ({
      agents: Object.values(builtIn).map((agent) => {
        const isLead = agent.id === "lead";
        return directLlmRunner({
          ...agent,
          instructions: isLead ? (context, agentParams) => `${agent.instructions?.(context, agentParams) ?? ""}\n\nWhen a user asks to create a new dashboard, call create_dashboard exactly once before discussing or refining it. If they ask for many widgets, a comprehensive dashboard, or an operations command center, choose detailed: it creates all ten widgets atomically. Choose the closest template and keep the name concise. When refining a dashboard, favor a clear visual hierarchy, concise titles, and appropriate chart types grounded in available data.` : agent.instructions,
          tools: isLead ? (context, agentParams) => [...(agent.tools?.(context, agentParams) ?? []), createDashboardTool] : agent.tools,
          adapter,
          maxTurns: agentTurnLimits[agent.id] ?? 2,
        });
      }),
      primary: "lead",
      promptStarters,
    }));
    harnessRef.current = harness;
    return harness;
  }, [adapter, createDashboard]);

  const stopAi = useCallback(() => {
    const harness = harnessRef.current;
    for (const { threadId } of harness?.threads ?? []) {
      const session = harness?.getSession?.(threadId);
      if (session?.status === "running") session.cancel();
    }
    window.setTimeout(syncAiStatus, 0);
  }, [syncAiStatus]);

  const createTodayOverview = useCallback(() => {
    const studioApi = studioApiRef.current;
    if (!studioApi) {
      setOverviewStatus("The report is still loading. Try again in a moment.");
      return;
    }

    try {
      const report = upsertAnalyticsBoard(studioApi.getAiContext().schema(), studioApi.getState());
      studioApi.setState(collapseEditorPanels(report), {
        historyLabel: "Generated sales and stock overview",
        source: { type: "api" },
      });
      setOverviewStatus("Overview created. Use the edge arrows in AG Studio whenever you want to edit it.");
    } catch (cause) {
      setOverviewStatus(cause instanceof Error ? cause.message : "The overview could not be created.");
    }
  }, []);

  const applyPreset = useCallback((preset: AnalyticsPreset) => {
    const studioApi = studioApiRef.current;
    if (!studioApi) {
      setOverviewStatus("The report is still loading. Try again in a moment.");
      return;
    }

    try {
      const report = upsertAnalyticsPreset(studioApi.getAiContext().schema(), studioApi.getState(), preset);
      studioApi.setState(collapseEditorPanels(report), {
        historyLabel: preset === "salesTrend" ? "Added daily sales trend" : "Added stock health chart",
        source: { type: "api" },
      });
      setOverviewStatus(`${preset === "salesTrend" ? "Sales trend" : "Stock health"} chart created. Use the edge arrows in AG Studio whenever you want to edit it.`);
    } catch (cause) {
      setOverviewStatus(cause instanceof Error ? cause.message : "The preset could not be created.");
    }
  }, []);

  const selectDashboard = useCallback((dashboardId: string) => {
    const dashboard = dashboardLibraryRef.current.dashboards.find(({ id }) => id === dashboardId);
    const studioApi = studioApiRef.current;
    if (!dashboard || !studioApi || dashboardId === dashboardLibraryRef.current.activeId) return;
    saveDashboardLibrary({ ...dashboardLibraryRef.current, activeId: dashboardId });
    studioApi.setState(dashboard.state, { historyLabel: `Opened ${dashboard.name}`, source: { type: "api" } });
    setOverviewStatus(`Opened ${dashboard.name}.`);
  }, [saveDashboardLibrary]);

  const onStateUpdated = useCallback((event: AgStudioStateUpdatedEvent) => {
    if (!event.durable) return;
    saveDashboardLibrary(replaceDashboardState(dashboardLibraryRef.current, dashboardLibraryRef.current.activeId, event.state));
  }, [saveDashboardLibrary]);

  return (
    <section className="dashboard-card ag-analytics-card" aria-labelledby="ag-analytics-heading">
      <div className="section-heading ag-analytics-heading">
        <div>
          <p className="eyebrow">AG Studio · Gemini</p>
          <h2 id="ag-analytics-heading"><BarChart3 size={22} aria-hidden="true" />Sales &amp; stock insights</h2>
          <p>Create reliable daily insights, or ask Gemini a free-form question about this shop’s live aggregates.</p>
        </div>
        <div className="ag-analytics-actions">
          <button className="text-button" type="button" onClick={stopAi} disabled={!aiRunning}>
            <Square size={14} aria-hidden="true" />Stop
          </button>
          <button className="icon-button ag-refresh-button" type="button" onClick={() => void loadData()} disabled={loading} aria-label="Refresh analytics data" title="Refresh analytics data">
            <RefreshCw size={17} aria-hidden="true" className={loading ? "spin" : undefined} />
          </button>
        </div>
      </div>
      {error && <div className="ag-analytics-error" role="alert">{error} <button className="text-button" type="button" onClick={() => void loadData()}>Retry</button></div>}
      {overviewStatus && <p className="ag-analytics-status" role="status">{overviewStatus}</p>}
      {loading && !data && <p className="ag-analytics-loading" role="status">Loading shop analytics…</p>}
      {data && <div className="dashboard-library-bar">
        <label>
          <LayoutDashboard size={16} aria-hidden="true" />
          <span>Dashboard</span>
          <select value={activeDashboard.id} onChange={(event) => selectDashboard(event.target.value)} aria-label="Choose a saved dashboard">
            {dashboardLibrary.dashboards.map((dashboard) => <option key={dashboard.id} value={dashboard.id}>{dashboard.name}</option>)}
          </select>
        </label>
        <button className="button button-secondary" type="button" onClick={() => createDashboard("operations")}>
          <Plus size={16} aria-hidden="true" />New dashboard
        </button>
      </div>}
      {data && <div className="ag-preset-bar" aria-label="AG Studio overview presets">
        <div className="ag-preset-intro">
          <span className="eyebrow">Ready-made views</span>
          <strong>Start with a report, then refine it in AG Studio.</strong>
        </div>
        <div className="ag-preset-actions">
          <button className="button button-primary ag-generate-button" type="button" onClick={createTodayOverview}>
            <Sparkles size={17} aria-hidden="true" />Generate overview
          </button>
          <button className="ag-preset-button" type="button" onClick={() => applyPreset("salesTrend")}>
            <ChartLine size={18} aria-hidden="true" /><span><strong>Sales trend</strong><small>7-day line</small></span>
          </button>
          <button className="ag-preset-button" type="button" onClick={() => applyPreset("stockHealth")}>
            <Boxes size={18} aria-hidden="true" /><span><strong>Stock health</strong><small>Demand comparison</small></span>
          </button>
        </div>
      </div>}
      {data && <div className="ag-analytics-studio">
        <AgStudio
          data={data}
          mode="edit"
          ai={configureAi}
          theme={analyticsTheme}
          initialState={initialState}
          onStateUpdated={onStateUpdated}
          onStudioReady={({ api }) => { studioApiRef.current = api; }}
          onStudioPreDestroyed={() => { studioApiRef.current = null; }}
          studioId={`yatalk-${shopKey}`}
        />
      </div>}
      {!loading && !error && result?.items.length === 0 && <p className="ag-analytics-note">Add menu items to unlock item level sales and stock reports.</p>}
    </section>
  );
}

function readSavedState(key: string, legacyKey: string): DashboardLibrary {
  try {
    return readDashboardLibrary(window.localStorage.getItem(key), window.localStorage.getItem(legacyKey));
  } catch {
    return readDashboardLibrary(null, null);
  }
}

function collapseEditorPanels(state: AgReportState): AgReportState {
  const currentPanels = state.panels ?? {};
  const collapse = (id: "ai" | "filters" | "edit" | "data") => ({ ...currentPanels[id], collapsed: true });
  return {
    ...state,
    panels: {
      ...currentPanels,
      ai: collapse("ai"),
      filters: collapse("filters"),
      edit: collapse("edit"),
      data: collapse("data"),
    },
  };
}

function normalizeDashboardName(value: string | undefined, fallback: string): string {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, 56) : fallback;
}
