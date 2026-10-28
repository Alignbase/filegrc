import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadModel } from "../model/index.js";
import { supersededOperatingProofIds } from "../src/historical-operating-proof.js";
import { assessWorkflow } from "../src/workflow.js";
import { loadWorkspace } from "../src/workspace.js";
import { makeWorkspace } from "./helpers.js";

function proofFixture() {
  const old = { id: "occurrence-original", type: "obligation-occurrence", status: "superseded", programId: "program-example", obligationId: "obligation-example",
    coverage: { kind: "range", startsOn: "2026-09-01", endsOn: "2026-09-30" },
    members: [{ resourceId: "person-example", disposition: "expected", result: "failed", completionResourceIds: ["review-original"] }] };
  const replacement = { ...structuredClone(old), id: "occurrence-replacement", supersedesId: old.id, status: "reconciled", conclusion: "complete",
    members: [{ resourceId: "person-example", disposition: "expected", result: "passed", completionResourceIds: ["review-replacement"] }] };
  const originalProof = { id: "review-original", type: "access-review", status: "in-progress", findings: "Unresolved historical result." };
  const replacementProof = { id: "review-replacement", type: "access-review", status: "complete", reviewedOn: "2026-10-01", evidenceIds: ["evidence-example"] };
  return { old, replacement, originalProof, replacementProof, resources: [old, replacement, originalProof, replacementProof] };
}

test("exact finalized replacement suppresses only the old generic completion prompt without changing frozen proof", () => {
  const { resources, originalProof } = proofFixture();
  const before = structuredClone(resources);
  Object.freeze(originalProof);
  assert.deepEqual([...supersededOperatingProofIds(resources, true)], [originalProof.id]);
  assert.deepEqual(resources, before);
  assert.equal(originalProof.status, "in-progress");
  assert.deepEqual([...supersededOperatingProofIds(resources, false)], []);
});

test("unrelated, ambiguous, unfinished or incomplete replacements cannot hide historical work", () => {
  for (const [label, mutate] of [
    ["different Program", ({ replacement }) => { replacement.programId = "program-other"; }],
    ["different Obligation", ({ replacement }) => { replacement.obligationId = "obligation-other"; }],
    ["different period", ({ replacement }) => { replacement.coverage.endsOn = "2026-10-01"; }],
    ["different member", ({ replacement }) => { replacement.members[0].resourceId = "person-other"; }],
    ["omitted member", ({ replacement }) => { replacement.members = []; }],
    ["not finalized", ({ replacement }) => { replacement.status = "in-progress"; }],
    ["failed conclusion", ({ replacement }) => { replacement.conclusion = "incomplete"; }],
    ["failed member", ({ replacement }) => { replacement.members[0].result = "failed"; }],
    ["excluded member", ({ replacement }) => { replacement.members[0].disposition = "excluded"; }],
    ["missing proof", ({ replacement }) => { replacement.members[0].completionResourceIds = []; }],
    ["nonexistent proof", ({ replacement }) => { replacement.members[0].completionResourceIds = ["review-missing"]; }],
    ["unfinished proof", ({ replacementProof }) => { replacementProof.status = "in-progress"; }],
    ["ambiguous successor", ({ resources, replacement }) => { resources.push({ ...structuredClone(replacement), id: "occurrence-competing" }); }],
    ["reused old proof", ({ replacement }) => { replacement.members[0].completionResourceIds = ["review-original"]; }]
  ]) {
    const fixture = proofFixture();
    mutate(fixture);
    assert.deepEqual([...supersededOperatingProofIds(fixture.resources, true)], [], label);
  }
});

test("replacement chains must preserve exact identity and terminate without cycles", () => {
  let fixture = proofFixture();
  const terminal = { ...structuredClone(fixture.replacement), id: "occurrence-final", supersedesId: fixture.replacement.id };
  fixture.replacement.status = "superseded";
  fixture.resources.push(terminal);
  assert.equal(supersededOperatingProofIds(fixture.resources, true).has(fixture.originalProof.id), true);
  terminal.obligationId = "obligation-other";
  assert.equal(supersededOperatingProofIds(fixture.resources, true).has(fixture.originalProof.id), false);
  fixture = proofFixture();
  fixture.old.supersedesId = fixture.replacement.id;
  fixture.replacement.status = "superseded";
  assert.deepEqual([...supersededOperatingProofIds(fixture.resources, true)], []);
});

test("any live occurrence or assigned action retaining old proof prevents suppression", () => {
  for (const assignment of [
    { id: "occurrence-live-other", type: "obligation-occurrence", status: "reconciled", members: [{ resourceId: "person-other", completionResourceIds: ["review-original"] }] },
    ...["open", "in-progress", "blocked"].map(status => ({ id: "action-live-other", type: "action-item", status, completionResourceIds: ["review-original"] }))
  ]) {
    const fixture = proofFixture();
    fixture.resources.push(assignment);
    assert.deepEqual([...supersededOperatingProofIds(fixture.resources, true)], [], assignment.status);
  }
});

test("workflow removes only the validly superseded proof's generic finalize prompt", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-historical-proof-guidance-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeWorkspace(root);
  const loaded = await loadWorkspace(root);
  loaded.model = loadModel("13");
  const program = { id: "program-example", type: "program", status: "active", assuranceGoal: "none", controlIds: [], systemIds: [] };
  const fixture = proofFixture();
  loaded.resources.push(program, ...fixture.resources);
  const before = structuredClone(fixture.originalProof);
  Object.freeze(fixture.originalProof);
  const assess = (ok = true) => assessWorkflow(loaded, {
    asOf: "2026-10-10", now: "2026-10-10T12:00:00Z", programId: program.id,
    programReadiness: { stages: [], evidenceReady: true, program: { id: program.id } }, auditPreparations: {},
    validation: { ok, diagnostics: [], counts: {} }, obligations: { items: [], triggers: [], counts: {}, through: "2026-10-10" },
    reconciliation: { candidates: [] }, git: {}
  });
  const hasOldPrompt = workflow => workflow.findings.some(({ code, subject }) => code.endsWith(".finalize") && subject?.id === fixture.originalProof.id);
  assert.equal(hasOldPrompt(await assess()), false);
  assert.deepEqual(fixture.originalProof, before);
  assert.equal(hasOldPrompt(await assess(false)), true);
  fixture.replacement.coverage.endsOn = "2026-10-01";
  assert.equal(hasOldPrompt(await assess()), true);
  assert.deepEqual(fixture.originalProof, before);
});

test("a dated superseded proof is not recreated as overdue source work", async context => {
  const { sourceDeadlineWorkItems, planWorkQueue } = await import("../src/work-queue.js");
  const fixture = proofFixture();
  fixture.originalProof.scheduledFor = "2026-09-20";
  const model = loadModel("13"), program = { id:"program-example",type:"program",status:"active",systemIds:[],controlIds:[] };
  const records = [program,...fixture.resources];
  const options = { model, program, asOf:"2026-10-10", validationOk:true };
  assert.equal(sourceDeadlineWorkItems(records, options).some(item=>item.source?.id===fixture.originalProof.id),false);
  assert.equal(planWorkQueue(records,{items:[],dataModelVersion:"13",asOf:options.asOf,through:options.asOf},options).items.some(item=>item.source?.id===fixture.originalProof.id),false);
  const root = await mkdtemp(join(tmpdir(),"filegrc-historical-source-queue-"));
  context.after(()=>rm(root,{recursive:true,force:true})); await makeWorkspace(root);
  const loaded = await loadWorkspace(root);loaded.model=model;loaded.resources.push(...records);
  const workflow=await assessWorkflow(loaded,{asOf:options.asOf,programId:program.id,programReadiness:{stages:[],evidenceReady:true},auditPreparations:{},validation:{ok:true,diagnostics:[]},obligations:{items:[],triggers:[],counts:{},asOf:options.asOf,through:options.asOf},reconciliation:{candidates:[]},git:{}});
  assert.equal(workflow.workItems.some(item=>item.source?.id===fixture.originalProof.id),false);
  assert.equal(workflow.workQueue.items.some(item=>item.source?.id===fixture.originalProof.id),false);
  assert.equal(sourceDeadlineWorkItems(records,{...options,validationOk:undefined}).find(item=>item.source?.id===fixture.originalProof.id)?.state,"overdue");
  assert.equal(sourceDeadlineWorkItems(records,{...options,validationOk:false}).find(item=>item.source?.id===fixture.originalProof.id)?.state,"overdue");
  fixture.replacement.members[0].result="failed";
  assert.equal(sourceDeadlineWorkItems(records,options).find(item=>item.source?.id===fixture.originalProof.id)?.state,"overdue");
});

test("missing historical proof fails closed without crashing queue validation preflight", async context => {
  const { sourceDeadlineValidation } = await import("../src/work-queue.js");
  const root = await mkdtemp(join(tmpdir(), "filegrc-missing-historical-proof-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeWorkspace(root);
  const loaded = await loadWorkspace(root);
  const fixture = proofFixture();
  loaded.resources.push(...fixture.resources.filter(record => record.id !== fixture.originalProof.id));
  assert.equal(await sourceDeadlineValidation(loaded), false);
});
