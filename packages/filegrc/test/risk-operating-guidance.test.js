import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadModel } from "../model/index.js";
import { assessWorkflow } from "../src/workflow.js";
import { loadWorkspace } from "../src/workspace.js";
import { makeWorkspace } from "./helpers.js";

async function riskFixture(context) {
  const root = await mkdtemp(join(tmpdir(), "filegrc-risk-guidance-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeWorkspace(root);
  const loaded = await loadWorkspace(root);
  loaded.model = loadModel("13");
  const program = { id: "program-example", type: "program", status: "active", assuranceGoal: "none", controlIds: [], systemIds: [] };
  const risk = { id: "risk-example", type: "risk", title: "Continuing service risk", status: "open", description: "A managed operational exposure.", categories: ["security"], ownerIds: ["person-owner"], response: "mitigate", inherentRating: { likelihood: 2, impact: 3 }, reviewDueOn: "2026-10-15", treatmentTargetOn: "2026-10-20" };
  const assessment = { id: "risk-assessment-example", type: "risk-assessment", status: "complete", riskIds: [risk.id], assessorIds: ["person-owner"], reviewerIds: ["person-approver"], completedOn: "2026-09-20", approvedOn: "2026-09-21", evidenceIds: ["evidence-example"] };
  loaded.resources.push(program, risk, assessment);
  const assess = () => assessWorkflow(loaded, {
    asOf: "2026-10-01", now: "2026-10-01T12:00:00Z", programId: program.id,
    programReadiness: { stages: [], evidenceReady: true, program: { id: program.id } }, auditPreparations: {},
    obligations: { items: [], triggers: [], counts: {}, asOf: "2026-10-01", through: "2026-11-01" },
    validation: { ok: true, diagnostics: [], counts: {} }, reconciliation: { candidates: [] }, git: {}
  });
  return { loaded, risk, assessment, assess };
}

function riskFinding(workflow, risk) {
  return workflow.findings.find(({ code, subject }) => code.endsWith(".finalize") && subject?.id === risk.id);
}

test("reviewed open and monitoring risks with future checkpoints remain scheduled without generic closure pressure", async (context) => {
  const { risk, assess } = await riskFixture(context);
  for (const status of ["open", "monitoring"]) {
    risk.status = status;
    const workflow = await assess();
    const finding = riskFinding(workflow, risk);
    assert.equal(finding?.state, "scheduled", status);
    assert.match(finding.message, /2026-10-15/);
    assert.doesNotMatch(finding.message, /Complete this work with the required proof|formally close it|Finish the work, record the result/);
    const work = workflow.workItems.find(({ source }) => source?.id === risk.id);
    assert.equal(work?.state, "scheduled", status);
    assert.equal(work?.dueOn, "2026-10-15", status);
  }
});

test("missing ownership, decision, rating, independent approved assessment or required checkpoint stays actionable", async (context) => {
  const fixture = await riskFixture(context);
  const baselineRisk = structuredClone(fixture.risk), baselineAssessment = structuredClone(fixture.assessment);
  for (const [label, mutate] of [
    ["owner", ({ risk }) => { risk.ownerIds = []; }],
    ["response", ({ risk }) => { delete risk.response; }],
    ["rating", ({ risk }) => { delete risk.inherentRating; }],
    ["incomplete assessment", ({ assessment }) => { assessment.status = "in-progress"; }],
    ["unrelated assessment", ({ assessment }) => { assessment.riskIds = ["risk-other"]; }],
    ["missing completion date", ({ assessment }) => { delete assessment.completedOn; }],
    ["missing approval", ({ assessment }) => { delete assessment.approvedOn; }],
    ["approval before completion", ({ assessment }) => { assessment.approvedOn = "2026-09-19"; }],
    ["future approval", ({ assessment }) => { assessment.approvedOn = "2026-10-02"; }],
    ["dependent reviewer", ({ assessment }) => { assessment.reviewerIds = ["person-owner"]; }],
    ["missing reviewer", ({ assessment }) => { assessment.reviewerIds = []; }],
    ["missing assessor", ({ assessment }) => { assessment.assessorIds = []; }],
    ["missing proof", ({ assessment }) => { assessment.evidenceIds = []; }],
    ["review deadline", ({ risk }) => { delete risk.reviewDueOn; }],
    ["mitigation deadline", ({ risk }) => { delete risk.treatmentTargetOn; }]
  ]) {
    for (const key of Object.keys(fixture.risk)) delete fixture.risk[key];
    for (const key of Object.keys(fixture.assessment)) delete fixture.assessment[key];
    Object.assign(fixture.risk, structuredClone(baselineRisk));
    Object.assign(fixture.assessment, structuredClone(baselineAssessment));
    mutate(fixture);
    assert.equal(riskFinding(await fixture.assess(), fixture.risk)?.state, "ready", label);
  }
});

test("earliest overdue review or treatment remains due without closing an unresolved risk", async (context) => {
  const { risk, assess } = await riskFixture(context);
  for (const [reviewDueOn, treatmentTargetOn, expected] of [
    ["2026-09-30", "2026-10-20", "2026-09-30"],
    ["2026-10-15", "2026-09-29", "2026-09-29"],
    ["2026-09-30", "2026-09-28", "2026-09-28"]
  ]) {
    Object.assign(risk, { reviewDueOn, treatmentTargetOn });
    const workflow = await assess();
    assert.ok(["ready", "overdue"].includes(riskFinding(workflow, risk)?.state));
    const work = workflow.workItems.find(({ source }) => source?.id === risk.id);
    assert.equal(work?.state, "overdue");
    assert.equal(work?.dueOn, expected);
    assert.equal(risk.status, "open");
  }
});

test("expired or missing acceptance stays actionable and expiry is the earliest real checkpoint", async context => {
  const { risk, assess } = await riskFixture(context);
  risk.response = "accept";
  for (const acceptance of [undefined, { rationale: "Time-limited acceptance.", acceptedByIds: ["person-owner"], acceptedOn: "2026-09-20", expiresOn: "2026-09-30" }]) {
    risk.acceptance = acceptance;
    const workflow = await assess();
    assert.equal(riskFinding(workflow, risk).state, "ready");
    if (acceptance) {
      const work = workflow.workItems.find(item => item.source?.id === risk.id);
      assert.equal(work.state, "overdue");
      assert.equal(work.dueOn, "2026-09-30");
    }
  }
});

test("assessors are checked at completion while independent reviewers are checked at approval", async context => {
  const { loaded, risk, assessment, assess } = await riskFixture(context);
  const assessor = loaded.resources.find(record => record.id === "person-owner");
  const before = structuredClone(assessor);
  // The operating owner is separate from the assessor who left after completing the work.
  risk.ownerIds = ["person-approver"];
  Object.assign(assessor, { status: "inactive", startDate: "2026-01-01", endDate: "2026-09-20" });
  assert.equal(riskFinding(await assess(), risk).state, "scheduled");
  assessor.endDate = "2026-09-19";
  assert.equal(riskFinding(await assess(), risk).state, "ready");
  Object.assign(assessor, before);
});
