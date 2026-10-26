import assert from "node:assert/strict";
import test from "node:test";
import { loadModel } from "../model/index.js";
import { planWorkQueue } from "../src/work-queue.js";

const model = loadModel("13");
const program = { type: "program", id: "program-primary", status: "active", systemIds: ["system-primary"] };
const plan = (items = []) => ({ dataModelVersion: "13", asOf: "2026-07-10", through: "2026-08-10", items });
const assessment = (extra = {}) => ({ type: "risk-assessment", id: "assessment-current", title: "Current risk review", status: "in-progress", scheduledFor: "2026-07-09", systemIds: ["system-primary"], ...extra });

test("queue includes overdue source reviews without changing the obligation plan or assigning an actor", () => {
  const obligation = { kind: "calendar", key: "annual-review", obligationId: "obligation-review", title: "Annual review", status: "due", dueWindowEnd: "2026-07-31" };
  const obligations = plan([obligation]);
  const record = assessment();
  const queue = planWorkQueue([program, record], obligations, { program, model });
  assert.equal(queue.counts.overdue, 1);
  assert.equal(queue.counts.due, 1);
  assert.equal(queue.items[0].source.id, record.id);
  assert.equal(queue.items[0].dueOn, "2026-07-09");
  assert.deepEqual(queue.items[0].ownerIds, []);
  assert.deepEqual(queue.items[0].notificationContacts, []);
  assert.deepEqual(obligations.items, [obligation]);
  assert.equal(record.status, "in-progress");
});

test("source deadlines use the selected Program, lifecycle and queue horizon", () => {
  const records = [program, assessment(), assessment({ id: "review-other-program", programId: "program-other" }),
    assessment({ id: "review-finished", status: "complete" }), assessment({ id: "review-canceled", status: "canceled" }),
    assessment({ id: "review-today", scheduledFor: "2026-07-10" }), assessment({ id: "review-upcoming", scheduledFor: "2026-07-11" }),
    assessment({ id: "review-outside-horizon", scheduledFor: "2026-09-01" })];
  const queue = planWorkQueue(records, plan(), { program, model });
  assert.deepEqual(queue.items.map(x => x.source.id), ["assessment-current", "review-today", "review-upcoming"]);
  assert.equal(queue.counts.overdue, 1);assert.equal(queue.counts.due, 1);assert.equal(queue.counts.upcoming, 1);
});

test("queue retains Waiting and blocked obligations and does not duplicate Action Items", () => {
  const records = [program, { type: "action-item", id: "action-work", title: "Assigned work", status: "open", dueOn: "2026-07-09" }];
  const items = [{ kind: "action", key: "action", actionItemId: "action-work", status: "overdue" },
    { kind: "calendar", key: "waiting", obligationId: "obligation-wait", status: "waiting" },
    { kind: "calendar", key: "blocked", obligationId: "obligation-blocked", status: "blocked" }];
  const queue = planWorkQueue(records, plan(items), { program, model });
  assert.equal(queue.items.length, 3);assert.equal(queue.counts.overdue, 1);assert.equal(queue.counts.blocked, 1);assert.equal(queue.counts.waiting, 1);
});

test("independent source proposals and approved Exception expiry remain separate work", () => {
  const records = [program, assessment({ id: "draft-a", status: "planned" }), assessment({ id: "draft-b", status: "draft" }),
    { type: "exception", id: "exception-current", title: "Review expired exception", status: "approved", systemIds: ["system-primary"], approval: { expiresOn: "2026-07-09" }, ownerIds: ["person-owner"] },
    { type: "person", id: "person-owner", status: "active", email: "owner@example.com" }];
  const queue = planWorkQueue(records, plan());
  assert.equal(queue.counts.proposed, 2);assert.equal(queue.counts.overdue, 1);
  const exception = queue.items.find(x => x.source.id === "exception-current");
  assert.match(exception.nextAction.command, /trigger exception-expired/);
  assert.deepEqual(exception.notificationContacts, [{ personId: "person-owner", email: "owner@example.com" }]);
  assert.equal(records[2].status, "draft");
});

test("an operating program cannot show a healthy summary while a source deadline is overdue", async () => {
  const { APP_SCRIPT } = await import("../src/web.js");
  const { default: vm } = await import("node:vm");
  const source = APP_SCRIPT.slice(APP_SCRIPT.indexOf("function queueState()"), APP_SCRIPT.indexOf("function progressFromCounts"));
  const result = vm.runInNewContext(source + "; operationProgress()", {
    state: { programReadiness: { operating: true, target: { goal: "none" } }, workQueue: { counts: { overdue: 1, blocked: 0 } } },
    activeProgram: () => ({ assuranceGoal: "none" }), currentDate: () => "2026-07-10", pluralize: (word, n) => n === 1 ? word : word + "s"
  });
  assert.equal(result.status, "Needs attention");
  assert.match(result.detail, /1 overdue Work Queue item/);
});

test("invalid blocked source records remain inspectable while model diagnostics are repaired", () => {
  const record = assessment({ status: "blocked", blockingResourceIds: ["assessment-prerequisite"] });
  const prerequisite = assessment({ id: "assessment-prerequisite", title: "Prerequisite review", status: "complete" });
  const queue = planWorkQueue([program, record, prerequisite], plan(), { program, model });
  assert.equal(queue.counts.overdue, 1);
  assert.equal(queue.items[0].blockingReason, "Blocked by Prerequisite review.");
  assert.deepEqual(queue.items[0].dependencies.map(x => x.id), [prerequisite.id]);
});
