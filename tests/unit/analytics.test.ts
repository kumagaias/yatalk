import assert from "node:assert/strict";
import test from "node:test";
import { eventDayBounds } from "../../server/analytics.js";

test("event-day reporting uses the configured timezone instead of the server timezone", () => {
  const bounds = eventDayBounds(new Date("2026-10-28T16:00:00.000Z"), "Asia/Tokyo");
  assert.deepEqual(bounds, { start: "2026-10-28T15:00:00.000Z", end: "2026-10-29T15:00:00.000Z" });
});
