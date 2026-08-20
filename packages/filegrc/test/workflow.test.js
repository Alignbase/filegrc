import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assessWorkflow,
  buildWorkflowDelta,
  createAppState,
  loadWorkspace,
  previewWorkflowMutation,
  serveWorkspace,
  updateResource,
  workflowForResource,
  WORKFLOW_CONTRACT_VERSION
} from "../src/index.js";
import { packetDeliveryIssue } from "../src/workflow.js";
import { makeWorkspace, writeJson } from "./helpers.js";

test("requires a reviewable, approved, and receipted packet delivery record", () => {
  assert.match(packetDeliveryIssue(null), /least-disclosure review/);
  const delivery = {
    classificationReviewedByIds: ["person-reviewer"],
    classificationReviewedOn: "2026-07-01",
    redactionDecision: "No redactions were required.",
    recipient: "Engagement team portal",
    deliverySystem: "Approved auditor portal",
    packetCommit: "a".repeat(40),
    manifestChecksum: `sha256:${"b".repeat(64)}`,
    approvedByIds: ["person-approver"],
    approvedOn: "2026-07-02",
    deliveredOn: "2026-07-03",
    receiptReference: "Portal receipt 123"
  };
  assert.equal(packetDeliveryIssue(delivery), null);
  assert.match(packetDeliveryIssue({ ...delivery, receiptReference: "" }), /receipt reference/);
  assert.match(packetDeliveryIssue({ ...delivery, packetCommit: "draft" }), /40-character Git commit/);
  assert.match(packetDeliveryIssue({ ...delivery, manifestChecksum: "not-a-digest" }), /SHA-256/);
  assert.match(packetDeliveryIssue({ ...delivery, approvedOn: "2026-06-30" }), /chronological/);
});

test("returns one reproducible workflow contract with stable findings", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-workflow-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);

  const first = await assessWorkflow(root, {
    asOf: "2026-08-03",
    evaluatedAt: "2026-08-03T12:00:00Z"
  });
  const second = await assessWorkflow(root, {
    asOf: "2026-08-03",
    evaluatedAt: "2026-08-03T12:00:00Z"
  });

  assert.equal(first.contractVersion, WORKFLOW_CONTRACT_VERSION);
  assert.equal(first.dataModelVersion, "2");
  assert.equal(first.input.asOf, "2026-08-03");
  assert.equal(first.input.timezone, "UTC");
  assert.deepEqual(first.findings, second.findings);
  assert.ok(first.findings.length > 0);
  assert.equal(new Set(first.findings.map(({ key }) => key)).size, first.findings.length);
  assert.ok(first.recommended);
  assert.equal(first.recommended.key, "program.scope.program-goal");
  assert.match(first.recommended.rankingReason, /can be acted on now/);
  assert.equal(first.assessments.programConfiguration.status, "needs-work");
  assert.equal(first.assessments.periodHealth.status, "not-started");
  assert.deepEqual(first.assessments.periodHealth.findingKeys, []);
  assert.equal(first.assessments.auditReadiness.status, "not-started");
  assert.equal(first.findings.every(({ code, state, severity }) => code && state && severity), true);

  const workspace = (await loadWorkspace(root)).workspace;
  const scoped = workflowForResource(first, "workspace", workspace.id);
  assert.equal(scoped.contractVersion, WORKFLOW_CONTRACT_VERSION);
  assert.ok(scoped.findings.some(({ code }) => code === "program.scope.program-goal"));

  const preview = await previewWorkflowMutation(root, {
    operation: "update",
    record: {
      ...workspace,
      assuranceGoal: "readiness"
    }
  });
  assert.equal(preview.operation, "update");
  assert.ok(preview.workflowDelta.findings.changed.some(({ key, after: state }) => (
    key === "program.scope.program-goal" && state === "complete"
  )));
  assert.equal((await loadWorkspace(root)).workspace.assuranceGoal, workspace.assuranceGoal);

  await updateResource(root, "workspace", workspace.id, {
    ...workspace,
    assuranceGoal: "readiness"
  });
  const after = await assessWorkflow(root, {
    asOf: "2026-08-03",
    evaluatedAt: "2026-08-03T12:00:00Z"
  });
  const delta = buildWorkflowDelta(first, after);
  assert.equal(delta.contractVersion, WORKFLOW_CONTRACT_VERSION);
  assert.ok(delta.findings.changed.some(({ key, after: state }) => (
    key === "program.scope.program-goal" && state === "complete"
  )));

  const state = await createAppState(root, {
    asOf: "2026-08-03",
    includeDetails: false
  });
  assert.equal(state.workflow.contractVersion, WORKFLOW_CONTRACT_VERSION);

  const running = await serveWorkspace(root, { port: 0 });
  context.after(() => new Promise((resolve) => running.server.close(resolve)));
  const response = await fetch(`${running.url}/api/workflow?asOf=2026-08-03`);
  assert.equal(response.status, 200);
  const apiWorkflow = await response.json();
  assert.equal(apiWorkflow.contractVersion, WORKFLOW_CONTRACT_VERSION);
  assert.equal(apiWorkflow.input.asOf, "2026-08-03");
  assert.equal(apiWorkflow.recommended.key, "program.scope.program-ownership");

  const previewResponse = await fetch(`${running.url}/api/workflow/preview`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operation: "update",
      record: {
        ...(await loadWorkspace(root)).workspace,
        assuranceGoal: "soc-2-type-1"
      }
    })
  });
  assert.equal(previewResponse.status, 200);
  assert.equal((await previewResponse.json()).operation, "update");
});

test("offers legacy Policy consolidation as a review proposal without changing established content", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-policy-library-review-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await mkdir(join(root, "data", "policies"), { recursive: true });
  const records = [
    ["policy-clear-desk-screen", "Clear Desk and Clear Screen Policy"],
    ["policy-mobile-computing-communications", "Mobile Computing and Communications Policy"],
    ["policy-data-protection-handling", "Data Protection and Handling Policy"],
    ["policy-employee-handbook", "Employee Handbook"]
  ];
  for (const [id, title] of records) {
    await writeJson(join(root, "data", "policies", `${id}.json`), {
      id,
      type: "policy",
      title,
      status: "draft",
      ownerIds: ["person-owner"]
    });
    await writeFile(join(root, "data", "policies", `${id}.md`), `# ${title}\n\nOrganization-authored content that must remain unchanged.\n`, "utf8");
  }
  const before = await Promise.all(records.map(([id]) => readFile(join(root, "data", "policies", `${id}.md`), "utf8")));
  const workflow = await assessWorkflow(root, {
    asOf: "2026-08-03",
    evaluatedAt: "2026-08-03T12:00:00Z"
  });
  assert.equal(workflow.assessments.policyLibraryReview.status, "review");
  assert.equal(workflow.assessments.policyLibraryReview.proposals[0].id, "consolidate-soc2-security-policy");
  assert.deepEqual(
    new Set(workflow.assessments.policyLibraryReview.proposals[0].policyIds),
    new Set(records.map(([id]) => id))
  );
  assert.match(workflow.assessments.policyLibraryReview.proposals[0].message, /never rewrites established content/);
  const after = await Promise.all(records.map(([id]) => readFile(join(root, "data", "policies", `${id}.md`), "utf8")));
  assert.deepEqual(after, before);
});

test("keeps planned record dates proposed instead of presenting them as due work", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-workflow-draft-date-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await import("node:fs/promises").then(({ mkdir }) => mkdir(join(root, "data", "audits"), { recursive: true }));
  await writeJson(join(root, "data", "audits", "audit-planned.json"), {
    id: "audit-planned",
    type: "audit",
    title: "Planned audit",
    status: "planned",
    auditKind: "soc-2-type-1",
    frameworkIds: [],
    scope: "Test service",
    ownerIds: ["person-owner"],
    systemIds: [],
    requirementIds: [],
    controlIds: [],
    fieldworkStart: "2026-08-03",
    coverage: { kind: "as-of", on: "2026-08-03" }
  });

  const workflow = await assessWorkflow(root, {
    asOf: "2026-08-03",
    evaluatedAt: "2026-08-03T12:00:00Z"
  });
  const item = workflow.workItems.find(({ source }) => source?.id === "audit-planned");
  assert.equal(item.state, "proposed");
  assert.notEqual(workflow.recommended.key, item.key);
});

test("marks immediately actionable record work ready and reserves blocked for named prerequisites", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-workflow-ready-records-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const loaded = await loadWorkspace(root);
  await writeJson(join(root, "data", "workspace.json"), {
    ...loaded.workspace,
    dataModelVersion: "3"
  });
  await import("node:fs/promises").then(({ mkdir }) => Promise.all([
    mkdir(join(root, "data", "controls"), { recursive: true }),
    mkdir(join(root, "data", "documents"), { recursive: true })
  ]));
  await writeJson(join(root, "data", "documents", "document-incident-response.json"), {
    id: "document-incident-response",
    type: "document",
    title: "Incident Response Plan",
    status: "draft",
    ownerIds: ["person-owner"]
  });
  await writeJson(join(root, "data", "documents", "document-business-continuity.json"), {
    id: "document-business-continuity",
    type: "document",
    title: "Business Continuity and Disaster Recovery Plan",
    status: "draft",
    ownerIds: ["person-owner"]
  });
  await writeJson(join(root, "data", "controls", "control-workforce.json"), {
    id: "control-workforce",
    type: "control",
    title: "Workforce lifecycle",
    code: "HR-01",
    status: "planned",
    statement: "Manage workforce lifecycle changes.",
    ownerIds: ["person-owner"],
    requirementIds: ["requirement-not-created"],
    activity: "Review workforce changes.",
    operationMode: "manual",
    operationPattern: "event-driven"
  });

  const workflow = await assessWorkflow(root, {
    asOf: "2026-08-03",
    evaluatedAt: "2026-08-03T12:00:00Z"
  });
  for (const kind of ["policy-owner", "independent-policy-reviewer"]) {
    const finding = workflow.findings.find(({ code }) => code === `governance.appointment.${kind}`);
    assert.equal(finding.state, "ready");
    assert.match(finding.actions[0].command, /scaffold appointment/);
  }
  assert.equal(
    workflow.findings.some(({ code }) => code === "governance.appointment.incident-response-lead"),
    false
  );
  assert.equal(
    workflow.findings.some(({ code }) => code === "governance.appointment.technical-recovery-lead"),
    false
  );
  const coverage = workflow.findings.find(({ code }) => code === "evidence-source.workforce.coverage");
  assert.equal(coverage.state, "ready");
  assert.match(coverage.actions[0].command, /scaffold source-coverage/);
  const structural = workflow.findings.find(({ key }) => key.startsWith("structural."));
  assert.equal(structural.state, "ready");
  assert.equal(workflow.findings.filter(({ state }) => state === "blocked").length, 0);
});

test("guides blocked Action Items to their named blockers in every interface", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-workflow-blocked-action-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const loaded = await loadWorkspace(root);
  await writeJson(join(root, "data", "workspace.json"), {
    ...loaded.workspace,
    dataModelVersion: "3",
    assuranceGoal: "readiness",
    candidateCoverage: {
      kind: "range",
      startsOn: "2026-08-01",
      endsOn: "2026-08-31"
    }
  });
  await import("node:fs/promises").then(({ mkdir }) => mkdir(join(root, "data", "action-items"), { recursive: true }));
  await writeJson(join(root, "data", "action-items", "action-item-blocked.json"), {
    id: "action-item-blocked",
    type: "action-item",
    title: "Resolve the blocked task",
    status: "blocked",
    assigneeIds: ["person-owner"],
    sourceResourceId: "person-approver",
    blockingResourceIds: ["person-owner"],
    completionWindow: {
      precision: "date",
      startsOn: "2026-08-01",
      dueOn: "2026-08-15",
      overdueOn: "2026-08-16"
    }
  });

  const workflow = await assessWorkflow(root, {
    asOf: "2026-08-03",
    evaluatedAt: "2026-08-03T12:00:00Z"
  });
  const workItem = workflow.workItems.find(({ source }) => source?.id === "action-item-blocked");
  assert.equal(workItem.state, "blocked");
  assert.equal(workItem.blockingReason, "Blocked by Program Owner.");
  assert.deepEqual(workItem.dependencies.map(({ id }) => id), ["person-owner"]);
  assert.equal(workItem.nextAction.command, "npx filegrc get action-item-blocked --mutation");
  const periodFinding = workflow.findings.find(({ key }) => (
    key.startsWith("period.obligation.") && key.includes("action-item-blocked")
  ));
  assert.equal(periodFinding.state, "blocked");
  assert.equal(periodFinding.message, "Blocked by Program Owner.");
  assert.deepEqual(periodFinding.dependencies.map(({ id }) => id), ["person-owner"]);
  assert.equal(
    workflow.findings.some(({ key }) => key === "record.action-item.action-item-blocked.finalize"),
    false
  );
  assert.equal(workflow.findings.filter(({ state }) => state === "blocked").every(({ dependencies }) => (
    dependencies.length > 0
  )), true);
  assert.equal(workflow.workItems.filter(({ state }) => state === "blocked").every(({ dependencies }) => (
    dependencies.length > 0
  )), true);
  const firstBlocked = workflow.findings.findIndex(({ state }) => state === "blocked");
  const lastReady = workflow.findings.findLastIndex(({ state }) => state === "ready");
  assert.ok(firstBlocked > lastReady);
});

test("keeps audit-only roles out of period coverage and guides every late audit state", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-workflow-audit-lifecycle-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const loaded = await loadWorkspace(root);
  await writeJson(join(root, "data", "workspace.json"), {
    ...loaded.workspace,
    dataModelVersion: "3",
    assuranceGoal: "soc-2-type-2",
    candidateCoverage: {
      kind: "range",
      startsOn: "2026-01-01",
      endsOn: "2026-06-30"
    }
  });
  await import("node:fs/promises").then(({ mkdir }) => mkdir(join(root, "data", "audits"), { recursive: true }));
  await writeJson(join(root, "data", "audits", "audit-issued.json"), {
    id: "audit-issued",
    type: "audit",
    title: "Issued audit",
    status: "issued",
    auditKind: "soc-2-type-2",
    frameworkIds: [],
    scope: "Test service",
    ownerIds: ["person-owner"],
    systemIds: [],
    requirementIds: [],
    controlIds: [],
    coverage: {
      kind: "range",
      startsOn: "2026-01-01",
      endsOn: "2026-06-30"
    },
    reportDate: "2026-07-31",
    opinion: "unmodified",
    opinionDate: "2026-07-31",
    reportEvidenceId: "evidence-issued-report"
  });

  const workflow = await assessWorkflow(root, {
    asOf: "2026-08-03",
    evaluatedAt: "2026-08-03T12:00:00Z"
  });
  const findingKeys = new Set(workflow.findings.map(({ key }) => key));
  assert.equal(findingKeys.has("period.appointment.executive-sponsor.gap"), false);
  assert.equal(findingKeys.has("period.appointment.evidence-audit-liaison.gap"), false);
  assert.equal(workflow.findings.find(({ key }) => key === "period.git-history.span")?.state, "ready");
  assert.equal(workflow.findings.find(({ key }) => key === "period.appointment.policy-owner.gap")?.state, "ready");
  assert.equal(findingKeys.has("audit.audit-issued.lifecycle.packet-delivery"), true);
  assert.equal(findingKeys.has("audit.audit-issued.lifecycle.subsequent-events"), true);
  assert.equal(findingKeys.has("audit.audit-issued.lifecycle.report-evidence"), true);
  assert.equal(findingKeys.has("audit.audit-issued.lifecycle.advance"), true);
  assert.equal(workflow.assessments.deliveryReadiness.status, "needs-work");
  assert.equal(workflow.assessments.auditClosure.findingKeys.includes("audit.audit-issued.lifecycle.advance"), true);
});

test("keeps preliminary audit planning separate from an accepted engagement", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-workflow-planned-audit-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const loaded = await loadWorkspace(root);
  await writeJson(join(root, "data", "workspace.json"), {
    ...loaded.workspace,
    dataModelVersion: "3"
  });
  await import("node:fs/promises").then(({ mkdir }) => mkdir(join(root, "data", "audits"), { recursive: true }));
  await writeJson(join(root, "data", "audits", "audit-planned.json"), {
    id: "audit-planned",
    type: "audit",
    title: "Planned audit",
    status: "planned",
    auditKind: "soc-2-type-2",
    frameworkIds: [],
    scope: "Candidate service scope",
    ownerIds: ["person-owner"]
  });

  const workflow = await assessWorkflow(root, {
    asOf: "2026-08-03",
    evaluatedAt: "2026-08-03T12:00:00Z"
  });
  const findingKeys = new Set(workflow.findings.map(({ key }) => key));
  assert.equal(findingKeys.has("audit.audit-planned.lifecycle.engagement-terms"), false);
  assert.equal(findingKeys.has("audit.audit-planned.lifecycle.management-acknowledgement"), false);
  assert.equal(workflow.findings.find(({ key }) => key === "audit.audit-planned.lifecycle.advance")?.title, "Confirm the engagement and start audit preparation");
});
