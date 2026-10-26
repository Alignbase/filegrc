import assert from "node:assert/strict";
import test from "node:test";
import { wholePeriodRuleWindowIssue, wholePeriodOccurrenceWindowIssue } from "../src/obligation-timing.js";

const rule = (unit, interval, anchorDate, dueAfter) => ({
  completionCoverage: "whole-period",
  recurrence: { mode: "calendar", unit, interval, anchorDate },
  ...(dueAfter === undefined ? {} : { window: { precision: "date", startsAfter: 0, dueAfter } })
});

test("whole-period execution windows include post-period time in every reachable calendar phase", () => {
  for (const candidate of [
    rule("year", 1, "2026-10-25"),
    rule("year", 1, "2026-10-25", 30),
    rule("year", 1, "2026-10-25", 364),
    rule("year", 1, "2026-10-25", 365),
    rule("month", 1, "2026-02-01", 28),
    rule("month", 1, "2026-02-01", 30),
    rule("day", 3, "2026-03-07", 2),
    rule("week", 2, "2026-10-25", 13),
    { ...rule("day", 1, "2026-10-25", 30), recurrence: { mode: "event" } }
  ]) assert.ok(wholePeriodRuleWindowIssue(candidate), JSON.stringify(candidate));
  for (const candidate of [
    rule("year", 1, "2026-10-25", 366),
    rule("year", 4, "2026-10-25", 1461),
    rule("month", 1, "2026-02-01", 31),
    rule("month", 1, "2026-01-31", 31),
    rule("day", 3, "2026-03-07", 3),
    rule("week", 2, "2026-10-25", 14),
    { ...rule("year", 1, "2026-10-25", 365), endsOn: "2026-12-31" }
  ]) assert.equal(wholePeriodRuleWindowIssue(candidate), null, JSON.stringify(candidate));
  assert.equal(wholePeriodRuleWindowIssue({ ...rule("year", 1, "2026-10-25", 0), completionCoverage: "point-in-time" }), null);
});

test("a whole-period execution deadline on its inclusive final date remains impossible", () => {
  const requiredCoverage = { kind: "range", startsOn: "2026-10-25", endsOn: "2027-10-24" };
  assert.ok(wholePeriodOccurrenceWindowIssue({ requiredCoverage, dueWindowEnd: "2027-10-24" }));
  assert.ok(wholePeriodOccurrenceWindowIssue({ requiredCoverage, dueWindowEnd: "2026-11-22" }));
  assert.equal(wholePeriodOccurrenceWindowIssue({ requiredCoverage, dueWindowEnd: "2027-10-25" }), null);
  assert.equal(wholePeriodOccurrenceWindowIssue({ dueWindowEnd: "2026-11-22" }), null);
});
