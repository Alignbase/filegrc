import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { trainingFixture } from "./fixtures/attestation-occurrence.js";
import { writeJson } from "./helpers.js";
import { contentRevision } from "../src/files.js";
import { completeObligationOccurrence, loadWorkspace, planObligations, scaffoldObligationOccurrence, saveObligationOccurrence, validateWorkspace } from "../src/index.js";
import { assessCompletionForObligation, completionMatchesMember } from "../src/obligations.js";
import { loadModel } from "../model/index.js";

for (const scope of [["training-example"], ["person-example"], ["person-example", "training-example"]]) {
  test(`existing combined acknowledgement reconciles exact ${scope.join(" and ")} members`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "filegrc-training-occurrence-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const f = await trainingFixture(root, scope);
    const before = await readFile(f.attestationEntry.path, "utf8");
    const scaffold = await scaffoldObligationOccurrence(root, { obligationId: f.obligation.id, windowStart: "2026-07-05", asOf: "2026-07-07" });
    assert.equal(scaffold.membershipFinal, true);
    assert.deepEqual(scaffold.record.members.map(({ resourceId }) => resourceId).sort(), [...scope].sort());
    for (const member of scaffold.record.members) {
      assert.deepEqual(member.completionResourceIds, [f.attestation.id]);
      assert.equal(member.result, "passed");
    }
    await saveObligationOccurrence(root, { record: { ...scaffold.record, status: "reconciled", completedCount: scope.length,
      conclusion: "complete", reviewedByIds: ["person-example"], reconciledAt: "2026-07-07T18:00:00Z" } });
    assert.equal(await readFile(f.attestationEntry.path, "utf8"), before);
    const loaded = await loadWorkspace(root);
    const item = planObligations(loaded.resources, { model: loaded.model, asOf: "2026-07-07", through: "2026-07-07", includeComplete: true }).calendarItems.find(({ obligationId }) => obligationId === f.obligation.id);
    assert.equal(item.status, "complete");
    const validation = await validateWorkspace(root);
    assert.deepEqual(validation.diagnostics.filter(({ code }) => /occurrence|member|population|attestation/.test(code)), []);
  });
}

test("attestation membership uses typed authored subjects and the actual person, including combined acknowledgements", () => {
  const model = loadModel("13");
  const byId = new Map(["person", "training", "policy", "document", "action-item", "system"].map((type) => [`${type}-example`, { id: `${type}-example`, type }]));
  const obligation = { scopeResourceIds: ["person-example", "training-example"] };
  const record = { type: "attestation", personId: "person-example", subjectResourceIds: ["policy-example", "training-example", "document-example", "action-item-example"] };
  for (const type of ["person", "training", "policy", "document", "action-item"]) {
    assert.equal(completionMatchesMember(record, null, `${type}-example`, model, byId, obligation), true, type);
  }
  assert.equal(completionMatchesMember(record, null, "system-example", model, byId, obligation), false);
  assert.equal(completionMatchesMember({ ...record, personId: "person-other" }, "subjectResourceIds", "training-example", model, byId, obligation), false);
  assert.equal(completionMatchesMember({ ...record, subjectResourceIds: ["policy-example"] }, null, "person-example", model, byId, obligation), false);
});

test("atomic completion reuses an existing combined acknowledgement without duplicating or changing it", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-training-reuse-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const f = await trainingFixture(root);
  const before = await readFile(f.attestationEntry.path, "utf8");
  const result = await completeObligationOccurrence(root, { obligationId: f.obligation.id, record: f.attestation,
    expectedRevision: contentRevision(await readFile(f.obligationEntry.path, "utf8")) });
  assert.equal(result.linked.members[0].result, "passed");
  assert.deepEqual(result.linked.members[0].completionResourceIds, [f.attestation.id]);
  assert.equal(await readFile(f.attestationEntry.path, "utf8"), before);
  assert.equal((await loadWorkspace(root)).resources.filter(({ type }) => type === "attestation").length, 1);
});

test("attestations cannot pass with another person or subject, incomplete status, invalid proof or an ineligible date", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-training-rejection-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const f = await trainingFixture(root, ["person-example", "training-example"]);
  const loaded = await loadWorkspace(root);
  const window = { dueWindowStart: "2026-07-05", dueWindowEnd: "2026-07-21" };
  const variants = [
    { ...f.attestation, personId: "person-independent-approver-example" },
    { ...f.attestation, subjectResourceIds: ["policy-example"], contentRevisions: { "policies/policy-example.md": f.attestation.contentRevisions["policies/policy-example.md"] } },
    { ...f.attestation, completedOn: "2026-07-04" },
    { ...f.attestation, completedOn: "2026-07-08" },
    { ...f.attestation, contentRevisions: undefined },
    { ...f.attestation, contentRevisions: { "policies/policy-example.md": f.attestation.contentRevisions["policies/policy-example.md"] } },
    { ...f.attestation, contentRevisions: { ...f.attestation.contentRevisions, "training/training-example.md": "invalid" } }
  ];
  for (const status of ["pending", "waived"]) {
    const record = { ...f.attestation, status };
    for (const field of ["completedOn", "attestationMethod", "contentRevisions"]) delete record[field];
    if (status === "waived") Object.assign(record, { waivedByIds: ["person-example"], waiverReason: "Not a training completion." });
    variants.push(record);
  }
  for (const record of variants) {
    assert.equal(assessCompletionForObligation(record, f.obligation, loaded, { memberIds: ["person-example", "training-example"], window, asOf: "2026-07-07" }).complete, false, JSON.stringify(record));
    await writeJson(f.attestationEntry.path, record);
    const scaffold = await scaffoldObligationOccurrence(root, { obligationId: f.obligation.id, windowStart: "2026-07-05", asOf: "2026-07-07" });
    assert.ok(scaffold.record.members.every(({ result }) => result !== "passed"));
    const injected = { ...scaffold.record, status: "reconciled", completedCount: 2, conclusion: "complete", reviewedByIds: ["person-example"], reconciledAt: "2026-07-07T18:00:00Z",
      members: scaffold.record.members.map((member) => ({ ...member, result: "passed", completionResourceIds: [record.id] })) };
    await assert.rejects(saveObligationOccurrence(root, { record: injected }), /completion|subject|person|contentRevisions|completedOn/i);
    assert.equal((await loadWorkspace(root)).resources.some(({ type }) => type === "obligation-occurrence"), false);
  }
});

test("authored members cannot bypass another required template subject", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-training-template-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const f = await trainingFixture(root);
  const loaded = await loadWorkspace(root);
  const obligation = { ...f.obligation, templateResourceId: "document-example" };
  await writeJson(f.obligationEntry.path, obligation);
  const scaffold = await scaffoldObligationOccurrence(root, { obligationId: obligation.id, windowStart: "2026-07-05", asOf: "2026-07-07" });
  assert.equal(scaffold.record.members[0].result, "pending");
  assert.equal(assessCompletionForObligation(f.attestation, obligation, loaded, { memberIds: ["training-example"], window: { dueWindowStart: "2026-07-05", dueWindowEnd: "2026-07-21" }, asOf: "2026-07-07" }).complete, false);
});

test("combined acknowledgements preserve subjects without optional Markdown", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-training-optional-content-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const f = await trainingFixture(root);
  await rm(join(root, "data/action-items/action-item-example.md"), { force: true });
  await writeJson(f.attestationEntry.path, { ...f.attestation, subjectResourceIds: [...f.attestation.subjectResourceIds, "action-item-example"] });
  const validation = await validateWorkspace(root);
  assert.deepEqual(validation.diagnostics.filter(({ code }) => /attestation/.test(code)), []);
  const scaffold = await scaffoldObligationOccurrence(root, { obligationId: f.obligation.id, windowStart: "2026-07-05", asOf: "2026-07-07" });
  assert.equal(scaffold.record.members[0].result, "passed");
  await saveObligationOccurrence(root, { record: { ...scaffold.record, status: "reconciled", completedCount: 1,
    conclusion: "complete", reviewedByIds: ["person-example"], reconciledAt: "2026-07-07T18:00:00Z" } });
});
