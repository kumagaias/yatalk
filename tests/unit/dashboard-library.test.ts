import assert from "node:assert/strict";
import test from "node:test";
import { emptyDashboardState, nextUntitledDashboardName, readDashboardLibrary, removeDashboard, replaceDashboardState } from "../../src/lib/dashboardLibrary.js";

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

test("deleting a selected dashboard preserves the others and persists the new selection", () => {
  const first = { id: "one", name: "One", state: emptyDashboardState() };
  const second = { id: "two", name: "Two", state: { selectedPageId: "sales", pages: [{ id: "sales" }] } };
  const library = { activeId: "two", dashboards: [first, second] };
  const next = removeDashboard(library, "two");
  assert.deepEqual(next, { activeId: "one", dashboards: [first] });
  assert.deepEqual(readDashboardLibrary(JSON.stringify(next), null), next);
  assert.equal(library.dashboards.length, 2);
  assert.equal(removeDashboard(library, "missing"), library);
  assert.equal(removeDashboard({ ...library, activeId: "one" }, "two").activeId, "one");
});

test("deleting the last dashboard replaces it with a blank one instead of restoring legacy data", () => {
  const library = { activeId: "one", dashboards: [{ id: "one", name: "One", state: { selectedPageId: "sales", pages: [{ id: "sales" }] } }] };
  const next = removeDashboard(library, "one");
  assert.deepEqual(next, { activeId: "overview", dashboards: [{ id: "overview", name: "Overview", state: emptyDashboardState() }] });
  assert.deepEqual(readDashboardLibrary(JSON.stringify(next), JSON.stringify(library.dashboards[0]!.state)), next);
});

test("new blank dashboards receive distinguishable names", () => {
  const library = { activeId: "one", dashboards: [{ id: "one", name: "Untitled dashboard", state: emptyDashboardState() }, { id: "two", name: "Untitled dashboard 2", state: emptyDashboardState() }] };
  assert.equal(nextUntitledDashboardName(library), "Untitled dashboard 3");
});
