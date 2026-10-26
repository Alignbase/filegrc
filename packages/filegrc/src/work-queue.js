import { loadModel } from "../model/index.js";
import { recordBelongsToProgram, resolveProgram } from "./program.js";
import { notificationContacts } from "./notifications.js";

const TERMINAL_STATUSES = new Set([
  "accepted",
  "approved",
  "closed",
  "complete",
  "completed",
  "done",
  "expired",
  "inactive",
  "not-applicable",
  "reconciled",
  "remediated",
  "resolved",
  "retired",
  "superseded",
  "terminated",
  "verified"
]);

const DATE_FIELDS = [
  "dueOn",
  "expiresOn",
  "targetRemediationOn",
  "treatmentTargetOn",
  "reviewDueOn",
  "scheduledFor",
  "validThrough",
  "fieldworkStart",
  "fieldworkEnd",
  "reportDate",
  "endsOn",
  "endDate",
  "proposedEffectiveOn"
];

const OWNER_FIELDS = [
  "assigneeIds",
  "ownerIds",
  "responsibleIds",
  "reviewerIds"
];

export function workPriority(state, dueOn, asOf) {
  if (state === "waiting") return 60;
  if (state === "overdue") return 0;
  if (dueOn && asOf && dueOn < asOf) return 5;
  if (state === "due") return 10;
  if (state === "ready" || state === "open") return 20;
  if (state === "blocked") return 30;
  if (state === "upcoming" || state === "scheduled") return 50;
  return 90;
}


function firstDate(record) {
  if (record.type === "exception" && typeof record.approval?.expiresOn === "string") return record.approval.expiresOn;
  if (typeof record.completionWindow?.dueAt === "string" && record.completionWindow.dueAt) return record.completionWindow.dueAt;
  if (typeof record.completionWindow?.dueOn === "string" && record.completionWindow.dueOn) return record.completionWindow.dueOn;
  for (const field of DATE_FIELDS) {
    if (typeof record[field] === "string" && record[field]) return record[field];
  }
  return null;
}


function workScope(record) {
  for (const field of [
    "scopeResourceIds",
    "systemIds",
    "controlIds",
    "vendorIds",
    "requirementIds"
  ]) {
    if (Array.isArray(record[field]) && record[field].length) return record[field];
  }
  return [];
}


function sourceCompletionProfile(record) {
  if (record.type === "action-item") return record.obligationId ? "assigned-obligation-work" : "assigned-action";
  if (record.type === "audit-request") return "audit-request-response";
  if (record.type === "risk") return "risk-treatment-and-review";
  if (record.type === "vulnerability") return "vulnerability-remediation";
  if (record.type === "finding") return "finding-remediation-and-verification";
  if (record.type === "exception") return "exception-expiry-and-compensating-control-review";
  if (record.type === "service-account") return "service-account-review-or-disablement";
  if (record.type === "vendor") return "vendor-assurance-renewal-or-termination";
  if (record.type === "access-grant") return "access-renewal-or-revocation";
  if (record.type === "audit") return "audit-lifecycle-transition";
  return `${record.type}-lifecycle`;
}


function sourceNextAction(record, due, asOf, records) {
  const eventType = record.type === "exception"
    ? (record.status === "approved" && due < asOf ? "exception-expired" : null)
    : due <= asOf ? {
    "service-account": "service-account-expired",
    vulnerability: "vulnerability-overdue"
  }[record.type] : null;
  const alreadyRecorded = eventType && records.some((item) => (
    item.type === "obligation-event"
    && item.eventType === eventType
    && (item.subjectResourceIds || []).includes(record.id)
    && item.occurredOn >= due.slice(0, 10)
  ));
  if (eventType && !alreadyRecorded) {
    return {
      kind: "command",
      command: `npx filegrc trigger ${eventType} --occurred-on YYYY-MM-DD --subject ${shellArgument(record.id)} --json`
    };
  }
  return {
    kind: "command",
    command: `npx filegrc get ${shellArgument(record.id)} --mutation`
  };
}


function firstOwners(record) {
  for (const field of OWNER_FIELDS) {
    if (Array.isArray(record[field]) && record[field].length) return record[field];
  }
  return [];
}


function sourceWorkState(record, due, asOf) {
  if (record.type === "exception" && ["closed", "revoked"].includes(record.status)) return "complete";
  if (!(record.type === "exception" && record.status === "approved") && TERMINAL_STATUSES.has(record.status)) return "complete";
  if (["canceled", "superseded"].includes(record.status)) return record.status;
  if (["draft", "in-review", "partially-implemented", "planned", "proposed"].includes(record.status)) {
    return "proposed";
  }
  if (due < asOf) return "overdue";
  if (due === asOf) return "due";
  return "scheduled";
}


function blockingDependencies(ids = [], byId) {
  return ids.map((id) => {
    const record = byId.get(id);
    return {
      type: record?.type || "unknown",
      id,
      reasons: ["Resolve this prerequisite before continuing the blocked work."]
    };
  });
}


function shellArgument(value) {
  const text = String(value);
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(text)
    ? text
    : `'${text.replaceAll("'", "'\\''")}'`;
}


// Shared source deadlines preserve the workflow's lifecycle and Program scope.
// Action Items and Obligation occurrences remain owned by the obligation planner.
export function sourceDeadlineWorkItems(records, options) {
  const byId = new Map(records.map((record) => [record.id, record]));
  const items = [];
  for (const record of records) {
    // The queue planner owns all Action Items, including filtered and terminal
    // work. Recreating them from deadlines would undo its scope and lifecycle.
    if (["obligation", "action-item"].includes(record.type) || options.excludedSourceIds?.has(record.id)) continue;
    if (!recordBelongsToProgram(record, options.program, byId, options.model)) continue;
    const due = firstDate(record);
    if (!due) continue;
    const state = sourceWorkState(record, due, options.asOf);
    if (state === "complete" && !options.includeComplete) continue;
    items.push({
      key: `source:${record.type}:${record.id}:${due}`,
      kind: "source-deadline",
      source: { type: record.type, id: record.id },
      subject: { type: record.type, id: record.id },
      title: record.title,
      ownerIds: firstOwners(record),
      dueOn: due,
      state,
      priority: workPriority(state, due, options.asOf),
      scope: workScope(record),
      blockingReason: record.status === "blocked"
        ? actionBlockingReason(record, byId)
        : null,
      dependencies: record.status === "blocked"
        ? blockingDependencies(record.blockingResourceIds, byId)
        : [],
      requiredCompletionProfile: sourceCompletionProfile(record),
      nextAction: sourceNextAction(record, due, options.asOf, records)
    });
  }
  return items;
}

export function planWorkQueue(records, obligationPlan, options = {}) {
  const asOf = options.asOf || obligationPlan.asOf;
  const model = options.model || loadModel(obligationPlan.dataModelVersion);
  const program = options.program || resolveProgram({ resources: records, model, workspace: records.find((record) => record.type === "workspace") }, options.programId);
  const excludedSourceIds = new Set(obligationPlan.items.map((item) => item.actionItemId || item.occurrenceId || item.obligationId).filter(Boolean));
  const sourceItems = sourceDeadlineWorkItems(records, { ...options, model, asOf, program, excludedSourceIds })
    .filter((item) => !["canceled", "superseded", "not-applicable"].includes(item.state))
    .filter((item) => !obligationPlan.through || item.dueOn.slice(0, 10) <= obligationPlan.through)
    .map((item) => ({ ...item, status: item.state === "scheduled" ? "upcoming" : item.state,
      notificationContacts: notificationContacts(item.ownerIds, records) }));
  const items = [...obligationPlan.items, ...sourceItems].sort((a, b) => (
    workPriority(a.status, a.dueOn || a.dueWindowEnd, asOf) - workPriority(b.status, b.dueOn || b.dueWindowEnd, asOf)
    || String(a.dueOn || a.dueWindowEnd || "").localeCompare(String(b.dueOn || b.dueWindowEnd || ""))
    || String(a.key).localeCompare(String(b.key))
  ));
  const counts = { overdue: 0, blocked: 0, due: 0, waiting: 0, upcoming: 0, proposed: 0, complete: 0 };
  for (const item of items) if (Object.hasOwn(counts, item.status)) counts[item.status]++;
  return { asOf, through: obligationPlan.through, items, counts };
}

export function actionBlockingReason(record, byId) {
  if (record.status !== "blocked") return null;
  const blockers = (record.blockingResourceIds || [])
    .map((id) => byId.get(id)?.title || id)
    .filter(Boolean);
  return blockers.length
    ? `Blocked by ${blockers.join(", ")}.`
    : "The source record is blocked.";
}
