import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { generateModelDocumentation, loadModel } from "../src/index.js";

test("v1 model exposes the complete resource registry", () => {
  const model = loadModel("1");
  assert.equal(model.modelVersion, "1");
  assert.equal(Object.keys(model.resources).length, 41);
  for (const type of ["workspace", "renderer-settings", "control", "meeting", "risk", "attestation", "evidence", "obligation-event", "audit", "audit-population"]) {
    assert.ok(model.resources[type], `${type} is defined`);
  }
  for (const [type, resource] of Object.entries(model.resources)) {
    assert.ok(resource.description.length >= 60, `${type} explains its purpose`);
    assert.ok(resource.guidance.policyBasis.length >= 60, `${type} explains its policy basis`);
    assert.ok(resource.guidance.cadence.length >= 40, `${type} explains its timing`);
    assert.ok((resource.guidance.sourceResourceIds ?? []).every((id) => typeof id === "string"), `${type} source IDs are strings`);
    assert.ok((resource.guidance.obligationActivityTypes ?? []).every((activityType) => typeof activityType === "string"), `${type} activity types are strings`);
  }
  assert.equal(model.resources.person.titleLabel, "Name");
  assert.equal(model.resources.policy.titleLabel, undefined);
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
  assert.ok(model.auditReadiness.externalEvidence.every((item) => item.id && item.sourceKinds.length && item.timing));
  assert.deepEqual(model.resources.evidence.fields.verifierIds.requiredWhen, { status: "verified" });
  assert.deepEqual(model.resources.evidence.fields.sourceSystemId.requiredWhen, { evidenceKind: "population-export" });
  assert.deepEqual(model.resources["obligation-event"].fields.completedOn.requiredWhen, { status: "complete" });
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
  assert.equal(model.resources.evidence.oneOf[0].includes("$markdown:content"), true);
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
