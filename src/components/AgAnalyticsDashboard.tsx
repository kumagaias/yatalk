import { createAiHarness, directLlmRunner, type AgAiHarness, type AgAiHarnessSetupParams, type AgDataSourcesDefinition, type AgReportState, type AgStudioApi, type AgStudioStateUpdatedEvent } from "ag-studio";
import { AgStudio, type AgRegistry } from "ag-studio-react";
import { BarChart3, RefreshCw, Square } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CurrencyCode } from "../../shared/currency.js";
import { get } from "../lib/api";
import { AgStudioGeminiAdapter } from "../lib/agStudioGeminiAdapter";

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

const promptStarters = [
  { label: "Today's overview", prompt: "Build a shop overview for today with net sales, gross sales, paid orders, refunds, and low stock." },
  { label: "What should I prep?", prompt: "Compare each menu item's units sold in the last 7 days with its available stock. Show which items need preparation attention and explain the data." },
  { label: "Items sold today", prompt: "Create a chart of units sold today by menu item, with a table showing available stock alongside it." },
];

// The AG Studio defaults allow 100 rounds per agent. That is useful for open-ended
// assistants, but an overview of a small market should resolve in a few tool calls.
const agentTurnLimits: Record<string, number> = {
  lead: 5,
  data: 2,
  page: 2,
  planning: 2,
  widget: 2,
};

export function AgAnalyticsDashboard({ shopKey, shopName, apiBase }: Props) {
  const [result, setResult] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [aiRunning, setAiRunning] = useState(false);
  const harnessRef = useRef<AgAiHarness | null>(null);
  const storageKey = `yatalk.ag-studio.v1.${shopKey}`;
  const [initialState] = useState<AgReportState<AgRegistry> | undefined>(() => readSavedState(storageKey));
  const adapter = useMemo(() => new AgStudioGeminiAdapter(`${apiBase}/studio/turn`), [apiBase]);

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
    ],
  }) : undefined, [result, shopName]);

  // AG Studio's React registry narrows the wrapper API, while createAiHarness currently accepts
  // the base Studio API only. Both are the same runtime Studio API.
  const configureAi = useCallback((params: AgAiHarnessSetupParams) => {
    const harness = createAiHarness(params.api as unknown as AgStudioApi, ({ builtIn }) => ({
      agents: Object.values(builtIn).map((agent) => directLlmRunner({
        ...agent,
        adapter,
        maxTurns: agentTurnLimits[agent.id] ?? 2,
      })),
      primary: "lead",
      promptStarters,
    }));
    harnessRef.current = harness;
    return harness;
  }, [adapter]);

  const stopAi = useCallback(() => {
    const harness = harnessRef.current;
    for (const { threadId } of harness?.threads ?? []) {
      const session = harness?.getSession?.(threadId);
      if (session?.status === "running") session.cancel();
    }
    window.setTimeout(syncAiStatus, 0);
  }, [syncAiStatus]);

  const onStateUpdated = useCallback((event: AgStudioStateUpdatedEvent) => {
    if (!event.durable) return;
    try { window.localStorage.setItem(storageKey, JSON.stringify(event.state)); }
    catch { /* The report remains usable when browser storage is unavailable. */ }
  }, [storageKey]);

  return (
    <section className="dashboard-card ag-analytics-card" aria-labelledby="ag-analytics-heading">
      <div className="section-heading ag-analytics-heading">
        <div>
          <p className="eyebrow">AG Studio · Gemini</p>
          <h2 id="ag-analytics-heading"><BarChart3 size={22} aria-hidden="true" />Sales &amp; stock insights</h2>
          <p>Ask Gemini to build a visual report from this shop’s live aggregates, then refine it with AG Studio.</p>
        </div>
        <div className="ag-analytics-actions">
          <button className="text-button" type="button" onClick={stopAi} disabled={!aiRunning}>
            <Square size={14} aria-hidden="true" />Stop
          </button>
          <button className="text-button" type="button" onClick={() => void loadData()} disabled={loading}>
            <RefreshCw size={15} aria-hidden="true" />{loading ? "Refreshing…" : "Refresh data"}
          </button>
        </div>
      </div>
      {error && <div className="ag-analytics-error" role="alert">{error} <button className="text-button" type="button" onClick={() => void loadData()}>Retry</button></div>}
      {loading && !data && <p className="ag-analytics-loading" role="status">Loading shop analytics…</p>}
      {data && <div className="ag-analytics-studio">
        <AgStudio
          data={data}
          mode="edit"
          ai={configureAi}
          initialState={initialState}
          onStateUpdated={onStateUpdated}
          studioId={`yatalk-${shopKey}`}
        />
      </div>}
      {!loading && !error && result?.items.length === 0 && <p className="ag-analytics-note">Add menu items to unlock item level sales and stock reports.</p>}
    </section>
  );
}

function readSavedState(key: string): AgReportState<AgRegistry> | undefined {
  try {
    const saved = window.localStorage.getItem(key);
    return saved ? JSON.parse(saved) as AgReportState<AgRegistry> : undefined;
  } catch {
    return undefined;
  }
}
