import assert from "node:assert/strict";
import test from "node:test";
import { nextCalendarOccurrence } from "../src/recurrence.js";

test("calculates upcoming calendar obligations without changing calendar dates", () => {
  assert.equal(nextCalendarOccurrence({
    mode: "calendar",
    unit: "month",
    interval: 3,
    anchorDate: "2026-01-15"
  }, "2026-07-01"), "2026-07-15");
  assert.equal(nextCalendarOccurrence({
    mode: "calendar",
    unit: "year",
    interval: 1,
    anchorDate: "2024-02-29"
  }, "2025-02-28"), "2025-02-28");
  assert.equal(nextCalendarOccurrence({
    mode: "calendar",
    unit: "month",
    interval: 1,
    anchorDate: "2026-01-31"
  }, "2026-02-01"), "2026-02-28");
  assert.equal(nextCalendarOccurrence({
    mode: "calendar",
    unit: "week",
    interval: 2,
    anchorDate: "2026-01-01"
  }, "2026-01-20"), "2026-01-29");
});

test("rejects unsupported or malformed recurrence values", () => {
  assert.equal(nextCalendarOccurrence({ mode: "event" }, "2026-01-01"), null);
  assert.equal(nextCalendarOccurrence({ mode: "calendar", unit: "month", interval: 0, anchorDate: "2026-01-01" }, "2026-01-01"), null);
  assert.equal(nextCalendarOccurrence({ mode: "calendar", unit: "month", interval: 1, anchorDate: "bad" }, "2026-01-01"), null);
});
