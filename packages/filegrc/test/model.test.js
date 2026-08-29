import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  generateModelDocumentation,
  loadModel,
  MODEL_CAPABILITY_VERSIONS,
  modelSupports,
  PROGRAM_PATH,
  RESOURCE_INSTRUCTIONS
} from "../src/index.js";

test("active model exposes the complete resource registry", () => {
  const model = loadModel();
  assert.equal(model.modelVersion, "10");
  assert.equal(PROGRAM_PATH.length, 5);
  assert.equal(model.policyEvents["person-started"].title, "New Worker");
  assert.deepEqual(model.policyEvents["person-started"].subjectRules, [
    { resourceType: "person", minimum: 1, maximum: 1 }
  ]);
  assert.deepEqual(model.obligationActivities["access-removal"].recurrenceModes, ["event"]);
  assert.ok(model.obligationActivities["vendor-review"].scopeResourceTypes.includes("vendor"));
  assert.deepEqual(PROGRAM_PATH.map(({ title }) => title), [
    "Define Scope",
    "Approve Policies",
    "Implement Controls",
    "Operate the Program",
    "Audit"
  ]);
  assert.equal(Object.keys(model.resources).length, 55);
  assert.deepEqual(Object.keys(model.collectionReviews), ["person", "framework", "vendor", "system", "complementary-control", "component", "classification", "information-type", "retention-schedule-item"]);
  assert.equal(model.resources["collection-review"].fields.resourceType.registry, "collectionReviews");
  assert.deepEqual(
    model.resources["collection-review"].fields.populationResourceIds.relation,
    Object.keys(model.collectionReviews)
  );
  for (const type of ["person", "framework", "vendor", "system", "complementary-control", "component", "classification", "information-type", "retention-schedule-item"]) {
    assert.ok(model.collectionReviews[type].description.length >= 60);
    assert.ok(model.collectionReviews[type].reviewPoints.length >= 2);
    assert.ok(model.collectionReviews[type].reviewPoints.length <= 3);
  }
  for (const type of [
    "requirement",
    "commitment",
    "complementary-control",
    "control",
    "control-test",
    "policy-review",
    "risk-assessment",
    "vendor-review",
    "access-review",
    "vulnerability-scan",
    "backup-test",
    "penetration-test",
    "source-coverage",
    "control-activity"
  ]) {
    assert.equal(model.resources[type].guidance.reviewPoints.length, 3);
  }
  for (const type of ["workspace", "renderer-settings", "person", "appointment", "control", "meeting", "risk", "attestation", "evidence", "obligation-event", "audit", "audit-population"]) {
    assert.ok(model.resources[type], `${type} is defined`);
  }
  for (const [type, resource] of Object.entries(model.resources)) {
    assert.ok(resource.description.length >= 60, `${type} explains its purpose`);
    assert.ok(resource.guidance.policyBasis.length >= 60, `${type} explains its policy basis`);
    assert.ok(resource.guidance.cadence.length >= 40, `${type} explains its timing`);
    assert.ok((resource.guidance.sourceResourceIds ?? []).every((id) => typeof id === "string"), `${type} source IDs are strings`);
    assert.ok((resource.guidance.obligationActivityTypes ?? []).every((activityType) => typeof activityType === "string"), `${type} activity types are strings`);
    for (const fieldName of [...(resource.listFields ?? []), ...(resource.formFields ?? [])]) {
      assert.ok(
        fieldName === "title" || fieldName.startsWith("$") || model.commonFields[fieldName] || resource.fields?.[fieldName],
        `${type}.${fieldName} is a valid list or form field`
      );
    }
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
  assert.equal(model.resources["reporting-route-set"].title, "Reporting channel set");
  assert.match(model.resources["reporting-route-set"].description, /normal and fallback ways people send a report/);
  assert.match(model.resources["reporting-route-set"].description, /email address and a hotline/);
  assert.equal(model.resources["reporting-route-set"].fields.primaryLane.label, "Normal reporting channel");
  assert.equal(model.resources["reporting-route-set"].fields.alternateLane.label, "Fallback reporting channel");
  assert.equal(model.commonFields.ownerIds, undefined);
  assert.deepEqual(model.relationGroups["accountable-party"], ["person", "team", "appointment"]);
  assert.deepEqual(model.resources.control.fields.ownerIds.relation, ["person", "team", "appointment"]);
  assert.equal(model.commonFields.relatedResourceIds, undefined);
  assert.ok(Object.values(model.resources).every(({ fields = {} }) => (
    Object.values(fields).every((field) => !field.relation?.includes("*"))
  )));
  assert.ok(Object.values(model.resources).every(({ fields = {} }) => (
    Object.values(fields).every((field) => (
      field.type !== "object" || Boolean(field.objectType)
    ))
  )));
  assert.ok(["access-grant", "asset", "policy", "risk", "vendor"].every((type) => (
    model.relationGroups["completion-record"].includes(type)
  )));
  assert.deepEqual(model.resources.appointment.required, ["status", "appointmentKind", "scopeResourceIds"]);
  assert.deepEqual(model.resources.appointment.fields.holderId.requiredWhen, { status: ["active", "ended"] });
  assert.deepEqual(model.resources.component.listFields.slice(-2), ["systemUses", "evidenceSourceKinds"]);
  assert.equal(model.resources.control.listFields.at(-1), "evidenceSourceComponentIds");
  assert.deepEqual(model.resources.appointment.fields.startsOn.requiredWhen, { status: ["active", "ended"] });
  assert.deepEqual(model.resources.appointment.fields.endsOn.requiredWhen, { status: "ended" });
  assert.deepEqual(model.resources.team.fields.chairIds.relation, ["person", "appointment"]);
  for (const [type, field] of [
    ["document", "approverIds"],
    ["policy", "approverIds"],
    ["policy-review", "approverIds"]
  ]) {
    assert.equal(
      model.resources[type].fields[field].relation.includes("appointment"),
      false,
      `${type}.${field} must identify the decision actor rather than an Appointment`
    );
  }
  assert.deepEqual(model.resources.appointment.fields.appointedByIds.relation, ["person"]);
  assert.deepEqual(
    model.objectTypes["exception-approval"].properties.approvedByIds.relation,
    ["person"]
  );
  assert.deepEqual(
    model.objectTypes["risk-acceptance"].properties.acceptedByIds.relation,
    ["person"]
  );
  assert.equal(model.resources["access-grant"].fields.subjectKind, undefined);
  assert.equal(model.resources.risk.fields.acceptance.objectType, "risk-acceptance");
  assert.equal(model.resources.exception.fields.approval.objectType, "exception-approval");
  assert.equal(model.resources.exception.fields.resolution.objectType, "exception-resolution");
  assert.deepEqual(model.resources.attestation.fields.status.values, ["pending", "completed", "waived"]);
  assert.equal(model.resources.attestation.fields.attestedCommit, undefined);
  assert.equal(model.resources.audit.fields.auditor, undefined);
  assert.equal(model.resources.audit.fields.assessmentCoverage, undefined);
  assert.deepEqual(model.resources["policy-review"].fields.approverIds.relation, ["person"]);
  assert.deepEqual(model.resources["audit-request"].fields.acceptedByIds.relation, ["person"]);
  assert.deepEqual(model.resources["data-request"].fields.decidedByIds.relation, ["person"]);
  assert.equal(model.resources.finding.fields.exceptionId.requiredWhen.status, "accepted");
  assert.equal(model.resources.vulnerability.fields.acceptedByIds, undefined);
  assert.equal(model.resources.vulnerability.fields.acceptanceExpiresOn, undefined);
  assert.equal(model.resources.vulnerability.fields.exceptionId.requiredWhen.status, "risk-accepted");
  for (const type of [
    "obligation-event", "control-test", "action-item", "policy-review", "meeting",
    "risk-assessment", "vendor-review", "access-review", "exercise", "backup-test",
    "penetration-test", "data-request"
  ]) {
    assert.equal(model.resources[type].fields.cancellation.objectType, "cancellation");
  }
  for (const type of [
    "person", "appointment", "service-account", "team", "program", "system", "component", "classification", "information-type", "asset", "document",
    "obligation", "framework", "commitment", "complementary-control", "control", "policy",
    "training", "risk", "vendor"
  ]) {
    assert.equal(model.resources[type].fields.statusTransition.objectType, "status-transition");
  }
  assert.equal(model.relationshipConstraints.acyclic.some((constraint) => (
    constraint.resourceType === "system" && constraint.field === "parentSystemId"
  )), false);
  for (const constraint of model.relationshipConstraints.acyclic) {
    assert.ok(model.resources[constraint.resourceType]?.fields[constraint.field], `${constraint.resourceType}.${constraint.field}`);
  }
  for (const constraint of model.relationshipConstraints.unique) {
    for (const field of constraint.fields) {
      assert.ok(model.resources[constraint.resourceType]?.fields[field], `${constraint.resourceType}.${field}`);
    }
  }
  for (const [resourceType, field] of [
    ["person", "managerId"],
    ["requirement", "parentRequirementId"],
    ["commitment", "supersedesId"]
  ]) {
    assert.ok(model.relationshipConstraints.acyclic.some((constraint) => (
      constraint.resourceType === resourceType && constraint.field === field
    )));
  }
  assert.ok(model.relationshipConstraints.unique.some((constraint) => (
    constraint.resourceType === "access-grant"
  )));
  assert.equal(model.resources.policy.titleLabel, undefined);
  assert.equal(model.resources.evidence.title, "Evidence Artifact");
  assert.equal(model.resources.evidence.pluralTitle, "Evidence Artifacts");
  assert.ok(model.resources.evidence.fields.artifactKind.values.includes("population-export"));
  assert.ok(model.resources.evidence.fields.sourceKind.values.includes("rendered-page"));
  assert.equal(model.resources.evidence.fields.status.values.includes("expired"), false);
  assert.equal(model.resources.evidence.fields.withdrawal.objectType, "withdrawal");
  assert.equal(model.resources.evidence.fields.evidenceKind, undefined);
  assert.equal(model.resources["action-item"].fields.dueOn, undefined);
  assert.equal(model.resources["action-item"].fields.completionWindow.objectType, "completion-window");
  assert.equal(model.resources["obligation-event"].title, "Policy Event");
  assert.equal(model.resources["obligation-event"].pluralTitle, "Policy Events");
  assert.equal(model.resources.system.fields.inScope, undefined);
  assert.equal(model.resources.workspace.fields.repositoryUrl, undefined);
  assert.equal(model.resources.program.fields.candidateCoverage.objectType, "coverage-period");
  assert.equal(model.resources.workspace.fields.candidateCoverage, undefined);
  assert.deepEqual(model.resources.person.fields.status.values, ["active", "inactive"]);
  assert.deepEqual(model.resources.team.fields.status.values, ["planned", "active", "inactive"]);
  assert.deepEqual(model.resources.person.fields.affiliation.values, ["internal", "external"]);
  assert.equal(model.resources.obligation.fields.completionResourceTypes, undefined);
  assert.equal(model.resources.obligation.fields.activityType.registry, "obligationActivities");
  assert.ok(model.resources.obligation.formFields.includes("window"));
  assert.equal(model.resources.obligation.fields.recurrence.objectType, "recurrence");
  assert.equal(model.objectTypes.recurrence.properties.eventType.type, "string");
  assert.equal(model.objectTypes.recurrence.properties.eventType.format, "id");
  assert.ok(model.resources.obligation.fields.activityType.registry === "obligationActivities");
  assert.ok(model.obligationActivities.custom);
  assert.deepEqual(model.objectTypes["obligation-window"].required, ["precision", "dueAfter"]);
  assert.deepEqual(model.resources["vendor-review"].fields.status.values, ["planned", "in-progress", "complete", "canceled"]);
  assert.deepEqual(model.resources["vendor-review"].fields.decision.values, ["approved", "conditional", "rejected"]);
  assert.deepEqual(model.resources["backup-test"].fields.status.values, ["planned", "running", "complete", "canceled"]);
  assert.equal(model.resources["backup-test"].fields.completedOn, undefined);
  assert.ok(model.resources["backup-test"].fields.completedAt);
  for (const type of ["control-test", "policy-review", "risk-assessment", "vendor-review", "access-review", "backup-test", "penetration-test"]) {
    assert.ok(model.resources[type].formFields.includes("scheduledFor"));
  }
  for (const type of ["system", "asset", "document", "evidence", "vendor", "incident"]) {
    assert.ok(model.resources[type].fields.classificationId);
    assert.ok(model.resources[type].listFields.includes("classificationId"));
    assert.ok(model.resources[type].formFields.includes("classificationId"));
    assert.equal(model.resources[type].fields.dataClassification, undefined);
    assert.equal(model.resources[type].fields.classification, undefined);
  }
  assert.equal(model.resources.system.listFields.includes("inScope"), false);
  for (const type of ["evidence", "control-test", "policy-review", "vendor-review", "access-review", "penetration-test", "audit", "audit-population", "audit-request"]) {
    assert.ok(model.resources[type].formFields.includes("coverage"));
  }
  assert.equal(model.recordContent.slot, "record");
  assert.equal(model.recordContent.label, "Record");
  assert.equal(model.recordContent.defaultResourceTypes.length, 22);
  assert.equal(model.auditReadiness.managementDocuments.length, 4);
  assert.equal(model.auditReadiness.populationTemplates.length, 10);
  assert.deepEqual(model.resources["audit-population"].fields.status.values, ["planned", "reconciled", "not-applicable", "superseded"]);
  assert.equal(new Set(model.auditReadiness.populationTemplates.map(({ kind }) => kind)).size, 10);
  assert.equal(new Set(model.auditReadiness.managementDocuments.map(({ field }) => field)).size, 4);
  for (const document of model.auditReadiness.managementDocuments) {
    assert.equal(model.resources.audit.fields[document.field].relation.includes("document"), true);
    assert.ok(document.engagementKinds.every((kind) => model.resources.audit.fields.auditKind.values.includes(kind)));
    assert.ok(document.minimumWords >= 75);
  }
  assert.ok(model.auditReadiness.populationTemplates.every((item) => item.sourceKind && item.timing && item.controlCodes.length));
  assert.ok(model.evidenceSourceFamilies.every((item) => item.id && item.sourceKinds.length && item.evidenceForm && item.evidencePrompt && item.timing));
  assert.ok(model.resources.component.formFields.includes("evidenceSourceKinds"));
  assert.ok(model.resources.component.formFields.includes("evidenceOwnerIds"));
  const managedEvidenceFamilies = model.evidenceSourceFamilies.filter((item) => item.filegrcManaged === true);
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
  assert.deepEqual(model.resources.control.fields.evidenceSourceComponentIds.requiredWhen, { status: "implemented" });
  assert.deepEqual(model.resources.control.fields.systemIds.requiredWhen, { status: "implemented" });
  for (const [type, field] of [
    ["person", "role"],
    ["person", "teamIds"],
    ["system", "commitmentIds"],
    ["evidence", "collectionTestFamilyId"],
    ["evidence", "collectionTestPrompt"],
    ["requirement", "controlIds"],
    ["control", "commitmentIds"],
    ["control", "riskIds"],
    ["policy", "controlIds"],
    ["vendor", "systemIds"],
    ["audit", "controlTestIds"],
    ["audit", "evidenceIds"]
  ]) {
    assert.equal(model.resources[type].fields[field], undefined, `${type}.${field} was removed from v2`);
  }
  assert.deepEqual(model.resources.control.markdown.record.requiredWhen, { status: "implemented" });
  assert.deepEqual(model.resources.policy.fields.approverIds.requiredWhen, {
    status: ["in-review", "approved", "active", "superseded", "retired"]
  });
  assert.deepEqual(model.resources.document.fields.approverIds.requiredWhen, {
    status: ["approved", "active", "superseded", "retired"]
  });
  assert.deepEqual(model.resources.document.fields.status.values, ["draft", "approved", "active", "superseded", "retired"]);
  assert.deepEqual(model.resources.document.fields.approvedContentRevisions.requiredWhen, {
    status: ["approved", "active", "superseded", "retired"]
  });
  assert.ok(model.resources.document.required.includes("workflowScope"));
  assert.deepEqual(model.resources.document.fields.workflowScope.values, ["program", "engagement"]);
  assert.deepEqual(model.resources.document.fields.activationBasis.values, ["recorded", "historical"]);
  assert.deepEqual(model.resources.training.fields.activationBasis.values, ["recorded"]);
  assert.deepEqual(model.resources.document.fields.activatedContentRevisions.requiredWhen, { activationBasis: "recorded" });
  assert.deepEqual(model.resources.document.fields.activatedOn.requiredWhen, { activationBasis: "recorded" });
  assert.deepEqual(model.resources.document.fields.activatedByIds.requiredWhen, { activationBasis: "recorded" });
  assert.deepEqual(model.resources.policy.fields.approvedContentRevisions.requiredWhen, {
    status: ["approved", "active", "superseded", "retired"]
  });
  assert.equal(model.resources["vendor-review"].fields.vendorIds, undefined);
  assert.deepEqual(model.resources["vendor-review"].fields.vendorId.relation, ["vendor"]);
  assert.equal(model.resources["access-review"].fields.reviewDate, undefined);
  assert.deepEqual(model.resources["access-review"].fields.completedOn.requiredWhen, { status: "complete" });
  assert.equal(model.resources.control.fields.complementaryControlIds, undefined);
  assert.deepEqual(model.resources["complementary-control"].fields.relatedControlIds.relation, ["control"]);
  assert.ok(model.resources.program.fields.assuranceGoal.values.includes("soc-2-type-2"));
  assert.deepEqual(model.resources.evidence.fields.verifierIds.requiredWhen, { status: "verified" });
  assert.ok(model.resources.evidence.fields.status.values.includes("draft"));
  assert.deepEqual(model.resources.evidence.fields.sourceDescription.requiredWhen.status, ["collected", "verified", "withdrawn"]);
  assert.deepEqual(model.resources.evidence.fields.sourceComponentId.requiredWhen, {
    sourceKind: "component",
    status: ["collected", "verified", "withdrawn"]
  });
  assert.equal(model.resources.evidence.fields.sourceComponentId.showWhenInactive, true);
  assert.deepEqual(model.resources["obligation-event"].fields.completedOn.requiredWhen, { status: "complete" });
  assert.equal(model.resources["renderer-settings"].fields.completedStagePageIds, undefined);
  assert.deepEqual(model.resources["renderer-settings"].fields.repositoryMode.values, ["trunk", "manual"]);
  assert.deepEqual(model.resources["renderer-settings"].required, [
    "showOnboarding",
    "repositoryMode",
    "authoritativeBranch",
    "repositoryRemote"
  ]);
  assert.equal(model.resources.workspace.fields.dataModelVersion.const, "10");
  assert.ok(model.resources["source-coverage"]);
  assert.ok(model.resources["control-activity"]);
  assert.equal(model.obligationActivities["inventory-review"].completionType, "control-activity");
  assert.deepEqual(Object.keys(model.appointmentTemplates), [
    "policy-owner",
    "independent-policy-reviewer"
  ]);
  assert.equal(model.appointmentTemplates["independent-policy-reviewer"].requiredness, "core");
  assert.equal(loadModel("2").resources["source-coverage"], undefined);
  assert.equal(model.resources["renderer-settings"].fields.authoritativeBranch.format, "git-name");
  assert.equal(model.resources["renderer-settings"].fields.repositoryRemote.format, "git-name");
  assert.match(model.resources.finding.description, /Keep observations and report details in the source record’s Markdown/);
  assert.match(model.resources.finding.description, /control test, review, risk assessment, security test, incident review, management meeting, or audit/);
  assert.deepEqual(model.resources.finding.fields.dueOn.requiredWhen.status, ["open", "remediating", "resolved"]);
  assert.deepEqual(model.resources.finding.fields.verifiedByIds.requiredWhen, { status: "closed" });
  assert.deepEqual(model.resources["action-item"].fields.completionWindow.requiredWhen, {
    status: ["open", "in-progress", "blocked"]
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

test("uses named model capabilities at compatibility boundaries", () => {
  assert.equal(MODEL_CAPABILITY_VERSIONS["guided-workflow"], 3);
  assert.equal(MODEL_CAPABILITY_VERSIONS["program-scope"], 4);
  assert.equal(MODEL_CAPABILITY_VERSIONS["governed-document-activation"], 5);
  assert.equal(modelSupports(loadModel("4"), "program-scope"), true);
  assert.equal(modelSupports("4", "governed-document-activation"), false);
  assert.equal(modelSupports(loadModel("5"), "document-workflow-scope"), true);
  assert.throws(() => modelSupports("5", "unknown-capability"), /Unknown model capability/);
});

test("model versions cannot escape the packaged model registry", () => {
  const model = loadModel();
  assert.equal(Object.hasOwn(model, "extends"), false);
  assert.equal(Object.hasOwn(model, "removeFields"), false);
  assert.equal(Object.hasOwn(model.commonFields, "schemaVersion"), false);
  assert.throws(() => loadModel("1"), /migrate --to-model 2/);
  assert.throws(() => loadModel("../../package"), /Unsupported data model version/);
  assert.throws(() => loadModel("/../../package"), /Unsupported data model version/);
});

test("published model files remain byte-for-byte frozen", async () => {
  const expected = {
    1: "022329634da331277dbf1cc01bd44cc591b9628990e8736635044bf22a8912d3",
    2: "c0821f78856b8ffa68d41947909ef89414d01d52acfdcbbe5afc26d3db9a62ff",
    3: "afe51020e7e8b4efec8fe1501171ba55904a6f547d165e9b7fe7878ee19c4723",
    4: "24eaccc6eca25eb3fe5a127f0b7d464a01e466bf2e790278065d045ef7103e51",
    5: "11c00af08675f49a4163dccea5cb6ee48d701fd95bf35c5040817d48bd97fcaf",
    6: "d5ed8888b4526d9866c2355f3120c8bbd4e5ba18549b5d5280a6e33cdf9fdd2f",
    7: "ba3342bd08d62c163bdaac497af6377a2ad715ef30bf4f929ea3b6b59142dc78",
    8: "4513bf03b8b8040af87cf5a85d28267706c526f2da1d6d570d44b3ff82578df2",
    9: "9af966f140331e25e094950a1705082c978b7898e70071eb30e64d88788dcd08"
  };
  for (const [version, digest] of Object.entries(expected)) {
    const source = await readFile(new URL(`../model/v${version}.json`, import.meta.url));
    assert.equal(createHash("sha256").update(source).digest("hex"), digest, `model v${version}`);
  }
});

test("v4 penetration-testing guidance remains conditional and risk-based", () => {
  const guidance = loadModel("4").resources["penetration-test"].guidance;
  assert.match(guidance.policyBasis, /decide whether penetration testing is needed/);
  assert.match(guidance.cadence, /may conclude that no penetration test is required/);
  assert.doesNotMatch(`${guidance.policyBasis} ${guidance.cadence}`, /perform at least annually/i);
});

test("generated model documentation matches the repository file", async () => {
  const actual = await readFile(new URL("../../../docs/data-model.md", import.meta.url), "utf8");
  assert.equal(actual, generateModelDocumentation(loadModel()));
});
