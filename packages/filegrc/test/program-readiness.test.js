import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  assessAuditPreparation,
  assessProgramReadiness,
  createResource,
  createResources,
  loadWorkspace,
  updateResource
} from "../src/index.js";
import { makeWorkspace } from "./helpers.js";

const execute = promisify(execFile);
const cli = fileURLToPath(new URL("../bin/filegrc.js", import.meta.url));

test("requires the starter oversight team to be activated with a separate current chair", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-program-ownership-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const initialWorkspace = await loadWorkspace(root);
  await updateResource(root, "workspace", initialWorkspace.workspace.id, {
    ...initialWorkspace.workspace,
    assuranceGoal: "readiness"
  });
  await createResource(root, {
    schemaVersion: 1,
    id: "policy-security",
    type: "policy",
    title: "Security policy",
    status: "draft",
    ownerIds: ["person-owner"]
  }, {
    content: { content: "# Security policy" }
  });
  await createResource(root, {
    schemaVersion: 1,
    id: "team-security-risk-oversight",
    type: "team",
    title: "Security and Risk Oversight",
    status: "inactive",
    purpose: "Review security and risk decisions.",
    memberIds: ["person-owner"],
    chairIds: []
  });
  await createResource(root, {
    schemaVersion: 1,
    id: "obligation-quarterly-oversight",
    type: "obligation",
    title: "Quarterly oversight meeting",
    status: "active",
    activityType: "meeting",
    recurrence: {
      mode: "calendar",
      unit: "month",
      interval: 3,
      anchorDate: "2026-01-01"
    },
    ownerIds: ["team-security-risk-oversight"]
  });

  const pending = await assessProgramReadiness(root, { asOf: "2026-07-01" });
  const pendingOwnership = pending.stages
    .find(({ id }) => id === "scope")
    .items.find(({ id }) => id === "program-ownership");
  assert.equal(pendingOwnership.status, "action");
  assert.match(pendingOwnership.message, /1 record has no current person owner/);
  assert.doesNotMatch(pendingOwnership.message, /obligation-quarterly-oversight/);
  assert.match(pendingOwnership.message, /Finish and activate Security and Risk Oversight/);
  assert.deepEqual(pendingOwnership.commands, [
    "npx filegrc guide person --json",
    "npx filegrc list person --json",
    'npx filegrc scaffold person --title "REVIEWER NAME" | npx filegrc create - --json',
    "npx filegrc get team-security-risk-oversight --mutation",
    "npx filegrc update team team-security-risk-oversight MUTATION.json --json"
  ]);
  assert.deepEqual(pendingOwnership.unresolvedAssignments, [{
    resourceType: "obligation",
    resourceId: "obligation-quarterly-oversight",
    title: "Quarterly oversight meeting",
    ownerIds: ["team-security-risk-oversight"],
    reasons: [{ ownerId: "team-security-risk-oversight", reason: "inactive-team" }]
  }]);
  const compactPending = JSON.parse((await execute(process.execPath, [
    cli,
    "program-readiness",
    "--root",
    root,
    "--as-of",
    "2026-07-01",
    "--summary",
    "--json"
  ])).stdout);
  assert.equal(compactPending.unresolvedOwnership.count, 1);
  assert.deepEqual(compactPending.unresolvedOwnership.resourceIds, ["obligation-quarterly-oversight"]);
  assert.deepEqual(compactPending.unresolvedOwnership.byReason, { "inactive-team": 1 });
  assert.equal(compactPending.firstAction.unresolvedAssignments, undefined);
  assert.equal(compactPending.stages[0].firstAction.message, undefined);

  const loaded = await loadWorkspace(root);
  const team = loaded.resources.find(({ id }) => id === "team-security-risk-oversight");
  await updateResource(root, "team", team.id, {
    ...team,
    status: "active",
    memberIds: ["person-owner", "person-approver"],
    chairIds: ["person-approver"]
  });
  const ready = await assessProgramReadiness(root, { asOf: "2026-07-01" });
  const readyOwnership = ready.stages
    .find(({ id }) => id === "scope")
    .items.find(({ id }) => id === "program-ownership");
  assert.equal(readyOwnership.status, "complete");
});

test("reaches Evidence Ready without an audit record and keeps candidate dates separate", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-program-readiness-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await createResource(root, {
    schemaVersion: 1,
    id: "policy-access",
    type: "policy",
    title: "Access policy",
    status: "draft",
    ownerIds: ["person-owner"]
  }, {
    content: {
      content: "# Access policy\n\nManagement approves access, reviews privileged access, and retains evidence from the identity system."
    }
  });
  await createResources(root, [
    {
      schemaVersion: 1,
      id: "team-security-risk-oversight",
      type: "team",
      title: "Security and Risk Oversight",
      status: "active",
      purpose: "Review security and risk decisions.",
      memberIds: ["person-owner", "person-approver"],
      chairIds: ["person-approver"]
    },
    {
      schemaVersion: 1,
      id: "framework-security",
      type: "framework",
      title: "Security criteria",
      status: "active",
      version: "1"
    },
    {
      schemaVersion: 1,
      id: "requirement-access",
      type: "requirement",
      title: "Access requirement",
      frameworkId: "framework-security",
      reference: "TEST1",
      applicability: "applicable"
    },
    {
      schemaVersion: 1,
      id: "system-service",
      type: "system",
      title: "Customer service",
      status: "active",
      criticality: "high",
      ownerIds: ["person-owner"],
      description: "Production customer service and its supporting identity boundary.",
      dataClassification: "Confidential",
      inScope: true
    },
    {
      schemaVersion: 1,
      id: "system-identity",
      type: "system",
      title: "Identity system",
      status: "active",
      criticality: "high",
      ownerIds: ["person-owner"],
      description: "Authoritative identity, role, and access-reporting system.",
      dataClassification: "Confidential",
      inScope: false,
      evidenceSourceKinds: ["identity-access"],
      evidenceOwnerIds: ["person-owner"]
    },
    {
      schemaVersion: 1,
      id: "control-access",
      type: "control",
      title: "Access approval",
      status: "partially-implemented",
      statement: "Management approves access before grant.",
      ownerIds: ["person-owner"],
      requirementIds: ["requirement-access"],
      code: "IAM-01",
      activity: "Approve and record every access grant.",
      operationMode: "manual",
      frequency: "Per request",
      systemIds: ["system-service"],
      evidenceSourceIds: ["system-identity"],
      policyIds: ["policy-access"],
      effectiveOn: "2026-06-01"
    }
  ]);
  await writeFile(
    join(root, "data", "systems", "system-identity.md"),
    "# Identity evidence exports\n\nExport the complete access-grant report with request, approver, role, system, and grant time. Reconcile the export to the service access list and retain the fixed file.\n",
    "utf8"
  );
  await writeFile(
    join(root, "data", "controls", "control-access.md"),
    "# Access approval procedure\n\nThe requester states the business need and requested role. The service owner checks least privilege, records approval in the identity system, and verifies the granted role against the approved request.\n",
    "utf8"
  );
  const reviewerPending = await assessProgramReadiness(root, { asOf: "2026-07-01" });
  const reviewerAssignment = reviewerPending.stages
    .find(({ id }) => id === "policies")
    .items.find(({ id }) => id === "independent-reviewer");
  assert.equal(reviewerAssignment.status, "action");
  assert.equal(reviewerAssignment.title, "Assign the independent policy reviewer");
  assert.match(reviewerAssignment.message, /Approver/i);
  assert.equal(reviewerAssignment.resourceType, "policy");
  assert.equal(reviewerAssignment.resourceId, "policy-access");

  const policy = (await loadWorkspace(root)).resources.find(({ id }) => id === "policy-access");
  await updateResource(root, "policy", policy.id, {
    ...policy,
    status: "active",
    approverIds: ["person-approver"],
    approvedOn: "2026-05-25",
    effectiveOn: "2026-06-01",
    controlIds: ["control-access"]
  });
  const control = (await loadWorkspace(root)).resources.find(({ id }) => id === "control-access");
  await updateResource(root, "control", control.id, {
    ...control,
    status: "implemented"
  });
  await createResource(root, {
    schemaVersion: 1,
    id: "evidence-access-test-export",
    type: "evidence",
    title: "Access evidence test export",
    status: "verified",
    evidenceKind: "test-export",
    source: "Identity system",
    collectedOn: "2026-06-15",
    classification: "Internal",
    sourceSystemId: "system-identity",
    controlIds: ["control-access"],
    collectorIds: ["person-owner"],
    verifierIds: ["person-approver"],
    verifiedOn: "2026-06-15"
  }, {
    content: {
      content: "# Access test export\n\nManagement exported the access report and confirmed that the expected fields and records were present."
    }
  });
  const loaded = await loadWorkspace(root);
  await updateResource(root, "workspace", loaded.workspace.id, {
    ...loaded.workspace,
    assuranceGoal: "soc-2-type-2",
    frameworkIds: ["framework-security"],
    requirementIds: ["requirement-access"],
    controlIds: ["control-access"],
    systemIds: ["system-service"]
  });

  const ready = await assessProgramReadiness(root, { asOf: "2026-07-01" });
  assert.equal(ready.status, "evidence-ready");
  assert.equal(ready.evidenceReady, true);
  assert.equal(ready.canStartCandidatePeriod, true);
  assert.equal(ready.operating, false);
  assert.equal(ready.stages.map(({ id }) => id).join(","), "scope,policies,controls,evidence,operation");
  assert.equal(ready.stages.find(({ id }) => id === "scope").items.some(({ id }) => id === "risk-assessment"), false);
  assert.equal(ready.stages.find(({ id }) => id === "operation").items.find(({ id }) => id === "risk-assessment").status, "action");
  const readyWorkspace = await loadWorkspace(root);
  assert.equal(readyWorkspace.resources.find(({ id }) => id === "person-approver").status, "active");
  assert.equal(ready.stages.find(({ id }) => id === "policies").counts.action, 0);
  assert.equal(readyWorkspace.resources.some(({ type }) => type === "audit"), false);

  const testEvidence = readyWorkspace.resources.find(({ id }) => id === "evidence-access-test-export");
  const collectedEvidence = { ...testEvidence, status: "collected" };
  delete collectedEvidence.verifierIds;
  delete collectedEvidence.verifiedOn;
  await updateResource(root, "evidence", testEvidence.id, collectedEvidence);
  const awaitingVerification = await assessProgramReadiness(root, { asOf: "2026-07-01" });
  const awaitingTest = awaitingVerification.stages.find(({ id }) => id === "evidence").items.find(({ id }) => id === "test-family-identity-access");
  assert.equal(awaitingVerification.evidenceReady, false);
  assert.equal(awaitingTest.status, "action");
  assert.equal(awaitingTest.evidenceId, testEvidence.id);
  assert.equal(awaitingTest.testEvidenceKind, "test-export");
  assert.match(awaitingTest.testPrompt, /users, roles, privileged access/);
  assert.deepEqual(awaitingTest.sourceSystemIds, ["system-identity"]);
  await updateResource(root, "evidence", testEvidence.id, testEvidence);

  const auditReadiness = await assessAuditPreparation(root, { programReadiness: ready });
  assert.equal(auditReadiness.status, "not-started");
  assert.equal(auditReadiness.stages.find(({ id }) => id === "program").status, "complete");
  assert.equal(auditReadiness.stages.find(({ id }) => id === "engagement").status, "action");

  const cliResult = await execute(process.execPath, [
    cli,
    "program-readiness",
    "--root",
    root,
    "--as-of",
    "2026-07-01",
    "--require-ready",
    "--json"
  ]);
  assert.equal(JSON.parse(cliResult.stdout).canStartCandidatePeriod, true);

  const compactCliResult = await execute(process.execPath, [
    cli,
    "program-readiness",
    "--root",
    root,
    "--as-of",
    "2026-07-01",
    "--summary",
    "--json"
  ]);
  const compact = JSON.parse(compactCliResult.stdout);
  assert.equal(compact.canStartCandidatePeriod, true);
  assert.equal(compact.scopeCounts.system, 1);
  assert.equal(compact.stages.length, 5);
  assert.equal(Object.hasOwn(compact.stages[0], "items"), false);
  assert.ok(compactCliResult.stdout.length < cliResult.stdout.length / 2);

  const current = await loadWorkspace(root);
  await updateResource(root, "workspace", current.workspace.id, {
    ...current.workspace,
    candidatePeriodStart: "2026-07-01",
    candidatePeriodEnd: "2026-12-31"
  });
  const operating = await assessProgramReadiness(root, { asOf: "2026-07-02" });
  assert.equal(operating.status, "operating");
  assert.equal(operating.canStartCandidatePeriod, false);
  assert.equal(operating.suggestedCandidatePeriodStart, null);
  assert.equal(operating.target.candidatePeriodStart, "2026-07-01");
  assert.equal(operating.target.candidatePeriodEnd, "2026-12-31");
  assert.equal(operating.stages.find(({ id }) => id === "operation").items.find(({ id }) => id === "risk-assessment").status, "action");

  await createResource(root, {
    schemaVersion: 1,
    id: "risk-assessment-2026",
    type: "risk-assessment",
    title: "2026 service risk assessment",
    status: "complete",
    assessmentDate: "2026-07-02",
    assessmentKind: "system-risk",
    scope: "Customer service",
    assessorIds: ["person-owner"],
    reviewerIds: ["person-approver"],
    methodology: "Identify threats, rate likelihood and impact, evaluate controls, and assign treatment owners.",
    approvedOn: "2026-07-02",
    systemIds: ["system-service"]
  });
  const assessed = await assessProgramReadiness(root, { asOf: "2026-07-02" });
  assert.equal(assessed.stages.find(({ id }) => id === "operation").items.find(({ id }) => id === "risk-assessment").status, "complete");
});
