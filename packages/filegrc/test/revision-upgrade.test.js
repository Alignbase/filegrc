import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { applicabilityReviewIsCurrent, applicabilityScopeRevision } from "../src/applicability-scope.js";
import { applyApplicabilityReview, planApplicabilityReview, scaffoldApplicabilityReview } from "../src/batch-review.js";
import { applyCollectionReview, assessCollectionReview } from "../src/collection-review.js";
import { collectionReviewRevision, historicalCollectionReviewSnapshot } from "../src/collection-review-integrity.js";
import { collectionRevision, collectionRevisionMatches, legacyCollectionRevision } from "../src/collection-revision.js";
import { scopedCollectionRecords } from "../src/collection-scope.js";
import { contentRevisionBindingsMatch } from "../src/program-lifecycle.js";
import { assessProgramReadiness } from "../src/program-readiness.js";
import { reviewHistoryContext } from "../src/historical-workspace.js";
import { reportingRouteRevision } from "../src/reporting-route-integrity.js";
import { assessRequirementMappingReadiness } from "../src/requirement-mapping.js";
import { resourceReviewRevisionMatches, resourceReviewRevisions, resourceReviewRevisionsSync, retentionReviewResourceIds, retentionRuleIsCurrent } from "../src/retention.js";
import { canonicalCalculatedRevisionJson, displayRevision, revisionsMatch } from "../src/revisions.js";
import { currentCalendarDate } from "../src/time.js";
import { validateWorkspace } from "../src/validate.js";
import { loadWorkspace } from "../src/workspace.js";
import { serveWorkspace } from "../src/index.js";
import { makeComprehensiveWorkspace } from "./fixtures.js";
import { commitWorkspaceFiles, initializeGitWorkspace } from "./helpers.js";

test("revision labels shorten known hashes without changing stored values", () => {
  const digest = "abcdef0123456789".repeat(4);
  assert.equal(displayRevision(`filegrc:collection:v1:sha256:${digest}`), "abcdef012345");
  assert.equal(displayRevision(`scope:${digest}`), "abcdef012345");
  assert.equal(displayRevision(digest), "abcdef012345");
  assert.equal(displayRevision("unexpected-revision"), "unexpected-revision");
});

test("applicability apply carries forward a prior Complementary Control collection review", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-collection-review-upgrade-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  await initializeGitWorkspace(root);
  const today = currentCalendarDate((await loadWorkspace(root)).workspace.timezone);
  await applyCollectionReview(root, {
    resourceType: "complementary-control",
    decision: "complete",
    rationale: "Reviewed the current complementary responsibilities.",
    reviewedByIds: ["person-independent-approver-example"],
    reviewedOn: today,
    confirmed: true
  });
  let loaded = await loadWorkspace(root);
  const reviewEntry = loaded.entries.find(({ record }) => record.type === "collection-review"
    && record.resourceType === "complementary-control");
  const program = loaded.resources.find(({ type }) => type === "program");
  const control = loaded.resources.find(({ type }) => type === "control");
  const previous = collectionRevision(loaded, "complementary-control", {
    programId: program.id,
    historicalReviewMetadata: true
  });
  assert.notEqual(previous, collectionRevision(loaded, "complementary-control", { programId: program.id }));
  reviewEntry.record.collectionRevision = previous;
  await writeFile(reviewEntry.path, `${JSON.stringify(reviewEntry.record, null, 2)}\n`);
  await commitWorkspaceFiles(root, "Record prior collection binding");
  loaded = await loadWorkspace(root);
  assert.equal(assessCollectionReview(loaded, "complementary-control", { programId: program.id }).status, "current");
  const decisions = [{ id: control.id, decision: "applicable", rationale: "The Control applies.", reviewedByIds: ["person-independent-approver-example"], reviewedOn: "2026-09-30" }];
  const preview = await planApplicabilityReview(root, { decisions });
  assert.equal(preview.changes.update.some(({ id }) => id === reviewEntry.record.id), false);
  const applied = await applyApplicabilityReview(root, { decisions, basis: preview.basis, confirmed: true });
  assert.deepEqual(applied.changes, preview.changes);
  let final = await loadWorkspace(root);
  assert.equal(assessCollectionReview(final, "complementary-control", { programId: program.id }).status, "current");
  const changedControl = final.entries.find(({ record }) => record.id === control.id);
  changedControl.record.status = "planned";
  await writeFile(changedControl.path, `${JSON.stringify(changedControl.record, null, 2)}\n`);
  final = await loadWorkspace(root);
  assert.equal(assessCollectionReview(final, "complementary-control", { programId: program.id }).status, "current");
  const procedurePath = join(root, "data", "controls", `${control.id}.md`);
  await writeFile(procedurePath, `${await readFile(procedurePath, "utf8")}\nUpdated operating steps.\n`);
  final = await loadWorkspace(root);
  assert.equal(assessCollectionReview(final, "complementary-control", { programId: program.id }).status, "current");
  const priorRequirementIds = changedControl.record.requirementIds;
  changedControl.record.requirementIds = [];
  await writeFile(changedControl.path, `${JSON.stringify(changedControl.record, null, 2)}\n`);
  final = await loadWorkspace(root);
  assert.equal(assessCollectionReview(final, "complementary-control", { programId: program.id }).status, "current");
  changedControl.record.requirementIds = priorRequirementIds;
  await writeFile(changedControl.path, `${JSON.stringify(changedControl.record, null, 2)}\n`);
  final = await loadWorkspace(root);
  assert.equal(assessCollectionReview(final, "complementary-control", { programId: program.id }).status, "current");
  changedControl.record.statement = `${changedControl.record.statement} with new scope`;
  await writeFile(changedControl.path, `${JSON.stringify(changedControl.record, null, 2)}\n`);
  final = await loadWorkspace(root);
  assert.equal(assessCollectionReview(final, "complementary-control", { programId: program.id }).status, "current");
});

test("a setup Component confirmation survives later inventory and procedure changes", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-setup-operation-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  await initializeGitWorkspace(root);
  const initial = await loadWorkspace(root);
  const program = initial.resources.find(({ type }) => type === "program");
  await applyCollectionReview(root, {
    resourceType: "component", decision: "complete", rationale: "Setup inventory reviewed.",
    reviewedByIds: ["person-independent-approver-example"],
    reviewedOn: currentCalendarDate(initial.workspace.timezone), confirmed: true
  });
  let loaded = await loadWorkspace(root);
  assert.equal(assessCollectionReview(loaded, "component", { programId: program.id }).status, "current");
  const componentEntry = loaded.entries.find(({ record }) => record.type === "component"
    && (record.systemUses || []).some(({ systemId }) => program.systemIds.includes(systemId)));
  componentEntry.record.description = `${componentEntry.record.description} Updated operating description.`;
  await writeFile(componentEntry.path, `${JSON.stringify(componentEntry.record, null, 2)}\n`);
  loaded = await loadWorkspace(root);
  assert.equal(assessCollectionReview(loaded, "component", { programId: program.id }).status, "current");
  const review = loaded.resources.find(({ type, resourceType }) => type === "collection-review" && resourceType === "component");
  const reviewedPopulation = review.populationResourceIds;
  review.populationResourceIds = [];
  assert.notEqual(assessCollectionReview(loaded, "component", { programId: program.id }).status, "current");
  review.populationResourceIds = reviewedPopulation;
  const reviewedRevision = review.collectionRevision;
  review.collectionRevision = `filegrc:collection:v1:sha256:${"0".repeat(64)}`;
  const staleAssessment = assessCollectionReview(loaded, "component", { programId: program.id });
  assert.notEqual(staleAssessment.status, "current");
  assert.match(staleAssessment.message, /Stored revision: 000000000000\. Current revision: [a-f0-9]{12}\./);
  assert.equal(staleAssessment.revisionDiagnostic.storedRevision, review.collectionRevision);
  assert.equal(staleAssessment.changesSinceReview.status, "unavailable");
  review.collectionRevision = reviewedRevision;
  assert.equal(assessCollectionReview(loaded, "component", { programId: program.id }).status, "current");
  const selectedProgram = loaded.resources.find(({ id }) => id === program.id);
  selectedProgram.systemIds.push("system-newly-selected");
  const changedScope = assessCollectionReview(loaded, "component", { programId: program.id });
  assert.notEqual(changedScope.status, "current");
  assert.deepEqual(changedScope.changesSinceReview.scopeFields, ["Systems"]);
  selectedProgram.systemIds.pop();
  const added = { ...componentEntry.record, id: "component-new-workforce-source", title: "Workforce source", status: "planned" };
  loaded.resources.push(added);
  assert.equal(assessCollectionReview(loaded, "component", { programId: program.id }).status, "current");
  const readiness = await assessProgramReadiness(loaded, { programId: program.id });
  const componentStep = readiness.stages.flatMap(({ items }) => items)
    .find(({ id }) => id === "collection-review-component");
  assert.equal(componentStep?.status, "complete");
  assert.doesNotMatch(componentStep.title, /proposal/i);
  const operatingChange = readiness.stages.find(({ id }) => id === "operation").items
    .find(({ id }) => id === "operating-component-component-new-workforce-source");
  assert.equal(operatingChange?.status, "action");
  assert.equal(operatingChange?.resourceId, added.id);
});

test("a Framework selection change reopens its specific setup review", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-framework-selection-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  await initializeGitWorkspace(root);
  const initial = await loadWorkspace(root);
  const program = initial.resources.find(({ type }) => type === "program");
  await applyCollectionReview(root, {
    resourceType: "framework", decision: "complete", rationale: "Selected framework reviewed.",
    reviewedByIds: ["person-independent-approver-example"],
    reviewedOn: currentCalendarDate(initial.workspace.timezone), confirmed: true
  });
  const loaded = await loadWorkspace(root);
  assert.equal(assessCollectionReview(loaded, "framework", { programId: program.id }).status, "current");
  loaded.resources.find(({ id }) => id === program.id).frameworkIds.push("framework-newly-selected");
  assert.notEqual(assessCollectionReview(loaded, "framework", { programId: program.id }).status, "current");
});

test("later Control changes preserve the original independent reviewer requirement", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-control-review-history-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  await initializeGitWorkspace(root);
  let loaded = await loadWorkspace(root);
  const program = loaded.resources.find(({ type }) => type === "program");
  const scopeRevision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const reviewedOn = currentCalendarDate(loaded.workspace.timezone);
  const review = {
    id: "collection-review-control-history-example", type: "collection-review",
    title: "Implemented Controls review", status: "active", resourceType: "control",
    scopeResourceIds: [program.id], decision: "complete", rationale: "Reviewed initial Control oversight.",
    reviewedByIds: ["person-independent-approver-example"], reviewedOn,
    coverage: { kind: "as-of", on: reviewedOn }, knowledgeCutoffAt: new Date().toISOString(),
    populationResourceIds: scopedCollectionRecords(loaded, "control", program).map(({ id }) => id).sort(),
    collectionRevision: collectionRevision(loaded, "control", { program }), scopeRevision
  };
  const reviewPath = join(root, "data", "collection-reviews", `${review.id}.json`);
  await writeFile(reviewPath, `${JSON.stringify(review, null, 2)}\n`);
  loaded = await loadWorkspace(root);
  assert.equal(assessCollectionReview(loaded, "control", { programId: program.id }).complete, true);
  const component = loaded.entries.find(({ record }) => record.type === "component");
  component.record.description += " Operating details changed later.";
  await writeFile(component.path, `${JSON.stringify(component.record, null, 2)}\n`);
  loaded = await loadWorkspace(root);
  assert.equal(assessCollectionReview(loaded, "control", { programId: program.id }).complete, true);
  review.reviewedByIds = ["person-example"];
  await writeFile(reviewPath, `${JSON.stringify(review, null, 2)}\n`);
  loaded = await loadWorkspace(root);
  assert.equal(assessCollectionReview(loaded, "control", { programId: program.id }).complete, false);
  const validation = await validateWorkspace(root);
  assert.equal(validation.diagnostics.some(({ code }) => code === "conflicted-control-collection-reviewer"), true);
});

test("legacy applicability decisions survive routine record changes across steps", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-applicability-scope-upgrade-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  let loaded = await loadWorkspace(root);
  const program = loaded.resources.find(({ type }) => type === "program");
  const entries = loaded.entries.filter(({ record }) => ["control", "commitment", "complementary-control"].includes(record.type));
  for (const entry of entries) {
    entry.record.applicabilityReview = {
      decision: "applicable", rationale: "The current program includes this work.",
      reviewedByIds: ["person-independent-approver-example"], reviewedOn: "2026-09-30",
      scopeRevision: applicabilityScopeRevision(entry.record, program, loaded.resources, loaded.model, { legacyResourceProjection: true })
    };
    await writeFile(entry.path, `${JSON.stringify(entry.record, null, 2)}\n`);
  }
  await initializeGitWorkspace(root);
  loaded = await loadWorkspace(root);
  for (const entry of loaded.entries.filter(({ record }) => entries.some((prior) => prior.record.id === record.id))) {
    const current = applicabilityScopeRevision(entry.record, program, loaded.resources, loaded.model);
    assert.notEqual(current, entry.record.applicabilityReview.scopeRevision);
    entry.record.tags = ["reviewed"];
    if (entry.record.type !== "complementary-control") entry.record.ownerIds = ["person-independent-approver-example"];
    await writeFile(entry.path, `${JSON.stringify(entry.record, null, 2)}\n`);
  }
  loaded = await loadWorkspace(root);
  for (const record of loaded.resources.filter(({ record, id }) => entries.some((entry) => entry.record.id === id))) {
    assert.equal(applicabilityReviewIsCurrent(record.applicabilityReview, record, program, loaded.resources, loaded.model, root), true, record.type);
  }
  const scaffold = await scaffoldApplicabilityReview(root, { type: "control" });
  assert.equal(scaffold.decisions.some(({ id }) => entries[0].record.id === id), false);
  const controlEntry = loaded.entries.find(({ record }) => record.id === entries[0].record.id);
  controlEntry.record.status = "not-applicable";
  await writeFile(controlEntry.path, `${JSON.stringify(controlEntry.record, null, 2)}\n`);
  loaded = await loadWorkspace(root);
  assert.equal(applicabilityReviewIsCurrent(controlEntry.record.applicabilityReview, controlEntry.record, program, loaded.resources, loaded.model, root), false);
  controlEntry.record.status = "planned";
  controlEntry.record.statement = `${controlEntry.record.statement} with changed design`;
  await writeFile(controlEntry.path, `${JSON.stringify(controlEntry.record, null, 2)}\n`);
  loaded = await loadWorkspace(root);
  assert.equal(applicabilityReviewIsCurrent(controlEntry.record.applicabilityReview, controlEntry.record, program, loaded.resources, loaded.model, root), false);
});

test("a not-applicable Control decision binds its resulting status", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-not-applicable-status-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  await initializeGitWorkspace(root);
  let loaded = await loadWorkspace(root);
  const controlEntry = loaded.entries.find(({ record }) => record.type === "control");
  const program = loaded.resources.find(({ type }) => type === "program");
  const before = (await resourceReviewRevisions(loaded, [controlEntry.record.id])).get(controlEntry.record.id);
  const decisions = [{ id: controlEntry.record.id, decision: "not-applicable", rationale: "This Control is outside the selected service.", reviewedByIds: ["person-independent-approver-example"], reviewedOn: "2026-09-30" }];
  const preview = await planApplicabilityReview(root, { decisions });
  const applied = await applyApplicabilityReview(root, { decisions, basis: preview.basis, confirmed: true });
  assert.deepEqual(applied.changes, preview.changes);
  loaded = await loadWorkspace(root);
  const control = loaded.resources.find(({ id }) => id === controlEntry.record.id);
  assert.equal(control.status, "not-applicable");
  assert.equal(applicabilityReviewIsCurrent(control.applicabilityReview, control, program, loaded.resources, loaded.model, root), true);
  assert.notEqual((await resourceReviewRevisions(loaded, [control.id])).get(control.id), before);
  control.status = "planned";
  await writeFile(controlEntry.path, `${JSON.stringify(control, null, 2)}\n`);
  loaded = await loadWorkspace(root);
  assert.equal(applicabilityReviewIsCurrent(control.applicabilityReview, control, program, loaded.resources, loaded.model, root), false);
});

test("a Control review can leave not-applicable for every other decision", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-applicability-status-transition-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  await initializeGitWorkspace(root);
  let loaded = await loadWorkspace(root);
  const controlId = loaded.resources.find(({ type }) => type === "control").id;
  const program = loaded.resources.find(({ type }) => type === "program");
  for (const decision of ["externally-managed", "zero-population", "applicable"]) {
    const excluded = [{ id: controlId, decision: "not-applicable", rationale: "Outside the current service boundary.", reviewedByIds: ["person-independent-approver-example"], reviewedOn: "2026-09-30" }];
    const excludedPreview = await planApplicabilityReview(root, { decisions: excluded });
    await applyApplicabilityReview(root, { decisions: excluded, basis: excludedPreview.basis, confirmed: true });
    const decisions = [{ id: controlId, decision, rationale: "The current scope requires this decision.", reviewedByIds: ["person-independent-approver-example"], reviewedOn: "2026-09-30" }];
    const preview = await planApplicabilityReview(root, { decisions });
    assert.equal(preview.changes.update.find(({ id }) => id === controlId).status, "planned");
    const applied = await applyApplicabilityReview(root, { decisions, basis: preview.basis, confirmed: true });
    assert.deepEqual(applied.changes, preview.changes);
    loaded = await loadWorkspace(root);
    const control = loaded.resources.find(({ id }) => id === controlId);
    assert.equal(control.status, "planned");
    assert.equal(control.statusTransition, undefined);
    assert.equal(applicabilityReviewIsCurrent(control.applicabilityReview, control, program, loaded.resources, loaded.model, root), true);
  }
});

test("applicability preview and apply preserve prior source reviews", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-cross-step-applicability-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  let loaded = await loadWorkspace(root);
  const controlEntry = loaded.entries.find(({ record }) => record.type === "control");
  const programEntry = loaded.entries.find(({ record }) => record.type === "program");
  const documentEntry = loaded.entries.find(({ record }) => record.type === "document");
  const rowEntry = loaded.entries.find(({ record }) => record.type === "retention-schedule-item");
  const mappingEntry = loaded.entries.find(({ record }) => record.type === "requirement-mapping");
  const commitment = loaded.resources.find(({ type }) => type === "commitment");
  const sourceCoverageEntry = loaded.entries.find(({ record }) => record.type === "source-coverage");
  const informationType = loaded.resources.find(({ type }) => type === "information-type");
  const controls = [controlEntry.record];
  const procedure = await readFile(join(root, "data", "controls", `${controlEntry.record.id}.md`), "utf8");
  for (let index = 2; index <= 10; index += 1) {
    const record = { ...controlEntry.record, id: `control-review-${index}`, title: `Access review ${index}`, code: `SEC-${index}` };
    controls.push(record);
    await writeFile(join(root, "data", "controls", `${record.id}.json`), `${JSON.stringify(record, null, 2)}\n`);
    await writeFile(join(root, "data", "controls", `${record.id}.md`), procedure);
  }
  programEntry.record.controlIds = controls.map(({ id }) => id);
  await writeFile(programEntry.path, `${JSON.stringify(programEntry.record, null, 2)}\n`);
  documentEntry.record.documentKind = "schedule";
  await writeFile(documentEntry.path, `${JSON.stringify(documentEntry.record, null, 2)}\n`);
  mappingEntry.record = {
    ...mappingEntry.record,
    status: "active",
    relationship: "intersects-with",
    method: "semantic",
    rationale: "The Control addresses part of the Requirement.",
    reviewedByIds: ["person-independent-approver-example"],
    sourceResourceIds: [...mappingEntry.record.sourceResourceIds, commitment.id]
  };
  rowEntry.record = {
    ...rowEntry.record,
    status: "active",
    informationTypeIds: [informationType.id],
    scopeResourceIds: [programEntry.record.id, sourceCoverageEntry.record.id],
    sourceResourceIds: [controlEntry.record.id, commitment.id],
    cutoff: { basis: "creation" },
    retentionPeriod: { basis: "fixed", amount: 1, unit: "year" },
    dispositionAction: "delete",
    dispositionInstructions: "Delete after the approved period."
  };
  loaded = await loadWorkspace(root);
  const oldMappingIds = [...mappingEntry.record.sourceResourceIds, ...mappingEntry.record.targetResourceIds];
  mappingEntry.record.reviewedSourceRevisions = Object.fromEntries(resourceReviewRevisionsSync(loaded, oldMappingIds, "legacy", true));
  rowEntry.record.reviewedSourceRevisions = Object.fromEntries(resourceReviewRevisionsSync(
    loaded, retentionReviewResourceIds(rowEntry.record, loaded), "legacy", true
  ));
  const reviewedControlRevision = rowEntry.record.reviewedSourceRevisions[controlEntry.record.id];
  await writeFile(mappingEntry.path, `${JSON.stringify(mappingEntry.record, null, 2)}\n`);
  await writeFile(rowEntry.path, `${JSON.stringify(rowEntry.record, null, 2)}\n`);
  await initializeGitWorkspace(root);
  const before = await validateWorkspace(root);
  assert.equal(before.ok, true, before.diagnostics.filter(({ severity }) => severity === "error").map(({ message }) => message).join("\n"));
  controlEntry.record.status = "planned";
  await writeFile(controlEntry.path, `${JSON.stringify(controlEntry.record, null, 2)}\n`);
  const implementationChange = await validateWorkspace(root);
  assert.equal(implementationChange.diagnostics.some(({ code }) => ["stale-retention-review", "stale-requirement-mapping"].includes(code)), false);
  const procedurePath = join(root, "data", "controls", `${controlEntry.record.id}.md`);
  await writeFile(procedurePath, `${await readFile(procedurePath, "utf8")}\nUpdated operating steps.\n`);
  const procedureChange = await validateWorkspace(root);
  assert.equal(procedureChange.diagnostics.some(({ code }) => ["stale-retention-review", "stale-requirement-mapping"].includes(code)), false);
  controlEntry.record.status = "implemented";
  await writeFile(controlEntry.path, `${JSON.stringify(controlEntry.record, null, 2)}\n`);
  sourceCoverageEntry.record.readinessTestEvidenceIds = ["evidence-example"];
  await writeFile(sourceCoverageEntry.path, `${JSON.stringify(sourceCoverageEntry.record, null, 2)}\n`);
  const evidenceChange = await validateWorkspace(root);
  assert.equal(evidenceChange.diagnostics.some(({ code }) => code === "stale-retention-review"), false);
  delete sourceCoverageEntry.record.readinessTestEvidenceIds;
  await writeFile(sourceCoverageEntry.path, `${JSON.stringify(sourceCoverageEntry.record, null, 2)}\n`);
  const decisions = [...controls, commitment].map(({ id }) => ({ id, decision: "applicable", rationale: "This record applies to the current service.", reviewedByIds: ["person-independent-approver-example"], reviewedOn: "2026-09-30" }));
  const preview = await planApplicabilityReview(root, { decisions });
  assert.equal(preview.changes.update.length, 11);
  const applied = await applyApplicabilityReview(root, { decisions, basis: preview.basis, confirmed: true });
  assert.deepEqual(applied.changes, preview.changes);
  const after = await validateWorkspace(root);
  assert.equal(after.ok, true, after.diagnostics.filter(({ severity }) => severity === "error").map(({ message }) => message).join("\n"));
  const final = await loadWorkspace(root);
  assert.deepEqual(final.resources.find(({ id }) => id === documentEntry.record.id), documentEntry.record);
  const mapping = final.resources.find(({ id }) => id === mappingEntry.record.id);
  const row = final.resources.find(({ id }) => id === rowEntry.record.id);
  assert.equal(mapping.reviewedSourceRevisions[controlEntry.record.id], reviewedControlRevision);
  assert.equal(row.reviewedSourceRevisions[controlEntry.record.id], reviewedControlRevision);
  const changedControl = final.resources.find(({ id }) => id === controlEntry.record.id);
  changedControl.statement = `${changedControl.statement} with a new decision step`;
  await writeFile(controlEntry.path, `${JSON.stringify(changedControl, null, 2)}\n`);
  const changed = await validateWorkspace(root);
  assert.ok(changed.diagnostics.some(({ code }) => code === "stale-retention-review"));
  assert.ok(changed.diagnostics.some(({ code }) => code === "stale-requirement-mapping"));
});

test("source reviews follow Control design and scope without following implementation", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-review-dependency-facts-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const control = loaded.resources.find(({ type }) => type === "control");
  const controlEntry = loaded.entries.find(({ record }) => record.id === control.id);
  const program = loaded.resources.find(({ type }) => type === "program");
  const row = loaded.resources.find(({ type }) => type === "retention-schedule-item");
  row.sourceResourceIds = [control.id];
  const source = async () => (await resourceReviewRevisions(loaded, [control.id])).get(control.id);
  const original = await source();
  const scheduleReview = collectionRevision(loaded, "retention-schedule-item");
  const priorScheduleReview = collectionRevision(loaded, "retention-schedule-item", { legacyControlDependency: true });
  assert.equal(collectionRevisionMatches(loaded, "retention-schedule-item", priorScheduleReview), true);
  control.status = "planned";
  control.effectiveOn = "2026-10-01";
  control.procedureRevision = "updated-procedure";
  control.applicabilityReview = { decision: "applicable", rationale: "Reviewed", reviewedOn: "2026-10-01", reviewedByIds: ["person-example"], scopeRevision: "review-revision" };
  controlEntry.source = `${JSON.stringify(control, null, 2)}\n`;
  assert.equal(await source(), original);
  assert.equal(collectionRevision(loaded, "retention-schedule-item"), scheduleReview);
  control.statement = `${control.statement} with a changed approval step`;
  controlEntry.source = `${JSON.stringify(control, null, 2)}\n`;
  assert.notEqual(await source(), original);
  assert.notEqual(collectionRevision(loaded, "retention-schedule-item"), scheduleReview);
  control.statement = "Example statement for Control";
  control.status = "retired";
  controlEntry.source = `${JSON.stringify(control, null, 2)}\n`;
  assert.notEqual(await source(), original);
  assert.notEqual(collectionRevision(loaded, "retention-schedule-item"), scheduleReview);
  control.status = "planned";
  const programEntry = loaded.entries.find(({ record }) => record.id === program.id);
  const programSource = (await resourceReviewRevisions(loaded, [program.id])).get(program.id);
  program.systemIds = [];
  programEntry.source = `${JSON.stringify(program, null, 2)}\n`;
  assert.notEqual((await resourceReviewRevisions(loaded, [program.id])).get(program.id), programSource);
});

test("retention schedule reviews ignore binding format and row bookkeeping", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-schedule-binding-upgrade-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  let loaded = await loadWorkspace(root);
  const rowEntry = loaded.entries.find(({ record }) => record.type === "retention-schedule-item");
  const control = loaded.resources.find(({ type }) => type === "control");
  rowEntry.record.sourceResourceIds = [control.id];
  rowEntry.record.reviewedSourceRevisions = Object.fromEntries(resourceReviewRevisionsSync(loaded, [control.id], "legacy", true));
  await writeFile(rowEntry.path, `${JSON.stringify(rowEntry.record, null, 2)}\n`);
  await initializeGitWorkspace(root);
  loaded = await loadWorkspace(root);
  const oldRevision = collectionRevision(loaded, "retention-schedule-item", { historicalReviewMetadata: true });
  const currentRevision = collectionRevision(loaded, "retention-schedule-item");
  assert.notEqual(oldRevision, currentRevision);
  assert.equal(collectionRevisionMatches(loaded, "retention-schedule-item", oldRevision), true);
  const review = { scopeRevision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim() };
  rowEntry.record.reviewedSourceRevisions = Object.fromEntries(await resourceReviewRevisions(loaded, [control.id]));
  rowEntry.record.tags = ["reviewed"];
  await writeFile(rowEntry.path, `${JSON.stringify(rowEntry.record, null, 2)}\n`);
  loaded = await loadWorkspace(root);
  assert.equal(collectionRevision(loaded, "retention-schedule-item"), currentRevision);
  assert.equal(collectionRevisionMatches(loaded, "retention-schedule-item", oldRevision, { review }), true);
  rowEntry.record.dispositionAction = "archive";
  await writeFile(rowEntry.path, `${JSON.stringify(rowEntry.record, null, 2)}\n`);
  loaded = await loadWorkspace(root);
  assert.equal(collectionRevisionMatches(loaded, "retention-schedule-item", oldRevision, { review }), false);
});

test("cross-step source reviews ignore routine metadata for other record types", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-other-review-sources-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const cases = [
    ["commitment", "applicabilityReview", { decision: "applicable", rationale: "Reviewed." }, "statement"],
    ["complementary-control", "applicabilityReview", { decision: "applicable", rationale: "Reviewed." }, "statement"],
    ["source-coverage", "readinessTestEvidenceIds", ["evidence-review-example"], "coverageKind"],
    ["policy", "approvedOn", "2026-10-01", "policyKind"],
    ["document", "activatedOn", "2026-10-01", "documentKind"],
    ["system", "ownerIds", ["person-independent-approver-example"], "boundary"],
    ["component", "evidenceOwnerIds", ["person-independent-approver-example"], "description"],
    ["vendor", "ownerIds", ["person-independent-approver-example"], "description"],
    ["information-type", "tags", ["reviewed"], "description"],
    ["framework", "statusTransition", { changedOn: "2026-10-01" }, "description"],
    ["requirement", "tags", ["reviewed"], "description"]
  ];
  for (const [type, metadataField, metadataValue, materialField] of cases) {
    const record = loaded.resources.find((candidate) => candidate.type === type);
    const entry = loaded.entries.find((candidate) => candidate.record.id === record.id);
    const revision = async () => (await resourceReviewRevisions(loaded, [record.id])).get(record.id);
    const original = await revision();
    const priorMetadata = record[metadataField];
    const priorMaterial = record[materialField];
    record[metadataField] = metadataValue;
    entry.source = `${JSON.stringify(record, null, 2)}\n`;
    assert.equal(await revision(), original, `${type} ${metadataField}`);
    record[materialField] = `${record[materialField] || "scope"} changed`;
    entry.source = `${JSON.stringify(record, null, 2)}\n`;
    assert.notEqual(await revision(), original, `${type} ${materialField}`);
    record[materialField] = priorMaterial;
    if (priorMetadata === undefined) delete record[metadataField];
    else record[metadataField] = priorMetadata;
    entry.source = `${JSON.stringify(record, null, 2)}\n`;
  }
  for (const [type, field, value] of [
    ["component", "evidenceSourceKinds", ["system-configuration"]],
    ["source-coverage", "retentionScheduleItemIds", ["retention-schedule-item-example"]]
  ]) {
    const entry = loaded.entries.find(({ record }) => record.type === type);
    const before = (await resourceReviewRevisions(loaded, [entry.record.id])).get(entry.record.id);
    entry.record[field] = value;
    entry.source = `${JSON.stringify(entry.record, null, 2)}\n`;
    assert.notEqual((await resourceReviewRevisions(loaded, [entry.record.id])).get(entry.record.id), before, `${type} ${field}`);
  }
});

test("source reviews retain governing lifecycle and effective-date changes", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-source-lifecycle-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  for (const type of ["policy", "document"]) {
    const entry = loaded.entries.find(({ record }) => record.type === type);
    const revision = async () => (await resourceReviewRevisions(loaded, [entry.record.id])).get(entry.record.id);
    entry.record.status = "approved";
    entry.source = `${JSON.stringify(entry.record, null, 2)}\n`;
    const approved = await revision();
    entry.record.status = "active";
    entry.source = `${JSON.stringify(entry.record, null, 2)}\n`;
    assert.equal(await revision(), approved, `${type} activation`);
    entry.record.status = "draft";
    entry.source = `${JSON.stringify(entry.record, null, 2)}\n`;
    assert.notEqual(await revision(), approved, `${type} governing status`);
    entry.record.status = "approved";
    entry.record.effectiveOn = "2030-01-01";
    entry.source = `${JSON.stringify(entry.record, null, 2)}\n`;
    assert.notEqual(await revision(), approved, `${type} effective date`);
  }
  const coverage = loaded.entries.find(({ record }) => record.type === "source-coverage");
  coverage.record.status = "planned";
  coverage.source = `${JSON.stringify(coverage.record, null, 2)}\n`;
  const planned = (await resourceReviewRevisions(loaded, [coverage.record.id])).get(coverage.record.id);
  coverage.record.status = "active";
  coverage.source = `${JSON.stringify(coverage.record, null, 2)}\n`;
  assert.notEqual((await resourceReviewRevisions(loaded, [coverage.record.id])).get(coverage.record.id), planned);
});

test("reads legacy approval, activation, attestation, and applicability bindings without rewriting records", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-revision-upgrade-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");

  let before = await loadWorkspace(root);
  const programEntry = before.entries.find(({ record }) => record.type === "program");
  const reviewedRequirement = before.resources.find(({ type, id }) => (
    type === "requirement"
    && programEntry.record.requirementApplicability.some(({ requirementId }) => requirementId === id)
  ));
  const currentScopeRevision = applicabilityScopeRevision(
    reviewedRequirement,
    programEntry.record,
    before.resources,
    before.model
  );
  for (const review of programEntry.record.requirementApplicability || []) {
    review.scopeRevision = `scope:${digest(currentScopeRevision)}`;
  }
  await writeFile(programEntry.path, `${JSON.stringify(programEntry.record, null, 2)}\n`);
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: root });
  execFileSync("git", ["config", "user.name", "FileGRC Test"], { cwd: root });
  execFileSync("git", ["config", "user.email", "filegrc@example.test"], { cwd: root });
  execFileSync("git", ["add", "data"], { cwd: root });
  execFileSync("git", ["commit", "-m", "Create legacy revision fixture"], { cwd: root });
  const validation = await validateWorkspace(root);
  assert.equal(validation.ok, true, validation.diagnostics.map(({ message }) => message).join("\n"));
  assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }), "");

  const document = before.resources.find(({ type }) => type === "document");
  assert.ok(Object.values(document.approvedContentRevisions).every((value) => /^[a-f0-9]{64}$/.test(value)));
  assert.equal(contentRevisionBindingsMatch(document.approvedContentRevisions, document.activatedContentRevisions), true);

  const program = before.resources.find(({ type }) => type === "program");
  const requirement = before.resources.find(({ type, id }) => (
    type === "requirement" && program.requirementApplicability.some(({ requirementId }) => requirementId === id)
  ));
  const review = program.requirementApplicability.find(({ requirementId }) => requirementId === requirement.id);
  assert.equal(applicabilityReviewIsCurrent(review, requirement, program, before.resources, before.model), true);
  assert.ok(review.scopeRevision.startsWith("scope:"));
});

test("accepts legacy collection, applicability, collection-review, and reporting-route revisions during upgrade", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-revision-compatibility-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const program = loaded.resources.find(({ type }) => type === "program");
  const collection = collectionRevision(loaded, "person", { program });
  assert.equal(collectionRevisionMatches(loaded, "person", digest(collection), { program, currentRevision: collection }), true);
  assert.equal(digest(collection), legacyCollectionRevision(loaded, "person", { program }));
  assert.equal(digest(collectionRevision(loaded, "control", { program })), legacyCollectionRevision(loaded, "control", { program }));

  const control = loaded.resources.find(({ type }) => type === "control");
  const applicability = applicabilityScopeRevision(control, program, loaded.resources, loaded.model);
  assert.equal(applicabilityReviewIsCurrent(
    { scopeRevision: `scope:${digest(applicability)}` },
    control,
    program,
    loaded.resources,
    loaded.model
  ), true);

  const collectionReview = {
    id: "collection-review-example",
    type: "collection-review",
    title: "Example review",
    resourceType: "person",
    decision: "complete",
    rationale: "Reviewed.",
    reviewedByIds: ["person-example"],
    reviewedOn: "2026-09-23",
    collectionRevision: collection,
    scopeRevision: "0123456789abcdef"
  };
  const reviewRevision = collectionReviewRevision(collectionReview);
  assert.equal(digest(reviewRevision), createHash("sha256").update(JSON.stringify({
    ...collectionReview,
    collectionRevision: digest(collection)
  })).digest("hex"));
  assert.equal(revisionsMatch("collection-review", digest(reviewRevision), reviewRevision), true);
  assert.equal(revisionsMatch(
    "collection-review",
    collectionReviewRevision({ ...collectionReview, collectionRevision: digest(collection) }),
    reviewRevision
  ), true);

  const routeRevision = reportingRouteRevision({
    id: "route-example",
    type: "reporting-route",
    title: "Route",
    purpose: "security-reporting",
    priority: "primary",
    channelKind: "email",
    route: "security@example.test"
  });
  assert.equal(revisionsMatch("reporting-route", digest(routeRevision), routeRevision), true);
});

test("scheme labels do not require a new collection review, but changed facts do", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-revision-stability-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const program = loaded.resources.find(({ type }) => type === "program");
  const document = loaded.resources.find(({ type, approvedContentRevisions }) => (
    type === "document" && Object.keys(approvedContentRevisions || {}).length
  ));
  assert.ok(document, "fixture has a governed document");
  const reviewed = collectionRevision(loaded, "document", { program });
  document.approvedContentRevisions = Object.fromEntries(Object.entries(document.approvedContentRevisions).map(([path, value]) => [
    path,
    `filegrc:content:v1:sha256:${digest(value)}`
  ]));
  assert.equal(collectionRevision(loaded, "document", { program }), reviewed);
  document.title = `${document.title} revised`;
  assert.notEqual(collectionRevision(loaded, "document", { program }), reviewed);
  const exampleDigest = digest(Object.values(document.approvedContentRevisions)[0]);
  document.title = exampleDigest;
  const changedTitleRevision = collectionRevision(loaded, "document", { program });
  document.title = `filegrc:content:v1:sha256:${exampleDigest}`;
  assert.notEqual(collectionRevision(loaded, "document", { program }), changedTitleRevision);
});

test("scheme-only source labels preserve retention and mapping review bindings", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-source-review-stability-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const documentEntry = loaded.entries.find(({ record }) => (
    record.type === "document" && Object.keys(record.approvedContentRevisions || {}).length
  ));
  const target = loaded.resources.find(({ type }) => type === "requirement");
  assert.ok(documentEntry && target);
  const ids = [documentEntry.record.id, target.id];
  const original = await resourceReviewRevisions(loaded, ids);
  const mapping = {
    id: "requirement-mapping-revision-stability",
    type: "requirement-mapping",
    title: "Review binding stability",
    status: "active",
    sourceResourceIds: [documentEntry.record.id],
    targetResourceIds: [target.id],
    relationship: "intersects-with",
    method: "semantic",
    rationale: "Reviewed both source records.",
    ownerIds: ["person-example"],
    reviewedByIds: ["person-independent-approver-example"],
    reviewedOn: "2026-09-23",
    reviewedSourceRevisions: Object.fromEntries([...original].map(([id, revision]) => [id, digest(revision)]))
  };
  loaded.resources.push(mapping);
  documentEntry.record.approvedContentRevisions = Object.fromEntries(Object.entries(documentEntry.record.approvedContentRevisions).map(([path, value]) => [
    path,
    `filegrc:content:v1:sha256:${digest(value)}`
  ]));
  documentEntry.source = `${JSON.stringify(documentEntry.record, null, 2)}\n`;
  const relabeled = await resourceReviewRevisions(loaded, ids);
  assert.deepEqual(relabeled, original);
  assert.equal((await assessRequirementMappingReadiness(loaded)).find(({ id }) => id === `requirement-mapping-${mapping.id}`).status, "complete");
  documentEntry.record.title = `${documentEntry.record.title} updated`;
  documentEntry.source = `${JSON.stringify(documentEntry.record, null, 2)}\n`;
  assert.notEqual((await resourceReviewRevisions(loaded, [documentEntry.record.id])).get(documentEntry.record.id), original.get(documentEntry.record.id));
});

test("embedded applicability labels preserve legacy source and collection revisions", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-applicability-review-stability-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const program = loaded.resources.find(({ type }) => type === "program");
  const entry = loaded.entries.find(({ record }) => record.type === "control");
  const digestValue = digest(applicabilityScopeRevision(entry.record, program, loaded.resources, loaded.model));
  entry.record.applicabilityReview = { scopeRevision: `scope:${digestValue}` };
  entry.source = `${JSON.stringify(entry.record, null, 2)}\n`;
  assert.equal(applicabilityReviewIsCurrent(entry.record.applicabilityReview, entry.record, program, loaded.resources, loaded.model), true);

  const target = loaded.resources.find(({ type }) => type === "requirement");
  const reviewedIds = [entry.record.id, target.id];
  const reviewedRevisions = await resourceReviewRevisions(loaded, reviewedIds);
  const mapping = {
    id: "requirement-mapping-applicability-review",
    type: "requirement-mapping",
    title: "Applicability review mapping",
    status: "active",
    sourceResourceIds: [entry.record.id],
    targetResourceIds: [target.id],
    relationship: "intersects-with",
    method: "semantic",
    rationale: "Reviewed both source records.",
    ownerIds: ["person-example"],
    reviewedByIds: ["person-independent-approver-example"],
    reviewedOn: "2026-09-23",
    reviewedSourceRevisions: Object.fromEntries(reviewedRevisions)
  };
  loaded.resources.push(mapping);

  const schedule = loaded.resources.find(({ type }) => type === "document");
  schedule.documentKind = "schedule";
  const rule = {
    id: "retention-schedule-item-applicability-review",
    type: "retention-schedule-item",
    title: "Applicability review retention",
    status: "active",
    description: "Retain the reviewed control record.",
    informationTypeIds: [loaded.resources.find(({ type }) => type === "information-type").id],
    scopeResourceIds: [program.id],
    scheduleDocumentId: schedule.id,
    sourceResourceIds: [entry.record.id],
    ownerIds: ["person-example"],
    cutoff: { basis: "creation" },
    retentionPeriod: { basis: "fixed", amount: 1, unit: "year" },
    dispositionAction: "delete",
    dispositionInstructions: "Delete after the approved period."
  };
  const retentionIds = retentionReviewResourceIds(rule, loaded);
  const retentionRevisions = await resourceReviewRevisions(loaded, retentionIds);
  rule.reviewedSourceRevisions = Object.fromEntries(retentionRevisions);
  const version016Revisions = await resourceReviewRevisions(loaded, retentionIds, "digest");
  const version016Rule = { ...rule, reviewedSourceRevisions: Object.fromEntries(version016Revisions) };
  const version016Mapping = {
    ...mapping,
    id: "requirement-mapping-version-016-review",
    reviewedSourceRevisions: Object.fromEntries(await resourceReviewRevisions(loaded, reviewedIds, "digest"))
  };
  loaded.resources.push(version016Mapping);
  const ruleCurrent = async (candidate) => retentionRuleIsCurrent(
    candidate,
    await resourceReviewRevisions(loaded, retentionIds),
    new Map(loaded.resources.map((record) => [record.id, record])),
    loaded
  );

  const legacySourceRevision = (await resourceReviewRevisions(loaded, [entry.record.id])).get(entry.record.id);
  const legacyCollectionRevision = collectionRevision(loaded, "control", { program });
  const version016SourceRevision = version016Revisions.get(entry.record.id);
  const version016CollectionRevision = collectionRevision(loaded, "control", { program, scopeHashInput: "digest" });
  assert.equal(version016SourceRevision, legacySourceRevision);
  assert.equal(version016CollectionRevision, legacyCollectionRevision);
  assert.equal(canonicalCalculatedRevisionJson(entry.source), entry.source);
  assert.equal(canonicalCalculatedRevisionJson(entry.source, "digest"), entry.source.replace(`scope:${digestValue}`, digestValue));
  assert.equal((await assessRequirementMappingReadiness(loaded)).find(({ id }) => id === `requirement-mapping-${mapping.id}`).status, "complete");
  assert.equal((await assessRequirementMappingReadiness(loaded)).find(({ id }) => id === `requirement-mapping-${version016Mapping.id}`).status, "complete");
  assert.equal(await ruleCurrent(rule), true);
  assert.equal(await ruleCurrent(version016Rule), true);
  assert.equal(collectionRevisionMatches(loaded, "control", version016CollectionRevision, { program }), true);
  assert.equal(applicabilityReviewIsCurrent(entry.record.applicabilityReview, entry.record, program, loaded.resources, loaded.model), true);

  entry.record.applicabilityReview.scopeRevision = `filegrc:applicability-scope:v1:sha256:${digestValue}`;
  entry.source = `${JSON.stringify(entry.record, null, 2)}\n`;
  assert.equal((await resourceReviewRevisions(loaded, [entry.record.id])).get(entry.record.id), legacySourceRevision);
  assert.equal(collectionRevision(loaded, "control", { program }), legacyCollectionRevision);
  assert.equal((await assessRequirementMappingReadiness(loaded)).find(({ id }) => id === `requirement-mapping-${mapping.id}`).status, "complete");
  assert.equal((await assessRequirementMappingReadiness(loaded)).find(({ id }) => id === `requirement-mapping-${version016Mapping.id}`).status, "complete");
  assert.equal(await ruleCurrent(rule), true);
  assert.equal(await ruleCurrent(version016Rule), true);
  assert.equal(collectionRevisionMatches(loaded, "control", version016CollectionRevision, { program }), true);

  entry.record.applicabilityReview.scopeRevision = `filegrc:applicability-scope:v1:sha256:${"b".repeat(64)}`;
  entry.source = `${JSON.stringify(entry.record, null, 2)}\n`;
  assert.equal((await resourceReviewRevisions(loaded, [entry.record.id])).get(entry.record.id), legacySourceRevision);
  assert.equal(collectionRevision(loaded, "control", { program }), legacyCollectionRevision);
  assert.equal((await assessRequirementMappingReadiness(loaded)).find(({ id }) => id === `requirement-mapping-${mapping.id}`).status, "complete");
  assert.equal((await assessRequirementMappingReadiness(loaded)).find(({ id }) => id === `requirement-mapping-${version016Mapping.id}`).status, "complete");
  assert.equal(await ruleCurrent(rule), true);
  assert.equal(await ruleCurrent(version016Rule), true);
  assert.equal(collectionRevisionMatches(loaded, "control", version016CollectionRevision, { program }), true);

  entry.record.applicabilityReview.decision = "not-applicable";
  entry.source = `${JSON.stringify(entry.record, null, 2)}\n`;
  assert.notEqual((await resourceReviewRevisions(loaded, [entry.record.id])).get(entry.record.id), legacySourceRevision);
  assert.equal(await ruleCurrent(rule), false);

  entry.record.applicabilityReview.scopeRevision = `filegrc:applicability-scope:v1:sha256:${digestValue}`;
  const selectedSystem = loaded.resources.find(({ type, id }) => type === "system" && (program.systemIds || []).includes(id));
  assert.ok(selectedSystem);
  selectedSystem.boundary = `${selectedSystem.boundary || "Service boundary"} updated`;
  assert.equal(applicabilityReviewIsCurrent(entry.record.applicabilityReview, entry.record, program, loaded.resources, loaded.model), false);
});

test("committed legacy source bindings survive metadata-only applicability reviews", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-review-metadata-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const before = await loadWorkspace(root);
  const entry = before.entries.find(({ record }) => record.type === "commitment");
  const program = before.resources.find(({ type }) => type === "program");
  const scopeRevision = applicabilityScopeRevision(entry.record, program, before.resources, before.model);
  entry.record.applicabilityReview = {
    decision: "applicable", rationale: "Reviewed service scope.", reviewedByIds: ["person-example"],
    reviewedOn: "2026-09-20", scopeRevision
  };
  await writeFile(entry.path, `${JSON.stringify(entry.record, null, 2)}\n`);
  const reviewed = await loadWorkspace(root);
  const oldBinding = resourceReviewRevisionsSync(reviewed, [entry.record.id], "legacy", true).get(entry.record.id);
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: root });
  execFileSync("git", ["config", "user.name", "FileGRC Test"], { cwd: root });
  execFileSync("git", ["config", "user.email", "filegrc@example.test"], { cwd: root });
  execFileSync("git", ["add", "data"], { cwd: root });
  execFileSync("git", ["commit", "-m", "Record reviewed commitment"], { cwd: root });

  entry.record.applicabilityReview = {
    ...entry.record.applicabilityReview,
    rationale: "Confirmed after retiring a draft.",
    reviewedOn: "2026-09-29"
  };
  await writeFile(entry.path, `${JSON.stringify(entry.record, null, 2)}\n`);
  const current = await loadWorkspace(root);
  const revisions = resourceReviewRevisionsSync(current, [entry.record.id]);
  assert.equal(resourceReviewRevisionMatches(current, revisions, entry.record.id, oldBinding), true);

  entry.record.statement = `${entry.record.statement} Changed.`;
  await writeFile(entry.path, `${JSON.stringify(entry.record, null, 2)}\n`);
  const changed = await loadWorkspace(root);
  assert.equal(resourceReviewRevisionMatches(
    changed, resourceReviewRevisionsSync(changed, [entry.record.id]), entry.record.id, oldBinding
  ), false);
});

test("legacy bindings of linked sources survive only equivalent reviewed facts", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-linked-review-metadata-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const before = await loadWorkspace(root);
  const parentEntry = before.entries.find(({ record }) => record.type === "requirement-mapping");
  const commitmentEntry = before.entries.find(({ record }) => record.type === "commitment");
  parentEntry.record.sourceResourceIds = [commitmentEntry.record.id];
  commitmentEntry.record.applicabilityReview = {
    decision: "applicable", rationale: "Original review.", reviewedOn: "2026-09-20",
    reviewedByIds: ["person-example"], scopeRevision: "scope:" + "a".repeat(64)
  };
  await writeFile(parentEntry.path, `${JSON.stringify(parentEntry.record, null, 2)}\n`);
  await writeFile(commitmentEntry.path, `${JSON.stringify(commitmentEntry.record, null, 2)}\n`);
  const reviewed = await loadWorkspace(root);
  const oldBinding = resourceReviewRevisionsSync(
    reviewed, [parentEntry.record.id], "legacy", true
  ).get(parentEntry.record.id);
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: root });
  execFileSync("git", ["config", "user.name", "FileGRC Test"], { cwd: root });
  execFileSync("git", ["config", "user.email", "filegrc@example.test"], { cwd: root });
  execFileSync("git", ["add", "data"], { cwd: root });
  execFileSync("git", ["commit", "-m", "Record linked review"], { cwd: root });
  commitmentEntry.record.applicabilityReview.reviewedOn = "2026-09-29";
  await writeFile(commitmentEntry.path, `${JSON.stringify(commitmentEntry.record, null, 2)}\n`);
  const current = await loadWorkspace(root);
  assert.equal(resourceReviewRevisionMatches(
    current, resourceReviewRevisionsSync(current, [parentEntry.record.id]), parentEntry.record.id, oldBinding
  ), true);
  commitmentEntry.record.statement = `${commitmentEntry.record.statement} Changed.`;
  await writeFile(commitmentEntry.path, `${JSON.stringify(commitmentEntry.record, null, 2)}\n`);
  const changed = await loadWorkspace(root);
  assert.equal(resourceReviewRevisionMatches(
    changed, resourceReviewRevisionsSync(changed, [parentEntry.record.id]), parentEntry.record.id, oldBinding
  ), false);
});

test("legacy source recovery stays within a request deadline on a 365-record, 119-commit workspace", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-review-history-scale-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const initial = await loadWorkspace(root);
  const template = initial.entries.find(({ record }) => record.type === "commitment");
  const unrelated = initial.entries.find(({ record }) => record.type === "person");
  const count = 365 - initial.resources.length;
  assert.ok(count > 0);
  const clones = [];
  const reviewCount = Math.min(32, count);
  for (let index = 0; index < reviewCount; index += 1) {
    const record = {
      ...structuredClone(template.record),
      id: `commitment-history-scale-${index}`,
      title: `History scale commitment ${index}`,
      applicabilityReview: {
        decision: "applicable", rationale: "Original review.",
        reviewedByIds: ["person-example"], reviewedOn: "2026-09-20"
      }
    };
    const path = join(dirname(template.path), `${record.id}.json`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(record, null, 2)}\n`);
    clones.push({ record, path });
  }
  for (let index = reviewCount; index < count; index += 1) {
    const record = {
      ...structuredClone(unrelated.record),
      id: `person-history-scale-${index}`,
      title: `History scale person ${index}`
    };
    await writeFile(join(dirname(unrelated.path), `${record.id}.json`), `${JSON.stringify(record, null, 2)}\n`);
  }
  const reviewed = await loadWorkspace(root);
  assert.equal(reviewed.resources.length, 365);
  const ids = clones.map(({ record }) => record.id);
  const oldBindings = resourceReviewRevisionsSync(reviewed, ids, "legacy", true);
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: root });
  execFileSync("git", ["config", "user.name", "FileGRC Test"], { cwd: root });
  execFileSync("git", ["config", "user.email", "filegrc@example.test"], { cwd: root });
  execFileSync("git", ["add", "data"], { cwd: root });
  execFileSync("git", ["commit", "-m", "Create review history"], { cwd: root });
  for (let index = 1; index < 119; index += 1) {
    unrelated.record.jobTitle = `Engineer ${index}`;
    await writeFile(unrelated.path, `${JSON.stringify(unrelated.record, null, 2)}\n`);
    execFileSync("git", ["add", "data"], { cwd: root });
    execFileSync("git", ["commit", "-m", `Update unrelated person ${index}`], { cwd: root });
  }
  for (const clone of clones) {
    clone.record.applicabilityReview.reviewedOn = "2026-09-29";
    await writeFile(clone.path, `${JSON.stringify(clone.record, null, 2)}\n`);
  }
  const current = await loadWorkspace(root);
  const revisions = resourceReviewRevisionsSync(current, ids);
  const started = performance.now();
  for (const id of ids) {
    assert.equal(resourceReviewRevisionMatches(current, revisions, id, oldBindings.get(id)), true, id);
  }
  assert.ok(performance.now() - started < 10_000, "legacy review recovery exceeded the request deadline");
  const changed = current.entries.find(({ record }) => record.id === ids[0]);
  changed.record.statement = `${changed.record.statement} A substantive change.`;
  changed.source = JSON.stringify(changed.record);
  const changedRevisions = resourceReviewRevisionsSync(current, [ids[0]]);
  assert.equal(resourceReviewRevisionMatches(current, changedRevisions, ids[0], oldBindings.get(ids[0])), false);

  const cli = fileURLToPath(new URL("../bin/filegrc.js", import.meta.url));
  for (const args of [["guide", "retention-schedule-item", "--json"], ["program-path", "--summary", "--json"]]) {
    const output = execFileSync(process.execPath, [cli, ...args], {
      cwd: root, encoding: "utf8", timeout: 10_000, maxBuffer: 10_000_000
    });
    assert.ok(JSON.parse(output), `${args[0]} returned JSON`);
  }
  const served = await serveWorkspace(root, { port: 0 });
  context.after(() => new Promise((resolve) => served.server.close(resolve)));
  const bootstrapResponse = await fetch(`${served.url}/api/state/bootstrap`, { signal: AbortSignal.timeout(10_000) });
  assert.equal(bootstrapResponse.status, 200);
  const { stateToken } = await bootstrapResponse.json();
  for (const section of ["program", "workflow"]) {
    const response = await fetch(`${served.url}/api/state/${section}?token=${encodeURIComponent(stateToken)}`, {
      signal: AbortSignal.timeout(10_000)
    });
    assert.equal(response.status, 200, `${section}: ${await response.text()}`);
  }
});

test("collection and applicability recovery reuse snapshots beyond 128 commits", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-long-review-history-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const before = await loadWorkspace(root);
  const controlEntry = before.entries.find(({ record }) => record.type === "control");
  const commitment = before.resources.find(({ type }) => type === "commitment");
  const program = before.resources.find(({ type }) => type === "program");
  const personEntry = before.entries.find(({ record }) => record.type === "person");
  const broadReview = {
    decision: "applicable",
    scopeRevision: applicabilityScopeRevision(commitment, program, before.resources, before.model, {
      legacyBroadCommitment: true
    })
  };
  controlEntry.record.applicabilityReview = {
    decision: "applicable", rationale: "Original review.", reviewedByIds: ["person-example"],
    reviewedOn: "2026-09-20", scopeRevision: applicabilityScopeRevision(
      controlEntry.record, program, before.resources, before.model
    )
  };
  await writeFile(controlEntry.path, `${JSON.stringify(controlEntry.record, null, 2)}\n`);
  let unrelatedPerson;
  for (let index = before.resources.length; index < 365; index += 1) {
    const record = {
      ...structuredClone(personEntry.record), id: `person-long-history-${index}`,
      title: `Long history person ${index}`
    };
    const path = join(dirname(personEntry.path), `${record.id}.json`);
    await writeFile(path, `${JSON.stringify(record, null, 2)}\n`);
    unrelatedPerson ||= { record, path };
  }
  const reviewed = await loadWorkspace(root);
  const oldCollection = collectionRevision(reviewed, "control", {
    programId: program.id, historicalReviewMetadata: true
  });
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: root });
  execFileSync("git", ["config", "user.name", "FileGRC Test"], { cwd: root });
  execFileSync("git", ["config", "user.email", "filegrc@example.test"], { cwd: root });
  execFileSync("git", ["add", "data"], { cwd: root });
  execFileSync("git", ["commit", "-m", "Create reviewed program"], { cwd: root });
  controlEntry.record.applicabilityReview.reviewedOn = "2026-09-29";
  await writeFile(controlEntry.path, `${JSON.stringify(controlEntry.record, null, 2)}\n`);
  execFileSync("git", ["add", "data"], { cwd: root });
  execFileSync("git", ["commit", "-m", "Update review metadata"], { cwd: root });
  for (let index = 2; index < 150; index += 1) {
    unrelatedPerson.record.jobTitle = `Engineer ${index}`;
    await writeFile(unrelatedPerson.path, `${JSON.stringify(unrelatedPerson.record, null, 2)}\n`);
    execFileSync("git", ["add", "data"], { cwd: root });
    execFileSync("git", ["commit", "-m", `Update person ${index}`], { cwd: root });
  }
  const current = await loadWorkspace(root);
  const started = performance.now();
  for (let index = 0; index < 3; index += 1) {
    assert.equal(collectionRevisionMatches(current, "control", oldCollection, { programId: program.id }), true);
  }
  const currentProgram = current.resources.find(({ id }) => id === program.id);
  currentProgram.systemIds.push("system-unrelated");
  const currentCommitment = current.resources.find(({ id }) => id === commitment.id);
  for (let index = 0; index < 3; index += 1) {
    assert.equal(applicabilityReviewIsCurrent(
      broadReview, currentCommitment, currentProgram, current.resources, current.model, root
    ), true);
  }
  assert.ok(performance.now() - started < 10_000, "repeated legacy recovery exceeded the request deadline");
  assert.ok(reviewHistoryContext(root, current).workspacesByCommit.size > 128);
});

test("governed approval metadata does not change source facts but Markdown does", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-governed-source-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const entry = loaded.entries.find(({ record }) => record.type === "document");
  const original = resourceReviewRevisionsSync(loaded, [entry.record.id]).get(entry.record.id);
  entry.record.approvedOn = "2026-09-29";
  entry.record.activatedOn = "2026-09-29";
  entry.record.approverIds = ["person-example"];
  entry.source = `${JSON.stringify(entry.record, null, 2)}\n`;
  assert.equal(resourceReviewRevisionsSync(loaded, [entry.record.id]).get(entry.record.id), original);
  const markdownPath = join(root, "data", "documents", "document-example.md");
  await writeFile(markdownPath, "# Changed governed content\n");
  assert.notEqual(resourceReviewRevisionsSync(loaded, [entry.record.id]).get(entry.record.id), original);
});

test("retention collection follows Policy content instead of reapproval metadata", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-retention-policy-source-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const row = loaded.resources.find(({ type }) => type === "retention-schedule-item");
  const policy = loaded.resources.find(({ type }) => type === "policy");
  row.sourceResourceIds = [policy.id];
  const original = collectionRevision(loaded, "retention-schedule-item");
  policy.approvedOn = "2026-09-29";
  policy.approverIds = ["person-example"];
  assert.equal(collectionRevision(loaded, "retention-schedule-item"), original);
  await writeFile(join(root, "data", "policies", "policy-example.md"), "# Changed policy rule\n");
  assert.notEqual(collectionRevision(loaded, "retention-schedule-item"), original);
});

test("evidence source roles do not reopen retention decisions, but information use changes do", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-retention-component-role-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const componentEntry = loaded.entries.find(({ record }) => record.type === "component");
  const row = loaded.resources.find(({ type }) => type === "retention-schedule-item");
  row.sourceResourceIds = [componentEntry.record.id];
  componentEntry.record.systemUses[0].roles = ["service-delivery", "control-support"];
  componentEntry.source = `${JSON.stringify(componentEntry.record, null, 2)}\n`;
  const reviewed = resourceReviewRevisionsSync(loaded, [componentEntry.record.id], "legacy", false, null, row).get(componentEntry.record.id);
  const schedule = collectionRevision(loaded, "retention-schedule-item");
  componentEntry.record.systemUses[0].roles.push("evidence-source");
  componentEntry.source = `${JSON.stringify(componentEntry.record, null, 2)}\n`;
  const revisions = resourceReviewRevisionsSync(loaded, [componentEntry.record.id], "legacy", false, null, row);
  assert.equal(revisions.get(componentEntry.record.id), reviewed);
  assert.equal((await resourceReviewRevisions(loaded, [componentEntry.record.id], "legacy", row)).get(componentEntry.record.id), reviewed);
  assert.equal(collectionRevision(loaded, "retention-schedule-item"), schedule);
  componentEntry.record.systemUses[0].roles = ["evidence-source", "control-support"];
  componentEntry.source = `${JSON.stringify(componentEntry.record, null, 2)}\n`;
  assert.notEqual(resourceReviewRevisionsSync(loaded, [componentEntry.record.id], "legacy", false, null, row).get(componentEntry.record.id), reviewed);
  assert.notEqual(collectionRevision(loaded, "retention-schedule-item"), schedule);
  componentEntry.record.systemUses[0].roles = ["service-delivery", "control-support", "evidence-source"];
  componentEntry.source = `${JSON.stringify(componentEntry.record, null, 2)}\n`;
  componentEntry.record.informationUses = [{
    informationTypeId: loaded.resources.find(({ type }) => type === "information-type").id,
    processingOperations: ["store"]
  }];
  componentEntry.source = `${JSON.stringify(componentEntry.record, null, 2)}\n`;
  assert.notEqual(resourceReviewRevisionsSync(loaded, [componentEntry.record.id], "legacy", false, null, row).get(componentEntry.record.id), reviewed);
  assert.notEqual(collectionRevision(loaded, "retention-schedule-item"), schedule);
});

test("a retention row bound to a policy section survives unrelated wording edits", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-retention-policy-section-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const before = await loadWorkspace(root);
  const rowEntry = before.entries.find(({ record }) => record.type === "retention-schedule-item");
  const policy = before.resources.find(({ type }) => type === "policy");
  const policyPath = join(root, "data", "policies", "policy-example.md");
  await writeFile(policyPath, "# Security Policy\n\n## Retention\nKeep records for the approved period.\n\n## Network\nReview network rules.\n");
  rowEntry.record.sourceResourceIds = [policy.id];
  rowEntry.record.sourceSectionHeadings = { [policy.id]: "Retention" };
  await writeFile(rowEntry.path, `${JSON.stringify(rowEntry.record, null, 2)}\n`);
  const reviewed = await loadWorkspace(root);
  const priorWholePolicyRevision = resourceReviewRevisionsSync(reviewed, [policy.id]).get(policy.id);
  const revision = resourceReviewRevisionsSync(reviewed, [policy.id], "legacy", false, null, rowEntry.record).get(policy.id);
  const schedule = collectionRevision(reviewed, "retention-schedule-item");
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: root });
  execFileSync("git", ["config", "user.name", "FileGRC Test"], { cwd: root });
  execFileSync("git", ["config", "user.email", "filegrc@example.test"], { cwd: root });
  execFileSync("git", ["add", "data"], { cwd: root });
  execFileSync("git", ["commit", "-m", "Review retention source"], { cwd: root });
  await writeFile(policyPath, "# Security Policy\n\n## Retention\nKeep records for the approved period.\n\n## Network\nReview network access rules.\n");
  const current = await loadWorkspace(root);
  const currentRevisions = resourceReviewRevisionsSync(current, [policy.id]);
  assert.equal(resourceReviewRevisionMatches(current, currentRevisions, policy.id, revision, rowEntry.record), true);
  assert.equal(resourceReviewRevisionMatches(current, currentRevisions, policy.id, priorWholePolicyRevision, rowEntry.record), true);
  assert.equal(collectionRevision(current, "retention-schedule-item"), schedule);
  await writeFile(policyPath, "# Security Policy\n\n## Retention\nKeep records for a shorter period.\n\n## Network\nReview network access rules.\n");
  const changed = await loadWorkspace(root);
  assert.equal(resourceReviewRevisionMatches(changed, resourceReviewRevisionsSync(changed, [policy.id]), policy.id, revision, rowEntry.record), false);
  assert.notEqual(collectionRevision(changed, "retention-schedule-item"), schedule);
});

test("a legacy whole-policy retention binding follows the retention section", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-retention-policy-history-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const before = await loadWorkspace(root);
  const rowEntry = before.entries.find(({ record }) => record.type === "retention-schedule-item");
  const policy = before.resources.find(({ type }) => type === "policy");
  const policyPath = join(root, "data", "policies", "policy-example.md");
  await writeFile(policyPath, "# Security Policy\n\n## Retention\nKeep records for one year.\n\n## Network\nReview network rules.\n");
  rowEntry.record.sourceResourceIds = [policy.id];
  await writeFile(rowEntry.path, `${JSON.stringify(rowEntry.record, null, 2)}\n`);
  const reviewed = await loadWorkspace(root);
  const oldBinding = resourceReviewRevisionsSync(reviewed, [policy.id]).get(policy.id);
  const oldSchedule = collectionRevision(reviewed, "retention-schedule-item", { legacyRetentionSourceBasis: true });
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: root });
  execFileSync("git", ["config", "user.name", "FileGRC Test"], { cwd: root });
  execFileSync("git", ["config", "user.email", "filegrc@example.test"], { cwd: root });
  execFileSync("git", ["add", "data"], { cwd: root });
  execFileSync("git", ["commit", "-m", "Review retention authority"], { cwd: root });

  await writeFile(policyPath, "# Security Policy\n\n## Retention\nKeep records for one year.\n\n## Network\nReview network access rules.\n");
  let current = await loadWorkspace(root);
  assert.equal(resourceReviewRevisionMatches(current, resourceReviewRevisionsSync(current, [policy.id]), policy.id, oldBinding, rowEntry.record), true);
  assert.equal(collectionRevisionMatches(current, "retention-schedule-item", oldSchedule), true);

  await writeFile(policyPath, "# Security Policy\n\n## Retention\nKeep records for two years.\n\n## Network\nReview network access rules.\n");
  current = await loadWorkspace(root);
  assert.equal(resourceReviewRevisionMatches(current, resourceReviewRevisionsSync(current, [policy.id]), policy.id, oldBinding, rowEntry.record), false);
  assert.equal(collectionRevisionMatches(current, "retention-schedule-item", oldSchedule), false);
});

test("an approved component source binding follows retention use, not evidence access", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-retention-role-history-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const before = await loadWorkspace(root);
  const componentEntry = before.entries.find(({ record }) => record.type === "component");
  const rowEntry = before.entries.find(({ record }) => record.type === "retention-schedule-item");
  componentEntry.record.systemUses[0].roles = ["service-delivery", "control-support"];
  await writeFile(componentEntry.path, `${JSON.stringify(componentEntry.record, null, 2)}\n`);
  rowEntry.record.sourceResourceIds = [componentEntry.record.id];
  await writeFile(rowEntry.path, `${JSON.stringify(rowEntry.record, null, 2)}\n`);
  const reviewed = await loadWorkspace(root);
  const original = resourceReviewRevisionsSync(reviewed, [componentEntry.record.id]).get(componentEntry.record.id);
  const schedule = collectionRevision(reviewed, "retention-schedule-item");
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: root });
  execFileSync("git", ["config", "user.name", "FileGRC Test"], { cwd: root });
  execFileSync("git", ["config", "user.email", "filegrc@example.test"], { cwd: root });
  execFileSync("git", ["add", "data"], { cwd: root });
  execFileSync("git", ["commit", "-m", "Approve component source"], { cwd: root });
  componentEntry.record.evidenceOwnerIds = ["person-example"];
  await writeFile(componentEntry.path, `${JSON.stringify(componentEntry.record, null, 2)}\n`);
  let current = await loadWorkspace(root);
  let revisions = resourceReviewRevisionsSync(current, [componentEntry.record.id]);
  assert.equal(resourceReviewRevisionMatches(current, revisions, componentEntry.record.id, original, rowEntry.record), true);
  componentEntry.record.systemUses[0].roles.push("evidence-source");
  componentEntry.record.evidenceSourceKinds = ["source-code-management"];
  await writeFile(componentEntry.path, `${JSON.stringify(componentEntry.record, null, 2)}\n`);
  current = await loadWorkspace(root);
  revisions = resourceReviewRevisionsSync(current, [componentEntry.record.id]);
  assert.equal(resourceReviewRevisionMatches(current, revisions, componentEntry.record.id, original, rowEntry.record), true);
  assert.equal(collectionRevisionMatches(current, "retention-schedule-item", schedule), true);
  componentEntry.record.informationUses = [{ informationTypeId: before.resources.find(({ type }) => type === "information-type").id, processingOperations: ["store"] }];
  await writeFile(componentEntry.path, `${JSON.stringify(componentEntry.record, null, 2)}\n`);
  current = await loadWorkspace(root);
  revisions = resourceReviewRevisionsSync(current, [componentEntry.record.id]);
  assert.equal(resourceReviewRevisionMatches(current, revisions, componentEntry.record.id, original, rowEntry.record), false);
  assert.equal(collectionRevisionMatches(current, "retention-schedule-item", schedule), false);
});

test("Program requirement review metadata does not cascade into source or collection revisions", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-program-review-metadata-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const entry = loaded.entries.find(({ record }) => record.type === "program");
  const review = entry.record.requirementApplicability[0];
  assert.ok(review);
  const sourceRevision = resourceReviewRevisionsSync(loaded, [entry.record.id]).get(entry.record.id);
  const collection = collectionRevision(loaded, "control", { program: entry.record });
  const retentionCollection = collectionRevision(loaded, "retention-schedule-item");
  review.reviewedOn = "2026-09-29";
  review.rationale = "Confirmed after an unrelated draft was retired.";
  entry.record.controlIds.push("control-unrelated");
  entry.source = `${JSON.stringify(entry.record, null, 2)}\n`;
  assert.equal(resourceReviewRevisionsSync(loaded, [entry.record.id]).get(entry.record.id), sourceRevision);
  assert.notEqual(collectionRevision(loaded, "control", { program: entry.record }), collection);
  assert.equal(collectionRevision(loaded, "retention-schedule-item"), retentionCollection);
  review.decision = review.decision === "applicable" ? "not-applicable" : "applicable";
  entry.source = `${JSON.stringify(entry.record, null, 2)}\n`;
  assert.notEqual(resourceReviewRevisionsSync(loaded, [entry.record.id]).get(entry.record.id), sourceRevision);
  assert.notEqual(collectionRevision(loaded, "control", { program: entry.record }), collection);
});

test("old collection approvals remain current after review bookkeeping changes", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-collection-review-metadata-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const before = await loadWorkspace(root);
  const entry = before.entries.find(({ record }) => record.type === "control");
  const program = before.resources.find(({ type }) => type === "program");
  entry.record.applicabilityReview = {
    decision: "applicable", rationale: "Original review.", reviewedByIds: ["person-example"],
    reviewedOn: "2026-09-20", scopeRevision: applicabilityScopeRevision(entry.record, program, before.resources, before.model)
  };
  await writeFile(entry.path, `${JSON.stringify(entry.record, null, 2)}\n`);
  const reviewed = await loadWorkspace(root);
  const oldRevision = collectionRevision(reviewed, "control", {
    programId: program.id, historicalReviewMetadata: true
  });
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: root });
  execFileSync("git", ["config", "user.name", "FileGRC Test"], { cwd: root });
  execFileSync("git", ["config", "user.email", "filegrc@example.test"], { cwd: root });
  execFileSync("git", ["add", "data"], { cwd: root });
  execFileSync("git", ["commit", "-m", "Record collection review"], { cwd: root });
  entry.record.applicabilityReview.reviewedOn = "2026-09-29";
  entry.record.applicabilityReview.rationale = "Confirmed after draft retirement.";
  await writeFile(entry.path, `${JSON.stringify(entry.record, null, 2)}\n`);
  const programEntry = before.entries.find(({ record }) => record.type === "program");
  programEntry.record.requirementApplicability[0].reviewedOn = "2026-09-29";
  programEntry.record.requirementApplicability[0].rationale = "Confirmed unchanged requirement.";
  await writeFile(programEntry.path, `${JSON.stringify(programEntry.record, null, 2)}\n`);
  const current = await loadWorkspace(root);
  assert.equal(collectionRevisionMatches(current, "control", oldRevision, { programId: program.id }), true);
  assert.equal(collectionRevisionMatches(current, "control", oldRevision, { program: current.resources.find(({ id }) => id === program.id) }), true);
  entry.record.statement = `${entry.record.statement} Changed.`;
  await writeFile(entry.path, `${JSON.stringify(entry.record, null, 2)}\n`);
  const changed = await loadWorkspace(root);
  assert.equal(collectionRevisionMatches(changed, "control", oldRevision, { programId: program.id }), false);
});

test("retention metadata does not cascade into Control collection oversight", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-retention-control-cascade-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const program = loaded.resources.find(({ type }) => type === "program");
  const control = loaded.resources.find(({ type }) => type === "control");
  const coverage = loaded.resources.find(({ type }) => type === "source-coverage");
  const rule = loaded.resources.find(({ type }) => type === "retention-schedule-item");
  control.code = "HR-01";
  coverage.retentionScheduleItemIds = [rule.id];
  const reviewed = collectionRevision(loaded, "control", { program });
  rule.reviewedSourceRevisions = { "policy-example": "a".repeat(64) };
  rule.approvedByIds = ["person-example"];
  rule.approvedOn = "2026-09-29";
  assert.equal(collectionRevision(loaded, "control", { program }), reviewed);
  rule.retentionPeriod = { basis: "fixed", amount: 2, unit: "year" };
  assert.notEqual(collectionRevision(loaded, "control", { program }), reviewed);
});

test("old collection recovery selects the reviewed Program in a multi-Program workspace", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-multi-program-revision-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const initial = await loadWorkspace(root);
  const programEntry = initial.entries.find(({ record }) => record.type === "program");
  const second = { ...structuredClone(programEntry.record), id: "program-second", title: "Second Program" };
  await writeFile(programEntry.path.replace(/\.json$/, "-second.json"), `${JSON.stringify(second, null, 2)}\n`);
  const before = await loadWorkspace(root);
  const program = before.resources.find(({ id }) => id === programEntry.record.id);
  const oldRevision = collectionRevision(before, "control", { program, historicalReviewMetadata: true });
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: root });
  execFileSync("git", ["config", "user.name", "FileGRC Test"], { cwd: root });
  execFileSync("git", ["config", "user.email", "filegrc@example.test"], { cwd: root });
  execFileSync("git", ["add", "data"], { cwd: root });
  execFileSync("git", ["commit", "-m", "Record two Program reviews"], { cwd: root });
  programEntry.record.requirementApplicability[0].reviewedOn = "2026-09-29";
  await writeFile(programEntry.path, `${JSON.stringify(programEntry.record, null, 2)}\n`);
  const current = await loadWorkspace(root);
  const selected = current.resources.find(({ id }) => id === program.id);
  assert.equal(collectionRevisionMatches(current, "control", oldRevision, { program: selected }), true);
});

test("a commitment applicability review follows its own scope", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-commitment-scope-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const commitment = loaded.resources.find(({ type }) => type === "commitment");
  const program = loaded.resources.find(({ type }) => type === "program");
  const original = applicabilityScopeRevision(commitment, program, loaded.resources, loaded.model);
  const review = { decision: "applicable", scopeRevision: original };
  program.systemIds.push("system-unrelated");
  program.controlIds.push("control-unrelated");
  assert.equal(applicabilityReviewIsCurrent(review, commitment, program, loaded.resources, loaded.model), true);
  commitment.statement = `${commitment.statement} Changed.`;
  assert.equal(applicabilityReviewIsCurrent(review, commitment, program, loaded.resources, loaded.model), false);
});

test("a Complementary Control applicability review follows its responsible provider", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-provider-scope-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const responsibility = loaded.resources.find(({ type }) => type === "complementary-control");
  const program = loaded.resources.find(({ type }) => type === "program");
  const review = { decision: "applicable", scopeRevision: applicabilityScopeRevision(
    responsibility, program, loaded.resources, loaded.model
  ) };
  responsibility.vendorId = "vendor-new-provider";
  assert.equal(applicabilityReviewIsCurrent(review, responsibility, program, loaded.resources, loaded.model), false);
});

test("Control applicability ignores other selected Controls but tracks its own facts", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-control-scope-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const control = loaded.resources.find(({ type }) => type === "control");
  const program = loaded.resources.find(({ type }) => type === "program");
  const review = {
    decision: "applicable",
    scopeRevision: applicabilityScopeRevision(control, program, loaded.resources, loaded.model)
  };
  program.controlIds.push("control-unrelated");
  assert.equal(applicabilityReviewIsCurrent(review, control, program, loaded.resources, loaded.model), true);
  control.statement = `${control.statement} Changed.`;
  assert.equal(applicabilityReviewIsCurrent(review, control, program, loaded.resources, loaded.model), false);
});

test("Git proves an older broad commitment review survives unrelated scope additions", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-legacy-commitment-scope-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const before = await loadWorkspace(root);
  const commitmentEntry = before.entries.find(({ record }) => record.type === "commitment");
  const programEntry = before.entries.find(({ record }) => record.type === "program");
  const review = {
    decision: "applicable",
    scopeRevision: applicabilityScopeRevision(
      commitmentEntry.record, programEntry.record, before.resources, before.model,
      { legacyBroadCommitment: true }
    )
  };
  commitmentEntry.record.applicabilityReview = review;
  await writeFile(commitmentEntry.path, `${JSON.stringify(commitmentEntry.record, null, 2)}\n`);
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: root });
  execFileSync("git", ["config", "user.name", "FileGRC Test"], { cwd: root });
  execFileSync("git", ["config", "user.email", "filegrc@example.test"], { cwd: root });
  execFileSync("git", ["add", "data"], { cwd: root });
  execFileSync("git", ["commit", "-m", "Record commitment review"], { cwd: root });
  programEntry.record.systemIds.push("system-unrelated");
  await writeFile(programEntry.path, `${JSON.stringify(programEntry.record, null, 2)}\n`);
  const current = await loadWorkspace(root);
  const commitment = current.resources.find(({ type }) => type === "commitment");
  const program = current.resources.find(({ type }) => type === "program");
  assert.equal(applicabilityReviewIsCurrent(review, commitment, program, current.resources, current.model, root), true);
  commitment.statement = `${commitment.statement} Changed.`;
  assert.equal(applicabilityReviewIsCurrent(review, commitment, program, current.resources, current.model, root), false);
});

test("a source rebind alone does not require another whole-schedule approval", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-schedule-rebind-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const before = await loadWorkspace(root);
  const rowEntry = before.entries.find(({ record }) => record.type === "retention-schedule-item");
  const commitment = before.resources.find(({ type }) => type === "commitment");
  rowEntry.record.sourceResourceIds = [commitment.id];
  rowEntry.record.reviewedSourceRevisions = {
    [commitment.id]: resourceReviewRevisionsSync(before, [commitment.id], "legacy", true).get(commitment.id)
  };
  await writeFile(rowEntry.path, `${JSON.stringify(rowEntry.record, null, 2)}\n`);
  const old = await loadWorkspace(root);
  const oldRevision = collectionRevision(old, "retention-schedule-item", { historicalReviewMetadata: true });
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: root });
  execFileSync("git", ["config", "user.name", "FileGRC Test"], { cwd: root });
  execFileSync("git", ["config", "user.email", "filegrc@example.test"], { cwd: root });
  execFileSync("git", ["add", "data"], { cwd: root });
  execFileSync("git", ["commit", "-m", "Approve schedule row"], { cwd: root });
  rowEntry.record.reviewedSourceRevisions[commitment.id] = resourceReviewRevisionsSync(old, [commitment.id]).get(commitment.id);
  const programEntry = before.entries.find(({ record }) => record.type === "program");
  programEntry.record.controlIds.push("control-unrelated");
  await writeFile(programEntry.path, `${JSON.stringify(programEntry.record, null, 2)}\n`);
  await writeFile(rowEntry.path, `${JSON.stringify(rowEntry.record, null, 2)}\n`);
  const rebound = await loadWorkspace(root);
  assert.equal(collectionRevisionMatches(rebound, "retention-schedule-item", oldRevision), true);
  rowEntry.record.description = `${rowEntry.record.description} Changed.`;
  await writeFile(rowEntry.path, `${JSON.stringify(rowEntry.record, null, 2)}\n`);
  const changed = await loadWorkspace(root);
  assert.equal(collectionRevisionMatches(changed, "retention-schedule-item", oldRevision), false);
  rowEntry.record.description = old.resources.find(({ type }) => type === "retention-schedule-item").description;
  await writeFile(rowEntry.path, `${JSON.stringify(rowEntry.record, null, 2)}\n`);
  const commitmentEntry = before.entries.find(({ record }) => record.id === commitment.id);
  commitmentEntry.record.statement = `${commitmentEntry.record.statement} Changed.`;
  await writeFile(commitmentEntry.path, `${JSON.stringify(commitmentEntry.record, null, 2)}\n`);
  const changedSource = await loadWorkspace(root);
  assert.equal(collectionRevisionMatches(changedSource, "retention-schedule-item", oldRevision), false);
});

test("Program applicability labels preserve Control collection scope hashes", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-program-applicability-revision-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const program = loaded.resources.find(({ type }) => type === "program");
  const review = program.requirementApplicability[0];
  const requirement = loaded.resources.find(({ id }) => id === review.requirementId);
  const scopeDigest = digest(applicabilityScopeRevision(requirement, program, loaded.resources, loaded.model));
  review.scopeRevision = `scope:${scopeDigest}`;
  const legacyCollection = collectionRevision(loaded, "control", { program });
  assert.equal(applicabilityReviewIsCurrent(review, requirement, program, loaded.resources, loaded.model), true);

  review.scopeRevision = `filegrc:applicability-scope:v1:sha256:${scopeDigest}`;
  assert.equal(collectionRevision(loaded, "control", { program }), legacyCollection);
  assert.equal(collectionRevisionMatches(loaded, "control", legacyCollection, { program }), true);
  const version016Collection = collectionRevision(loaded, "control", { program, scopeHashInput: "digest", scopeFactsInput: "source" });
  assert.equal(version016Collection, legacyCollection);
  assert.equal(collectionRevisionMatches(loaded, "control", version016Collection, { program }), true);

  review.scopeRevision = `filegrc:applicability-scope:v1:sha256:${"b".repeat(64)}`;
  assert.equal(collectionRevisionMatches(loaded, "control", legacyCollection, { program }), true);
  assert.equal(collectionRevisionMatches(loaded, "control", version016Collection, { program }), true);
  review.decision = review.decision === "applicable" ? "not-applicable" : "applicable";
  assert.equal(collectionRevisionMatches(loaded, "control", legacyCollection, { program }), false);
});

test("committed legacy collection, occurrence, and retention bindings stay readable without another review", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-committed-legacy-revisions-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  let loaded = await loadWorkspace(root);
  const rowEntry = loaded.entries.find(({ record }) => record.type === "retention-schedule-item");
  const sources = retentionReviewResourceIds(rowEntry.record, loaded);
  rowEntry.record.reviewedSourceRevisions = Object.fromEntries(
    [...await resourceReviewRevisions(loaded, sources)].map(([id, revision]) => [id, digest(revision)])
  );
  await writeFile(rowEntry.path, `${JSON.stringify(rowEntry.record, null, 2)}\n`);
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "--initial-branch=main");
  git("config", "user.name", "FileGRC Test");
  git("config", "user.email", "filegrc@example.test");
  git("add", "data");
  git("commit", "-m", "Record legacy source bindings");
  const scopeCommit = git("rev-parse", "HEAD");

  loaded = await loadWorkspace(root);
  const program = loaded.resources.find(({ type }) => type === "program");
  const date = currentCalendarDate(loaded.workspace.timezone);
  const reviewEntry = loaded.entries.find(({ record }) => record.type === "collection-review");
  const review = {
    ...reviewEntry.record,
    status: "active",
    decision: "complete",
    rationale: "Reviewed the scoped people.",
    reviewedByIds: ["person-independent-approver-example"],
    reviewedOn: date,
    coverage: { kind: "as-of", on: date },
    knowledgeCutoffAt: new Date().toISOString(),
    populationResourceIds: scopedCollectionRecords(loaded, "person", program).map(({ id }) => id),
    collectionRevision: digest(collectionRevision(loaded, "person", { program })),
    scopeRevision: scopeCommit
  };
  await writeFile(reviewEntry.path, `${JSON.stringify(review, null, 2)}\n`);
  git("add", "data");
  git("commit", "-m", "Record legacy collection review");
  const reviewCommit = git("rev-parse", "HEAD");

  loaded = await loadWorkspace(root);
  const committedReview = loaded.resources.find(({ id }) => id === review.id);
  const snapshot = historicalCollectionReviewSnapshot(
    root,
    committedReview,
    loaded.model,
    loaded.workspace.timezone,
    "person",
    date,
    null,
    reviewEntry.relativePath,
    reviewCommit
  );
  assert.equal(snapshot?.reviewCommit, reviewCommit);
  const occurrenceBinding = {
    collectionReviewCommit: reviewCommit,
    collectionReviewRevision: digest(collectionReviewRevision(committedReview)),
    collectionRevision: committedReview.collectionRevision,
    scopeRevision: scopeCommit
  };
  assert.equal(revisionsMatch("collection-review", occurrenceBinding.collectionReviewRevision, collectionReviewRevision(committedReview)), true);
  assert.equal(revisionsMatch("collection", occurrenceBinding.collectionRevision, collectionRevision(loaded, "person", { program })), true);

  const row = loaded.resources.find(({ id }) => id === rowEntry.record.id);
  const currentSources = await resourceReviewRevisions(loaded, retentionReviewResourceIds(row, loaded));
  assert.ok(Object.entries(row.reviewedSourceRevisions).every(([id, revision]) => (
    revisionsMatch("content", revision, currentSources.get(id))
  )));
  const validation = await validateWorkspace(root);
  assert.equal(validation.ok, true, validation.diagnostics.map(({ message }) => message).join("\n"));
  assert.equal(git("status", "--porcelain"), "");
});

function digest(value) {
  return String(value).slice(-64);
}
