import assert from "node:assert/strict";
import test from "node:test";
import { eventDayBounds, eventDayWindowBounds } from "../../server/analytics.js";

test("event-day reporting uses the configured timezone instead of the server timezone", () => {
  const bounds = eventDayBounds(new Date("2026-10-28T16:00:00.000Z"), "Asia/Tokyo");
  assert.deepEqual(bounds, { start: "2026-10-28T15:00:00.000Z", end: "2026-10-29T15:00:00.000Z" });
});

test("sales windows use seven local calendar days and stop at the request time", () => {
  const now = new Date("2026-10-28T16:00:00.000Z");
  assert.deepEqual(eventDayWindowBounds(now, "Asia/Tokyo", 7), {
    start: "2026-10-22T15:00:00.000Z",
    end: "2026-10-28T16:00:00.001Z",
  });
});
