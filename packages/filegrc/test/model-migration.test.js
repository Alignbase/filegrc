import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadModel } from "../model/index.js";
import { runCli } from "../src/cli.js";
import { applicabilityReviewIsCurrent } from "../src/applicability-scope.js";
import { assessAuditPreparation } from "../src/audit-preparation.js";
import { prepareEvidencePacket } from "../src/evidence-packet.js";
import { applyResourceBatch, createResource } from "../src/files.js";
import { migrateModel, planModelMigration } from "../src/model-migration.js";
import { loadWorkspace } from "../src/workspace.js";
import { validateWorkspace } from "../src/validate.js";
import { assessWorkflow } from "../src/workflow.js";
import { makeComprehensiveWorkspace } from "./fixtures.js";
import { executeCli, makeWorkspace, writeJson } from "./helpers.js";

const execute = (executable, args) => executeCli(runCli, executable, args);
const cli = fileURLToPath(new URL("../bin/filegrc.js", import.meta.url));
const complianceNarrativeFields = new Set(["description", "rationale", "purpose", "boundary", "summary"]);

function assertPureMigrationNarratives(plan) {
  const polluted = [];
  const inspect = (value, path = []) => {
    if (Array.isArray(value)) return value.forEach((item, index) => inspect(item, [...path, index]));
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      const itemPath = [...path, key];
      if (key === "filegrc.migration") polluted.push(`${itemPath.join(".")}: migration metadata extension`);
      if (
        complianceNarrativeFields.has(key)
        && typeof item === "string"
        && /\b(?:filegrc|migrat(?:e|ed|es|ing|ion)|model v\d+|legacy-v\d+)\b/i.test(item)
      ) polluted.push(`${itemPath.join(".")}: ${item}`);
      inspect(item, itemPath);
    }
  };
  for (const change of [...plan.fileDiff.create, ...plan.fileDiff.update]) inspect(change.after, [change.type, change.id]);
  assert.deepEqual(polluted, [], `Migration mechanics leaked into compliance narratives:\n${polluted.join("\n")}`);
}

test("previews and atomically migrates every model v1 compatibility field", async (context) => {
  const root = await mkdtemp(`${tmpdir()}/filegrc-model-migration-`);
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "2");
  const loaded = await loadWorkspace(root);
  const byId = new Map(loaded.resources.map((record) => [record.id, structuredClone(record)]));

  for (const record of byId.values()) record.schemaVersion = 1;
  const legacyWorkspace = byId.get("workspace");
  legacyWorkspace.dataModelVersion = "1";
  legacyWorkspace.repositoryUrl = "https://example.test/repository.git";
  legacyWorkspace.classificationDefinitions = {
    Public: "Public information",
    Internal: "Internal information",
    Confidential: "Confidential information",
    Restricted: "Restricted information"
  };
  legacyWorkspace.systemIds = [];
  legacyWorkspace.candidatePeriodStart = "2026-01-01";
  legacyWorkspace.candidatePeriodEnd = "2026-06-30";
  delete legacyWorkspace.candidateCoverage;
  const legacySystem = byId.get("system-example");
  legacySystem.inScope = true;
  legacySystem.dataClassification = "Confidential";
  delete legacySystem.classificationId;
  const externalApprover = byId.get("person-independent-approver-example");
  externalApprover.status = "external";
  delete externalApprover.affiliation;
  for (const record of byId.values()) {
    if (record.id !== externalApprover.id && record.type === "person") delete record.affiliation;
    delete record.approvedContentRevisions;
    const legacyDateField = {
      "policy-review": "reviewedOn",
      "vendor-review": "reviewedOn",
      "access-review": "reviewDate",
      "risk-assessment": "assessmentDate",
      "backup-test": "testDate"
    }[record.type];
    if (legacyDateField && record.completedOn) {
      record[legacyDateField] = record.completedOn;
      delete record.completedOn;
    }
    if (record.type === "vendor-review" && record.vendorId) {
      record.vendorIds = [record.vendorId];
      delete record.vendorId;
    }
    const oldClassificationField = ["system", "asset", "vendor", "incident"].includes(record.type)
      ? "dataClassification"
      : ["document", "evidence"].includes(record.type)
        ? "classification"
        : null;
    if (oldClassificationField && record.classificationId) {
      record[oldClassificationField] = "Confidential";
      delete record.classificationId;
    }
    if (!record.coverage) continue;
    if (record.coverage.kind === "as-of") {
      record[record.type === "audit" ? "typeOneAsOf" : "asOfDate"] = record.coverage.on;
    } else {
      record.periodStart = record.coverage.startsOn;
      record.periodEnd = record.coverage.endsOn;
    }
    delete record.coverage;
  }
  const legacyObligation = byId.get("obligation-example");
  legacyObligation.activityType = "access-provisioning";
  legacyObligation.recurrence = { mode: "event", eventType: "person-started" };
  legacyObligation.window = { startOffsetDays: 0, endOffsetDays: 3 };
  legacyObligation.completionResourceTypes = ["access-grant", "evidence"];
  const legacyVendorReview = byId.get("vendor-review-example");
  legacyVendorReview.status = "approved";
  legacyVendorReview.outcome = "passed";
  delete legacyVendorReview.decision;
  const legacyBackupTest = byId.get("backup-test-example");
  legacyBackupTest.status = "passed";
  const renderer = byId.get("renderer-settings-example");
  delete renderer.repositoryMode;
  delete renderer.authoritativeBranch;
  delete renderer.repositoryRemote;
  renderer.completedStagePageIds = ["scope:complementary-control", "scope:system"];
  const person = byId.get("person-example");
  person.role = "Policy Owner";
  person.teamIds = ["team-example"];
  byId.get("appointment-example").appointmentKind = "ciso";
  byId.get("team-example").memberIds = [];
  byId.get("system-example").commitmentIds = ["commitment-example"];
  delete byId.get("commitment-example").systemIds;
  byId.get("requirement-example").controlIds = ["control-example"];
  byId.get("control-example").requirementIds = [];
  byId.get("control-example").commitmentIds = ["commitment-example"];
  delete byId.get("commitment-example").controlIds;
  byId.get("control-example").riskIds = ["risk-example"];
  delete byId.get("risk-example").controlIds;
  byId.get("policy-example").controlIds = ["control-example"];
  delete byId.get("control-example").policyIds;
  byId.get("vendor-example").systemIds = ["system-example"];
  delete byId.get("system-example").vendorId;
  byId.get("audit-example").controlTestIds = ["control-test-example"];
  delete byId.get("control-test-example").auditId;
  byId.get("audit-example").evidenceIds = ["evidence-example"];
  delete byId.get("evidence-example").auditIds;
  const legacyEvidence = byId.get("evidence-example");
  legacyEvidence.status = "expired";
  legacyEvidence.expiresOn = "2026-07-31";
  legacyEvidence.evidenceKind = "configuration-export";
  legacyEvidence.source = legacyEvidence.sourceDescription || "System configuration";
  delete legacyEvidence.artifactKind;
  delete legacyEvidence.artifactSubtype;
  delete legacyEvidence.sourceKind;
  delete legacyEvidence.sourceDescription;
  legacyEvidence.collectionTestFamilyId = "identity-access";
  legacyEvidence.collectionTestPrompt = "Export a test report.";
  Object.assign(byId.get("audit-population-example"), {
    status: "incomplete",
    sourceSystemId: "system-example",
    sourceEvidenceId: "evidence-example",
    reconciledByIds: ["person-example"],
    reconciledOn: "2026-06-30"
  });
  const legacyAction = byId.get("action-item-example");
  legacyAction.dueOn = "2026-08-15";
  delete legacyAction.completionWindow;
  const legacyControl = byId.get("control-example");
  legacyControl.frequency = "Continuous";
  delete legacyControl.operationPattern;
  byId.get("policy-example").reviewCadence = {
    mode: "calendar",
    unit: "year",
    interval: 1,
    anchorDate: "2026-01-01"
  };
  byId.get("document-example").relatedResourceIds = ["training-example"];
  const accountableReferences = [...byId.values()].flatMap((record) => (
    ["ownerIds", "evidenceOwnerIds"].flatMap((field) => (
      Array.isArray(record[field]) && record[field].includes("person-example")
        ? [{ id: record.id, field }]
        : []
    ))
  ));
  assert.ok(accountableReferences.length);

  for (const [id, record] of byId) {
    const entry = loaded.entries.find(({ record: candidate }) => candidate.id === id);
    await writeJson(entry.path, record);
  }

  const cliPreview = await execute(process.execPath, [
    cli,
    "migrate",
    "--to-model",
    "2",
    "--preview",
    "--starts-on",
    "2026-08-02",
    "--root",
    root,
    "--json"
  ]);
  const parsedCliPreview = JSON.parse(cliPreview.stdout);
  assert.equal(parsedCliPreview.ready, true, JSON.stringify({
    missing: parsedCliPreview.missing,
    conflicts: parsedCliPreview.conflicts,
    manualActions: parsedCliPreview.manualActions
  }));

  const preview = await planModelMigration(root, { startsOn: "2026-08-02" });
  assert.equal(preview.ready, true);
  assert.equal(preview.summary.create, 2);
  assert.ok(preview.summary.update >= 12);
  assert.equal(preview.changes.create[0].type, "appointment");
  assert.equal(preview.changes.create[0].startsOn, "2026-08-02");
  assert.equal(preview.changes.update.at(-1).id, "workspace");
  assert.ok(preview.notes.some(({ resourceId }) => resourceId === "evidence-example"));

  const changedPerson = {
    ...byId.get("person-example"),
    department: "Operations"
  };
  const personPath = loaded.entries.find(({ record }) => record.id === "person-example").path;
  await writeJson(personPath, changedPerson);
  await assert.rejects(
    applyResourceBatch(root, preview.changes),
    /Resource "person-example" changed after you opened it/
  );

  const result = await migrateModel(root, { startsOn: "2026-08-02" });
  assert.equal(result.applied, true);
  const migrated = await loadWorkspace(root);
  const records = new Map(migrated.resources.map((record) => [record.id, record]));
  assert.equal(records.get("workspace").dataModelVersion, "2");
  assert.equal(records.get("workspace").repositoryUrl, undefined);
  assert.deepEqual(records.get("workspace").systemIds, ["system-example"]);
  assert.deepEqual(records.get("workspace").classificationDefinitions, {
    public: "Public information",
    internal: "Internal information",
    confidential: "Confidential information",
    restricted: "Restricted information"
  });
  assert.equal(records.get("system-example").inScope, undefined);
  assert.equal(records.get("system-example").classificationId, "confidential");
  assert.equal(records.get("person-independent-approver-example").status, "active");
  assert.equal(records.get("person-independent-approver-example").affiliation, "external");
  assert.deepEqual(records.get("obligation-example").window, {
    precision: "date",
    startsAfter: 0,
    dueAfter: 3
  });
  assert.equal(records.get("obligation-example").completionResourceTypes, undefined);
  assert.equal(records.get("vendor-review-example").status, "complete");
  assert.equal(records.get("vendor-review-example").decision, "approved");
  assert.equal(records.get("vendor-review-example").vendorId, "vendor-example");
  assert.equal(records.get("vendor-review-example").completedOn, "2026-06-30");
  assert.equal(records.get("vendor-review-example").outcome, undefined);
  assert.equal(records.get("backup-test-example").status, "complete");
  assert.equal(records.get("backup-test-example").outcome, "passed");
  assert.equal(records.get("backup-test-example").completedAt, "2026-06-15T15:30:00Z");
  assert.equal(records.get("backup-test-example").completedOn, undefined);
  assert.equal(records.get("person-example").role, undefined);
  assert.equal(records.get("person-example").teamIds, undefined);
  assert.deepEqual(records.get("team-example").memberIds, ["person-example"]);
  assert.deepEqual(records.get("commitment-example").systemIds, ["system-example"]);
  assert.deepEqual(records.get("commitment-example").controlIds, ["control-example"]);
  assert.deepEqual(records.get("control-example").requirementIds, ["requirement-example"]);
  assert.deepEqual(records.get("control-example").policyIds, ["policy-example"]);
  assert.deepEqual(records.get("risk-example").controlIds, ["control-example"]);
  assert.equal(records.get("system-example").vendorId, "vendor-example");
  assert.equal(records.get("control-test-example").auditId, "audit-example");
  assert.deepEqual(records.get("evidence-example").auditIds, ["audit-example"]);
  assert.equal(records.get("evidence-example").collectionTestFamilyId, undefined);
  assert.equal(records.get("evidence-example").collectionTestPrompt, undefined);
  assert.equal(records.get("evidence-example").artifactKind, "configuration-export");
  assert.equal(records.get("evidence-example").sourceKind, "system");
  assert.equal(records.get("evidence-example").status, "verified");
  assert.equal(records.get("evidence-example").expiresOn, "2026-07-31");
  assert.equal(records.get("evidence-example").evidenceKind, undefined);
  assert.equal(records.get("audit-population-example").status, "reconciled");
  assert.equal(records.get("audit-population-example").conclusion, "incomplete");
  assert.deepEqual(records.get("action-item-example").completionWindow, {
    precision: "date",
    startsOn: "2026-08-15",
    dueOn: "2026-08-15",
    overdueOn: "2026-08-16"
  });
  assert.equal(records.get("control-example").operationPattern, "continuous");
  assert.equal(records.get("control-example").frequency, undefined);
  assert.deepEqual(records.get("document-example").trainingIds, ["training-example"]);
  assert.equal(records.get("policy-example").reviewCadence, undefined);
  assert.match(records.get("policy-example").approvedContentRevisions["policies/policy-example.md"], /^[a-f0-9]{64}$/);
  assert.ok([...records.values()].some((record) => (
    record.type === "obligation"
    && record.templateResourceId === "policy-example"
    && record.activityType === "policy-review"
  )));
  assert.equal(records.get("renderer-settings-example").repositoryMode, "manual");
  assert.deepEqual(records.get("renderer-settings-example").completedStagePageIds, [
    "controls:complementary-control",
    "scope:system"
  ]);
  assert.equal([...records.values()].some((record) => Object.hasOwn(record, "schemaVersion")), false);
  for (const { id, field } of accountableReferences) {
    assert.ok(records.get(id)[field].includes(preview.changes.create[0].id));
    assert.ok(!records.get(id)[field].includes("person-example"));
  }
  assert.deepEqual((await validateWorkspace(root)).counts, { resources: 45, errors: 0, warnings: 0 });

  const noop = await migrateModel(root, { targetModelVersion: "2" });
  assert.equal(noop.applied, false);
});

test("blocks ambiguous Person roles for manual review", async (context) => {
  const root = await mkdtemp(`${tmpdir()}/filegrc-model-migration-review-`);
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const loaded = await loadWorkspace(root);
  const workspaceEntry = loaded.entries.find(({ record }) => record.type === "workspace");
  await writeJson(workspaceEntry.path, { ...workspaceEntry.record, dataModelVersion: "1" });
  const personEntry = loaded.entries.find(({ record }) => record.id === "person-owner");
  await writeJson(personEntry.path, { ...personEntry.record, role: "Security Lead" });

  const plan = await planModelMigration(root);
  assert.equal(plan.ready, false);
  assert.equal(plan.manualActions[0].resourceId, "person-owner");
  await assert.rejects(
    createResource(root, {
      id: "team-blocked-before-migration",
      type: "team",
      title: "Blocked before migration",
      status: "active",
      purpose: "Prove that normal model v2 writes cannot change a model v1 workspace.",
      memberIds: ["person-owner"]
    }),
    /migrate --to-model 2/
  );
  await assert.rejects(migrateModel(root), /needs review/);
  assert.match(await readFile(personEntry.path, "utf8"), /"role": "Security Lead"/);
});

test("classifies and applies the v2-to-v3 migration without inventing decisions", async (context) => {
  const root = await mkdtemp(`${tmpdir()}/filegrc-model-v3-migration-`);
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await writeJson(join(root, "data", "renderer.json"), {
    id: "renderer-settings",
    type: "renderer-settings",
    title: "Renderer settings",
    showOnboarding: false,
    repositoryMode: "manual",
    authoritativeBranch: "main",
    repositoryRemote: "origin",
    completedStagePageIds: ["scope:person"]
  });
  await createResource(root, {
    id: "appointment-policy-owner",
    type: "appointment",
    title: "Policy Owner",
    status: "active",
    appointmentKind: "policy-owner",
    holderId: "person-owner",
    scopeResourceIds: ["workspace"],
    startsOn: "2026-08-01"
  });
  const preview = await planModelMigration(root);
  assert.equal(preview.sourceModelVersion, "2");
  assert.equal(preview.targetModelVersion, "3");
  assert.equal(preview.ready, true);
  assert.equal(preview.classifications.unsupported.length, 0);
  assert.ok(preview.classifications.automatic.some(({ field }) => field === "completedStagePageIds"));
  assert.ok(preview.classifications.reviewRequired.some(({ field }) => field === "holderId"));
  assert.deepEqual(
    preview.changes.create
      .filter(({ type }) => type === "appointment")
      .map(({ appointmentKind }) => appointmentKind),
    ["independent-policy-reviewer"]
  );
  assert.ok(preview.changes.create.some(({ type }) => type === "source-coverage"));
  assert.equal(preview.changes.create.every((record) => record.holderId === undefined), true);
  const unsafeChanges = { ...preview.changes };
  delete unsafeChanges.targetModelVersion;
  await assert.rejects(
    applyResourceBatch(root, unsafeChanges),
    /must declare targetModelVersion/
  );

  const result = await migrateModel(root);
  assert.equal(result.applied, true);
  const migrated = await loadWorkspace(root);
  assert.equal(migrated.workspace.dataModelVersion, "3");
  assert.equal(migrated.model.modelVersion, "3");
  assert.equal(
    migrated.resources.find(({ type }) => type === "renderer-settings").completedStagePageIds,
    undefined
  );
  assert.equal(
    migrated.resources.filter(({ type, status }) => type === "appointment" && status === "planned").length,
    1
  );
  assert.equal(
    migrated.resources.filter(({ type }) => type === "source-coverage").length,
    migrated.model.evidenceSourceFamilies.length
  );
  assert.deepEqual((await validateWorkspace(root)).counts, {
    resources: 6
      + migrated.model.evidenceSourceFamilies.length
      + Object.keys(migrated.model.collectionReviews).length,
    errors: 0,
    warnings: 0
  });
  assert.equal(result.postMigrationAssessment.contractVersion, 1);
});

test("precreates model v3 source coverage when model v2 has no Appointments", async (context) => {
  const root = await mkdtemp(`${tmpdir()}/filegrc-model-v3-source-coverage-`);
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);

  const preview = await planModelMigration(root);
  const appointments = preview.changes.create.filter(({ type }) => type === "appointment");
  const policyOwner = appointments.find(({ appointmentKind }) => appointmentKind === "policy-owner");
  assert.ok(policyOwner);
  assert.equal(
    preview.changes.create.filter(({ type }) => type === "source-coverage").length,
    loadModel("3").evidenceSourceFamilies.length
  );
  assert.equal(
    preview.changes.create
      .filter(({ type }) => type === "source-coverage")
      .every(({ ownerIds }) => ownerIds.includes(policyOwner.id)),
    true
  );

  const result = await migrateModel(root);
  assert.equal(result.applied, true);
  assert.equal((await validateWorkspace(root)).ok, true);

  const noOpV3 = await planModelMigration(root, { targetModelVersion: "3" });
  assert.equal(noOpV3.schemaVersion, 2);
  assert.equal(noOpV3.sourceModelVersion, "3");
  assert.equal(noOpV3.targetModelVersion, "3");
  assert.deepEqual(noOpV3.classifications, {
    automatic: [],
    reviewRequired: [],
    unsupported: []
  });

  const current = await planModelMigration(root);
  assert.equal(current.schemaVersion, 2);
  assert.equal(current.sourceModelVersion, "3");
  assert.equal(current.targetModelVersion, "4");
  assert.equal(current.classifications.unsupported.length, 0);
  assert.ok(current.classifications.automatic.some(({ resourceId }) => resourceId === "workspace"));
});

test("classifies and atomically migrates a complete v3 System and Component graph", async (context) => {
  const root = await mkdtemp(`${tmpdir()}/filegrc-model-v4-migration-`);
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "3");
  let loaded = await loadWorkspace(root);
  const rootSystem = loaded.resources.find(({ type }) => type === "system");
  const child = {
    ...rootSystem,
    id: "system-production-platform",
    title: "Production platform",
    systemKind: "infrastructure",
    parentSystemId: rootSystem.id,
    vendorId: "vendor-example",
    subserviceVendorIds: ["vendor-example"],
    description: "Runs the bounded production application and produces authoritative Evidence.",
    evidenceSourceKinds: [loaded.model.evidenceSourceFamilies[0].sourceKinds[0]],
    evidenceOwnerIds: ["person-example"]
  };
  await createResource(root, child, { content: { record: "# Production platform\n\nExport the authoritative access report for the selected period.\n" } });
  loaded = await loadWorkspace(root);
  for (const entry of loaded.entries) {
    const record = structuredClone(entry.record);
    let changed = false;
    if (record.type === "control") {
      record.systemIds = [rootSystem.id];
      record.evidenceSourceIds = [child.id];
      changed = true;
    }
    if (record.type === "audit") {
      record.systemIds = [rootSystem.id, child.id];
      record.subserviceVendorIds = ["vendor-example"];
      record.subserviceMethod = "carve-out";
      changed = true;
    }
    if (["asset", "access-review", "vulnerability-scan"].includes(record.type) && record.systemIds) {
      record.systemIds = [child.id];
      changed = true;
    }
    if (record.type === "access-grant" && record.systemId) {
      record.systemId = child.id;
      changed = true;
    }
    if (record.type === "audit-population" && record.sourceSystemId) {
      record.sourceSystemId = child.id;
      changed = true;
    }
    if (record.type === "audit-request" && record.externalAuthoritySystemId) {
      record.externalAuthoritySystemId = child.id;
      changed = true;
    }
    if (record.type === "collection-review" && record.authoritativeSystemId) {
      record.authoritativeSystemId = child.id;
      changed = true;
    }
    if (record.type === "source-coverage" && record.systemId) {
      record.systemId = child.id;
      changed = true;
    }
    if (record.type === "evidence") {
      record.sourceKind = "system";
      record.sourceSystemId = child.id;
      changed = true;
    }
    if (changed) await writeJson(entry.path, record);
  }

  const preview = await planModelMigration(root, { targetModelVersion: "4" });
  assert.equal(preview.ready, true, preview.classifications.unsupported.map(({ message }) => message).join("\n"));
  assert.equal(preview.migrationReport.retainedSystemIds.includes(rootSystem.id), true);
  assert.equal(preview.migrationReport.componentIds.includes(child.id), true);
  assert.deepEqual(preview.fileDiff.move, [{ from: `systems/${child.id}.md`, to: `components/${child.id}.md` }]);
  assert.ok(preview.classifications.automatic.length);
  assert.ok(preview.classifications.reviewRequired.length);
  assertPureMigrationNarratives(preview);
  const previewComponent = preview.fileDiff.update.find(({ id }) => id === child.id).after;
  assert.equal(previewComponent.systemUses[0].rationale, `Supports the bounded System "${rootSystem.title}".`);
  assert.equal(previewComponent.extensions?.["filegrc.migration"], undefined);
  assert.deepEqual(
    preview.migrationReport.unmappedLegacyFields.find(({ resourceId }) => resourceId === child.id).fields,
    { subserviceVendorIds: ["vendor-example"] }
  );
  for (const informationType of preview.fileDiff.create.filter(({ type }) => type === "information-type")) {
    assert.doesNotMatch(informationType.after.description, /migrat|filegrc|model v/i);
  }
  const unrelatedMove = structuredClone(preview.changes);
  unrelatedMove.movePaths = [{ from: "workspace.json", to: "archive/workspace.json" }];
  await assert.rejects(
    applyResourceBatch(root, unrelatedMove),
    /must match companion Markdown for a resource whose type changes/
  );

  const result = await migrateModel(root, { targetModelVersion: "4" });
  assert.equal(result.applied, true);
  const migrated = await loadWorkspace(root);
  assert.equal(migrated.workspace.dataModelVersion, "4");
  assert.equal(migrated.resources.find(({ id }) => id === rootSystem.id).type, "system");
  const component = migrated.resources.find(({ id }) => id === child.id);
  assert.equal(component.type, "component");
  assert.equal(component.vendorId, "vendor-example");
  assert.equal(component.systemUses[0].systemId, rootSystem.id);
  assert.equal(await readFile(join(root, "data", "components", `${child.id}.md`), "utf8"), "# Production platform\n\nExport the authoritative access report for the selected period.\n");
  await assert.rejects(readFile(join(root, "data", "systems", `${child.id}.md`), "utf8"), /ENOENT/);
  assert.equal((await validateWorkspace(root)).ok, true);
  const audit = migrated.resources.find(({ type }) => type === "audit");
  assert.deepEqual(audit.systemIds, [rootSystem.id]);
  assert.equal(audit.componentIds, undefined);
  assert.equal(audit.subserviceTreatments[0].rationale, "This Vendor is subject to the carve-out method for this engagement.");
  const auditReadiness = await assessAuditPreparation(root, { auditId: audit.id });
  assert.equal(auditReadiness.audit.id, audit.id);
  const packet = await prepareEvidencePacket(root, { auditId: audit.id });
  assert.equal(packet.dataModelVersion, "4");
  assert.ok(Array.isArray(packet.sourceComponents));
  assert.equal(packet.sourceSystems, undefined);
});

test("blocks an ambiguous v3 System until an explicit v4 decision is supplied", async (context) => {
  const root = await mkdtemp(`${tmpdir()}/filegrc-model-v4-ambiguous-`);
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "3");
  const loaded = await loadWorkspace(root);
  const rootSystem = loaded.resources.find(({ type }) => type === "system");
  await createResource(root, {
    ...rootSystem,
    id: "system-ambiguous-tool",
    title: "Ambiguous tool",
    systemKind: "tool",
    description: "The v3 facts do not establish whether this is a bounded System or a Component."
  });
  const preview = await planModelMigration(root, { targetModelVersion: "4" });
  assert.equal(preview.ready, false);
  assert.ok(preview.classifications.unsupported.some(({ resourceId, field }) => resourceId === "system-ambiguous-tool" && field === "type"));
  await assert.rejects(migrateModel(root, { targetModelVersion: "4" }), /needs review/);

  const decided = await planModelMigration(root, {
    targetModelVersion: "4",
    systemDecisions: {
      "system-ambiguous-tool": {
        kind: "component",
        systemUses: [{
          systemId: rootSystem.id,
          roles: ["supporting-operations"],
          rationale: "Supports relevant operations for the bounded production application."
        }]
      }
    }
  });
  assert.equal(decided.classifications.unsupported.some(({ resourceId, field }) => resourceId === "system-ambiguous-tool" && field === "type"), false);
});

test("migrates v4 active Documents to approved without inventing activation facts", async (context) => {
  const root = await mkdtemp(`${tmpdir()}/filegrc-model-v5-migration-`);
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "4");
  const before = await loadWorkspace(root);
  const activeDocument = before.resources.find(({ type, status }) => type === "document" && status === "active");

  const preview = await planModelMigration(root, { targetModelVersion: "5" });
  assert.equal(preview.ready, true, preview.classifications.unsupported.map(({ message }) => message).join("\n"));
  assert.equal(preview.sourceModelVersion, "4");
  assert.equal(preview.targetModelVersion, "5");
  assert.ok(preview.migrationReport.resetDocumentIds.includes(activeDocument.id));
  const documentDiff = preview.fileDiff.update.find(({ id }) => id === activeDocument.id);
  assert.equal(documentDiff.after.status, "approved");
  assert.equal(documentDiff.after.workflowScope, "program");
  assert.equal(documentDiff.after.approvedOn, activeDocument.approvedOn);
  assert.deepEqual(documentDiff.after.approvedContentRevisions, activeDocument.approvedContentRevisions);
  assert.equal(documentDiff.after.proposedEffectiveOn, activeDocument.effectiveOn);
  assert.equal(documentDiff.after.effectiveOn, undefined);
  assert.equal(documentDiff.after.activatedOn, undefined);
  assert.equal(documentDiff.after.activatedContentRevisions, undefined);
  assert.ok(preview.classifications.reviewRequired.some(({ resourceId }) => resourceId === activeDocument.id));

  const result = await migrateModel(root, { targetModelVersion: "5" });
  assert.equal(result.applied, true);
  const migrated = await loadWorkspace(root);
  assert.equal(migrated.workspace.dataModelVersion, "5");
  const document = migrated.resources.find(({ id }) => id === activeDocument.id);
  assert.equal(document.status, "approved");
  assert.equal(document.activatedOn, undefined);
  assert.equal(document.activatedContentRevisions, undefined);
  assert.equal(document.workflowScope, "program");
  assert.equal((await validateWorkspace(root)).ok, true);
});

test("preserves issued audit Documents without inventing a second historical event", async (context) => {
  const root = await mkdtemp(`${tmpdir()}/filegrc-model-v5-historical-document-`);
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "4");
  const loaded = await loadWorkspace(root);
  const documentEntry = loaded.entries.find(({ record }) => record.type === "document");
  const auditEntry = loaded.entries.find(({ record }) => record.type === "audit");
  const policyEntry = loaded.entries.find(({ record }) => record.type === "policy");
  const obligationEntries = loaded.entries.filter(({ record }) => record.type === "obligation");
  const document = {
    ...documentEntry.record,
    documentKind: "soc2-management-assertion"
  };
  const audit = {
    ...auditEntry.record,
    status: "issued",
    supplementalDocumentIds: [document.id]
  };
  const policy = {
    ...policyEntry.record,
    relatedDocumentIds: (policyEntry.record.relatedDocumentIds || []).filter((id) => id !== document.id)
  };
  await writeJson(documentEntry.path, document);
  await writeJson(auditEntry.path, audit);
  await writeJson(policyEntry.path, policy);
  for (const entry of obligationEntries) {
    await writeJson(entry.path, {
      ...entry.record,
      scopeResourceIds: (entry.record.scopeResourceIds || []).filter((id) => id !== document.id),
      ...(entry.record.templateResourceId === document.id ? { templateResourceId: undefined } : {})
    });
  }

  const preview = await planModelMigration(root, { targetModelVersion: "5" });
  const migrated = preview.fileDiff.update.find(({ id }) => id === document.id).after;
  assert.equal(migrated.workflowScope, "engagement");
  assert.equal(migrated.status, "active");
  assert.equal(migrated.activationBasis, "legacy-v4");
  assert.equal(migrated.effectiveOn, document.effectiveOn);
  assert.equal(migrated.activatedOn, undefined);
  assert.equal(migrated.activatedByIds, undefined);
  assert.equal(migrated.activatedContentRevisions, undefined);
  assert.ok(preview.migrationReport.legacyDocumentIds.includes(document.id));
});

test("requires an explicit v5 workflow scope for a Document used by both the program and an Audit", async (context) => {
  const root = await mkdtemp(`${tmpdir()}/filegrc-model-v5-document-scope-`);
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "4");
  const loaded = await loadWorkspace(root);
  const document = loaded.resources.find(({ type }) => type === "document");
  const auditEntry = loaded.entries.find(({ record }) => record.type === "audit");
  const policyEntry = loaded.entries.find(({ record }) => record.type === "policy");
  await writeJson(auditEntry.path, {
    ...auditEntry.record,
    managementAssertionDocumentId: document.id
  });
  await writeJson(policyEntry.path, {
    ...policyEntry.record,
    relatedDocumentIds: [...new Set([...(policyEntry.record.relatedDocumentIds || []), document.id])]
  });

  const ambiguous = await planModelMigration(root, { targetModelVersion: "5" });
  assert.equal(ambiguous.ready, false);
  assert.ok(ambiguous.classifications.unsupported.some(({ resourceId, field }) => (
    resourceId === document.id && field === "workflowScope"
  )));

  const decided = await planModelMigration(root, {
    targetModelVersion: "5",
    documentScopes: { [document.id]: "engagement" }
  });
  assert.equal(decided.classifications.unsupported.some(({ resourceId, field }) => (
    resourceId === document.id && field === "workflowScope"
  )), false);
  assert.equal(decided.fileDiff.update.find(({ id }) => id === document.id).after.workflowScope, "engagement");
});

test("keeps current migration help aligned with all supported model versions", async () => {
  const { stdout } = await execute(process.execPath, [cli, "migrate", "--help"]);
  assert.match(stdout, /--to-model <2\|3\|4\|5\|6\|7>/);
  assert.match(stdout, /documentScopes/);
  assert.match(stdout, /model v5/i);
});

test("migrates v5 Training into separate approval, activation, and Obligation scheduling", async (context) => {
  const root = await mkdtemp(`${tmpdir()}/filegrc-model-v6-training-`);
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "5");
  const loaded = await loadWorkspace(root);
  const entry = loaded.entries.find(({ record }) => record.type === "training");
  await writeJson(entry.path, {
    ...entry.record,
    approvedByIds: ["person-independent-approver-example"],
    approvedOn: "2026-06-30",
    effectiveOn: "2026-06-30",
    assignmentTrigger: "onboarding",
    completionWindowDays: 30
  });

  const preview = await planModelMigration(root, { targetModelVersion: "6" });
  assert.equal(preview.ready, true, preview.classifications.unsupported.map(({ message }) => message).join("\n"));
  const migrated = preview.fileDiff.update.find(({ id }) => id === entry.record.id).after;
  assert.deepEqual(migrated.approverIds, ["person-independent-approver-example"]);
  assert.deepEqual(migrated.approvedContentRevisions, entry.record.effectiveContentRevisions);
  assert.equal(migrated.activationBasis, "legacy-v5");
  assert.equal(migrated.assignmentTrigger, undefined);
  assert.equal(migrated.completionWindowDays, undefined);
  assert.ok(preview.classifications.reviewRequired.some(({ field }) => field === "assignmentSchedule"));

  const result = await migrateModel(root, { targetModelVersion: "6" });
  assert.equal(result.applied, true);
  const current = await loadWorkspace(root);
  assert.equal(current.workspace.dataModelVersion, "6");
  assert.equal(current.resources.find(({ id }) => id === entry.record.id).activationBasis, "legacy-v5");
  assert.equal((await validateWorkspace(root)).ok, true);
  const workflow = await assessWorkflow(root, { asOf: "2026-06-30" });
  assert.equal(workflow.findings.some(({ key, message }) => (
    key === `record.training.${entry.record.id}.finalize`
    && message.includes("activatedContentRevisions")
  )), false);
});

test("keeps migration mechanics out of model v7 compliance entities", async (context) => {
  const root = await mkdtemp(`${tmpdir()}/filegrc-model-v7-record-purity-`);
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "6");
  const loaded = await loadWorkspace(root);
  const historical = [loaded.entries.find(({ record }) => record.type === "training")];
  assert.equal(historical.every(Boolean), true);
  for (const entry of historical) {
    const record = {
      ...entry.record,
      status: "active",
      activationBasis: "legacy-v5",
      extensions: {
        ...(entry.record.extensions || {}),
        "filegrc.migration": { v3: { assignmentTrigger: "onboarding" } }
      }
    };
    for (const field of ["activatedByIds", "activatedOn", "activatedContentRevisions"]) delete record[field];
    await writeJson(entry.path, record);
  }
  const informationType = loaded.entries.find(({ record }) => record.type === "information-type");
  await writeJson(informationType.path, {
    ...informationType.record,
    description: `Information category migrated from the v3 dataTypes value "${informationType.record.title}".`
  });
  const reviewedControl = loaded.entries.find(({ record }) => record.type === "control");
  await writeJson(reviewedControl.path, {
    ...reviewedControl.record,
    applicabilityReview: {
      decision: "applicable",
      rationale: "Reviewed against the prior workspace scope.",
      reviewedByIds: ["person-independent-approver-example"],
      reviewedOn: "2026-08-21",
      scopeRevision: "legacy-workspace-revision"
    }
  });

  const preview = await planModelMigration(root, { targetModelVersion: "7" });
  assert.equal(preview.ready, true, preview.classifications.unsupported.map(({ message }) => message).join("\n"));
  assertPureMigrationNarratives(preview);
  assert.deepEqual(
    preview.fileDiff.update.filter(({ type }) => ["document", "training"].includes(type)).map(({ after }) => after.activationBasis),
    [undefined]
  );
  assert.deepEqual(preview.migrationReport.historicalActivationIds, []);
  assert.deepEqual(preview.migrationReport.trainingReactivation, [{
    resourceId: historical[0].record.id,
    priorEffectiveOn: historical[0].record.effectiveOn
  }]);
  assert.ok(preview.migrationReport.purifiedNarrativeIds.includes(informationType.record.id));
  assert.deepEqual(preview.migrationReport.removedMigrationExtensions, [{
    resourceId: historical[0].record.id,
    details: { v3: { assignmentTrigger: "onboarding" } }
  }]);
  const migratedTraining = preview.fileDiff.update.find(({ id }) => id === historical[0].record.id).after;
  assert.equal(migratedTraining.status, "approved");
  assert.equal(migratedTraining.effectiveOn, undefined);
  assert.equal(migratedTraining.extensions?.["filegrc.migration"], undefined);
  assert.equal(
    preview.fileDiff.update.find(({ id }) => id === informationType.record.id).after.description,
    `Information handled by in-scope Systems or Components under the "${informationType.record.title}" category.`
  );

  const result = await migrateModel(root, { targetModelVersion: "7" });
  assert.equal(result.applied, true);
  const current = await loadWorkspace(root);
  assert.equal(current.workspace.dataModelVersion, "7");
  assert.equal(current.resources.some(({ activationBasis }) => /^legacy-v/.test(activationBasis || "")), false);
  const migratedProgram = current.resources.find(({ type }) => type === "program");
  const migratedControl = current.resources.find(({ id }) => id === reviewedControl.record.id);
  assert.equal(applicabilityReviewIsCurrent(
    migratedControl.applicabilityReview,
    migratedControl,
    migratedProgram,
    current.resources,
    current.model
  ), false);
  assert.equal((await validateWorkspace(root)).ok, true);
});

test("preserves closed Training lifecycle status while removing its model-version activation label", async (context) => {
  const root = await mkdtemp(`${tmpdir()}/filegrc-model-v7-closed-training-`);
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "6");
  const loaded = await loadWorkspace(root);
  const entry = loaded.entries.find(({ record }) => record.type === "training");
  await writeJson(entry.path, {
    ...entry.record,
    status: "superseded",
    activationBasis: "legacy-v5",
    statusTransition: {
      changedByIds: ["person-example"],
      changedOn: "2026-08-21",
      reason: "Replaced by updated Training."
    }
  });

  const preview = await planModelMigration(root, { targetModelVersion: "7" });
  assert.equal(preview.ready, true, preview.classifications.unsupported.map(({ message }) => message).join("\n"));
  const migrated = preview.fileDiff.update.find(({ id }) => id === entry.record.id).after;
  assert.equal(migrated.status, "superseded");
  assert.deepEqual(migrated.statusTransition, {
    changedByIds: ["person-example"],
    changedOn: "2026-08-21",
    reason: "Replaced by updated Training."
  });
  assert.equal(migrated.activationBasis, undefined);
  assert.ok(preview.migrationReport.preservedTrainingHistoryIds.includes(entry.record.id));
});
