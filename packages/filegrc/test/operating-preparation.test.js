import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { makeComprehensiveWorkspace } from "./fixtures.js";
import { loadWorkspace } from "../src/workspace.js";
import { assessOperatingPreparation, firstOperatingTasks } from "../src/operating-preparation.js";
import { assessProgramReadiness } from "../src/program-readiness.js";
import { runCli } from "../src/cli.js";
import { captureCli } from "./helpers.js";

async function fixture(context) {
  const root = await mkdtemp(join(tmpdir(), "filegrc-operating-preparation-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "13");
  const loaded = await loadWorkspace(root);
  const program = loaded.resources.find(({ type }) => type === "program");
  const controls = loaded.resources.filter(({ type }) => type === "control");
  return { root, loaded, program, controls };
}

test("malformed procedure selection remains actionable repair work", async (context) => {
  const { loaded, program, controls } = await fixture(context);
  program.operatingOwnership = { procedureResourceIds: {} };
  const preparation = await assessOperatingPreparation(loaded, program, controls, "2026-10-13");
  assert.equal(preparation.ownership.complete, false);
  assert.equal(preparation.ownership.preparationChecks.find(({ id }) => id === "operating-procedure").complete, false);
});

test("preparation names missing source facts and reuses collected proof without a new independent verification", async (context) => {
  const { loaded, program, controls } = await fixture(context);
  delete program.candidateCoverage;
  const source = loaded.resources.find(({ type }) => type === "component");
  source.evidenceSourceKinds = ["workforce"];
  const coverage = loaded.resources.find(({ type }) => type === "source-coverage");
  Object.assign(coverage, { status: "active", sourceFamilyId: "workforce", coverageKind: "external-component", componentId: source.id,
    retrieverIds: ["person-example"], collectionCadence: "Export each week before expiry", reconciliationMethod: "Compare export filters and counts against the workforce view", validFrom: "2026-06-30" });
  let assessment = await assessOperatingPreparation(loaded, program, controls, "2026-10-13");
  let sourceCheck = assessment.baseline.find(({ sourceId }) => sourceId === source.id);
  assert.ok(sourceCheck.missingFacts.includes("readinessTestEvidenceIds"));
  assert.ok(sourceCheck.work.includes(source.title));
  assert.ok(sourceCheck.commands.some((command) => command.includes("scaffold evidence")));
  const evidence = loaded.resources.find(({ type }) => type === "evidence");
  Object.assign(evidence, { readinessTest: true, retrievalResult: "passed", accessConfirmed: true,
    coveredSourceFamilyIds: ["workforce"], sourceResourceIds: [coverage.id] });
  coverage.readinessTestEvidenceIds = [evidence.id];
  sourceCheck = (await assessOperatingPreparation(loaded, program, controls, "2026-10-13")).baseline.find(({ sourceId }) => sourceId === source.id);
  assert.ok(!sourceCheck.missingFacts.includes("readinessTestEvidenceIds"), "Existing valid Evidence verification is reused, including a permitted self-verifier");
  assert.ok(sourceCheck.missingFacts.includes("retentionScheduleItemIds"), "Retrieval alone does not establish preservation");
  coverage.validFrom = "2026-10-01";
  assert.ok((await assessOperatingPreparation(loaded, program, controls, "2026-10-13")).baseline.find(({ sourceId }) => sourceId === source.id).missingFacts.includes("readinessTestEvidenceIds"), "Retrieval must prove the effective source setup");
  coverage.validFrom = "2026-06-30";
  const newSystem = { ...loaded.resources.find(({ type }) => type === "system"), id: "system-expanded" };
  loaded.resources.push(newSystem); controls[0].systemIds.push(newSystem.id);
  assert.ok((await assessOperatingPreparation(loaded, program, controls, "2026-10-13")).baseline.find(({ sourceId }) => sourceId === source.id).missingFacts.includes("readinessTestEvidenceIds"), "A stable Source Coverage ID does not prove retrieval for expanded scope");
  evidence.systemIds.push(newSystem.id);
  assert.ok(!(await assessOperatingPreparation(loaded, program, controls, "2026-10-13")).baseline.find(({ sourceId }) => sourceId === source.id).missingFacts.includes("readinessTestEvidenceIds"));
  evidence.collectedOn = "2026-10-14";
  assert.ok((await assessOperatingPreparation(loaded, program, controls, "2026-10-13")).baseline.find(({ sourceId }) => sourceId === source.id).missingFacts.includes("readinessTestEvidenceIds"));
});

test("manual ownership reuses independent procedure approval and proof, and rejects changed procedure content", async (context) => {
  const { root, loaded, program, controls } = await fixture(context);
  const evidence = loaded.resources.find(({ type }) => type === "evidence");
  Object.assign(evidence, { verifierIds: ["person-independent-approver-example"], sourceResourceIds: ["document-example", "obligation-example"], readinessTest: true, retrievalResult: "passed" });
  program.operatingOwnership = {
    eventOwnerIds: ["person-example"], eventSourceComponentIds: ["component-example"], queueOwnerIds: ["person-example"],
    queueCheckCadence: "Every business day", reconciliationCadence: "Compare source exports each week",
    procedureDocumentId: "document-example", rehearsalEvidenceIds: [evidence.id]
  };
  assert.equal((await assessOperatingPreparation(loaded, program, controls, "2026-10-13")).ownership.complete, true);
  await writeFile(join(root, "data/documents/document-example.md"), "# Changed procedure\n\nRoute escalations to the newly appointed owner.\n");
  assert.equal((await assessOperatingPreparation(loaded, program, controls, "2026-10-13")).ownership.preparationChecks.find(({ id }) => id === "operating-procedure").complete, false);
});

test("fixed initial cycles retain their eligible remainder and active cutover dates", async (context) => {
  const { loaded, program } = await fixture(context);
  const rule = loaded.resources.find(({ type }) => type === "obligation-rule");
  const policy = loaded.resources.find(({ type }) => type === "policy");
  const obligation = loaded.resources.find(({ type }) => type === "obligation");
  Object.assign(rule, { effectiveAt: "2026-08-01T00:00:00Z", timezone: "UTC",
    recurrence: { mode: "calendar", unit: "month", interval: 1, anchorMode: "explicit", anchorDate: "2026-08-01" },
    window: { precision: "date", startOffsetDays: 0, dueAfter: 30, overdueAfter: 31 } });
  policy.effectiveOn = "2026-08-08";
  const before = JSON.stringify(loaded.resources);
  const preview = firstOperatingTasks(loaded, program, { effectiveOn: "2026-10-13" });
  const task = preview.tasks.find(({ obligationId }) => obligationId === obligation.id);
  assert.equal(task.dueWindowStart, "2026-08-08");
  assert.equal(task.dueWindowEnd, "2026-08-31");
  assert.ok(task.ownerIds.length);
  assert.ok(task.expectedMemberIds.length);
  assert.ok(task.completionResourceTypes.length);
  assert.equal(JSON.stringify(loaded.resources), before);
  const frozen = loaded.resources.find(({ type }) => type === "obligation-occurrence");
  Object.assign(frozen, { occurrenceKey: `${program.id}:${obligation.id}:2026-08-01`, programId: program.id,
    obligationId: obligation.id, ruleId: rule.id, coverage: { kind: "range", startsOn: "2026-08-01", endsOn: "2026-08-31" } });
  const preserved = firstOperatingTasks(loaded, program, { effectiveOn: "2026-10-13" }).tasks.find(({ obligationId }) => obligationId === obligation.id);
  assert.equal(preserved.occurrenceId, frozen.id);
  assert.equal(preserved.dueWindowStart, "2026-08-01", "A frozen historical cycle keeps its recorded dates");
});

test("browser assessment and CLI expose the same grouped preparation and first-task preview", async (context) => {
  const { root } = await fixture(context);
  const domain = await assessProgramReadiness(root, { asOf: "2026-10-13" });
  const result = await captureCli(runCli, ["program-readiness", "--root", root, "--as-of", "2026-10-13", "--json"]);
  const cli = JSON.parse(result.stdout);
  const tasks = (assessment) => assessment.stages.find(({ id }) => id === "controls").items
    .filter(({ id }) => ["prepare-baseline-evidence", "confirm-operating-ownership", "collection-review-obligation"].includes(id));
  assert.deepEqual(tasks(cli), tasks(domain));
  assert.equal(tasks(domain).filter(({ status }) => status !== "complete").length, 3);
  assert.equal(domain.canStartCandidatePeriod, false);
});

test("baseline test readiness requires dated execution for the population, separate from applicability and recurring completion", async (context) => {
  const { loaded, program, controls } = await fixture(context);
  const obligation = loaded.resources.find(({ type }) => type === "obligation");
  const rule = loaded.resources.find(({ type }) => type === "obligation-rule");
  Object.assign(obligation, { activityType: "backup-test", scopeResourceIds: ["system-example"] });
  Object.assign(rule, { recurrence: { mode: "calendar", unit: "year", interval: 1, anchorMode: "activation" },
    selector: { resourceType: "system", statuses: ["active"], membershipMode: "as-of", cutoff: "window-start" } });
  const baseline = () => assessOperatingPreparation(loaded, program, controls, "2026-10-13")
    .then(({ baseline }) => baseline.find(({ obligationId }) => obligationId === obligation.id));
  assert.equal((await baseline()).complete, false);
  const result = loaded.resources.find(({ type }) => type === "backup-test");
  const evidence = loaded.resources.find(({ type }) => type === "evidence");
  Object.assign(result, { completedAt: "2026-07-01T12:00:00Z", outcome: "passed", reviewerIds: ["person-independent-approver-example"] });
  evidence.verifierIds = ["person-independent-approver-example"];
  assert.equal((await baseline()).complete, true);
  assert.ok((await baseline()).resultIds.includes(result.id));
  assert.equal(firstOperatingTasks(loaded, program, { effectiveOn: "2026-10-13" }).tasks[0].completionResourceIds.length, 0,
    "A prepared baseline is not an automatic completion of a later occurrence");
  result.systemIds = ["unrelated-system"];
  assert.equal((await baseline()).complete, false);
});

test("v12 stays unchanged and v13 migration preserves records, dates and reviews", async (context) => {
  const { root } = await fixture(context);
  const { readFile } = await import("node:fs/promises");
  const { initializeExistingModel12Workspace } = await import("./helpers.js");
  const { planModelMigration, migrateModel } = await import("../src/model-migration.js");
  const workspacePath = join(root, "data/workspace.json");
  const workspace = JSON.parse(await readFile(workspacePath, "utf8"));
  await writeFile(workspacePath, JSON.stringify({ ...workspace, dataModelVersion: "12" }));
  await initializeExistingModel12Workspace(root);
  const before = await loadWorkspace(root);
  const snapshots = new Map(before.entries.map((entry) => [entry.record.id, entry.source]));
  const legacyReadiness = await assessProgramReadiness(root);
  assert.equal(legacyReadiness.stages.flatMap(({ items }) => items).some(({ preparationChecks }) => preparationChecks), false);
  const plan = await planModelMigration(root, { targetModelVersion: "13" });
  assert.equal(plan.ready, true);
  assert.equal(plan.changes.update.length, 1);
  assert.equal(plan.changes.update[0].type, "workspace");
  assert.ok(plan.classifications.reviewRequired.some(({ resourceId }) => resourceId === "program-example"));
  assert.equal((await loadWorkspace(root)).workspace.dataModelVersion, "12", "Preview does not write");
  await migrateModel(root, { targetModelVersion: "13" });
  const after = await loadWorkspace(root);
  assert.equal(after.workspace.dataModelVersion, "13");
  for (const entry of after.entries.filter(({ record }) => record.type !== "workspace")) assert.equal(entry.source, snapshots.get(entry.record.id));
  const readiness = await assessProgramReadiness(root);
  assert.equal(readiness.preparationPhase, "current-remediation");
  assert.ok(readiness.stages.flatMap(({ items }) => items).some(({ preparationChecks }) => preparationChecks));
});

test("baseline work combines existing member results instead of requiring a new combined test", async (context) => {
  const { loaded, program, controls } = await fixture(context);
  const second = { ...loaded.resources.find(({ type }) => type === "system"), id: "system-second" };
  loaded.resources.push(second); program.systemIds.push(second.id); controls[0].systemIds.push(second.id);
  const obligation = loaded.resources.find(({ type }) => type === "obligation");
  const rule = loaded.resources.find(({ type }) => type === "obligation-rule");
  Object.assign(obligation, { activityType: "backup-test", scopeResourceIds: ["system-example", second.id] });
  Object.assign(rule, { recurrence: { mode: "calendar", unit: "year", interval: 1, anchorMode: "activation" }, selector: { resourceType: "system", statuses: ["active"], membershipMode: "as-of", cutoff: "window-start" } });
  const first = loaded.resources.find(({ type }) => type === "backup-test");
  Object.assign(first, { completedAt: "2026-07-01T12:00:00Z", outcome: "passed" });
  const secondResult = { ...first, id: "backup-test-second", systemIds: [second.id] };
  const firstTask = firstOperatingTasks(loaded, program, { effectiveOn: "2026-10-13" }).tasks.find(({ obligationId }) => obligationId === obligation.id);
  const frozen = loaded.resources.find(({ type }) => type === "obligation-occurrence");
  Object.assign(frozen, { occurrenceKey: firstTask.occurrenceKey, coverage: { kind: "range", startsOn: firstTask.dueWindowStart, endsOn: firstTask.dueWindowEnd },
    members: [{ resourceId: "system-example", disposition: "expected", result: "passed", completionResourceIds: [first.id] }] });
  assert.deepEqual(firstOperatingTasks(loaded, program, { effectiveOn: "2026-10-13" }).tasks.find(({ obligationId }) => obligationId === obligation.id).expectedMemberIds, ["system-example"]);
  assert.equal((await assessOperatingPreparation(loaded, program, controls, "2026-10-13")).baseline.find(({ obligationId }) => obligationId === obligation.id).complete, false, "Preparation covers added members while preserving the frozen occurrence");
  loaded.resources.push(secondResult);
  const result = (await assessOperatingPreparation(loaded, program, controls, "2026-10-13")).baseline.find(({ obligationId }) => obligationId === obligation.id);
  assert.equal(result.complete, true);
  loaded.resources.find(({ type }) => type === "evidence").status = "withdrawn";
  assert.equal((await assessOperatingPreparation(loaded, program, controls, "2026-10-13")).baseline.find(({ obligationId }) => obligationId === obligation.id).complete, false, "Withdrawn supporting proof cannot establish baseline execution");
  assert.deepEqual(result.resultIds.sort(), [first.id, secondResult.id].sort());
});

 test("actual operation Evidence must name the adopted activity", async (context) => {
  const { loaded } = await fixture(context);
  const { assessCompletionForObligation } = await import("../src/obligations.js");
  const obligation = loaded.resources.find(({ type }) => type === "obligation");
  obligation.activityType = "alert-path-test";
  const proof = loaded.resources.find(({ type }) => type === "evidence");
  Object.assign(proof, { artifactSubtype: "alert-path-test", businessEventAt: "2026-07-01T12:00:00Z", operatingResult: "passed" });
  assert.equal(assessCompletionForObligation(proof, obligation, loaded, { asOf: "2026-10-13", memberIds: ["system-example"] }).complete, true);
  delete proof.artifactSubtype;
  assert.equal(assessCompletionForObligation(proof, obligation, loaded, { asOf: "2026-10-13", memberIds: ["system-example"] }).complete, false);
 });

 test("generic CLI guides remain available with multiple Programs", async (context) => {
  const { root, loaded, program } = await fixture(context);
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(root, "data/programs"), { recursive: true });
  await writeFile(join(root, "data/programs/program-second.json"), JSON.stringify({ ...program, id: "program-second" }));
  const output = await captureCli(runCli, ["guide", "evidence", "--root", root, "--json"]);
  assert.equal(JSON.parse(output.stdout).type, "evidence");
  const scoped = await captureCli(runCli, ["guide", "program", "--program", program.id, "--root", root, "--json"]);
  assert.ok(JSON.parse(scoped.stdout).preparationChecks.length);
 });

 test("expired current proof does not reopen a frozen reconciled occurrence", async (context) => {
  const { loaded, program, controls } = await fixture(context);
  const { planObligations } = await import("../src/obligations.js");
  const obligation = loaded.resources.find(({ type }) => type === "obligation");
  const rule = loaded.resources.find(({ type }) => type === "obligation-rule");
  Object.assign(obligation, { activityType: "backup-test", scopeResourceIds: ["system-example"] });
  Object.assign(rule, { recurrence: { mode: "calendar", unit: "year", interval: 1, anchorMode: "activation" }, selector: { resourceType: "system", statuses: ["active"], membershipMode: "as-of", cutoff: "window-start" } });
  const task = firstOperatingTasks(loaded, program, { effectiveOn: "2026-10-13" }).tasks.find(({ obligationId }) => obligationId === obligation.id);
  const completion = loaded.resources.find(({ type }) => type === "backup-test");
  Object.assign(completion, { completedAt: "2026-07-01T12:00:00Z", outcome: "passed" });
  const occurrence = loaded.resources.find(({ type }) => type === "obligation-occurrence");
  Object.assign(occurrence, { occurrenceKey: task.occurrenceKey, coverage: { kind: "range", startsOn: task.dueWindowStart, endsOn: task.dueWindowEnd },
    reconciledAt: "2026-07-01T15:00:00Z", members: [{ resourceId: "system-example", disposition: "expected", result: "passed", completionResourceIds: [completion.id] }] });
  loaded.resources.find(({ type }) => type === "evidence").expiresOn = "2026-07-01";
  const queue = planObligations(loaded.resources, { model: loaded.model, workspace: loaded.workspace, program, asOf: "2026-10-13", from: "2026-01-01", through: "2026-12-31", includeComplete: true });
  assert.equal(queue.items.find(({ occurrenceId }) => occurrenceId === occurrence.id).status, "complete");
  assert.equal((await assessOperatingPreparation(loaded, program, controls, "2026-10-13")).baseline.find(({ obligationId }) => obligationId === obligation.id).complete, false);
 });

 test("operating review must have occurred by the assessment date", async (context) => {
  const { loaded } = await fixture(context);
  const { assessCompletionForObligation } = await import("../src/obligations.js");
  const obligation = loaded.resources.find(({ type }) => type === "obligation");
  obligation.activityType = "vulnerability-scan";
  const scan = loaded.resources.find(({ type }) => type === "vulnerability-scan");
  const options = { asOf: "2026-10-13", memberIds: ["component-example"] };
  assert.equal(assessCompletionForObligation(scan, obligation, loaded, options).complete, true);
  scan.reviewedOn = "2099-01-01";
  assert.equal(assessCompletionForObligation(scan, obligation, loaded, options).complete, false);
 });

 test("baseline execution date is independent of coverage and accepts scoped Control Tests", async (context) => {
  const { loaded } = await fixture(context);
  const { assessCompletionForObligation } = await import("../src/obligations.js");
  const obligation = loaded.resources.find(({ type }) => type === "obligation");
  const penetration = loaded.resources.find(({ type }) => type === "penetration-test");
  obligation.activityType = "penetration-test";
  penetration.completedOn = "2026-01-01";
  const result = assessCompletionForObligation(penetration, obligation, loaded, { asOf: "2026-10-13", notBefore: "2026-06-30", memberIds: ["system-example"] });
  assert.equal(result.date, "2026-01-01");
  assert.equal(result.complete, false);
  const controlTest = loaded.resources.find(({ type }) => type === "control-test");
  obligation.activityType = "alert-path-test";
  assert.equal(assessCompletionForObligation(controlTest, obligation, loaded, { asOf: "2026-10-13", memberIds: ["control-example"] }).complete, true);
  assert.equal(assessCompletionForObligation(controlTest, obligation, loaded, { asOf: "2026-10-13", memberIds: ["control-exam"] }).complete, false, "Scalar scope IDs match exactly");
  controlTest.outcome = "failed";
  assert.equal(assessCompletionForObligation(controlTest, obligation, loaded, { asOf: "2026-10-13", memberIds: ["control-example"] }).complete, false);
 });

test("an applicability label cannot substitute for executing an adopted test activity", async (context) => {
  const { loaded, program, controls } = await fixture(context);
  const obligation = loaded.resources.find(({ type }) => type === "obligation");
  const rule = loaded.resources.find(({ type }) => type === "obligation-rule");
  Object.assign(obligation, { activityType: "backup-test", scopeResourceIds: ["system-example"] });
  Object.assign(rule, { preparationPurpose: "applicability-review", recurrence: { mode: "calendar", unit: "year", interval: 1, anchorMode: "activation" },
    selector: { resourceType: "system", statuses: ["active"], membershipMode: "as-of", cutoff: "window-start" } });
  const task = firstOperatingTasks(loaded, program, { effectiveOn: "2026-10-13" }).tasks.find(({ obligationId }) => obligationId === obligation.id);
  assert.equal(task.requiredTest, true);
  assert.equal(task.preparationPurpose, "test-execution");
  const baseline = (await assessOperatingPreparation(loaded, program, controls, "2026-10-13")).baseline.find(({ obligationId }) => obligationId === obligation.id);
  assert.equal(baseline.complete, false);
});

test("System scan baselines and CLI reuse component-scoped execution without weakening proof or dates", async (context) => {
  const { root, loaded, program, controls } = await fixture(context);
  const { assessCompletionForObligation } = await import("../src/obligations.js");
  const { resourceDataPath } = await import("../src/resource-markdown.js");
  const obligation = loaded.resources.find(({ type }) => type === "obligation");
  const rule = loaded.resources.find(({ type }) => type === "obligation-rule");
  const scan = loaded.resources.find(({ type }) => type === "vulnerability-scan");
  scan.completedAt = "2026-07-01T12:00:00Z";
  Object.assign(obligation, { activityType: "vulnerability-scan", scopeResourceIds: ["system-example"] });
  Object.assign(rule, { recurrence: { mode: "calendar", unit: "year", interval: 1, anchorMode: "activation" },
    selector: { resourceType: "system", statuses: ["active"], membershipMode: "as-of", cutoff: "window-start" } });
  const baseline = () => assessOperatingPreparation(loaded, program, controls, "2026-10-13")
    .then(({ baseline }) => baseline.find(({ obligationId }) => obligationId === obligation.id));
  assert.equal((await baseline()).complete, true, JSON.stringify(await baseline()));
  assert.ok((await baseline()).resultIds.includes(scan.id));
  for (const record of [obligation, rule, scan]) {
    await writeFile(join(root, "data", resourceDataPath(loaded.model, record)), JSON.stringify(record));
  }
  const cli = JSON.parse((await captureCli(runCli, ["program-readiness", "--root", root, "--json"])).stdout);
  const cliBaseline = cli.stages.flatMap(({ items }) => items).flatMap(({ preparationChecks }) => preparationChecks || []).find(({ id }) => id === `baseline-${obligation.id}`);
  assert.equal(cliBaseline.complete, true);
  const options = { asOf: "2026-10-13", memberIds: ["system-example"] };
  scan.reviewedOn = "2099-01-01";
  assert.equal(assessCompletionForObligation(scan, obligation, loaded, options).complete, false);
  scan.reviewedOn = "2026-07-01";
  scan.status = "running";
  assert.equal(assessCompletionForObligation(scan, obligation, loaded, options).complete, false);
  scan.status = "complete";
  const proof = loaded.resources.find(({ type }) => type === "evidence");
  proof.status = "withdrawn";
  assert.equal(assessCompletionForObligation(scan, obligation, loaded, options).complete, false);
});
