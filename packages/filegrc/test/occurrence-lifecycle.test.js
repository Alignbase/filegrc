import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { makeComprehensiveWorkspace } from "./fixtures.js";
import { commitWorkspaceFiles, initializeGitWorkspace, writeJson } from "./helpers.js";
import { createResource, updateResource } from "../src/files.js";
import { loadWorkspace } from "../src/workspace.js";
import { validateWorkspace } from "../src/validate.js";
import { scaffoldObligationOccurrence, saveObligationOccurrence, planObligations } from "../src/obligations.js";
import { applyCollectionReview } from "../src/collection-review.js";
import { committedOccurrencePopulation, occurrenceSelectorPopulation } from "../src/obligation-population.js";
import { withAssessmentCache } from "../src/calculation-cache.js";
import { getGitSummary, setGitSubprocessObserverForTests } from "../src/git.js";
import { currentCalendarDate } from "../src/time.js";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "filegrc-occurrence-lifecycle-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const today = currentCalendarDate(loaded.workspace.timezone);
  const yesterday = new Date(`${today}T12:00:00Z`); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const start = yesterday.toISOString().slice(0, 10);
  const obligationEntry = loaded.entries.find(({ record }) => record.type === "obligation");
  const ruleEntry = loaded.entries.find(({ record }) => record.type === "obligation-rule");
  const obligation = { ...obligationEntry.record, activityType: "vendor-review", scopeResourceIds: [] };
  const rule = { ...ruleEntry.record,
    recurrence: { mode: "calendar", unit: "year", interval: 1, anchorDate: start },
    window: { precision: "date", startsAfter: 0, dueAfter: 1 },
    selector: { resourceType: "vendor", membershipMode: "as-of", cutoff: "window-end", statuses: ["active"] } };
  await writeJson(obligationEntry.path, obligation); await writeJson(ruleEntry.path, rule);
  for (const entry of loaded.entries.filter(({ record }) => record.type === "obligation-occurrence")) await rm(entry.path);
  const component = loaded.entries.find(({ record }) => record.type === "component");
  await writeJson(component.path, { ...component.record, vendorId: "vendor-example" });
  const reviewEntry = loaded.entries.find(({ record }) => record.type === "vendor-review");
  await writeJson(reviewEntry.path, { ...reviewEntry.record, completedOn: today, coverage: { kind: "range", startsOn: start, endsOn: today } });
  await initializeGitWorkspace(root);
  await writeJson(join(root, "data/workspace.json"), { ...loaded.workspace, dataModelVersion: "13" });
  await commitWorkspaceFiles(root, "Adopt current model while preserving historical activation");
  const preOccurrenceCommit = getGitSummary(root).commit;
  const scaffold = await scaffoldObligationOccurrence(root, { obligationId: obligation.id, windowStart: start, asOf: today });
  await saveObligationOccurrence(root, { record: scaffold.record });
  await commitWorkspaceFiles(root, "Record eligible vendor review in open window");
  return { root, today, start, obligation, rule, occurrenceId: scaffold.record.id, reviewEntry, preOccurrenceCommit };
}

test("vendor termination preserves committed in-window work through cutoff reconciliation", async (t) => {
  const f = await fixture(t);
  let loaded = await loadWorkspace(f.root);
  let occurrence = loaded.entries.find(({ record }) => record.id === f.occurrenceId);
  const original = await readFile(occurrence.path, "utf8");
  const reviewBytes = await readFile(f.reviewEntry.path, "utf8");
  assert.equal(occurrence.record.members[0].result, "passed");
  const vendor = loaded.entries.find(({ record }) => record.id === "vendor-example");
  await updateResource(f.root, "vendor", vendor.record.id, { ...vendor.record, status: "terminated", endDate: f.today,
    statusTransition: { changedByIds: ["person-example"], changedOn: f.today, reason: "The service ended after its review within this operating window." }
  }, { expectedRevision: vendor.revision });
  assert.equal(await readFile(occurrence.path, "utf8"), original);
  assert.equal(await readFile(f.reviewEntry.path, "utf8"), reviewBytes);
  await commitWorkspaceFiles(f.root, "End vendor service without deleting its reviewed window member");
  loaded = await loadWorkspace(f.root);
  const program = loaded.resources.find(({ type }) => type === "program");
  const population = occurrenceSelectorPopulation(loaded, occurrence.record, f.rule.selector, program);
  assert.deepEqual(population.currentIds, []);
  assert.deepEqual(population.memberIds, [vendor.record.id]);
  const item = planObligations(loaded.resources, { root: f.root, model: loaded.model, asOf: f.today,
    from: f.start, through: f.today, includeComplete: true }).calendarItems.find(({ obligationId }) => obligationId === f.obligation.id);
  assert.deepEqual(item.expectedMemberIds, [vendor.record.id]);
  assert.equal(item.completedCount, 1);
  assert.equal((await validateWorkspace(f.root)).ok, true, JSON.stringify((await validateWorkspace(f.root)).diagnostics));
  // A later inventory addition remains writable; it enters the derived queue
  // immediately and the owner must include it in the next reconciliation.
  await createResource(f.root, { ...vendor.record, id: "vendor-added", title: "New service in this window" });
  loaded = await loadWorkspace(f.root);
  const next = await scaffoldObligationOccurrence(f.root, { obligationId: f.obligation.id, windowStart: f.start, asOf: f.today });
  assert.deepEqual(next.record.members.map(({ resourceId }) => resourceId), ["vendor-added", "vendor-example"]);
  assert.equal(next.record.members.find(({ resourceId }) => resourceId === vendor.record.id).result, "passed");
  occurrence = loaded.entries.find(({ record }) => record.id === f.occurrenceId);
  const dropped = { ...occurrence.record, members: [], expectedCount: 0, completedCount: 0 };
  await writeJson(occurrence.path, dropped);
  assert.ok((await validateWorkspace(f.root)).diagnostics.some(({ code }) => code === "invalid-obligation-occurrence-population"));
  await writeJson(occurrence.path, occurrence.record);
  const injected = { ...occurrence.record, members: [...occurrence.record.members,
    { resourceId: "system-example", disposition: "expected", result: "pending" }], expectedCount: 2 };
  await writeJson(occurrence.path, injected);
  assert.ok((await validateWorkspace(f.root)).diagnostics.some(({ code }) => code === "invalid-obligation-occurrence-population"));
  await writeJson(occurrence.path, occurrence.record);
  // Remove the test-only new current service through normal termination before
  // the cutoff, leaving its not-yet-recorded eligibility outside this review.
  const added = loaded.entries.find(({ record }) => record.id === "vendor-added");
  await updateResource(f.root, "vendor", added.record.id, { ...added.record, status: "terminated", endDate: f.today,
    statusTransition: { changedByIds: ["person-example"], changedOn: f.today, reason: "The proposed service was withdrawn before any review was recorded." }
  }, { expectedRevision: added.revision });
  await commitWorkspaceFiles(f.root, "Preserve cutoff inventory for temporal collection review");
  await applyCollectionReview(f.root, { resourceType: "vendor", decision: "complete", rationale: "Reviewed the current supplier inventory and ended services at the cutoff.",
    reviewedByIds: ["person-example"], reviewedOn: f.today, confirmed: true });
  await commitWorkspaceFiles(f.root, "Record actual cutoff collection review");
  const tomorrow = new Date(`${f.today}T23:59:59Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  t.mock.timers.enable({ apis: ["Date"], now: tomorrow });
  const final = await scaffoldObligationOccurrence(f.root, { obligationId: f.obligation.id, windowStart: f.start });
  assert.equal(final.membershipFinal, true);
  assert.deepEqual(final.record.members.map(({ resourceId }) => resourceId), [vendor.record.id]);
  await saveObligationOccurrence(f.root, { record: { ...final.record, status: "reconciled", conclusion: "complete",
    reviewedByIds: ["person-example"], reconciledAt: new Date().toISOString() }, expectedRevision: final.revision });
  await commitWorkspaceFiles(f.root, "Finalize reviewed vendor population without losing its ended member");
  assert.equal((await validateWorkspace(f.root)).ok, true, JSON.stringify((await validateWorkspace(f.root)).diagnostics));
  assert.equal(await readFile(f.reviewEntry.path, "utf8"), reviewBytes);
});

test("committed population cannot admit injected IDs, another window or later scope, and is memoized", async (t) => {
  const f = await fixture(t);
  let loaded = await loadWorkspace(f.root);
  const entry = loaded.entries.find(({ record }) => record.id === f.occurrenceId);
  assert.deepEqual(committedOccurrencePopulation(loaded, entry.record, f.rule.selector, f.preOccurrenceCommit), { memberIds: [], established: false });
  const rewrittenWindow = { ...entry.record, occurrenceKey: `${entry.record.occurrenceKey}-different`,
    coverage: { ...entry.record.coverage, startsOn: f.today } };
  assert.deepEqual(committedOccurrencePopulation(loaded, rewrittenWindow, f.rule.selector), { memberIds: [], established: false });
  await writeJson(entry.path, { ...entry.record, members: [...entry.record.members,
    { resourceId: "system-example", disposition: "expected", result: "pending" }], expectedCount: 2 });
  await commitWorkspaceFiles(f.root, "Retain an invalid source version to test provenance rejection");
  loaded = await loadWorkspace(f.root);
  const current = loaded.resources.find(({ id }) => id === entry.record.id);
  assert.deepEqual(committedOccurrencePopulation(loaded, current, f.rule.selector).memberIds, ["vendor-example"]);
  assert.ok((await validateWorkspace(f.root)).diagnostics.some(({ code }) => code === "invalid-obligation-occurrence-population"));
  const calls = [];
  const priorObserver = setGitSubprocessObserverForTests((event) => calls.push(event));
  try {
    await withAssessmentCache(async () => {
      const first = committedOccurrencePopulation(loaded, current, f.rule.selector);
      const count = calls.length;
      for (let index = 0; index < 25; index++) assert.deepEqual(committedOccurrencePopulation(loaded, current, f.rule.selector), first);
      assert.equal(calls.length, count, "repeat planner and validator passes reuse one bounded provenance snapshot");
    });
  } finally { setGitSubprocessObserverForTests(priorObserver); }
});

test("pre-window and post-cutoff imports cannot establish historical membership", async (t) => {
  const f = await fixture(t);
  let loaded = await loadWorkspace(f.root);
  const entry = loaded.entries.find(({ record }) => record.id === f.occurrenceId);
  for (const yearOffset of [-1, 1]) {
    const start = new Date(`${f.start}T12:00:00Z`); start.setUTCFullYear(start.getUTCFullYear() + yearOffset);
    const end = new Date(`${f.today}T12:00:00Z`); end.setUTCFullYear(end.getUTCFullYear() + yearOffset);
    const record = { ...entry.record, occurrenceKey: `${entry.record.occurrenceKey}-${yearOffset}`,
      coverage: { kind: "range", startsOn: start.toISOString().slice(0, 10), endsOn: end.toISOString().slice(0, 10) },
      membershipCutoffAt: end.toISOString().slice(0, 10) };
    await writeJson(entry.path, record);
    await commitWorkspaceFiles(f.root, "Keep outside-window import for provenance rejection test");
    loaded = await loadWorkspace(f.root);
    assert.deepEqual(committedOccurrencePopulation(loaded, record, f.rule.selector), { memberIds: [], established: false });
  }
});
