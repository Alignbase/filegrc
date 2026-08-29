import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  approveReportingRouteSet,
  assessProgramReadiness,
  assessReportingRoutePeriod,
  assessReportingRouteSets,
  cancelReportingRouteSet,
  createResource,
  effectiveReportingRouteRequirements,
  loadWorkspace,
  prepareEvidencePacket,
  proposeReportingRouteSet,
  reportingRouteLanesIndependent,
  reportingRouteBindingExpectation,
  scaffoldReportingRouteSet,
  scaffoldResourceMutation,
  validateWorkspace,
  writeEvidencePacket
} from "../src/index.js";
import { assertionTimingAt, reportingRouteFixedEvidence } from "../src/reporting-route-integrity.js";
import { makeComprehensiveWorkspace } from "./fixtures.js";
import { writeJson } from "./helpers.js";

const execute = promisify(execFile);

test("scaffolds each Reporting Channel Set lifecycle action", () => {
  const approval = scaffoldReportingRouteSet({ action: "approve", routeSetId: "route-set" });
  assert.equal(approval.routeSetId, "route-set");
  assert.equal(approval.expectedRevision, "CURRENT_ROUTE_SET_REVISION");
  assert.deepEqual(approval.evidenceIds, []);

  const cancellation = scaffoldReportingRouteSet({ action: "cancel", routeSetId: "route-set" });
  assert.equal(cancellation.reason, "CANCELLATION_REASON");
  assert.equal(cancellation.expectedRevision, "CURRENT_ROUTE_SET_REVISION");
  assert.deepEqual(cancellation.evidenceIds, []);

  const successor = scaffoldReportingRouteSet({ action: "successor", routeSetId: "successor" });
  assert.equal(successor.predecessorExpectedRevision, "CURRENT_PREDECESSOR_REVISION");
  assert.deepEqual(successor.predecessorCancellationEvidenceIds, []);
  assert.throws(() => scaffoldReportingRouteSet({ action: "retire" }), /approve.*cancel.*successor/);
});

test("distinguishes future-dated route events from late Git records", () => {
  assert.equal(
    assertionTimingAt(new Date("2021-01-02T00:00:00Z"), new Date("2021-01-01T00:00:00Z")),
    "git-recorded-before-event"
  );
});

test("requires explicit dependency conclusions before claiming channel independence", () => {
  const route = {
    primaryLane: { channelKind: "email", destination: "security@example.test" },
    alternateLane: { channelKind: "phone", destination: "+1-555-0100" }
  };
  assert.equal(reportingRouteLanesIndependent(route, [], new Date()), false);
  assert.equal(reportingRouteLanesIndependent({
    ...route,
    primaryLane: { ...route.primaryLane, dependencyBasis: "none", dependencyRationale: "The address is delivered directly to a named recipient." },
    alternateLane: { ...route.alternateLane, dependencyBasis: "none", dependencyRationale: "The phone route terminates directly with a named recipient." }
  }, [], new Date()), true);
});

test("follows the effective lifecycle of Reporting Route requirement sources", () => {
  const requirement = {
    purposeKey: "security-reporting",
    requiredLanes: ["primary"],
    effectiveAt: "2021-01-01T00:00:00Z",
    timezone: "UTC"
  };
  const planned = {
    id: "commitment-planned",
    type: "commitment",
    status: "planned",
    reportingRouteRequirements: [requirement]
  };
  assert.deepEqual(effectiveReportingRouteRequirements([planned], new Date("2021-06-01T00:00:00Z")), []);
  const retired = {
    ...planned,
    status: "retired",
    effectiveOn: "2021-02-01",
    statusTransition: { changedOn: "2021-05-01" }
  };
  assert.equal(effectiveReportingRouteRequirements([retired], new Date("2021-04-30T23:59:59Z")).length, 1);
  assert.equal(effectiveReportingRouteRequirements([retired], new Date("2021-05-01T00:00:00Z")).length, 0);
});

test("keeps Reporting Route requirement Program scope explicit and stable", () => {
  const requirement = {
    purposeKey: "security-reporting",
    programScope: "selected-programs",
    programIds: ["program-a"],
    requiredLanes: ["primary"],
    effectiveAt: "2021-01-01T00:00:00Z",
    timezone: "UTC"
  };
  const records = [
    {
      id: "program-a",
      type: "program",
      systemIds: ["system-a"],
      controlIds: ["control-a"],
      requirementApplicability: [{ requirementId: "requirement-a", decision: "applicable" }]
    },
    { id: "program-b", type: "program", systemIds: ["system-b"], controlIds: ["control-b"] },
    { id: "control-a", type: "control", policyIds: ["policy-a"] },
    { id: "control-b", type: "control", policyIds: ["policy-b"] },
    { id: "commitment-a", type: "commitment", status: "active", effectiveOn: "2021-01-01", systemIds: ["system-a"], reportingRouteRequirements: [requirement] },
    { id: "commitment-risk-system", type: "commitment", status: "active", effectiveOn: "2021-01-01", reportingRouteRequirements: [requirement] },
    { id: "commitment-risk-control", type: "commitment", status: "active", effectiveOn: "2021-01-01", reportingRouteRequirements: [requirement] },
    { id: "commitment-risk-requirement", type: "commitment", status: "active", effectiveOn: "2021-01-01", reportingRouteRequirements: [requirement] },
    { id: "commitment-scope-requirement", type: "commitment", status: "active", effectiveOn: "2021-01-01", requirementIds: ["requirement-a"] },
    { id: "risk-system", type: "risk", commitmentIds: ["commitment-risk-system"], systemIds: ["system-a"] },
    { id: "risk-control", type: "risk", commitmentIds: ["commitment-risk-control"], controlIds: ["control-a"] },
    { id: "risk-requirement", type: "risk", commitmentIds: ["commitment-risk-requirement"], requirementIds: ["requirement-a"] },
    { id: "risk-through-commitment-requirement", type: "risk", status: "open", commitmentIds: ["commitment-scope-requirement"], reportingRouteRequirements: [requirement] }
  ];
  assert.deepEqual(
    effectiveReportingRouteRequirements(records, new Date("2021-06-01T00:00:00Z"), "program-a")
      .map(({ sourceId }) => sourceId)
      .sort(),
    [
      "commitment-a",
      "commitment-risk-control",
      "commitment-risk-requirement",
      "commitment-risk-system",
      "risk-through-commitment-requirement"
    ]
  );
  assert.equal(effectiveReportingRouteRequirements(records, new Date("2021-06-01T00:00:00Z"), "program-b").length, 0);
  const changedRelationships = records.map((record) => (
    record.id === "program-a"
      ? { ...record, systemIds: [], controlIds: [], requirementApplicability: [] }
      : record.type === "risk" || record.type === "commitment"
        ? { ...record, systemIds: [], controlIds: [], requirementIds: [], commitmentIds: [] }
        : record
  ));
  assert.equal(
    effectiveReportingRouteRequirements(changedRelationships, new Date("2021-06-01T00:00:00Z"), "program-a").length,
    5
  );
});

test("rejects direct additions and rewrites of approved Reporting Route requirements", async (context) => {
  const requirement = {
    purposeKey: "security-reporting",
    requiredLanes: ["primary"],
    effectiveAt: "2024-01-01T00:00:00Z",
    timezone: "UTC"
  };
  for (const scenario of ["add", "rewrite"]) {
    const root = await mkdtemp(join(tmpdir(), `filegrc-route-approved-${scenario}-`));
    context.after(() => rm(root, { recursive: true, force: true }));
    const { records } = await makeComprehensiveWorkspace(root);
    const policy = records.find(({ id }) => id === "policy-example");
    policy.status = "approved";
    policy.reportingRouteRequirements = scenario === "add" ? [] : [{ ...requirement }];
    await writeRecord(root, "policies", policy);
    await git(root, "init", "--initial-branch=main");
    await git(root, "config", "user.name", "Test User");
    await git(root, "config", "user.email", "test@example.test");
    await git(root, "add", ".");
    await git(root, "commit", "-m", "Approve reporting requirements");

    policy.reportingRouteRequirements = scenario === "add"
      ? [{ ...requirement }]
      : [{ ...requirement, requiredLanes: ["primary", "alternate"] }];
    await writeRecord(root, "policies", policy);
    await git(root, "add", ".");
    await git(root, "commit", "-m", `${scenario} approved reporting requirements`);
    const validation = await validateWorkspace(root);
    assert.ok(validation.diagnostics.some(({ code, message }) => (
      code === "rewritten-finalized-record" && /after approval/.test(message)
    )));
  }
});

test("bounds Reporting Route period assessment work", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-route-period-bound-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root);
  const loaded = await loadWorkspace(root);
  const policy = loaded.resources.find(({ id }) => id === "policy-example");
  policy.reportingRouteRequirements = Array.from({ length: 513 }, (_, index) => ({
    purposeKey: "security-reporting",
    requiredLanes: ["primary"],
    effectiveAt: new Date(Date.UTC(2024, 0, 2, 0, index)).toISOString(),
    timezone: "UTC"
  }));
  const assessment = await assessReportingRoutePeriod(loaded, {
    programId: "program-example",
    start: "2024-01-01",
    end: "2024-12-31",
    timezone: "UTC"
  });
  assert.equal(assessment.snapshots.length, 0);
  assert.ok(assessment.issues.some(({ code }) => code === "reporting-route-period-too-complex"));
});

async function makeApprovedRouteWorkspace(context, prefix = "filegrc-route-set-scenario-") {
  const root = await mkdtemp(join(tmpdir(), prefix));
  context.after(() => rm(root, { recursive: true, force: true }));
  const { records } = await makeComprehensiveWorkspace(root);
  const loaded = await loadWorkspace(root);
  const auditMutation = scaffoldResourceMutation(loaded, "audit", "Route coverage audit");
  assert.equal(auditMutation.record.timezone, loaded.workspace.timezone);
  const byId = new Map(records.map((record) => [record.id, record]));
  const route = byId.get("reporting-route-set-example");
  route.approvalAppointmentKind = "reporting-route-approver";
  await writeRecord(root, "reporting-route-sets", route);
  const policy = byId.get("policy-example");
  const starterAttestation = byId.get("attestation-example");
  starterAttestation.status = "pending";
  delete starterAttestation.completedOn;
  delete starterAttestation.attestationMethod;
  delete starterAttestation.contentRevisions;
  await writeRecord(root, "attestations", starterAttestation);
  const audit = byId.get("audit-example");
  audit.timezone = "UTC";
  audit.coverage = { kind: "range", startsOn: "2021-09-01", endsOn: "2021-10-31" };
  await writeRecord(root, "audits", audit);
  const routeAuthority = byId.get("appointment-example");
  routeAuthority.startsOn = "2020-01-01";
  routeAuthority.status = "ended";
  routeAuthority.endsOn = "2021-09-30";
  routeAuthority.statusTransition = {
    changedOn: "2021-10-01",
    changedByIds: ["person-independent-approver-example"],
    reason: "Transferred channel responsibility."
  };
  await writeRecord(root, "appointments", routeAuthority);
  await writeRecord(root, "people", {
    id: "person-route-authority-successor",
    type: "person",
    title: "Successor Route Owner",
    status: "active",
    affiliation: "internal",
    jobTitle: "Security Operations Lead"
  });
  await writeRecord(root, "appointments", {
    id: "appointment-route-authority-successor",
    type: "appointment",
    title: "Successor Reporting Route Authority",
    status: "active",
    appointmentKind: "policy-owner",
    holderId: "person-route-authority-successor",
    scopeResourceIds: [route.id],
    startsOn: "2021-10-01",
    responsibilities: "Keep the reporting channels usable after the authority transfer."
  });
  policy.reportingRouteRequirements = [{
    purposeKey: route.purposeKey,
    programScope: "all-programs",
    requiredLanes: ["primary"],
    effectiveAt: "1970-01-01T00:00:00Z",
    timezone: "UTC"
  }];
  policy.approvedOn = "2020-01-01";
  policy.effectiveOn = "2020-01-01";
  await writeRecord(root, "policies", policy);
  await writeRecord(root, "reporting-route-sets", {
    ...route,
    id: "reporting-route-set-unrelated-draft",
    title: "Unrelated draft route set",
    purposeKey: "continuity-communication",
    primaryLane: {
      channelKind: "email",
      destination: "private-draft-destination@example.test"
    }
  });
  await writeFile(
    join(root, "data", "reporting-route-sets", "reporting-route-set-unrelated-draft.md"),
    "# Instructions\n\nUse this draft only for testing packet selection.\n"
  );
  await writeRecord(root, "appointments", {
    id: "appointment-route-approver",
    type: "appointment",
    title: "Reporting Route Approver",
    status: "active",
    appointmentKind: "reporting-route-approver",
    holderId: "person-independent-approver-example",
    scopeResourceIds: [route.id],
    startsOn: "2020-01-01",
    evidenceIds: ["evidence-example"],
    responsibilities: "Approve Reporting Route Set revisions independently from ongoing route authority."
  });
  await writeFixedRouteEvidence(root, byId.get("evidence-example"), "evidence-route-approval", route.id, "2021-08-01");
  await writeFixedRouteEvidence(root, byId.get("evidence-example"), "evidence-route-cancellation", route.id, "2022-01-01");
  await writeRecord(root, "appointments", {
    id: "appointment-route-approver-out-of-scope",
    type: "appointment",
    title: "Out-of-scope Reporting Route Approver",
    status: "active",
    appointmentKind: "reporting-route-approver",
    holderId: "person-independent-approver-example",
    scopeResourceIds: ["system-example"],
    startsOn: "2020-01-01",
    responsibilities: "Approve a different scoped resource."
  });
  await git(root, "init", "--initial-branch=main");
  await git(root, "config", "user.name", "Test User");
  await git(root, "config", "user.email", "test@example.test");
  await git(root, "add", ".");
  await gitCommitAt(root, "2021-07-30T12:00:00Z", "Create route set draft");

  await proposeReportingRouteSet(root, { routeSetId: route.id });
  const canonicalRoutePath = `data/reporting-route-sets/${route.id}.json`;
  const legacyRoutePath = "data/reporting-route-sets/legacy-security-reporting-channels.json";
  await git(root, "mv", canonicalRoutePath, legacyRoutePath);
  await git(root, "add", ".");
  await gitCommitAt(root, "2021-07-31T12:00:00Z", "Propose reporting routes");
  const proposalCommit = (await git(root, "rev-parse", "HEAD")).trim();
  await git(root, "mv", legacyRoutePath, canonicalRoutePath);
  await gitCommitAt(root, "2021-07-31T13:00:00Z", "Restore canonical route record path");
  const approvedAt = "2021-08-01T12:00:00-05:00";
  const approver = byId.get("person-independent-approver-example");
  await writeRecord(root, "people", {
    ...approver,
    status: "inactive",
    endDate: "2021-07-31"
  });
  await assert.rejects(() => approveReportingRouteSet(root, {
    routeSetId: route.id,
    proposalCommit,
    approvalAppointmentId: "appointment-route-approver",
    approvedAt,
    effectiveAt: approvedAt,
    timezone: "America/Chicago",
    evidenceIds: ["evidence-route-approval"]
  }), /holder were not authorized/);
  await writeRecord(root, "people", approver);
  const approval = await approveReportingRouteSet(root, {
    routeSetId: route.id,
    proposalCommit,
    approvalAppointmentId: "appointment-route-approver",
    approvedAt,
    effectiveAt: approvedAt,
    timezone: "America/Chicago",
    evidenceIds: ["evidence-route-approval"]
  });
  assert.equal(approval.record.approval.proposalCommit, proposalCommit);
  assert.equal(approval.record.approval.approvedAt, approvedAt);
  assert.equal(approval.record.approval.assertionTiming, undefined);
  const beforeCommit = await assessReportingRouteSets(root, { programId: route.programId });
  assert.ok(beforeCommit.issues.some(({ code }) => code === "reporting-route-commit-required"));
  await git(root, "add", ".");
  await git(root, "commit", "-m", "Approve reporting routes");
  return { root, byId, route, policy, audit, canonicalRoutePath, proposalCommit, approvedAt };
}

let approvedRouteFixture;

async function cloneApprovedRouteWorkspace(context, prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  context.after(() => rm(root, { recursive: true, force: true }));
  await execute("git", ["clone", "--local", "--no-hardlinks", approvedRouteFixture.root, root]);
  await git(root, "config", "user.name", "Test User");
  await git(root, "config", "user.email", "test@example.test");
  const loaded = await loadWorkspace(root);
  const byId = new Map(loaded.resources.map((record) => [record.id, record]));
  const route = byId.get("reporting-route-set-example");
  return {
    root,
    byId,
    route,
    policy: byId.get("policy-example"),
    audit: byId.get("audit-example"),
    canonicalRoutePath: `data/reporting-route-sets/${route.id}.json`,
    proposalCommit: route.proposalCommit,
    approvedAt: route.approval.approvedAt
  };
}

test.describe("Reporting Channel Set lifecycle integrity", { concurrency: 4 }, () => {
test.before(async () => {
  approvedRouteFixture = await makeApprovedRouteWorkspace({ after() {} }, "filegrc-route-fixture-");
});

test.after(async () => {
  await rm(approvedRouteFixture.root, { recursive: true, force: true });
});

test("commits an exact Route Set proposal before managed approval becomes effective", async (context) => {
  const { root, byId, route, proposalCommit } = await cloneApprovedRouteWorkspace(context, "filegrc-route-evidence-");

  const approvalEvidencePath = join(root, "data", "evidence", "evidence-route-approval", "evidence.json");
  const approvalEvidence = JSON.parse(await readFile(approvalEvidencePath, "utf8"));
  await git(root, "switch", "-c", "side-rendered-evidence");
  await git(root, "commit", "--allow-empty", "-m", "Create non-authoritative rendered source");
  const sideRenderedCommit = (await git(root, "rev-parse", "HEAD")).trim();
  await git(root, "switch", "main");
  await writeBogusRenderedRouteEvidence(root, approvalEvidence, approvalEvidence.id, route.id, "2021-08-01");
  const bogusApprovalRevision = await validateWorkspace(root);
  assert.ok(bogusApprovalRevision.diagnostics.some(({ code }) => code === "invalid-rendered-evidence-kind"));
  assert.ok(bogusApprovalRevision.diagnostics.some(({ code }) => code === "invalid-evidence-source-revision"));
  assert.ok(bogusApprovalRevision.diagnostics.some(({ code }) => code === "missing-reporting-route-event-evidence"));
  const sideRenderedEvidence = JSON.parse(await readFile(approvalEvidencePath, "utf8"));
  sideRenderedEvidence.artifactKind = "rendered-page";
  sideRenderedEvidence.sourceCommit = sideRenderedCommit;
  await writeJson(approvalEvidencePath, sideRenderedEvidence);
  const nonAuthoritativeApprovalRevision = await validateWorkspace(root);
  assert.ok(nonAuthoritativeApprovalRevision.diagnostics.some(({ code }) => code === "non-authoritative-evidence-source-revision"));
  assert.ok(nonAuthoritativeApprovalRevision.diagnostics.some(({ code }) => code === "missing-reporting-route-event-evidence"));
  const wrongPeriodApprovalEvidence = JSON.parse(await readFile(approvalEvidencePath, "utf8"));
  wrongPeriodApprovalEvidence.sourceCommit = proposalCommit;
  wrongPeriodApprovalEvidence.capture.coverage = { kind: "as-of", on: "2020-01-01" };
  await writeJson(approvalEvidencePath, wrongPeriodApprovalEvidence);
  const wrongCapturePeriod = await validateWorkspace(root);
  assert.ok(wrongCapturePeriod.diagnostics.some(({ code }) => code === "missing-reporting-route-event-evidence"));
  const malformedRenderedEvidence = {
    ...wrongPeriodApprovalEvidence,
    capture: {
      ...wrongPeriodApprovalEvidence.capture,
      coverage: { kind: "as-of", on: "2021-08-01" },
      method: ""
    }
  };
  await writeJson(approvalEvidencePath, malformedRenderedEvidence);
  const malformedRenderedAssessment = await assessReportingRouteSets(root, { programId: route.programId });
  assert.ok(malformedRenderedAssessment.issues.some(({ code }) => code === "missing-reporting-route-event-evidence"));
  const malformedFileEvidence = { ...approvalEvidence };
  delete malformedFileEvidence.verifierIds;
  delete malformedFileEvidence.verifiedOn;
  await writeJson(approvalEvidencePath, malformedFileEvidence);
  const malformedFileAssessment = await assessReportingRouteSets(root, { programId: route.programId });
  assert.ok(malformedFileAssessment.issues.some(({ code }) => code === "missing-reporting-route-event-evidence"));
  const malformedFileReadiness = await assessProgramReadiness(root, { asOf: "2021-08-02" });
  const malformedFileRouteItem = malformedFileReadiness.stages
    .flatMap(({ items }) => items)
    .find(({ id }) => id === "security-reporting-route-set");
  assert.equal(malformedFileRouteItem.status, "action");
  await writeJson(approvalEvidencePath, approvalEvidence);

  const approvalEvidenceAttachment = join(root, "data", "evidence", "evidence-route-approval", "decision-record.txt");
  await writeFile(approvalEvidenceAttachment, "Rewritten approval record.\n");
  const rewrittenApprovalEvidence = await validateWorkspace(root);
  assert.ok(rewrittenApprovalEvidence.diagnostics.some(({ code, message }) => (
    code === "rewritten-finalized-attachment" && /reporting-route-set-example/.test(message)
  )));
  await writeFile(approvalEvidenceAttachment, "Retained reporting-route decision record.\n");
  await rm(approvalEvidenceAttachment);
  const missingApprovalEvidence = await validateWorkspace(root);
  assert.ok(missingApprovalEvidence.diagnostics.some(({ code }) => code === "missing-reporting-route-event-evidence"));
  assert.ok(missingApprovalEvidence.diagnostics.some(({ code }) => code === "rewritten-finalized-attachment"));
  await writeFile(approvalEvidenceAttachment, "Retained reporting-route decision record.\n");
});

test("rejects unsupported backfilled route decisions", async (context) => {
  const { root, byId, route } = await cloneApprovedRouteWorkspace(context, "filegrc-route-decisions-");
  await git(root, "switch", "-c", "late-route-requirement");
  const lateRequirementId = "commitment-late-route-requirement";
  const lateRequirementEvidenceId = "evidence-late-route-requirement";
  await writeBogusRenderedRouteEvidence(
    root,
    byId.get("evidence-example"),
    lateRequirementEvidenceId,
    lateRequirementId,
    "2021-01-01"
  );
  await writeRecord(root, "commitments", {
    id: lateRequirementId,
    type: "commitment",
    title: "Late reporting requirement",
    status: "active",
    commitmentKind: "business-objective",
    statement: "Require a reporting route during an earlier period.",
    ownerIds: ["person-example"],
    effectiveOn: "2021-01-01",
    reportingRouteRequirements: [{
      purposeKey: route.purposeKey,
      programScope: "all-programs",
      requiredLanes: ["primary"],
      effectiveAt: "2021-01-01T00:00:00Z",
      timezone: "UTC",
      evidenceIds: [lateRequirementEvidenceId]
    }]
  });
  await git(root, "add", ".");
  await git(root, "commit", "-m", "Backfill reporting route requirement");
  const lateRequirement = await validateWorkspace(root);
  assert.ok(lateRequirement.diagnostics.some(({ code }) => code === "invalid-evidence-source-revision"));
  assert.ok(lateRequirement.diagnostics.some(({ message }) => /requires verified, fixed Evidence covering its Reporting Route requirement decision/.test(message)));
  await git(root, "switch", "main");

  await git(root, "switch", "-c", "late-route-requirement-timezone");
  const workspacePath = join(root, "data", "workspace.json");
  const workspace = JSON.parse(await readFile(workspacePath, "utf8"));
  await writeJson(workspacePath, { ...workspace, timezone: "UTC" });
  await writeRecord(root, "commitments", {
    id: "commitment-late-route-requirement-timezone",
    type: "commitment",
    title: "Late reporting requirement with a different timezone",
    status: "active",
    commitmentKind: "business-objective",
    statement: "Require a reporting route from the source lifecycle date.",
    ownerIds: ["person-example"],
    effectiveOn: "2021-08-01",
    reportingRouteRequirements: [{
      purposeKey: route.purposeKey,
      programScope: "all-programs",
      requiredLanes: ["primary"],
      effectiveAt: "2021-08-01T00:00:00Z",
      timezone: "America/Adak"
    }]
  });
  await git(root, "add", ".");
  await gitCommitAt(root, "2021-08-02T08:00:00Z", "Backfill reporting requirement across timezones");
  const timezoneLateRequirement = await validateWorkspace(root);
  assert.ok(timezoneLateRequirement.diagnostics.some(({ message }) => (
    /commitment-late-route-requirement-timezone/.test(message)
    && /requires verified, fixed Evidence covering its Reporting Route requirement decision/.test(message)
  )));
  await writeJson(workspacePath, { ...workspace, timezone: "America/Adak" });
  const timezoneChangedLateRequirement = await validateWorkspace(root);
  assert.ok(timezoneChangedLateRequirement.diagnostics.some(({ message }) => (
    /commitment-late-route-requirement-timezone/.test(message)
    && /requires verified, fixed Evidence covering its Reporting Route requirement decision/.test(message)
  )));
  await writeJson(workspacePath, { ...workspace, timezone: "UTC" });
  await git(root, "switch", "main");

  await git(root, "switch", "-c", "invalid-historical-workspace-timezone");
  await writeJson(workspacePath, { ...workspace, timezone: "Not/A_Timezone" });
  await git(root, "add", ".");
  await git(root, "commit", "-m", "Record invalid historical workspace timezone");
  await writeJson(workspacePath, workspace);
  await git(root, "add", ".");
  await git(root, "commit", "-m", "Repair workspace timezone");
  const invalidHistoricalTimezone = await validateWorkspace(root);
  assert.ok(invalidHistoricalTimezone.diagnostics.some(({ code }) => code === "invalid-historical-workspace-timezone"));
  await git(root, "switch", "main");

  await git(root, "switch", "-c", "missing-historical-workspace-timezone");
  await rm(workspacePath);
  await git(root, "add", ".");
  await git(root, "commit", "-m", "Remove historical workspace record");
  await writeJson(workspacePath, workspace);
  await git(root, "add", ".");
  await git(root, "commit", "-m", "Restore workspace record");
  const missingHistoricalTimezone = await validateWorkspace(root);
  assert.ok(missingHistoricalTimezone.diagnostics.some(({ code }) => code === "invalid-historical-workspace-timezone"));
  await git(root, "switch", "main");

  await git(root, "switch", "-c", "late-route-exception");
  await writeRecord(root, "exceptions", {
    id: "exception-late-route-dependency",
    type: "exception",
    title: "Late reporting route dependency exception",
    status: "approved",
    scopeResourceIds: [route.id],
    requestorIds: ["person-example"],
    ownerIds: ["person-example"],
    rationale: "Temporarily accept a shared channel dependency.",
    requestedOn: "2021-07-31",
    approval: {
      approvedByIds: ["person-independent-approver-example"],
      approvedOn: "2021-08-01",
      expiresOn: "2021-09-30"
    },
    reportingRouteSetId: route.id,
    reportingRouteLanePair: "primary-alternate",
    dependencySystemIds: ["system-example"]
  });
  await git(root, "add", ".");
  await git(root, "commit", "-m", "Backfill reporting route exception");
  const lateException = await validateWorkspace(root);
  assert.ok(lateException.diagnostics.some(({ message }) => /requires verified, fixed Evidence covering its approval event/.test(message)));
  await git(root, "switch", "main");
});

test("preserves route authority history and fixed supporting Evidence", async (context) => {
  const { root, byId, route } = await cloneApprovedRouteWorkspace(context, "filegrc-route-authority-");
  const invalidBackfillAppointmentId = "appointment-backfilled-route-authority";
  const invalidBackfillEvidenceId = "evidence-backfilled-route-authority-bogus";
  await writeBogusRenderedRouteEvidence(
    root,
    byId.get("evidence-example"),
    invalidBackfillEvidenceId,
    invalidBackfillAppointmentId,
    "2021-01-01"
  );
  await writeRecord(root, "appointments", {
    id: invalidBackfillAppointmentId,
    type: "appointment",
    title: "Backfilled Reporting Route Authority",
    status: "active",
    appointmentKind: route.authorityAppointmentKind,
    holderId: "person-independent-approver-example",
    scopeResourceIds: [route.id],
    startsOn: "2021-01-01",
    endsOn: "2021-07-31",
    evidenceIds: [invalidBackfillEvidenceId],
    responsibilities: "Exercise reporting route authority."
  });
  await git(root, "add", ".");
  await git(root, "commit", "-m", "Record backfilled route authority");
  const unrelatedBackfillEvidence = await validateWorkspace(root);
  assert.ok(unrelatedBackfillEvidence.diagnostics.some(({ code }) => code === "invalid-evidence-source-revision"));
  assert.ok(unrelatedBackfillEvidence.diagnostics.some(({ code, message }) => (
    code === "rewritten-finalized-record" && /requires verified, fixed Evidence covering the start/.test(message)
  )));
  assert.ok(unrelatedBackfillEvidence.diagnostics.some(({ code, message }) => (
    code === "rewritten-finalized-record" && /requires verified, fixed Evidence covering the end/.test(message)
  )));
  await rm(join(root, "data", "appointments", "appointment-backfilled-route-authority.json"));
  await rm(join(root, "data", "evidence", invalidBackfillEvidenceId), { recursive: true });
  await git(root, "add", ".");
  await git(root, "commit", "-m", "Remove invalid backfilled route authority");

  const supportedAppointmentId = "appointment-supported-backfilled-authority";
  const supportedEvidenceId = "evidence-supported-backfilled-authority";
  const supportedEvidence = {
    ...byId.get("evidence-example"),
    id: supportedEvidenceId,
    title: "Archived route authority appointment",
    status: "verified",
    artifactKind: "business-record",
    sourceKind: "file",
    sourceDescription: "An independently retained appointment record.",
    collectedOn: "2021-01-01",
    collectorIds: ["person-example"],
    verifierIds: ["person-independent-approver-example"],
    verifiedOn: "2021-01-01",
    sourceResourceIds: [supportedAppointmentId],
    coverage: { kind: "range", startsOn: "2021-01-01", endsOn: "2021-09-15" },
    filePaths: [`evidence/${supportedEvidenceId}/appointment-record.txt`]
  };
  delete supportedEvidence.externalReference;
  delete supportedEvidence.capture;
  delete supportedEvidence.sourceCommit;
  delete supportedEvidence.sourceComponentId;
  const supportedEvidencePath = join(root, "data", "evidence", supportedEvidenceId, "evidence.json");
  const supportedAttachmentPath = join(root, "data", "evidence", supportedEvidenceId, "appointment-record.txt");
  await mkdir(join(root, "data", "evidence", supportedEvidenceId), { recursive: true });
  await writeJson(supportedEvidencePath, supportedEvidence);
  await writeFile(supportedAttachmentPath, "Signed route authority appointment.\n");
  await writeRecord(root, "appointments", {
    id: supportedAppointmentId,
    type: "appointment",
    title: "Supported Backfilled Reporting Route Authority",
    status: "ended",
    appointmentKind: route.authorityAppointmentKind,
    holderId: "person-example",
    scopeResourceIds: [route.id],
    startsOn: "2021-01-01",
    endsOn: "2021-09-15",
    statusTransition: {
      changedOn: "2021-09-16",
      changedByIds: ["person-independent-approver-example"],
      reason: "The temporary appointment ended."
    },
    evidenceIds: [supportedEvidenceId],
    responsibilities: "Exercise reporting route authority."
  });
  await git(root, "add", ".");
  await git(root, "commit", "-m", "Record supported backfilled route authority");
  const supportedCommit = (await git(root, "rev-parse", "HEAD")).trim();
  const supportedLoaded = await loadWorkspace(root);
  assert.equal(reportingRouteFixedEvidence(
    supportedLoaded.resources,
    supportedAppointmentId,
    [supportedEvidenceId],
    "2021-01-01",
    supportedLoaded.workspace.timezone,
    { root, commit: supportedCommit }
  ).length, 1);
  const supportedAppointmentPath = join(root, "data", "appointments", `${supportedAppointmentId}.json`);
  await rm(supportedAppointmentPath);
  await rm(join(root, "data", "evidence", supportedEvidenceId), { recursive: true });
  const deletedSupportedAuthority = await validateWorkspace(root);
  assert.ok(deletedSupportedAuthority.diagnostics.some(({ code, message }) => (
    code === "deleted-finalized-record" && message.includes(supportedAppointmentId)
  )), JSON.stringify(deletedSupportedAuthority.diagnostics, null, 2));
  await writeJson(supportedAppointmentPath, {
    id: supportedAppointmentId,
    type: "appointment",
    title: "Supported Backfilled Reporting Route Authority",
    status: "ended",
    appointmentKind: route.authorityAppointmentKind,
    holderId: "person-example",
    scopeResourceIds: [route.id],
    startsOn: "2021-01-01",
    endsOn: "2021-09-15",
    statusTransition: {
      changedOn: "2021-09-16",
      changedByIds: ["person-independent-approver-example"],
      reason: "The temporary appointment ended."
    },
    evidenceIds: [supportedEvidenceId],
    responsibilities: "Exercise reporting route authority."
  });
  await mkdir(join(root, "data", "evidence", supportedEvidenceId), { recursive: true });
  await writeJson(supportedEvidencePath, supportedEvidence);
  await writeFile(supportedAttachmentPath, "Signed route authority appointment.\n");
  const replacementEvidenceId = "evidence-replacement-backfilled-authority";
  const replacementEvidence = {
    ...supportedEvidence,
    id: replacementEvidenceId,
    title: "Replacement archived route authority appointment",
    filePaths: [`evidence/${replacementEvidenceId}/appointment-record.txt`]
  };
  const replacementEvidenceDirectory = join(root, "data", "evidence", replacementEvidenceId);
  await mkdir(replacementEvidenceDirectory, { recursive: true });
  await writeJson(join(replacementEvidenceDirectory, "evidence.json"), replacementEvidence);
  await writeFile(join(replacementEvidenceDirectory, "appointment-record.txt"), "Replacement route authority appointment.\n");
  const restoredSupportedAppointment = JSON.parse(await readFile(supportedAppointmentPath, "utf8"));
  await writeJson(supportedAppointmentPath, { ...restoredSupportedAppointment, evidenceIds: [replacementEvidenceId] });
  await rm(join(root, "data", "evidence", supportedEvidenceId), { recursive: true });
  const replacedBackfillEvidence = await validateWorkspace(root);
  assert.ok(replacedBackfillEvidence.diagnostics.some(({ message }) => (
    message.includes(supportedEvidenceId) && /bound|proof links/.test(message)
  )), JSON.stringify(replacedBackfillEvidence.diagnostics, null, 2));
  await writeJson(supportedAppointmentPath, restoredSupportedAppointment);
  await mkdir(join(root, "data", "evidence", supportedEvidenceId), { recursive: true });
  await writeJson(supportedEvidencePath, supportedEvidence);
  await writeFile(supportedAttachmentPath, "Signed route authority appointment.\n");
  await rm(replacementEvidenceDirectory, { recursive: true });

  const unrelatedHolderPath = join(root, "data", "people", "person-independent-approver-example.json");
  const unrelatedHolder = JSON.parse(await readFile(unrelatedHolderPath, "utf8"));
  await writeJson(unrelatedHolderPath, {
    ...unrelatedHolder,
    status: "inactive",
    endDate: "2021-09-15"
  });
  const crossHolderEndEvidence = await validateWorkspace(root);
  assert.ok(crossHolderEndEvidence.diagnostics.some(({ message }) => (
    /person-independent-approver-example/.test(message)
    && /requires verified, fixed Evidence from the related Appointment/.test(message)
  )));
  await writeJson(unrelatedHolderPath, unrelatedHolder);

  const conflictingApprovalAppointmentId = "appointment-conflicting-approval-authority";
  const conflictingApprovalEvidenceId = "evidence-conflicting-approval-authority";
  const conflictingApprovalEvidenceDirectory = join(root, "data", "evidence", conflictingApprovalEvidenceId);
  await mkdir(conflictingApprovalEvidenceDirectory, { recursive: true });
  await writeJson(join(conflictingApprovalEvidenceDirectory, "evidence.json"), {
    ...supportedEvidence,
    id: conflictingApprovalEvidenceId,
    title: "Archived conflicting approval authority appointment",
    sourceResourceIds: [conflictingApprovalAppointmentId],
    filePaths: [`evidence/${conflictingApprovalEvidenceId}/appointment-record.txt`]
  });
  await writeFile(join(conflictingApprovalEvidenceDirectory, "appointment-record.txt"), "Signed conflicting authority appointment.\n");
  const conflictingApprovalAppointmentPath = join(root, "data", "appointments", `${conflictingApprovalAppointmentId}.json`);
  await writeJson(conflictingApprovalAppointmentPath, {
    id: conflictingApprovalAppointmentId,
    type: "appointment",
    title: "Conflicting Approval Authority",
    status: "ended",
    appointmentKind: route.authorityAppointmentKind,
    holderId: "person-independent-approver-example",
    scopeResourceIds: [route.id],
    startsOn: "2021-01-01",
    endsOn: "2021-09-15",
    statusTransition: {
      changedOn: "2021-09-16",
      changedByIds: ["person-example"],
      reason: "The temporary appointment ended."
    },
    evidenceIds: [conflictingApprovalEvidenceId],
    responsibilities: "Exercise reporting route authority."
  });
  const conflictingApprovalAuthority = await validateWorkspace(root);
  assert.ok(conflictingApprovalAuthority.diagnostics.some(({ code, message }) => (
    code === "reporting-route-authority-not-separated" && /backfilled Appointment/.test(message)
  )));
  await rm(conflictingApprovalAppointmentPath);
  await rm(conflictingApprovalEvidenceDirectory, { recursive: true });

  const unrelatedDraftPath = join(root, "data", "reporting-route-sets", "reporting-route-set-unrelated-draft.json");
  const unrelatedDraft = JSON.parse(await readFile(unrelatedDraftPath, "utf8"));
  await writeJson(unrelatedDraftPath, { ...unrelatedDraft, predecessorId: unrelatedDraft.id });
  const selfPredecessor = await validateWorkspace(root);
  assert.ok(selfPredecessor.diagnostics.some(({ code, message }) => (
    code === "invalid-reporting-route-lineage" && /cannot name itself/.test(message)
  )));
  await writeJson(unrelatedDraftPath, unrelatedDraft);
});

test("binds delivery acknowledgements and packets to the governing route revision", async (context) => {
  const { root, byId, route, policy, audit } = await cloneApprovedRouteWorkspace(context, "filegrc-route-binding-");
  await git(root, "switch", "-c", "side-route-proof");
  await git(root, "commit", "--allow-empty", "-m", "Create unrelated side-branch proof");
  const sideBranchCommit = (await git(root, "rev-parse", "HEAD")).trim();
  await git(root, "switch", "main");
  const completedAttestation = await createResource(root, {
    id: "attestation-route-delivery",
    type: "attestation",
    title: "Reporting route delivery acknowledgement",
    status: "completed",
    programId: route.programId,
    subjectResourceIds: [policy.id],
    personId: "person-example",
    attestationKind: "security-policy-acknowledgement",
    assignedOn: "2021-09-01",
    completedOn: "2021-09-01",
    attestationMethod: "external-record",
    evidenceIds: ["evidence-example"]
  });
  assert.equal(completedAttestation.record.reportingRouteSetId, route.id);
  assert.match(completedAttestation.record.reportingRouteSetCommit, /^[a-f0-9]{40}$/);
  await git(root, "add", ".");
  await git(root, "commit", "-m", "Record route delivery acknowledgement");
  const attestationPath = join(root, "data", "attestations", "attestation-route-delivery.json");
  const boundAttestation = JSON.parse(await readFile(attestationPath, "utf8"));
  const loadedForBinding = await loadWorkspace(root);
  const intradayBinding = reportingRouteBindingExpectation({
    ...loadedForBinding,
    resources: loadedForBinding.resources.map((record) => record.id === route.id ? {
      ...record,
      approval: { ...record.approval, effectiveAt: "2021-09-01T12:00:00-05:00" }
    } : record)
  }, { ...boundAttestation, assignedOn: "2021-09-01", assignedAt: undefined });
  assert.match(intradayBinding.error, /assignedAt is required/);
  const malformedHistoricalBinding = reportingRouteBindingExpectation({
    ...loadedForBinding,
    resources: loadedForBinding.resources.map((record) => record.id === policy.id ? {
      ...record,
      reportingRouteRequirements: { purposeKey: "security-reporting" }
    } : record)
  }, boundAttestation);
  assert.match(malformedHistoricalBinding.error, /must be arrays/);
  const wrongProgramBinding = reportingRouteBindingExpectation({
    ...loadedForBinding,
    resources: [...loadedForBinding.resources, {
      ...byId.get("program-example"),
      id: "program-unrelated",
      title: "Unrelated program"
    }]
  }, { ...boundAttestation, programId: "program-unrelated" });
  assert.match(wrongProgramBinding.error, /No Reporting Channel Set governed/);
  const omittedBinding = { ...boundAttestation };
  delete omittedBinding.reportingRouteSetId;
  delete omittedBinding.reportingRouteSetCommit;
  await writeJson(attestationPath, omittedBinding);
  let bindingValidation = await validateWorkspace(root);
  assert.ok(bindingValidation.diagnostics.some(({ code }) => code === "invalid-reporting-route-binding"));
  await writeJson(attestationPath, {
    ...boundAttestation,
    reportingRouteSetCommit: sideBranchCommit
  });
  bindingValidation = await validateWorkspace(root);
  assert.ok(bindingValidation.diagnostics.some(({ code }) => code === "invalid-reporting-route-binding"));
  await writeJson(attestationPath, boundAttestation);
  const programPath = join(root, "data", "programs", `${route.programId}.json`);
  const boundProgram = JSON.parse(await readFile(programPath, "utf8"));
  await writeJson(programPath, { ...boundProgram, controlIds: [] });
  bindingValidation = await validateWorkspace(root);
  assert.equal(bindingValidation.diagnostics.some(({ code }) => code === "invalid-reporting-route-binding"), false);
  await writeJson(programPath, boundProgram);

  const assessment = await assessReportingRouteSets(root, { programId: route.programId });
  assert.deepEqual(assessment.issues, []);
  const unknownProgramAssessment = await assessReportingRouteSets(root, { programId: "program-typo" });
  assert.ok(unknownProgramAssessment.issues.some(({ code }) => code === "invalid-program"));
  const unknownProgramPeriod = await assessReportingRoutePeriod(root, {
    programId: "program-typo",
    start: "2021-09-01",
    end: "2021-09-30",
    timezone: "UTC"
  });
  assert.ok(unknownProgramPeriod.issues.some(({ code }) => code === "invalid-program"));
  const packetValidation = await validateWorkspace(root);
  assert.deepEqual(
    packetValidation.diagnostics.filter(({ severity }) => severity === "error"),
    [],
    packetValidation.diagnostics.map(({ message }) => message).join("\n")
  );
  const packet = await prepareEvidencePacket(root, { auditId: audit.id });
  assert.ok(packet.records.some(({ id }) => id === route.id));
  assert.ok(packet.records.some(({ id }) => id === "appointment-route-approver"));
  assert.ok(packet.records.some(({ id }) => id === "person-independent-approver-example"));
  assert.ok(packet.records.some(({ id }) => id === "appointment-example"));
  assert.ok(packet.records.some(({ id }) => id === "appointment-route-authority-successor"));
  assert.ok(packet.records.some(({ id }) => id === "person-route-authority-successor"));
  assert.ok(packet.records.some(({ id }) => id === "person-example"));
  assert.ok(packet.evidence.some(({ id }) => id === "evidence-example"));
  assert.equal(packet.records.some(({ id }) => id === "reporting-route-set-unrelated-draft"), false);
  assert.equal(JSON.stringify(packet).includes("private-draft-destination@example.test"), false);
  const writtenPacket = await writeEvidencePacket(root, packet, { output: ".filegrc/route-authority-packet" });
  assert.ok(writtenPacket.files.includes("records/appointment/appointment-route-approver.json"));
  assert.ok(writtenPacket.files.includes("records/person/person-independent-approver-example.json"));
  assert.ok(writtenPacket.files.includes("records/appointment/appointment-example.json"));
  assert.ok(writtenPacket.files.includes("records/appointment/appointment-route-authority-successor.json"));
  assert.ok(writtenPacket.files.includes("records/evidence/evidence-example.json"));
});

test("detects current route, authority, and requirement corruption", async (context) => {
  const { root, byId, route, policy, canonicalRoutePath } = await cloneApprovedRouteWorkspace(context, "filegrc-route-corruption-");
  const unrelatedDraftPath = join(root, "data", "reporting-route-sets", "reporting-route-set-unrelated-draft.json");
  const unrelatedDraft = JSON.parse(await readFile(unrelatedDraftPath, "utf8"));
  const approvedPath = join(root, canonicalRoutePath);
  const approvedRecord = JSON.parse(await readFile(approvedPath, "utf8"));
  await writeJson(approvedPath, {
    ...approvedRecord,
    approval: {
      ...approvedRecord.approval,
      approvedAt: "2099-01-01T00:00:00Z",
      effectiveAt: "2099-01-01T00:00:00Z"
    }
  });
  const beforeEventAssessment = await assessReportingRouteSets(root, { programId: route.programId });
  assert.ok(beforeEventAssessment.issues.some(({ code }) => code === "future-reporting-route-approval"));
  await writeJson(approvedPath, {
    ...approvedRecord,
    approval: { ...approvedRecord.approval, proposalCommit: "f".repeat(40) }
  });
  const mismatchedProposalReference = await validateWorkspace(root);
  assert.ok(mismatchedProposalReference.diagnostics.some(({ code, message }) => (
    code === "invalid-reporting-route-proposal" && /must match/.test(message)
  )));
  await writeJson(approvedPath, {
    ...approvedRecord,
    approval: { ...approvedRecord.approval, approvedById: "person-example" }
  });
  const mismatchedActor = await validateWorkspace(root);
  assert.ok(mismatchedActor.diagnostics.some(({ code }) => code === "invalid-reporting-route-authority"));
  const mismatchedReadiness = await assessReportingRouteSets(root, { programId: route.programId });
  assert.ok(mismatchedReadiness.issues.some(({ code }) => code === "invalid-reporting-route-authority"));
  await writeJson(approvedPath, {
    ...approvedRecord,
    approval: {
      ...approvedRecord.approval,
      approvalAppointmentId: "appointment-route-approver-out-of-scope"
    }
  });
  const outOfScopeAuthority = await validateWorkspace(root);
  assert.ok(outOfScopeAuthority.diagnostics.some(({ code, message }) => (
    code === "invalid-reporting-route-authority" && /does not cover/.test(message)
  )));
  await writeJson(approvedPath, approvedRecord);
  const approvalAppointmentPath = join(root, "data", "appointments", "appointment-route-approver.json");
  const approvalAppointment = JSON.parse(await readFile(approvalAppointmentPath, "utf8"));
  await writeJson(approvalAppointmentPath, { ...approvalAppointment, holderId: "person-example" });
  const rewrittenAuthority = await validateWorkspace(root);
  assert.ok(rewrittenAuthority.diagnostics.some(({ code, message }) => (
    code === "rewritten-finalized-record" && /changed holderId/.test(message)
  )));
  await writeJson(approvalAppointmentPath, approvalAppointment);
  const ongoingAuthorityPath = join(root, "data", "appointments", "appointment-example.json");
  const ongoingAuthority = JSON.parse(await readFile(ongoingAuthorityPath, "utf8"));
  await rm(ongoingAuthorityPath);
  const deletedAuthority = await validateWorkspace(root);
  assert.ok(deletedAuthority.diagnostics.some(({ code, message }) => (
    code === "deleted-finalized-record" && /governed a finalized Route Set/.test(message)
  )));
  await writeJson(ongoingAuthorityPath, ongoingAuthority);
  const authorityHolderPath = join(root, "data", "people", "person-example.json");
  const authorityHolder = JSON.parse(await readFile(authorityHolderPath, "utf8"));
  await rm(authorityHolderPath);
  const deletedAuthorityHolder = await validateWorkspace(root);
  assert.ok(deletedAuthorityHolder.diagnostics.some(({ code, message }) => (
    code === "deleted-finalized-record" && /holder/.test(message)
  )));
  await writeJson(authorityHolderPath, authorityHolder);

  await writeJson(approvedPath, { ...approvedRecord, approval: undefined });
  await writeJson(unrelatedDraftPath, { ...unrelatedDraft, status: "approved" });
  const malformedRoutes = await validateWorkspace(root);
  assert.ok(malformedRoutes.diagnostics.some(({ severity }) => severity === "error"));
  await writeJson(approvedPath, approvedRecord);
  await writeJson(unrelatedDraftPath, unrelatedDraft);
  const policyPath = join(root, "data", "policies", `${policy.id}.json`);
  const protectedPolicy = JSON.parse(await readFile(policyPath, "utf8"));
  await writeJson(policyPath, { ...protectedPolicy, effectiveOn: "2021-02-01" });
  const changedRequirementLifecycle = await validateWorkspace(root);
  assert.ok(changedRequirementLifecycle.diagnostics.some(({ message }) => (
    /changed the effective date/.test(message)
  )));
  await writeJson(policyPath, { ...protectedPolicy, reportingRouteRequirements: [null] });
  const nullRequirement = await validateWorkspace(root);
  assert.ok(nullRequirement.diagnostics.some(({ severity }) => severity === "error"));
  const nullRequirementAssessment = await assessReportingRouteSets(root, { programId: route.programId });
  assert.ok(nullRequirementAssessment.issues.some(({ code }) => code === "invalid-reporting-route-requirement"));
  await writeJson(policyPath, { ...protectedPolicy, reportingRouteRequirements: {} });
  const malformedRequirementCollection = await validateWorkspace(root);
  assert.ok(malformedRequirementCollection.diagnostics.some(({ severity }) => severity === "error"));
  const malformedRequirementReadiness = await assessProgramReadiness(root, { asOf: "2021-09-15" });
  const malformedRequirementItem = malformedRequirementReadiness.stages
    .flatMap(({ items }) => items)
    .find(({ id }) => id === "security-reporting-route-set");
  assert.equal(malformedRequirementItem.status, "action");
  await writeJson(policyPath, {
    ...protectedPolicy,
    reportingRouteRequirements: [{
      ...protectedPolicy.reportingRouteRequirements[0],
      effectiveAt: "not-a-timestamp"
    }]
  });
  const invalidRequirementAssessment = await assessReportingRouteSets(root, { programId: route.programId });
  assert.ok(invalidRequirementAssessment.issues.some(({ code }) => code === "invalid-reporting-route-requirement"));
  const invalidRequirementReadiness = await assessProgramReadiness(root, { asOf: "2021-09-15" });
  const invalidRequirementItem = invalidRequirementReadiness.stages
    .flatMap(({ items }) => items)
    .find(({ id }) => id === "security-reporting-route-set");
  assert.equal(invalidRequirementItem.status, "action");
  await writeJson(policyPath, {
    ...protectedPolicy,
    reportingRouteRequirements: [{
      ...protectedPolicy.reportingRouteRequirements[0],
      timezone: "Not/A_Timezone"
    }]
  });
  const invalidRequirementTimezone = await validateWorkspace(root);
  assert.ok(invalidRequirementTimezone.diagnostics.some(({ severity }) => severity === "error"));
  const invalidTimezoneAssessment = await assessReportingRouteSets(root, { programId: route.programId });
  assert.ok(invalidTimezoneAssessment.issues.some(({ code }) => code === "invalid-reporting-route-requirement"));
  await writeJson(policyPath, protectedPolicy);
  const withoutRouteRequirement = { ...protectedPolicy };
  delete withoutRouteRequirement.reportingRouteRequirements;
  await writeJson(policyPath, withoutRouteRequirement);
  const removedRequirement = await validateWorkspace(root);
  assert.ok(removedRequirement.diagnostics.some(({ message }) => /changed structured Reporting Route requirements/.test(message)));
  await writeJson(policyPath, protectedPolicy);
  const commitment = byId.get("commitment-example");
  await writeRecord(root, "commitments", {
    ...commitment,
    effectiveOn: "2021-09-15",
    systemIds: [byId.get("program-example").systemIds[0]],
    reportingRouteRequirements: [{
      purposeKey: route.purposeKey,
      programScope: "all-programs",
      requiredLanes: ["primary"],
      effectiveAt: "2021-01-01T00:00:00Z",
      timezone: "UTC"
    }]
  });
  const commitmentBoundary = await assessReportingRoutePeriod(root, {
    programId: route.programId,
    start: "2021-09-01",
    end: "2021-09-30",
    timezone: "UTC"
  });
  assert.ok(commitmentBoundary.snapshots.some(({ at }) => at === "2021-09-15T00:00:00.000Z"));
  await writeRecord(root, "commitments", commitment);
  await rm(policyPath);
  const deletedRequirementSource = await validateWorkspace(root);
  assert.ok(deletedRequirementSource.diagnostics.some(({ code, message }) => (
    code === "deleted-finalized-record" && /structured Reporting Route requirements/.test(message)
  )));
  await writeJson(policyPath, protectedPolicy);
  await writeRecord(root, "people", {
    ...byId.get("person-example"),
    status: "inactive",
    endDate: "2021-09-10"
  });
  const missingHolder = await assessReportingRouteSets(root, {
    programId: route.programId,
    at: "2021-09-15T12:00:00-05:00"
  });
  assert.ok(missingHolder.issues.some(({ code }) => code === "missing-reporting-route-authority"));
  const authorityPeriod = await assessReportingRoutePeriod(root, {
    programId: route.programId,
    start: "2021-09-01",
    end: "2021-09-30",
    timezone: "America/Chicago"
  });
  assert.ok(authorityPeriod.snapshots.some(({ at }) => at === "2021-09-11T05:00:00.000Z"));
  assert.ok(authorityPeriod.issues.some(({ code }) => code === "missing-reporting-route-authority"));
  await writeRecord(root, "people", byId.get("person-example"));
});

test("keeps cancellation and period history complete", async (context) => {
  const { root, byId, route, policy } = await cloneApprovedRouteWorkspace(context, "filegrc-route-cancellation-");
  const supportedEvidence = {
    ...byId.get("evidence-example"),
    status: "verified",
    artifactKind: "business-record",
    sourceKind: "file",
    sourceDescription: "An independently retained appointment record.",
    collectedOn: "2021-01-01",
    collectorIds: ["person-example"],
    verifierIds: ["person-independent-approver-example"],
    verifiedOn: "2021-01-01",
    coverage: { kind: "range", startsOn: "2021-01-01", endsOn: "2022-01-02" }
  };
  delete supportedEvidence.externalReference;
  delete supportedEvidence.capture;
  delete supportedEvidence.sourceCommit;
  delete supportedEvidence.sourceComponentId;
  const ongoingAuthorityPath = join(root, "data", "appointments", "appointment-example.json");
  await cancelReportingRouteSet(root, {
    routeSetId: route.id,
    approvalAppointmentId: "appointment-route-approver",
    canceledAt: "2022-01-01T12:00:00-06:00",
    timezone: "America/Chicago",
    reason: "Replaced by a new reporting channel set.",
    evidenceIds: ["evidence-route-cancellation"]
  });
  await git(root, "add", ".");
  await git(root, "commit", "-m", "Cancel reporting routes");
  const canceledPath = join(root, "data", "reporting-route-sets", `${route.id}.json`);
  const canceledRecord = JSON.parse(await readFile(canceledPath, "utf8"));
  const conflictingCancellationAppointmentId = "appointment-conflicting-cancellation-authority";
  const conflictingCancellationEvidenceId = "evidence-conflicting-cancellation-authority";
  const conflictingCancellationEvidenceDirectory = join(root, "data", "evidence", conflictingCancellationEvidenceId);
  await mkdir(conflictingCancellationEvidenceDirectory, { recursive: true });
  await writeJson(join(conflictingCancellationEvidenceDirectory, "evidence.json"), {
    ...supportedEvidence,
    id: conflictingCancellationEvidenceId,
    title: "Archived conflicting cancellation authority appointment",
    sourceResourceIds: [conflictingCancellationAppointmentId],
    coverage: { kind: "range", startsOn: "2021-12-01", endsOn: "2022-01-02" },
    filePaths: [`evidence/${conflictingCancellationEvidenceId}/appointment-record.txt`]
  });
  await writeFile(join(conflictingCancellationEvidenceDirectory, "appointment-record.txt"), "Signed conflicting cancellation authority appointment.\n");
  const conflictingCancellationAppointmentPath = join(root, "data", "appointments", `${conflictingCancellationAppointmentId}.json`);
  await writeJson(conflictingCancellationAppointmentPath, {
    id: conflictingCancellationAppointmentId,
    type: "appointment",
    title: "Conflicting Cancellation Authority",
    status: "ended",
    appointmentKind: route.authorityAppointmentKind,
    holderId: canceledRecord.cancellation.canceledById,
    scopeResourceIds: [route.id],
    startsOn: "2021-12-01",
    endsOn: "2022-01-02",
    statusTransition: {
      changedOn: "2022-01-03",
      changedByIds: ["person-example"],
      reason: "The temporary appointment ended."
    },
    evidenceIds: [conflictingCancellationEvidenceId],
    responsibilities: "Exercise reporting route authority."
  });
  const conflictingCancellationAuthority = await validateWorkspace(root);
  assert.ok(conflictingCancellationAuthority.diagnostics.some(({ code, message }) => (
    code === "reporting-route-authority-not-separated" && /backfilled Appointment/.test(message)
  )));
  await rm(conflictingCancellationAppointmentPath);
  await rm(conflictingCancellationEvidenceDirectory, { recursive: true });
  await writeJson(canceledPath, {
    ...canceledRecord,
    cancellation: { ...canceledRecord.cancellation, canceledById: "person-example" }
  });
  const invalidCancellationActor = await validateWorkspace(root);
  assert.ok(invalidCancellationActor.diagnostics.some(({ code }) => code === "invalid-reporting-route-authority"));
  await writeJson(canceledPath, canceledRecord);
  await assert.rejects(() => createResource(root, {
    id: "attestation-after-route-cancellation",
    type: "attestation",
    title: "Post-cancellation acknowledgement",
    status: "completed",
    programId: route.programId,
    subjectResourceIds: [policy.id],
    personId: "person-example",
    attestationKind: "security-policy-acknowledgement",
    assignedOn: "2022-01-02",
    completedOn: "2022-01-02",
    attestationMethod: "external-record",
    evidenceIds: ["evidence-example"]
  }), /No Reporting Channel Set governed security reporting/);
  const historicalPeriod = await assessReportingRoutePeriod(root, {
    programId: route.programId,
    start: "2021-09-01",
    end: "2021-09-30",
    timezone: "UTC"
  });
  assert.deepEqual(historicalPeriod.issues, []);
  const canceledPeriod = await assessReportingRoutePeriod(root, {
    programId: route.programId,
    start: "2022-01-02",
    end: "2022-01-02",
    timezone: "UTC"
  });
  assert.ok(canceledPeriod.issues.some(({ code }) => code === "uncovered-reporting-route-interval"));
  const malformedAuthority = JSON.parse(await readFile(ongoingAuthorityPath, "utf8"));
  await writeJson(ongoingAuthorityPath, { ...malformedAuthority, startsOn: "not-a-date" });
  const malformedBoundaryPeriod = await assessReportingRoutePeriod(root, {
    programId: route.programId,
    start: "2021-09-01",
    end: "2021-09-30",
    timezone: "UTC"
  });
  assert.ok(malformedBoundaryPeriod.issues.some(({ code }) => code === "invalid-reporting-route-boundary"));
  await writeJson(ongoingAuthorityPath, malformedAuthority);

  policy.approvedOn = "2022-02-01";
  policy.effectiveOn = "2022-02-01";
  policy.reportingRouteRequirements[0].effectiveAt = "2020-01-01T00:00:00Z";
  await writeRecord(root, "policies", policy);
  await git(root, "add", ".");
  await git(root, "commit", "-m", "Move reporting requirement effective date");
  const midPeriodRequirement = await assessReportingRoutePeriod(root, {
    programId: route.programId,
    start: "2022-01-15",
    end: "2022-02-15",
    timezone: "America/Chicago"
  });
  assert.ok(midPeriodRequirement.snapshots.some(({ at }) => at === "2022-02-01T06:00:00.000Z"));
  assert.ok(midPeriodRequirement.issues.some(({ code }) => code === "uncovered-reporting-route-interval"));

  const path = join(root, "data", "reporting-route-sets", `${route.id}.json`);
  const changed = JSON.parse(await readFile(path, "utf8"));
  changed.primaryLane.destination = "changed@example.test";
  await writeJson(path, changed);
  const validation = await validateWorkspace(root);
  assert.ok(validation.diagnostics.some(({ code }) => code === "changed-reporting-route-proposal"));
});
});

test("approves a successor and cancels its live predecessor in one gap-free cutover", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-route-cutover-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const { records } = await makeComprehensiveWorkspace(root);
  const byId = new Map(records.map((record) => [record.id, record]));
  const predecessor = byId.get("reporting-route-set-example");
  predecessor.approvalAppointmentKind = "reporting-route-approver";
  await writeRecord(root, "reporting-route-sets", predecessor);
  await writeRecord(root, "appointments", {
    ...byId.get("appointment-example"),
    startsOn: "2020-01-01"
  });
  await writeRecord(root, "appointments", {
    id: "appointment-route-approver",
    type: "appointment",
    title: "Reporting Route Approver",
    status: "active",
    appointmentKind: "reporting-route-approver",
    holderId: "person-independent-approver-example",
    scopeResourceIds: ["workspace"],
    startsOn: "2020-01-01",
    responsibilities: "Approve reporting channel changes independently."
  });
  await writeFixedRouteEvidence(root, byId.get("evidence-example"), "evidence-initial-route-approval", predecessor.id, "2021-08-01");
  await git(root, "init", "--initial-branch=main");
  await git(root, "config", "user.name", "Test User");
  await git(root, "config", "user.email", "test@example.test");
  await git(root, "add", ".");
  await gitCommitAt(root, "2021-07-30T12:00:00Z", "Create reporting routes");

  await proposeReportingRouteSet(root, { routeSetId: predecessor.id });
  await git(root, "add", ".");
  await gitCommitAt(root, "2021-07-31T12:00:00Z", "Propose initial reporting routes");
  const predecessorProposal = (await git(root, "rev-parse", "HEAD")).trim();
  await approveReportingRouteSet(root, {
    routeSetId: predecessor.id,
    proposalCommit: predecessorProposal,
    approvalAppointmentId: "appointment-route-approver",
    approvedAt: "2021-08-01T17:00:00Z",
    effectiveAt: "2021-08-01T17:00:00Z",
    timezone: "UTC",
    evidenceIds: ["evidence-initial-route-approval"]
  });
  await git(root, "add", ".");
  await git(root, "commit", "-m", "Approve initial reporting routes");

  const successor = {
    ...predecessor,
    id: "reporting-route-set-successor",
    title: "Replacement reporting channels",
    status: "draft",
    predecessorId: predecessor.id,
    primaryLane: { channelKind: "email", destination: "replacement@example.test" }
  };
  await writeRecord(root, "reporting-route-sets", successor);
  await writeFile(
    join(root, "data", "reporting-route-sets", `${successor.id}.md`),
    "# Replacement reporting channels\n\nUse the replacement channel after its approved cutover.\n"
  );
  const pendingValidation = await validateWorkspace(root);
  assert.equal(pendingValidation.diagnostics.some(({ code }) => code === "duplicate-active-relationship"), false);
  assert.equal(pendingValidation.diagnostics.some(({ code }) => code === "ambiguous-reporting-route-set"), false);
  await git(root, "add", ".");
  await git(root, "commit", "-m", "Draft replacement reporting routes");
  await proposeReportingRouteSet(root, { routeSetId: successor.id });
  await git(root, "add", ".");
  await git(root, "commit", "-m", "Propose replacement reporting routes");
  const successorProposal = (await git(root, "rev-parse", "HEAD")).trim();
  const cutoverAt = new Date().toISOString();
  const cutoverDate = cutoverAt.slice(0, 10);
  await writeFixedRouteEvidence(
    root,
    byId.get("evidence-example"),
    "evidence-successor-route-approval",
    successor.id,
    cutoverDate
  );
  await writeFixedRouteEvidence(
    root,
    byId.get("evidence-example"),
    "evidence-predecessor-route-cancellation",
    predecessor.id,
    cutoverDate
  );
  const result = await approveReportingRouteSet(root, {
    routeSetId: successor.id,
    proposalCommit: successorProposal,
    approvalAppointmentId: "appointment-route-approver",
    approvedAt: cutoverAt,
    effectiveAt: cutoverAt,
    timezone: "UTC",
    evidenceIds: ["evidence-successor-route-approval"],
    predecessorCancellationEvidenceIds: ["evidence-predecessor-route-cancellation"]
  });
  assert.equal(result.record.status, "approved");
  assert.equal(result.replacedRouteSet.status, "canceled");
  assert.equal(result.replacedRouteSet.cancellation.canceledAt, cutoverAt);
  await git(root, "add", ".");
  await git(root, "commit", "-m", "Cut over reporting routes");

  const assessment = await assessReportingRouteSets(root, {
    programId: predecessor.programId,
    at: new Date().toISOString(),
    timezone: "UTC"
  });
  assert.equal(assessment.issues.some(({ code }) => code === "uncovered-reporting-route-interval"), false);
  assert.ok(assessment.routeSets.find(({ record }) => record.id === successor.id)?.effective);
  assert.ok(assessment.routeSets.find(({ record }) => record.id === predecessor.id)?.canceled);
  const successorPath = join(root, "data", "reporting-route-sets", `${successor.id}.json`);
  const committedSuccessor = JSON.parse(await readFile(successorPath, "utf8"));
  await writeJson(successorPath, {
    ...committedSuccessor,
    approval: { ...committedSuccessor.approval, effectiveAt: "2021-09-01T00:00:00Z" }
  });
  let invalidHistory = await validateWorkspace(root);
  assert.ok(invalidHistory.diagnostics.some(({ code }) => code === "overlapping-reporting-route-sets"));
  await writeJson(successorPath, committedSuccessor);
  const predecessorPath = join(root, "data", "reporting-route-sets", `${predecessor.id}.json`);
  const committedPredecessor = JSON.parse(await readFile(predecessorPath, "utf8"));
  await writeJson(predecessorPath, {
    ...committedPredecessor,
    cancellation: { ...committedPredecessor.cancellation, canceledAt: "2021-01-01T00:00:00Z" }
  });
  invalidHistory = await validateWorkspace(root);
  assert.ok(invalidHistory.diagnostics.some(({ code }) => code === "invalid-reporting-route-order"));
});

async function writeRecord(root, collection, record) {
  await writeJson(join(root, "data", collection, `${record.id}.json`), record);
}

async function writeFixedRouteEvidence(root, source, id, routeSetId, date) {
  const directory = join(root, "data", "evidence", id);
  await mkdir(directory, { recursive: true });
  const evidence = {
    ...source,
    id,
    title: `Archived ${id}`,
    status: "verified",
    artifactKind: "business-record",
    sourceKind: "file",
    sourceDescription: "An independently retained reporting-route decision record.",
    collectedOn: date,
    verifiedOn: date,
    sourceResourceIds: [routeSetId],
    coverage: { kind: "as-of", on: date },
    filePaths: [`evidence/${id}/decision-record.txt`]
  };
  delete evidence.externalReference;
  delete evidence.capture;
  delete evidence.sourceCommit;
  delete evidence.sourceComponentId;
  await writeJson(join(directory, "evidence.json"), evidence);
  await writeFile(join(directory, "decision-record.txt"), "Retained reporting-route decision record.\n");
}

async function writeBogusRenderedRouteEvidence(root, source, id, subjectId, date) {
  const directory = join(root, "data", "evidence", id);
  await mkdir(directory, { recursive: true });
  const evidence = {
    ...source,
    id,
    title: `Unbound ${id}`,
    status: "verified",
    artifactKind: "business-record",
    sourceKind: "rendered-page",
    sourceDescription: "A rendered record with an unavailable source revision.",
    collectedOn: date,
    verifiedOn: date,
    sourceResourceIds: [subjectId],
    coverage: { kind: "as-of", on: date },
    sourceCommit: "not-a-revision",
    capture: {
      route: `#/resource/${subjectId}`,
      filters: {},
      coverage: { kind: "as-of", on: date },
      capturedAt: `${date}T12:00:00Z`,
      method: "browser-screenshot"
    }
  };
  delete evidence.externalReference;
  delete evidence.filePaths;
  delete evidence.sourceComponentId;
  await writeJson(join(directory, "evidence.json"), evidence);
}

async function git(root, ...args) {
  return (await execute("git", args, { cwd: root })).stdout;
}

async function gitCommitAt(root, date, message) {
  return (await execute("git", ["commit", "-m", message], {
    cwd: root,
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }
  })).stdout;
}
