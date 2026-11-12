import assert from "node:assert/strict";
import test from "node:test";
import { emptyDashboardState, readDashboardLibrary, replaceDashboardState } from "../../src/lib/dashboardLibrary.js";

test("dashboard library migrates the prior single report into an overview dashboard", () => {
  const state = emptyDashboardState();
  const library = readDashboardLibrary(null, JSON.stringify(state));

  assert.equal(library.activeId, "overview");
  assert.equal(library.dashboards[0]?.state.selectedPageId, "overview");
});

test("dashboard library rejects malformed browser storage and keeps saved dashboards isolated", () => {
  const library = readDashboardLibrary("not-json", null);
  const replacement = { selectedPageId: "sales", pages: [{ id: "sales" }] };
  const next = replaceDashboardState(library, "overview", replacement);

  assert.deepEqual(next.dashboards[0]?.state, replacement);
  assert.equal(library.dashboards[0]?.state.selectedPageId, "overview");
});
