import assert from "node:assert/strict";
import test from "node:test";
import { loadModel } from "../model/index.js";
import { completionMatchesMember } from "../src/obligations.js";

const model = loadModel("13");
function fixture() {
  const records = [
    { id: "system-a", type: "system" },
    { id: "system-b", type: "system" },
    { id: "component-a", type: "component", systemUses: [{ systemId: "system-a" }] },
    { id: "component-b", type: "component", systemUses: [{ systemId: "system-b" }] },
    { id: "component-shared", type: "component", systemUses: [{ systemId: "system-a" }, { systemId: "system-b" }] },
    { id: "proof-a", type: "evidence", componentIds: ["component-shared"], systemIds: ["system-a"] }
  ];
  const byId = new Map(records.map((record) => [record.id, record]));
  const matches = (record, id) => completionMatchesMember(record, "componentIds", id, model, byId);
  return { byId, matches };
}

test("component-scoped operating results cover only their typed parent Systems", () => {
  const { matches, byId } = fixture();
  for (const type of ["vulnerability-scan", "backup-test", "exercise", "penetration-test", "evidence", "control-activity"]) {
    const field = type === "control-activity" ? "scopeResourceIds" : "componentIds";
    const result = { type, [field]: ["component-a"] };
    assert.equal(matches(result, "system-a"), true, type);
    assert.equal(matches(result, "system-b"), false, type);
    assert.equal(matches(result, "component-b"), false, type);
    result[field].push("component-b");
    assert.equal(matches(result, "system-b"), true, `${type}: mixed explicit Components`);
  }
  assert.equal(matches({ type: "vulnerability-scan", componentIds: ["missing"] }, "system-a"), false);
  byId.set("component-fake", { id: "component-fake", type: "control", systemUses: [{ systemId: "system-a" }] });
  assert.equal(matches({ type: "vulnerability-scan", componentIds: ["component-fake"] }, "system-a"), false);
});

test("explicit System scope takes precedence and never expands to individual Components", () => {
  const { matches } = fixture();
  const result = { type: "backup-test", systemIds: ["system-b"], componentIds: ["component-a"] };
  assert.equal(matches(result, "system-a"), false);
  assert.equal(matches(result, "system-b"), true);
  assert.equal(matches({ type: "backup-test", systemIds: ["system-a"] }, "component-a"), false);
  const activity = { type: "control-activity", scopeResourceIds: ["system-b", "component-a"] };
  assert.equal(matches(activity, "system-a"), false, "Typed Systems in polymorphic scope are authoritative");
  assert.equal(matches(activity, "system-b"), true);
  assert.equal(matches({ type: "backup-test", systemIds: ["missing-system"], componentIds: ["component-a"] }, "system-a"), false);
  assert.equal(matches({ type: "exercise", systemIds: ["system-b"], evidenceIds: ["proof-a"] }, "system-a"), false,
    "Proof scope cannot override explicit execution scope");
});

test("shared Components require linked proof bounded to both that Component and intended System", () => {
  const { matches, byId } = fixture();
  const scan = { type: "vulnerability-scan", componentIds: ["component-shared"] };
  assert.equal(matches(scan, "system-a"), false);
  scan.evidenceIds = ["proof-a"];
  assert.equal(matches(scan, "system-a"), true);
  assert.equal(matches(scan, "system-b"), false);
  byId.get("proof-a").componentIds = ["component-a"];
  assert.equal(matches(scan, "system-a"), false, "Proof for another Component cannot bound the shared test");
  assert.equal(matches({ ...scan, type: "exercise" }, "system-a"), false, "Exercise proof fallback cannot bypass explicit Component scope");
  byId.get("proof-a").componentIds = [];
  assert.equal(matches({ ...scan, type: "exercise" }, "system-a"), false, "Broad proof is insufficient for a shared Component");
  scan.componentIds = ["component-b"];
  assert.equal(matches(scan, "system-a"), false, "Evidence alone cannot enlarge a scan's Component scope");
  scan.componentIds = ["component-shared"];
  byId.get("proof-a").componentIds = ["component-shared"];
  byId.get("proof-a").type = "control";
  assert.equal(matches(scan, "system-a"), false);
});

test("unrelated source and Control links do not turn results into System work", () => {
  const { matches, byId } = fixture();
  byId.set("control-a", { id: "control-a", type: "control", systemIds: ["system-a"] });
  assert.equal(matches({ type: "control-test", controlId: "control-a" }, "system-a"), false);
  assert.equal(matches({ type: "vulnerability-scan", evidenceIds: ["proof-a"] }, "system-a"), false);
  assert.equal(matches({ type: "evidence", sourceComponentId: "component-a" }, "system-a"), false);
  assert.equal(matches({ type: "exercise", componentIds: ["component-b"], evidenceIds: ["proof-a"] }, "system-a"), false);
  assert.equal(matches({ type: "exercise", evidenceIds: ["proof-a"] }, "system-a"), true, "Proof-only scope remains supported where the model allows it");
});
