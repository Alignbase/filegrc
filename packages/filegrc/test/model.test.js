import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { generateModelDocumentation, loadModel } from "../src/index.js";

test("v1 model exposes the complete resource registry", () => {
  const model = loadModel("1");
  assert.equal(model.modelVersion, "1");
  assert.equal(Object.keys(model.resources).length, 40);
  for (const type of ["workspace", "renderer-settings", "control", "meeting", "risk", "attestation", "evidence", "obligation-event", "audit"]) {
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
  assert.equal(model.recordContent.field, "notesPath");
  assert.equal(model.recordContent.label, "Record");
  assert.equal(model.recordContent.defaultResourceTypes.length, 15);
  for (const type of model.recordContent.defaultResourceTypes) {
    const resource = model.resources[type];
    assert.ok(resource, `${type} Record Markdown type exists`);
    assert.equal(Object.values(resource.fields ?? {}).some((field) => field.content), false, `${type} does not duplicate dedicated Markdown`);
  }
});

test("v2 model uses implicit companion Markdown without path fields", () => {
  const model = loadModel("2");
  assert.equal(model.modelVersion, "2");
  assert.equal(model.markdownStorage, "companion");
  assert.equal(model.recordContent.slot, "record");
  assert.equal(model.commonFields.notesPath, undefined);
  for (const resource of Object.values(model.resources)) {
    assert.equal(Object.values(resource.fields ?? {}).some((field) => field.content), false);
    assert.equal((resource.required ?? []).some((name) => name.endsWith("Path")), false);
  }
  assert.deepEqual(model.resources.policy.markdown, {
    content: { label: "Policy", primary: true, required: true }
  });
  assert.equal(model.resources.evidence.oneOf[0].includes("$markdown:content"), true);
});

test("model versions cannot escape the packaged model registry", () => {
  assert.throws(() => loadModel("../../package"), /Unsupported data model version/);
  assert.throws(() => loadModel("/../../package"), /Unsupported data model version/);
});

test("generated model documentation matches the repository file", async () => {
  const actual = await readFile(new URL("../../../docs/data-model.md", import.meta.url), "utf8");
  assert.equal(actual, generateModelDocumentation(loadModel("2")));
});
