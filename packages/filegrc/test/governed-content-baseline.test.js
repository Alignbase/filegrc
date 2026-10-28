import assert from "node:assert/strict";
import test from "node:test";
import { loadModel } from "../model/index.js";
import { calculateRevision } from "../src/revisions.js";
import { governedContentBaseline, governedContentCoversPeriod, pendingGovernedSuccessor } from "../src/governed-content-baseline.js";
import { obligationProgramStatus } from "../src/program-lifecycle.js";
import { obligationScheduleRecurrence, planObligations } from "../src/obligations.js";

const model = loadModel("13");
const owner = { id: "person-owner", type: "person", status: "active" };
const reviewer = { id: "person-reviewer", type: "person", status: "active" };
const control = { id: "control-example", type: "control", status: "implemented" };
const revision = calculateRevision("content", "The approved operating procedure.");
function content(type, id = `${type}-baseline`) {
  return { id, type, title: id, status: "active", ownerIds: [owner.id], approverIds: [reviewer.id],
    programRole: "required", controlIds: [control.id], ...(type === "document" ? { workflowScope: "program" } : {}),
    approvedOn: "2026-01-01", effectiveOn: "2026-01-02", approvedContentRevisions: { [`${id}.md`]: revision },
    ...(type === "policy" ? {} : { activationBasis: "recorded", activatedOn: "2026-01-02", activatedByIds: [owner.id], activatedContentRevisions: { [`${id}.md`]: revision } }) };
}
function index(...records) { return new Map([owner, reviewer, control, ...records].map((record) => [record.id, record])); }
const obligation = { id: "obligation-example", type: "obligation", status: "active", title: "Review program access", activityType: "access-review",
  ownerIds: [owner.id], controlIds: [control.id], recurrence: { mode: "calendar", interval: 1, unit: "month", anchorMode: "activation" } };

for (const type of ["policy", "document", "training"]) {
  test(`${type} proposals preserve the authorized operating baseline until cutover`, () => {
    const prior = content(type);
    for (const status of ["draft", "in-review", "approved", "active"]) {
      const next = { ...content(type, `${type}-successor`), status, supersedesId: prior.id,
        approvedOn: "2026-06-01", effectiveOn: status === "active" ? "2026-07-01" : undefined,
        ...(type === "policy" ? {} : { activatedOn: status === "active" ? "2026-07-01" : undefined }) };
      const byId = index(prior, next);
      assert.equal(governedContentBaseline(next, byId, "2026-06-15", model)?.id, prior.id);
      assert.equal(pendingGovernedSuccessor(next, byId, "2026-06-15", model)?.id, prior.id);
      assert.equal(governedContentCoversPeriod(next, "2026-01-02", "2026-06-15", byId, model), true);
      const task = { ...obligation, ...(type === "policy" ? { policyIds: [next.id] } : type === "training" ? { templateResourceId: next.id } : {}) };
      assert.equal(obligationProgramStatus(task, byId, "2026-06-15", model), "accepted");
      const planned = obligationScheduleRecurrence(task, null, byId, model, "UTC", new Set(), "2026-06-15");
      assert.equal(planned.activationDate, "2026-01-02");
      assert.equal(planned.recurrence.anchorDate, "2026-01-02");
    }
  });

  test(`${type} actual cutover requires continuous authorization and exact activation proof`, () => {
    const prior = { ...content(type), status: "superseded", statusTransition: { changedOn: "2026-07-01" } };
    const next = { ...content(type, `${type}-successor`), supersedesId: prior.id,
      approvedOn: "2026-06-01", effectiveOn: "2026-07-01", ...(type === "policy" ? {} : { activatedOn: "2026-07-01" }) };
    assert.equal(governedContentCoversPeriod(next, "2026-01-02", "2026-07-10", index(prior, next), model), true);
    assert.equal(governedContentCoversPeriod(prior, "2026-01-02", "2026-07-10", index(prior, next), model), true);
    assert.equal(governedContentBaseline(prior, index(prior, next), "2026-07-01", model)?.id, next.id);
    const task = { ...obligation, ...(type === "policy" ? { policyIds: [next.id] } : type === "training" ? { templateResourceId: next.id } : {}) };
    assert.equal(obligationScheduleRecurrence(task, null, index(prior, next), model, "UTC", new Set(), "2026-07-10").activationDate, "2026-07-01");
    assert.equal(governedContentCoversPeriod(next, "2026-01-02", "2026-07-10", index({ ...prior, statusTransition: { changedOn: "2026-06-30" } }, next), model), false);
    for (const invalid of [
      { ...next, approvedOn: "2026-07-02" },
      { ...next, approvedContentRevisions: {} },
      { ...next, approverIds: [owner.id] },
      ...(type === "policy" ? [] : [{ ...next, activatedOn: undefined }, { ...next, activatedContentRevisions: { [`${next.id}.md`]: calculateRevision("content", "Unreviewed change") } }])
    ]) {
      assert.equal(governedContentBaseline(invalid, index(prior, invalid), "2026-07-10", model), null);
      assert.equal(governedContentCoversPeriod(invalid, "2026-01-02", "2026-07-10", index(prior, invalid), model), false);
    }
  });

  test(`${type} pending successor cannot replace missing, retired or stale prior proof`, () => {
    const prior = content(type);
    const next = { ...content(type, `${type}-successor`), status: "approved", supersedesId: prior.id };
    assert.equal(governedContentBaseline(next, index(next), "2026-06-15", model), null);
    assert.equal(governedContentBaseline(next, index({ ...prior, status: "retired", statusTransition: { changedOn: "2026-06-01" } }, next), "2026-06-15", model), null);
    assert.equal(governedContentBaseline(next, index(prior, next), "2026-06-15", model, { contentMatches: () => false }), null);
    assert.equal(governedContentCoversPeriod(next, "2026-01-01", "2026-06-15", index(prior, next), model), false);
  });
}

test("required Document successor does not pause or shift an existing recurring obligation", () => {
  const prior = content("document");
  const next = { ...content("document", "document-successor"), status: "approved", supersedesId: prior.id,
    approvedOn: "2026-06-01", effectiveOn: "2026-07-01", activatedOn: undefined };
  const resources = [...index(prior, next).values(), obligation];
  const options = { model, asOf: "2026-06-15", from: "2026-06-01", through: "2026-06-30", includeComplete: true };
  const baseline = planObligations(resources.filter(({ id }) => id !== next.id), options);
  const proposed = planObligations(resources, options);
  assert.deepEqual(proposed.items, baseline.items);
  assert.equal(proposed.programStatuses[obligation.id], "accepted");
  assert.equal(obligationProgramStatus(obligation, index(next), "2026-06-15", model), "proposed");
});

test("readiness keeps governed successor review visible without replacing the active baseline", async (context) => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { makeComprehensiveWorkspace } = await import("./fixtures.js");
  const { loadWorkspace } = await import("../src/workspace.js");
  const { assessProgramReadiness } = await import("../src/program-readiness.js");
  const root = await mkdtemp(join(tmpdir(), "filegrc-pending-baseline-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "13");
  const loaded = await loadWorkspace(root);
  const successors = ["document", "training"].map((type) => {
    const prior = loaded.resources.find((record) => record.type === type);
    return { ...prior, id: `${type}-successor`, status: "approved", programRole: "required", supersedesId: prior.id,
      approvedOn: "2026-07-01", effectiveOn: undefined, activatedOn: undefined, activatedContentRevisions: undefined };
  });
  loaded.resources.push(...successors);
  loaded.resources.push({ ...obligation, id: "obligation-training-successor", activityType: "training",
    ownerIds: ["person-example"], controlIds: ["control-example"], templateResourceId: "training-successor",
    recurrence: { mode: "calendar", interval: 1, unit: "month", anchorDate: "2026-06-30" } });
  const readiness = await assessProgramReadiness(loaded, { asOf: "2026-07-15" });
  const priorTraining = readiness.stages.flatMap(({ items }) => items).find(({ id }) => id === "training-training-example");
  assert.equal(priorTraining.checks.assignmentScheduled, true);
  for (const successor of successors) {
    const items = readiness.stages.flatMap(({ items }) => items).filter(({ resourceId }) => resourceId === successor.id);
    assert.ok(items.length > 0);
    assert.ok(items.every(({ status, operatingBaselineId }) => status === "info" && operatingBaselineId === successor.supersedesId));
  }
  const firstRequired = successors[0];
  delete firstRequired.supersedesId;
  const missingBaseline = await assessProgramReadiness(loaded, { asOf: "2026-07-15" });
  assert.ok(missingBaseline.stages.flatMap(({ items }) => items).some(({ resourceId, status }) => resourceId === firstRequired.id && status !== "info"));
});

test("workforce baseline retains existing acknowledgements until successor adoption", async (context) => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { makeComprehensiveWorkspace } = await import("./fixtures.js");
  const { loadWorkspace } = await import("../src/workspace.js");
  const { assessProgramBaseline } = await import("../src/operating-baseline.js");
  const root = await mkdtemp(join(tmpdir(), "filegrc-workforce-baseline-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "13");
  const loaded = await loadWorkspace(root);
  const program = loaded.resources.find(({ type }) => type === "program");
  const selected = loaded.resources.find(({ type }) => type === "control");
  const policy = loaded.resources.find(({ type }) => type === "policy");
  const successor = { ...policy, id: "policy-successor", status: "approved", supersedesId: policy.id,
    approvedOn: "2026-07-01" };
  delete successor.effectiveOn;
  loaded.model.operatingPreparation.baselineProfiles = [{ id: "workforce-policy", resourceType: "attestation", activities: [], controlCodes: [selected.code] }];
  const check = (_id, _title, complete, _work, _acceptance, _record, _type, details) => ({ complete, ...details });
  const before = await assessProgramBaseline(loaded, program, [selected], "2026-07-15", check);
  assert.deepEqual(before[0].subjectIds, [policy.id]);
  loaded.resources.push(successor);
  selected.policyIds.push(successor.id);
  const pending = await assessProgramBaseline(loaded, program, [selected], "2026-07-15", check);
  assert.deepEqual(pending[0].subjectIds, [policy.id]);
  assert.deepEqual(pending[0].missingMembers, before[0].missingMembers);
  delete successor.supersedesId;
  const firstRequired = await assessProgramBaseline(loaded, program, [selected], "2026-07-15", check);
  assert.ok(firstRequired[0].subjectIds.includes(successor.id));
  assert.ok(firstRequired[0].missingMembers.some(({ subjectId }) => subjectId === successor.id));
  successor.supersedesId = policy.id;
  successor.status = "active";
  successor.effectiveOn = "2026-07-10";
  const { readFile, writeFile } = await import("node:fs/promises");
  const body = await readFile(join(root, "data", "policies", `${policy.id}.md`), "utf8");
  await writeFile(join(root, "data", "policies", `${successor.id}.md`), body);
  successor.approvedContentRevisions = { [`policies/${successor.id}.md`]: calculateRevision("content", body) };
  const adopted = await assessProgramBaseline(loaded, program, [selected], "2026-07-15", check);
  assert.deepEqual(adopted[0].subjectIds, [successor.id]);
  assert.ok(adopted[0].missingMembers.some(({ subjectId }) => subjectId === successor.id));
});

test("a pending successor cannot borrow authorization for newly expanded governing scope", () => {
  for (const type of ["policy", "document", "training"]) {
    const prior = content(type);
    const next = { ...content(type, `${type}-expanded`), status: "approved", supersedesId: prior.id,
      controlIds: [control.id, "control-new-scope"] };
    assert.equal(governedContentBaseline(next, index(prior, next), "2026-06-15", model), null);
    assert.equal(governedContentBaseline(prior, index(prior, next), "2026-06-15", model)?.id, prior.id);
    assert.equal(pendingGovernedSuccessor(next, index(prior, next), "2026-06-15", model), null);
  }
});

test("recording existing Policy-governed work keeps approval findings separate without bypassing successor cutovers", () => {
  const prior = { ...content("policy"), approvedOn: "2026-06-01", effectiveOn: "2025-10-23" };
  const task = { ...obligation, policyIds: [prior.id] };
  assert.equal(governedContentBaseline(prior, index(prior), "2025-10-27", model), null,
    "an approval after the claimed effective date remains an authorization gap");
  assert.equal(obligationProgramStatus(task, index(prior), "2025-10-27", model), "accepted",
    "actual historical work under an existing active Policy stays recordable");
  assert.equal(governedContentCoversPeriod(prior, "2025-10-23", "2025-10-27", index(prior), model), false,
    "recording work does not erase the strict period authorization gap");
  const planned = planObligations([...index(prior).values(), task], { model, asOf: "2025-10-27", through: "2025-10-27", includeComplete: true });
  assert.ok(planned.calendarItems.some((item) => item.programStatus === "accepted" && item.dueWindowStart <= "2025-10-27" && item.dueWindowEnd >= "2025-10-27"));
  const pending = { ...content("policy", "policy-successor"), status: "approved", supersedesId: prior.id };
  assert.equal(obligationProgramStatus({ ...task, policyIds: [pending.id] }, index(prior, pending), "2026-06-15", model), "proposed",
    "a pending successor cannot substitute an invalid predecessor");
  const validPrior = content("policy");
  const invalidCutover = { ...content("policy", "policy-successor"), supersedesId: validPrior.id,
    approvedOn: "2026-07-02", effectiveOn: "2026-07-01" };
  assert.equal(obligationProgramStatus({ ...task, policyIds: [validPrior.id] }, index(validPrior, invalidCutover), "2026-07-10", model), "proposed",
    "an actual invalid successor cutover cannot fall back to standalone eligibility");
});
