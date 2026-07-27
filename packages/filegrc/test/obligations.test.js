import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  completeObligationOccurrence,
  createObligationEvent,
  createResource,
  loadWorkspace,
  planObligations,
  updateResource,
  validateWorkspace
} from "../src/index.js";
import { makeWorkspace } from "./helpers.js";

const execute = promisify(execFile);

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
  const due = planObligations([obligation], {
    asOf: "2026-03-15",
    through: "2026-04-01"
  });
  assert.deepEqual(due.counts, { overdue: 0, due: 1, upcoming: 1, complete: 0 });
  assert.equal(due.items[0].status, "due");
  assert.equal(due.items[0].dueWindowStart, "2026-01-01");
  assert.equal(due.items[0].dueWindowEnd, "2026-03-31");
  assert.equal(due.items[0].overdueOn, "2026-04-01");
  assert.equal(due.items[0].daysUntilOverdue, 17);

  const overdue = planObligations([obligation], {
    asOf: "2026-04-02",
    through: "2026-04-02"
  });
  assert.equal(overdue.items[0].status, "overdue");
  assert.equal(overdue.items[0].daysOverdue, 1);
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
    status: "held",
    meetingDate: "2026-03-20"
  };
  const plan = planObligations([obligation, meeting], {
    asOf: "2026-04-02",
    from: "2026-01-01",
    through: "2026-04-02",
    includeComplete: true
  });
  assert.equal(plan.calendarItems[0].status, "complete");
  assert.deepEqual(plan.calendarItems[0].completionResourceIds, ["meeting-q1"]);
  assert.equal(plan.calendarItems[1].status, "due");
});

test("creates an event run and its policy checklist as one valid batch", async (context) => {
  const root = await mkdtemp(`${tmpdir()}/filegrc-obligation-event-`);
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await createResource(root, {
    schemaVersion: 1,
    id: "obligation-new-worker-assets",
    type: "obligation",
    title: "Register issued device",
    status: "active",
    activityType: "asset-registration",
    recurrence: { mode: "event", eventType: "person-started" },
    triggerPrompt: "New worker?",
    window: { startOffsetDays: 0, endOffsetDays: 2 },
    completionResourceTypes: ["asset"],
    ownerIds: ["person-owner"]
  });
  await createResource(root, {
    schemaVersion: 1,
    id: "obligation-new-worker-training",
    type: "obligation",
    title: "Complete security training",
    status: "active",
    activityType: "training",
    recurrence: { mode: "event", eventType: "person-started" },
    triggerPrompt: "New worker?",
    window: { startOffsetDays: 0, endOffsetDays: 30 },
    completionResourceTypes: ["attestation", "evidence"],
    scopeResourceIds: ["person-owner"],
    templateResourceId: "person-owner",
    ownerIds: ["person-owner"]
  });
  await createResource(root, {
    schemaVersion: 1,
    id: "obligation-new-worker-review",
    type: "obligation",
    title: "Review onboarding completion",
    status: "active",
    activityType: "onboarding-review",
    recurrence: { mode: "event", eventType: "person-started" },
    triggerPrompt: "New worker?",
    completionResourceTypes: ["evidence"],
    ownerIds: ["person-owner"]
  });

  const created = await createObligationEvent(root, {
    eventType: "person-started",
    occurredOn: "2026-07-01",
    subjectResourceIds: ["person-owner"],
    title: "Onboard platform engineer"
  });
  assert.equal(created.actions.length, 3);
  assert.equal(created.actions[0].sourceResourceId, created.event.id);
  assert.deepEqual(created.event.actionItemIds, created.actions.map(({ id }) => id));
  const trainingAction = created.actions.find(({ title }) => title === "Complete security training");
  assert.match(trainingAction.description, /Review scoped resources: person-owner/);
  const defaultDeadlineAction = created.actions.find(({ title }) => title === "Review onboarding completion");
  assert.equal(defaultDeadlineAction.dueWindowEnd, "2026-07-31");
  assert.equal(defaultDeadlineAction.overdueOn, "2026-08-01");
  assert.equal((await validateWorkspace(root)).ok, true);

  const loaded = await loadWorkspace(root);
  const plan = planObligations(loaded.resources, {
    asOf: "2026-07-02",
    through: "2026-08-01"
  });
  assert.equal(plan.triggers[0].steps.length, 3);
  const trainingStep = plan.triggers[0].steps.find(({ title }) => title === "Complete security training");
  assert.deepEqual(trainingStep.scopeResourceIds, ["person-owner"]);
  assert.equal(trainingStep.templateResourceId, "person-owner");
  assert.equal(plan.triggers[0].steps.find(({ title }) => title === "Review onboarding completion").window.endOffsetDays, 30);
  assert.equal(plan.eventRuns[0].actions.length, 3);
  assert.deepEqual(plan.eventRuns[0].actions.find(({ title }) => title === "Complete security training").scopeResourceIds, ["person-owner"]);
  assert.equal(plan.eventRuns[0].actions.find(({ title }) => title === "Register issued device").daysUntilOverdue, 2);

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
  assert.equal((await loadWorkspace(root)).resources.filter(({ type }) => type === "obligation-event").length, 2);
});

test("headless completion helpers enforce expected types and update links atomically", async (context) => {
  const root = await mkdtemp(`${tmpdir()}/filegrc-obligation-completion-`);
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await createResource(root, {
    schemaVersion: 1,
    id: "obligation-quarterly-review",
    type: "obligation",
    title: "Quarterly access review",
    status: "active",
    activityType: "access-review",
    recurrence: { mode: "calendar", unit: "month", interval: 3, anchorDate: "2026-01-01" },
    completionResourceTypes: ["access-review"],
    ownerIds: ["person-owner"]
  });
  const completion = {
    schemaVersion: 1,
    id: "access-review-q1",
    type: "access-review",
    title: "Q1 Access Review",
    status: "planned",
    reviewDate: "2026-03-20",
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
    schemaVersion: 1,
    id: "obligation-worker-review",
    type: "obligation",
    title: "Review worker access",
    status: "active",
    activityType: "access-review",
    recurrence: { mode: "event", eventType: "person-started" },
    window: { endOffsetDays: 30 },
    completionResourceTypes: ["evidence"],
    ownerIds: ["person-owner"]
  };
  await createResource(root, eventObligation);
  const event = await createObligationEvent(root, {
    eventType: "person-started",
    occurredOn: "2026-07-01",
    subjectResourceIds: ["person-owner"]
  });
  const action = event.actions[0];
  await assert.rejects(
    execute(process.execPath, [
      fileURLToPath(new URL("../bin/filegrc.js", import.meta.url)),
      "complete-event",
      event.event.id,
      "--completed-on",
      "2026-07-02",
      "--root",
      root
    ]),
    /still has incomplete actions/
  );
  const completionMutation = {
    record: {
      schemaVersion: 1,
      id: "evidence-worker-access-review",
      type: "evidence",
      title: "Worker access review",
      status: "collected",
      evidenceKind: "review",
      source: "Access review",
      collectedOn: "2026-07-02",
      classification: "Internal",
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

test("preserves exact event timestamps for hour-based policy deadlines", async (context) => {
  const root = await mkdtemp(`${tmpdir()}/filegrc-hour-obligation-`);
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await createResource(root, {
    schemaVersion: 1,
    id: "obligation-offboarding-access",
    type: "obligation",
    title: "Remove access",
    status: "active",
    activityType: "access-removal",
    recurrence: { mode: "event", eventType: "person-ended" },
    triggerPrompt: "Worker leaving?",
    window: { startOffsetHours: 0, endOffsetHours: 24 },
    completionResourceTypes: ["access-review", "evidence"],
    ownerIds: ["person-owner"]
  });

  const created = await createObligationEvent(root, {
    eventType: "person-ended",
    occurredAt: "2026-07-01T15:30:00-05:00",
    subjectResourceIds: ["person-owner"]
  });
  assert.equal(created.event.occurredOn, "2026-07-01");
  assert.equal(created.event.occurredAt, "2026-07-01T15:30:00-05:00");
  assert.equal(created.actions[0].dueWindowEndAt, "2026-07-02T20:30:00.000Z");

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
  await updateResource(root, "action-item", action.id, { ...action, status: "done" });
  const missingProof = planObligations((await loadWorkspace(root)).resources, {
    asOf: "2026-07-02",
    through: "2026-07-03",
    now: "2026-07-02T20:31:00Z"
  });
  assert.equal(missingProof.eventItems[0].status, "overdue");
  assert.equal(missingProof.eventItems[0].missingCompletion, true);

  await createResource(root, {
    schemaVersion: 1,
    id: "evidence-offboarding-access",
    type: "evidence",
    title: "Access removal record",
    status: "verified",
    evidenceKind: "system-export",
    source: "Identity system",
    collectedOn: "2026-07-02",
    classification: "Internal",
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
  await updateResource(root, "action-item", action.id, { ...completedAction, status: "canceled" });
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
  await updateResource(root, "obligation-event", event.id, { ...event, status: "canceled" });
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
      schemaVersion: 1,
      id: "obligation-invalid-event",
      type: "obligation",
      title: "Invalid event",
      status: "active",
      activityType: "test",
      recurrence: { mode: "event" },
      window: { startOffsetDays: 3, endOffsetDays: 1 },
      ownerIds: ["person-owner"]
    }),
    /workspace invalid/
  );
  assert.equal((await loadWorkspace(root)).resources.some(({ id }) => id === "obligation-invalid-event"), false);
  await assert.rejects(
    createResource(root, {
      schemaVersion: 1,
      id: "obligation-ambiguous-window",
      type: "obligation",
      title: "Ambiguous window",
      status: "active",
      activityType: "test",
      recurrence: { mode: "calendar", unit: "month", interval: 1, anchorDate: "2026-01-01" },
      window: { startOffsetDays: 5 },
      ownerIds: ["person-owner"]
    }),
    /workspace invalid/
  );
  await createResource(root, {
    schemaVersion: 1,
    id: "obligation-calendar-boundary",
    type: "obligation",
    title: "Calendar boundary",
    status: "active",
    activityType: "test",
    recurrence: { mode: "event", eventType: "calendar-boundary" },
    window: { endOffsetDays: 0 },
    ownerIds: ["person-owner"]
  });
  await assert.rejects(
    createObligationEvent(root, {
      eventType: "calendar-boundary",
      occurredOn: "9999-12-31"
    }),
    /supported calendar range/
  );
});

test("bounds unusually large obligation queries", () => {
  assert.throws(() => planObligations([{
    id: "obligation-ancient-daily-task",
    type: "obligation",
    title: "Ancient daily task",
    status: "active",
    activityType: "test",
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
    activityType: "test",
    recurrence: {
      mode: "calendar",
      unit: "day",
      interval: 1,
      anchorDate: "1900-01-01"
    },
    window: {
      startOffsetDays: 36_599,
      endOffsetDays: 36_600
    },
    ownerIds: ["person-owner"]
  }], {
    asOf: "2026-07-25",
    from: "2026-07-25",
    through: "2026-07-25"
  }), /must be narrowed/);
});
