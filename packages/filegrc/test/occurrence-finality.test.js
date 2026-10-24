import assert from "node:assert/strict";
import test from "node:test";
import { loadModel } from "../model/index.js";
import { membershipIsFinal, planObligations } from "../src/obligations.js";

const model = loadModel("13");

function frozenPlan(asOf, cutoff = "window-end", selector = true) {
  const resources = [
    { id: "workspace", type: "workspace", timezone: "UTC" },
    { id: "program-example", type: "program", systemIds: ["system-first", "system-added"], controlIds: ["control-example"] },
    { id: "control-example", type: "control", status: "implemented" },
    { id: "system-first", type: "system", status: "active" },
    { id: "system-added", type: "system", status: "active" },
    { id: "obligation-example", type: "obligation", status: "retired", activityType: "log-review", scheduleMode: "rule", controlIds: ["control-example"], ownerIds: [] },
    { id: "rule-example", type: "obligation-rule", obligationId: "obligation-example", status: "retired", ...(selector ? { selector: { resourceType: "system", membershipMode: "as-of", cutoff, statuses: ["active"] } } : {}) },
    { id: "occurrence-example", type: "obligation-occurrence", programId: "program-example", obligationId: "obligation-example", ruleId: "rule-example", status: "open", occurrenceKey: "program-example:obligation-example:2026-01-15", coverage: { kind: "range", startsOn: "2026-01-15", endsOn: "2026-01-31" }, membershipCutoffAt: cutoff === "window-end" ? "2026-01-31" : "2026-01-15", members: [{ resourceId: "system-first", disposition: "expected", result: "pending" }], expectedCount: 1, completedCount: 0 }
  ];
  return planObligations(resources, { model, programId: "program-example", asOf, from: "2026-01-15", through: "2026-01-31", includeComplete: true }).calendarItems[0];
}

test("frozen open windows preserve their population cutoff and include new eligible members", () => {
  for (const date of ["2026-01-15", "2026-01-16", "2026-01-31"]) {
    const item = frozenPlan(date);
    assert.equal(item.membershipFinal, false);
    assert.equal(item.resolutionsComplete, false);
    assert.equal(item.expectedCount, 2);
    assert.deepEqual(item.expectedMemberIds, ["system-added", "system-first"]);
  }
  assert.equal(frozenPlan("2026-02-01").membershipFinal, true);
});

test("frozen window-start populations finalize only after their cutoff day", () => {
  assert.equal(frozenPlan("2026-01-15", "window-start").membershipFinal, false);
  assert.equal(frozenPlan("2026-01-16", "window-start").membershipFinal, true);
  assert.equal(frozenPlan("2026-01-15", "window-end", false).membershipFinal, true);
});

test("membership finality shares inclusive cutoff semantics for every planner and validator", () => {
  const window = { dueWindowStart: "2026-01-15", dueWindowEnd: "2026-01-31" };
  assert.equal(membershipIsFinal({ membershipMode: "as-of", cutoff: "window-end" }, window, "2026-01-31"), false);
  assert.equal(membershipIsFinal({ membershipMode: "as-of", cutoff: "window-end" }, window, "2026-02-01"), true);
  assert.equal(membershipIsFinal({ membershipMode: "as-of", cutoff: "window-start" }, window, "2026-01-16"), true);
});
