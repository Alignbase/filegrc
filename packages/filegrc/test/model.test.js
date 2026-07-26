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
});

test("model versions cannot escape the packaged model registry", () => {
  assert.throws(() => loadModel("../../package"), /Unsupported data model version/);
  assert.throws(() => loadModel("/../../package"), /Unsupported data model version/);
});

test("generated model documentation matches the repository file", async () => {
  const actual = await readFile(new URL("../../../docs/data-model.md", import.meta.url), "utf8");
  assert.equal(actual, generateModelDocumentation(loadModel("1")));
});
