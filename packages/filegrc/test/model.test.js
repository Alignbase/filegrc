import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  generateModelDocumentation,
  loadModel,
  POLICY_EVENT_NAMES,
  PROGRAM_PATH,
  RESOURCE_INSTRUCTIONS
} from "../src/index.js";

test("v1 model exposes the complete resource registry", () => {
  const model = loadModel("1");
  assert.equal(model.modelVersion, "1");
  assert.equal(PROGRAM_PATH.length, 6);
  assert.equal(POLICY_EVENT_NAMES["person-started"], "New Worker");
  assert.deepEqual(PROGRAM_PATH.map(({ title }) => title), [
    "Define Scope",
    "Approve Policies",
    "Implement Controls",
    "Test Evidence Collection",
    "Operate the Program",
    "Audit"
  ]);
  assert.equal(Object.keys(model.resources).length, 42);
  for (const type of ["workspace", "renderer-settings", "person", "appointment", "control", "meeting", "risk", "attestation", "evidence", "obligation-event", "audit", "audit-population"]) {
    assert.ok(model.resources[type], `${type} is defined`);
  }
  for (const [type, resource] of Object.entries(model.resources)) {
    assert.ok(resource.description.length >= 60, `${type} explains its purpose`);
    assert.ok(resource.guidance.policyBasis.length >= 60, `${type} explains its policy basis`);
    assert.ok(resource.guidance.cadence.length >= 40, `${type} explains its timing`);
    assert.ok((resource.guidance.sourceResourceIds ?? []).every((id) => typeof id === "string"), `${type} source IDs are strings`);
    assert.ok((resource.guidance.obligationActivityTypes ?? []).every((activityType) => typeof activityType === "string"), `${type} activity types are strings`);
  }
  for (const type of PROGRAM_PATH.flatMap(({ resourceTypes, supportingResourceTypes = [] }) => [...resourceTypes, ...supportingResourceTypes])) {
    assert.ok(model.resources[type], `${type} in the program path exists`);
    assert.ok(RESOURCE_INSTRUCTIONS[type], `${type} has shared renderer and agent instructions`);
  }
  for (const stage of PROGRAM_PATH) {
    assert.deepEqual(
      stage.sections.flatMap(({ types }) => types),
      stage.resourceTypes,
      `${stage.title} uses the same resource order in the renderer and headless path`
    );
  }
  assert.equal(model.resources.person.titleLabel, "Name");
  assert.equal(model.resources.person.fields.jobTitle.label, "Organization job title");
  assert.deepEqual(model.commonFields.ownerIds.relation, ["person", "team", "appointment"]);
  assert.deepEqual(model.resources.appointment.required, ["status", "appointmentKind", "holderId", "scopeResourceIds"]);
  assert.deepEqual(model.resources.appointment.fields.startsOn.requiredWhen, { status: ["active", "ended"] });
  assert.deepEqual(model.resources.appointment.fields.endsOn.requiredWhen, { status: "ended" });
  assert.deepEqual(model.resources.team.fields.chairIds.relation, ["person", "appointment"]);
  for (const [type, field] of [
    ["document", "approverIds"],
    ["exception", "approvedByIds"],
    ["policy", "approverIds"],
    ["policy-review", "approverIds"],
    ["risk", "acceptedByIds"]
  ]) {
    assert.equal(
      model.resources[type].fields[field].relation.includes("appointment"),
      false,
      `${type}.${field} must identify the decision actor rather than an Appointment`
    );
  }
  assert.equal(model.resources.policy.titleLabel, undefined);
  assert.equal(model.resources.evidence.title, "External Evidence");
  assert.equal(model.resources.evidence.pluralTitle, "External Evidence");
  assert.equal(model.resources["obligation-event"].title, "Policy Event");
  assert.equal(model.resources["obligation-event"].pluralTitle, "Policy Events");
  assert.equal(model.recordContent.slot, "record");
  assert.equal(model.recordContent.label, "Record");
  assert.equal(model.recordContent.defaultResourceTypes.length, 17);
  assert.equal(model.auditReadiness.managementDocuments.length, 4);
  assert.equal(model.auditReadiness.populationTemplates.length, 10);
  assert.equal(new Set(model.auditReadiness.populationTemplates.map(({ kind }) => kind)).size, 10);
  assert.equal(new Set(model.auditReadiness.managementDocuments.map(({ field }) => field)).size, 4);
  for (const document of model.auditReadiness.managementDocuments) {
    assert.equal(model.resources.audit.fields[document.field].relation.includes("document"), true);
    assert.ok(document.engagementKinds.every((kind) => model.resources.audit.fields.auditKind.values.includes(kind)));
    assert.ok(document.minimumWords >= 75);
  }
  assert.ok(model.auditReadiness.populationTemplates.every((item) => item.sourceKind && item.timing && item.controlCodes.length));
  assert.ok(model.evidenceSourceFamilies.every((item) => item.id && item.sourceKinds.length && item.testEvidenceKind && item.testPrompt && item.timing));
  const managedEvidenceFamilies = model.evidenceSourceFamilies.filter((item) => item.collectionTestRequired === false);
  assert.deepEqual(
    managedEvidenceFamilies.map(({ id }) => id),
    [
      "training-acknowledgement",
      "vulnerability-management",
      "backup-recovery",
      "vendor-management",
      "exception-finding",
      "governance",
      "risk-management"
    ]
  );
  assert.ok(managedEvidenceFamilies.every((item) => item.operationRecordTypes.length));
  assert.deepEqual(model.resources.control.fields.evidenceSourceIds.requiredWhen, { status: "implemented" });
  assert.deepEqual(model.resources.control.fields.systemIds.requiredWhen, { status: "implemented" });
  assert.deepEqual(
    Object.entries(model.resources).flatMap(([type, resource]) => (
      Object.entries(resource.fields ?? {})
        .filter(([, field]) => field.legacy)
        .map(([name]) => `${type}.${name}`)
    )),
    [
      "person.teamIds",
      "system.commitmentIds",
      "requirement.controlIds",
      "control.commitmentIds",
      "control.riskIds",
      "policy.controlIds",
      "vendor.systemIds",
      "audit.controlTestIds",
      "audit.evidenceIds"
    ]
  );
  assert.equal(model.resources.commitment.fields.systemIds.legacy, undefined);
  assert.equal(model.resources.commitment.fields.controlIds.legacy, undefined);
  assert.equal(model.resources.control.fields.policyIds.legacy, undefined);
  assert.equal(model.resources.control.fields.requirementIds.legacy, undefined);
  assert.equal(model.resources.risk.fields.controlIds.legacy, undefined);
  assert.equal(model.resources.system.fields.vendorId.legacy, undefined);
  assert.equal(model.resources.evidence.fields.auditIds.legacy, undefined);
  assert.equal(model.resources["control-test"].fields.auditId.legacy, undefined);
  assert.deepEqual(model.resources.control.markdown.record.requiredWhen, { status: "implemented" });
  assert.deepEqual(model.resources.policy.fields.approverIds.requiredWhen, {
    status: ["in-review", "approved", "active"]
  });
  assert.deepEqual(model.resources.document.fields.approverIds.requiredWhen, {
    status: "active"
  });
  assert.equal(model.resources.control.fields.complementaryControlIds, undefined);
  assert.deepEqual(model.resources["complementary-control"].fields.relatedControlIds.relation, ["control"]);
  assert.ok(model.resources.workspace.fields.assuranceGoal.values.includes("soc-2-type-2"));
  assert.deepEqual(model.resources.evidence.fields.verifierIds.requiredWhen, { status: "verified" });
  assert.ok(model.resources.evidence.fields.status.values.includes("draft"));
  assert.deepEqual(model.resources.evidence.fields.source.requiredWhen.status, ["collected", "verified", "expired", "withdrawn"]);
  assert.deepEqual(model.resources.evidence.fields.sourceSystemId.requiredWhen, {
    evidenceKind: ["population-export", "test-export", "test-capture"],
    status: ["collected", "verified", "expired", "withdrawn"]
  });
  assert.deepEqual(model.resources["obligation-event"].fields.completedOn.requiredWhen, { status: "complete" });
  assert.equal(model.resources["renderer-settings"].fields.completedStagePageIds.items, "string");
  assert.deepEqual(model.resources["renderer-settings"].fields.repositoryMode.values, ["trunk", "manual"]);
  assert.equal(model.resources["renderer-settings"].fields.authoritativeBranch.format, "git-name");
  assert.equal(model.resources["renderer-settings"].fields.repositoryRemote.format, "git-name");
  assert.match(model.resources.finding.description, /Keep observations and report details in the source record’s Markdown/);
  assert.match(model.resources.finding.description, /control test, review, risk assessment, security test, incident review, management meeting, or audit/);
  assert.deepEqual(model.resources.finding.fields.dueOn.requiredWhen.status, ["open", "remediating", "resolved"]);
  assert.deepEqual(model.resources.finding.fields.verifiedByIds.requiredWhen, { status: "closed" });
  assert.deepEqual(model.resources["action-item"].oneOf[0], {
    fields: ["dueOn", "dueWindowEndAt"],
    when: { status: ["open", "in-progress", "blocked"] }
  });
  for (const resource of Object.values(model.resources)) {
    assert.equal(resource.fields?.findingIds, undefined);
    assert.equal(resource.fields?.actionItemIds, undefined);
  }
  for (const type of model.recordContent.defaultResourceTypes) {
    const resource = model.resources[type];
    assert.ok(resource, `${type} Record Markdown type exists`);
    assert.equal(Object.keys(resource.fields ?? {}).some((name) => name.endsWith("Path")), false, `${type} does not store a Markdown path`);
  }
  assert.equal(model.commonFields.notesPath, undefined);
  for (const resource of Object.values(model.resources)) {
    assert.equal((resource.required ?? []).some((name) => name.endsWith("Path")), false);
  }
  assert.deepEqual(model.resources.policy.markdown, {
    content: { label: "Policy", primary: true, required: true }
  });
  assert.equal(model.resources.evidence.oneOf[0].fields.includes("$markdown:content"), true);
  assert.ok(model.resources.evidence.oneOf[0].when.status.includes("verified"));
  for (const type of [
    "renderer-settings",
    "service-account",
    "team",
    "document",
    "obligation",
    "obligation-event",
    "complementary-control",
    "control-test",
    "finding",
    "exception",
    "action-item",
    "vulnerability",
    "incident",
    "data-request",
    "audit-request"
  ]) {
    assert.match(model.resources[type].description, /not required for (?:a )?SOC 2/, `${type} states that it is optional`);
  }
});

test("model versions cannot escape the packaged model registry", () => {
  assert.throws(() => loadModel("../../package"), /Unsupported data model version/);
  assert.throws(() => loadModel("/../../package"), /Unsupported data model version/);
});

test("generated model documentation matches the repository file", async () => {
  const actual = await readFile(new URL("../../../docs/data-model.md", import.meta.url), "utf8");
  assert.equal(actual, generateModelDocumentation(loadModel("1")));
});
