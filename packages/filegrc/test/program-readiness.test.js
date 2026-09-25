import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runCli } from "../src/cli.js";
import { applicabilityScopeRevision } from "../src/applicability-scope.js";
import {
  calculateProgramProgress,
  collectionReviewReadinessItem,
  controlImplementationSteps,
  controlOversightEligible,
  prioritizeReviewDependencies,
  reportingRouteSetItem,
  selectedAuditWindow,
  selectedProgressWindow
} from "../src/program-readiness.js";
import {
  assessAuditPreparation,
  assessEvidenceMap,
  assessProgramReadiness,
  assessWorkflow,
  createAppState,
  createResource,
  createResources,
  loadWorkspace,
  serveWorkspace,
  updateResource
} from "../src/index.js";
import { executeCli, makeWorkspace } from "./helpers.js";
import { makeComprehensiveWorkspace } from "./fixtures.js";
import { baselineRecordFiles } from "../../create-filegrc/src/defaults.js";

test("every starter Control gets a short implementation action", () => {
  const starterControls = baselineRecordFiles("2026-01-01")
    .map(({ record }) => record).filter(({ type }) => type === "control");
  assert.ok(starterControls.length > 20);
  for (const control of starterControls) {
    const steps = controlImplementationSteps(control, {
      implemented: false,
      owner: true,
      scope: false,
      operationPattern: true,
      procedure: false,
      evidenceSource: false,
      implementationDate: false
    });
    assert.equal(steps.length, 3, control.id);
    assert.notEqual(steps[0], control.activity, control.id);
    assert.ok(steps[0].length < 190, control.id);
    assert.doesNotMatch(steps.join(" "), /applicability|Obligation|Step 4|audit packet/i, control.id);
    assert.doesNotMatch(steps[0], /choose where staff.*report|decide where risks.*recorded|choose data classes|request and approval path/i, control.id);
    if (["control-access-authorization", "control-access-review-offboarding"].includes(control.id)) {
      assert.match(steps[0], /identity system/);
      assert.doesNotMatch(steps[0], /choose who|assign access reviewers|request path|Access grants|Policy Events/);
    }
  }
});

test("implemented Controls still give actions for remaining readiness checks", () => {
  const control = { id: "control-example", title: "Example Control" };
  const checks = {
    applicability: true,
    implemented: true,
    owner: true,
    procedure: true,
    scope: true,
    operationPattern: true,
    evidenceSource: true,
    evidenceSourceReady: true,
    implementationDate: true,
    procedureRevision: true,
    procedureEffective: true,
    policyMapping: true,
    criteriaMapping: true,
    workQueue: true
  };
  assert.deepEqual(controlImplementationSteps(control, checks), []);
  const steps = controlImplementationSteps(control, {
    ...checks,
    applicability: false,
    evidenceSourceReady: false,
    policyMapping: false,
    criteriaMapping: false,
    workQueue: false
  });
  assert.equal(steps.length, 4);
  assert.match(steps[0], /link the Policy.*link the criteria/);
  assert.match(steps[1], /active Component/);
  assert.match(steps[2], /Enable a linked Obligation/);
  assert.match(steps[3], /review-applicability --scaffold --type control/);
});

test("planned Control actions reveal the next prerequisite before implementation", () => {
  const control = { id: "control-example", title: "Example Control", activity: "Configure the real process." };
  const checks = {
    implemented: false,
    owner: true,
    scope: true,
    operationPattern: true,
    procedure: true,
    evidenceSource: true,
    evidenceSourceReady: false,
    policyMapping: true,
    criteriaMapping: true,
    workQueue: false,
    applicability: false,
    procedureRevision: false
  };
  const setup = controlImplementationSteps(control, checks, {
    missingSourceFamilies: [{ title: "Identity and Access", sourceKinds: ["identity-access"] }]
  });
  assert.match(setup.at(-1), /identity-access.*Enable a linked Obligation/);
  assert.doesNotMatch(setup.join(" "), /review-applicability|mark this Control Implemented/);

  const applicability = controlImplementationSteps(control, { ...checks, evidenceSourceReady: true, workQueue: true });
  assert.match(applicability.at(-1), /review-applicability --scaffold --type control/);
  assert.doesNotMatch(applicability.join(" "), /mark this Control Implemented/);

  const final = controlImplementationSteps(control, { ...checks, evidenceSourceReady: true, workQueue: true, applicability: true });
  assert.match(final.at(-1), /mark this Control Implemented.*start date.*Procedure revision/);
});

test("focused Control guidance requires the evidence kind for its source family", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-control-source-kind-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const control = loaded.resources.find(({ type }) => type === "control");
  const input = {
    ...loaded,
    resources: loaded.resources.map((record) => record.id === control.id ? { ...record, code: "IAM-01" } : record)
  };
  const readiness = await assessProgramReadiness(input, { asOf: "2026-09-12" });
  const item = readiness.stages.find(({ id }) => id === "controls")
    .items.find(({ id }) => id === `control-${control.id}`);
  assert.equal(item.checks.evidenceSource, true);
  assert.equal(item.checks.evidenceSourceReady, false);
  assert.match(item.nextSteps.join(" "), /Identity and Access \(identity-access\)/);
});

test("multi-family Control guidance names only the uncovered source family", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-control-multi-family-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const control = loaded.resources.find(({ type }) => type === "control");
  const readiness = await assessProgramReadiness({
    ...loaded,
    resources: loaded.resources.map((record) => record.id === control.id ? { ...record, code: "HR-01" } : record)
  }, { asOf: "2026-09-12" });
  const item = readiness.stages.find(({ id }) => id === "controls")
    .items.find(({ id }) => id === `control-${control.id}`);
  assert.equal(item.checks.evidenceSourceReady, false);
  assert.match(item.nextSteps.join(" "), /Training and Acknowledgements \(training-acknowledgement\)/);
  assert.doesNotMatch(item.nextSteps.join(" "), /Workforce \(workforce\)/);
});

test("program path does not select another Program's Audit", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-program-audit-scope-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const program = loaded.resources.find(({ type }) => type === "program");
  const audit = loaded.resources.find(({ type }) => type === "audit");
  await createResource(root, { ...program, id: "program-secondary", title: "Secondary Program" });

  const existingAuditReadiness = await assessAuditPreparation(root, { auditId: audit.id });
  const expectedAuditAction = existingAuditReadiness.stages.flatMap(({ items }) => items)
    .find(({ status }) => status === "action");
  const existingAuditPath = JSON.parse((await execute(process.execPath, [
    cli, "program-path", "--root", root, "--audit", audit.id, "--json"
  ])).stdout);
  assert.equal(existingAuditPath.stages.find(({ id }) => id === "audit").nextActions[0]?.id, expectedAuditAction.id);

  const readiness = await assessAuditPreparation(root, { programId: "program-secondary" });
  assert.equal(readiness.audit, null);
  const browserState = await createAppState(root, { programId: "program-secondary" });
  assert.equal(browserState.selectedProgramId, "program-secondary");
  assert.equal(browserState.auditPreparations.none.audit, null);
  const path = JSON.parse((await execute(process.execPath, [
    cli, "program-path", "--root", root, "--program", "program-secondary", "--json"
  ])).stdout);
  assert.equal(path.stages.find(({ id }) => id === "audit").nextActions[0]?.id, "create-audit");
  await assert.rejects(
    () => assessAuditPreparation(root, { programId: "program-secondary", auditId: audit.id }),
    /does not belong to Program "program-secondary"/
  );
  await assert.rejects(
    () => execute(process.execPath, [cli, "program-path", "--root", root, "--program", "program-secondary", "--audit", audit.id]),
    /does not belong to Program "program-secondary"/
  );
});

const execute = (executable, args) => executeCli(runCli, executable, args);
const cli = fileURLToPath(new URL("../bin/filegrc.js", import.meta.url));

test("orders collection confirmations after unfinished revision inputs while leaving independent reviews actionable", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-review-order-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const program = loaded.resources.find(({ type }) => type === "program");
  const stage = { items: [
    { id: "collection-review-complementary-control", status: "action", resourceType: "complementary-control" },
    { id: "collection-review-classification", status: "action", resourceType: "classification" },
    { id: "collection-review-framework", status: "action", resourceType: "framework" },
    { id: "control-work", status: "action", resourceType: "control" },
    { id: "system-work", status: "action", resourceType: "system" },
    { id: "program-work", status: "action", resourceType: "program" }
  ] };
  prioritizeReviewDependencies([stage], loaded, program);
  assert.deepEqual(stage.items.map(({ id }) => id), [
    "collection-review-classification",
    "control-work",
    "system-work",
    "program-work",
    "collection-review-complementary-control",
    "collection-review-framework"
  ]);
  assert.ok(stage.items.every(({ status }) => status === "action"));

  const crossStage = [
    { items: [
      { id: "collection-review-retention-schedule-item", status: "action", resourceType: "retention-schedule-item" },
      { id: "collection-review-classification", status: "action", resourceType: "classification" }
    ] },
    { items: [{ id: "control-work", status: "action", resourceType: "control" }] }
  ];
  const crossLoaded = {
    ...loaded,
    resources: [...loaded.resources, {
      id: "retention-control-test",
      type: "retention-schedule-item",
      sourceResourceIds: [program.controlIds[0]]
    }]
  };
  const orderedAcrossStages = prioritizeReviewDependencies(crossStage, crossLoaded, program);
  assert.deepEqual(orderedAcrossStages.map(({ id }) => id), [
    "collection-review-classification",
    "control-work",
    "collection-review-retention-schedule-item"
  ]);

  const system = loaded.resources.find(({ type }) => type === "system");
  const changed = {
    ...loaded,
    resources: loaded.resources.map((record) => record.id === system.id
      ? { ...record, status: "planned" }
      : record)
  };
  const readiness = await assessProgramReadiness(changed, { asOf: "2026-09-12" });
  const scopeActions = readiness.stages.find(({ id }) => id === "scope").items
    .filter(({ status }) => status === "action").map(({ id }) => id);
  assert.ok(scopeActions.indexOf("service-boundary") < scopeActions.indexOf("collection-review-framework"));
  assert.ok(scopeActions.indexOf("service-boundary") < scopeActions.indexOf("collection-review-person"));
  assert.ok(scopeActions.indexOf("collection-review-classification") < scopeActions.indexOf("service-boundary"));

  const unscopedProgram = { ...program, systemIds: [], controlIds: [] };
  const unscoped = await assessProgramReadiness({
    ...loaded,
    resources: loaded.resources.map((record) => record.id === program.id ? unscopedProgram : record)
  }, { asOf: "2026-09-12" });
  const unscopedActions = unscoped.stages.find(({ id }) => id === "scope").items
    .filter(({ status }) => status === "action").map(({ id }) => id);
  assert.ok(unscopedActions.indexOf("service-boundary") < unscopedActions.indexOf("collection-review-information-type"));
});

test("CLI and browser state recommend Control work before the dependent collection review", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-review-order-surfaces-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "11");
  const cliReadiness = JSON.parse((await execute(process.execPath, [
    cli, "program-readiness", "--root", root, "--json"
  ])).stdout);
  const cliActions = cliReadiness.stages.find(({ id }) => id === "controls").items
    .filter(({ status }) => status === "action").map(({ id }) => id);
  assert.ok(cliActions.indexOf("control-control-example") < cliActions.indexOf("collection-review-complementary-control"));
  const path = JSON.parse((await execute(process.execPath, [
    cli, "program-path", "--root", root, "--json"
  ])).stdout);
  assert.deepEqual(path.stages.find(({ id }) => id === "controls").nextActions.map(({ id }) => id), cliActions);
  const running = await serveWorkspace(root, { port: 0 });
  context.after(() => new Promise((resolve) => running.server.close(resolve)));
  const browserState = await fetch(`${running.url}/api/state`).then((response) => response.json());
  const browserActions = browserState.programReadiness.stages.find(({ id }) => id === "controls").items
    .filter(({ status }) => status === "action").map(({ id }) => id);
  assert.deepEqual(browserActions, cliActions);
});

test("counts distinct readiness actions until the Type 2 window starts", () => {
  const input = {
    stages: [
      { id: "scope", items: [{ id: "scope", status: "complete" }] },
      {
        id: "controls",
        items: [
          { id: "control-access", status: "action" },
          { id: "control-access", status: "action" },
          { id: "summary", status: "action", progressUnit: false }
        ]
      },
      { id: "operation", items: [{ id: "operation-later", status: "later" }] }
    ],
    target: {
      goal: "soc-2-type-2",
      candidateCoverage: { kind: "range", startsOn: "2026-10-01", endsOn: "2026-12-29" }
    },
    asOf: "2026-09-14"
  };
  assert.deepEqual(calculateProgramProgress(input), {
    mode: "setup-progress",
    label: "Program setup",
    status: "Needs work",
    complete: 2,
    total: 3,
    remaining: 1,
    percent: 67,
    unit: "action",
    detail: "2 of 3 required actions complete.",
    operating: false
  });

  input.stages[1].items[0].status = "complete";
  input.stages[1].items[1].status = "complete";
  assert.equal(calculateProgramProgress(input).percent, 100);
  assert.equal(calculateProgramProgress(input).remaining, 0);
  assert.equal(calculateProgramProgress({ ...input, evidenceReady: true }).status, "Scheduled");
});

test("counts each retention row proposal and one final schedule approval", () => {
  const stages = [{
    id: "policies",
    items: [
      { id: "retention-rule-customer", status: "complete" },
      { id: "retention-rule-security", status: "action" },
      { id: "collection-review-retention-schedule-item", status: "action" },
      { id: "retention-use-customer", status: "complete", progressUnit: false }
    ]
  }, {
    id: "controls",
    items: [
      { id: "retention-source-coverage-logs", status: "complete", progressUnit: false }
    ]
  }];
  const target = { goal: "soc-2-type-1" };
  assert.deepEqual(calculateProgramProgress({ stages, target }), {
    mode: "setup-progress",
    label: "Program setup",
    status: "Needs work",
    complete: 1,
    total: 3,
    remaining: 2,
    percent: 33,
    unit: "action",
    detail: "1 of 3 required actions complete.",
    operating: false
  });
  stages[0].items[1].status = "complete";
  assert.equal(calculateProgramProgress({ stages, target }).complete, 2);
  stages[0].items[2].status = "complete";
  assert.equal(calculateProgramProgress({ stages, target }).complete, 3);
});

test("counts a proposal collection and its final review as two progress units", () => {
  const stages = [{
    id: "scope",
    items: [{
      id: "collection-review-component",
      status: "action",
      progressUnits: [
        { id: "component-proposal-batch", status: "action" },
        { id: "component-review", status: "blocked" }
      ]
    }]
  }];
  const progress = calculateProgramProgress({ stages, target: { goal: "soc-2-type-1" } });
  assert.equal(progress.complete, 0);
  assert.equal(progress.total, 2);
  assert.equal(progress.remaining, 2);
  stages[0].items[0].progressUnits[0].status = "complete";
  stages[0].items[0].progressUnits[1].status = "complete";
  assert.equal(calculateProgramProgress({ stages, target: { goal: "soc-2-type-1" } }).percent, 100);
});

test("rolls collection proposals into one preparation unit and one review unit", () => {
  const assessment = {
    resourceType: "component",
    complete: false,
    status: "pending",
    message: "Finish the proposals, then review the collection.",
    configuration: {
      title: "Scoped Components",
      reviewPoints: ["Confirm the complete set."]
    },
    recordProposals: [
      { resourceId: "component-a", title: "Component A", complete: true },
      { resourceId: "component-b", title: "Component B", complete: false }
    ]
  };
  const pending = collectionReviewReadinessItem(assessment);
  assert.deepEqual(pending.progressUnits.map(({ id, status }) => ({ id, status })), [
    { id: "component-proposal-batch", status: "action" },
    { id: "component-collection-review", status: "blocked" }
  ]);

  assessment.recordProposals[1].complete = true;
  const prepared = collectionReviewReadinessItem(assessment);
  assert.deepEqual(prepared.progressUnits.map(({ status }) => status), ["complete", "action"]);

  assessment.complete = true;
  const reviewed = collectionReviewReadinessItem(assessment);
  assert.deepEqual(reviewed.progressUnits.map(({ status }) => status), ["complete", "complete"]);

  const schedule = collectionReviewReadinessItem({
    ...assessment,
    resourceType: "retention-schedule-item"
  });
  assert.equal(schedule.progressUnits, undefined);
  assert.equal(schedule.status, "complete");

  assessment.recordProposals[1].complete = false;
  const blockedSchedule = collectionReviewReadinessItem({
    ...assessment,
    resourceType: "retention-schedule-item",
    complete: false
  });
  assert.equal(blockedSchedule.status, "blocked");
  assessment.recordProposals[1].complete = true;

  const empty = collectionReviewReadinessItem({
    ...assessment,
    recordProposals: []
  });
  assert.equal(empty.progressUnits, undefined);

  const reviewOnly = collectionReviewReadinessItem({
    ...assessment,
    resourceType: "person",
    recordCount: 2,
    recordProposals: undefined
  });
  assert.equal(reviewOnly.progressUnits, undefined);
});

test("does not count a canceled optional Reporting Channel Set as setup work", () => {
  const item = reportingRouteSetItem({
    routeSets: [{
      record: { id: "route-canceled", type: "reporting-route-set", title: "Old channels", status: "canceled", purposeKey: "security-reporting" },
      canceled: true,
      effective: false,
      committed: true,
      proposedRequirementIssues: []
    }],
    requirements: [],
    proposedRequirements: [],
    issues: []
  });
  assert.equal(item.status, "info");
  assert.deepEqual(item.progressUnits || [], []);
});

test("does not count historical optional routes and accepts a still-effective cancellation", () => {
  const historical = reportingRouteSetItem({
    routeSets: [{
      record: { id: "route-historical", type: "reporting-route-set", title: "Historical channels", status: "historical", purposeKey: "security-reporting" },
      canceled: false,
      effective: false,
      committed: true,
      proposedRequirementIssues: []
    }],
    requirements: [],
    proposedRequirements: [],
    issues: []
  });
  assert.deepEqual(historical.progressUnits || [], []);

  const currentCancellation = reportingRouteSetItem({
    routeSets: [{
      record: { id: "route-current", type: "reporting-route-set", title: "Current channels", status: "canceled", purposeKey: "security-reporting" },
      canceled: false,
      effective: true,
      committed: true,
      proposedRequirementIssues: []
    }],
    requirements: [{ purposeKey: "security-reporting" }],
    proposedRequirements: [],
    issues: []
  });
  assert.equal(currentCancellation.status, "complete");
  assert.deepEqual(currentCancellation.progressUnits.map(({ status }) => status), ["complete", "complete"]);

  const invalidEffective = reportingRouteSetItem({
    routeSets: [{
      record: { id: "route-invalid", type: "reporting-route-set", title: "Invalid channels", status: "approved", purposeKey: "security-reporting" },
      canceled: false,
      effective: true,
      committed: true,
      proposedRequirementIssues: []
    }],
    requirements: [{ purposeKey: "security-reporting" }],
    proposedRequirements: [],
    issues: [{ code: "missing-alternate", message: "Add the fallback channel." }]
  });
  assert.equal(invalidEffective.status, "action");
  assert.deepEqual(invalidEffective.progressUnits.map(({ status }) => status), ["complete", "action"]);

  const mixedPurposes = reportingRouteSetItem({
    programId: "program-example",
    routeSets: ["security", "privacy"].map((purposeKey) => ({
      record: { id: `route-${purposeKey}`, type: "reporting-route-set", title: `${purposeKey} channels`, status: "approved", purposeKey },
      canceled: false,
      effective: true,
      committed: true,
      proposedRequirementIssues: []
    })),
    requirements: ["security", "privacy"].map((purposeKey) => ({ purposeKey, sourceId: `policy-${purposeKey}` })),
    proposedRequirements: [],
    issues: [{ code: "missing-alternate", resourceId: "route-security", message: "Add the security fallback channel." }]
  });
  assert.deepEqual(
    mixedPurposes.progressUnits.filter(({ id }) => id.includes("approval")).map(({ status }) => status),
    ["action", "complete"]
  );
});

test("switches readiness progress to elapsed window time without tracking audit work", () => {
  const premature = calculateProgramProgress({
    stages: [{ id: "controls", items: [{ id: "control-access", status: "action" }] }],
    target: {
      goal: "soc-2-type-2",
      candidateCoverage: { kind: "range", startsOn: "2026-09-01", endsOn: "2026-09-30" }
    },
    evidenceReady: false,
    asOf: "2026-09-10"
  });
  assert.equal(premature.mode, "operating-window");
  assert.equal(premature.status, "Needs attention");
  assert.equal(premature.source, "candidate");

  const progress = calculateProgramProgress({
    stages: [{ id: "controls", items: [{ id: "control-access", status: "complete" }] }],
    target: {
      goal: "soc-2-type-2",
      candidateCoverage: { kind: "range", startsOn: "2026-09-01", endsOn: "2026-09-30" }
    },
    evidenceReady: true,
    operating: true,
    asOf: "2026-09-10",
    window: { kind: "range", startsOn: "2026-09-01", endsOn: "2026-09-10" }
  });
  assert.deepEqual(progress, {
    mode: "operating-window",
    label: "Audit window",
    status: "Window complete",
    complete: 10,
    total: 10,
    remaining: 0,
    percent: 100,
    unit: "day",
    start: "2026-09-01",
    end: "2026-09-10",
    source: "audit",
    detail: "10 of 10 days elapsed.",
    operating: true
  });

  const candidate = calculateProgramProgress({
    target: {
      goal: "soc-2-type-2",
      candidateCoverage: { kind: "range", startsOn: "2026-09-01", endsOn: "2026-09-30" }
    },
    evidenceReady: true,
    operating: false,
    asOf: "2026-09-10"
  });
  assert.equal(candidate.mode, "operating-window");
  assert.equal(candidate.label, "Operating window");
  assert.equal(candidate.status, "Needs attention");
  assert.equal(candidate.complete, 10);
  assert.equal(candidate.total, 30);
  assert.equal(candidate.percent, 33);
});

test("keeps a started formal audit window visible when readiness regresses", () => {
  const progress = calculateProgramProgress({
    stages: [{ id: "controls", items: [{ id: "control-access", status: "action" }] }],
    target: { goal: "soc-2-type-2" },
    evidenceReady: false,
    operating: false,
    asOf: "2026-09-30",
    window: { kind: "range", startsOn: "2026-09-01", endsOn: "2026-09-30" }
  });
  assert.equal(progress.mode, "operating-window");
  assert.equal(progress.label, "Audit window");
  assert.equal(progress.percent, 100);
  assert.equal(progress.status, "Needs attention");
});

test("selects the newest started formal audit window deterministically", () => {
  const program = { id: "program-security", assuranceGoal: "soc-2-type-2" };
  const audits = [
    {
      id: "audit-new-planned",
      type: "audit",
      auditKind: "soc-2-type-2",
      programId: program.id,
      status: "planned",
      coverage: { kind: "range", startsOn: "2026-04-01", endsOn: "2026-06-30" }
    },
    {
      id: "audit-old-fieldwork",
      type: "audit",
      auditKind: "soc-2-type-2",
      programId: program.id,
      status: "fieldwork",
      coverage: { kind: "range", startsOn: "2026-01-01", endsOn: "2026-03-31" }
    }
  ];
  assert.deepEqual(selectedAuditWindow(audits, program, "2026-05-01"), audits[0].coverage);
  assert.deepEqual(selectedAuditWindow(audits.reverse(), program, "2026-05-01"), audits[1].coverage);
});

test("selects the newest started window across candidate and formal periods", () => {
  const candidate = { kind: "range", startsOn: "2026-04-01", endsOn: "2026-06-30" };
  const olderAudit = { kind: "range", startsOn: "2026-01-01", endsOn: "2026-03-31" };
  assert.deepEqual(selectedProgressWindow(candidate, olderAudit, "2026-05-01"), {
    start: "2026-04-01",
    end: "2026-06-30",
    source: "candidate"
  });
  const futureCandidate = { kind: "range", startsOn: "2027-01-01", endsOn: "2027-06-30" };
  assert.equal(selectedProgressWindow(futureCandidate, olderAudit, "2026-05-01").source, "audit");
});

test("reveals Control oversight only after every earlier Step 3 item is complete", () => {
  assert.equal(controlOversightEligible([]), false);
  assert.equal(controlOversightEligible([{ status: "complete" }, { status: "action" }]), false);
  assert.equal(controlOversightEligible([{ status: "complete" }, { status: "complete" }]), true);
});

test("reports current and stale Control applicability reviews against the resolved Program", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-control-applicability-readiness-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "10");
  const loaded = await loadWorkspace(root);
  const program = loaded.resources.find(({ type }) => type === "program");
  const control = loaded.resources.find(({ type, id }) => (
    type === "control" && (program.controlIds || []).includes(id)
  ));
  const reviewedControl = {
    ...control,
    applicabilityReview: {
      decision: "applicable",
      rationale: "This Control implements requirements selected for the Program.",
      reviewedByIds: ["person-independent-approver-example"],
      reviewedOn: "2026-09-12",
      scopeRevision: applicabilityScopeRevision(control, program, loaded.resources, loaded.model)
    }
  };
  const withReview = {
    ...loaded,
    resources: loaded.resources.map((record) => record.id === control.id ? reviewedControl : record)
  };

  const current = await assessProgramReadiness(withReview, { asOf: "2026-09-12" });
  const currentItem = current.stages.find(({ id }) => id === "controls")
    .items.find(({ id }) => id === `control-${control.id}`);
  assert.equal(currentItem.checks.applicability, true);

  const changedProgram = { ...program, riskMethodology: "Changed likelihood and impact method" };
  const stale = await assessProgramReadiness({
    ...withReview,
    resources: withReview.resources.map((record) => record.id === program.id ? changedProgram : record)
  }, { asOf: "2026-09-12" });
  const staleItem = stale.stages.find(({ id }) => id === "controls")
    .items.find(({ id }) => id === `control-${control.id}`);
  assert.equal(staleItem.checks.applicability, false);
});

test("counts owner-recorded Control implementation before revealing final collection oversight", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-control-owner-implementation-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const program = loaded.resources.find(({ type }) => type === "program");
  const control = loaded.resources.find(({ type, id }) => type === "control" && program.controlIds.includes(id));
  const readiness = await assessProgramReadiness(root, { asOf: "2026-09-12" });
  const stage = readiness.stages.find(({ id }) => id === "controls");
  const item = stage.items.find(({ id }) => id === `control-${control.id}`);
  const oversight = stage.items.find(({ id }) => id === "collection-review-control");
  assert.equal(item.checks.implemented, true);
  assert.equal(item.checks.implementationReview, undefined);
  assert.doesNotMatch(item.message, /independent implementation review/i);
  assert.equal(oversight, undefined);
  assert.ok(stage.counts.complete > 0);
});

test("gives a planned Control plain Step 3 actions in readiness and workflow", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-control-next-steps-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const program = loaded.resources.find(({ type }) => type === "program");
  const control = loaded.resources.find(({ type, id }) => type === "control" && program.controlIds.includes(id));
  const planned = {
    ...control,
    status: "planned",
    ownerIds: [],
    systemIds: [],
    evidenceSourceComponentIds: [],
    applicabilityReview: undefined,
    effectiveOn: undefined,
    procedureRevision: undefined,
    procedureEffectiveOn: undefined
  };
  const input = {
    ...loaded,
    resources: loaded.resources.map((record) => record.id === control.id ? planned : record)
  };
  const readiness = await assessProgramReadiness(input, { asOf: "2026-09-12" });
  const item = readiness.stages.find(({ id }) => id === "controls")
    .items.find(({ id }) => id === `control-${control.id}`);
  assert.equal(item.message, item.nextSteps[0]);
  assert.equal(item.nextSteps.length, 3);
  assert.equal(item.nextSteps[0], `Set up this Control: ${control.activity}`);
  assert.match(item.nextSteps[1], /choose an owner; select the Systems this covers; link the tool or system that can show it happened/);
  assert.match(item.nextSteps[2], /active Component/);
  assert.doesNotMatch(item.nextSteps.join(" "), /applicab|Step 4|mark this Control Implemented/i);
  const workflow = await assessWorkflow(input, { asOf: "2026-09-12", programReadiness: readiness });
  const finding = workflow.findings.find(({ code }) => code === `program.controls.control-${control.id}`);
  assert.deepEqual(finding.nextSteps, item.nextSteps);

  await updateResource(root, "control", control.id, { ...planned, ownerIds: control.ownerIds });
  const persistedItem = (await assessProgramReadiness(root, { asOf: "2026-09-12" }))
    .stages.find(({ id }) => id === "controls").items.find(({ id }) => id === `control-${control.id}`);
  const textResult = await execute(process.execPath, [cli, "program-readiness", "--root", root, "--as-of", "2026-09-12"]);
  const jsonResult = await execute(process.execPath, [cli, "program-readiness", "--root", root, "--as-of", "2026-09-12", "--json"]);
  const focusedText = await execute(process.execPath, [cli, "program-readiness", "--root", root, "--as-of", "2026-09-12", "--control", control.id]);
  const focusedJson = await execute(process.execPath, [cli, "program-readiness", "--root", root, "--as-of", "2026-09-12", "--control", control.id, "--json"]);
  const cliItem = JSON.parse(jsonResult.stdout).stages.find(({ id }) => id === "controls")
    .items.find(({ id }) => id === `control-${control.id}`);
  assert.deepEqual(cliItem.nextSteps, persistedItem.nextSteps);
  assert.deepEqual(JSON.parse(focusedJson.stdout).nextSteps, persistedItem.nextSteps);
  assert.match(focusedText.stdout, new RegExp(control.code));
  assert.doesNotMatch(focusedText.stdout, /\nPolicy activation assessments\n/);
  for (const [index, step] of cliItem.nextSteps.entries()) {
    assert.ok(textResult.stdout.includes(`  ${index + 1}. ${step}`));
    assert.ok(focusedText.stdout.includes(`  ${index + 1}. ${step}`));
  }
  assert.doesNotMatch(focusedText.stdout, /review-applicability|mark this Control Implemented/);
  assert.doesNotMatch(focusedText.stdout, /Step 4/);
  const getResult = await execute(process.execPath, [cli, "get", "control", control.id, "--root", root, "--workflow"]);
  const getFinding = JSON.parse(getResult.stdout).workflow.findings.find(({ code }) => code === `program.controls.control-${control.id}`);
  assert.deepEqual(getFinding.nextSteps, persistedItem.nextSteps);
});

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
    id: "policy-security",
    type: "policy",
    title: "Security policy",
    status: "draft",
    ownerIds: ["person-owner"]
  }, {
    content: { content: "# Security policy" }
  });
  await createResource(root, {
    id: "team-security-risk-oversight",
    type: "team",
    title: "Security and Risk Oversight",
    status: "inactive",
    purpose: "Review security and risk decisions.",
    memberIds: ["person-owner"],
    chairIds: [],
    statusTransition: {
      changedByIds: ["person-owner"],
      changedOn: "2026-08-02",
      reason: "The oversight team has not been activated."
    }
  });
  await createResource(root, {
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
  assert.match(pendingOwnership.message, /This team owns 1 proposed obligation/);
  assert.doesNotMatch(pendingOwnership.message, /obligation-quarterly-oversight/);
  assert.match(pendingOwnership.message, /Activate Security and Risk Oversight/);
  assert.deepEqual(pendingOwnership.commands, [
    "npx filegrc guide person --json",
    "npx filegrc guide appointment --json",
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
  const { statusTransition: _statusTransition, ...activeTeam } = team;
  await updateResource(root, "team", team.id, {
    ...activeTeam,
    status: "active",
    memberIds: ["person-owner", "person-approver"],
    chairIds: ["person-approver"]
  });
  const owner = loaded.resources.find(({ id }) => id === "person-owner");
  const ownerWithoutJobTitle = { ...owner };
  delete ownerWithoutJobTitle.jobTitle;
  await updateResource(root, "person", owner.id, ownerWithoutJobTitle);
  const missingTitle = await assessProgramReadiness(root, { asOf: "2026-07-01" });
  const missingTitleOwnership = missingTitle.stages
    .find(({ id }) => id === "scope")
    .items.find(({ id }) => id === "program-ownership");
  assert.equal(missingTitleOwnership.status, "action");
  assert.deepEqual(missingTitleOwnership.missingJobTitleIds, ["person-owner"]);
  assert.match(missingTitleOwnership.message, /owner needs an organizational job title/);
  await updateResource(root, "person", owner.id, owner);
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
      id: "team-security-risk-oversight",
      type: "team",
      title: "Security and Risk Oversight",
      status: "active",
      purpose: "Review security and risk decisions.",
      memberIds: ["person-owner", "person-approver"],
      chairIds: ["person-approver"]
    },
    {
      id: "framework-security",
      type: "framework",
      title: "Security criteria",
      status: "active",
      version: "1"
    },
    {
      id: "requirement-access",
      type: "requirement",
      title: "Access requirement",
      frameworkId: "framework-security",
      reference: "TEST1",
      applicability: "applicable"
    },
    {
      id: "system-service",
      type: "system",
      title: "Customer service",
      status: "active",
      criticality: "high",
      ownerIds: ["person-owner"],
      description: "Production customer service and its supporting identity boundary.",
      classificationId: "confidential",
    },
    {
      id: "system-identity",
      type: "system",
      title: "Identity system",
      status: "active",
      criticality: "high",
      ownerIds: ["person-owner"],
      description: "Authoritative identity, role, and access-reporting system.",
      classificationId: "confidential",
      evidenceSourceKinds: ["identity-access"],
      evidenceOwnerIds: ["person-owner"]
    },
    {
      id: "system-governance",
      type: "system",
      title: "Governance repository",
      status: "active",
      criticality: "high",
      ownerIds: ["person-owner"],
      description: "Authoritative governance record repository.",
      classificationId: "confidential",
      evidenceSourceKinds: ["governance"],
      evidenceOwnerIds: ["person-owner"]
    },
    {
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
      operationPattern: "event-driven",
      systemIds: ["system-service"],
      evidenceSourceIds: ["system-identity", "system-governance"],
      policyIds: ["policy-access"],
      effectiveOn: "2026-06-01"
    }
  ]);
  const scopedWorkspace = (await loadWorkspace(root)).workspace;
  await updateResource(root, "workspace", scopedWorkspace.id, {
    ...scopedWorkspace,
    systemIds: ["system-service", "system-identity", "system-governance"]
  });
  const retrievalPending = await assessEvidenceMap(root, { asOf: "2026-07-01" });
  assert.deepEqual(retrievalPending.items[0].sourceSystemChecks, [{
    sourceSystemId: "system-identity",
    complete: false,
    checks: {
      active: true,
      sourceRole: true,
      accessOwners: true,
      retrievalInstructions: false
    }
  }]);
  assert.deepEqual(retrievalPending.items[0].controlMappings, [{
    controlId: "control-access",
    sourceSystemIds: ["system-identity"],
    completeSourceSystemIds: [],
    mapped: true,
    complete: false
  }]);
  assert.deepEqual(retrievalPending.items[0].commands, [
    "npx filegrc get system-identity --mutation > /tmp/system-identity.json",
    "npx filegrc update system system-identity /tmp/system-identity.json --json",
    "npx filegrc program-readiness --json"
  ]);
  const retrievalPendingCli = await execute(process.execPath, [
    cli,
    "evidence-map",
    "--root",
    root,
    "--as-of",
    "2026-07-01"
  ]);
  assert.match(retrievalPendingCli.stdout, /Source role: identity-access/);
  assert.match(retrievalPendingCli.stdout, /system-identity: add retrieval instructions/);
  assert.match(retrievalPendingCli.stdout, /Next: npx filegrc get system-identity --mutation/);
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
    status: "approved",
    approverIds: ["person-approver"],
    approvedOn: "2026-05-25"
  });
  const approvalReady = await assessProgramReadiness(root, { asOf: "2026-07-01" });
  assert.equal(approvalReady.stages.find(({ id }) => id === "policies").counts.action, 0);
  assert.equal(approvalReady.policyActivations[0].state, "approved-implementation-pending");
  assert.deepEqual(approvalReady.policyActivations[0].plannedOrPartialControlIds, ["control-access"]);
  assert.deepEqual(approvalReady.policyActivations[0].missingScheduleControlIds, ["control-access"]);
  assert.equal(approvalReady.evidenceReady, false);
  await createResource(root, {
    id: "obligation-access-request",
    type: "obligation",
    title: "Approve each access request",
    status: "active",
    activityType: "access-provisioning",
    recurrence: { mode: "event", eventType: "person-started" },
    window: { precision: "date", startsAfter: 0, dueAfter: 1 },
    ownerIds: ["person-owner"],
    controlIds: ["control-access"],
    policyIds: ["policy-access"]
  });
  const control = (await loadWorkspace(root)).resources.find(({ id }) => id === "control-access");
  await updateResource(root, "control", control.id, {
    ...control,
    status: "implemented"
  });
  const inactiveReady = await assessProgramReadiness(root, { asOf: "2026-07-01" });
  assert.equal(inactiveReady.stages.find(({ id }) => id === "policies").counts.action, 0);
  assert.equal(inactiveReady.policyActivations[0].state, "ready-to-activate");
  assert.equal(inactiveReady.evidenceReady, false);
  assert.equal(inactiveReady.policyActivations[0].gapCount, 0);
  assert.equal(inactiveReady.stages.find(({ id }) => id === "controls").items.find(({ id }) => id === "control-control-access").status, "complete");
  assert.equal(inactiveReady.progress.total, approvalReady.progress.total);
  assert.equal(inactiveReady.progress.complete, approvalReady.progress.complete + 1);
  assert.ok(inactiveReady.progress.percent > approvalReady.progress.percent);
  assert.equal(inactiveReady.stages.find(({ id }) => id === "controls").items.find(({ id }) => id === "policy-activation-policy-access").status, "blocked");
  assert.equal(inactiveReady.policyActivations[0].label, "Ready to activate");
  assert.equal(inactiveReady.policyActivations[0].canActivateWithDocumentedGaps, true);
  assert.equal((await assessWorkflow(root, { asOf: "2026-07-01" })).assessments.policyActivation.policies[0].state, "ready-to-activate");
  const dormant = (await import("../src/obligations.js")).planObligations((await loadWorkspace(root)).resources, {
    asOf: "2026-07-01",
    through: "2026-07-01"
  });
  assert.equal(dormant.triggers.length, 1);
  assert.equal(dormant.triggers[0].programStatus, "proposed");
  assert.equal(dormant.counts.due, 0);
  const approvedPolicy = (await loadWorkspace(root)).resources.find(({ id }) => id === "policy-access");
  await updateResource(root, "policy", approvedPolicy.id, {
    ...approvedPolicy,
    status: "active",
    effectiveOn: "2026-06-01"
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
  assert.equal(ready.stages.map(({ id }) => id).join(","), "scope,policies,controls,operation");
  assert.equal(ready.stages.find(({ id }) => id === "scope").items.some(({ id }) => id === "risk-assessment"), false);
  assert.equal(ready.stages.find(({ id }) => id === "operation").items.find(({ id }) => id === "risk-assessment").status, "action");
  const readyWorkspace = await loadWorkspace(root);
  assert.equal(readyWorkspace.resources.find(({ id }) => id === "person-approver").status, "active");
  assert.equal(ready.stages.find(({ id }) => id === "policies").counts.action, 0);
  assert.equal(readyWorkspace.resources.some(({ type }) => type === "audit"), false);
  const workflow = await assessWorkflow(root, {
    asOf: "2026-07-01",
    evaluatedAt: "2026-07-01T12:00:00Z",
    programReadiness: ready
  });
  assert.equal(workflow.assessments.evidenceReadiness.status, "complete");
  assert.equal(workflow.assessments.policyActivation.status, "complete");
  assert.equal(workflow.assessments.policyActivation.policies[0].state, "active-and-operating");
  const evidenceMap = await assessEvidenceMap(root, { asOf: "2026-07-01" });
  assert.equal(evidenceMap.status, "complete");
  assert.equal(evidenceMap.items.length, 1);
  assert.equal(evidenceMap.items[0].id, "source-family-identity-access");
  assert.equal(evidenceMap.items[0].progressUnit, false);
  assert.equal(evidenceMap.items[0].evidenceForm, "export");
  assert.match(evidenceMap.items[0].evidencePrompt, /users, roles, privileged access/);
  assert.deepEqual(evidenceMap.items[0].sourceKinds, ["identity-access"]);
  assert.deepEqual(evidenceMap.items[0].sourceSystemIds, ["system-identity"]);
  assert.deepEqual(evidenceMap.items[0].completeSourceSystemIds, ["system-identity"]);
  assert.deepEqual(evidenceMap.items[0].sourceSystemChecks, [{
    sourceSystemId: "system-identity",
    complete: true,
    checks: {
      active: true,
      sourceRole: true,
      accessOwners: true,
      retrievalInstructions: true
    }
  }]);
  assert.deepEqual(evidenceMap.items[0].controlMappings, [{
    controlId: "control-access",
    sourceSystemIds: ["system-identity"],
    completeSourceSystemIds: ["system-identity"],
    mapped: true,
    complete: true
  }]);
  assert.match(evidenceMap.workflow.join(" "), /evidenceSourceIds/);

  const evidenceMapCli = JSON.parse((await execute(process.execPath, [
    cli,
    "evidence-map",
    "--root",
    root,
    "--as-of",
    "2026-07-01",
    "--json"
  ])).stdout);
  assert.equal(evidenceMapCli.status, "complete");
  assert.deepEqual(evidenceMapCli.items[0].controlIds, ["control-access"]);
  assert.deepEqual(evidenceMapCli.items[0].commands, ["npx filegrc program-readiness --json"]);

  const auditReadiness = await assessAuditPreparation(root, { programReadiness: ready });
  assert.equal(auditReadiness.status, "not-started");
  assert.equal(auditReadiness.stages.find(({ id }) => id === "program").status, "complete");
  assert.equal(auditReadiness.stages.find(({ id }) => id === "engagement").status, "action");
  const pathWithoutAudit = JSON.parse((await execute(process.execPath, [
    cli, "program-path", "--root", root, "--as-of", "2026-07-01", "--json"
  ])).stdout);
  assert.equal(pathWithoutAudit.stages.find(({ id }) => id === "audit").nextActions[0].id, "create-audit");

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
  const cliReadiness = JSON.parse(cliResult.stdout);
  assert.equal(cliReadiness.canStartCandidatePeriod, true);
  assert.equal(cliReadiness.policyActivations[0].state, "active-and-operating");

  const running = await serveWorkspace(root, { port: 0 });
  context.after(() => new Promise((resolve) => running.server.close(resolve)));
  const apiState = await fetch(`${running.url}/api/state`).then((response) => response.json());
  assert.deepEqual(apiState.programReadiness.policyActivations, cliReadiness.policyActivations);
  assert.deepEqual(apiState.workflow.assessments.policyActivation.policies, cliReadiness.policyActivations);

  const implementedControl = (await loadWorkspace(root)).resources.find(({ id }) => id === "control-access");
  await updateResource(root, "control", implementedControl.id, {
    ...implementedControl,
    status: "partially-implemented"
  });
  const activeWithGap = await assessProgramReadiness(root, { asOf: "2026-07-01" });
  assert.equal(activeWithGap.policyActivations[0].state, "active-with-implementation-gaps");
  assert.deepEqual(activeWithGap.policyActivations[0].plannedOrPartialControlIds, ["control-access"]);
  assert.match(activeWithGap.policyActivations[0].activationWarning, /Policy is active/);
  assert.doesNotMatch(activeWithGap.policyActivations[0].activationWarning, /You can activate/);
  assert.equal(activeWithGap.evidenceReady, false);
  await updateResource(root, "control", implementedControl.id, implementedControl);

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
  assert.equal(compact.stages.length, 4);
  assert.equal(Object.hasOwn(compact.stages[0], "items"), false);
  assert.ok(compactCliResult.stdout.length < cliResult.stdout.length / 2);

  const current = await loadWorkspace(root);
  await updateResource(root, "workspace", current.workspace.id, {
    ...current.workspace,
    candidateCoverage: { kind: "range", startsOn: "2026-07-01", endsOn: "2026-12-31" },
  });
  const operating = await assessProgramReadiness(root, { asOf: "2026-07-02" });
  assert.equal(operating.status, "evidence-ready");
  assert.equal(operating.operating, false);
  assert.equal(operating.canStartCandidatePeriod, false);
  assert.equal(operating.suggestedCandidatePeriodStart, null);
  assert.deepEqual(operating.target.candidateCoverage, {
    kind: "range",
    startsOn: "2026-07-01",
    endsOn: "2026-12-31"
  });
  assert.equal(operating.progress.mode, "operating-window");
  assert.equal(operating.progress.label, "Operating window");
  assert.equal(operating.progress.status, "Needs attention");
  assert.equal(operating.progress.complete, 2);
  assert.equal(operating.stages.find(({ id }) => id === "operation").items.find(({ id }) => id === "risk-assessment").status, "action");
  const operatingText = await execute(process.execPath, [
    cli,
    "program-readiness",
    "--root",
    root,
    "--as-of",
    "2026-07-02",
    "--summary"
  ]);
  assert.match(operatingText.stdout, /^NEEDS ATTENTION: Operating window 1%\./);
  assert.doesNotMatch(operatingText.stdout, /^EVIDENCE-READY:/);

  await createResource(root, {
    id: "evidence-risk-assessment-2026",
    type: "evidence",
    title: "2026 risk assessment support",
    status: "collected",
    artifactKind: "business-record",
    sourceKind: "authored-record",
    sourceDescription: "Internal risk assessment records",
    collectedOn: "2026-07-02",
    collectorIds: ["person-owner"],
    classificationId: "internal"
  }, {
    content: { content: "# Risk assessment support\n\nThe assessment inputs and review notes are retained here." }
  });
  await createResource(root, {
    id: "risk-assessment-2026",
    type: "risk-assessment",
    title: "2026 service risk assessment",
    status: "complete",
    completedOn: "2026-07-02",
    assessmentKind: "system-risk",
    scope: "Customer service",
    assessorIds: ["person-owner"],
    reviewerIds: ["person-approver"],
    methodology: "Identify threats, rate likelihood and impact, evaluate controls, and assign treatment owners.",
    summary: "The current risks and treatment plans were reviewed and approved.",
    evidenceIds: ["evidence-risk-assessment-2026"],
    approvedOn: "2026-07-02",
    systemIds: ["system-service"]
  });
  const assessed = await assessProgramReadiness(root, { asOf: "2026-07-02" });
  assert.equal(assessed.stages.find(({ id }) => id === "operation").items.find(({ id }) => id === "risk-assessment").status, "complete");
  assert.equal(assessed.status, "operating");
  assert.equal(assessed.operating, true);
  assert.equal(assessed.progress.mode, "operating-window");
  assert.equal(assessed.progress.status, "Operating");
  assert.equal(assessed.progress.percent, operating.progress.percent);

  const currentProgram = assessed.program;
  await createResource(root, {
    id: "audit-older-window",
    type: "audit",
    title: "Older Type 2 engagement",
    status: "planned",
    auditKind: "soc-2-type-2",
    frameworkIds: assessed.scope.frameworkIds,
    scope: "Customer service",
    ownerIds: ["person-owner"],
    controlIds: ["control-access"],
    coverage: { kind: "range", startsOn: "2026-01-01", endsOn: "2026-03-31" }
  });
  const newerCandidate = await assessProgramReadiness(root, { asOf: "2026-07-02" });
  assert.equal(newerCandidate.progress.source, "candidate");
  await updateResource(root, currentProgram.type, currentProgram.id, {
    ...currentProgram,
    candidateCoverage: { kind: "range", startsOn: "2027-01-01", endsOn: "2027-06-30" }
  });
  const formalWindow = await assessProgramReadiness(root, { asOf: "2026-07-02" });
  assert.equal(formalWindow.progress.source, "audit");
  assert.equal(formalWindow.operating, true);
  assert.equal(formalWindow.stages.find(({ id }) => id === "operation").items.find(({ id }) => id === "evidence-running").status, "complete");
});
