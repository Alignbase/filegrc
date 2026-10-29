import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { makeComprehensiveWorkspace } from "./fixtures.js";
import { writeJson, initializeGitWorkspace, commitWorkspaceFiles } from "./helpers.js";
import { loadWorkspace } from "../src/workspace.js";
import { validateWorkspace } from "../src/validate.js";
import { updateResource } from "../src/files.js";
import { readResourceMutation } from "../src/resource-mutation.js";
import { resourceReviewRevisionsSync, retentionReviewResourceIds } from "../src/retention.js";
import { scaffoldCollectionReview, applyCollectionReview } from "../src/collection-review.js";
import { currentCalendarDate } from "../src/time.js";
import { governedContentBaseline, governedContentCoversPeriod, governedMarkdownSource, registerGovernedLookup } from "../src/governed-content-baseline.js";
import { createObligationEvent, planObligations } from "../src/obligations.js";
import { assessProgramReadiness } from "../src/program-readiness.js";
import { assessProgramBaseline } from "../src/operating-baseline.js";
import { prepareEvidencePacket, writeEvidencePacket } from "../src/evidence-packet.js";
import { assessWorkflow } from "../src/workflow.js";

// The public generic fixture represents existing v11 operation. Only fixture
// construction writes initial facts directly; proposal and approval writes below
// use the same validated domain operations as the CLI and browser.
async function makeActiveWorkspace(root) {
  // Historical approvals remain valid when a workspace adopts the new action.
  await makeComprehensiveWorkspace(root, "11");
  let loaded = await loadWorkspace(root);
  const document = loaded.entries.find(({ record }) => record.id === "document-example");
  await writeJson(document.path, { ...document.record, documentKind: "schedule", reportingRouteRequirements: undefined });
  const rowEntry = loaded.entries.find(({ record }) => record.type === "retention-schedule-item");
  const row = {
    ...rowEntry.record, status: "active",
    scopeResourceIds: ["system-example", "component-example", "vendor-example"],
    scheduleDocumentId: document.record.id, informationTypeIds: ["information-type-example"],
    cutoff: { basis: "creation" }, retentionPeriod: { basis: "fixed", amount: 3, unit: "year" },
    dispositionAction: "delete", dispositionInstructions: "Delete after the approved cutoff and period unless a hold applies."
  };
  loaded = await loadWorkspace(root);
  row.reviewedSourceRevisions = Object.fromEntries(resourceReviewRevisionsSync(
    loaded, retentionReviewResourceIds(row, loaded), "legacy", false, null, row, true
  ));
  await writeJson(rowEntry.path, row);
  const attestation = loaded.entries.find(({ record }) => record.type === "attestation");
  await writeJson(attestation.path, { ...attestation.record, programId: "program-example" });
  const training = loaded.resources.find(({ type }) => type === "training");
  await writeJson(join(root, "data/attestations/attestation-training-example.json"), {
    ...attestation.record, id: "attestation-training-example", title: "Security training completion",
    programId: "program-example", subjectResourceIds: [training.id],
    contentRevisions: training.approvedContentRevisions
  });
  const policy = loaded.entries.find(({ record }) => record.type === "policy");
  await writeJson(policy.path, { ...policy.record, programRole: "required" });
  await initializeGitWorkspace(root);
  const scaffold = await scaffoldCollectionReview(root, { resourceType: "retention-schedule-item" });
  await applyCollectionReview(root, {
    ...scaffold, decision: "complete", rationale: "Reviewed the complete schedule and all approved rule requirements.",
    reviewedByIds: ["person-independent-approver-example"], reviewedOn: currentCalendarDate(loaded.workspace.timezone), confirmed: true
  });
  await commitWorkspaceFiles(root, "Approve retention schedule");
  loaded = await loadWorkspace(root);
  const schedule = loaded.entries.find(({record}) => record.type === "document");
  await writeJson(schedule.path, {...schedule.record,status:"active",activationBasis:"recorded",activatedOn:currentCalendarDate(loaded.workspace.timezone),effectiveOn:currentCalendarDate(loaded.workspace.timezone),activatedByIds:["person-example"],activatedContentRevisions:schedule.record.approvedContentRevisions});
  await commitWorkspaceFiles(root,"Record model v11 active generic retention fixture");
  await writeJson(loaded.entries.find(({ record }) => record.type === "workspace").path, { ...loaded.workspace, dataModelVersion: "13" });
  await writeJson(`${root}/package.json`, { private: true, dependencies: { filegrc: "^0.19.2" } });
  await writeJson(`${root}/package-lock.json`, { lockfileVersion: 3, packages: { "": { dependencies: { filegrc: "^0.19.2" } }, "node_modules/filegrc": { version: "0.19.2" } } });
  await commitWorkspaceFiles(root, "Upgrade workspace model");
  return root;
}

async function fixture(t, keep = false) {
  const root = await mkdtemp(join(tmpdir(), "filegrc-same-id-consumers-"));
  if (!keep) t.after(() => rm(root, { recursive: true, force: true }));
  await makeActiveWorkspace(root);
  assert.equal((await validateWorkspace(root)).ok, true);
  const loaded = await loadWorkspace(root);
  return { root, today: currentCalendarDate(loaded.workspace.timezone) };
}

async function mutate(root, type, change) {
  const mutation = await readResourceMutation(root, type, `${type}-example`);
  change(mutation);
  return updateResource(root, type, mutation.record.id, mutation.record, {
    expectedRevision: mutation.revision,
    content: mutation.content,
    expectedContentRevisions: mutation.contentRevisions,
    requireExpectedContentRevisions: true
  });
}

async function propose(root, type, today, onStage = async () => {}) {
  await mutate(root, type, ({ record }) => {
    record.status = "draft";
    for (const field of ["approvedOn", "approvedContentRevisions", "effectiveOn", "activationBasis", "activatedOn", "activatedByIds", "activatedContentRevisions"]) delete record[field];
  });
  await commitWorkspaceFiles(root, `Return ${type} to draft for review`);
  await onStage("draft");
  await mutate(root, type, ({ content }) => {
    for (const slot of Object.keys(content)) content[slot] += "\nProposed clarification: retain the completed review and its population reconciliation.\n";
  });
  await commitWorkspaceFiles(root, `Propose revised ${type} content`);
  await mutate(root, type, ({ record }) => { record.status = "in-review"; });
  await commitWorkspaceFiles(root, `Review revised ${type} proposal`);
  await onStage("in-review");
  await mutate(root, type, ({ record }) => {
    record.status = "approved";
    record.approvedOn = today;
    record.approverIds = ["person-independent-approver-example"];
  });
  await commitWorkspaceFiles(root, `Approve revised ${type} pending activation`);
}

async function consumers(root, today, type) {
  const loaded = await loadWorkspace(root);
  const byId = registerGovernedLookup(new Map(loaded.resources.map((record) => [record.id, record])), loaded);
  const source = byId.get(`${type}-example`);
  const baseline = governedContentBaseline(source, byId, today, loaded.model);
  const path = Object.keys(baseline?.approvedContentRevisions || source.approvedContentRevisions)[0];
  const plan = planObligations(loaded.resources, { root, model: loaded.model, asOf: today, from: today, through: today, includeComplete: true });
  const readiness = await assessProgramReadiness(loaded, { asOf: today });
  // Select the existing generic Control for the real workforce consumer. No
  // program fact or completion record is invented to make its result pass.
  const program = byId.get("program-example");
  const control = byId.get("control-example");
  const profiles = loaded.model.operatingPreparation.baselineProfiles;
  loaded.model.operatingPreparation.baselineProfiles = [{ id: type === "training" ? "workforce-training" : "workforce-policy", resourceType: "attestation", activities: [], controlCodes: [control.code] }];
  const workforce = await assessProgramBaseline(loaded, program, [control], today,
    (_id, _title, complete, _work, _acceptance, _record, _type, details) => ({ complete, ...details }));
  loaded.model.operatingPreparation.baselineProfiles = profiles;
  const workflow = await assessWorkflow(loaded, { asOf: today, includeComplete: true,
    coverage: { kind: "range", startsOn: today, endsOn: today } });
  const packet = await prepareEvidencePacket(root, { start: "2026-06-30", end: today, programId: program.id });
  return { packet, loaded, source, baseline, path, markdown: governedMarkdownSource(loaded, baseline, path),
    covered: governedContentCoversPeriod(source, today, today, byId, loaded.model), plan, readiness, workforce,
    policyGaps: workflow.findings.filter((finding) => finding.key.includes("policy-example") && finding.key.startsWith("period.")) };
}

for (const type of ["policy", "training"]) {
  test(`normal same-ID ${type} draft, proposal and approval retain operating consumers`, async (t) => {
    const keep = process.env.FILEGRC_KEEP_SAME_ID_FIXTURE === type;
    const { root, today } = await fixture(t, keep);
    const before = await consumers(root, today, type);
    assert.equal(before.covered, true);
    assert.equal(before.plan.programStatuses["obligation-example"], "accepted");
    if (type === "training") assert.ok(before.workforce[0].resultIds.includes("attestation-training-example"), "fixture completion proves the actual old Training revision");
    if (type === "policy") {
      assert.ok(before.workforce[0].resultIds.includes("attestation-example"), "fixture acknowledgement proves the actual old Policy revision");
      assert.ok(before.packet.datedRecords.some(({ id }) => id === "attestation-example"), "the packet selects actual dated acknowledgement evidence");
    }
    await propose(root, type, today, async (status) => {
      const loaded = await loadWorkspace(root);
      const program = loaded.resources.find(({ id }) => id === "program-example");
      const control = loaded.resources.find(({ id }) => id === "control-example");
      const profiles = loaded.model.operatingPreparation.baselineProfiles;
      loaded.model.operatingPreparation.baselineProfiles = [{ id: type === "training" ? "workforce-training" : "workforce-policy", resourceType: "attestation", activities: [], controlCodes: [control.code] }];
      const workforce = await assessProgramBaseline(loaded, program, [control], today,
        (_id, _title, complete, _work, _acceptance, _record, _type, details) => ({ complete, ...details }));
      loaded.model.operatingPreparation.baselineProfiles = profiles;
      assert.equal(loaded.resources.find(({ id }) => id === `${type}-example`).status, status);
      assert.deepEqual(workforce[0].subjectIds, before.workforce[0].subjectIds, `${status} retains operating subjects`);
      assert.deepEqual(workforce[0].resultIds, before.workforce[0].resultIds, `${status} retains exact old acknowledgments`);
      assert.deepEqual(workforce[0].missingMembers, before.workforce[0].missingMembers);
    });
    if (keep) console.log(`Retained public pending ${type} fixture: ${root}`);
    const after = await consumers(root, today, type);
    assert.equal((await validateWorkspace(root)).ok, true);
    assert.equal(after.source.status, "approved", "the editable proposal remains visible");
    assert.equal(after.source.approvedOn, today);
    assert.notDeepEqual(after.source.approvedContentRevisions, before.source.approvedContentRevisions);
    assert.equal(after.baseline?.status, "active");
    assert.deepEqual(after.baseline.approvedContentRevisions, before.source.approvedContentRevisions);
    assert.equal(after.markdown, before.markdown, "operating consumers read exact committed old Markdown");
    assert.notEqual(await readFile(join(root, "data", after.path), "utf8"), before.markdown, "the source still contains proposed Markdown");
    assert.equal(after.covered, true, "approval is not an operating cutover");
    assert.equal(after.plan.programStatuses["obligation-example"], "accepted");
    assert.deepEqual(after.plan.items, before.plan.items, "existing recurring occurrences remain recordable");
    assert.deepEqual(after.workforce[0].resultIds, before.workforce[0].resultIds);
    assert.deepEqual(after.workforce[0].missingMembers, before.workforce[0].missingMembers);
    assert.deepEqual(after.packet.gaps.filter(({ code, resourceId }) => code === "policy-not-effective-for-period" && resourceId === "policy-example"),
      before.packet.gaps.filter(({ code, resourceId }) => code === "policy-not-effective-for-period" && resourceId === "policy-example"),
      "the current-period packet retains prior Policy coverage");
    assert.deepEqual(after.packet.filegrcRecords.filter(({ type }) => type === "attestation"), before.packet.filegrcRecords.filter(({ type }) => type === "attestation"),
      "the packet retains existing dated acknowledgement evidence");
    const delivery = await writeEvidencePacket(root, after.packet, { output: `.filegrc/same-id-${type}-delivery` });
    const output = delivery.output || delivery.path;
    const exported = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"));
    const operating = exported.operatingBaselines.find(({ resourceId }) => resourceId === after.source.id);
    assert.ok(operating, "the delivery explicitly identifies the prior operating edition");
    assert.equal(JSON.parse(await readFile(join(output, operating.recordPath), "utf8")).status, "active");
    const content = operating.contentPaths.find(({ sourcePath }) => sourcePath === after.path || sourcePath === `data/${after.path}`);
    assert.ok(content);
    assert.equal(await readFile(join(output, content.exportedPath), "utf8"), before.markdown);
    assert.equal(JSON.parse(await readFile(join(output, "records", type, `${after.source.id}.json`), "utf8")).status, "approved");
    assert.equal(await readFile(join(output, "content", after.path), "utf8"), await readFile(join(root, "data", after.path), "utf8"));
    assert.deepEqual(after.policyGaps, before.policyGaps, "a pending revision creates no additional Policy coverage gap");
    const activation = type === "policy" ? after.readiness.policyActivations : after.readiness.trainingActivations;
    assert.ok(activation.some((item) => (item.policyId || item.resourceId || item.trainingId) === after.source.id), "new approval work remains discoverable");
  });
}

test("whole-schedule same-ID reapproval retains the operating retention schedule until activation", async (t) => {
  const { root, today } = await fixture(t);
  const before = await consumers(root, today, "document");
  assert.equal(before.source.status, "active");
  const scaffold = await scaffoldCollectionReview(root, { resourceType: "retention-schedule-item" });
  await applyCollectionReview(root, { ...scaffold, decision: "complete",
    rationale: "Independently reviewed the complete unchanged schedule and all retained rules.",
    reviewedByIds: ["person-independent-approver-example"], reviewedOn: today, confirmed: true });
  await commitWorkspaceFiles(root, "Independently review existing complete retention schedule");
  const originalRow = before.loaded.resources.find(({ type }) => type === "retention-schedule-item");
  const proposedRow = await readResourceMutation(root, "retention-schedule-item", originalRow.id);
  proposedRow.record.retentionPeriod = { ...originalRow.retentionPeriod, amount: originalRow.retentionPeriod.amount + 1 };
  await updateResource(root, "retention-schedule-item", originalRow.id, proposedRow.record, {
    expectedRevision: proposedRow.revision,
    content: proposedRow.content,
    expectedContentRevisions: proposedRow.contentRevisions
  });
  await commitWorkspaceFiles(root, "Propose a revised retention period pending schedule activation");
  const revisedReview = await scaffoldCollectionReview(root, { resourceType: "retention-schedule-item" });
  await applyCollectionReview(root, { ...revisedReview, decision: "complete",
    rationale: "Independently reviewed the proposed retention period and the complete schedule.",
    reviewedByIds: ["person-independent-approver-example"], reviewedOn: today, confirmed: true });
  await commitWorkspaceFiles(root, "Approve proposed complete retention schedule pending activation");
  const after = await consumers(root, today, "document");
  assert.equal((await validateWorkspace(root)).ok, true);
  assert.equal(after.source.status, "approved");
  assert.equal(after.source.activatedOn, undefined, "new review does not activate its decision");
  assert.equal(after.baseline?.status, "active");
  assert.equal(after.baseline.activatedOn, before.source.activatedOn);
  assert.equal(after.markdown, before.markdown);
  assert.equal(after.covered, true);
  const target = (state) => state.readiness.stages.flatMap(({ items }) => items).find(({ id }) => id === "document-document-example");
  assert.equal(target(before).status, "complete");
  assert.ok(["complete", "info"].includes(target(after).status), "review work does not reopen operating activation prerequisites");
  assert.deepEqual(after.plan.items, before.plan.items);
  assert.deepEqual(after.workforce[0].resultIds, before.workforce[0].resultIds);
  const delivery = await writeEvidencePacket(root, after.packet, { output: ".filegrc/same-id-retention-delivery" });
  const output = delivery.output || delivery.path;
  const exported = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"));
  const operating = exported.operatingBaselines.find(({ resourceId }) => resourceId === after.source.id);
  const row = operating.relatedRecords.find(({ id }) => id === originalRow.id);
  assert.ok(row, "the delivered operating schedule includes its exact historical structured row");
  const rowSource = await readFile(join(output, row.recordPath), "utf8");
  assert.equal(rowSource, before.loaded.entries.find(({ record }) => record.id === originalRow.id).source, "the delivered row preserves exact committed old bytes");
  assert.deepEqual(JSON.parse(rowSource).retentionPeriod, originalRow.retentionPeriod);
  const originalReview = before.loaded.resources.find((record) => record.type === "collection-review" && record.resourceType === "retention-schedule-item" && record.status === "active");
  const proof = operating.relatedRecords.find(({ id }) => id === originalReview.id);
  assert.ok(proof, "the operating rows retain their original whole-schedule approval proof");
  assert.deepEqual(JSON.parse(await readFile(join(output, proof.recordPath), "utf8")), originalReview);
  const rawRow = (await readResourceMutation(root, "retention-schedule-item", originalRow.id)).record;
  assert.deepEqual(rawRow.retentionPeriod, proposedRow.record.retentionPeriod, "raw workspace row retains its proposed decision");
  assert.notDeepEqual(rawRow.retentionPeriod, JSON.parse(rowSource).retentionPeriod);
  const checksums = await readFile(join(output, "SHA256SUMS"), "utf8");
  const { createHash } = await import("node:crypto");
  assert.ok(checksums.split("\n").includes(`${createHash("sha256").update(rowSource).digest("hex")}  ${row.recordPath}`));
});

test("normal Policy retirement remains an operating barrier", async (t) => {
  const { root, today } = await fixture(t);
  await mutate(root, "policy", ({ record }) => {
    record.status = "retired";
    record.statusTransition = { changedOn: today, changedByIds: ["person-example"], reason: "Management withdrew the operating Policy." };
  });
  await commitWorkspaceFiles(root, "Withdraw the existing Policy");
  const state = await consumers(root, today, "policy");
  assert.equal(state.baseline, null, "actual withdrawal cannot reuse prior operating authority");
  assert.equal(state.covered, false);
  assert.equal(state.plan.programStatuses["obligation-example"], "proposed");
});

test("a stale committed operating edition cannot authorize a later same-ID proposal", async (t) => {
  const { root, today } = await fixture(t);
  const path = join(root, "data/policies/policy-example.md");
  // Deliberately invalid negative fixture: an actual active edition has changed
  // without its approval. This historical barrier must survive later valid CRUD.
  await writeFile(path, `${await readFile(path, "utf8")}\nAn unapproved operating duty was introduced.\n`);
  await commitWorkspaceFiles(root, "Record an invalid operating edition for negative coverage");
  await propose(root, "policy", today);
  const state = await consumers(root, today, "policy");
  assert.equal(state.source.status, "approved");
  assert.equal(state.baseline, null);
  assert.equal(state.covered, false);
  assert.equal(state.plan.programStatuses["obligation-example"], "proposed");
});

// Event writes use the same operating eligibility as the planner while a
// governed revision is still being authored or awaiting activation.
test("actual Policy Event writes retain the baseline through draft, review and approval", async (t) => {
  const { root, today } = await fixture(t);
  const trigger = async (status) => {
    const created = await createObligationEvent(root, { programId: "program-example",
      eventType: "person-role-changed", occurredOn: today, subjectResourceIds: ["person-example"],
      title: `Generic role change during ${status}` });
    assert.equal(created.actions.length, 1);
    assert.equal(created.actions[0].obligationId, "obligation-example");
    assert.equal(created.actions[0].sourceResourceId, created.event.id);
    const loaded = await loadWorkspace(root);
    const plan = planObligations(loaded.resources, { root, loaded, model: loaded.model,
      programId: "program-example", asOf: today, through: today, includeComplete: true });
    assert.equal(plan.programStatuses["obligation-example"], "accepted");
    assert.ok(loaded.resources.some(({ id }) => id === created.actions[0].id));
    await commitWorkspaceFiles(root, `Record generic role change during ${status}`);
  };
  await propose(root, "policy", today, trigger);
  await trigger("approved");
  assert.equal((await validateWorkspace(root)).ok, true);
});
