import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { withGitCommandDeadline } from "../src/git.js";
import { assessProgramAccessReview, providerAccessControls } from "../src/provider-access-completion.js";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { makeComprehensiveWorkspace } from "./fixtures.js";
import { reviewHistoryContext } from "../src/historical-workspace.js";
import { loadWorkspace } from "../src/workspace.js";
import { assessOperatingPreparation } from "../src/operating-preparation.js";
import { contentRevision } from "../src/files.js";
import { markdownEntries, resourceDataPath } from "../src/resource-markdown.js";
import { assessProgramReadiness } from "../src/program-readiness.js";
import { runCli } from "../src/cli.js";
import { captureCli } from "./helpers.js";
import { planModelMigration } from "../src/model-migration.js";
import { assessCompletionForObligation, planObligations } from "../src/obligations.js";

async function fixture(context, code) {
  const root = await mkdtemp(join(tmpdir(), "filegrc-full-baseline-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "13");
  const loaded = await loadWorkspace(root);
  const program = loaded.resources.find(({ type }) => type === "program");
  const controls = loaded.resources.filter(({ type }) => type === "control");
  controls[0].code = code;
  await writeFile(join(root, "data", resourceDataPath(loaded.model, controls[0])), JSON.stringify(controls[0]));
  const get = (type) => loaded.resources.find((record) => record.type === type);
  const baseline = (id) => assessOperatingPreparation(loaded, program, controls, "2026-10-13")
    .then(({ baseline }) => baseline.find((check) => check.id === `baseline-${id}`));
  const person = get("person"); person.affiliation = "internal";
  await writeFile(join(root, "data", resourceDataPath(loaded.model, person)), JSON.stringify(person));
  return { root, loaded, program, controls, get, baseline };
}

async function bind(loaded, subject) {
  const revisions = {};
  for (const { path } of markdownEntries(loaded.model, subject)) revisions[path] = contentRevision(await readFile(join(loaded.root, "data", path), "utf8"));
  return revisions;
}

test("malformed baseline candidates remain repairable instead of crashing readiness", async (context) => {
  const { loaded, get, baseline, controls } = await fixture(context, "IAM-01");
  get("access-review").grantDecisions = {};
  assert.equal((await baseline("provider-access")).complete, false);
  assert.deepEqual((await baseline("provider-access")).missingFacts, ["valid-access-review"]);
  controls[0].code = "RSK-01";
  get("risk-assessment").systemIds = {};
  assert.deepEqual((await baseline("program-risk")).missingFacts, ["valid-risk-assessment"]);
  controls[0].code = "HR-02";
  get("training").controlIds = [controls[0].id];
  get("attestation").subjectResourceIds = {};
  loaded.workspace = null;
  assert.equal((await baseline("workforce-training")).complete, false);
  get("training").controlIds = {};
  assert.equal((await baseline("workforce-training")).complete, false);
});

test("full risk baseline rejects narrow, unfinished, unreviewed and rehearsal-only work", async (context) => {
  const { loaded, get, baseline } = await fixture(context, "RSK-01");
  const risk = get("risk-assessment");
  const initial = await baseline("program-risk");
  for (const [field, ids] of Object.entries(initial.scope)) risk[field] = ids;
  Object.assign(risk, { assessmentKind: "enterprise-risk", completedOn: "2026-07-01", approvedOn: "2026-07-02",
    assessorIds: ["person-example"], reviewerIds: ["person-independent-approver-example"] });
  assert.equal((await baseline("program-risk")).complete, true);
  risk.systemIds = [];
  assert.ok((await baseline("program-risk")).candidateResults[0].missingScopeIds.includes("system-example"));
  risk.systemIds = initial.scope.systemIds;
  risk.componentIds = [];
  assert.equal((await baseline("program-risk")).complete, false);
  risk.componentIds = initial.scope.componentIds;
  risk.assessmentKind = "vendor-risk";
  assert.equal((await baseline("program-risk")).complete, false);
  risk.assessmentKind = "enterprise-risk";
  risk.status = "in-progress";
  assert.equal((await baseline("program-risk")).complete, false);
  risk.status = "complete";
  risk.approvedOn = "2026-10-14";
  assert.equal((await baseline("program-risk")).complete, false);
  risk.approvedOn = "2026-07-02";
  get("evidence").readinessTest = true;
  assert.equal((await baseline("program-risk")).complete, false);
});

test("risk baseline accepts supporting rehearsals alongside real proof without weakening evidence validity", async (context) => {
  const { loaded, get, baseline } = await fixture(context, "RSK-01");
  const assessment = get("risk-assessment");
  const initial = await baseline("program-risk");
  for (const [field, ids] of Object.entries(initial.scope)) assessment[field] = ids;
  Object.assign(assessment, { assessmentKind: "enterprise-risk", completedOn: "2026-07-01", approvedOn: "2026-07-02",
    assessorIds: ["person-example"], reviewerIds: ["person-independent-approver-example"] });
  const actual = get("evidence");
  const rehearsal = { ...actual, id: "evidence-supporting-rehearsal", readinessTest: true };
  loaded.resources.push(rehearsal);
  assessment.evidenceIds = [actual.id, rehearsal.id];
  assert.equal((await baseline("program-risk")).complete, true);
  assessment.evidenceIds.reverse();
  assert.equal((await baseline("program-risk")).complete, true, "Proof order does not change eligibility");
  assessment.evidenceIds = [rehearsal.id];
  assert.equal((await baseline("program-risk")).complete, false, "Rehearsals alone never prove completion");
  assessment.evidenceIds = [actual.id, rehearsal.id];
  actual.status = "draft";
  assert.equal((await baseline("program-risk")).complete, false, "A rehearsal cannot substitute for unfinished operating proof");
  actual.status = "collected";
  rehearsal.expiresOn = "2026-10-12";
  assert.equal((await baseline("program-risk")).complete, false, "Expired supporting artifacts still need resolution");
  delete rehearsal.expiresOn;
  rehearsal.collectorIds = ["person-not-present"];
  assert.equal((await baseline("program-risk")).complete, false, "Invalid supporting artifacts cannot be ignored");
  rehearsal.collectorIds = actual.collectorIds;
  assessment.evidenceIds.push("evidence-missing");
  assert.equal((await baseline("program-risk")).complete, false, "Broken references never establish completion");
});

test("selected Controls choose baseline work, and current workforce needs current subject completion", async (context) => {
  const { loaded, get, baseline, controls } = await fixture(context, "HR-02");
  const training = get("training");
  training.controlIds = [controls[0].id];
  const attestation = get("attestation");
  Object.assign(attestation, { subjectResourceIds: [training.id], completedOn: "2026-07-01", attestationMethod: "git-approval",
    contentRevisions: await bind(loaded, training) });
  assert.equal((await baseline("workforce-training")).complete, true);
  assert.equal(await baseline("provider-access"), undefined);
  const hire = { ...get("person"), id: "person-new-hire", title: "New worker", startDate: "2026-10-01" };
  loaded.resources.push(hire);
  let result = await baseline("workforce-training");
  assert.deepEqual(result.missingMembers.map(({ personId }) => personId), [hire.id]);
  const newAttestation = { ...attestation, id: "attestation-new-hire", personId: hire.id, completedOn: "2026-10-02" };
  loaded.resources.push(newAttestation);
  assert.equal((await baseline("workforce-training")).complete, true);
  newAttestation.completedOn = "2026-09-30";
  assert.equal((await baseline("workforce-training")).complete, false);
  newAttestation.completedOn = "2026-10-02";
  newAttestation.contentRevisions = {};
  assert.equal((await baseline("workforce-training")).complete, false);
  newAttestation.contentRevisions = { ...attestation.contentRevisions };
  newAttestation.expiresOn = "2026-10-12";
  assert.equal((await baseline("workforce-training")).complete, false);
  controls[0].code = "HR-01";
  const policy = get("policy");
  attestation.subjectResourceIds = [policy.id]; attestation.contentRevisions = await bind(loaded, policy);
  hire.status = "inactive";
  assert.equal((await baseline("workforce-acknowledgements")).complete, true);
  attestation.subjectResourceIds = [training.id];
  assert.equal((await baseline("workforce-acknowledgements")).complete, false);
});

test("provider baseline requires actual reconciled exports and decisions, including service accounts and zero populations", async (context) => {
  const { loaded, get, baseline } = await fixture(context, "IAM-01");
  const review = get("access-review"), grant = get("access-grant"), proof = get("evidence");
  Object.assign(review, { completedOn: "2026-07-01", approvedOn: "2026-07-02", populationCount: 1, exceptionCount: 0,
    grantDecisions: [{ accessGrantId: grant.id, decision: "retain" }] });
  Object.assign(proof, { artifactKind: "population-export", sourceKind: "component", sourceComponentId: get("component").id,
    collectedOn: "2026-07-01", verifiedOn: "2026-07-01", generatedAt: "2026-07-01T10:00:00Z", timezone: "UTC", queryDescription: "All accounts, including service accounts, in the scoped provider",
    populationCount: 1, completenessValidation: "Compared all account classes with the provider totals", accuracyValidation: "Checked identifiers and permissions against provider records",
    coverage: { kind: "as-of", on: "2026-07-01" } });
  delete proof.filePaths;
  let result = await baseline("provider-access");
  assert.equal(result.complete, true, JSON.stringify(result.candidateResults));
  review.grantDecisions[0].decision = "remove";
  assert.equal((await baseline("provider-access")).complete, false, "Unnecessary access cannot pass while still active with no approved exception and remediation");
  const exception = get("exception");
  Object.assign(exception, { status: "approved", scopeResourceIds: [grant.id], ownerIds: ["person-example"],
    rationale: "Temporary approved access while the removal is performed", approval: { approvedByIds: ["person-independent-approver-example"], approvedOn: "2026-07-02", expiresOn: "2026-12-31" } });
  const action = get("action-item");
  Object.assign(action, { status: "open", sourceResourceId: exception.id, assigneeIds: ["person-example"],
    completionWindow: { precision: "date", startsOn: "2026-07-02", dueOn: "2026-12-15", overdueOn: "2026-12-16" } });
  delete action.completedOn;
  review.outcome = "passed-with-exceptions"; review.exceptionCount = 1;
  assert.equal((await baseline("provider-access")).complete, true, "An existing approved departure with owned, timely remediation is reused");
  exception.approval.expiresOn = "2026-10-12";
  assert.equal((await baseline("provider-access")).complete, false);
  exception.approval.expiresOn = "2026-12-31"; action.assigneeIds = [];
  assert.equal((await baseline("provider-access")).complete, false);
  action.assigneeIds = ["person-example"]; review.outcome = "passed"; review.exceptionCount = 0;
  review.grantDecisions[0].decision = "retain";
  proof.readinessTest = true;
  assert.equal((await baseline("provider-access")).complete, false);
  proof.readinessTest = false;
  proof.populationCount = 2;
  assert.equal((await baseline("provider-access")).complete, false, "An orphan provider account cannot silently pass");
  const serviceGrant = { ...grant, id: "access-grant-service", subjectId: get("service-account").id };
  loaded.resources.push(serviceGrant); review.populationCount = 2;
  assert.equal((await baseline("provider-access")).complete, false, "A service account needs its own decision");
  review.grantDecisions.push({ accessGrantId: serviceGrant.id, decision: "retain" });
  assert.equal((await baseline("provider-access")).complete, true);
  Object.assign(serviceGrant, { status: "revoked", deprovisionedOn: "2026-07-02", deprovisionedByIds: ["person-example"], deprovisionReason: "Removed access after review" });
  review.grantDecisions[1].decision = "remove";
  assert.equal((await baseline("provider-access")).complete, true, "Actual removed grants remain part of a completed review's fixed population; do not require a duplicate review");
  grant.status = "revoked"; serviceGrant.status = "revoked";
  review.grantDecisions = []; review.populationCount = 0; proof.populationCount = 0;
  assert.equal((await baseline("provider-access")).complete, true, "Checked real zero exports are accepted");
  review.evidenceIds = [];
  assert.equal((await baseline("provider-access")).complete, false);
});

test("ownership reuses implemented Control procedures without a separate Document or new approval", async (context) => {
  const { root, loaded, program, controls, get } = await fixture(context, "IAM-01");
  const control = controls[0];
  Object.assign(control, { status: "implemented", procedureRevision: "current-procedure", procedureEffectiveOn: "2026-06-15" });
  const evidence = get("evidence");
  Object.assign(evidence, { sourceResourceIds: [control.id, "obligation-example"], readinessTest: true, retrievalResult: "passed" });
  program.operatingOwnership = { eventOwnerIds: ["person-example"], eventSourceComponentIds: ["component-example"],
    queueOwnerIds: ["person-example"], queueCheckCadence: "Every business day", reconciliationCadence: "Weekly source comparison", rehearsalEvidenceIds: [evidence.id] };
  const assess = () => assessOperatingPreparation(loaded, program, controls, "2026-10-13");
  assert.equal((await assess()).ownership.complete, true);
  assert.equal(program.operatingOwnership.procedureDocumentId, undefined);
  assert.deepEqual((await assess()).ownership.preparationChecks.find(({ id }) => id === "operating-procedure").procedureIds, [control.id]);
  control.procedureEffectiveOn = "2026-10-01";
  assert.equal((await assess()).ownership.complete, false, "Material procedure changes need a current rehearsal");
  control.procedureEffectiveOn = "2026-06-15";
  const [{ path }] = markdownEntries(loaded.model, control);
  await writeFile(join(root, "data", path), "# Procedure\n\nTODO\n");
  assert.equal((await assess()).ownership.complete, false);
});

test("v13 CLI and domain share actionable baseline gaps without a new model migration", async (context) => {
  const { root } = await fixture(context, "HR-01");
  const domain = await assessProgramReadiness(root, { asOf: "2026-10-13" });
  const cli = JSON.parse((await captureCli(runCli, ["program-readiness", "--root", root, "--as-of", "2026-10-13", "--json"])).stdout);
  assert.deepEqual(cli.stages, domain.stages);
  const workflow = JSON.parse((await captureCli(runCli, ["workflow", "--root", root, "--json"])).stdout);
  const coverage = workflow.findings.find(({ code }) => code === "evidence-source.workforce.coverage");
  assert.match(coverage.message, /Check access, export filters and counts/);
  assert.match(coverage.message, /before activation or observation start/);
  assert.doesNotMatch(coverage.message, /after setting a candidate period/);
  const before = await loadWorkspace(root);
  assert.equal(before.workspace.dataModelVersion, "13");
  const plan = await planModelMigration(root);
  assert.equal(plan.targetModelVersion, "13");
  assert.deepEqual(plan.changes.create, []);
  assert.deepEqual(plan.changes.update, []);

});

test("external completion binds current subjects without inventing bindings on historical attestations", async (context) => {
  const { root, loaded, get, baseline } = await fixture(context, "HR-02");
  const training = get("training"); training.controlIds = [get("control").id];
  const { resourceDataPath } = await import("../src/resource-markdown.js");
  await writeFile(join(root, "data", resourceDataPath(loaded.model, training)), JSON.stringify(training));
  const source = get("attestation");
  const record = { ...source, id: "attestation-external-training", subjectResourceIds: [training.id],
    attestationMethod: "external-record", completedOn: "2026-07-01", evidenceIds: [get("evidence").id] };
  delete record.contentRevisions;
  const mutationPath = join(root, "external-completion.json");
  await writeFile(mutationPath, JSON.stringify({ record, content: {} }));
  const result = await captureCli(runCli, ["create", mutationPath, "--root", root, "--json"]);
  assert.equal(result.stderr, "");
  const saved = (await loadWorkspace(root)).resources.find(({ id }) => id === record.id);
  assert.deepEqual(saved.contentRevisions, await bind(loaded, training));
  loaded.resources.push(saved);
  assert.equal((await baseline("workforce-training")).complete, true);
  delete saved.contentRevisions;
  await writeFile(join(root, "data", resourceDataPath(loaded.model, saved)), JSON.stringify(saved));
  const { updateResource } = await import("../src/files.js");
  await updateResource(root, "attestation", saved.id, saved);
  const historical = (await loadWorkspace(root)).resources.find(({ id }) => id === saved.id);
  assert.equal(historical.contentRevisions, undefined, "Resaving historical completion must not fabricate current acknowledgement");
});

test("baseline reuse respects adopted calendar windows instead of a blanket freshness interval", async (context) => {
  const { loaded, get, baseline } = await fixture(context, "RSK-01");
  const assessment = get("risk-assessment");
  const initial = await baseline("program-risk");
  for (const [field, ids] of Object.entries(initial.scope)) assessment[field] = ids;
  Object.assign(assessment, { assessmentKind: "enterprise-risk", completedOn: "2026-07-01", approvedOn: "2026-07-02",
    assessorIds: ["person-example"], reviewerIds: ["person-independent-approver-example"] });
  assert.equal((await baseline("program-risk")).complete, true);
  get("obligation").activityType = "risk-assessment";
  Object.assign(get("obligation-rule"), { recurrence: { mode: "calendar", unit: "month", interval: 3, anchorMode: "explicit", anchorDate: "2026-07-01" },
    effectiveAt: "2026-07-01T00:00:00Z", window: { precision: "date", startOffsetDays: 0, dueAfter: 89, overdueAfter: 90 } });
  let result = await baseline("program-risk");
  assert.equal(result.complete, false, "A completed result in the previous approved period cannot complete current baseline work");
  assert.equal(result.completionWindows[0].startsOn, "2026-10-01");
  assessment.completedOn = "2026-10-05"; assessment.approvedOn = "2026-10-06";
  assert.equal((await baseline("program-risk")).complete, true);
});

test("role training and external audiences stay specific to their adopted subject", async (context) => {
  const { root, loaded, get, controls, baseline } = await fixture(context, "HR-02");
  const general = get("training"); general.controlIds = [controls[0].id];
  const roleCourse = { ...general, id: "training-developer", title: "Developer security training", audience: ["Developers"] };
  loaded.resources.push(roleCourse);
  for (const { path } of markdownEntries(loaded.model, roleCourse)) await writeFile(join(root, "data", path), await readFile(join(root, "data", markdownEntries(loaded.model, general)[0].path), "utf8"));
  roleCourse.approvedContentRevisions = await bind(loaded, roleCourse);
  const sales = { ...get("person"), id: "person-sales", title: "Sales worker" }; loaded.resources.push(sales);
  const obligation = { ...get("obligation"), id: "obligation-developer-training", activityType: "role-training", scopeResourceIds: ["person-example"], templateResourceId: roleCourse.id, activeRuleId: "obligation-rule-developer", ruleIds: ["obligation-rule-developer"] };
  const rule = { ...get("obligation-rule"), id: "obligation-rule-developer", obligationId: obligation.id, scopeResourceIds: ["person-example"], templateResourceId: roleCourse.id };
  delete rule.selector;
  loaded.resources.push(obligation, rule);
  let result = await baseline("workforce-training");
  assert.deepEqual(result.subjectPopulations.find(({ subjectId }) => subjectId === roleCourse.id).personIds, ["person-example"]);
  assert.ok(result.subjectPopulations.find(({ subjectId }) => subjectId === general.id).personIds.includes(sales.id));
  assert.ok(!result.missingMembers.some(({ personId, subjectId }) => personId === sales.id && subjectId === roleCourse.id));
  rule.scopeResourceIds.push("person-independent-approver-example");
  result = await baseline("workforce-training");
  assert.ok(result.subjectPopulations.find(({ subjectId }) => subjectId === roleCourse.id).personIds.includes("person-independent-approver-example"));
  assert.ok(!result.subjectPopulations.find(({ subjectId }) => subjectId === general.id).personIds.includes("person-independent-approver-example"));
});

test("provider baseline reconciles actual account rows separately from grants and exposes the same CLI guidance", async (context) => {
  const { root, loaded, get, baseline } = await fixture(context, "IAM-01");
  const review = get("access-review"), grant = get("access-grant"), proof = get("evidence"), service = get("service-account");
  const component = get("component");
  Object.assign(service, { componentIds: [component.id], ownerIds: [get("person").id] });
  Object.assign(review, { completedOn: "2026-07-01", approvedOn: "2026-07-02", populationCount: 3, exceptionCount: 0,
    grantDecisions: [{ accessGrantId: grant.id, decision: "retain" }], sourceReconciliations: [{ componentId: component.id,
      boundary: "direct", populationEvidenceId: proof.id, accounts: [
        { accountReference: "row-1", disposition: "authorized", subjectId: grant.subjectId, authorizationKind: "access-grant", accessGrantIds: [grant.id] },
        { accountReference: "row-2", disposition: "authorized", subjectId: service.id, authorizationKind: "service-account-inventory" },
        { accountReference: "row-3", disposition: "provider-managed", rationale: "Provider-owned service role with no customer-managed human login; reviewed trust boundary" }
      ] }] });
  Object.assign(proof, { artifactKind: "population-export", sourceKind: "component", sourceComponentId: component.id,
    collectedOn: "2026-07-01", verifiedOn: "2026-07-01", generatedAt: "2026-07-01T10:00:00Z", timezone: "UTC", externalReference: { url: "https://evidence.example.com/provider-accounts" }, queryDescription: "Authenticated UI observation of all account classes; all pages inspected; owner confirmed completeness",
    populationCount: 3, completenessValidation: "Compared all account classes and page totals with provider UI", accuracyValidation: "Checked account owners and permissions against provider detail",
    coverage: { kind: "as-of", on: "2026-07-01" } });
  delete proof.filePaths;
  assert.equal((await baseline("provider-access")).complete, true, JSON.stringify((await baseline("provider-access")).candidateResults));
  for (const record of [review, proof, service]) await writeFile(join(root, "data", resourceDataPath(loaded.model, record)), JSON.stringify(record));
  const cli = JSON.parse((await captureCli(runCli, ["program-readiness", "--root", root, "--json"])).stdout);
  const cliCheck = cli.stages.flatMap(({ items }) => items).flatMap(({ preparationChecks }) => preparationChecks || []).find(({ id }) => id === "baseline-provider-access");
  assert.equal(cliCheck.complete, true);
  review.sourceReconciliations[0].accounts[2].disposition = "unresolved";
  assert.equal((await baseline("provider-access")).complete, false);
  review.sourceReconciliations[0].accounts[2].disposition = "provider-managed";
  proof.readinessTest = true;
  assert.equal((await baseline("provider-access")).complete, false, "A retrieval rehearsal is not an actual account population");
  proof.readinessTest = false;
  Object.assign(grant, { status: "revoked", deprovisionedOn: "2026-07-01", deprovisionedByIds: [get("person").id], deprovisionReason: "Removed before the checked zero population" });
  service.status = "disabled";
  review.grantDecisions = []; review.populationCount = 0; proof.populationCount = 0;
  review.sourceReconciliations[0].accounts = [];
  assert.equal((await baseline("provider-access")).complete, true, "A genuine checked zero population needs no invented account row");
  proof.populationCount = 1;
  assert.equal((await baseline("provider-access")).complete, false, "An empty account list cannot hide a positive export count");
});

test("provider reconciliation guide and scaffold expose nested model facts without inventing account decisions", async (context) => {
  const { root } = await fixture(context, "IAM-01");
  const guide = JSON.parse((await captureCli(runCli, ["guide", "access-review", "--root", root, "--json"])).stdout);
  assert.equal(guide.optionalFields.find(({ name }) => name === "sourceReconciliations").itemObjectType, "provider-access-reconciliation");
  assert.ok(guide.objectTypes["provider-account-decision"].properties.authorizationKind.values.includes("review-renewal"));
  assert.ok(guide.objectTypes["provider-access-reconciliation"].properties.boundary.values.includes("inherited"));
  const scaffold = JSON.parse((await captureCli(runCli, ["scaffold", "access-review", "--title", "Provider reconciliation", "--root", root])).stdout);
  assert.deepEqual(scaffold.record.sourceReconciliations, []);
  assert.deepEqual(scaffold.record.grantDecisions, []);
  assert.equal(scaffold.record.populationCount, null);
  assert.notEqual(scaffold.record.status, "complete");
});


test("later content cutover preserves risk setup proof within its adopted cycle", async (context) => {
  const { loaded, program, controls, get, baseline } = await fixture(context, "RSK-01");
  const assessment = get("risk-assessment");
  const initial = await baseline("program-risk");
  for (const [field, ids] of Object.entries(initial.scope)) assessment[field] = ids;
  Object.assign(assessment, { assessmentKind: "enterprise-risk", completedOn: "2026-10-05", approvedOn: "2026-10-06",
    assessorIds: ["person-example"], reviewerIds: ["person-independent-approver-example"] });
  get("obligation").activityType = "risk-assessment";
  Object.assign(get("obligation-rule"), { recurrence: { mode: "calendar", unit: "month", interval: 3, anchorMode: "explicit", anchorDate: "2026-07-01" },
    effectiveAt: "2026-07-01T00:00:00Z", window: { precision: "date", startsAfter: 2, dueAfter: 89 } });
  assert.equal((await baseline("program-risk")).complete, true);
  get("policy").effectiveOn = "2026-10-12";
  let result = await baseline("program-risk");
  assert.equal(result.complete, true, JSON.stringify(result.candidateResults));
  assert.equal(result.completionWindows[0].startsOn, "2026-10-03", "The configured cycle offset still applies");
  const task = planObligations(loaded.resources, { model: loaded.model, programId: program.id, asOf: "2026-10-13", through: "2026-10-13", includeComplete: true }).calendarItems[0];
  assert.equal(task.dueWindowStart, "2026-10-12", "Actual occurrence completion is still bounded by cutover");
  const frozen = { ...get("obligation-occurrence"), id: "obligation-occurrence-frozen-risk", type: "obligation-occurrence",
    programId: program.id, obligationId: task.obligationId, ruleId: task.ruleId, occurrenceKey: task.occurrenceKey,
    status: "open", coverage: { kind: "range", startsOn: task.dueWindowStart, endsOn: task.dueWindowEnd }, members: [] };
  loaded.resources.push(frozen);
  assert.equal((await baseline("program-risk")).complete, true, "Recording the partial occurrence preserves setup proof eligibility");
  const frozenTask = planObligations(loaded.resources, { model: loaded.model, programId: program.id, asOf: "2026-10-13", through: "2026-10-13", includeComplete: true }).calendarItems.find((item) => item.occurrenceId === frozen.id);
  assert.equal(frozenTask.dueWindowStart, "2026-10-12", "Frozen occurrence dates stay authoritative");
  assert.equal(frozenTask.cycleWindowStart, "2026-10-03");
  assessment.completedOn = "2026-10-02";
  assert.equal((await baseline("program-risk")).complete, false, "Proof before the configured offset stays ineligible");
  assessment.completedOn = "2026-09-30";
  assert.equal((await baseline("program-risk")).complete, false, "Previous-cycle work stays ineligible");
  assessment.completedOn = "2026-10-05";
  controls[0].procedureEffectiveOn = "2026-10-06";
  assert.equal((await baseline("program-risk")).complete, false, "A changed Control procedure still needs current proof");
});

test("later content cutover preserves access setup exports without accepting stale or unsupported populations", async (context) => {
  const { get, baseline } = await fixture(context, "IAM-01");
  const review = get("access-review"), grant = get("access-grant"), proof = get("evidence");
  get("obligation").activityType = "access-review";
  Object.assign(get("obligation-rule"), { recurrence: { mode: "calendar", unit: "month", interval: 3, anchorMode: "explicit", anchorDate: "2026-07-01" },
    effectiveAt: "2026-07-01T00:00:00Z", window: { precision: "date", startsAfter: 0, dueAfter: 89 } });
  Object.assign(review, { completedOn: "2026-10-05", approvedOn: "2026-10-06", populationCount: 1, exceptionCount: 0,
    grantDecisions: [{ accessGrantId: grant.id, decision: "retain" }] });
  Object.assign(proof, { artifactKind: "population-export", sourceKind: "component", sourceComponentId: get("component").id,
    collectedOn: "2026-10-05", verifiedOn: "2026-10-05", generatedAt: "2026-10-05T10:00:00Z", timezone: "UTC",
    queryDescription: "All scoped provider accounts", populationCount: 1,
    completenessValidation: "Compared all account classes with provider totals", accuracyValidation: "Checked account identifiers and permissions",
    coverage: { kind: "as-of", on: "2026-10-05" } });
  delete proof.filePaths;
  assert.equal((await baseline("provider-access")).complete, true);
  get("policy").effectiveOn = "2026-10-12";
  assert.equal((await baseline("provider-access")).complete, true);
  proof.generatedAt = "2026-09-30T10:00:00Z";
  assert.equal((await baseline("provider-access")).complete, false, "A prior-cycle export cannot support the current population");
  proof.generatedAt = "2026-10-05T10:00:00Z";
  proof.populationCount = 2;
  assert.equal((await baseline("provider-access")).complete, false, "Unreconciled accounts still block readiness");
});

test("setup eligibility retains the planner's rule, activation anchor and offset cycle", async (context) => {
  for (const scenario of ["activation-anchor", "future-rule", "negative-offset", "cross-cycle-offset"]) {
    await context.test(scenario, async (child) => {
      const { loaded, get, baseline } = await fixture(child, "RSK-01");
      const assessment = get("risk-assessment");
      const initial = await baseline("program-risk");
      for (const [field, ids] of Object.entries(initial.scope)) assessment[field] = ids;
      Object.assign(assessment, { assessmentKind: "enterprise-risk", completedOn: "2026-10-05", approvedOn: "2026-10-06",
        assessorIds: ["person-example"], reviewerIds: ["person-independent-approver-example"] });
      const obligation = get("obligation"), rule = get("obligation-rule");
      obligation.activityType = "risk-assessment";
      Object.assign(rule, { recurrence: { mode: "calendar", unit: "month", interval: 3, anchorMode: "explicit", anchorDate: "2026-07-01" },
        effectiveAt: "2026-07-01T12:00:00Z", window: { precision: "date", startsAfter: 0, dueAfter: 89 } });
      get("policy").effectiveOn = "2026-10-12";
      let expected = false;
      if (scenario === "activation-anchor") rule.recurrence.anchorMode = "activation";
      if (scenario === "future-rule") {
        assessment.completedOn = "2026-09-20"; assessment.approvedOn = "2026-09-21";
        const successor = { ...rule, id: "obligation-rule-future-risk", supersedesId: rule.id,
          effectiveAt: "2026-11-01T12:00:00Z", recurrence: { ...rule.recurrence, anchorDate: "2026-09-01" } };
        rule.status = "retired"; loaded.resources.push(successor);
        obligation.ruleIds = [rule.id, successor.id]; obligation.activeRuleId = successor.id;
      }
      if (scenario === "negative-offset") {
        get("policy").effectiveOn = "2026-07-01";
        rule.window = { precision: "date", startsAfter: -10, dueAfter: 80 };
        assessment.completedOn = "2026-08-20"; assessment.approvedOn = "2026-08-21";
      }
      if (scenario === "cross-cycle-offset") {
        rule.recurrence = { mode: "calendar", unit: "week", interval: 1, anchorMode: "explicit", anchorDate: "2026-10-01" };
        rule.effectiveAt = "2026-10-01T12:00:00Z";
        rule.window = { precision: "date", startsAfter: 10, dueAfter: 13 };
        assessment.completedOn = "2026-10-11"; assessment.approvedOn = "2026-10-12";
        expected = true;
      }
      const result = await baseline("program-risk");
      assert.equal(result.complete, expected, JSON.stringify(result.candidateResults));
    });
  }
});


test("committed access populations survive later closure while current scope and identities stay required", async (context) => {
  const { root, loaded, get, baseline } = await fixture(context, "IAM-01");
  const review = get("access-review"), grant = get("access-grant"), proof = get("evidence"), service = get("service-account");
  const component = get("component");
  const serviceGrant = { ...grant, id: "access-grant-historical-service", subjectId: service.id };
  loaded.resources.push(serviceGrant);
  Object.assign(service, { componentIds: [component.id], ownerIds: [get("person").id] });
  Object.assign(review, { completedOn: "2026-07-01", approvedOn: "2026-07-02", populationCount: 2, exceptionCount: 0,
    grantDecisions: [grant, serviceGrant].map(({ id }) => ({ accessGrantId: id, decision: "retain" })),
    sourceReconciliations: [{ componentId: component.id, boundary: "direct", populationEvidenceId: proof.id,
      accounts: [grant, serviceGrant].map((item, index) => ({ accountReference: `account-${index}`, disposition: "authorized",
        subjectId: item.subjectId, authorizationKind: "access-grant", accessGrantIds: [item.id] })) }] });
  Object.assign(proof, { artifactKind: "population-export", sourceKind: "component", sourceComponentId: component.id,
    collectedOn: "2026-07-01", verifiedOn: "2026-07-01", generatedAt: "2026-07-01T10:00:00Z", timezone: "UTC",
    externalReference: { url: "https://evidence.example.com/accounts" }, queryDescription: "All provider accounts",
    populationCount: 2, completenessValidation: "Checked all account classes", accuracyValidation: "Matched subjects and permissions",
    coverage: { kind: "as-of", on: "2026-07-01" } });
  delete proof.filePaths;
  const noStore = { ...component, id: "component-no-account-store" };
  loaded.resources.push(noStore); review.componentIds.push(noStore.id); proof.componentIds = [component.id, noStore.id];
  review.sourceReconciliations.push({ componentId: noStore.id, boundary: "no-account-store", rationale: "This capability has no separate identity store", boundaryEvidenceIds: [proof.id] });
  for (const record of [review, grant, serviceGrant, proof, service, noStore]) await writeFile(join(root, "data", resourceDataPath(loaded.model, record)), JSON.stringify(record));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  git("init", "--initial-branch=main"); git("config", "user.name", "Example Owner"); git("config", "user.email", "owner@example.com");
  git("add", "data/access-reviews"); git("commit", "-m", "Record completed provider review");
  git("add", "data"); git("commit", "-m", "Retain provider review supporting records");
  assert.equal((await baseline("provider-access")).complete, true);
  const revoke = (item) => Object.assign(item, { status: "revoked", deprovisionedOn: "2026-08-01",
    deprovisionedByIds: [get("person").id], deprovisionReason: "Closed after the reviewed population" });
  const serviceGrantBeforeClosure = structuredClone(serviceGrant);
  serviceGrant.status = "requested";
  assert.equal((await baseline("provider-access")).complete, false, "Requested or approved access is not proved closed");
  Object.assign(serviceGrant, serviceGrantBeforeClosure);
  revoke(serviceGrant); serviceGrant.deprovisionedOn = "2026-12-01";
  assert.equal((await baseline("provider-access")).complete, false, "A future revocation does not close today's access");
  serviceGrant.deprovisionedOn = "2026-06-01";
  assert.equal((await baseline("provider-access")).complete, false, "Backdating closure before the active reviewed grant is not a later lifecycle change");
  revoke(serviceGrant); service.status = "disabled";
  let result = await baseline("provider-access");
  assert.equal(result.complete, true, JSON.stringify(result.candidateResults));
  assert.equal(review.grantDecisions[1].decision, "retain");
  assert.equal(review.populationCount, 2);
  Object.assign(component, { status: "retired", statusTransition: { changedOn: "2026-08-01", changedByIds: [get("person").id], reason: "Service retired" } });
  assert.equal((await baseline("provider-access")).complete, false, "Active access to a retired service still needs resolution");
  const control = get("control"), originalComponentIds = control.componentIds, originalSourceIds = control.evidenceSourceComponentIds;
  control.componentIds = []; control.evidenceSourceComponentIds = [];
  const orphan = (await baseline("provider-access")).candidateResults[0];
  assert.ok(orphan.missingFacts.includes("current-authorized-access"), "Removing retired provider links must not conceal still-active access");
  control.componentIds = originalComponentIds; control.evidenceSourceComponentIds = originalSourceIds;
  revoke(grant);
  result = await baseline("provider-access");
  assert.equal(result.complete, true, JSON.stringify(result.candidateResults));
  assert.deepEqual(result.candidateResults[0].issues, []);
  const historyContext = reviewHistoryContext(root, loaded), originalIndex = historyContext.index;
  historyContext.index = null;
  assert.equal((await baseline("provider-access")).complete, true, "Bounded-index recovery falls back to committed Git history");
  historyContext.index = originalIndex;
  assert.equal(review.sourceReconciliations.length, 2);
  const actors = loaded.resources.filter(({ type }) => type === "person");
  const actorCopies = actors.map((actor) => structuredClone(actor));
  for (const actor of actors) Object.assign(actor, { status: "inactive", endDate: "2026-08-01" });
  assert.equal((await baseline("provider-access")).complete, true, "Dated reviewer, approver and collector work survives later departure");
  actors.forEach((actor, index) => { delete actor.endDate; Object.assign(actor, actorCopies[index]); });
  const obligation = get("obligation"), originalObligation = structuredClone(get("obligation"));
  Object.assign(obligation, { activityType: "access-review", scopeResourceIds: [] });
  delete obligation.selector;
  const rule = loaded.resources.find(({ id }) => id === obligation.activeRuleId);
  const originalRule = rule && structuredClone(rule);
  if (rule) delete rule.selector;
  assert.equal(assessCompletionForObligation(review, obligation, loaded, { asOf: "2026-10-13", programId: get("program").id }).complete, true,
    "Recurring completion must receive the same history context as setup readiness");
  Object.assign(obligation, originalObligation);
  if (rule) Object.assign(rule, originalRule);
  const nextComponent = { ...component, id: "component-new-provider", status: "active" };
  delete nextComponent.statusTransition;
  loaded.resources.push(nextComponent);
  assert.equal((await baseline("provider-access")).complete, false, "A newly active provider is not covered by the old snapshot");
  loaded.resources.pop(); component.status = "active"; delete component.statusTransition;
  serviceGrant.status = "active"; delete serviceGrant.deprovisionedOn; delete serviceGrant.deprovisionedByIds; delete serviceGrant.deprovisionReason;
  assert.equal((await baseline("provider-access")).complete, false, "A live grant to a disabled identity cannot inherit old authorization");
  service.status = "active";
  service.reviewDueOn = "2026-09-01";
  assert.equal((await baseline("provider-access")).complete, false, "A live identity still needs its current review");
  delete service.reviewDueOn;
  assert.equal((await baseline("provider-access")).complete, true);
  serviceGrant.accessLevel = "New elevated authority";
  assert.equal((await baseline("provider-access")).complete, false, "Material grant changes need current review");
  serviceGrant.accessLevel = grant.accessLevel;
  const outside = { ...component, id: "component-outside-program", systemUses: [] };
  loaded.resources.push(outside); serviceGrant.componentId = outside.id;
  assert.equal((await baseline("provider-access")).complete, false, "Moving reviewed access out of scope cannot conceal its changed authority");
  loaded.resources.pop(); serviceGrant.componentId = component.id;
  const extraGrant = { ...serviceGrant, id: "access-grant-added-after-review" };
  loaded.resources.push(extraGrant);
  assert.equal((await baseline("provider-access")).complete, false, "A new active grant requires its own decision and account mapping");
  loaded.resources.pop(); revoke(serviceGrant); service.status = "disabled";
  const fresh = { ...loaded, resources: structuredClone(loaded.resources) };
  const freshProgram = fresh.resources.find(({ type }) => type === "program"), freshReview = fresh.resources.find(({ id }) => id === review.id);
  const assessFresh = () => assessProgramAccessReview(freshReview, fresh, freshProgram, providerAccessControls(fresh, freshProgram), "2026-10-13");
  assert.throws(() => withGitCommandDeadline(performance.now() - 1, assessFresh), { code: "FILEGRC_GIT_DEADLINE" },
    "Unavailable historical provider context must defer instead of becoming current-population failures");
  assert.equal(assessFresh().complete, true, "The same provider review recovers after its history deadline");
  review.populationCount = 1;
  assert.equal((await baseline("provider-access")).complete, false, "An edited completed review cannot reuse the unchanged committed approval");
});

test("historical access reuse still checks retained removal proof", async (context) => {
  const { root, loaded, get, baseline } = await fixture(context, "IAM-01");
  const review = get("access-review"), grant = get("access-grant"), proof = get("evidence"), component = get("component");
  Object.assign(grant, { status: "revoked", deprovisionedOn: "2026-07-01", deprovisionedByIds: [get("person").id], deprovisionReason: "Removed during review" });
  const resolution = { ...proof, id: "evidence-account-removal", artifactKind: "business-record", sourceKind: "component", sourceComponentId: component.id,
    collectedOn: "2026-07-01", verifiedOn: "2026-07-01", generatedAt: "2026-07-01T12:00:00Z", externalReference: { url: "https://evidence.example.com/removal" } };
  delete resolution.filePaths;
  loaded.resources.push(resolution);
  Object.assign(review, { completedOn: "2026-07-01", approvedOn: "2026-07-02", populationCount: 1, exceptionCount: 0,
    evidenceIds: [proof.id, resolution.id], grantDecisions: [{ accessGrantId: grant.id, decision: "remove" }],
    sourceReconciliations: [{ componentId: component.id, boundary: "direct", populationEvidenceId: proof.id, accounts: [{
      accountReference: "removed-account", disposition: "removed", subjectId: grant.subjectId, accessGrantIds: [grant.id],
      rationale: "Removed excess access", resolutionEvidenceIds: [resolution.id]
    }] }] });
  Object.assign(proof, { artifactKind: "population-export", sourceKind: "component", sourceComponentId: component.id,
    collectedOn: "2026-07-01", verifiedOn: "2026-07-01", generatedAt: "2026-07-01T10:00:00Z", timezone: "UTC",
    externalReference: { url: "https://evidence.example.com/accounts" }, queryDescription: "All provider accounts", populationCount: 1,
    completenessValidation: "All account classes checked", accuracyValidation: "Matched actual account and permission",
    coverage: { kind: "as-of", on: "2026-07-01" } });
  delete proof.filePaths;
  for (const record of [review, grant, proof, resolution]) {
    const path = join(root, "data", resourceDataPath(loaded.model, record));
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, JSON.stringify(record));
  }
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  git("init", "--initial-branch=main"); git("config", "user.name", "Example Owner"); git("config", "user.email", "owner@example.com");
  git("add", "data"); git("commit", "-m", "Complete access removal review");
  assert.equal((await baseline("provider-access")).complete, true);
  resolution.status = "draft";
  const invalid = (await baseline("provider-access")).candidateResults[0];
  assert.equal(invalid.complete, false);
  assert.ok(invalid.missingFacts.includes("resolved-provider-account-removals"));
  resolution.status = "verified"; resolution.expiresOn = "2026-09-01";
  assert.equal((await baseline("provider-access")).complete, false);
});

test("revoking one permission preserves a historically reviewed multi-grant account", async (context) => {
  const { root, loaded, get, baseline } = await fixture(context, "IAM-01");
  const review = get("access-review"), grant = get("access-grant"), proof = get("evidence"), component = get("component");
  const second = { ...grant, id: "access-grant-second-permission" };
  loaded.resources.push(second);
  Object.assign(review, { completedOn: "2026-07-01", approvedOn: "2026-07-02", populationCount: 1, exceptionCount: 0,
    grantDecisions: [grant, second].map(({ id }) => ({ accessGrantId: id, decision: "retain" })),
    sourceReconciliations: [{ componentId: component.id, boundary: "direct", populationEvidenceId: proof.id, accounts: [{
      accountReference: "one-account", disposition: "authorized", subjectId: grant.subjectId, authorizationKind: "access-grant", accessGrantIds: [grant.id, second.id]
    }] }] });
  Object.assign(proof, { artifactKind: "population-export", sourceKind: "component", sourceComponentId: component.id,
    collectedOn: "2026-07-01", verifiedOn: "2026-07-01", generatedAt: "2026-07-01T10:00:00Z", timezone: "UTC",
    externalReference: { url: "https://evidence.example.com/accounts" }, queryDescription: "All provider accounts", populationCount: 1,
    completenessValidation: "All accounts checked", accuracyValidation: "Matched both permissions",
    coverage: { kind: "as-of", on: "2026-07-01" } });
  delete proof.filePaths;
  for (const record of [review, grant, second, proof]) await writeFile(join(root, "data", resourceDataPath(loaded.model, record)), JSON.stringify(record));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  git("init", "--initial-branch=main"); git("config", "user.name", "Example Owner"); git("config", "user.email", "owner@example.com");
  git("add", "data"); git("commit", "-m", "Review multi-permission account");
  assert.equal((await baseline("provider-access")).complete, true);
  Object.assign(second, { status: "revoked", deprovisionedOn: "2026-08-01", deprovisionedByIds: [get("person").id], deprovisionReason: "Removed one permission" });
  const result = await baseline("provider-access");
  assert.equal(result.complete, true, JSON.stringify(result.candidateResults));
  assert.deepEqual(review.sourceReconciliations[0].accounts[0].accessGrantIds, [grant.id, second.id]);
  assert.equal(review.populationCount, 1);
});

test("a committed real zero-account review can omit optional grant decisions", async (context) => {
  const { root, loaded, get, baseline } = await fixture(context, "IAM-01");
  const review = get("access-review"), grant = get("access-grant"), proof = get("evidence"), component = get("component");
  Object.assign(grant, { status: "revoked", deprovisionedOn: "2026-06-30", deprovisionedByIds: [get("person").id], deprovisionReason: "Access ended before the checked zero population" });
  Object.assign(review, { completedOn: "2026-07-01", approvedOn: "2026-07-02", populationCount: 0, exceptionCount: 0,
    sourceReconciliations: [{ componentId: component.id, boundary: "direct", populationEvidenceId: proof.id, accounts: [] }] });
  delete review.grantDecisions;
  Object.assign(proof, { artifactKind: "population-export", sourceKind: "component", sourceComponentId: component.id,
    collectedOn: "2026-07-01", verifiedOn: "2026-07-01", generatedAt: "2026-07-01T10:00:00Z", timezone: "UTC",
    externalReference: { url: "https://evidence.example.com/zero-accounts" }, queryDescription: "All account classes, including disabled and service identities",
    populationCount: 0, completenessValidation: "Confirmed real zero source count", accuracyValidation: "Checked source scope and filters",
    coverage: { kind: "as-of", on: "2026-07-01" } });
  delete proof.filePaths;
  for (const record of [review, grant, proof]) await writeFile(join(root, "data", resourceDataPath(loaded.model, record)), JSON.stringify(record));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  git("init", "--initial-branch=main"); git("config", "user.name", "Example Owner"); git("config", "user.email", "owner@example.com");
  git("add", "data"); git("commit", "-m", "Review actual zero-account population");
  const result = await baseline("provider-access");
  assert.equal(result.complete, true, JSON.stringify(result.candidateResults));
  assert.ok(result.candidateResults[0].historicalReviewCommit);
  assert.equal(review.grantDecisions, undefined);
});
