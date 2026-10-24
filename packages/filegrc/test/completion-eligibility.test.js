import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { makeComprehensiveWorkspace } from "./fixtures.js";
import { writeJson } from "./helpers.js";
import { completeObligationOccurrence, loadModel, loadWorkspace, planObligations,
  scaffoldObligationOccurrence, validateWorkspace } from "../src/index.js";
import { assessCompletionForObligation, completionMatchesObligation } from "../src/obligations.js";

const model = loadModel("13");

test("completion identity distinguishes profiles and explicit Obligation linkage without requiring legacy linkage", () => {
  for (const activityType of ["endpoint-verification", "log-review", "inventory-review"]) {
    const obligation = { id: `obligation-${activityType}`, activityType };
    const record = { type: "control-activity", profileId: activityType };
    assert.equal(completionMatchesObligation(record, obligation, model), true);
    assert.equal(completionMatchesObligation({ ...record, obligationId: obligation.id }, obligation, model), true);
    assert.equal(completionMatchesObligation({ ...record, obligationId: "obligation-unrelated" }, obligation, model), false);
    assert.equal(completionMatchesObligation({ ...record, profileId: "control-design-review" }, obligation, model), false);
  }
  const obligation = { id: "obligation-document-review", activityType: "document-review" };
  assert.equal(completionMatchesObligation({ type: "document" }, obligation, model), true);
  assert.equal(completionMatchesObligation({ type: "evidence", artifactSubtype: "document-review" }, obligation, model), true);
  assert.equal(completionMatchesObligation({ type: "evidence", artifactSubtype: "vendor-review" }, obligation, model), false);
  assert.equal(completionMatchesObligation({ type: "evidence", artifactSubtype: "document-review", obligationId: "obligation-other" }, obligation, model), false);
});

test("occurrence scaffolds exclude unrelated completions and retain failed executions of the adopted activity", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-completion-eligibility-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "13");
  const loaded = await loadWorkspace(root);
  const obligationEntry = loaded.entries.find(({ record }) => record.type === "obligation");
  const ruleEntry = loaded.entries.find(({ record }) => record.type === "obligation-rule");
  const obligation = { ...obligationEntry.record, activityType: "endpoint-verification", scopeResourceIds: ["system-example"] };
  const rule = { ...ruleEntry.record,
    recurrence: { mode: "calendar", unit: "month", interval: 1, anchorDate: "2026-01-01" },
    window: { precision: "date", startsAfter: 0, dueAfter: 20 }, effectiveAt: "2026-07-05T00:00:00-05:00" };
  delete rule.selector;
  await writeJson(obligationEntry.path, obligation);
  await writeJson(ruleEntry.path, rule);
  for (const entry of loaded.entries.filter(({ record }) => record.type === "obligation-occurrence")) await rm(entry.path);
  const evidenceEntry = loaded.entries.find(({ record }) => record.type === "evidence");
  await writeJson(evidenceEntry.path, { ...evidenceEntry.record, collectedOn: "2026-07-07", verifiedOn: "2026-07-07" });
  const base = { ...loaded.resources.find(({ type }) => type === "control-activity"),
    status: "complete", profileId: "endpoint-verification", obligationId: obligation.id,
    scopeResourceIds: ["system-example"], performerIds: ["person-example"], reviewerIds: ["person-example"],
    completedAt: "2026-07-07T15:30:00Z", reviewedOn: "2026-07-07", result: "passed",
    method: "Inspect retained configuration and reconcile it against the scoped inventory." };
  const records = [
    { ...base, id: "activity-wrong-profile", profileId: "log-review" },
    { ...base, id: "activity-other-obligation", obligationId: "obligation-other" },
    { ...base, id: "activity-wrong-scope", scopeResourceIds: ["asset-example"] },
    { ...base, id: "activity-before-window", completedAt: "2026-07-04T15:30:00Z", reviewedOn: "2026-07-04" },
    { ...base, id: "activity-failed", result: "failed" }
  ];
  // The other Obligation is real so only completion eligibility differs.
  await writeJson(join(root, "data", loaded.model.resources.obligation.collection, "obligation-other.json"), {
    ...obligation, id: "obligation-other", title: "Other endpoint check", scheduleMode: "legacy", recurrence: rule.recurrence
  });
  for (const record of records) await writeJson(join(root, "data", "control-activities", `${record.id}.json`), record);
  const scaffold = await scaffoldObligationOccurrence(root, { obligationId: obligation.id,
    windowStart: "2026-07-05", asOf: "2026-07-07" });
  const member = scaffold.record.members.find(({ resourceId }) => resourceId === "system-example");
  assert.deepEqual(member.completionResourceIds, ["activity-failed"]);
  assert.equal(member.result, "failed");
  // Reopening an open occurrence must not reintroduce unrelated retained IDs.
  await writeJson(join(root, "data", "obligation-occurrences", `${scaffold.record.id}.json`), {
    ...scaffold.record, members: [{ ...member, completionResourceIds: records.map(({ id }) => id) }]
  });
  const refreshed = await scaffoldObligationOccurrence(root, { obligationId: obligation.id,
    windowStart: "2026-07-05", asOf: "2026-07-07" });
  assert.deepEqual(refreshed.record.members[0].completionResourceIds, ["activity-failed"]);
  const current = await loadWorkspace(root);
  for (const record of records.slice(0, 4)) {
    assert.equal(assessCompletionForObligation(record, obligation, current, {
      memberIds: ["system-example"], window: { dueWindowStart: "2026-07-05", dueWindowEnd: "2026-07-21" }, asOf: "2026-07-07"
    }).complete, false);
  }
  for (const record of records.slice(0, 2)) {
    await assert.rejects(completeObligationOccurrence(root, { obligationId: obligation.id, record }), /profile|linkage/);
  }
  // Directly linked wrong-profile results cannot satisfy the planner either.
  const wrong = { ...scaffold.record, status: "open", completedCount: 1, members: [{ ...member,
    result: "passed", completionResourceIds: [records[0].id] }] };
  await writeJson(join(root, "data", loaded.model.resources[wrong.type].collection, `${wrong.id}.json`), wrong);
  const withOccurrence = await loadWorkspace(root);
  const planned = planObligations(withOccurrence.resources, { model: withOccurrence.model,
    asOf: "2026-07-07", through: "2026-07-07", includeComplete: true }).calendarItems
    .find(({ obligationId }) => obligationId === obligation.id);
  assert.equal(planned.status, "due");
  assert.deepEqual(planned.resolvedMemberIds, []);
  const validation = await validateWorkspace(root);
  assert.ok(validation.diagnostics.some(({ code }) => code === "missing-passing-member-completion"), JSON.stringify(validation.diagnostics));
});
