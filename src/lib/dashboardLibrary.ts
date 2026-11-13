import type { AgReportState } from "ag-studio";

export type SavedDashboard = {
  id: string;
  name: string;
  state: AgReportState;
};

export type DashboardLibrary = {
  activeId: string;
  dashboards: SavedDashboard[];
};

export function emptyDashboardState(): AgReportState {
  return { selectedPageId: "overview", pages: [{ id: "overview" }] };
}

export function nextUntitledDashboardName(library: DashboardLibrary): string {
  const names = new Set(library.dashboards.map(({ name }) => name));
  let number = 1;
  let name = "Untitled dashboard";
  while (names.has(name)) name = `Untitled dashboard ${++number}`;
  return name;
}

export function readDashboardLibrary(value: string | null, legacyValue: string | null): DashboardLibrary {
  const saved = parseLibrary(value);
  if (saved) return saved;

  const legacy = parseReportState(legacyValue);
  const first: SavedDashboard = {
    id: "overview",
    name: "Overview",
    state: legacy ?? emptyDashboardState(),
  };
  return { activeId: first.id, dashboards: [first] };
}

export function replaceDashboardState(library: DashboardLibrary, dashboardId: string, state: AgReportState): DashboardLibrary {
  return {
    ...library,
    dashboards: library.dashboards.map((dashboard) => dashboard.id === dashboardId ? { ...dashboard, state } : dashboard),
  };
}

export function removeDashboard(library: DashboardLibrary, dashboardId: string): DashboardLibrary {
  if (!library.dashboards.some(({ id }) => id === dashboardId)) return library;
  const dashboards = library.dashboards.filter(({ id }) => id !== dashboardId);
  if (dashboards.length === 0) {
    const fallback = { id: "overview", name: "Overview", state: emptyDashboardState() };
    return { activeId: fallback.id, dashboards: [fallback] };
  }
  return { activeId: library.activeId === dashboardId ? dashboards[0]!.id : library.activeId, dashboards };
}

function parseLibrary(value: string | null): DashboardLibrary | undefined {
  if (!value) return undefined;
  try {
    const candidate = JSON.parse(value) as unknown;
    if (!isRecord(candidate) || typeof candidate.activeId !== "string" || !Array.isArray(candidate.dashboards)) return undefined;
    const dashboards = candidate.dashboards.flatMap((dashboard) => {
      if (!isRecord(dashboard) || typeof dashboard.id !== "string" || typeof dashboard.name !== "string" || !isReportState(dashboard.state)) return [];
      return [{ id: dashboard.id, name: dashboard.name, state: dashboard.state }];
    });
    if (dashboards.length === 0 || !dashboards.some(({ id }) => id === candidate.activeId)) return undefined;
    return { activeId: candidate.activeId, dashboards };
  } catch {
    return undefined;
  }
}

function parseReportState(value: string | null): AgReportState | undefined {
  if (!value) return undefined;
  try {
    const state = JSON.parse(value) as unknown;
    return isReportState(state) ? state : undefined;
  } catch {
    return undefined;
  }
}

function isReportState(value: unknown): value is AgReportState {
  return isRecord(value) && typeof value.selectedPageId === "string" && Array.isArray(value.pages);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
