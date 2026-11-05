import assert from "node:assert/strict";
import test from "node:test";
import { baselineRecordFiles } from "../src/defaults.js";
import { loadModel, planObligations } from "../../filegrc/src/index.js";

test("starter monthly and quarterly rules follow calendar boundaries in every month", () => {
  for (let month = 1; month <= 12; month += 1) {
    const date = `2028-${String(month).padStart(2, "0")}-${month === 2 ? "29" : "25"}`;
    const rules = baselineRecordFiles(date).map(({ record }) => record).filter(({ type }) => type === "obligation-rule");
    for (const { recurrence } of rules.filter(({ recurrence }) => recurrence.mode === "calendar")) {
      const expected = recurrence.unit === "month" && recurrence.interval === 1
        ? `${date.slice(0, 7)}-01`
        : recurrence.unit === "month" && recurrence.interval === 3
          ? `2028-${String(Math.floor((month - 1) / 3) * 3 + 1).padStart(2, "0")}-01`
          : date;
      assert.equal(recurrence.anchorDate, expected);
    }
  }
});

test("a reviewed next-quarter successor retains completed work without opening another current-quarter cycle", () => {
  const resources = [
    { id: "workspace", type: "workspace", title: "Workspace", timezone: "UTC", dataModelVersion: "13" },
    { id: "owner", type: "person", title: "Owner", status: "active" },
    { id: "control", type: "control", title: "Control", status: "implemented" },
    { id: "obligation", type: "obligation", title: "Quarterly meeting", status: "active", activityType: "meeting", ownerIds: ["owner"], controlIds: ["control"], scheduleMode: "rule", ruleIds: ["old-rule", "new-rule"], activeRuleId: "new-rule" },
    { id: "old-rule", type: "obligation-rule", obligationId: "obligation", status: "retired", recurrence: { mode: "calendar", unit: "month", interval: 3, anchorDate: "2026-08-05" }, effectiveAt: "2026-10-23T00:00:00Z", timezone: "UTC", retiredOn: "2026-11-05" },
    { id: "new-rule", type: "obligation-rule", obligationId: "obligation", status: "active", recurrence: { mode: "calendar", unit: "month", interval: 3, anchorDate: "2027-01-01" }, effectiveAt: "2026-11-05T00:00:00Z", timezone: "UTC", supersedesId: "old-rule", cutoverDecision: "new-windows-only" },
    { id: "done", type: "obligation-occurrence", obligationId: "obligation", ruleId: "old-rule", status: "reconciled", occurrenceKey: "workspace:obligation:2026-10-23", coverage: { kind: "range", startsOn: "2026-10-23", endsOn: "2026-11-04" }, members: [], expectedCount: 0, completedCount: 0, conclusion: "zero-population", reconciledAt: "2026-10-27T12:00:00Z" }
  ];
  const before = structuredClone(resources);
  const plan = planObligations(resources, { model: loadModel("13"), asOf: "2026-11-05", through: "2027-03-31", now: "2026-11-05T12:00:00Z", includeComplete: true });
  assert.deepEqual(resources, before);
  const historical = plan.items.find(({ occurrenceId }) => occurrenceId === "done");
  assert.equal(historical.status, "complete");
  assert.equal(historical.ruleId, "old-rule");
  const next = plan.items.filter(({ occurrenceId }) => occurrenceId !== "done");
  assert.equal(next.length, 1);
  assert.equal(next[0].dueWindowStart, "2027-01-01");
  assert.equal(next[0].dueWindowEnd, "2027-03-31");
  assert.equal(next[0].status, "upcoming");
});
