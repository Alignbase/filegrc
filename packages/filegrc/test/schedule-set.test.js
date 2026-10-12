import { scheduleCutoverIssues } from "../src/activation-readiness.js";
import { validateWorkspace } from "../src/validate.js";
import { migrateModel, planModelMigration } from "../src/model-migration.js";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadModel } from "../model/index.js";
import { scheduleSetIssues, scheduleSetRecords } from "../src/schedule-set.js";
import { collectionRevision } from "../src/collection-revision.js";
import { applicabilityReviewIsCurrent, applicabilityScopeRevision } from "../src/applicability-scope.js";
const scheduleSetRevision = (loaded, program) => collectionRevision(loaded, "obligation", { program });
import { obligationRule } from "../src/obligation-rule.js";
import { assessCollectionReview, scaffoldCollectionReview, planCollectionReview, applyCollectionReview } from "../src/collection-review.js";
import { loadWorkspace } from "../src/workspace.js";
import { makeComprehensiveWorkspace } from "./fixtures.js";
import { initializeGitWorkspace, initializeExistingModel12Workspace, commitWorkspaceFiles, writeJson, executeCli } from "./helpers.js";
import { runCli } from "../src/cli.js";
import { createAppStateSection } from "../src/state.js";
import { currentCalendarDate } from "../src/time.js";
import { fileURLToPath } from "node:url";

function fixture() {
  const program = { id: "program-a", type: "program", controlIds: ["control-a"], systemIds: [] };
  const records = [program, { id: "owner", type: "person", status: "active" }, { id: "control-a", type: "control", ownerIds: ["owner"] },
    { id: "calendar", type: "obligation", title: "Calendar review", activityType: "access-review", status: "active", scheduleMode: "rule", activeRuleId: "rule-calendar", controlIds: ["control-a"] },
    { id: "event", type: "obligation", title: "Incident work", activityType: "access-review", status: "proposed", scheduleMode: "rule", ruleIds: ["rule-event"], controlIds: ["control-a"] },
    { id: "rule-calendar", type: "obligation-rule", obligationId: "calendar", status: "active", effectiveAt: "2020-01-01T00:00:00Z", approvedOn: "2020-01-01", approvedByIds: ["owner"], recurrence: { mode: "calendar" } },
    { id: "rule-event", type: "obligation-rule", obligationId: "event", status: "proposed", recurrence: { mode: "event", eventType: "incident-declared" } }
  ];
  return { loaded: { resources: records, model: loadModel("12"), root: null }, program };
}
const adopted = { obligationId: "calendar", disposition: "adopted", ruleId: "rule-calendar", rationale: "Required periodic review." };
const exclusion = { obligationId: "event", disposition: "inapplicable", rationale: "This proposal duplicates the separately reviewed incident checklist." };

test("one adopted rule cannot hide unresolved required event coverage", () => {
  const { loaded, program } = fixture();
  assert.ok(scheduleSetIssues(loaded, program, null).length);
  assert.ok(scheduleSetIssues(loaded, program, { scopeResourceIds: [program.id], scheduleDecisions: [adopted] }).length);
  assert.deepEqual(scheduleSetIssues(loaded, program, { scopeResourceIds: [program.id], scheduleDecisions: [adopted, exclusion] }), []);
});

test("reviews active rule alternatives, replacements, retired duplicates, and Program scope", () => {
  const { loaded, program } = fixture();
  loaded.resources.push({ id: "rule-alternative", type: "obligation-rule", obligationId: "calendar", status: "proposed" });
  const review = { scopeResourceIds: [program.id], scheduleDecisions: [adopted, exclusion] };
  assert.match(scheduleSetIssues(loaded, program, review)[0].message, /unresolved rule proposals/);
  review.scheduleDecisions[0] = { ...adopted, excludedRuleIds: ["rule-alternative"] };
  assert.deepEqual(scheduleSetIssues(loaded, program, review), []);
  review.scheduleDecisions[1] = { ...exclusion, disposition: "replaced", replacementObligationIds: ["calendar"] };
  assert.ok(scheduleSetIssues(loaded, program, review).some(({ message }) => /required incident-declared event/.test(message)));
  const rule = loaded.resources.find(({ id }) => id === "rule-calendar");
  rule.recurrence = { mode: "event", eventType: "incident-declared" };
  assert.deepEqual(scheduleSetIssues(loaded, program, review), []);
  const event = loaded.resources.find(({ id }) => id === "event");
  event.status = "active";
  assert.match(scheduleSetIssues(loaded, program, review)[0].message, /adopted operating schedule/);
  event.status = "retired";
  review.scheduleDecisions[1] = { ...exclusion, disposition: "retired" };
  assert.deepEqual(scheduleSetIssues(loaded, program, review), []);
  loaded.resources.push({ id: "other", type: "obligation", controlIds: ["control-b"], status: "proposed" });
  assert.deepEqual(scheduleSetRecords(loaded, program).map(({ id }) => id), ["calendar", "event"]);
  assert.ok(scheduleSetIssues(loaded, program, { ...review, scopeResourceIds: ["program-b"] }).length);
});

test("selects the historically effective rule across multiple cutovers", () => {
  const obligation = { id: "schedule", scheduleMode: "rule", activeRuleId: "rule-3" };
  const byId = new Map([1, 2, 3].map((number) => [`rule-${number}`, { id: `rule-${number}`, type: "obligation-rule", obligationId: "schedule", status: number === 3 ? "active" : "retired", effectiveAt: `2026-0${number}-01T00:00:00Z`, supersedesId: number > 1 ? `rule-${number - 1}` : undefined }]));
  assert.equal(obligationRule(obligation, byId, { now: "2026-01-15T00:00:00Z" }).id, "rule-1");
  assert.equal(obligationRule(obligation, byId, { now: "2026-02-01T00:00:00Z" }).id, "rule-2");
  assert.equal(obligationRule(obligation, byId, { now: "2025-12-31T23:59:59Z" }), null);
  byId.get("rule-1").supersedesId = "rule-3";
  assert.equal(obligationRule(obligation, byId, { now: "2025-12-31T23:59:59Z" }), null);
});

test("schedule-set review is exact, independent, and available through the CLI", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-schedule-review-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "12");
  await initializeExistingModel12Workspace(root);
  let loaded = await loadWorkspace(root);
  const program = loaded.resources.find(({ type }) => type === "program");
  const scaffold = await scaffoldCollectionReview(root, { resourceType: "obligation", programId: program.id });
  assert.equal(scaffold.scheduleDecisions.length, scheduleSetRecords(loaded, program).length);
  const cli = fileURLToPath(new URL("../bin/filegrc.js", import.meta.url));
  const output = await executeCli(runCli, process.execPath, [cli, "review-collection", "obligation", "--program", program.id, "--scaffold", "--root", root]);
  assert.deepEqual(JSON.parse(output.stdout), scaffold);
  const payload = { ...scaffold, reviewedByIds: ["person-independent-approver-example"], reviewedOn: currentCalendarDate("UTC"), rationale: "Reviewed the complete schedule set.", scheduleDecisions: scaffold.scheduleDecisions.map((decision) => ({ ...decision, disposition: "adopted", rationale: "Required for the selected Control." })) };
  await assert.rejects(planCollectionReview(root, { ...payload, reviewedByIds: ["person-example"] }), /independent/);
  const plan = await planCollectionReview(root, payload);
  assert.deepEqual(plan.changes.create[0].scheduleDecisions, payload.scheduleDecisions);
  await applyCollectionReview(root, { ...payload, confirmed: true });
  loaded = await loadWorkspace(root);
  assert.equal(assessCollectionReview(loaded, "obligation", { programId: program.id }).complete, true);
  const assessment = assessCollectionReview(loaded, "obligation", { programId: program.id });
  const incorrectPopulation = { ...loaded, resources: loaded.resources.map((record) => record.id === assessment.review.id ? { ...record, populationResourceIds: [] } : record), entries: loaded.entries.map((entry) => entry.record.id === assessment.review.id ? { ...entry, record: { ...entry.record, populationResourceIds: [] } } : entry) };
  assert.equal(assessCollectionReview(incorrectPopulation, "obligation", { programId: program.id }).complete, false);
  const reviewEntry = loaded.entries.find(({ record }) => record.id === assessment.review.id);
  for (const scheduleDecisions of [null, "invalid", [null], [{ ...payload.scheduleDecisions[0], rationale: 3 }]]) {
    await writeJson(reviewEntry.path, { ...reviewEntry.record, scheduleDecisions });
    const invalid = await validateWorkspace(root);
    assert.equal(invalid.ok, false);
    assert.ok(invalid.diagnostics.some(({ code }) => ["invalid-field", "unresolved-schedule-set"].includes(code)));
  }
  await writeFile(reviewEntry.path, reviewEntry.source);
  const policy = loaded.resources.find(({ type }) => type === "policy");
  const backdated = { ...policy, status: "active", effectiveOn: "2020-01-01" };
  assert.ok((await scheduleCutoverIssues(loaded, [backdated])).some(({ code }) => code === "schedule-set-approval-after-cutover"));
  const originalRevision = scheduleSetRevision(loaded, program);
  const operationOnly = { ...loaded, resources: loaded.resources.map((record) => record.type === "obligation" ? { ...record, completionResourceIds: ["new-operating-proof"] } : record) };
  assert.equal(scheduleSetRevision(operationOnly, program), originalRevision);
  const schedule = loaded.entries.find(({ record }) => record.type === "obligation");
  await writeJson(join(root, "data", schedule.relativePath), { ...schedule.record, ownerIds: ["person-independent-approver-example"] });
  loaded = await loadWorkspace(root);
  assert.notEqual(scheduleSetRevision(loaded, program), originalRevision);
  assert.equal(assessCollectionReview(loaded, "obligation", { programId: program.id }).complete, false);
  await assert.rejects(planCollectionReview(root, payload), /changed after it was displayed/);
});

test("v12 migration preserves operating records and leaves schedule decisions pending", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-v12-migration-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const reviewed = await loadWorkspace(root);
  const reviewedProgram = reviewed.resources.find(({ type }) => type === "program");
  const reviewBindings = new Map();
  for (const entry of reviewed.entries.filter(({ record }) => ["control", "commitment", "complementary-control"].includes(record.type))) {
    entry.record.applicabilityReview = {
      decision: "applicable", rationale: "Required in the selected scope.",
      reviewedByIds: ["person-independent-approver-example"], reviewedOn: currentCalendarDate("UTC"),
      scopeRevision: applicabilityScopeRevision(entry.record, reviewedProgram, reviewed.resources, reviewed.model)
    };
    reviewBindings.set(entry.record.id, entry.record.applicabilityReview);
    await writeJson(entry.path, entry.record);
  }
  for (const decision of reviewedProgram.requirementApplicability || []) {
    const requirement = reviewed.resources.find(({ id }) => id === decision.requirementId);
    decision.scopeRevision = applicabilityScopeRevision(requirement, reviewedProgram, reviewed.resources, reviewed.model);
    reviewBindings.set(requirement.id, decision);
  }
  await writeJson(reviewed.entries.find(({ record }) => record.id === reviewedProgram.id).path, reviewedProgram);
  await initializeGitWorkspace(root);
  const before = await loadWorkspace(root);
  const preview = await planModelMigration(root, { targetModelVersion: "12" });
  assert.equal(preview.ready, true);
  assert.equal(preview.fileDiff.update.length, 1);
  assert.equal(preview.classifications.reviewRequired.length, 1);
  assert.deepEqual(preview.fileDiff.create, []);
  await migrateModel(root, { targetModelVersion: "12" });
  const after = await loadWorkspace(root);
  assert.equal(after.workspace.dataModelVersion, "12");
  assert.deepEqual(after.resources.filter(({ type }) => type !== "workspace"), before.resources.filter(({ type }) => type !== "workspace"));
  const program = after.resources.find(({ id }) => id === reviewedProgram.id);
  for (const [id, review] of reviewBindings) {
    assert.equal(applicabilityReviewIsCurrent(review, after.resources.find((r) => r.id === id), program, after.resources, after.model, root), true, id);
  }
  const browser = await createAppStateSection(after, "program", { programId: program.id });
  const cli = fileURLToPath(new URL("../bin/filegrc.js", import.meta.url));
  const output = await executeCli(runCli, process.execPath, [cli, "program-readiness", "--program", program.id, "--json", "--root", root]);
  const { generatedAt: cliGeneratedAt, ...cliReadiness } = JSON.parse(output.stdout);
  const { generatedAt: browserGeneratedAt, ...browserReadiness } = browser.programReadiness;
  assert.ok(cliGeneratedAt && browserGeneratedAt);
  assert.deepEqual(cliReadiness, browserReadiness);
  for (const id of reviewBindings.keys()) assert.equal(browser.applicabilityReviewStatuses[id], "current", id);
  for (const resourceType of Object.keys(before.model.collectionReviews)) {
    assert.equal(collectionRevision(after, resourceType, { program }), collectionRevision(before, resourceType, { program: reviewedProgram }), resourceType);
    assert.equal(assessCollectionReview(after, resourceType).complete, assessCollectionReview(before, resourceType).complete, resourceType);
  }
  assert.equal(assessCollectionReview(after, "obligation").complete, false);
  assert.equal((await planModelMigration(root, { targetModelVersion: "12" })).summary.update, 0);
});

test("unrelated event replacements cannot supply missing risk coverage", () => {
  const { loaded, program } = fixture();
  const event = loaded.resources.find(({ id }) => id === "event");
  event.eventRiskLevels = ["normal", "high"];
  const calendar = loaded.resources.find(({ id }) => id === "calendar");
  calendar.eventRiskLevels = ["high"];
  loaded.resources.find(({ id }) => id === "rule-calendar").recurrence = { mode: "event", eventType: "incident-declared" };
  loaded.resources.push({ ...calendar, id: "other-event", eventRiskLevels: ["normal"], activeRuleId: "rule-other" }, { ...loaded.resources.find(({ id }) => id === "rule-calendar"), id: "rule-other", obligationId: "other-event", recurrence: { mode: "event", eventType: "person-started" } });
  const review = { scopeResourceIds: [program.id], scheduleDecisions: [adopted, { ...adopted, obligationId: "other-event", ruleId: "rule-other" }, { ...exclusion, disposition: "replaced", replacementObligationIds: ["calendar", "other-event"] }] };
  assert.ok(scheduleSetIssues(loaded, program, review).some(({ message }) => /same event and completion proof/.test(message)));
});

test("malformed schedule decisions produce diagnostics without throwing", () => {
  const { loaded, program } = fixture();
  for (const scheduleDecisions of [null, "invalid", [null], [{ ...adopted, rationale: 7 }, exclusion], [{ ...adopted, excludedRuleIds: "wrong" }, exclusion]]) {
    assert.ok(scheduleSetIssues(loaded, program, { scopeResourceIds: [program.id], scheduleDecisions }).length);
  }
});

test("committing a direct-file activation cannot bypass schedule approval", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-v12-direct-cutover-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "12");
  await initializeExistingModel12Workspace(root);
  let loaded = await loadWorkspace(root);
  const policyEntry = loaded.entries.find(({ record }) => record.type === "policy");
  const approved = { ...policyEntry.record, status: "approved" };
  delete approved.effectiveOn;
  await writeJson(policyEntry.path, approved);
  await commitWorkspaceFiles(root, "Prepare a new Policy cutover");
  await writeJson(policyEntry.path, { ...approved, status: "active", effectiveOn: currentCalendarDate(loaded.workspace.timezone) });
  let result = await validateWorkspace(root);
  assert.ok(result.diagnostics.some(({ code, severity }) => code === "schedule-set-approval-required" && severity === "error"));
  await commitWorkspaceFiles(root, "Record an unapproved direct-file cutover");
  result = await validateWorkspace(root);
  assert.ok(result.diagnostics.some(({ code, severity }) => code === "schedule-set-approval-required" && severity === "error"));
});

test("direct and committed backdated cutovers reject later schedule approval", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-v12-backdated-cutover-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "12");
  await initializeExistingModel12Workspace(root);
  let loaded = await loadWorkspace(root);
  const policyEntry = loaded.entries.find(({ record }) => record.type === "policy");
  const approved = { ...policyEntry.record, status: "approved" };
  delete approved.effectiveOn;
  await writeJson(policyEntry.path, approved);
  await commitWorkspaceFiles(root, "Prepare reviewed program content");
  const scaffold = await scaffoldCollectionReview(root, { resourceType: "obligation" });
  await applyCollectionReview(root, { ...scaffold, rationale: "Reviewed exact schedule set.", reviewedByIds: ["person-independent-approver-example"], reviewedOn: currentCalendarDate(loaded.workspace.timezone), scheduleDecisions: scaffold.scheduleDecisions.map((decision) => ({ ...decision, disposition: "adopted", rationale: "Required work." })), confirmed: true });
  await commitWorkspaceFiles(root, "Approve the schedule set");
  await writeJson(policyEntry.path, { ...approved, status: "active", effectiveOn: "2020-01-01" });
  let result = await validateWorkspace(root);
  assert.ok(result.diagnostics.some(({ code }) => code === "schedule-set-approval-after-cutover"));
  await commitWorkspaceFiles(root, "Record an invalid earlier cutover");
  result = await validateWorkspace(root);
  assert.ok(result.diagnostics.some(({ code }) => code === "schedule-set-approval-after-cutover"));
});

test("approved staged successors preserve predecessor coverage at earlier cutover", () => {
  const { loaded, program } = fixture();
  const obligation = loaded.resources.find(({ id }) => id === "calendar");
  const predecessor = loaded.resources.find(({ id }) => id === "rule-calendar");
  predecessor.status = "retired";
  loaded.resources.push({ ...predecessor, id: "rule-successor", status: "active", supersedesId: predecessor.id, effectiveAt: "2099-12-01T00:00:00Z" });
  obligation.activeRuleId = "rule-successor";
  const review = { scopeResourceIds: [program.id], scheduleDecisions: [{ ...adopted, ruleId: "rule-successor" }, exclusion] };
  assert.deepEqual(scheduleSetIssues(loaded, program, review), []);
  assert.deepEqual(scheduleSetIssues(loaded, program, review, { at: "2026-10-12T00:00:00Z" }), []);
  assert.deepEqual(scheduleSetIssues(loaded, program, review, { at: "2099-12-01T00:00:00Z" }), []);
  predecessor.approvedByIds = [];
  assert.ok(scheduleSetIssues(loaded, program, review, { at: "2026-10-12T00:00:00Z" }).length);
});

test("replacement event coverage uses the rule effective at cutover", () => {
  const { loaded, program } = fixture();
  const obligation = loaded.resources.find(({ id }) => id === "calendar");
  const predecessor = loaded.resources.find(({ id }) => id === "rule-calendar");
  predecessor.status = "retired";
  loaded.resources.push({ ...predecessor, id: "rule-successor", status: "active", supersedesId: predecessor.id, effectiveAt: "2099-12-01T00:00:00Z", recurrence: { mode: "event", eventType: "incident-declared" } });
  obligation.activeRuleId = "rule-successor";
  const review = { scopeResourceIds: [program.id], scheduleDecisions: [{ ...adopted, ruleId: "rule-successor" }, { ...exclusion, disposition: "replaced", replacementObligationIds: ["calendar"] }] };
  assert.deepEqual(scheduleSetIssues(loaded, program, review), []);
  assert.ok(scheduleSetIssues(loaded, program, review, { at: "2026-10-13T00:00:00Z" }).some(({ message }) => /required incident-declared event/.test(message)));
  assert.deepEqual(scheduleSetIssues(loaded, program, review, { at: "2099-12-01T00:00:00Z" }), []);
});
