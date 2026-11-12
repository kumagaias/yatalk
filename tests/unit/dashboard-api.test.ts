import assert from "node:assert/strict";
import test from "node:test";
import { dashboardApiBase } from "../../src/lib/dashboard-api.js";

test("dashboard API paths stay scoped to the current owner shop", () => {
  assert.equal(dashboardApiBase("north-stall", "ramen-night"), "/api/v1/dashboard/north-stall/ramen-night");
  assert.equal(dashboardApiBase(undefined, "ramen-night"), "/api/v1/dashboard/shops/ramen-night");
  assert.equal(dashboardApiBase(), "/api/organizer");
});
