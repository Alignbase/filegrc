import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  applyReconciliation,
  applyApplicabilityReview,
  assessWorkflow,
  createNextAuditCycle,
  createObligationEvent,
  planNextAuditCycle,
  planApplicabilityReview,
  planExternalReviewerGovernance,
  planReconciliation,
  scaffoldApplicabilityReview,
  scaffoldExternalReviewerGovernance,
  scaffoldResourceMutation,
  setupExternalReviewerGovernance
} from "../src/index.js";
import { makeWorkspace, writeJson } from "./helpers.js";

const execute = promisify(execFile);
const cli = fileURLToPath(new URL("../bin/filegrc.js", import.meta.url));

test("reconciles a direct-file role change only after explicit event facts", async (context) => {
  const root = await modelThreeWorkspace(context, "filegrc-reconcile-");
  await writeJson(join(root, "data", "obligations", "obligation-role-change.json"), {
    id: "obligation-role-change",
    type: "obligation",
    title: "Review access after a role change",
    status: "active",
    activityType: "access-change",
    recurrence: { mode: "event", eventType: "person-role-changed" },
    window: { precision: "date", startsAfter: 0, dueAfter: 3 },
    ownerIds: ["person-owner"],
    completionResourceIds: []
  });
  await commitAll(root, "Create test workspace");
  const path = join(root, "data", "people", "person-owner.json");
  const person = JSON.parse(await readFile(path, "utf8"));
  person.jobTitle = "Chief Security Officer";
  await writeJson(path, person);

  const preview = await planReconciliation(root);
  assert.equal(preview.candidates.length, 1);
  assert.equal(preview.candidates[0].eventType, "person-role-changed");
  await assert.rejects(
    applyReconciliation(root, {
      candidateId: preview.candidates[0].id,
      occurredOn: "2026-08-03"
    }),
    /confirm/
  );
  const applied = await applyReconciliation(root, {
    candidateId: preview.candidates[0].id,
    occurredOn: "2026-08-03",
    confirmed: true
  });
  assert.equal(applied.actions.length, 1);
  assert.equal((await planReconciliation(root)).candidates.length, 0);
});

test("does not treat initial draft policy adoption as a policy revision event", async (context) => {
  const root = await modelThreeWorkspace(context, "filegrc-policy-adoption-");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(join(root, "data", "policies"), { recursive: true }));
  const path = join(root, "data", "policies", "policy-initial.json");
  await writeJson(path, {
    id: "policy-initial",
    type: "policy",
    title: "Initial Policy",
    status: "draft",
    ownerIds: ["person-owner"],
    policyKind: "information-security",
    programRole: "required"
  });
  await commitAll(root, "Create draft policy");
  const policy = JSON.parse(await readFile(path, "utf8"));
  policy.status = "active";
  policy.approverIds = ["person-approver"];
  policy.approvedOn = "2026-08-03";
  policy.effectiveOn = "2026-08-03";
  await writeJson(path, policy);

  assert.equal((await planReconciliation(root)).candidates.length, 0);
});

test("previews and applies the external-reviewer bundle without inferring company size", async (context) => {
  const root = await modelThreeWorkspace(context, "filegrc-external-reviewer-");
  const scaffold = await scaffoldExternalReviewerGovernance(root);
  assert.equal(scaffold.reviewerName, null);
  assert.equal(scaffold.jobTitle, null);
  assert.match(scaffold.startsOn, /^\d{4}-\d{2}-\d{2}$/);
  const cliScaffold = JSON.parse((await execute(process.execPath, [
    cli,
    "external-reviewer-setup",
    "--scaffold",
    "--root",
    root
  ])).stdout);
  assert.equal(cliScaffold.independenceRationale, null);
  await writeJson(join(root, "data", "people", "person-engineering-lead.json"), {
    id: "person-engineering-lead",
    type: "person",
    title: "Engineering Lead",
    status: "active",
    affiliation: "internal",
    jobTitle: "Engineering Lead"
  });
  await writeJson(join(root, "data", "people", "person-operations-lead.json"), {
    id: "person-operations-lead",
    type: "person",
    title: "Operations Lead",
    status: "active",
    affiliation: "internal",
    jobTitle: "Operations Lead"
  });
  const options = {
    reviewerName: "Taylor Reviewer",
    jobTitle: "Principal Consultant",
    email: "reviewer@example.test",
    organization: "Independent Review LLC",
    startsOn: "2026-08-03",
    independenceRationale: "Taylor has no ownership or operating role in the company."
  };
  const payloadPath = join(root, "external-reviewer.json");
  await writeJson(payloadPath, options);
  const cliPreview = JSON.parse((await execute(process.execPath, [
    cli,
    "external-reviewer-setup",
    payloadPath,
    "--preview",
    "--json"
  ], { cwd: root })).stdout);
  assert.equal(cliPreview.operation, "external-reviewer-governance");
  assert.equal(cliPreview.changes.create.find(({ type }) => type === "person").jobTitle, "Principal Consultant");
  const preview = await planExternalReviewerGovernance(root, options);
  assert.equal(preview.changes.create.length, 3);
  assert.equal(preview.changes.update.length, 0);
  await assert.rejects(setupExternalReviewerGovernance(root, options), /confirm/);
  const applied = await setupExternalReviewerGovernance(root, { ...options, confirmed: true });
  assert.equal(applied.appointmentIds.length, 1);
  const loaded = await import("../src/index.js").then(({ loadWorkspace }) => loadWorkspace(root));
  assert.deepEqual(
    loaded.resources.find(({ type }) => type === "team")?.chairIds,
    applied.appointmentIds
  );
  const workflow = await assessWorkflow(root);
  assert.equal(
    workflow.findings.find(({ code }) => code === "governance.appointment.independent-policy-reviewer")?.state,
    "complete"
  );
});

test("carries a Type 1 scope into a reviewable Type 2 planning record", async (context) => {
  const root = await modelThreeWorkspace(context, "filegrc-audit-cycle-");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(join(root, "data", "audits"), { recursive: true }));
  await import("node:fs/promises").then(({ mkdir }) => mkdir(join(root, "data", "frameworks"), { recursive: true }));
  await writeJson(join(root, "data", "frameworks", "framework-soc-2.json"), {
    id: "framework-soc-2",
    type: "framework",
    title: "SOC 2",
    status: "active",
    version: "test"
  });
  await writeJson(join(root, "data", "audits", "audit-type-1.json"), {
    id: "audit-type-1",
    type: "audit",
    title: "2026 SOC 2 Type 1",
    status: "complete",
    auditKind: "soc-2-type-1",
    frameworkIds: ["framework-soc-2"],
    scope: "Production service",
    ownerIds: ["person-owner"],
    systemIds: [],
    requirementIds: [],
    controlIds: [],
    coverage: { kind: "as-of", on: "2026-08-01" },
    scopeRevision: "reviewed-type-1-scope"
  });
  const options = {
    priorAuditId: "audit-type-1",
    startsOn: "2026-08-02",
    endsOn: "2026-12-31"
  };
  const preview = await planNextAuditCycle(root, options);
  assert.equal(preview.operation, "type-1-to-type-2");
  assert.equal(preview.audit.priorAuditId, "audit-type-1");
  assert.equal(preview.audit.status, "planned");
  await assert.rejects(createNextAuditCycle(root, options), /confirm/);
  const created = await createNextAuditCycle(root, { ...options, confirmed: true });
  assert.equal(created.audit.auditKind, "soc-2-type-2");
});

test("records reviewed applicability decisions as one atomic batch", async (context) => {
  const root = await modelThreeWorkspace(context, "filegrc-applicability-");
  await import("node:fs/promises").then(({ mkdir }) => Promise.all([
    mkdir(join(root, "data", "frameworks"), { recursive: true }),
    mkdir(join(root, "data", "requirements"), { recursive: true })
  ]));
  await writeJson(join(root, "data", "frameworks", "framework-soc-2.json"), {
    id: "framework-soc-2",
    type: "framework",
    title: "SOC 2",
    status: "active",
    version: "test"
  });
  await writeJson(join(root, "data", "requirements", "requirement-access.json"), {
    id: "requirement-access",
    type: "requirement",
    title: "Access criterion",
    frameworkId: "framework-soc-2",
    reference: "CC6.1",
    applicability: "undetermined"
  });
  const scaffold = await scaffoldApplicabilityReview(root, { type: "requirement" });
  assert.equal(Object.hasOwn(scaffold, "scopeRevision"), false);
  assert.deepEqual(scaffold.decisions, [{
    id: "requirement-access",
    decision: null,
    rationale: null
  }]);
  const options = {
    reviewedByIds: ["person-owner"],
    reviewedOn: "2026-08-03",
    decisions: [{
      id: "requirement-access",
      decision: "applicable",
      rationale: "The production service uses logical access controls."
    }]
  };
  const preview = await planApplicabilityReview(root, options);
  assert.equal(preview.reviewedIds.length, 1);
  await assert.rejects(applyApplicabilityReview(root, options), /confirm/);
  await applyApplicabilityReview(root, { ...options, confirmed: true });
  const requirement = JSON.parse(await readFile(
    join(root, "data", "requirements", "requirement-access.json"),
    "utf8"
  ));
  assert.equal(requirement.applicability, "applicable");
  assert.equal(requirement.applicabilityReview.scopeRevision, "uncommitted");
});

test("uses one departure event and adds high-risk steps only when selected", async (context) => {
  const root = await modelThreeWorkspace(context, "filegrc-departure-");
  for (const [id, title, riskLevels] of [
    ["obligation-departure-normal", "Revoke departing-worker access", undefined],
    ["obligation-departure-high", "Revoke access at notice", ["high"]]
  ]) {
    await writeJson(join(root, "data", "obligations", `${id}.json`), {
      id,
      type: "obligation",
      title,
      status: "active",
      activityType: "access-removal",
      recurrence: { mode: "event", eventType: "person-ended" },
      ...(riskLevels ? { eventRiskLevels: riskLevels } : {}),
      window: { precision: "timestamp", startsAfter: 0, dueAfter: riskLevels ? 0 : 24 },
      ownerIds: ["person-owner"],
      completionResourceIds: []
    });
  }
  const normal = await createObligationEvent(root, {
    eventType: "person-ended",
    occurredAt: "2026-08-03T14:00:00Z",
    riskLevel: "normal",
    subjectResourceIds: ["person-owner"]
  });
  assert.equal(normal.actions.length, 1);
  const high = await createObligationEvent(root, {
    eventType: "person-ended",
    occurredAt: "2026-08-04T14:00:00Z",
    riskLevel: "high",
    subjectResourceIds: ["person-owner"]
  });
  assert.equal(high.actions.length, 2);
});

test("prefills custom appointment identity and workspace scope", async (context) => {
  const root = await modelThreeWorkspace(context, "filegrc-appointment-scaffold-");
  const loaded = await import("../src/index.js").then(({ loadWorkspace }) => loadWorkspace(root));
  const mutation = scaffoldResourceMutation(loaded, "appointment", "Incident Response Lead");
  assert.equal(mutation.record.appointmentKind, "incident-response-lead");
  assert.deepEqual(mutation.record.scopeResourceIds, ["workspace"]);
});

test("prefills a planned audit from the current management scope and Policy Owner", async (context) => {
  const root = await modelThreeWorkspace(context, "filegrc-audit-scaffold-");
  const workspacePath = join(root, "data", "workspace.json");
  const workspace = JSON.parse(await readFile(workspacePath, "utf8"));
  await writeJson(workspacePath, {
    ...workspace,
    assuranceGoal: "soc-2-type-2",
    frameworkIds: ["framework-soc2"],
    systemIds: ["system-service"],
    requirementIds: ["requirement-security"],
    controlIds: ["control-access"]
  });
  await import("node:fs/promises").then(({ mkdir }) => mkdir(join(root, "data", "appointments"), { recursive: true }));
  await writeJson(join(root, "data", "appointments", "appointment-policy-owner.json"), {
    id: "appointment-policy-owner",
    type: "appointment",
    title: "Policy Owner",
    status: "active",
    appointmentKind: "policy-owner",
    holderId: "person-owner",
    startsOn: "2026-08-03",
    scopeResourceIds: ["workspace"]
  });
  const loaded = await import("../src/index.js").then(({ loadWorkspace }) => loadWorkspace(root));
  const mutation = scaffoldResourceMutation(loaded, "audit", "2027 SOC 2 Type 2");
  assert.equal(mutation.record.status, "planned");
  assert.equal(mutation.record.auditKind, "soc-2-type-2");
  assert.deepEqual(mutation.record.frameworkIds, ["framework-soc2"]);
  assert.deepEqual(mutation.record.systemIds, ["system-service"]);
  assert.deepEqual(mutation.record.requirementIds, ["requirement-security"]);
  assert.deepEqual(mutation.record.controlIds, ["control-access"]);
  assert.deepEqual(mutation.record.ownerIds, ["appointment-policy-owner"]);
  assert.equal(mutation.record.coverage, undefined);
});

async function modelThreeWorkspace(context, prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const workspacePath = join(root, "data", "workspace.json");
  const workspace = JSON.parse(await readFile(workspacePath, "utf8"));
  workspace.dataModelVersion = "3";
  await writeJson(workspacePath, workspace);
  await import("node:fs/promises").then(({ mkdir }) => mkdir(join(root, "data", "obligations"), { recursive: true }));
  return root;
}

async function commitAll(root, message) {
  await execute("git", ["init", "--initial-branch=main"], { cwd: root });
  await execute("git", ["config", "user.name", "Test User"], { cwd: root });
  await execute("git", ["config", "user.email", "test@example.test"], { cwd: root });
  await execute("git", ["add", "."], { cwd: root });
  await execute("git", ["commit", "-m", message], { cwd: root });
}
