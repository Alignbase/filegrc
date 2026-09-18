import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { loadModel } from "../model/index.js";
import { applicabilityScopeRevision } from "../src/applicability-scope.js";
import { scopedCollectionRecords } from "../src/collection-scope.js";
import { resourceProgramContext } from "../src/program-path.js";
import {
  collectionRevisionMatches,
  legacyCollectionRevision
} from "../src/collection-revision.js";
import {
  applyCollectionReview,
  activateGovernedContent,
  assessCollectionReview,
  assessProgramReadiness,
  buildAgentProgramPath,
  buildAgentGuide,
  collectionRevision,
  loadWorkspace,
  planCollectionReview,
  scaffoldCollectionReview,
  scaffoldDocumentActivation,
  scaffoldPolicyActivation,
  serveWorkspace,
  updateResource,
  validateWorkspace
} from "../src/index.js";
import { createAppState, createAppStateSection } from "../src/state.js";
import { sourceCoverageComplete } from "../src/source-coverage.js";
import { resourceReviewRevisions, retentionReviewResourceIds, retentionRuleIsCurrent } from "../src/retention.js";
import { makeComprehensiveWorkspace } from "./fixtures.js";
import { makeWorkspace } from "./helpers.js";
import { currentCalendarDate } from "../src/time.js";

const execute = promisify(execFile);
const cli = fileURLToPath(new URL("../bin/filegrc.js", import.meta.url));

test("blocks Control collection oversight before the rest of Step 3 is complete", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-control-review-gate-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  await assert.rejects(
    planCollectionReview(root, {
      resourceType: "control",
      decision: "complete",
      rationale: "Reviewed implemented Controls.",
      reviewedByIds: ["person-independent-approver-example"],
      reviewedOn: "2026-09-12"
    }),
    /before recording the Control collection review/
  );
  await assert.rejects(
    scaffoldCollectionReview(root, { resourceType: "control" }),
    /before recording the Control collection review/
  );
  const documentScaffold = await scaffoldDocumentActivation(root);
  assert.equal(documentScaffold.available, false);
  assert.match(documentScaffold.message, /Control collection review/);
  const policyScaffold = await scaffoldPolicyActivation(root);
  assert.equal(policyScaffold.available, false);
  assert.match(policyScaffold.message, /Control collection review/);
  await assert.rejects(
    execute(process.execPath, [cli, "review-collection", "control", "--scaffold", "--root", root]),
    /before recording the Control collection review/
  );
  for (const command of ["activate-content", "activate-policies"]) {
    const cliScaffold = JSON.parse((await execute(process.execPath, [cli, command, "--scaffold", "--root", root])).stdout);
    assert.equal(cliScaffold.available, false, command);
    assert.match(cliScaffold.message, /Control collection review/, command);
  }
});

test("models v8 through v10 keep the prior Retention Schedule review contract", async (context) => {
  for (const version of ["8", "9", "10"]) {
    const root = await mkdtemp(join(tmpdir(), `filegrc-retention-review-v${version}-`));
    context.after(() => rm(root, { recursive: true, force: true }));
    await makeComprehensiveWorkspace(root, version);
    await execute("git", ["init", "--initial-branch=main"], { cwd: root });
    await execute("git", ["config", "user.name", "FileGRC Test"], { cwd: root });
    await execute("git", ["config", "user.email", "filegrc@example.test"], { cwd: root });
    await execute("git", ["add", "."], { cwd: root });
    await execute("git", ["commit", "-m", "Initial workspace"], { cwd: root });
    const loaded = await loadWorkspace(root);
    const scaffold = await scaffoldCollectionReview(root, {
      resourceType: "retention-schedule-item",
      programId: "program-example"
    });
    assert.equal(Object.hasOwn(scaffold, "expectedCollectionRevision"), false, version);
    const readiness = await assessProgramReadiness(loaded, { programId: "program-example" });
    const isRetentionItem = ({ id }) => id.startsWith("retention-") || id === "collection-review-retention-schedule-item";
    assert.equal(readiness.stages.find(({ id }) => id === "policies").items.some(isRetentionItem), false, version);
    assert.equal(readiness.stages.find(({ id }) => id === "controls").items.some(isRetentionItem), true, version);
    const path = buildAgentProgramPath(loaded.model);
    assert.equal(path.find(({ id }) => id === "policies").sections.some(({ id }) => id === "retention"), false, version);
    assert.equal(path.find(({ id }) => id === "controls").sections.some(({ id }) => id === "retention"), true, version);
    assert.equal(buildAgentGuide(loaded, "retention-schedule-item").programStep.id, "controls", version);
    assert.equal(resourceProgramContext("retention-schedule-item").id, "policies", version);
    const options = {
      resourceType: "retention-schedule-item",
      programId: "program-example",
      decision: "complete",
      rationale: "Reviewed the schedule under the prior model contract.",
      reviewedByIds: ["person-independent-approver-example"],
      reviewedOn: currentCalendarDate(loaded.workspace.timezone),
      confirmed: true
    };
    await planCollectionReview(root, options);
    await applyCollectionReview(root, options);
  }
});

test("offers Control collection oversight only to people outside Control and Obligation ownership", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-control-reviewer-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const assessment = assessCollectionReview(loaded, "control", { programId: "program-example" });
  assert.deepEqual(assessment.eligibleReviewerIds, ["person-independent-approver-example"]);
  assert.deepEqual(assessment.reviewerConflictIds, ["person-example"]);
});

test("blocks an inventory collection review until every record proposal is complete", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-collection-proposal-gate-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const componentEntry = loaded.entries.find(({ record }) => record.id === "component-example");
  await writeFile(
    componentEntry.path,
    `${JSON.stringify({ ...componentEntry.record, status: "planned" }, null, 2)}\n`,
    "utf8"
  );
  const planned = await loadWorkspace(root);
  const assessment = assessCollectionReview(planned, "component", { programId: "program-example" });
  assert.equal(assessment.recordProposals.length, 1);
  assert.equal(assessment.recordProposals[0].complete, false);
  assert.match(assessment.message, /before the collection review/);
  const state = await createAppStateSection(planned, "program", {
    programId: "program-example",
    programReadiness: { stages: [] }
  });
  assert.deepEqual(state.collectionReviews.component.recordProposals, assessment.recordProposals);
  assert.deepEqual(state.collectionReviews.component.incompleteRecordProposals, assessment.incompleteRecordProposals);
  await assert.rejects(
    planCollectionReview(root, {
      resourceType: "component",
      programId: "program-example",
      decision: "complete",
      rationale: "Reviewed the Component inventory.",
      reviewedByIds: ["person-independent-approver-example"],
      reviewedOn: currentCalendarDate(planned.workspace.timezone)
    }),
    /Complete every scoped components record proposal/
  );

  const unselectedSystem = {
    ...planned.resources.find(({ id }) => id === "system-example"),
    id: "system-unselected",
    title: "Unselected System"
  };
  const unrelatedComponent = {
    ...componentEntry.record,
    id: "component-unrelated-active",
    title: "Unrelated active Component",
    status: "active",
    systemUses: [{
      systemId: unselectedSystem.id,
      roles: ["supporting-operations"],
      rationale: "Supports a System outside this Program."
    }]
  };
  planned.resources.push(unselectedSystem, unrelatedComponent);
  planned.entries.push(
    { record: unselectedSystem, source: JSON.stringify(unselectedSystem) },
    { record: unrelatedComponent, source: JSON.stringify(unrelatedComponent) }
  );
  const singleProgram = assessCollectionReview(planned, "component", { programId: "program-example" });
  assert.equal(singleProgram.recordProposals.some(({ resourceId }) => resourceId === unrelatedComponent.id), false);
});

test("requires an active Classification before an Information Type proposal is complete", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-information-type-classification-gate-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  loaded.resources.find(({ id }) => id === "classification-example").status = "retired";
  const assessment = assessCollectionReview(loaded, "information-type", { programId: "program-example" });
  assert.equal(
    assessment.recordProposals.find(({ resourceId }) => resourceId === "information-type-example")?.complete,
    false
  );
});

test("keeps deprecated Components in the proposal queue", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-deprecated-component-gate-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const component = scopedCollectionRecords(
    loaded,
    "component",
    loaded.resources.find(({ id }) => id === "program-example")
  )[0];
  component.status = "deprecated";
  const assessment = assessCollectionReview(loaded, "component", { programId: "program-example" });
  assert.equal(
    assessment.recordProposals.find(({ resourceId }) => resourceId === component.id)?.complete,
    false
  );
});

test("excludes historical inventory from proposal progress", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-historical-inventory-progress-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  loaded.resources.find(({ id }) => id === "information-type-example").status = "retired";
  loaded.resources.find(({ id }) => id === "vendor-example").status = "terminated";
  assert.equal(
    (assessCollectionReview(loaded, "information-type", { programId: "program-example" }).recordProposals || [])
      .some(({ resourceId }) => resourceId === "information-type-example"),
    false
  );
  assert.equal(
    (assessCollectionReview(loaded, "vendor", { programId: "program-example" }).recordProposals || [])
      .some(({ resourceId }) => resourceId === "vendor-example"),
    false
  );
});

test("direct-file validation rejects incomplete inventory collection proposals", async (context) => {
  for (const [resourceType, makeIncomplete] of [
    ["component", (record) => ({ ...record, status: "planned" })],
    ["vendor", (record) => ({ ...record, status: "evaluating" })],
    ["complementary-control", (record) => ({ ...record, status: "planned" })],
    ["information-type", (record) => ({ ...record, status: "planned" })]
  ]) {
    const root = await mkdtemp(join(tmpdir(), `filegrc-direct-${resourceType}-review-`));
    context.after(() => rm(root, { recursive: true, force: true }));
    await makeComprehensiveWorkspace(root, "11");
    let loaded = await loadWorkspace(root);
    if (resourceType === "vendor") {
      const componentEntry = loaded.entries.find(({ record }) => record.type === "component");
      await writeFile(
        componentEntry.path,
        `${JSON.stringify({ ...componentEntry.record, vendorId: "vendor-example" }, null, 2)}\n`,
        "utf8"
      );
      loaded = await loadWorkspace(root);
    }
    const program = loaded.resources.find(({ id }) => id === "program-example");
    const scopedId = scopedCollectionRecords(loaded, resourceType, program)[0]?.id;
    const entry = loaded.entries.find(({ record }) => record.id === scopedId);
    assert.ok(entry, `scoped ${resourceType} fixture`);
    await writeFile(entry.path, `${JSON.stringify(makeIncomplete(entry.record), null, 2)}\n`, "utf8");
    loaded = await loadWorkspace(root);
    const population = scopedCollectionRecords(loaded, resourceType, program);
    const reviewedOn = currentCalendarDate(loaded.workspace.timezone);
    const review = {
      id: `collection-review-direct-${resourceType}`,
      type: "collection-review",
      title: `Direct ${resourceType} review`,
      status: "active",
      resourceType,
      scopeResourceIds: [program.id],
      decision: "complete",
      rationale: "Direct-file review fixture.",
      reviewedByIds: ["person-independent-approver-example"],
      reviewedOn,
      coverage: { kind: "as-of", on: reviewedOn },
      knowledgeCutoffAt: `${reviewedOn}T12:00:00.000Z`,
      populationResourceIds: population.map(({ id }) => id),
      collectionRevision: collectionRevision(loaded, resourceType, { programId: program.id }),
      scopeRevision: "uncommitted"
    };
    await mkdir(join(root, "data", "collection-reviews"), { recursive: true });
    await writeFile(
      join(root, "data", "collection-reviews", `${review.id}.json`),
      `${JSON.stringify(review, null, 2)}\n`,
      "utf8"
    );
    const validation = await validateWorkspace(root);
    assert.equal(
      validation.diagnostics.some(({ code }) => code === "incomplete-collection-review-proposals"),
      true,
      resourceType
    );
    const staleRecord = { ...makeIncomplete(entry.record), title: `${entry.record.title} changed after review` };
    await writeFile(entry.path, `${JSON.stringify(staleRecord, null, 2)}\n`, "utf8");
    const staleValidation = await validateWorkspace(root);
    assert.equal(
      staleValidation.diagnostics.some(({ code }) => code === "incomplete-collection-review-proposals"),
      false,
      `${resourceType} stale review`
    );
  }
});

test("binds a Retention Schedule review to the governed document and row collection", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-retention-review-binding-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const initialRevision = collectionRevision(loaded, "retention-schedule-item", { programId: "program-example" });

  await writeFile(
    join(root, "data", "documents", "document-example.md"),
    "# Data Retention Schedule\n\nUpdated governed schedule policy.\n",
    "utf8"
  );

  assert.notEqual(
    collectionRevision(loaded, "retention-schedule-item", { programId: "program-example" }),
    initialRevision
  );
});

test("keeps an approved Retention Schedule current through Step 3 activation", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-retention-review-activation-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  await execute("git", ["init", "--initial-branch=main"], { cwd: root });

  let loaded = await loadWorkspace(root);
  const documentEntry = loaded.entries.find(({ record }) => record.id === "document-example");
  const schedule = {
    ...documentEntry.record,
    status: "approved",
    documentKind: "schedule",
    programRole: "required",
    proposedEffectiveOn: currentCalendarDate(loaded.workspace.timezone)
  };
  for (const field of [
    "activationBasis",
    "activatedByIds",
    "activatedOn",
    "activatedContentRevisions",
    "effectiveOn",
    "reportingRouteRequirements"
  ]) delete schedule[field];
  await writeFile(documentEntry.path, `${JSON.stringify(schedule, null, 2)}\n`, "utf8");

  loaded = await loadWorkspace(root);
  const rowEntry = loaded.entries.find(({ record }) => record.id === "retention-schedule-item-example");
  const row = {
    ...rowEntry.record,
    status: "active",
    scheduleDocumentId: schedule.id,
    informationTypeIds: ["information-type-example"],
    scopeResourceIds: ["program-example"],
    cutoff: { basis: "creation" },
    retentionPeriod: { basis: "fixed", amount: 7, unit: "year" },
    dispositionAction: "delete",
    dispositionInstructions: "Delete the covered records after the approved period unless a legal hold applies.",
    approvedByIds: ["person-independent-approver-example"],
    approvedOn: currentCalendarDate(loaded.workspace.timezone)
  };
  const controlEntry = loaded.entries.find(({ record }) => record.id === "control-example");
  const control = {
    ...controlEntry.record,
    code: "CHG-01",
    evidenceSourceComponentIds: ["component-example"],
    procedureRevision: "reviewed-procedure-revision",
    procedureEffectiveOn: currentCalendarDate(loaded.workspace.timezone)
  };
  control.applicabilityReview = {
    decision: "applicable",
    rationale: "This Control implements requirements selected for the Program.",
    reviewedByIds: ["person-independent-approver-example"],
    reviewedOn: currentCalendarDate(loaded.workspace.timezone),
    scopeRevision: applicabilityScopeRevision(
      control,
      loaded.resources.find(({ id }) => id === "program-example"),
      loaded.resources.map((record) => record.id === control.id ? control : record),
      loaded.model
    )
  };
  await writeFile(controlEntry.path, `${JSON.stringify(control, null, 2)}\n`, "utf8");
  const componentEntry = loaded.entries.find(({ record }) => record.id === "component-example");
  await writeFile(
    componentEntry.path,
    `${JSON.stringify({ ...componentEntry.record, evidenceSourceKinds: ["production-change"] }, null, 2)}\n`,
    "utf8"
  );
  loaded = await loadWorkspace(root);
  const dependencyIds = retentionReviewResourceIds(row, loaded);
  row.reviewedSourceRevisions = Object.fromEntries(await resourceReviewRevisions(loaded, dependencyIds));
  await writeFile(rowEntry.path, `${JSON.stringify(row, null, 2)}\n`, "utf8");

  loaded = await loadWorkspace(root);
  const reviewDate = currentCalendarDate(loaded.workspace.timezone);
  assert.deepEqual(
    row.reviewedSourceRevisions,
    Object.fromEntries(await resourceReviewRevisions(loaded, retentionReviewResourceIds(row, loaded)))
  );
  await execute("git", ["add", "."], { cwd: root });
  await execute("git", [
    "-c", "user.name=FileGRC Test",
    "-c", "user.email=filegrc@example.test",
    "commit", "-m", "Prepare retention schedule activation fixture"
  ], { cwd: root });
  await applyCollectionReview(root, {
    resourceType: "retention-schedule-item",
    programId: "program-example",
    decision: "complete",
    rationale: "Reviewed the approved schedule document and every active row.",
    reviewedByIds: ["person-independent-approver-example"],
    reviewedOn: reviewDate,
    expectedCollectionRevision: collectionRevision(loaded, "retention-schedule-item", { programId: "program-example" }),
    confirmed: true
  });
  loaded = await loadWorkspace(root);
  const complementaryRecords = scopedCollectionRecords(
    loaded,
    "complementary-control",
    loaded.resources.find(({ id }) => id === "program-example")
  );
  const complementaryReview = {
    id: "collection-review-complementary-controls-for-activation",
    type: "collection-review",
    title: "Customer and provider responsibilities review",
    status: "active",
    resourceType: "complementary-control",
    scopeResourceIds: ["program-example"],
    decision: "complete",
    rationale: "Reviewed the customer and provider responsibilities used by the selected Controls.",
    reviewedByIds: ["person-independent-approver-example"],
    reviewedOn: reviewDate,
    coverage: { kind: "as-of", on: reviewDate },
    knowledgeCutoffAt: `${reviewDate}T12:00:00.000Z`,
    populationResourceIds: complementaryRecords.map(({ id }) => id),
    collectionRevision: collectionRevision(loaded, "complementary-control", { programId: "program-example" }),
    scopeRevision: (await execute("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim()
  };
  await writeFile(
    join(root, "data", "collection-reviews", `${complementaryReview.id}.json`),
    `${JSON.stringify(complementaryReview, null, 2)}\n`,
    "utf8"
  );
  loaded = await loadWorkspace(root);
  const controlReview = {
    id: "collection-review-controls-for-activation",
    type: "collection-review",
    title: "Controls review for activation",
    status: "active",
    resourceType: "control",
    scopeResourceIds: ["program-example"],
    decision: "complete",
    rationale: "Reviewed the implemented Controls and their operating dependencies.",
    reviewedByIds: ["person-independent-approver-example"],
    reviewedOn: reviewDate,
    coverage: { kind: "as-of", on: reviewDate },
    knowledgeCutoffAt: `${reviewDate}T12:00:00.000Z`,
    populationResourceIds: ["control-example"],
    collectionRevision: collectionRevision(loaded, "control", { programId: "program-example" }),
    scopeRevision: (await execute("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim()
  };
  await writeFile(
    join(root, "data", "collection-reviews", `${controlReview.id}.json`),
    `${JSON.stringify(controlReview, null, 2)}\n`,
    "utf8"
  );

  loaded = await loadWorkspace(root);
  assert.deepEqual(
    loaded.resources.find(({ id }) => id === "control-example").evidenceSourceComponentIds,
    ["component-example"]
  );
  const controlAssessment = assessCollectionReview(loaded, "control", { programId: "program-example" });
  assert.equal(controlAssessment.complete, true, JSON.stringify(controlAssessment));
  const readinessBeforeActivation = await assessProgramReadiness(loaded, { programId: "program-example" });
  const implementationItems = readinessBeforeActivation.stages.find(({ id }) => id === "controls").items;
  assert.deepEqual(
    implementationItems
      .filter(({ status, id }) => status !== "complete" && !id.startsWith("training-") && !id.startsWith("document-") && !id.startsWith("policy-")),
    []
  );
  assert.equal(
    readinessBeforeActivation.documentActivations.some(({ documentId, state }) => (
      documentId === schedule.id && state === "ready-to-activate"
    )),
    true,
    JSON.stringify(readinessBeforeActivation.documentActivations)
  );
  const activation = await scaffoldDocumentActivation(root, { programId: "program-example" });
  assert.equal(activation.documentIds.includes(schedule.id), true, JSON.stringify(activation));
  await activateGovernedContent(root, {
    resourceIds: [schedule.id],
    programId: "program-example",
    activatedByIds: ["person-example"],
    activatedOn: activation.activatedOn,
    effectiveOn: activation.effectiveOn,
    expectedRevisions: { [schedule.id]: activation.expectedRevisions[schedule.id] },
    confirmed: true
  });

  loaded = await loadWorkspace(root);
  assert.equal(loaded.resources.find(({ id }) => id === schedule.id).status, "active");
  assert.equal(
    assessCollectionReview(loaded, "retention-schedule-item", { programId: "program-example" }).complete,
    true
  );
  await execute("git", ["add", "."], { cwd: root });
  await execute("git", [
    "-c", "user.name=FileGRC Test",
    "-c", "user.email=filegrc@example.test",
    "commit", "-m", "Activate retention schedule"
  ], { cwd: root });
  loaded = await loadWorkspace(root);
  await applyCollectionReview(root, {
    resourceType: "retention-schedule-item",
    programId: "program-example",
    decision: "complete",
    rationale: "Reapproved the complete active schedule.",
    reviewedByIds: ["person-independent-approver-example"],
    reviewedOn: reviewDate,
    expectedCollectionRevision: collectionRevision(loaded, "retention-schedule-item", { programId: "program-example" }),
    confirmed: true
  });
  loaded = await loadWorkspace(root);
  const reapprovedSchedule = loaded.resources.find(({ id }) => id === schedule.id);
  assert.equal(reapprovedSchedule.status, "approved");
  assert.equal(reapprovedSchedule.activatedOn, undefined);
  assert.equal(reapprovedSchedule.effectiveOn, undefined);
});

test("binds a Retention Schedule review to governing-document party membership", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-retention-review-parties-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const schedule = loaded.resources.find(({ id }) => id === "document-example");
  schedule.documentKind = "schedule";
  schedule.ownerIds = ["team-example"];
  const initialRevision = collectionRevision(loaded, "retention-schedule-item", { programId: "program-example" });
  const changed = structuredClone(loaded);
  changed.resources.find(({ id }) => id === "team-example").memberIds = [
    "person-example",
    "person-independent-approver-example"
  ];

  assert.notEqual(
    collectionRevision(changed, "retention-schedule-item", { programId: "program-example" }),
    initialRevision
  );
});

test("does not accept a legacy Retention Schedule collection revision", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-retention-review-legacy-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const options = { programId: "program-example" };
  const legacyRevision = legacyCollectionRevision(loaded, "retention-schedule-item", options);

  assert.equal(
    collectionRevisionMatches(loaded, "retention-schedule-item", legacyRevision, options),
    false
  );
});

test("binds a Retention Schedule review to uncovered in-scope information uses", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-retention-review-use-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const initialRevision = collectionRevision(loaded, "retention-schedule-item", { programId: "program-example" });
  const systemEntry = loaded.entries.find(({ record }) => record.id === "system-example");
  await writeFile(
    systemEntry.path,
    `${JSON.stringify({ ...systemEntry.record, informationTypeIds: ["information-type-example"] }, null, 2)}\n`,
    "utf8"
  );
  const changed = await loadWorkspace(root);

  assert.notEqual(
    collectionRevision(changed, "retention-schedule-item", { programId: "program-example" }),
    initialRevision
  );
});

test("binds a Retention Schedule review to each resource-to-information-type use", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-retention-review-use-mapping-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  loaded.resources.push({
    id: "information-type-operations",
    type: "information-type",
    title: "Operations records",
    status: "active",
    description: "Operational service records.",
    classificationId: "classification-example"
  });
  const row = loaded.resources.find(({ id }) => id === "retention-schedule-item-example");
  row.informationTypeIds = ["information-type-example", "information-type-operations"];
  loaded.resources.find(({ id }) => id === "system-example").informationTypeIds = ["information-type-example"];
  loaded.resources.find(({ id }) => id === "vendor-example").informationTypeIds = ["information-type-operations"];
  const initialRevision = collectionRevision(loaded, "retention-schedule-item", { programId: "program-example" });
  const changed = structuredClone(loaded);
  changed.resources.find(({ id }) => id === "system-example").informationTypeIds = ["information-type-operations"];
  changed.resources.find(({ id }) => id === "vendor-example").informationTypeIds = ["information-type-example"];

  assert.notEqual(
    collectionRevision(changed, "retention-schedule-item", { programId: "program-example" }),
    initialRevision
  );
});

test("accepts program-wide retention rows in one workspace-wide schedule", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-retention-workspace-coverage-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const firstProgram = loaded.resources.find(({ id }) => id === "program-example");
  const firstRow = loaded.resources.find(({ type }) => type === "retention-schedule-item");
  const sharedSystem = loaded.resources.find(({ type }) => type === "system");
  const informationType = loaded.resources.find(({ type }) => type === "information-type");
  firstProgram.systemIds = [sharedSystem.id];
  firstRow.informationTypeIds = [informationType.id];
  sharedSystem.informationTypeIds = [informationType.id];
  firstRow.scopeResourceIds = [firstProgram.id];
  const secondProgram = {
    ...structuredClone(firstProgram),
    id: "program-second",
    title: "Second SOC 2 Program"
  };
  const secondRow = {
    ...structuredClone(firstRow),
    id: "retention-schedule-item-second-program",
    title: "Second program retention rule",
    scopeResourceIds: [secondProgram.id]
  };
  loaded.resources.push(secondProgram, secondRow);
  const covered = assessCollectionReview(loaded, "retention-schedule-item", { programId: firstProgram.id });
  assert.equal(covered.approvalIssues.some(({ code }) => code === "uncovered-retention-information-use"), false);

  loaded.resources.splice(loaded.resources.indexOf(secondRow), 1);
  const uncovered = assessCollectionReview(loaded, "retention-schedule-item", { programId: firstProgram.id });
  assert.equal(uncovered.approvalIssues.some(({ code }) => code === "uncovered-retention-information-use"), true);
});

test("a current Information Type review resolves the similar-type schedule blocker", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-retention-review-similar-types-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  loaded.resources.push({
    id: "information-type-customer-record",
    type: "information-type",
    title: "Customer record",
    status: "active",
    description: "A reviewed distinct Information Type.",
    classificationId: "classification-example"
  });
  const before = assessCollectionReview(loaded, "retention-schedule-item", { programId: "program-example" });
  assert.equal(before.approvalIssues.some(({ code }) => code === "unreviewed-similar-information-types"), true);

  const informationTypes = scopedCollectionRecords(loaded, "information-type", loaded.resources.find(({ id }) => id === "program-example"));
  const review = {
    id: "collection-review-information-types",
    type: "collection-review",
    title: "Information Types review",
    status: "active",
    resourceType: "information-type",
    scopeResourceIds: ["program-example"],
    decision: "complete",
    rationale: "Confirmed the similar names describe distinct records.",
    reviewedByIds: ["person-independent-approver-example"],
    reviewedOn: "2026-09-12",
    coverage: { kind: "as-of", on: "2026-09-12" },
    knowledgeCutoffAt: "2026-09-12T12:00:00.000Z",
    populationResourceIds: informationTypes.map(({ id }) => id),
    collectionRevision: collectionRevision(loaded, "information-type", { programId: "program-example" }),
    scopeRevision: "scope-example"
  };
  loaded.resources.push(review);
  loaded.entries.push({ record: review, source: JSON.stringify(review) });
  const after = assessCollectionReview(loaded, "retention-schedule-item", { programId: "program-example" });
  assert.equal(after.approvalIssues.some(({ code }) => code === "unreviewed-similar-information-types"), false);
});

test("rejects Retention Schedule approval when the displayed revision is stale", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-retention-review-stale-display-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");

  await assert.rejects(
    planCollectionReview(root, {
      resourceType: "retention-schedule-item",
      programId: "program-example",
      expectedCollectionRevision: "stale-displayed-revision"
    }),
    /changed after it was displayed/
  );
});

test("limits Retention Schedule approval to reviewers independent of schedule owners", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-retention-reviewer-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const schedule = loaded.resources.find(({ id }) => id === "document-example");
  schedule.documentKind = "schedule";
  const assessment = assessCollectionReview(loaded, "retention-schedule-item", { programId: "program-example" });

  assert.deepEqual(assessment.eligibleReviewerIds, ["person-independent-approver-example"]);
  assert.deepEqual(assessment.reviewerConflictIds, ["person-example"]);
  const programState = await createAppStateSection(loaded, "program", {
    programId: "program-example",
    programReadiness: { stages: [] }
  });
  assert.deepEqual(
    programState.collectionReviews["retention-schedule-item"].eligibleReviewerIds,
    ["person-independent-approver-example"]
  );
  const fullState = await createAppState(root, { programId: "program-example" });
  assert.deepEqual(
    fullState.collectionReviews["retention-schedule-item"].eligibleReviewerIds,
    ["person-independent-approver-example"]
  );
  assert.deepEqual(
    fullState.collectionReviews["retention-schedule-item"].reviewerConflictIds,
    ["person-example"]
  );
  assert.ok(fullState.collectionReviews["retention-schedule-item"].approvalIssues.length > 0);
});

test("rejects multiple current Data Retention Schedule documents", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-retention-review-duplicate-document-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const rowEntry = loaded.entries.find(({ record }) => record.type === "retention-schedule-item");
  const documentEntry = loaded.entries.find(({ record }) => record.id === "document-example");
  await writeFile(rowEntry.path, `${JSON.stringify({
    ...rowEntry.record,
    status: "retired",
    statusTransition: {
      changedByIds: ["person-example"],
      changedOn: currentCalendarDate(loaded.workspace.timezone),
      reason: "No schedule row is required for this zero-population approval test."
    }
  }, null, 2)}\n`, "utf8");
  await writeFile(documentEntry.path, `${JSON.stringify({ ...documentEntry.record, documentKind: "schedule" }, null, 2)}\n`, "utf8");
  await writeFile(
    join(documentEntry.path, "..", "document-retention-schedule-duplicate.json"),
    `${JSON.stringify({ ...documentEntry.record, id: "document-retention-schedule-duplicate", title: "Duplicate schedule", documentKind: "schedule" }, null, 2)}\n`,
    "utf8"
  );
  const current = await loadWorkspace(root);

  await assert.rejects(
    planCollectionReview(root, {
      resourceType: "retention-schedule-item",
      programId: "program-example",
      expectedCollectionRevision: collectionRevision(current, "retention-schedule-item", { programId: "program-example" })
    }),
    /exactly one current program Data Retention Schedule document/
  );
});

test("approves the governing document in the single Data Retention Schedule review", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-retention-review-document-approval-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const rowEntry = loaded.entries.find(({ record }) => record.type === "retention-schedule-item");
  const documentEntry = loaded.entries.find(({ record }) => record.id === "document-example");
  const scheduleMarkdown = await readFile(join(root, "data", "documents", "document-example.md"), "utf8");
  await writeFile(rowEntry.path, `${JSON.stringify({
    ...rowEntry.record,
    status: "retired",
    statusTransition: {
      changedByIds: ["person-example"],
      changedOn: currentCalendarDate(loaded.workspace.timezone),
      reason: "No schedule row is required for this zero-population approval test."
    }
  }, null, 2)}\n`, "utf8");
  await writeFile(
    documentEntry.path,
    `${JSON.stringify({
      ...documentEntry.record,
      status: "approved",
      documentKind: "schedule",
      approverIds: ["person-example"],
      approvedOn: "2025-01-01",
      approvedContentRevisions: {
        "documents/document-example.md": createHash("sha256").update(scheduleMarkdown).digest("hex")
      },
      activationBasis: undefined,
      activatedByIds: undefined,
      activatedOn: undefined,
      activatedContentRevisions: undefined,
      effectiveOn: undefined
    }, null, 2)}\n`,
    "utf8"
  );
  await execute("git", ["init", "--initial-branch=main"], { cwd: root });
  await execute("git", ["add", "."], { cwd: root });
  await execute("git", ["-c", "user.name=FileGRC Test", "-c", "user.email=filegrc@example.test", "commit", "-m", "Prepare schedule proposal"], { cwd: root });
  const current = await loadWorkspace(root);
  const reviewedOn = currentCalendarDate(current.workspace.timezone);
  await applyCollectionReview(root, {
    resourceType: "retention-schedule-item",
    programId: "program-example",
    decision: "zero-population",
    rationale: "Reviewed the complete schedule proposal.",
    reviewedByIds: ["person-independent-approver-example"],
    reviewedOn,
    expectedCollectionRevision: collectionRevision(current, "retention-schedule-item", { programId: "program-example" }),
    confirmed: true
  });
  const approved = await loadWorkspace(root);
  const approvedDocument = approved.resources.find(({ id }) => id === documentEntry.record.id);
  assert.equal(approvedDocument.status, "approved");
  assert.deepEqual(approvedDocument.approverIds, ["person-independent-approver-example"]);
  assert.equal(approvedDocument.approvedOn, reviewedOn);
  assert.ok(approvedDocument.approvedContentRevisions["documents/document-example.md"]);
  assert.equal(assessCollectionReview(approved, "retention-schedule-item", { programId: "program-example" }).complete, true);

  const firstProgram = approved.resources.find(({ id }) => id === "program-example");
  const firstReviewer = approved.resources.find(({ id }) => id === "person-independent-approver-example");
  const firstScheduleReview = approved.resources.find((record) => (
    record.type === "collection-review" && record.resourceType === "retention-schedule-item" && record.status === "active"
  ));
  await writeFile(join(root, "data", "programs", "program-second.json"), `${JSON.stringify({
    ...firstProgram,
    id: "program-second",
    title: "Second SOC 2 Program"
  }, null, 2)}\n`, "utf8");
  await writeFile(join(root, "data", "people", "person-second-reviewer.json"), `${JSON.stringify({
    ...firstReviewer,
    id: "person-second-reviewer",
    title: "Second independent reviewer",
    email: "second-reviewer@example.test"
  }, null, 2)}\n`, "utf8");
  await writeFile(join(root, "data", "collection-reviews", "collection-review-second-legacy.json"), `${JSON.stringify({
    ...firstScheduleReview,
    id: "collection-review-second-legacy",
    title: "Legacy second-program retention review",
    scopeResourceIds: ["program-second"]
  }, null, 2)}\n`, "utf8");
  await execute("git", ["add", "."], { cwd: root });
  await execute("git", [
    "-c", "user.name=FileGRC Test",
    "-c", "user.email=filegrc@example.test",
    "commit", "-m", "Add second program"
  ], { cwd: root });
  const twoPrograms = await loadWorkspace(root);
  assert.equal(
    assessCollectionReview(twoPrograms, "retention-schedule-item", { programId: "program-example" }).complete,
    false
  );
  await applyCollectionReview(root, {
    resourceType: "retention-schedule-item",
    programId: "program-second",
    decision: "zero-population",
    rationale: "Reviewed the complete shared schedule for the second program.",
    reviewedByIds: ["person-second-reviewer"],
    reviewedOn,
    expectedCollectionRevision: collectionRevision(twoPrograms, "retention-schedule-item", { programId: "program-second" }),
    confirmed: true
  });
  const twiceApproved = await loadWorkspace(root);
  const sharedDocument = twiceApproved.resources.find(({ id }) => id === documentEntry.record.id);
  assert.deepEqual(sharedDocument.approverIds, ["person-second-reviewer"]);
  assert.equal(assessCollectionReview(twiceApproved, "retention-schedule-item", { programId: "program-example" }).complete, true);
  assert.equal(assessCollectionReview(twiceApproved, "retention-schedule-item", { programId: "program-second" }).complete, true);
  const currentScheduleReviews = twiceApproved.resources.filter((record) => (
    record.type === "collection-review"
    && record.resourceType === "retention-schedule-item"
    && record.status === "active"
  ));
  assert.equal(currentScheduleReviews.length, 1);
  assert.deepEqual(currentScheduleReviews[0].scopeResourceIds.sort(), ["program-example", "program-second"]);
  const retiredScheduleReviews = twiceApproved.resources.filter((record) => (
    record.type === "collection-review"
    && record.resourceType === "retention-schedule-item"
    && record.status === "retired"
  ));
  assert.equal(retiredScheduleReviews.length, 2);
  const retiredLegacyValidation = await validateWorkspace(root);
  assert.equal(
    retiredLegacyValidation.diagnostics.some(({ code }) => code === "invalid-retention-schedule-review-scope"),
    false
  );

  const currentReviewEntry = twiceApproved.entries.find(({ record }) => record.id === currentScheduleReviews[0].id);
  await writeFile(currentReviewEntry.path, `${JSON.stringify({
    ...currentReviewEntry.record,
    scopeResourceIds: ["program-example"]
  }, null, 2)}\n`, "utf8");
  const invalidScope = await validateWorkspace(root);
  assert.equal(invalidScope.diagnostics.some(({ code }) => code === "invalid-retention-schedule-review-scope"), true);
  await writeFile(currentReviewEntry.path, `${JSON.stringify(currentReviewEntry.record, null, 2)}\n`, "utf8");

  sharedDocument.status = "draft";
  delete sharedDocument.approverIds;
  delete sharedDocument.approvedOn;
  delete sharedDocument.approvedContentRevisions;
  const withdrawn = assessCollectionReview(twiceApproved, "retention-schedule-item", { programId: "program-example" });
  assert.equal(withdrawn.complete, false);
  assert.equal(
    withdrawn.approvalIssues.some(({ code }) => code === "invalid-retention-schedule-approval-binding"),
    true
  );
});

test("keeps completed retention rows non-authoritative until whole-schedule approval", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-retention-authority-gate-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  let loaded = await loadWorkspace(root);
  const rowEntry = loaded.entries.find(({ record }) => record.id === "retention-schedule-item-example");
  const coverageEntry = loaded.entries.find(({ record }) => record.id === "source-coverage-example");
  const documentEntry = loaded.entries.find(({ record }) => record.id === "document-example");
  const row = {
    ...rowEntry.record,
    status: "active",
    informationTypeIds: ["information-type-example"],
    scopeResourceIds: [...new Set([
      ...(rowEntry.record.scopeResourceIds || []),
      "program-example",
      coverageEntry.record.id
    ])],
    scheduleDocumentId: documentEntry.record.id,
    cutoff: { basis: "creation" },
    retentionPeriod: { basis: "fixed", amount: 7, unit: "year" },
    dispositionAction: "delete",
    dispositionInstructions: "Delete the covered records after the approved period unless a legal hold applies.",
    approvedByIds: undefined,
    approvedOn: undefined
  };
  await writeFile(coverageEntry.path, `${JSON.stringify({
    ...coverageEntry.record,
    status: "active",
    validFrom: "2026-01-01",
    collectionCadence: "Monthly and after material changes.",
    reconciliationMethod: "Compare the export count and filters with the source.",
    retentionScheduleItemIds: [rowEntry.record.id]
  }, null, 2)}\n`, "utf8");
  await writeFile(documentEntry.path, `${JSON.stringify({
    ...documentEntry.record,
    status: "draft",
    documentKind: "schedule",
    workflowScope: "program",
    approverIds: undefined,
    approvedOn: undefined,
    approvedContentRevisions: undefined,
    activationBasis: undefined,
    activatedByIds: undefined,
    activatedOn: undefined,
    activatedContentRevisions: undefined,
    effectiveOn: undefined
  }, null, 2)}\n`, "utf8");
  loaded = await loadWorkspace(root);
  row.reviewedSourceRevisions = Object.fromEntries(await resourceReviewRevisions(
    loaded,
    retentionReviewResourceIds(row, loaded)
  ));
  await writeFile(rowEntry.path, `${JSON.stringify(row, null, 2)}\n`, "utf8");
  await execute("git", ["init", "--initial-branch=main"], { cwd: root });
  await execute("git", ["add", "."], { cwd: root });
  await execute("git", ["-c", "user.name=FileGRC Test", "-c", "user.email=filegrc@example.test", "commit", "-m", "Prepare schedule proposal"], { cwd: root });
  loaded = await loadWorkspace(root);
  const sourceCoverage = loaded.resources.find(({ id }) => id === coverageEntry.record.id);
  const loadedRow = loaded.resources.find(({ id }) => id === rowEntry.record.id);
  assert.deepEqual(
    loadedRow.reviewedSourceRevisions,
    Object.fromEntries(await resourceReviewRevisions(loaded, retentionReviewResourceIds(loadedRow, loaded)))
  );
  assert.equal(
    retentionRuleIsCurrent(
      loadedRow,
      await resourceReviewRevisions(loaded, retentionReviewResourceIds(loadedRow, loaded)),
      new Map(loaded.resources.map((record) => [record.id, record])),
      loaded
    ),
    true,
    JSON.stringify(loadedRow)
  );
  assert.equal(await sourceCoverageComplete(sourceCoverage, loaded), false);

  const reviewedOn = currentCalendarDate(loaded.workspace.timezone);
  await applyCollectionReview(root, {
    resourceType: "retention-schedule-item",
    programId: "program-example",
    decision: "complete",
    rationale: "Reviewed the complete schedule proposal.",
    reviewedByIds: ["person-independent-approver-example"],
    reviewedOn,
    expectedCollectionRevision: collectionRevision(loaded, "retention-schedule-item", { programId: "program-example" }),
    confirmed: true
  });
  const approved = await loadWorkspace(root);
  assert.equal(
    await sourceCoverageComplete(
      approved.resources.find(({ id }) => id === coverageEntry.record.id),
      approved
    ),
    true,
    JSON.stringify(approved.resources.find(({ id }) => id === coverageEntry.record.id))
  );
});

test("assessment rejects schedule documents with missing Control links or unfinished Markdown", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-retention-review-document-readiness-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const schedule = loaded.resources.find(({ id }) => id === "document-example");
  schedule.documentKind = "schedule";
  schedule.programRole = "supporting";
  const readiness = await assessProgramReadiness(loaded, { programId: "program-example" });
  assert.equal(
    readiness.stages.find(({ id }) => id === "policies").items
      .some(({ id }) => id === `document-approval-${schedule.id}`),
    false
  );
  schedule.controlIds = [];
  let assessment = assessCollectionReview(loaded, "retention-schedule-item", { programId: "program-example" });
  assert.equal(assessment.approvalIssues.some(({ code }) => code === "incomplete-retention-schedule-document"), true);

  const markdownPath = join(root, "data", "documents", "document-example.md");
  const unfinished = "# Data Retention Schedule\n\nTODO: complete the governing retention rules before approval.\n";
  await writeFile(markdownPath, unfinished, "utf8");
  schedule.controlIds = ["control-example"];
  schedule.approvedContentRevisions = {
    "documents/document-example.md": createHash("sha256").update(unfinished).digest("hex")
  };
  assessment = assessCollectionReview(loaded, "retention-schedule-item", { programId: "program-example" });
  assert.equal(assessment.approvalIssues.some(({ code }) => code === "incomplete-retention-schedule-document"), true);
});

test("requires the displayed revision token for Data Retention Schedule approval", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-retention-review-token-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const rowEntry = loaded.entries.find(({ record }) => record.type === "retention-schedule-item");
  const documentEntry = loaded.entries.find(({ record }) => record.id === "document-example");
  await writeFile(rowEntry.path, `${JSON.stringify({ ...rowEntry.record, status: "retired" }, null, 2)}\n`, "utf8");
  await writeFile(documentEntry.path, `${JSON.stringify({ ...documentEntry.record, documentKind: "schedule" }, null, 2)}\n`, "utf8");

  await assert.rejects(
    planCollectionReview(root, {
      resourceType: "retention-schedule-item",
      programId: "program-example"
    }),
    /requires the displayed collection revision/
  );
});

test("directly edited Collection Reviews cannot approve an incomplete Retention Schedule", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-retention-review-direct-edit-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  let loaded = await loadWorkspace(root);
  const systemEntry = loaded.entries.find(({ record }) => record.id === "system-example");
  await writeFile(
    systemEntry.path,
    `${JSON.stringify({ ...systemEntry.record, informationTypeIds: ["information-type-example"] }, null, 2)}\n`,
    "utf8"
  );
  loaded = await loadWorkspace(root);
  const review = {
    id: "collection-review-retention-schedule-example",
    type: "collection-review",
    title: "Data Retention Schedule review",
    status: "active",
    resourceType: "retention-schedule-item",
    scopeResourceIds: ["program-example"],
    decision: "complete",
    rationale: "Reviewed the schedule.",
    reviewedByIds: ["person-independent-approver-example"],
    reviewedOn: "2026-09-12",
    coverage: { kind: "as-of", on: "2026-09-12" },
    knowledgeCutoffAt: "2026-09-12T12:00:00.000Z",
    populationResourceIds: ["retention-schedule-item-example"],
    collectionRevision: collectionRevision(loaded, "retention-schedule-item", { programId: "program-example" }),
    scopeRevision: "scope-example"
  };
  await mkdir(join(root, "data", "collection-reviews"), { recursive: true });
  await writeFile(
    join(root, "data", "collection-reviews", `${review.id}.json`),
    `${JSON.stringify(review, null, 2)}\n`,
    "utf8"
  );
  const changed = await loadWorkspace(root);
  assert.equal(
    assessCollectionReview(changed, "retention-schedule-item", { programId: "program-example" }).complete,
    false
  );
  const validation = await validateWorkspace(root);
  const codes = new Set(validation.diagnostics.map(({ code }) => code));
  assert.equal(codes.has("planned-retention-schedule-row"), true);
  assert.equal(codes.has("missing-retention-schedule-document"), true);
  assert.equal(codes.has("uncovered-retention-information-use"), true);

  await writeFile(
    join(root, "data", "collection-reviews", `${review.id}.json`),
    `${JSON.stringify({ ...review, collectionRevision: "stale-review-revision" }, null, 2)}\n`,
    "utf8"
  );
  const staleValidation = await validateWorkspace(root);
  const staleCodes = new Set(staleValidation.diagnostics.map(({ code }) => code));
  assert.equal(staleCodes.has("planned-retention-schedule-row"), false);
  assert.equal(staleCodes.has("missing-retention-schedule-document"), false);
  assert.equal(staleCodes.has("uncovered-retention-information-use"), false);
});

test("keeps planned retention rows outside an approved schedule revision", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-retention-review-planned-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const entry = loaded.entries.find(({ record }) => record.type === "retention-schedule-item");
  await writeFile(
    entry.path,
    `${JSON.stringify({ ...entry.record, status: "planned" }, null, 2)}\n`,
    "utf8"
  );

  await assert.rejects(
    planCollectionReview(root, {
      resourceType: "retention-schedule-item",
      programId: "program-example",
      decision: "complete",
      rationale: "Reviewed the current schedule document and every effective row.",
      reviewedByIds: ["person-independent-approver-example"],
      reviewedOn: "2026-09-12",
      expectedCollectionRevision: collectionRevision(loaded, "retention-schedule-item", { programId: "program-example" })
    }),
    /Complete or retire every planned retention row/
  );
});

test("keeps historical retention rows outside the current schedule approval population", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-retention-review-history-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const row = loaded.resources.find(({ type }) => type === "retention-schedule-item");
  row.status = "retired";
  row.ownerIds = ["person-independent-approver-example"];
  const assessment = assessCollectionReview(loaded, "retention-schedule-item", { programId: "program-example" });

  assert.equal(assessment.recordCount, 0);
  assert.equal(
    assessment.reviewerConflictIds.includes("person-independent-approver-example"),
    false
  );
});

test("keeps Control oversight bound to independent reviewers and implementation dependencies", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-control-review-binding-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const initialRevision = collectionRevision(loaded, "control", { programId: "program-example" });
  const review = {
    id: "collection-review-control-example",
    type: "collection-review",
    title: "Control oversight review",
    status: "active",
    resourceType: "control",
    scopeResourceIds: ["program-example"],
    decision: "complete",
    rationale: "Reviewed the current implementation collection.",
    reviewedByIds: ["person-example"],
    reviewedOn: "2026-09-12",
    coverage: { kind: "as-of", on: "2026-09-12" },
    knowledgeCutoffAt: "2026-09-12T12:00:00.000Z",
    populationResourceIds: ["control-example"],
    collectionRevision: initialRevision,
    scopeRevision: "scope-example"
  };
  loaded.resources.push(review);
  loaded.entries.push({ record: review, source: JSON.stringify(review) });
  const conflicted = assessCollectionReview(loaded, "control", { programId: "program-example" });
  assert.equal(conflicted.complete, false);
  assert.equal(conflicted.status, "review-required");
  assert.match(conflicted.message, /reviewer who does not own/);
  await mkdir(join(root, "data", "collection-reviews"), { recursive: true });
  await writeFile(
    join(root, "data", "collection-reviews", `${review.id}.json`),
    `${JSON.stringify(review, null, 2)}\n`,
    "utf8"
  );
  const validation = await validateWorkspace(root);
  assert.equal(validation.diagnostics.some(({ code }) => (
    code === "conflicted-control-collection-reviewer"
  )), true, JSON.stringify(validation.diagnostics, null, 2));

  const changedComponent = structuredClone(loaded);
  changedComponent.resources.find(({ id }) => id === "component-example").description = "Changed evidence source";
  assert.notEqual(
    collectionRevision(changedComponent, "control", { programId: "program-example" }),
    initialRevision
  );

  const changedPolicyApproval = structuredClone(loaded);
  changedPolicyApproval.resources.find(({ id }) => id === "policy-example").approvedOn = "2026-09-13";
  assert.notEqual(
    collectionRevision(changedPolicyApproval, "control", { programId: "program-example" }),
    initialRevision
  );
  const changedDocumentApprover = structuredClone(loaded);
  changedDocumentApprover.resources.find(({ id }) => id === "document-example").approverIds = ["person-example"];
  assert.notEqual(
    collectionRevision(changedDocumentApprover, "control", { programId: "program-example" }),
    initialRevision
  );
  const activatedPolicy = structuredClone(loaded);
  activatedPolicy.resources.find(({ id }) => id === "policy-example").status = "active";
  activatedPolicy.resources.find(({ id }) => id === "policy-example").effectiveOn = "2026-09-12";
  assert.equal(
    collectionRevision(activatedPolicy, "control", { programId: "program-example" }),
    initialRevision
  );

  const changedSystem = structuredClone(loaded);
  changedSystem.resources.find(({ id }) => id === "system-example").boundary = "Changed service boundary";
  assert.notEqual(
    collectionRevision(changedSystem, "control", { programId: "program-example" }),
    initialRevision
  );

  const changedApplicability = structuredClone(loaded);
  changedApplicability.resources.find(({ id }) => id === "program-example")
    .requirementApplicability[0].rationale = "Changed scope rationale";
  assert.notEqual(
    collectionRevision(changedApplicability, "control", { programId: "program-example" }),
    initialRevision
  );

  const changedObligation = structuredClone(loaded);
  changedObligation.resources.find(({ id }) => id === "obligation-example").activityType = "access-review";
  assert.notEqual(
    collectionRevision(changedObligation, "control", { programId: "program-example" }),
    initialRevision
  );

  const changedOwner = structuredClone(loaded);
  changedOwner.resources.find(({ id }) => id === "person-example").status = "inactive";
  assert.notEqual(
    collectionRevision(changedOwner, "control", { programId: "program-example" }),
    initialRevision
  );

  const coverageBaseline = structuredClone(loaded);
  coverageBaseline.resources.find(({ id }) => id === "control-example").code = "HR-01";
  coverageBaseline.resources.find(({ id }) => id === "source-coverage-example").retentionScheduleItemIds = ["retention-schedule-item-example"];
  coverageBaseline.resources.find(({ id }) => id === "document-example").status = "approved";
  const coverageRevision = collectionRevision(coverageBaseline, "control", { programId: "program-example" });
  const changedCoverage = structuredClone(coverageBaseline);
  changedCoverage.resources.find(({ id }) => id === "source-coverage-example").collectionCadence = "Monthly";
  assert.notEqual(
    collectionRevision(changedCoverage, "control", { programId: "program-example" }),
    coverageRevision
  );
  const activatedSchedule = structuredClone(coverageBaseline);
  const schedule = activatedSchedule.resources.find(({ id }) => id === "document-example");
  schedule.status = "active";
  schedule.activationBasis = "recorded";
  schedule.activatedOn = "2026-09-12";
  schedule.activatedByIds = ["person-example"];
  assert.equal(
    collectionRevision(activatedSchedule, "control", { programId: "program-example" }),
    coverageRevision
  );
  schedule.approvedOn = "2026-09-13";
  assert.notEqual(
    collectionRevision(activatedSchedule, "control", { programId: "program-example" }),
    coverageRevision
  );
});

test("person scope includes operators referenced only by selected Components and Vendors", () => {
  const program = { id: "program-one", type: "program", systemIds: ["system-one"], controlIds: [] };
  const people = ["person-component-owner", "person-vendor-owner", "person-payroll-owner", "person-auditor", "person-unrelated"]
    .map((id) => ({ id, type: "person", title: id }));
  const loaded = {
    model: loadModel("7"),
    resources: [
      ...people,
      program,
      { id: "system-one", type: "system", title: "System one" },
      {
        id: "component-one",
        type: "component",
        status: "active",
        vendorId: "vendor-one",
        ownerIds: ["person-component-owner"],
        systemUses: [{ systemId: "system-one", roles: ["service-delivery"] }]
      },
      { id: "vendor-one", type: "vendor", ownerIds: ["person-vendor-owner"] },
      { id: "vendor-payroll", type: "vendor", category: "payroll", ownerIds: ["person-payroll-owner"] },
      { id: "vendor-cpa", type: "vendor", category: "Professional services", ownerIds: ["person-auditor"] },
      { id: "audit-one", type: "audit", auditorVendorId: "vendor-cpa" }
    ]
  };

  assert.deepEqual(
    scopedCollectionRecords(loaded, "person", program).map(({ id }) => id).sort(),
    ["person-component-owner", "person-payroll-owner", "person-vendor-owner"]
  );
  assert.deepEqual(
    scopedCollectionRecords(loaded, "vendor", program).map(({ id }) => id).sort(),
    ["vendor-one", "vendor-payroll"]
  );
});

test("does not treat a Git timestamp as proof of a Collection Review date", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-review-git-time-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "9");
  await execute("git", ["init", "--initial-branch=main"], { cwd: root });
  await execute("git", ["config", "user.name", "Test User"], { cwd: root });
  await execute("git", ["config", "user.email", "test@example.test"], { cwd: root });
  await execute("git", ["add", "."], { cwd: root });
  await execute("git", ["commit", "-m", "Initial workspace"], { cwd: root });
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
  const plan = await planCollectionReview(root, {
    resourceType: "person",
    programId: "program-example",
    decision: "complete",
    rationale: "Confirmed the current program participants.",
    reviewedByIds: ["person-independent-approver-example"],
    reviewedOn: today,
    now: new Date().toISOString()
  });
  const review = plan.changes.create[0];
  await mkdir(join(root, "data", "collection-reviews"), { recursive: true });
  await writeFile(
    join(root, "data", "collection-reviews", `${review.id}.json`),
    `${JSON.stringify(review, null, 2)}\n`,
    "utf8"
  );
  await execute("git", ["add", "."], { cwd: root });
  await execute("git", ["commit", "-m", "Record current review"], {
    cwd: root,
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: "2001-01-01T00:00:00Z",
      GIT_COMMITTER_DATE: "2031-01-01T00:00:00Z"
    }
  });

  const validation = await validateWorkspace(root);
  assert.equal(validation.diagnostics.some(({ code, message }) => (
    code === "rewritten-finalized-record" && /Collection Review/.test(message)
  )), false, JSON.stringify(validation.diagnostics, null, 2));
});

test("records a temporal Classification collection population", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-classification-review-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "10");
  await execute("git", ["init", "--initial-branch=main"], { cwd: root });
  await execute("git", ["config", "user.name", "Test User"], { cwd: root });
  await execute("git", ["config", "user.email", "test@example.test"], { cwd: root });
  await execute("git", ["add", "."], { cwd: root });
  await execute("git", ["commit", "-m", "Initial workspace"], { cwd: root });

  const loaded = await loadWorkspace(root);
  const reviewedOn = new Intl.DateTimeFormat("en-CA", { timeZone: loaded.workspace.timezone }).format(new Date());
  const result = await applyCollectionReview(root, {
    resourceType: "classification",
    programId: "program-example",
    decision: "complete",
    rationale: "Confirmed all active information handling classifications.",
    reviewedByIds: ["person-independent-approver-example"],
    reviewedOn,
    confirmed: true
  });

  assert.deepEqual(result.changes.create[0].populationResourceIds, ["classification-example"]);
  assert.equal(result.assessment.status, "current");
  const validation = await validateWorkspace(root);
  assert.equal(validation.ok, true, JSON.stringify(validation.diagnostics, null, 2));
});

test("scaffolds every collection re-review with today's workspace date and prior review context", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-collection-rereview-scaffold-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const { model } = await makeComprehensiveWorkspace(root, "10");
  const reviewRoot = join(root, "data", "collection-reviews");
  await rm(reviewRoot, { recursive: true, force: true });
  await mkdir(reviewRoot, { recursive: true });

  for (const resourceType of Object.keys(model.collectionReviews)) {
    const decisions = model.collectionReviews[resourceType].decisions || ["complete"];
    const priorDecision = resourceType === "vendor"
      ? "externally-managed"
      : decisions.includes("zero-population") ? "zero-population" : "complete";
    await writeFile(
      join(reviewRoot, `collection-review-${resourceType}.json`),
      `${JSON.stringify({
        id: `collection-review-${resourceType}`,
        type: "collection-review",
        title: `${model.collectionReviews[resourceType].title} review`,
        status: "active",
        resourceType,
        scopeResourceIds: ["program-example"],
        decision: priorDecision,
        rationale: `Prior notes for ${resourceType}.`,
        reviewedByIds: ["person-independent-approver-example"],
        reviewedOn: "2025-01-15",
        collectionRevision: "prior-collection-revision",
        scopeRevision: "prior-scope-revision",
        ...(resourceType === "vendor" ? { authoritativeComponentId: "component-example" } : {})
      }, null, 2)}\n`,
      "utf8"
    );
  }

  for (const resourceType of Object.keys(model.collectionReviews)) {
    const scaffold = await scaffoldCollectionReview(root, {
      resourceType,
      programId: "program-example",
      now: "2026-09-01T00:30:00.000Z"
    });
    assert.equal(scaffold.reviewedOn, "2026-08-31", resourceType);
    assert.deepEqual(scaffold.reviewedByIds, ["person-independent-approver-example"], resourceType);
    assert.equal(scaffold.rationale, `Prior notes for ${resourceType}.`, resourceType);
    if (resourceType === "vendor") {
      assert.equal(scaffold.decision, "externally-managed");
      assert.equal(scaffold.authoritativeComponentId, "component-example");
    } else {
      assert.equal(scaffold.decision, "complete", resourceType);
    }
  }

  const loaded = await loadWorkspace(root);
  const componentEntry = loaded.entries.find(({ record }) => record.id === "component-example");
  await writeFile(
    componentEntry.path,
    `${JSON.stringify({ ...componentEntry.record, status: "retired" }, null, 2)}\n`,
    "utf8"
  );
  const retiredSourceScaffold = await scaffoldCollectionReview(root, {
    resourceType: "vendor",
    programId: "program-example",
    now: "2026-09-01T00:30:00.000Z"
  });
  assert.equal(retiredSourceScaffold.decision, "zero-population");
  assert.equal(retiredSourceScaffold.authoritativeComponentId, null);
});

test("binds a collection confirmation to the exact records and relevant scope", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-collection-review-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  let loaded = await loadWorkspace(root);
  await updateResource(root, "workspace", loaded.workspace.id, {
    ...loaded.workspace,
    dataModelVersion: "3",
    assuranceGoal: "readiness",
    systemIds: [],
    frameworkIds: [],
    requirementIds: [],
    controlIds: []
  });

  loaded = await loadWorkspace(root);
  const before = assessCollectionReview(loaded, "person");
  assert.equal(before.status, "review-required");
  assert.equal(before.recordCount, 2);
  assert.equal(before.configuration.reviewPoints.length, 2);
  assert.deepEqual(await scaffoldCollectionReview(root, {
    resourceType: "person",
    now: "2026-08-03T12:00:00.000Z"
  }), {
    resourceType: "person",
    decision: "complete",
    rationale: null,
    reviewedByIds: [],
    reviewedOn: null,
    authoritativeSystemId: null
  });
  const emptyRequiredCollection = assessCollectionReview(loaded, "system");
  assert.equal(emptyRequiredCollection.recordCount, 0);
  assert.equal(emptyRequiredCollection.message, "Add at least one system before confirming this collection.");
  await assert.rejects(
    planCollectionReview(root, {
      resourceType: "system",
      decision: "complete",
      rationale: "No Systems were added.",
      reviewedByIds: ["person-approver"],
      reviewedOn: "2026-08-03"
    }),
    /Add the required records before confirming/
  );

  const plan = await planCollectionReview(root, {
    resourceType: "person",
    decision: "complete",
    rationale: "Confirmed every current program participant and role reference.",
    reviewedByIds: ["person-approver"],
    reviewedOn: "2026-08-03",
    scopeRevision: "scope-review-1"
  });
  assert.equal(plan.changes.create[0].collectionRevision, before.collectionRevision);

  await applyCollectionReview(root, {
    resourceType: "person",
    decision: "complete",
    rationale: "Confirmed every current program participant and role reference.",
    reviewedByIds: ["person-approver"],
    reviewedOn: "2026-08-03",
    scopeRevision: "scope-review-1",
    confirmed: true
  });

  loaded = await loadWorkspace(root);
  assert.equal(assessCollectionReview(loaded, "person").status, "current");
  const guide = buildAgentGuide(loaded, "person");
  assert.equal(guide.reviewRequirements.collectionReview.status, "current");
  assert.match(guide.reviewRequirements.collectionReview.command, /review-collection person/);
  const review = loaded.resources.find((record) => record.type === "collection-review");
  await assert.rejects(
    updateResource(root, "collection-review", review.id, {
      ...review,
      decision: "not-applicable"
    }),
    /immutable/i
  );

  const owner = loaded.resources.find((record) => record.id === "person-owner");
  await updateResource(root, "person", owner.id, {
    ...owner,
    jobTitle: "Chief Executive and Security Officer"
  });
  loaded = await loadWorkspace(root);
  assert.equal(assessCollectionReview(loaded, "person").status, "stale");

  await applyCollectionReview(root, {
    resourceType: "person",
    decision: "complete",
    rationale: "Reconfirmed participants after the role title changed.",
    reviewedByIds: ["person-approver"],
    reviewedOn: "2026-08-04",
    scopeRevision: "scope-review-2",
    confirmed: true
  });
  loaded = await loadWorkspace(root);
  const workspace = loaded.workspace;
  await updateResource(root, "workspace", workspace.id, {
    ...workspace,
    candidateCoverage: {
      kind: "as-of",
      on: "2026-08-31"
    }
  });
  loaded = await loadWorkspace(root);
  assert.equal(assessCollectionReview(loaded, "person").status, "current");
});

test("exposes collection confirmation preview and apply through the browser API", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-collection-review-api-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  let loaded = await loadWorkspace(root);
  await updateResource(root, "workspace", loaded.workspace.id, {
    ...loaded.workspace,
    dataModelVersion: "3"
  });

  const running = await serveWorkspace(root, { port: 0, writesAllowed: true });
  context.after(() => new Promise((resolve) => running.server.close(resolve)));
  const payload = {
    resourceType: "person",
    decision: "complete",
    rationale: "Confirmed current people and their program roles.",
    reviewedByIds: ["person-approver"],
    reviewedOn: "2026-08-03"
  };
  const previewResponse = await fetch(`${running.url}/api/collection-review/preview`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  assert.equal(previewResponse.status, 200);
  assert.equal((await previewResponse.json()).resourceType, "person");

  const applyResponse = await fetch(`${running.url}/api/collection-review`, {
    method: "POST",
    headers: { "content-type": "application/json", prefer: "respond-async" },
    body: JSON.stringify({ ...payload, confirmed: true })
  });
  assert.equal(applyResponse.status, 201);
  const applied = await applyResponse.json();
  assert.equal(applied.state, undefined);
  assert.equal(applied.stateRefresh, true);
  assert.equal(applied.assessment.status, "current");
  const refreshed = await fetch(`${running.url}/api/state`).then((response) => response.json());
  assert.equal(refreshed.collectionReviews.person.status, "current");

  const standardResponse = await fetch(`${running.url}/api/collection-review`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...payload,
      rationale: "Confirmed again through the standard API response.",
      expectedRevision: refreshed.collectionReviews.person.reviewRevision,
      confirmed: true
    })
  });
  assert.equal(standardResponse.status, 201);
  assert.equal((await standardResponse.json()).state.collectionReviews.person.status, "current");
});
