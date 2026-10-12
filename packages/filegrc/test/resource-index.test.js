import assert from "node:assert/strict";
import test from "node:test";
import { withCalculationCache } from "../src/calculation-cache.js";
import { createResourceIndex, resourceIndex } from "../src/resource-index.js";
import { createApplicabilityScopeIndex } from "../src/applicability-scope.js";
import { loadModel } from "../model/index.js";
import { recordBelongsToProgram } from "../src/program.js";
import { scheduleSetInputs, scheduleSetRecords } from "../src/schedule-set.js";

test("Program authority and schedule graph indexes isolate scopes and invalidate together", () => {
  const model = loadModel("12");
  const programs = [{ id: "program-a", type: "program", controlIds: ["control-a"], policyIds: ["policy-shared"] },
    { id: "program-b", type: "program", controlIds: ["control-b"], policyIds: ["policy-shared"] }];
  const obligation = { id: "obligation-a", type: "obligation", controlIds: ["control-a"], ruleIds: ["rule-a"] };
  const rule = { id: "rule-a", type: "obligation-rule", obligationId: obligation.id, sourceResourceIds: ["policy-shared"] };
  const resources = [...programs, obligation, rule, { id: "control-a", type: "control", ownerIds: ["team-a"] },
    { id: "control-b", type: "control" }, { id: "policy-shared", type: "policy", status: "approved" },
    { id: "team-a", type: "team", memberIds: ["team-b"] }, { id: "team-b", type: "team", memberIds: ["team-a", "person-a"] },
    { id: "person-a", type: "person" }];
  const loaded = { model, resources };
  const check = () => {
    const byId = resourceIndex(resources).byId;
    assert.equal(recordBelongsToProgram(obligation, programs[0], byId, model), true);
    assert.equal(recordBelongsToProgram(obligation, programs[1], byId, model), false);
    assert.deepEqual(scheduleSetRecords(loaded, programs[0]), [obligation]);
    assert.deepEqual(scheduleSetRecords(loaded, programs[1]), []);
    const inputs = scheduleSetInputs(loaded, programs[0]);
    assert.deepEqual(inputs.map(({ record }) => record.id),
      ["obligation-a", "rule-a", "control-a", "policy-shared", "team-a", "team-b", "person-a"]);
  };
  check();
  withCalculationCache(new WeakMap(), () => {
    check();
    assert.strictEqual(scheduleSetRecords(loaded, programs[0]), scheduleSetRecords(loaded, programs[0]));
  });
  obligation.controlIds = ["control-b"];
  for (const run of [(callback) => callback(), (callback) => withCalculationCache(new WeakMap(), callback)]) {
    run(() => {
      assert.deepEqual(scheduleSetRecords(loaded, programs[0]), []);
      assert.deepEqual(scheduleSetRecords(loaded, programs[1]), [obligation]);
    });
  }
});

test("relationship indexes preserve scan order, repeated rows, and last-ID lookup", () => {
  const first = { id: "duplicate", type: "component", systemUses: [{ systemId: "b" }, { systemId: "a" }, { systemId: "a" }] };
  const last = { id: "duplicate", type: "component", systemUses: [{ systemId: "b" }] };
  const resources = [first, { id: "other", type: "system" }, last, first];
  const index = createResourceIndex(resources);
  const ids = new Set(["a", "b"]);
  assert.deepEqual(index.related("component", "systemUses.systemId", ids), resources.filter((record) => (
    record.type === "component" && (record.systemUses || []).some(({ systemId }) => ids.has(systemId))
  )));
  assert.deepEqual(index.matchingIds("component", ["duplicate", "duplicate"]), [first, last, first]);
  assert.strictEqual(index.byId.get("duplicate"), first);
  assert.deepEqual(index.ofType("component"), [first, last, first]);
  assert.deepEqual(index.related("component", "systemUses.systemId", ["missing"]), []);
  assert.deepEqual(index.ofType("missing"), []);
});

test("one resource index is shared across Programs only within a calculation snapshot", () => {
  const requirement = { id: "requirement", type: "requirement", frameworkId: "framework" };
  const resources = [requirement];
  withCalculationCache(new WeakMap(), () => {
    const first = resourceIndex(resources);
    assert.strictEqual(resourceIndex(resources), first);
    assert.strictEqual(createApplicabilityScopeIndex(resources, { id: "a" }).requirements,
      createApplicabilityScopeIndex(resources, { id: "b" }).requirements);
    assert.deepEqual(first.related("requirement", "frameworkId", ["framework"]), [requirement]);
  });
  requirement.frameworkId = "changed";
  resources.push({ id: "new", type: "requirement", frameworkId: "changed" });
  withCalculationCache(new WeakMap(), () => {
    assert.deepEqual(resourceIndex(resources).related("requirement", "frameworkId", ["framework"]), []);
    assert.equal(resourceIndex(resources).related("requirement", "frameworkId", ["changed"]).length, 2);
  });
  const before = resourceIndex(resources);
  resources.pop();
  assert.notStrictEqual(resourceIndex(resources), before);
  assert.equal(resourceIndex(resources).ofType("requirement").length, 1);
});

test("scalar and array relationships agree with filtering, including missing scalar values", () => {
  const resources = [{ id: "a", type: "requirement" }, { id: "b", type: "requirement", frameworkId: "f" },
    { id: "c", type: "control", requirementIds: ["b", "b"] }, { id: "d", type: "control", requirementIds: [] }];
  const index = createResourceIndex(resources);
  assert.deepEqual(index.related("requirement", "frameworkId", [undefined]), [resources[0]]);
  assert.deepEqual(index.related("control", "requirementIds", ["b"]), [resources[2]]);
  assert.deepEqual(index.related("control", "requirementIds", ["unknown"]), []);
});
