import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { runCli } from "../src/cli.js";
import {
  completeObligationOccurrence,
  completeObligationAction,
  assessProgramReadiness,
  createAppState,
  createObligationEvent,
  createResource,
  loadModel,
  loadWorkspace,
  planObligations as planObligationsWithModel,
  scaffoldObligationCompletion,
  updateResource,
  validateWorkspace
} from "../src/index.js";
import { executeCli, initializeGitWorkspace, makeWorkspace } from "./helpers.js";
import { makeComprehensiveWorkspace } from "./fixtures.js";
import { createFilegrc } from "../../create-filegrc/src/index.js";
import { occurrenceMemberIsResolved } from "../src/obligation-members.js";
import { obligationRuleIsEnabled } from "../src/program-lifecycle.js";
import { currentCalendarDate, timestampFromLocalDateTime } from "../src/time.js";

const execute = (executable, args) => executeCli(runCli, executable, args);
const executeProcess = promisify(execFile);
const MODEL_V2 = loadModel("2");
const MODEL_V5 = loadModel("5");
const MODEL_V7 = loadModel("7");
const MODEL_V9 = loadModel("9");
const planObligations = (resources, options = {}) => planObligationsWithModel(resources, {
  model: MODEL_V2,
  ...options
});

test("resolves exception members only with an approved exception covering the occurrence", () => {
  const member = { resourceId: "system-example", disposition: "exception", exceptionId: "exception-access" };
  const occurrence = {
    obligationId: "obligation-access-review",
    coverage: { kind: "range", startsOn: "2026-01-01", endsOn: "2026-03-31" }
  };
  const exception = {
    id: "exception-access",
    type: "exception",
    status: "approved",
    scopeResourceIds: ["system-example"],
    approval: { approvedOn: "2025-12-15", expiresOn: "2026-04-01" }
  };
  assert.equal(occurrenceMemberIsResolved(member, occurrence, new Map([[exception.id, exception]])), true);
  assert.equal(occurrenceMemberIsResolved(member, occurrence, new Map()), false);
  assert.equal(occurrenceMemberIsResolved(member, occurrence, new Map([[exception.id, {
    ...exception,
    status: "draft"
  }]])), false);
  assert.equal(occurrenceMemberIsResolved(member, occurrence, new Map([[exception.id, {
    ...exception,
    approval: { ...exception.approval, expiresOn: "2026-02-28" }
  }]])), false);
  assert.equal(occurrenceMemberIsResolved(member, occurrence, new Map([[exception.id, {
    ...exception,
    status: "closed",
    resolution: { resolvedOn: "2026-04-15" }
  }]])), true);
  assert.equal(occurrenceMemberIsResolved(member, occurrence, new Map([[exception.id, {
    ...exception,
    status: "revoked",
    resolution: { resolvedOn: "2026-02-15" }
  }]])), false);

  const expected = {
    resourceId: "system-example",
    disposition: "expected",
    result: "passed",
    completionResourceIds: ["access-review-example"]
  };
  assert.equal(occurrenceMemberIsResolved(expected, occurrence, new Map(), () => true), true);
  assert.equal(occurrenceMemberIsResolved(expected, occurrence, new Map(), () => false), false);
});

const ACTIVE_OWNER = {
  id: "person-owner",
  type: "person",
  title: "Program Owner",
  status: "active"
};

test("scopes calendar work and event triggers to the selected Program", () => {
  const resources = [
    { id: "workspace", type: "workspace", title: "Workspace", timezone: "UTC", dataModelVersion: "9" },
    { id: "program-a", type: "program", title: "Program A", status: "active", controlIds: ["control-a"], policyIds: [], systemIds: [] },
    { id: "program-b", type: "program", title: "Program B", status: "active", controlIds: ["control-b"], policyIds: [], systemIds: [] },
    ACTIVE_OWNER,
    { id: "control-a", type: "control", title: "Control A", status: "implemented" },
    { id: "control-b", type: "control", title: "Control B", status: "implemented" },
    ...["a", "b"].flatMap((suffix) => [
      {
        id: `obligation-calendar-${suffix}`,
        type: "obligation",
        title: `Calendar ${suffix}`,
        status: "active",
        activityType: "meeting",
        recurrence: { mode: "calendar", unit: "year", interval: 1, anchorDate: "2026-01-01" },
        window: { precision: "date", startsAfter: 0, dueAfter: 30 },
        ownerIds: ["person-owner"],
        controlIds: [`control-${suffix}`]
      },
      {
        id: `obligation-event-${suffix}`,
        type: "obligation",
        title: `Event ${suffix}`,
        status: "active",
        activityType: "access-change",
        recurrence: { mode: "event", eventType: "person-role-changed" },
        window: { precision: "date", startsAfter: 0, dueAfter: 3 },
        ownerIds: ["person-owner"],
        controlIds: [`control-${suffix}`]
      }
    ])
  ];
  const plan = planObligationsWithModel(resources, {
    model: MODEL_V9,
    programId: "program-a",
    asOf: "2026-01-01",
    through: "2026-01-31"
  });
  assert.deepEqual(plan.calendarItems.map(({ obligationId }) => obligationId), ["obligation-calendar-a"]);
  assert.deepEqual(plan.triggers.flatMap(({ obligationIds }) => obligationIds), ["obligation-event-a"]);
});

test("rejects an open occurrence after a supersede-open-window rule cutover", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-rule-cutover-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "9");
  const loaded = await loadWorkspace(root);
  const ruleEntry = loaded.entries.find(({ record }) => record.type === "obligation-rule");
  const occurrenceEntry = loaded.entries.find(({ record }) => record.type === "obligation-occurrence");
  const obligationEntry = loaded.entries.find(({ record }) => record.type === "obligation");
  await writeFile(ruleEntry.path, `${JSON.stringify({ ...ruleEntry.record, status: "retired", retiredOn: "2026-07-01" }, null, 2)}\n`);
  const successor = {
    ...ruleEntry.record,
    id: "obligation-rule-successor",
    title: "Successor obligation rule",
    supersedesId: ruleEntry.record.id,
    cutoverDecision: "supersede-open-window"
  };
  await writeFile(join(root, "data", "obligation-rules", `${successor.id}.json`), `${JSON.stringify(successor, null, 2)}\n`);
  await writeFile(occurrenceEntry.path, `${JSON.stringify({
    ...occurrenceEntry.record,
    status: "open",
    conclusion: undefined,
    reviewedByIds: undefined,
    reconciledAt: undefined
  }, null, 2)}\n`);
  await writeFile(obligationEntry.path, `${JSON.stringify({
    ...obligationEntry.record,
    activeRuleId: successor.id,
    ruleIds: [...obligationEntry.record.ruleIds, successor.id]
  }, null, 2)}\n`);

  const validation = await validateWorkspace(root);
  assert.equal(validation.diagnostics.some(({ code }) => code === "open-occurrence-after-rule-cutover"), true);
});

test("does not finalize as-of membership until the cutoff day has ended", () => {
  const resources = [
    { id: "workspace", type: "workspace", title: "Workspace", timezone: "UTC", dataModelVersion: "9" },
    { id: "program-a", type: "program", title: "Program A", status: "active", controlIds: ["control-a"], policyIds: [], systemIds: ["system-a"] },
    ACTIVE_OWNER,
    { id: "control-a", type: "control", title: "Control A", status: "implemented" },
    { id: "system-a", type: "system", title: "System A", status: "active" },
    { id: "vendor-a", type: "vendor", title: "Vendor A", status: "active", criticality: "critical" },
    { id: "component-a", type: "component", title: "Component A", status: "active", vendorId: "vendor-a", systemUses: [{ systemId: "system-a" }] },
    {
      id: "obligation-vendor-review",
      type: "obligation",
      title: "Review critical vendors",
      status: "active",
      activityType: "vendor-review",
      scheduleMode: "rule",
      ruleIds: ["rule-vendor-review"],
      activeRuleId: "rule-vendor-review",
      ownerIds: ["person-owner"],
      controlIds: ["control-a"]
    },
    {
      id: "rule-vendor-review",
      type: "obligation-rule",
      title: "Vendor review rule",
      status: "active",
      obligationId: "obligation-vendor-review",
      activityDefinitionVersion: "1",
      recurrence: { mode: "calendar", unit: "year", interval: 1, anchorDate: "2026-01-01" },
      window: { precision: "date", startsAfter: 0, dueAfter: 10 },
      selector: { resourceType: "vendor", membershipMode: "as-of", cutoff: "window-start", statuses: ["active"], criticalities: ["critical"] },
      effectiveAt: "2026-01-01T00:00:00Z",
      timezone: "UTC"
    }
  ];
  const plan = (asOf) => planObligationsWithModel(resources, {
    model: MODEL_V9,
    programId: "program-a",
    asOf,
    through: "2026-01-11"
  }).calendarItems[0];
  assert.equal(plan("2026-01-01").membershipFinal, false);
  assert.equal(plan("2026-01-02").membershipFinal, true);
});

test("direct-file validation rejects reconciliation on the population cutoff day", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-cutoff-reconciliation-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "9");
  const loaded = await loadWorkspace(root);
  const occurrenceEntry = loaded.entries.find(({ record }) => record.type === "obligation-occurrence");
  await writeFile(occurrenceEntry.path, `${JSON.stringify({
    ...occurrenceEntry.record,
    reconciledAt: "2026-06-15T23:59:59Z"
  }, null, 2)}\n`);

  const validation = await validateWorkspace(root);
  assert.equal(validation.diagnostics.some(({ code }) => code === "obligation-population-still-open"), true);
});

test("a planned completion cannot pass a different rolled-up member", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-member-completion-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "9");
  const loaded = await loadWorkspace(root);
  const obligationEntry = loaded.entries.find(({ record }) => record.type === "obligation");
  const occurrenceEntry = loaded.entries.find(({ record }) => record.type === "obligation-occurrence");
  const accessReviewEntry = loaded.entries.find(({ record }) => record.type === "access-review");
  await writeFile(obligationEntry.path, `${JSON.stringify({ ...obligationEntry.record, activityType: "access-review" }, null, 2)}\n`);
  await writeFile(accessReviewEntry.path, `${JSON.stringify({ ...accessReviewEntry.record, status: "planned" }, null, 2)}\n`);
  await writeFile(occurrenceEntry.path, `${JSON.stringify({
    ...occurrenceEntry.record,
    members: [{
      resourceId: "system-example",
      disposition: "expected",
      result: "passed",
      completionResourceIds: [accessReviewEntry.record.id]
    }]
  }, null, 2)}\n`);

  const validation = await validateWorkspace(root);
  assert.equal(validation.diagnostics.some(({ code }) => code === "wrong-member-completion"), true);
  assert.equal(validation.diagnostics.some(({ code }) => code === "missing-passing-member-completion"), true);
});

test("freezes proof transitively after an occurrence is reconciled", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-finalized-proof-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "9");
  const loaded = await loadWorkspace(root);
  const occurrence = loaded.resources.find((record) => record.type === "obligation-occurrence");
  const completion = loaded.resources.find((record) => record.id === occurrence.members[0].completionResourceIds[0]);
  const evidence = loaded.resources.find((record) => record.id === completion.evidenceIds[0]);

  await assert.rejects(
    updateResource(root, "evidence", evidence.id, { ...evidence, title: `${evidence.title} changed` }),
    /immutable because finalized occurrence/i
  );

  await executeProcess("git", ["init", "--initial-branch=main"], { cwd: root });
  await executeProcess("git", ["config", "user.name", "FileGRC Test"], { cwd: root });
  await executeProcess("git", ["config", "user.email", "filegrc@example.test"], { cwd: root });
  await executeProcess("git", ["add", "data"], { cwd: root });
  await executeProcess("git", ["commit", "-m", "Record finalized occurrence"], { cwd: root });
  const evidencePath = loaded.entries.find(({ record }) => record.id === evidence.id).path;
  const rewritten = JSON.parse(await readFile(evidencePath, "utf8"));
  rewritten.title = `${rewritten.title} rewritten directly`;
  await writeFile(evidencePath, `${JSON.stringify(rewritten, null, 2)}\n`);
  const validation = await validateWorkspace(root);
  assert.ok(validation.diagnostics.some(({ code, message }) => (
    code === "rewritten-finalized-record" && message.includes(evidence.id)
  )));
});

test("plans flexible calendar windows with explicit due and overdue timing", () => {
  const obligation = {
    id: "obligation-quarterly-risk-meeting",
    type: "obligation",
    title: "Quarterly risk meeting",
    status: "active",
    activityType: "meeting",
    recurrence: {
      mode: "calendar",
      unit: "month",
      interval: 3,
      anchorDate: "2026-01-01"
    },
    ownerIds: ["person-owner"],
    completionResourceIds: []
  };
  const due = planObligations([ACTIVE_OWNER, obligation], {
    asOf: "2026-03-15",
    through: "2026-04-01"
  });
  assert.deepEqual(due.counts, {
    overdue: 0,
    blocked: 0,
    due: 1,
    upcoming: 1,
    proposed: 0,
    complete: 0
  });
  assert.equal(due.items[0].status, "due");
  assert.equal(due.items[0].dueWindowStart, "2026-01-01");
  assert.equal(due.items[0].dueWindowEnd, "2026-03-31");
  assert.equal(due.items[0].overdueOn, "2026-04-01");
  assert.equal(due.items[0].daysUntilOverdue, 17);

  const overdue = planObligations([ACTIVE_OWNER, obligation], {
    asOf: "2026-04-02",
    through: "2026-04-02"
  });
  assert.equal(overdue.items[0].status, "overdue");
  assert.equal(overdue.items[0].daysOverdue, 1);
});

test("puts standalone Action Items in Work Queue without a reverse source link", () => {
  const source = {
    id: "finding-access-delay",
    type: "finding",
    title: "Access removal delay",
    status: "open"
  };
  const action = {
    id: "action-item-remove-access",
    type: "action-item",
    title: "Remove remaining access",
    status: "in-progress",
    assigneeIds: ["person-owner"],
    sourceResourceId: source.id,
    completionWindow: {
      precision: "date",
      startsOn: "2026-03-20",
      dueOn: "2026-03-20",
      overdueOn: "2026-03-21"
    }
  };
  const plan = planObligations([source, action], {
    asOf: "2026-03-15",
    through: "2026-03-31"
  });
  assert.equal(plan.standaloneItems.length, 1);
  assert.equal(plan.items[0].kind, "action");
  assert.equal(plan.items[0].actionItemId, action.id);
  assert.equal(plan.items[0].status, "upcoming");
  assert.equal(plan.items[0].dueWindowStart, action.completionWindow.dueOn);
  assert.equal(plan.items[0].overdueOn, "2026-03-21");
  assert.deepEqual(plan.counts, {
    overdue: 0,
    blocked: 0,
    due: 0,
    upcoming: 1,
    proposed: 0,
    complete: 0
  });
});

test("requires an explicit model unless Workspace declares one", () => {
  assert.throws(
    () => planObligationsWithModel([ACTIVE_OWNER], { asOf: "2026-03-15" }),
    /requires options\.model or a Workspace record/
  );
  const inferred = planObligationsWithModel([
    {
      id: "workspace",
      type: "workspace",
      title: "Workspace",
      dataModelVersion: "3"
    },
    ACTIVE_OWNER
  ], { asOf: "2026-03-15" });
  assert.equal(inferred.dataModelVersion, "3");
});

test("keeps blocked Action Items blocked until their named blockers are resolved", () => {
  const source = {
    id: "finding-access-delay",
    type: "finding",
    title: "Access removal delay",
    status: "open"
  };
  const blocker = {
    id: "exception-access-delay",
    type: "exception",
    title: "Temporary access exception",
    status: "approved"
  };
  const action = {
    id: "action-item-remove-access",
    type: "action-item",
    title: "Remove remaining access",
    status: "blocked",
    assigneeIds: ["person-owner"],
    sourceResourceId: source.id,
    blockingResourceIds: [blocker.id],
    completionWindow: {
      precision: "date",
      startsOn: "2026-03-20",
      dueOn: "2026-03-20",
      overdueOn: "2026-03-21"
    }
  };
  const plan = planObligations([source, blocker, action], {
    asOf: "2026-03-22",
    through: "2026-03-31"
  });
  assert.equal(plan.counts.blocked, 1);
  assert.equal(plan.counts.overdue, 0);
  assert.equal(plan.items[0].status, "blocked");
  assert.equal(plan.items[0].timingStatus, "overdue");
  assert.deepEqual(plan.items[0].blockingResourceIds, [blocker.id]);
  assert.equal(plan.items[0].blockingReason, "Blocked by Temporary access exception.");
});

test("keeps work linked only to draft policies as starter proposals", () => {
  const policy = {
    id: "policy-security",
    type: "policy",
    title: "Security policy",
    status: "draft"
  };
  const obligation = {
    id: "obligation-quarterly-review",
    type: "obligation",
    title: "Quarterly review",
    status: "active",
    activityType: "inventory-review",
    recurrence: {
      mode: "calendar",
      unit: "month",
      interval: 3,
      anchorDate: "2026-01-01"
    },
    ownerIds: ["person-owner"],
    policyIds: [policy.id]
  };
  const proposed = planObligations([ACTIVE_OWNER, policy, obligation], {
    asOf: "2026-03-15",
    through: "2026-03-31"
  });
  assert.equal(proposed.counts.due, 0);
  assert.equal(proposed.counts.proposed, 1);
  assert.equal(proposed.items[0].status, "proposed");
  assert.equal(proposed.items[0].timingStatus, "due");

  const approved = planObligations([ACTIVE_OWNER, { ...policy, status: "approved", approvedOn: "2026-01-01", effectiveOn: "2026-01-01" }, obligation], {
    asOf: "2026-03-15",
    through: "2026-03-31"
  });
  assert.equal(approved.counts.proposed, 1);

  const accepted = planObligations([ACTIVE_OWNER, { ...policy, status: "active", approvedOn: "2026-01-01", effectiveOn: "2026-02-01" }, obligation], {
    asOf: "2026-03-15",
    through: "2026-03-31"
  });
  assert.equal(accepted.counts.proposed, 0);
  assert.equal(accepted.counts.due, 1);
  assert.equal(accepted.items[0].status, "due");
  assert.equal(accepted.items[0].dueWindowStart, "2026-02-01");
});

test("starts governed work only after program Documents are active and anchors it to the later effective date", () => {
  const policy = {
    id: "policy-security",
    type: "policy",
    title: "Security policy",
    status: "active",
    effectiveOn: "2026-02-01",
    relatedDocumentIds: ["document-recovery-plan"]
  };
  const control = {
    id: "control-recovery",
    type: "control",
    title: "Recovery testing",
    status: "implemented"
  };
  const approvedDocument = {
    id: "document-recovery-plan",
    type: "document",
    title: "Recovery plan",
    documentKind: "plan",
    workflowScope: "program",
    programRole: "required",
    status: "approved",
    controlIds: [control.id],
    approvedOn: "2026-01-20",
    approvedContentRevisions: { content: "approved-revision" }
  };
  const obligation = {
    id: "obligation-quarterly-recovery-test",
    type: "obligation",
    title: "Quarterly recovery test",
    status: "active",
    activityType: "inventory-review",
    recurrence: {
      mode: "calendar",
      unit: "month",
      interval: 3,
      anchorDate: "2026-01-01"
    },
    ownerIds: [ACTIVE_OWNER.id],
    policyIds: [policy.id],
    controlIds: [control.id]
  };
  const resources = [ACTIVE_OWNER, policy, control, approvedDocument, obligation];
  const dormant = planObligations(resources, {
    model: MODEL_V5,
    asOf: "2026-04-15",
    through: "2026-06-30"
  });
  assert.ok(dormant.counts.proposed > 0);
  assert.ok(dormant.items.every(({ programStatus }) => programStatus === "proposed"));

  const activeDocument = {
    ...approvedDocument,
    status: "active",
    activationBasis: "recorded",
    activatedByIds: [ACTIVE_OWNER.id],
    activatedOn: "2026-04-10",
    effectiveOn: "2026-04-10",
    activatedContentRevisions: { content: "approved-revision" }
  };
  const operating = planObligations(
    resources.map((record) => record.id === activeDocument.id ? activeDocument : record),
    { model: MODEL_V5, asOf: "2026-04-15", through: "2026-06-30" }
  );
  assert.equal(operating.counts.proposed, 0);
  assert.equal(operating.counts.due, 1);
  assert.equal(operating.items[0].programStatus, "accepted");
  assert.equal(operating.items[0].dueWindowStart, "2026-04-10");

  const auditDocument = {
    ...approvedDocument,
    documentKind: "soc2-management-assertion",
    workflowScope: "engagement"
  };
  const auditWorkStaysInStepFive = planObligations(
    resources.map((record) => record.id === auditDocument.id ? auditDocument : record),
    { model: MODEL_V5, asOf: "2026-04-15", through: "2026-06-30" }
  );
  assert.equal(auditWorkStaysInStepFive.counts.proposed, 0);
  assert.equal(auditWorkStaysInStepFive.counts.due, 1);
  assert.equal(auditWorkStaysInStepFive.items[0].dueWindowStart, "2026-02-01");
});

test("includes proposed obligation records as visible but unavailable starter work", () => {
  const calendarObligation = {
    id: "obligation-proposed-calendar",
    type: "obligation",
    title: "Review the starter schedule",
    status: "proposed",
    activityType: "inventory-review",
    recurrence: {
      mode: "calendar",
      unit: "month",
      interval: 1,
      anchorDate: "2026-01-01"
    },
    ownerIds: ["person-owner"]
  };
  const eventObligation = {
    id: "obligation-proposed-event",
    type: "obligation",
    title: "Review starter access",
    status: "proposed",
    activityType: "access-provisioning",
    recurrence: {
      mode: "event",
      eventType: "person-started"
    },
    ownerIds: ["person-owner"]
  };
  const plan = planObligations([ACTIVE_OWNER, calendarObligation, eventObligation], {
    asOf: "2026-01-15",
    through: "2026-01-31"
  });
  assert.equal(plan.counts.proposed, 1);
  assert.equal(plan.items[0].obligationId, calendarObligation.id);
  assert.equal(plan.items[0].status, "proposed");
  assert.equal(plan.triggers.length, 1);
  assert.equal(plan.triggers[0].eventType, "person-started");
  assert.equal(plan.triggers[0].programStatus, "proposed");
});

test("names the governed Document that keeps an event dormant before cutover", () => {
  const policy = { id: "policy-security", type: "policy", status: "active", effectiveOn: "2026-04-01" };
  const document = {
    id: "document-incident-plan", type: "document", status: "approved",
    programRole: "required", workflowScope: "program", controlIds: ["control-incident"]
  };
  const control = { id: "control-incident", type: "control", status: "implemented" };
  const obligation = {
    id: "obligation-incident", type: "obligation", title: "Respond to incident",
    status: "active", activityType: "access-provisioning",
    recurrence: { mode: "event", eventType: "person-started" },
    ownerIds: ["person-owner"], policyIds: [policy.id], controlIds: [control.id]
  };
  const plan = planObligations([ACTIVE_OWNER, policy, document, control, obligation], {
    model: MODEL_V5, asOf: "2026-04-02", through: "2026-04-03"
  });
  assert.deepEqual(plan.triggers[0].steps[0].programBlocker, {
    type: "document", id: document.id, label: "Activate document"
  });
});

test("explains how a new workspace enables its first event workflow", async (context) => {
  const root = await mkdtemp(`${tmpdir()}/filegrc-first-event-proposal-`);
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  const filegrcVersion = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version;
  await createFilegrc({
    target: root, yes: true, install: false,
    filegrcVersion,
    policyOwnerEmail: "security@example.com", timezone: "UTC"
  });
  const lockPath = join(root, "package-lock.json");
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  lock.packages["node_modules/filegrc"] = { version: filegrcVersion };
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  await assert.rejects(createObligationEvent(root, {
    eventType: "person-started", occurredOn: "2026-10-02"
  }), /still a proposed workflow.*enable its rule in Step 3.*real event after cutover/);
});

test("refuses a partial event checklist when a matching task remains proposed", async (context) => {
  const root = await mkdtemp(`${tmpdir()}/filegrc-partial-event-`);
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const active = loaded.resources.find(({ id }) => id === "obligation-example");
  const activeRule = loaded.resources.find(({ id }) => id === active.activeRuleId);
  const proposed = {
    ...active,
    id: "obligation-pending-event-step",
    title: "Pending event step",
    status: "proposed",
    ruleIds: ["obligation-rule-pending-event-step"],
    activeRuleId: "obligation-rule-pending-event-step"
  };
  const proposedRule = {
    ...activeRule,
    id: "obligation-rule-pending-event-step",
    title: "Pending event rule",
    status: "proposed",
    obligationId: proposed.id
  };
  await writeFile(join(root, "data/obligations/obligation-pending-event-step.json"), `${JSON.stringify(proposed, null, 2)}\n`);
  await writeFile(join(root, "data/obligation-rules/obligation-rule-pending-event-step.json"), `${JSON.stringify(proposedRule, null, 2)}\n`);
  await initializeGitWorkspace(root);
  const validation = await validateWorkspace(root);
  assert.equal(validation.ok, true, JSON.stringify(validation.diagnostics));
  const plan = planObligationsWithModel((await loadWorkspace(root)).resources, {
    model: loaded.model, asOf: "2026-10-02", through: "2026-10-02"
  });
  const trigger = plan.triggers.find(({ eventType }) => eventType === activeRule.recurrence.eventType);
  assert.equal(trigger.programStatus, "proposed");
  assert.equal(trigger.steps.length, 2);
  await assert.rejects(createObligationEvent(root, {
    eventType: activeRule.recurrence.eventType, occurredOn: "2026-10-02"
  }), /still a proposed workflow \(obligation-pending-event-step\)/);
  assert.equal(
    (await loadWorkspace(root)).resources.filter(({ type }) => type === "obligation-event").length,
    loaded.resources.filter(({ type }) => type === "obligation-event").length
  );
});

test("keeps a proposed selected rule out of Control launch and event triggering", async (context) => {
  const root = await mkdtemp(`${tmpdir()}/filegrc-proposed-selected-rule-`);
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const obligation = loaded.resources.find(({ id }) => id === "obligation-example");
  const ruleEntry = loaded.entries.find(({ record }) => record.id === obligation.activeRuleId);
  await writeFile(ruleEntry.path, `${JSON.stringify({ ...ruleEntry.record, status: "proposed" }, null, 2)}\n`);
  const controlEntry = loaded.entries.find(({ record }) => record.id === "control-example");
  await writeFile(controlEntry.path, `${JSON.stringify({ ...controlEntry.record, operationPattern: "event-driven" }, null, 2)}\n`);
  await initializeGitWorkspace(root);

  const plan = planObligationsWithModel((await loadWorkspace(root)).resources, {
    model: loaded.model, asOf: "2026-10-02", through: "2026-10-02"
  });
  const trigger = plan.triggers.find(({ eventType }) => eventType === ruleEntry.record.recurrence.eventType);
  assert.equal(trigger.programStatus, "proposed");
  assert.deepEqual(trigger.steps[0].programBlocker, {
    type: "obligation-rule", id: ruleEntry.record.id, label: "Activate rule"
  });
  const readiness = await assessProgramReadiness(root, { asOf: "2026-10-02" });
  const control = readiness.stages.find(({ id }) => id === "controls").items.find(({ id }) => id === "control-control-example");
  assert.equal(control.checks.workQueue, false);
  assert.equal(control.implementationState, "implemented-with-gaps");
  assert.deepEqual(readiness.policyActivations[0].missingScheduleControlIds, ["control-example"]);
  await assert.rejects(createObligationEvent(root, {
    eventType: trigger.eventType, occurredOn: "2026-10-02"
  }), /still a proposed workflow.*enable its rule in Step 3/);
  const validation = await validateWorkspace(root);
  assert.ok(validation.diagnostics.some(({ code }) => code === "control-work-queue-not-running"));
});

test("keeps a future effective rule dormant until its cutover time", async (context) => {
  const root = await mkdtemp(`${tmpdir()}/filegrc-future-event-rule-`);
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const obligation = loaded.resources.find(({ id }) => id === "obligation-example");
  const ruleEntry = loaded.entries.find(({ record }) => record.id === obligation.activeRuleId);
  const effectiveAt = "2026-10-03T12:00:00Z";
  await writeFile(ruleEntry.path, `${JSON.stringify({ ...ruleEntry.record, effectiveAt }, null, 2)}\n`);
  const controlEntry = loaded.entries.find(({ record }) => record.id === "control-example");
  await writeFile(controlEntry.path, `${JSON.stringify({ ...controlEntry.record, operationPattern: "event-driven" }, null, 2)}\n`);
  await initializeGitWorkspace(root);

  const plan = planObligationsWithModel((await loadWorkspace(root)).resources, {
    model: loaded.model, asOf: "2026-10-02", now: "2026-10-02T18:00:00Z", through: "2026-10-02"
  });
  const trigger = plan.triggers.find(({ eventType }) => eventType === ruleEntry.record.recurrence.eventType);
  assert.equal(trigger.programStatus, "proposed");
  assert.match(trigger.steps[0].programBlocker.label, /Wait for rule effective time/);
  const readiness = await assessProgramReadiness(root, { asOf: "2026-10-02" });
  const control = readiness.stages.find(({ id }) => id === "controls").items.find(({ id }) => id === "control-control-example");
  assert.equal(control.checks.workQueue, false);
  assert.deepEqual(readiness.policyActivations[0].missingScheduleControlIds, ["control-example"]);
  await assert.rejects(createObligationEvent(root, {
    eventType: trigger.eventType, occurredAt: "2026-10-02T18:00:00Z"
  }), /dormant until rule .* takes effect at 2026-10-03T12:00:00Z/);
  await assert.rejects(createObligationEvent(root, {
    eventType: trigger.eventType, occurredOn: "2026-10-03"
  }), /requires occurredAt on 2026-10-03/);
  await assert.rejects(createObligationEvent(root, {
    eventType: trigger.eventType, occurredAt: "2026-10-03T11:00:00Z"
  }), /dormant until rule .* takes effect at 2026-10-03T12:00:00Z/);

  const prior = { ...ruleEntry.record, id: "obligation-rule-prior", status: "retired" };
  const future = { ...ruleEntry.record, effectiveAt, supersedesId: prior.id };
  assert.equal(obligationRuleIsEnabled(obligation, new Map([
    [prior.id, prior], [future.id, future]
  ]), "2026-10-02T18:00:00Z"), true);
});

test("uses the current time for today's Control launch assessment", async (context) => {
  const root = await mkdtemp(`${tmpdir()}/filegrc-same-day-rule-readiness-`);
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const today = currentCalendarDate(loaded.workspace.timezone);
  const morning = timestampFromLocalDateTime(`${today}T09:00:00`, loaded.workspace.timezone);
  const evening = timestampFromLocalDateTime(`${today}T18:00:00`, loaded.workspace.timezone);
  const obligation = loaded.resources.find(({ id }) => id === "obligation-example");
  const rule = loaded.resources.find(({ id }) => id === obligation.activeRuleId);
  const training = loaded.resources.find(({ id }) => id === "training-example");
  const assignmentRule = {
    ...rule, id: "obligation-rule-training-same-day", obligationId: "obligation-training-same-day", effectiveAt: evening
  };
  const assignment = {
    ...obligation, id: assignmentRule.obligationId, activityType: "training",
    scopeResourceIds: [training.id], ruleIds: [assignmentRule.id], activeRuleId: assignmentRule.id
  };
  const input = {
    ...loaded,
    resources: [...loaded.resources.map((record) => record.id === obligation.activeRuleId
      ? { ...record, effectiveAt: evening }
      : record.id === "control-example"
        ? { ...record, operationPattern: "event-driven" }
        : record), assignmentRule, assignment]
  };
  const before = await assessProgramReadiness(input, { asOf: today, generatedAt: morning });
  const after = await assessProgramReadiness(input, { asOf: today, generatedAt: evening });
  const control = (result) => result.stages.find(({ id }) => id === "controls")
    .items.find(({ id }) => id === "control-control-example");
  assert.equal(control(before).checks.workQueue, false);
  assert.deepEqual(control(before).workQueue, { enabled: 0, running: 0, total: 2 });
  assert.equal(control(after).checks.workQueue, true);
  assert.equal(before.trainingActivations.find(({ trainingId }) => trainingId === training.id).assignmentScheduled, false);
  assert.equal(after.trainingActivations.find(({ trainingId }) => trainingId === training.id).assignmentScheduled, true);
});

test("starts an enabled schedule when a linked control becomes implemented", () => {
  const policy = {
    id: "policy-security",
    type: "policy",
    title: "Security policy",
    status: "active",
    approvedOn: "2026-01-01",
    effectiveOn: "2026-01-01"
  };
  const control = {
    id: "control-quarterly-review",
    type: "control",
    title: "Quarterly review",
    status: "planned"
  };
  const obligation = {
    id: "obligation-quarterly-review",
    type: "obligation",
    title: "Quarterly review",
    status: "active",
    activityType: "inventory-review",
    recurrence: {
      mode: "calendar",
      unit: "month",
      interval: 3,
      anchorDate: "2026-01-01"
    },
    ownerIds: ["person-owner"],
    policyIds: [policy.id],
    controlIds: [control.id]
  };
  const ready = planObligations([ACTIVE_OWNER, policy, control, obligation], {
    asOf: "2026-03-15",
    through: "2026-03-31"
  });
  assert.equal(ready.counts.proposed, 1);
  assert.equal(ready.counts.due, 0);
  assert.equal(ready.programStatuses[obligation.id], "proposed");

  const running = planObligations([ACTIVE_OWNER, policy, { ...control, status: "implemented" }, obligation], {
    asOf: "2026-03-15",
    through: "2026-03-31"
  });
  assert.equal(running.counts.proposed, 0);
  assert.equal(running.counts.due, 1);
  assert.equal(running.programStatuses[obligation.id], "accepted");
});

test("keeps team-owned work proposed until the team resolves to a current person", () => {
  const team = {
    id: "team-operations",
    type: "team",
    title: "Operations",
    status: "inactive",
    memberIds: ["person-owner"],
    chairIds: ["person-owner"]
  };
  const obligation = {
    id: "obligation-monthly-review",
    type: "obligation",
    title: "Monthly review",
    status: "active",
    activityType: "inventory-review",
    recurrence: {
      mode: "calendar",
      unit: "month",
      interval: 1,
      anchorDate: "2026-01-01"
    },
    ownerIds: [team.id]
  };
  const proposed = planObligations([ACTIVE_OWNER, team, obligation], {
    asOf: "2026-01-15",
    through: "2026-01-31"
  });
  assert.equal(proposed.items[0].status, "proposed");

  const running = planObligations([ACTIVE_OWNER, { ...team, status: "active" }, obligation], {
    asOf: "2026-01-15",
    through: "2026-01-31"
  });
  assert.equal(running.items[0].status, "due");
});

test("does not start a partial event workflow while any step is still proposed", async (context) => {
  const root = await mkdtemp(`${tmpdir()}/filegrc-proposed-event-`);
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await createResource(root, {
    id: "policy-worker-security",
    type: "policy",
    title: "Worker security policy",
    status: "draft",
    version: "1.0",
    ownerIds: ["person-owner"],
    approverIds: ["person-approver"]
  }, {
    content: {
      content: "# Worker security policy\n\nAssign security training during worker onboarding."
    }
  });
  for (const obligation of [
    {
      id: "obligation-worker-account",
      title: "Create worker account"
    },
    {
      id: "obligation-worker-training",
      title: "Assign worker training",
      policyIds: ["policy-worker-security"]
    }
  ]) {
    await createResource(root, {
      type: "obligation",
      status: "active",
      activityType: "access-provisioning",
      recurrence: { mode: "event", eventType: "person-started" },
      window: { precision: "date", startsAfter: 0, dueAfter: 30 },
      ownerIds: ["person-owner"],
      ...obligation
    });
  }

  const loaded = await loadWorkspace(root);
  const plan = planObligations(loaded.resources, {
    asOf: "2026-07-01",
    through: "2026-07-31"
  });
  assert.equal(plan.triggers[0].programStatus, "proposed");
  assert.equal(plan.triggers[0].steps.length, 2);
  await assert.rejects(
    createObligationEvent(root, {
      eventType: "person-started",
      occurredOn: "2026-07-01"
    }),
    /is dormant until .*\(.+\).*Complete the cutover/
  );
  assert.equal(
    (await loadWorkspace(root)).resources.some(({ type }) => type === "obligation-event"),
    false
  );
});

test("matches linked completion records to the calendar period they satisfy", () => {
  const obligation = {
    id: "obligation-quarterly-risk-meeting",
    type: "obligation",
    title: "Quarterly risk meeting",
    status: "active",
    activityType: "meeting",
    recurrence: {
      mode: "calendar",
      unit: "month",
      interval: 3,
      anchorDate: "2026-01-01"
    },
    ownerIds: ["person-owner"],
    completionResourceIds: ["meeting-q1"]
  };
  const meeting = {
    id: "meeting-q1",
    type: "meeting",
    title: "Q1 risk meeting",
    status: "complete",
    scheduledFor: "2026-03-20",
    startedAt: "2026-03-20T15:00:00Z",
    endedAt: "2026-03-20T16:00:00Z"
  };
  const plan = planObligations([ACTIVE_OWNER, obligation, meeting], {
    asOf: "2026-04-02",
    from: "2026-01-01",
    through: "2026-04-02",
    includeComplete: true
  });
  assert.equal(plan.calendarItems[0].status, "complete");
  assert.deepEqual(plan.calendarItems[0].completionResourceIds, ["meeting-q1"]);
  assert.equal(plan.calendarItems[1].status, "due");

  const scheduledOnly = planObligations([
    ACTIVE_OWNER,
    { ...obligation, completionResourceIds: ["meeting-planned"] },
    {
      id: "meeting-planned",
      type: "meeting",
      title: "Planned meeting",
      status: "planned",
      scheduledFor: "2026-03-20"
    }
  ], {
    asOf: "2026-04-02",
    from: "2026-01-01",
    through: "2026-04-02",
    includeComplete: true
  });
  assert.equal(scheduledOnly.calendarItems[0].status, "overdue");
});

test("creates an event run and its policy checklist as one valid batch", async (context) => {
  const root = await mkdtemp(`${tmpdir()}/filegrc-obligation-event-`);
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await createResource(root, {
    id: "person-new-worker",
    type: "person",
    title: "New Worker",
    status: "active",
    affiliation: "internal",
    jobTitle: "Engineer"
  });
  await createResource(root, {
    id: "training-worker-security",
    type: "training",
    title: "Worker Security Training",
    status: "draft",
    ownerIds: ["person-owner"]
  }, { content: { content: "# Worker Security Training\n\nFollow the approved security practices." } });
  await createResource(root, {
    id: "obligation-new-worker-assets",
    type: "obligation",
    title: "Register issued device",
    status: "active",
    activityType: "asset-registration",
    recurrence: { mode: "event", eventType: "person-started" },
    triggerPrompt: "New worker?",
    window: { precision: "date",
      startsAfter: 0, dueAfter: 2 },
    ownerIds: ["person-owner"]
  });
  await createResource(root, {
    id: "obligation-new-worker-training",
    type: "obligation",
    title: "Complete security training",
    status: "active",
    activityType: "training",
    recurrence: { mode: "event", eventType: "person-started" },
    triggerPrompt: "New worker?",
    window: { precision: "date",
      startsAfter: 0, dueAfter: 30 },
    scopeResourceIds: ["training-worker-security", "person-owner"],
    templateResourceId: "training-worker-security",
    ownerIds: ["person-owner"]
  });
  await createResource(root, {
    id: "obligation-new-worker-review",
    type: "obligation",
    title: "Review onboarding completion",
    status: "active",
    activityType: "access-provisioning",
    recurrence: { mode: "event", eventType: "person-started" },
    triggerPrompt: "New worker?",
    window: { precision: "date", startsAfter: 0, dueAfter: 30 },
    ownerIds: ["person-owner"]
  });

  const created = await createObligationEvent(root, {
    eventType: "person-started",
    occurredOn: "2026-07-01",
    subjectResourceIds: ["person-new-worker"],
    title: "Onboard platform engineer"
  });
  assert.equal(created.actions.length, 3);
  assert.equal(created.actions[0].sourceResourceId, created.event.id);
  assert.equal(created.event.actionItemIds, undefined);
  const trainingAction = created.actions.find(({ title }) => title === "Complete security training");
  assert.match(trainingAction.description, /Review scoped resources: training-worker-security, person-owner/);
  const defaultDeadlineAction = created.actions.find(({ title }) => title === "Review onboarding completion");
  assert.equal(defaultDeadlineAction.completionWindow.dueOn, "2026-07-31");
  assert.equal(defaultDeadlineAction.completionWindow.overdueOn, "2026-08-01");
  assert.equal((await validateWorkspace(root)).ok, true);

  const loaded = await loadWorkspace(root);
  const plan = planObligations(loaded.resources, {
    asOf: "2026-07-02",
    through: "2026-08-01"
  });
  assert.equal(plan.triggers[0].steps.length, 3);
  const trainingStep = plan.triggers[0].steps.find(({ title }) => title === "Complete security training");
  assert.deepEqual(trainingStep.scopeResourceIds, ["training-worker-security", "person-owner"]);
  assert.equal(trainingStep.templateResourceId, "training-worker-security");
  assert.equal(plan.triggers[0].steps.find(({ title }) => title === "Review onboarding completion").window.dueAfter, 30);
  assert.equal(plan.eventRuns[0].actions.length, 3);
  assert.deepEqual(plan.eventRuns[0].actions[0].subjectResourceIds, ["person-new-worker"]);
  assert.deepEqual(
    plan.eventRuns[0].actionItemIds.toSorted(),
    created.actions.map(({ id }) => id).toSorted()
  );
  assert.deepEqual(plan.eventRuns[0].actions.find(({ title }) => title === "Complete security training").scopeResourceIds, ["training-worker-security", "person-owner"]);
  assert.equal(plan.eventRuns[0].actions.find(({ title }) => title === "Register issued device").daysUntilOverdue, 2);
  const trainingScaffold = await scaffoldObligationCompletion(root, {
    actionItemId: trainingAction.id,
    completedOn: "2026-07-02"
  });
  assert.equal(trainingScaffold.record.type, "attestation");
  assert.equal(trainingScaffold.record.personId, "person-new-worker");
  assert.deepEqual(trainingScaffold.record.subjectResourceIds, ["training-worker-security"]);
  await assert.rejects(
    completeObligationAction(root, {
      actionItemId: trainingAction.id,
      record: { ...trainingScaffold.record, id: "attestation-wrong-person", personId: "person-owner" },
      completedOn: "2026-07-02",
      expectedRevision: trainingScaffold.revision
    }),
    /Person in scope/
  );
  await completeObligationAction(root, {
    actionItemId: trainingAction.id,
    record: trainingScaffold.record,
    completedOn: "2026-07-02",
    expectedRevision: trainingScaffold.revision
  });
  const assetAction = created.actions.find(({ title }) => title === "Register issued device");
  const assetScaffold = await scaffoldObligationCompletion(root, {
    actionItemId: assetAction.id,
    completedOn: "2026-07-02"
  });
  assert.equal(assetScaffold.record.type, "evidence");

  const obligationsCli = await execute(process.execPath, [
    fileURLToPath(new URL("../bin/filegrc.js", import.meta.url)),
    "obligations",
    "--root",
    root,
    "--as-of",
    "2026-07-02",
    "--through",
    "2026-08-01",
    "--json"
  ]);
  assert.equal(JSON.parse(obligationsCli.stdout).eventRuns[0].actions.length, 3);
  const obligationsText = await execute(process.execPath, [
    fileURLToPath(new URL("../bin/filegrc.js", import.meta.url)),
    "obligations",
    "--root",
    root,
    "--as-of",
    "2026-07-02",
    "--through",
    "2026-08-01"
  ]);
  assert.match(obligationsText.stdout, /Policy Events:/);
  assert.match(obligationsText.stdout, /New Worker \(person-started\)\t3 Work Queue tasks/);
  assert.match(obligationsText.stdout, /Complete security training[\s\S]*owner=person-owner[\s\S]*proof=attestation\|evidence/);
  const triggerCli = await execute(process.execPath, [
    fileURLToPath(new URL("../bin/filegrc.js", import.meta.url)),
    "trigger",
    "person-started",
    "--root",
    root,
    "--occurred-on",
    "2026-08-01",
    "--subject",
    "person-owner",
    "--title=Onboard=support engineer",
    "--json"
  ]);
  const triggerResult = JSON.parse(triggerCli.stdout);
  assert.equal(triggerResult.actions.length, 3);
  assert.equal(triggerResult.event.title, "Onboard=support engineer");
  const triggerText = await execute(process.execPath, [
    fileURLToPath(new URL("../bin/filegrc.js", import.meta.url)),
    "trigger",
    "person-started",
    "--root",
    root,
    "--occurred-on",
    "2026-09-01",
    "--subject",
    "person-owner",
    "--title",
    "Onboard security engineer"
  ]);
  assert.match(triggerText.stdout, /Work added to the Work Queue: 3 tasks created for Onboard security engineer/);
  assert.match(triggerText.stdout, /Event: obligation-event\//);
  assert.equal((triggerText.stdout.match(/^Task: action-item\//gm) || []).length, 3);
  assert.equal((await loadWorkspace(root)).resources.filter(({ type }) => type === "obligation-event").length, 3);
});

test("preserves late event completion for period continuity checks", () => {
  const obligation = {
    id: "obligation-event-control-operation",
    type: "obligation",
    title: "Review event control",
    status: "active",
    activityType: "control-design-review",
    recurrence: { mode: "event", eventType: "person-started" },
    ownerIds: ["person-owner"],
    controlIds: ["control-one"]
  };
  const event = {
    id: "event-one",
    type: "obligation-event",
    title: "New worker",
    status: "complete",
    eventType: "person-started",
    occurredOn: "2026-01-01",
    subjectResourceIds: ["person-owner"]
  };
  const action = {
    id: "action-one",
    type: "action-item",
    title: "Review event control",
    status: "done",
    obligationId: obligation.id,
    sourceResourceId: event.id,
    assigneeIds: ["person-owner"],
    completionResourceIds: ["activity-one"],
    completedOn: "2026-02-01",
    completionWindow: {
      precision: "date",
      startsOn: "2026-01-01",
      dueOn: "2026-01-02",
      overdueOn: "2026-01-03"
    }
  };
  const completion = {
    id: "activity-one",
    type: "control-activity",
    title: "Late event control review",
    status: "complete",
    profileId: "control-design-review",
    obligationId: obligation.id,
    controlIds: ["control-one"],
    scopeResourceIds: ["control-one"],
    performerIds: ["person-owner"],
    completedAt: "2026-02-01T12:00:00.000Z"
  };
  const plan = planObligationsWithModel([ACTIVE_OWNER, obligation, event, action, completion], {
    asOf: "2026-02-01",
    through: "2026-02-01",
    includeComplete: true,
    model: MODEL_V7
  });
  assert.equal(plan.eventRuns[0].actions[0].status, "complete");
  assert.equal(plan.eventRuns[0].actions[0].lateCompletion, true);
});

test("headless completion helpers enforce expected types and update links atomically", async (context) => {
  const root = await mkdtemp(`${tmpdir()}/filegrc-obligation-completion-`);
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await createResource(root, {
    id: "obligation-quarterly-review",
    type: "obligation",
    title: "Quarterly access review",
    status: "active",
    activityType: "access-review",
    recurrence: { mode: "calendar", unit: "month", interval: 3, anchorDate: "2026-01-01" },
    ownerIds: ["person-owner"]
  });
  const completion = {
    id: "access-review-q1",
    type: "access-review",
    title: "Q1 Access Review",
    status: "planned",
    scheduledFor: "2026-03-20",
    reviewerIds: ["person-owner"],
    systemIds: ["person-owner"]
  };
  await assert.rejects(
    completeObligationOccurrence(root, {
      obligationId: "obligation-quarterly-review",
      record: { ...completion, id: "evidence-wrong-type", type: "evidence" }
    }),
    /expects a completion resource/
  );
  assert.equal((await loadWorkspace(root)).resources.some(({ id }) => id === "evidence-wrong-type"), false);

  const eventObligation = {
    id: "obligation-worker-review",
    type: "obligation",
    title: "Review worker access",
    status: "active",
    activityType: "inventory-review",
    recurrence: { mode: "event", eventType: "person-started" },
    window: { precision: "date", dueAfter: 30 },
    ownerIds: ["person-owner"]
  };
  await createResource(root, eventObligation);
  const event = await createObligationEvent(root, {
    eventType: "person-started",
    occurredOn: "2026-07-01",
    subjectResourceIds: ["person-owner"]
  });
  const action = event.actions[0];
  const eventState = await createAppState(root);
  const eventRevision = eventState.resources.find(({ record }) => record.id === event.event.id).revision;
  const actionRevision = eventState.resources.find(({ record }) => record.id === action.id).revision;
  await assert.rejects(
    execute(process.execPath, [
      fileURLToPath(new URL("../bin/filegrc.js", import.meta.url)),
      "complete-event",
      event.event.id,
      "--completed-on",
      "2026-07-02",
      "--expected-revision",
      eventRevision,
      "--root",
      root
    ]),
    /still has incomplete actions/
  );
  const completionMutation = {
    record: {
      id: "evidence-worker-access-review",
      type: "evidence",
      title: "Worker access review",
      status: "collected",
      artifactKind: "business-record",
      artifactSubtype: "review",
      sourceKind: "authored-record",
      sourceDescription: "Access review",
      collectedOn: "2026-07-02",
      classificationId: "internal",
      collectorIds: ["person-owner"]
    },
    content: {
      content: "# Worker access review\n\nAccess was reviewed against the approved request."
    }
  };
  const completionPath = join(root, "completion-mutation.json");
  await writeFile(completionPath, `${JSON.stringify(completionMutation, null, 2)}\n`, "utf8");
  const completedCli = await execute(process.execPath, [
    fileURLToPath(new URL("../bin/filegrc.js", import.meta.url)),
    "complete-action",
    action.id,
    completionPath,
    "--completed-on",
    "2026-07-02",
    "--expected-revision",
    actionRevision,
    "--root",
    root,
    "--json"
  ]);
  assert.equal(JSON.parse(completedCli.stdout).linked.status, "done");
  const completedEventCli = await execute(process.execPath, [
    fileURLToPath(new URL("../bin/filegrc.js", import.meta.url)),
    "complete-event",
    event.event.id,
    "--completed-on",
    "2026-07-02",
    "--expected-revision",
    eventRevision,
    "--root",
    root,
    "--json"
  ]);
  assert.equal(JSON.parse(completedEventCli.stdout).record.status, "complete");
  const completed = (await loadWorkspace(root)).resources.find(({ id }) => id === action.id);
  assert.equal(completed.status, "done");
  assert.equal(completed.completedOn, "2026-07-02");
  assert.deepEqual(completed.completionResourceIds, ["evidence-worker-access-review"]);
  assert.equal((await validateWorkspace(root)).ok, true);
});

test("scaffolds a complete headless Work Queue mutation with its safe write revision", async (context) => {
  const root = await mkdtemp(`${tmpdir()}/filegrc-obligation-scaffold-`);
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await createResource(root, {
    id: "system-service",
    type: "system",
    title: "Service",
    status: "active",
    criticality: "high",
    ownerIds: ["person-owner"]
  });
  const workspace = (await loadWorkspace(root)).workspace;
  await updateResource(root, "workspace", workspace.id, {
    ...workspace,
    systemIds: ["system-service"]
  });
  await createResource(root, {
    id: "obligation-quarterly-access-review",
    type: "obligation",
    title: "Quarterly access review",
    status: "active",
    activityType: "access-review",
    recurrence: { mode: "calendar", unit: "month", interval: 3, anchorDate: "2026-01-01" },
    ownerIds: ["person-owner"],
    scopeResourceIds: ["system-service"]
  });

  const scaffold = await scaffoldObligationCompletion(root, {
    obligationId: "obligation-quarterly-access-review",
    windowStart: "2026-01-01",
    completedOn: "2026-03-20"
  });
  assert.equal(scaffold.record.type, "access-review");
  assert.equal(scaffold.record.status, "complete");
  assert.deepEqual(scaffold.record.systemIds, ["system-service"]);
  assert.deepEqual(scaffold.record.reviewerIds, ["person-owner"]);
  assert.equal(scaffold.record.completedOn, "2026-03-20");
  assert.equal(scaffold.scaffold.dueWindowEnd, "2026-03-31");
  assert.match(scaffold.revision, /^filegrc:content:v1:sha256:[a-f0-9]{64}$/);
  assert.deepEqual(scaffold.record.evidenceIds, []);

  await createResource(root, {
    id: "evidence-quarterly-access-review",
    type: "evidence",
    title: "Quarterly access review export",
    status: "verified",
    artifactKind: "system-export",
    sourceKind: "external-reference",
    sourceDescription: "Fixed access export retained in the identity system.",
    collectedOn: "2026-03-20",
    collectorIds: ["person-owner"],
    verifierIds: ["person-approver"],
    verifiedOn: "2026-03-20",
    classificationId: "internal",
    externalReference: {
      system: "Identity system",
      reference: "test-quarterly-access-review"
    }
  });
  scaffold.record.evidenceIds = ["evidence-quarterly-access-review"];
  const mutationPath = join(root, "completion-scaffold.json");
  await writeFile(mutationPath, `${JSON.stringify(scaffold, null, 2)}\n`, "utf8");
  const completed = await execute(process.execPath, [
    fileURLToPath(new URL("../bin/filegrc.js", import.meta.url)),
    "complete",
    "obligation-quarterly-access-review",
    mutationPath,
    "--root",
    root,
    "--json"
  ]);
  const output = JSON.parse(completed.stdout);
  assert.equal(output.created.type, "access-review");
  assert.equal(output.linked.completionResourceIds.includes(scaffold.record.id), true);

  const cliScaffold = await execute(process.execPath, [
    fileURLToPath(new URL("../bin/filegrc.js", import.meta.url)),
    "complete",
    "obligation-quarterly-access-review",
    "--scaffold",
    "--window-start",
    "2026-04-01",
    "--completed-on",
    "2026-06-20",
    "--root",
    root
  ]);
  assert.equal(JSON.parse(cliScaffold.stdout).scaffold.dueWindowStart, "2026-04-01");
  assert.equal((await validateWorkspace(root)).ok, true);
});

test("preserves exact event timestamps for hour-based policy deadlines", async (context) => {
  const root = await mkdtemp(`${tmpdir()}/filegrc-hour-obligation-`);
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await createResource(root, {
    id: "obligation-offboarding-access",
    type: "obligation",
    title: "Remove access",
    status: "active",
    activityType: "access-removal",
    recurrence: { mode: "event", eventType: "person-ended" },
    triggerPrompt: "Worker leaving?",
    window: { precision: "timestamp",
      startsAfter: 0, dueAfter: 24 },
    ownerIds: ["person-owner"]
  });

  const created = await createObligationEvent(root, {
    eventType: "person-ended",
    occurredAt: "2026-07-01T15:30:00-05:00",
    subjectResourceIds: ["person-owner"]
  });
  assert.equal(created.event.occurredOn, "2026-07-01");
  assert.equal(created.event.occurredAt, "2026-07-01T15:30:00-05:00");
  assert.equal(created.actions[0].completionWindow.dueAt, "2026-07-02T20:30:00.000Z");

  const resources = (await loadWorkspace(root)).resources;
  const due = planObligations(resources, {
    asOf: "2026-07-02",
    through: "2026-07-03",
    now: "2026-07-02T19:30:00Z"
  });
  assert.equal(due.eventItems[0].status, "due");
  assert.equal(due.eventItems[0].hoursUntilOverdue, 1);

  const overdue = planObligations(resources, {
    asOf: "2026-07-02",
    through: "2026-07-03",
    now: "2026-07-02T20:31:00Z"
  });
  assert.equal(overdue.eventItems[0].status, "overdue");
  assert.equal(overdue.eventItems[0].hoursOverdue, 0);

  const action = resources.find(({ id }) => id === created.actions[0].id);
  await updateResource(root, "action-item", action.id, {
    ...action,
    status: "done",
    completedOn: "2026-07-02"
  });
  const missingProof = planObligations((await loadWorkspace(root)).resources, {
    asOf: "2026-07-02",
    through: "2026-07-03",
    now: "2026-07-02T20:31:00Z"
  });
  assert.equal(missingProof.eventItems[0].status, "overdue");
  assert.equal(missingProof.eventItems[0].missingCompletion, true);

  await createResource(root, {
    id: "evidence-offboarding-access",
    type: "evidence",
    title: "Access removal record",
    status: "verified",
    artifactKind: "system-export",
    sourceKind: "external-reference",
    sourceDescription: "Identity system",
    collectedOn: "2026-07-02",
    classificationId: "internal",
    collectorIds: ["person-owner"],
    verifierIds: ["person-approver"],
    verifiedOn: "2026-07-02",
    externalReference: { system: "Identity system", reference: "test-record" }
  });
  const updatedAction = (await loadWorkspace(root)).resources.find(({ id }) => id === action.id);
  await updateResource(root, "action-item", action.id, {
    ...updatedAction,
    evidenceIds: ["evidence-offboarding-access"]
  });
  const complete = planObligations((await loadWorkspace(root)).resources, {
    asOf: "2026-07-02",
    through: "2026-07-03",
    now: "2026-07-02T20:31:00Z",
    includeComplete: true
  });
  assert.equal(complete.eventItems[0].status, "complete");

  const completedAction = (await loadWorkspace(root)).resources.find(({ id }) => id === action.id);
  const { completedOn: _completedOn, ...cancelableAction } = completedAction;
  await updateResource(root, "action-item", action.id, {
    ...cancelableAction,
    status: "canceled",
    cancellation: {
      canceledByIds: ["person-owner"],
      canceledOn: "2026-07-02",
      reason: "Management canceled this duplicate task."
    }
  });
  const canceled = planObligations((await loadWorkspace(root)).resources, {
    asOf: "2026-07-02",
    through: "2026-07-03",
    now: "2026-07-02T20:31:00Z",
    includeComplete: true
  });
  assert.equal(canceled.eventItems[0].status, "overdue");
  assert.equal(canceled.eventItems[0].canceledAction, true);
  assert.notEqual(canceled.eventRuns[0].status, "complete");

  const event = (await loadWorkspace(root)).resources.find(({ id }) => id === created.event.id);
  await updateResource(root, "obligation-event", event.id, {
    ...event,
    status: "canceled",
    cancellation: {
      canceledByIds: ["person-owner"],
      canceledOn: "2026-07-02",
      reason: "Management canceled the event workflow."
    }
  });
  const canceledEvent = planObligations((await loadWorkspace(root)).resources, {
    asOf: "2026-07-02",
    through: "2026-07-03",
    now: "2026-07-02T20:31:00Z",
    includeComplete: true
  });
  assert.equal(canceledEvent.eventRuns[0].status, "canceled");
  assert.equal(canceledEvent.eventItems.length, 0);
});

test("rejects malformed obligation recurrence and due windows", async (context) => {
  const root = await mkdtemp(`${tmpdir()}/filegrc-invalid-obligation-`);
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await assert.rejects(
    createResource(root, {
      id: "obligation-invalid-event",
      type: "obligation",
      title: "Invalid event",
      status: "active",
      activityType: "inventory-review",
      recurrence: { mode: "event" },
      window: { precision: "date",
      startsAfter: 3, dueAfter: 1 },
      ownerIds: ["person-owner"]
    }),
    /workspace invalid/
  );
  assert.equal((await loadWorkspace(root)).resources.some(({ id }) => id === "obligation-invalid-event"), false);
  await assert.rejects(
    createResource(root, {
      id: "obligation-ambiguous-window",
      type: "obligation",
      title: "Ambiguous window",
      status: "active",
      activityType: "inventory-review",
      recurrence: { mode: "calendar", unit: "month", interval: 1, anchorDate: "2026-01-01" },
      window: { precision: "date",
      startsAfter: 5 },
      ownerIds: ["person-owner"]
    }),
    /workspace invalid/
  );
  await createResource(root, {
    id: "obligation-calendar-boundary",
    type: "obligation",
    title: "Calendar boundary",
    status: "active",
    activityType: "inventory-review",
    recurrence: { mode: "event", eventType: "person-started" },
    window: { precision: "date", dueAfter: 0 },
    ownerIds: ["person-owner"]
  });
  await assert.rejects(
    createObligationEvent(root, {
      eventType: "person-started",
      occurredOn: "9999-12-31"
    }),
    /supported calendar range/
  );
});

test("enforces activity recurrence and scope plus Policy Event subject rules", async (context) => {
  const root = await mkdtemp(`${tmpdir()}/filegrc-obligation-registry-rules-`);
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await createResource(root, {
    id: "system-service",
    type: "system",
    title: "Service",
    status: "active",
    criticality: "high",
    ownerIds: ["person-owner"]
  });
  await assert.rejects(
    createResource(root, {
      id: "obligation-calendar-access-removal",
      type: "obligation",
      title: "Calendar access removal",
      status: "active",
      activityType: "access-removal",
      recurrence: { mode: "calendar", unit: "month", interval: 1, anchorDate: "2026-01-01" },
      ownerIds: ["person-owner"]
    }),
    /access-removal obligations require event recurrence/
  );
  await assert.rejects(
    createResource(root, {
      id: "obligation-invalid-risk-scope",
      type: "obligation",
      title: "Invalid risk scope",
      status: "active",
      activityType: "risk-assessment",
      recurrence: { mode: "calendar", unit: "year", interval: 1, anchorDate: "2026-01-01" },
      scopeResourceIds: ["person-owner"],
      ownerIds: ["person-owner"]
    }),
    /risk-assessment allows .* scope/
  );
  await createResource(root, {
    id: "obligation-worker-access",
    type: "obligation",
    title: "Provision worker access",
    status: "active",
    activityType: "access-provisioning",
    recurrence: { mode: "event", eventType: "person-started" },
    window: { precision: "date", startsAfter: 0, dueAfter: 1 },
    ownerIds: ["person-owner"]
  });
  await assert.rejects(
    createObligationEvent(root, {
      eventType: "person-started",
      occurredOn: "2026-08-02",
      subjectResourceIds: ["system-service"]
    }),
    /person-started cannot use system|person-started requires at least 1 person/
  );
});

test("bounds unusually large obligation queries", () => {
  assert.throws(() => planObligations([{
    id: "obligation-ancient-daily-task",
    type: "obligation",
    title: "Ancient daily task",
    status: "active",
    activityType: "inventory-review",
    recurrence: {
      mode: "calendar",
      unit: "day",
      interval: 1,
      anchorDate: "1000-01-01"
    },
    ownerIds: ["person-owner"]
  }], {
    asOf: "2026-07-25",
    through: "2026-07-25"
  }), /must be narrowed/);
  assert.throws(() => planObligations([{
    id: "obligation-long-window",
    type: "obligation",
    title: "Long-window daily task",
    status: "active",
    activityType: "inventory-review",
    recurrence: {
      mode: "calendar",
      unit: "day",
      interval: 1,
      anchorDate: "1900-01-01"
    },
    window: {
      precision: "date",
      startsAfter: 36_599,
      dueAfter: 36_600
    },
    ownerIds: ["person-owner"]
  }], {
    asOf: "2026-07-25",
    from: "2026-07-25",
    through: "2026-07-25"
  }), /must be narrowed/);
});
