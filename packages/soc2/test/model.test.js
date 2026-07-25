import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { generateModelDocumentation, loadModel } from "../src/index.js";

test("v1 model exposes the complete resource registry", () => {
  const model = loadModel("1");
  assert.equal(model.modelVersion, "1");
  assert.equal(Object.keys(model.resources).length, 38);
  for (const type of ["workspace", "control", "meeting", "risk", "attestation", "evidence", "audit"]) {
    assert.ok(model.resources[type], `${type} is defined`);
  }
});

test("generated model documentation matches the repository file", async () => {
  const actual = await readFile(new URL("../../../docs/data-model.md", import.meta.url), "utf8");
  assert.equal(actual, generateModelDocumentation(loadModel("1")));
});
