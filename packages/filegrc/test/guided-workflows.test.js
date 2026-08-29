import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
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
import { runCli } from "../src/cli.js";
import { executeCli, makeWorkspace, writeJson } from "./helpers.js";
import { makeComprehensiveWorkspace } from "./fixtures.js";

const executeProcess = promisify(execFile);
const execute = (executable, args, options) => executable === process.execPath
  ? executeCli(runCli, executable, args, options)
  : executeProcess(executable, args, options);
const cli = fileURLToPath(new URL("../bin/filegrc.js", import.meta.url));

test("exposes action-specific Reporting Channel Set scaffolds through the CLI", async () => {
  const successor = JSON.parse((await execute(process.execPath, [
    cli,
    "reporting-route-set",
    "scaffold",
    "successor",
    "--id",
    "route-successor"
  ])).stdout);
  assert.equal(successor.routeSetId, "route-successor");
  assert.equal(successor.expectedRevision, "CURRENT_ROUTE_SET_REVISION");
  assert.equal(successor.predecessorExpectedRevision, "CURRENT_PREDECESSOR_REVISION");
  assert.deepEqual(successor.predecessorCancellationEvidenceIds, []);
});

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

test("reconciliation ignores inherited Git repository redirection", async (context) => {
  const root = await modelThreeWorkspace(context, "filegrc-reconcile-real-");
  await commitAll(root, "Create real reconciliation workspace");
  const personPath = join(root, "data", "people", "person-owner.json");
  const person = JSON.parse(await readFile(personPath, "utf8"));
  await writeJson(personPath, { ...person, jobTitle: "Security Director" });

  const alternate = await modelThreeWorkspace(context, "filegrc-reconcile-redirect-");
  await commitAll(alternate, "Create redirected workspace");
  const alternateGitDirectory = (await execute("git", ["rev-parse", "--absolute-git-dir"], { cwd: alternate })).stdout.trim();
  const priorGitDirectory = process.env.GIT_DIR;
  const priorGitWorkTree = process.env.GIT_WORK_TREE;
  try {
    process.env.GIT_DIR = alternateGitDirectory;
    process.env.GIT_WORK_TREE = alternate;
    const preview = await planReconciliation(root);
    assert.deepEqual(preview.candidates.map(({ eventType }) => eventType), ["person-role-changed"]);
  } finally {
    if (priorGitDirectory === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = priorGitDirectory;
    if (priorGitWorkTree === undefined) delete process.env.GIT_WORK_TREE;
    else process.env.GIT_WORK_TREE = priorGitWorkTree;
  }
});

test("one reconciled transition creates applicable actions across Programs", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-multi-program-reconcile-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "9");
  const controlSource = JSON.parse(await readFile(join(root, "data", "controls", "control-example.json"), "utf8"));
  const obligationSource = JSON.parse(await readFile(join(root, "data", "obligations", "obligation-example.json"), "utf8"));
  const ruleSource = JSON.parse(await readFile(join(root, "data", "obligation-rules", "obligation-rule-example.json"), "utf8"));
  await writeJson(join(root, "data", "controls", "control-program-b.json"), {
    ...controlSource,
    id: "control-program-b",
    title: "Program B access control"
  });
  await writeJson(join(root, "data", "programs", "program-b.json"), {
    id: "program-b",
    type: "program",
    title: "Program B",
    status: "active",
    controlIds: ["control-program-b"],
    policyIds: obligationSource.policyIds,
    systemIds: []
  });
  await writeJson(join(root, "data", "obligation-rules", "obligation-rule-program-b.json"), {
    ...ruleSource,
    id: "obligation-rule-program-b",
    title: "Program B role change rule",
    obligationId: "obligation-program-b"
  });
  await writeJson(join(root, "data", "obligations", "obligation-program-b.json"), {
    ...obligationSource,
    id: "obligation-program-b",
    title: "Program B role change review",
    controlIds: ["control-program-b"],
    activeRuleId: "obligation-rule-program-b",
    ruleIds: ["obligation-rule-program-b"]
  });
  await commitAll(root, "Create multi-program workspace");
  const personPath = join(root, "data", "people", "person-example.json");
  const person = JSON.parse(await readFile(personPath, "utf8"));
  await writeJson(personPath, { ...person, jobTitle: "Security Director" });

  const preview = await planReconciliation(root);
  const candidate = preview.candidates.find(({ eventType }) => eventType === "person-role-changed");
  assert.ok(candidate);
  const applied = await applyReconciliation(root, {
    candidateId: candidate.id,
    programId: "program-example",
    occurredOn: "2026-08-03",
    confirmed: true
  });
  assert.deepEqual(applied.event.obligationIds.sort(), ["obligation-example", "obligation-program-b"]);
  assert.equal(applied.actions.length, 2);
});

test("treats an uncommitted generated workspace as its baseline", async (context) => {
  const root = await modelThreeWorkspace(context, "filegrc-reconcile-baseline-");
  await execute("git", ["init", "--initial-branch=main"], { cwd: root });
  const preview = await planReconciliation(root);

  assert.equal(preview.gitRevision, null);
  assert.equal(preview.candidates.length, 0);
  assert.ok(preview.changedPaths.length > 0);
  assert.match(preview.message, /Commit the initial workspace/);
});

test("does not treat a record path rename as a domain transition", async (context) => {
  const root = await modelThreeWorkspace(context, "filegrc-reconcile-rename-");
  await commitAll(root, "Create test workspace");
  const prior = join(root, "data", "people", "person-owner.json");
  const destinationDirectory = join(root, "data", "people", "renamed");
  const next = join(destinationDirectory, "person-owner.json");
  await mkdir(destinationDirectory, { recursive: true });
  await rename(prior, next);

  const preview = await planReconciliation(root);
  assert.equal(preview.candidates.length, 0);
  assert.ok(preview.changedPaths.includes("data/people/person-owner.json"));
  assert.ok(preview.changedPaths.includes("data/people/renamed/person-owner.json"));
});

test("pairs a committed rename by immutable identity after a large content change", async (context) => {
  const root = await modelThreeWorkspace(context, "filegrc-reconcile-committed-rename-");
  await commitAll(root, "Create test workspace");
  const prior = join(root, "data", "people", "person-owner.json");
  const destinationDirectory = join(root, "data", "people", "renamed");
  const next = join(destinationDirectory, "person-owner.json");
  await mkdir(destinationDirectory, { recursive: true });
  const person = JSON.parse(await readFile(prior, "utf8"));
  person.jobTitle = "Chief Security Officer";
  person.extensions = { test: { padding: "x".repeat(10_000) } };
  await writeFile(next, `${JSON.stringify(person, null, 2)}\n`);
  await import("node:fs/promises").then(({ rm }) => rm(prior));
  await commitAll(root, "Move and update person");

  const preview = await planReconciliation(root);
  assert.deepEqual(preview.candidates.map(({ eventType }) => eventType), ["person-role-changed"]);
});

test("uses occurredAt for reconciliation backed by an active hour-based rule", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-rule-timestamp-reconcile-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "9");
  const loaded = await import("../src/index.js").then(({ loadWorkspace }) => loadWorkspace(root));
  const control = loaded.resources.find(({ type }) => type === "control");
  await writeJson(join(root, "data", "obligations", "obligation-hour-departure.json"), {
    id: "obligation-hour-departure",
    type: "obligation",
    title: "Hour-based departure action",
    status: "active",
    activityType: "access-removal",
    scheduleMode: "rule",
    ruleIds: ["obligation-rule-hour-departure"],
    activeRuleId: "obligation-rule-hour-departure",
    ownerIds: ["person-example"],
    controlIds: [control.id]
  });
  await writeJson(join(root, "data", "obligation-rules", "obligation-rule-hour-departure.json"), {
    id: "obligation-rule-hour-departure",
    type: "obligation-rule",
    title: "Hour-based departure rule",
    status: "active",
    obligationId: "obligation-hour-departure",
    activityDefinitionVersion: "1",
    recurrence: { mode: "event", eventType: "person-ended" },
    window: { precision: "timestamp", startsAfter: 0, dueAfter: 4 },
    rationale: "Test timestamp reconciliation.",
    approvedByIds: ["person-example"],
    approvedOn: "2026-01-01",
    effectiveAt: "2026-01-01T00:00:00Z",
    timezone: "UTC"
  });
  await commitAll(root, "Create model 9 workspace");
  const personPath = join(root, "data", "people", "person-example.json");
  const person = JSON.parse(await readFile(personPath, "utf8"));
  person.status = "inactive";
  await writeJson(personPath, person);

  const preview = await planReconciliation(root);
  const departure = preview.candidates.find(({ eventType }) => eventType === "person-ended");
  assert.ok(departure);
  assert.ok(departure.requiredFacts.includes("occurredAt"));
  assert.match(departure.action.command, /--occurred-at RFC3339/);
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

test("reconciles a committed Markdown-only change to an active Policy", async (context) => {
  const root = await modelThreeWorkspace(context, "filegrc-policy-markdown-reconcile-");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(join(root, "data", "policies"), { recursive: true }));
  const recordPath = join(root, "data", "policies", "policy-active.json");
  const contentPath = join(root, "data", "policies", "policy-active.md");
  await writeJson(recordPath, {
    id: "policy-active",
    type: "policy",
    title: "Active Policy",
    status: "active",
    ownerIds: ["person-owner"],
    approverIds: ["person-approver"],
    approvedOn: "2026-08-01",
    effectiveOn: "2026-08-01",
    policyKind: "information-security",
    programRole: "required"
  });
  await writeFile(contentPath, "# Active Policy\n\nInitial approved content.\n", "utf8");
  await commitAll(root, "Add active policy");
  await writeFile(contentPath, "# Active Policy\n\nMaterially revised content.\n", "utf8");
  await commitAll(root, "Revise policy content");

  const preview = await planReconciliation(root);
  assert.deepEqual(preview.candidates.map(({ eventType }) => eventType), ["policy-revised"]);
  assert.equal(preview.candidates[0].subject.id, "policy-active");
});

test("does not treat an external reviewer as a workforce start", async (context) => {
  const root = await modelThreeWorkspace(context, "filegrc-external-reviewer-reconcile-");
  await commitAll(root, "Create test workspace");
  await writeJson(join(root, "data", "people", "person-external-reviewer.json"), {
    id: "person-external-reviewer",
    type: "person",
    title: "External Reviewer",
    status: "active",
    affiliation: "external",
    organization: "Independent reviewer",
    jobTitle: "Principal"
  });

  assert.equal((await planReconciliation(root)).candidates.length, 0);
});

test("previews and applies the external-reviewer bundle without inferring company size", async (context) => {
  const started = performance.now();
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
  const elapsed = performance.now() - started;
  context.diagnostic(`external reviewer workflow ${elapsed.toFixed(1)} ms`);
  assert.ok(elapsed < 3_000, `expected the external reviewer workflow under 3 seconds, received ${elapsed.toFixed(1)} ms`);
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
  assert.match(scaffold.basis.scopeRevision, /^(?:[a-f0-9]{40}|uncommitted:[a-f0-9]{64})$/);
  assert.deepEqual(scaffold.decisions, [{
    id: "requirement-access",
    decision: null,
    rationale: null
  }]);
  const options = {
    basis: scaffold.basis,
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
  assert.match(requirement.applicabilityReview.scopeRevision, /^scope:[a-f0-9]{64}$/);
  await writeJson(join(root, "data", "requirements", "requirement-access.json"), {
    ...requirement,
    description: "Access now includes the production support boundary."
  });
  const stale = await scaffoldApplicabilityReview(root, { type: "requirement" });
  assert.deepEqual(stale.decisions.map(({ id }) => id), ["requirement-access"]);
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
