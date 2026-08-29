import { createHash } from "node:crypto";
import { scaffoldResourceMutation } from "./agent.js";
import { createResourceId } from "./id.js";
import {
  applyResourceBatch,
  createResource,
  createResourceAndLink,
  createResources,
  INTERNAL_WORKFLOW_CAPABILITIES,
  updateResource
} from "./files.js";
import { loadModel, modelSupports } from "../model/index.js";
import { coverageEnd, coverageStart } from "./coverage.js";
import {
  addCalendarDays,
  calendarDayDifference,
  calendarOccurrence,
  calendarOccurrenceIndex,
  nextCalendarOccurrence,
  parseCalendarDate,
  validCalendarRecurrence
} from "./recurrence.js";
import { currentCalendarDate, isRfc3339Timestamp, localDateTimeValue, timestampFromLocalDateTime } from "./time.js";
import { loadWorkspace } from "./workspace.js";
import { obligationGovernedContent, obligationProgramStatus } from "./program-lifecycle.js";
import { resolveProgram } from "./program.js";
import { currentPartyPeople } from "./parties.js";
import { serializeWorkspaceMutation } from "./mutation.js";
import { collectionReviewRevision, historicalCollectionReviewSnapshot } from "./collection-review-integrity.js";
import { bindAttestationReportingRouteSet, reportingRouteRevision } from "./reporting-route-integrity.js";
import { selectScopedCollectionRecords } from "./collection-scope.js";

const COMPLETION_DATE_FIELDS = [
  "completedOn",
  "performedOn",
  "reviewedOn",
  "occurredOn",
  "collectedOn",
  "verifiedOn",
  "approvedOn",
  "submittedOn",
  "closedOn",
  "reportDate"
];
const COMPLETION_TIMESTAMP_FIELDS = [
  "completedAt",
  "endedAt",
  "closedAt",
  "provisionedOn",
  "deprovisionedOn"
];
const MAX_PLANNED_ITEMS = 10_000;
const SCAFFOLDED_COMPLETION_TYPES = new Set([
  "access-review", "attestation", "backup-test", "control-activity", "control-test",
  "evidence", "exercise", "meeting", "penetration-test", "policy-review",
  "risk-assessment", "vendor-review", "vulnerability-scan"
]);

export function planObligations(resources, options = {}) {
  const records = resources.map((item) => item?.record ?? item).filter(Boolean);
  const workspace = records.find((record) => record.type === "workspace");
  const programs = records.filter((record) => record.type === "program" && record.status !== "retired");
  const legacyProgram = programs.length === 0 && workspace && (!options.programId || options.programId === workspace.id)
    ? workspace
    : null;
  const program = programs.find(({ id }) => id === options.programId) || (programs.length === 1 ? programs[0] : legacyProgram);
  if (
    options.programId
    && !programs.some(({ id }) => id === options.programId)
    && options.programId !== legacyProgram?.id
    && !(options.programId === "program-unconfigured" && programs.length === 0)
  ) {
    throw new Error(`Program "${options.programId}" was not found or is retired.`);
  }
  const declaredModelVersion = records.find((record) => record.type === "workspace")?.dataModelVersion;
  const model = options.model || (declaredModelVersion ? loadModel(declaredModelVersion) : null);
  if (!model) {
    throw new Error(
      "Obligation planning requires options.model or a Workspace record with dataModelVersion."
    );
  }
  if (!program && programs.length > 1) {
    throw new Error("Obligation planning requires programId when more than one Program is active.");
  }
  const asOf = requireDate(options.asOf ?? currentCalendarDate(workspace?.timezone || "UTC"), "as-of date");
  const defaultNow = options.asOf
    ? timestampFromLocalDateTime(`${asOf}T23:59:59`, workspace?.timezone || "UTC")
    : new Date().toISOString();
  const now = requireTimestamp(options.now ?? defaultNow, "current timestamp");
  const through = requireDate(options.through ?? addCalendarDays(asOf, 90), "through date");
  const requestedFrom = options.from ? requireDate(options.from, "from date") : null;
  if (through < asOf && !requestedFrom) throw new Error("The through date must not be before the as-of date.");
  if (requestedFrom && through < requestedFrom) throw new Error("The through date must not be before the from date.");
  const byId = new Map(records.map((record) => [record.id, record]));
  const obligationProgram = program && options.additionalControlIds?.length
    ? { ...program, controlIds: [...new Set([...(program.controlIds || []), ...options.additionalControlIds])] }
    : program;
  const obligations = records.filter((record) => (
    record.type === "obligation"
    && ["active", "proposed"].includes(record.status)
    && obligationBelongsToProgram(record, obligationProgram, model)
  ));
  const obligationIds = new Set(obligations.map(({ id }) => id));
  if (obligations.length > MAX_PLANNED_ITEMS) {
    throw new Error(`The obligation query must be narrowed; it includes more than ${MAX_PLANNED_ITEMS.toLocaleString("en-US")} active obligations.`);
  }
  const calendarItems = [];
  const plannedOccurrenceKeys = new Set();
  const triggerGroups = new Map();
  let scannedCalendarOccurrences = 0;
  const scanCalendarWindow = (recurrence, window, index) => {
    if (scannedCalendarOccurrences++ >= MAX_PLANNED_ITEMS) {
      throw new Error(`The obligation query must be narrowed; it scans more than ${MAX_PLANNED_ITEMS.toLocaleString("en-US")} calendar occurrences.`);
    }
    return calendarWindow(recurrence, window, index);
  };

  for (const obligation of obligations) {
    const rule = obligation.scheduleMode === "rule"
      ? obligationRule(obligation, byId, { now, includeProposed: true })
      : null;
    const schedule = rule || obligation;
    const activity = obligationActivity(model, obligation);
    const expectedCompletionTypes = activity.completionResourceTypes;
    const programStatus = obligationProgramStatus(obligation, byId, asOf, model);
    const programBlocker = programStatus === "proposed" ? obligationProgramBlocker(obligation, byId, asOf) : null;
    if (schedule.recurrence?.mode === "event" && schedule.recurrence.eventType) {
      const eventType = schedule.recurrence.eventType;
      const group = triggerGroups.get(eventType) ?? {
        eventType,
        title: model.policyEvents?.[eventType]?.title || humanize(eventType),
        prompt: obligation.triggerPrompt || model.policyEvents?.[eventType]?.title || humanize(eventType),
        policyIds: [],
        obligationIds: [],
        programStatus,
        steps: []
      };
      if (programStatus === "proposed") group.programStatus = "proposed";
      group.policyIds.push(...(obligation.policyIds || []));
      group.obligationIds.push(obligation.id);
      group.steps.push({
        obligationId: obligation.id,
        ruleId: rule?.id || null,
        ruleStatus: rule?.status || null,
        programBlocker,
        title: obligation.title,
        activityType: obligation.activityType,
        ownerIds: obligation.ownerIds || [],
        policyIds: obligation.policyIds || [],
        controlIds: obligation.controlIds || [],
        scopeResourceIds: obligation.scopeResourceIds || [],
        eventRiskLevels: obligation.eventRiskLevels || [],
        templateResourceId: obligation.templateResourceId || null,
        completionResourceTypes: expectedCompletionTypes,
        completionType: preferredCompletionType(activity, obligation, byId),
        completionProfile: activity.completionProfile || null,
        programStatus,
        window: normalizedEventWindow(schedule.window)
      });
      triggerGroups.set(eventType, group);
      continue;
    }

    const configuredAnchor = schedule.recurrence?.anchorDate || schedule.startsOn;
    const activationDate = obligationActivationDate(obligation, byId, rule || model, workspace?.timezone || "UTC");
    const recurrence = {
      ...(schedule.recurrence || {}),
      anchorDate: rule
        ? configuredAnchor || activationDate
        : configuredAnchor && activationDate
          ? [configuredAnchor, activationDate].sort().at(-1)
          : configuredAnchor || activationDate
    };
    if (!validCalendarRecurrence(recurrence)) continue;
    const from = rule
      ? [requestedFrom || recurrence.anchorDate, activationDate].filter(Boolean).sort().at(-1)
      : requestedFrom || recurrence.anchorDate;
    let index = Math.max(0, calendarOccurrenceIndex(recurrence, from));
    while (index > 0) {
      const previousWindow = scanCalendarWindow(recurrence, schedule.window, index);
      if (!previousWindow || previousWindow.overdueOn <= from) break;
      index -= 1;
    }
    for (; ; index += 1) {
      const window = scanCalendarWindow(recurrence, schedule.window, index);
      if (!window || window.dueWindowStart > through) break;
      if (schedule.endsOn && window.dueWindowStart > schedule.endsOn) break;
      if (rule && activationDate && window.dueWindowStart < activationDate) continue;
      if (window.overdueOn <= from) continue;
      const occurrenceKey = `${program?.id || workspace?.id || "workspace"}:${obligation.id}:${window.dueWindowStart}`;
      const reconciliation = currentOccurrence(records, occurrenceKey, obligation.id, rule?.id, window);
      const legacyCompletions = obligation.scheduleMode !== "rule"
        ? (obligation.completionResourceIds || [])
          .map((id) => byId.get(id))
          .filter((record) => (
            record
            && completionFallsInWindow(record, window, workspace?.timezone || "UTC")
            && completionTypeMatches(record, expectedCompletionTypes)
          ))
        : [];
      const completionResourceIds = reconciliation
        ? [...new Set((reconciliation.members || []).flatMap((member) => member.completionResourceIds || []))]
        : legacyCompletions.map((record) => record.id);
      const membershipFinal = membershipIsFinal(schedule.selector, window, asOf);
      const selectedMemberIds = schedule.selector
        ? selectScopedCollectionRecords({ resources: records, model }, schedule.selector, program).map(({ id }) => id).sort()
        : [...new Set(obligation.scopeResourceIds?.length ? obligation.scopeResourceIds : [workspace?.id].filter(Boolean))];
      const recordedMemberIds = (reconciliation?.members || []).map(({ resourceId }) => resourceId);
      const expectedMemberIds = reconciliation
        ? reconciliation.status === "open" && !membershipFinal
          ? [...new Set([...recordedMemberIds, ...selectedMemberIds])].sort()
          : recordedMemberIds
        : selectedMemberIds;
      const completedMemberIds = new Set((reconciliation?.members || [])
        .filter((member) => member.result === "passed" && member.disposition === "expected")
        .map((member) => member.resourceId));
      const successful = reconciliation
        ? reconciliation.status === "reconciled" && ["complete", "complete-with-exceptions", "zero-population"].includes(reconciliation.conclusion)
        : legacyCompletions.length > 0;
      const timingStatus = occurrenceStatus(window, asOf, successful);
      const status = timingStatus === "complete" || programStatus === "accepted" ? timingStatus : "proposed";
      if (status === "complete" && !options.includeComplete) continue;
      if (calendarItems.length >= MAX_PLANNED_ITEMS) {
        throw new Error(`The obligation query must be narrowed with a later from date; it exceeds ${MAX_PLANNED_ITEMS.toLocaleString("en-US")} calendar occurrences.`);
      }
      calendarItems.push({
        key: `${obligation.id}:${window.dueWindowStart}`,
        kind: "calendar",
        obligationId: obligation.id,
        ruleId: rule?.id || null,
        ruleStatus: rule?.status || null,
        programBlocker,
        occurrenceKey,
        occurrenceId: reconciliation?.id || null,
        title: obligation.title,
        activityType: obligation.activityType,
        ownerIds: obligation.ownerIds || [],
        policyIds: obligation.policyIds || [],
        controlIds: obligation.controlIds || [],
        scopeResourceIds: obligation.scopeResourceIds || [],
        completionResourceTypes: expectedCompletionTypes,
        completionType: preferredCompletionType(activity, obligation, byId),
        completionProfile: activity.completionProfile || null,
        completionResourceIds,
        expectedMemberIds,
        completedMemberIds: [...completedMemberIds],
        expectedCount: reconciliation?.status === "open" && !membershipFinal
          ? expectedMemberIds.length
          : reconciliation?.expectedCount ?? expectedMemberIds.length,
        completedCount: reconciliation?.completedCount ?? completedMemberIds.size,
        membershipFinal,
        reconciliationStatus: reconciliation?.status || "unreconciled",
        operatingResult: reconciliation?.conclusion || null,
        legacySchedule: obligation.scheduleMode !== "rule",
        status,
        timingStatus,
        programStatus,
        ...window,
        ...relativeTiming(window, asOf)
      });
      plannedOccurrenceKeys.add(occurrenceKey);
    }
  }

  for (const occurrence of records.filter((record) => (
    record.type === "obligation-occurrence"
    && record.status !== "superseded"
    && (!program?.id || !record.programId || record.programId === program.id)
  ))) {
    if (plannedOccurrenceKeys.has(occurrence.occurrenceKey)) continue;
    const obligation = byId.get(occurrence.obligationId);
    const rule = byId.get(occurrence.ruleId);
    if (obligation?.type !== "obligation" || rule?.type !== "obligation-rule") continue;
    const dueWindowStart = coverageStart(occurrence.coverage);
    const dueWindowEnd = coverageEnd(occurrence.coverage);
    if (!dueWindowStart || !dueWindowEnd || dueWindowStart > through) continue;
    const overdueOn = addCalendarDays(dueWindowEnd, 1);
    const window = { dueWindowStart, dueWindowEnd, overdueOn };
    const programStatus = obligationProgramStatus(obligation, byId, asOf, model);
    const programBlocker = programStatus === "proposed" ? obligationProgramBlocker(obligation, byId, asOf) : null;
    const activity = obligationActivity(model, obligation);
    const completedMemberIds = (occurrence.members || [])
      .filter(({ disposition, result }) => disposition === "expected" && result === "passed")
      .map(({ resourceId }) => resourceId);
    const successful = occurrence.status === "reconciled"
      && ["complete", "complete-with-exceptions", "zero-population"].includes(occurrence.conclusion);
    const timingStatus = occurrenceStatus(window, asOf, successful);
    if (timingStatus === "complete" && !options.includeComplete) continue;
    calendarItems.push({
      key: `${obligation.id}:${dueWindowStart}`,
      kind: "calendar",
      obligationId: obligation.id,
      ruleId: rule.id,
      ruleStatus: rule.status,
      programBlocker,
      occurrenceKey: occurrence.occurrenceKey,
      occurrenceId: occurrence.id,
      title: obligation.title,
      activityType: obligation.activityType,
      ownerIds: obligation.ownerIds || [],
      policyIds: obligation.policyIds || [],
      controlIds: obligation.controlIds || [],
      scopeResourceIds: obligation.scopeResourceIds || [],
      completionResourceTypes: activity.completionResourceTypes,
      completionType: preferredCompletionType(activity, obligation, byId),
      completionProfile: activity.completionProfile || null,
      completionResourceIds: [...new Set((occurrence.members || []).flatMap(({ completionResourceIds = [] }) => completionResourceIds))],
      expectedMemberIds: (occurrence.members || []).map(({ resourceId }) => resourceId),
      completedMemberIds,
      expectedCount: occurrence.expectedCount,
      completedCount: occurrence.completedCount,
      membershipFinal: true,
      reconciliationStatus: occurrence.status,
      operatingResult: occurrence.conclusion || null,
      legacySchedule: false,
      // A frozen open occurrence remains actionable even if the current
      // program or its replacement rule later stops accepting new windows.
      status: timingStatus,
      timingStatus,
      programStatus,
      ...window,
      ...relativeTiming(window, asOf)
    });
  }

  const events = records.filter((record) => record.type === "obligation-event");
  if (events.length > MAX_PLANNED_ITEMS) {
    throw new Error(`The obligation query must be narrowed; it includes more than ${MAX_PLANNED_ITEMS.toLocaleString("en-US")} event runs.`);
  }
  const eventIds = new Set(events.map((event) => event.id));
  const actionsBySource = new Map();
  let eventActionCount = 0;
  for (const record of records) {
    if (record.type !== "action-item" || !eventIds.has(record.sourceResourceId) || !obligationIds.has(record.obligationId)) continue;
    if (++eventActionCount > MAX_PLANNED_ITEMS) {
      throw new Error(`The obligation query must be narrowed; it includes more than ${MAX_PLANNED_ITEMS.toLocaleString("en-US")} event actions.`);
    }
    if (!actionsBySource.has(record.sourceResourceId)) actionsBySource.set(record.sourceResourceId, []);
    actionsBySource.get(record.sourceResourceId).push(record);
  }
  const eventRuns = events.map((event) => planEventRun(
    event,
    actionsBySource.get(event.id) || [],
    byId,
    asOf,
    now,
    model
  )).filter((run) => run.actions.length > 0);
  const eventItems = eventRuns
    .filter((run) => run.status !== "canceled")
    .flatMap((run) => run.actions)
    .filter((item) => item.status !== "complete" || options.includeComplete);
  const standaloneItems = records
    .filter((record) => record.type === "action-item" && !eventIds.has(record.sourceResourceId))
    .map((record) => planStandaloneAction(record, byId, asOf, now))
    .filter((item) => workItemBelongsToProgram(item, obligationProgram, byId, model))
    .filter((item) => item.status !== "complete" || options.includeComplete);
  if (calendarItems.length + eventItems.length + standaloneItems.length > MAX_PLANNED_ITEMS) {
    throw new Error(`The obligation query must be narrowed; it exceeds ${MAX_PLANNED_ITEMS.toLocaleString("en-US")} planned items.`);
  }
  const items = [...calendarItems, ...eventItems, ...standaloneItems].sort(comparePlannedItems);
  const counts = { overdue: 0, blocked: 0, due: 0, upcoming: 0, proposed: 0, complete: 0 };
  for (const item of items) {
    if (counts[item.status] !== undefined) counts[item.status] += 1;
  }

  return {
    dataModelVersion: String(model.modelVersion),
    asOf,
    through,
    from: requestedFrom,
    counts,
    items,
    calendarItems,
    eventItems,
    standaloneItems,
    triggers: [...triggerGroups.values()].map((group) => ({
      ...group,
      policyIds: [...new Set(group.policyIds)],
      obligationIds: [...new Set(group.obligationIds)]
    })).sort((a, b) => a.prompt.localeCompare(b.prompt)),
    eventRuns
  };
}

function obligationProgramBlocker(obligation, byId, asOf) {
  if (obligation.status !== "active") {
    return { type: "obligation", id: obligation.id, label: "Activate obligation" };
  }
  if (currentPartyPeople(obligation.ownerIds || [], byId).size === 0) {
    return { type: "obligation", id: obligation.id, label: "Assign current owner" };
  }
  for (const id of obligation.policyIds || []) {
    const policy = byId.get(id);
    if (policy?.type !== "policy" || policy.status !== "active" || !policy.effectiveOn || policy.effectiveOn > asOf) {
      return { type: "policy", id, label: "Activate policy" };
    }
  }
  const controls = (obligation.controlIds || []).map((id) => byId.get(id)).filter(Boolean);
  if (controls.length && !controls.some(({ status }) => status === "implemented")) {
    return { type: "control", id: controls[0].id, label: "Implement control" };
  }
  return { type: "obligation", id: obligation.id, label: "Review prerequisites" };
}

export async function createObligationEvent(input, options) {
  return serializeWorkspaceMutation(input, (root) => createObligationEventUnlocked(root, options));
}

async function createObligationEventUnlocked(input, options) {
  const loaded = await loadWorkspace(input);
  const records = loaded.resources;
  const byId = new Map(records.map((record) => [record.id, record]));
  const program = options?.allPrograms === true ? null : resolveProgram(loaded, options?.programId);
  const eventType = String(options?.eventType || "").trim();
  const occurredAt = options?.occurredAt ? requireTimestamp(options.occurredAt, "event timestamp") : null;
  const timestampDate = timestampCalendarDate(occurredAt, loaded.workspace.timezone);
  const occurredOn = requireDate(
    options?.occurredOn || timestampDate,
    "event date"
  );
  if (timestampDate && options?.occurredOn && occurredOn !== timestampDate) {
    throw new Error(`The event date must match the event timestamp in ${loaded.workspace.timezone}.`);
  }
  const supportsRiskLevel = Boolean(loaded.model.resources["obligation-event"]?.fields?.riskLevel);
  const riskLevel = supportsRiskLevel && eventType === "person-ended"
    ? String(options?.riskLevel || "normal")
    : null;
  if (riskLevel && !["normal", "high"].includes(riskLevel)) {
    throw new Error("A departure risk level must be normal or high.");
  }
  const eventSchedules = new Map();
  const templates = records.filter((record) => {
    if (
      record.type !== "obligation"
      || record.status !== "active"
      || (program && !obligationBelongsToProgram(record, program, loaded.model))
    ) return false;
    const schedule = obligationRule(record, byId, { now: occurredAt || `${occurredOn}T23:59:59Z` }) || record;
    const matches = schedule.recurrence?.mode === "event"
      && schedule.recurrence.eventType === eventType
      && (!Array.isArray(record.eventRiskLevels) || record.eventRiskLevels.includes(riskLevel));
    if (matches) eventSchedules.set(record.id, schedule);
    return matches;
  });
  if (!eventType || templates.length === 0) throw new Error(`No active obligations use event type "${eventType}".`);
  if (templates.some((record) => obligationProgramStatus(record, byId, occurredOn, loaded.model) === "proposed")) {
    throw new Error(`Event type "${eventType}" still has starter proposals. Make every governing Policy and required governed-content record active and effective, then implement at least one linked Control before starting this workflow.`);
  }
  if (templates.some((record) => normalizedEventWindow(eventSchedules.get(record.id)?.window).precision === "timestamp") && !occurredAt) {
    throw new Error(`Event type "${eventType}" has hour-based deadlines and requires an RFC 3339 occurredAt timestamp.`);
  }
  const subjectResourceIds = [...new Set((options.subjectResourceIds || []).map(String).filter(Boolean))];
  const existingIds = records.map((record) => record.id);
  const prompt = templates.find((record) => record.triggerPrompt)?.triggerPrompt || humanize(eventType);
  const title = String(options.title || `${prompt.replace(/\?$/, "")} · ${occurredOn}`).trim();
  const eventId = options.id || createResourceId("obligation-event", title, existingIds);
  if (existingIds.includes(eventId)) throw new Error(`Policy Event "${eventId}" already exists.`);
  existingIds.push(eventId);
  const actions = templates.map((obligation) => {
    const id = createResourceId("action-item", `${eventId} ${obligation.title}`, existingIds);
    existingIds.push(id);
    const schedule = eventSchedules.get(obligation.id) || obligation;
    const window = eventWindow(schedule, occurredOn, occurredAt, loaded.workspace.timezone);
    return {
      id,
      type: "action-item",
      title: obligation.title,
      status: "open",
      assigneeIds: obligation.ownerIds || [],
      sourceResourceId: eventId,
      obligationId: obligation.id,
      ...(schedule.type === "obligation-rule" ? { obligationRuleId: schedule.id } : {}),
      description: eventActionDescription(obligation, eventType, loaded.model),
      completionWindow: storedCompletionWindow(window, loaded.workspace.timezone)
    };
  });
  const event = {
    id: eventId,
    type: "obligation-event",
    title,
    status: "open",
    eventType,
    occurredOn,
    ...(occurredAt ? { occurredAt } : {}),
    ...(riskLevel ? { riskLevel } : {}),
    ...(options.transitionFingerprint && loaded.model.resources["obligation-event"]?.fields?.transitionFingerprint
      ? { transitionFingerprint: String(options.transitionFingerprint) }
      : {}),
    ownerIds: [...new Set(templates.flatMap((record) => record.ownerIds || []))],
    obligationIds: templates.map((record) => record.id),
    ...(subjectResourceIds.length ? { subjectResourceIds } : {})
  };
  await createResources(loaded.root, [event, ...actions]);
  return { event, actions };
}

export async function completeObligationOccurrence(input, options) {
  const loaded = await loadWorkspace(input);
  const obligation = loaded.resources.find((record) => (
    record.type === "obligation" && record.id === options?.obligationId
  ));
  if (!obligation) throw new Error(`Obligation "${options?.obligationId ?? ""}" was not found.`);
  const completionRecord = bindEffectiveReportingRoute(loaded, options?.record);
  assertExpectedCompletionType(obligation, completionRecord, loaded.model);
  assertAttestationCompletionScope(obligation, completionRecord, loaded.resources);
  if (obligation.scheduleMode === "rule") {
    const created = await createResource(loaded.root, completionRecord, { content: options.content });
    return { created: created.record, linked: null };
  }
  return createResourceAndLink(loaded.root, completionRecord, {
    type: "obligation",
    id: obligation.id,
    field: "completionResourceIds",
    expectedRevision: options.expectedRevision
  }, { content: options.content });
}

export async function scaffoldObligationCompletion(input, options = {}) {
  const loaded = await loadWorkspace(input);
  const program = resolveProgram(loaded, options.programId);
  const action = options.actionItemId
    ? loaded.resources.find((record) => record.type === "action-item" && record.id === options.actionItemId)
    : null;
  if (options.actionItemId && !action) {
    throw new Error(`Action item "${options.actionItemId}" was not found.`);
  }
  const obligationId = action?.obligationId || options.obligationId;
  const obligation = loaded.resources.find((record) => (
    record.type === "obligation" && record.id === obligationId
  ));
  if (!obligation) throw new Error(`Obligation "${obligationId ?? ""}" was not found.`);

  const completedOn = requireDate(
    options.completedOn || currentCalendarDate(loaded.workspace.timezone),
    "completion date"
  );
  const item = action
    ? plannedActionForScaffold(loaded, action, completedOn, program.id)
    : plannedOccurrenceForScaffold(loaded, obligation, options.windowStart, completedOn, program.id);
  const activity = obligationActivity(loaded.model, obligation);
  const type = item.completionType || preferredCompletionType(activity, {
    ...obligation,
    subjectResourceIds: item.subjectResourceIds || []
  }, new Map(loaded.resources.map((record) => [record.id, record])));
  if (!type) throw new Error(`Obligation "${obligation.id}" has no configured completion resource type.`);

  const mutation = scaffoldResourceMutation(
    loaded,
    type,
    `${item.title} · ${item.dueWindowStart || completedOn}`
  );
  applyCompletionScaffoldDefaults(mutation.record, {
    loaded,
    item,
    obligation,
    completedOn,
    activity,
    program
  });
  const target = action || obligation;
  const entry = loaded.entries.find(({ record }) => record.type === target.type && record.id === target.id);
  return {
    ...mutation,
    revision: contentRevision(entry?.source || ""),
    scaffold: {
      target: { type: target.type, id: target.id },
      obligationId: obligation.id,
      activityType: obligation.activityType,
      completionResourceType: type,
      completionProfile: activity.completionProfile || null,
      workItemStatus: item.status,
      programStatus: item.programStatus || null,
      requiredFacts: loaded.model.completionProfiles?.[activity.completionProfile]?.requiredFacts || [],
      dueWindowStart: item.dueWindowStart || null,
      dueWindowEnd: item.dueWindowEnd || null,
      instructions: item.status === "proposed" || item.programStatus === "proposed"
        ? "This work is still a proposal. Resolve its governing Policy, Control, owner, and completion profile before recording completion."
        : "Replace every null or empty required value with the actual work performed. Keep the actual completion date and time, actors, result, scope, independent review, and supporting evidence. This revision makes the completed write safe against a stale Work Queue item."
    }
  };
}

export async function scaffoldObligationOccurrence(input, options = {}) {
  const loaded = await loadWorkspace(input);
  if (!modelSupports(loaded.model, "rolled-up-obligations")) {
    throw new Error("Rolled-up occurrence reconciliation requires data model v9.");
  }
  const obligation = loaded.resources.find((record) => (
    record.type === "obligation" && record.id === options.obligationId
  ));
  if (!obligation) throw new Error(`Obligation "${options.obligationId || ""}" was not found.`);
  const program = resolveProgram(loaded, options.programId);
  const windowStart = requireDate(options.windowStart, "occurrence window start");
  const asOf = requireDate(options.asOf || currentCalendarDate(loaded.workspace.timezone), "as-of date");
  const plan = planObligations(loaded.resources, {
    programId: program.id,
    from: windowStart,
    asOf,
    through: windowStart,
    includeComplete: true,
    model: loaded.model
  });
  const item = plan.calendarItems.find((candidate) => (
    candidate.obligationId === obligation.id && candidate.dueWindowStart === windowStart
  ));
  if (!item || !item.ruleId) {
    throw new Error(`No rule-based ${obligation.id} occurrence starts on ${windowStart}.`);
  }
  if (item.programStatus !== "accepted" && !item.occurrenceId) {
    throw new Error(`Obligation "${obligation.id}" is still proposed. Activate its reviewed rule and governing program records first.`);
  }
  const current = item.occurrenceId
    ? loaded.entries.find(({ record }) => record.id === item.occurrenceId)
    : null;
  if (current && current.record.status !== "open" && options.correctFinalized !== true) {
    throw new Error(`Occurrence "${current.record.id}" is finalized. Request a superseding reconciliation to correct it.`);
  }
  const existing = current?.record.status === "open" ? current : null;
  const predecessor = current && !existing ? current : null;
  const rule = loaded.resources.find(({ id }) => id === item.ruleId);
  const cutoff = rule?.selector?.cutoff === "window-end" ? item.dueWindowEnd : item.dueWindowStart;
  let historicalSnapshot = null;
  let historicalReview = null;
  const needsHistoricalReview = (!existing && !predecessor && asOf >= cutoff)
    || (existing && !existing.record.collectionReviewId && asOf > cutoff);
  if (needsHistoricalReview) {
    const candidates = loaded.entries.flatMap((entry) => {
      if (!(entry.record.scopeResourceIds || []).includes(program.id)) return [];
      const snapshot = historicalCollectionReviewSnapshot(
        loaded.root,
        entry.record,
        loaded.model,
        loaded.workspace.timezone,
        rule?.selector?.resourceType,
        cutoff,
        rule?.selector,
        entry.relativePath
      );
      return snapshot ? [{ entry, snapshot }] : [];
    });
    const supersededIds = new Set(candidates.map(({ entry }) => entry.record.supersedesId).filter(Boolean));
    candidates.sort((left, right) => (
      Number(right.entry.record.status === "active") - Number(left.entry.record.status === "active")
      || Number(supersededIds.has(left.entry.record.id)) - Number(supersededIds.has(right.entry.record.id))
      || right.entry.record.reviewedOn.localeCompare(left.entry.record.reviewedOn)
      || right.entry.record.id.localeCompare(left.entry.record.id)
    ));
    historicalReview = candidates[0]?.entry || null;
    historicalSnapshot = candidates[0]?.snapshot || null;
  }
  if (!existing && !predecessor && asOf > cutoff && !historicalReview) {
    throw new Error(
      `The ${cutoff} population can no longer be inferred from the current files. `
      + "Use a temporal Collection Review or reconstruct the population from Git history before creating this occurrence."
    );
  }
  const existingMembers = new Map(((existing || predecessor)?.record.members || []).map((member) => [member.resourceId, member]));
  const activity = obligationActivity(loaded.model, obligation);
  const completionMemberField = activity.aggregate?.completionMemberField;
  const populationIds = existing
    ? item.expectedMemberIds
    : predecessor
      ? predecessor.record.members.map(({ resourceId }) => resourceId)
    : historicalReview
      ? historicalSnapshot.selectedIds
      : item.expectedMemberIds;
  if (existing && historicalSnapshot) {
    const frozenIds = [...existingMembers.keys()].sort();
    const reviewedIds = [...historicalSnapshot.selectedIds].sort();
    if (JSON.stringify(frozenIds) !== JSON.stringify(reviewedIds)) {
      throw new Error(
        `Open occurrence "${existing.record.id}" does not match the committed ${cutoff} Collection Review population. `
        + "Correct the open occurrence before reconciliation."
      );
    }
  }
  const members = populationIds.map((resourceId) => {
    const prior = existingMembers.get(resourceId) || {};
    const matching = loaded.resources.filter((record) => (
      activity.completionResourceTypes.includes(record.type)
      && completionFallsInWindow(record, item, loaded.workspace.timezone)
      && completionMatchesMember(record, completionMemberField, resourceId)
    ));
    const accepted = matching.filter((record) => completionPassesActivity(record, activity));
    return {
      ...prior,
      resourceId,
      disposition: prior.disposition || "expected",
      result: prior.disposition && prior.disposition !== "expected"
        ? prior.result || "pending"
        : accepted.length ? "passed" : matching.length ? "failed" : prior.result || "pending",
      completionResourceIds: [...new Set([
        ...(prior.completionResourceIds || []),
        ...matching.map(({ id }) => id)
      ])]
    };
  });
  const record = {
    ...(existing?.record || {
      id: createResourceId(
        "obligation-occurrence",
        predecessor
          ? `${predecessor.record.id} correction ${asOf}`
          : `${program.id} ${obligation.id} ${windowStart}`,
        loaded.resources.map(({ id }) => id)
      ),
      type: "obligation-occurrence",
      title: `${obligation.title} · ${windowStart}`
    }),
    status: "open",
    programId: program.id,
    obligationId: obligation.id,
    ruleId: item.ruleId,
    occurrenceKey: item.occurrenceKey,
    coverage: { kind: "range", startsOn: item.dueWindowStart, endsOn: item.dueWindowEnd },
    membershipCutoffAt: cutoff,
    ...(historicalReview ? {
      collectionReviewId: historicalReview.record.id,
      collectionReviewCommit: historicalSnapshot.reviewCommit,
      collectionReviewRevision: collectionReviewRevision(historicalReview.record),
      collectionRevision: historicalReview.record.collectionRevision,
      scopeRevision: historicalReview.record.scopeRevision
    } : predecessor ? Object.fromEntries([
      "collectionReviewId",
      "collectionReviewCommit",
      "collectionReviewRevision",
      "collectionRevision",
      "scopeRevision"
    ].filter((field) => predecessor.record[field] !== undefined).map((field) => [field, predecessor.record[field]])) : {}),
    members,
    expectedCount: members.length,
    completedCount: members.filter(({ disposition, result }) => disposition === "expected" && result === "passed").length,
    ...(predecessor ? { supersedesId: predecessor.record.id } : {}),
    ownerIds: obligation.ownerIds || []
  };
  if (predecessor) {
    delete record.conclusion;
    delete record.reviewedByIds;
    delete record.reconciledAt;
  }
  return {
    operation: existing ? "update" : predecessor ? "supersede" : "create",
    record,
    revision: existing || predecessor ? contentRevision((existing || predecessor).source) : null,
    membershipFinal: item.membershipFinal,
    instructions: "Review the frozen population as one occurrence. Link each member's dated completion, exception, or non-applicability decision. Set reconciled status, counts, conclusion, reviewers, and reconciledAt only after membership is final. Use a superseding record to correct a finalized occurrence."
  };
}

export async function saveObligationOccurrence(input, options = {}) {
  return serializeWorkspaceMutation(input, (root) => saveObligationOccurrenceUnlocked(root, options));
}

async function saveObligationOccurrenceUnlocked(input, options) {
  const record = options.record;
  if (record?.type !== "obligation-occurrence") throw new Error("An Obligation occurrence record is required.");
  const loaded = await loadWorkspace(input);
  const program = resolveProgram(loaded, options.programId || record.programId);
  if (record.programId !== program.id) {
    throw new Error(`Occurrence "${record.id}" belongs to Program "${record.programId}", not "${program.id}".`);
  }
  const now = options.now ? new Date(options.now) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error("A valid occurrence save time is required.");
  if (record.reconciledAt && new Date(record.reconciledAt) > now) {
    throw new Error("The occurrence reconciliation time cannot be in the future.");
  }
  const existing = loaded.entries.find(({ record: current }) => current.id === record.id);
  if (existing?.record.programId && existing.record.programId !== program.id) {
    throw new Error(`Existing occurrence "${record.id}" belongs to Program "${existing.record.programId}", not "${program.id}".`);
  }
  if (record.supersedesId) {
    requireMutationRevision(options.expectedRevision, `Obligation occurrence "${record.supersedesId}"`);
    if (existing) throw new Error(`Superseding occurrence "${record.id}" already exists.`);
    const predecessor = loaded.entries.find(({ record: current }) => (
      current.type === "obligation-occurrence" && current.id === record.supersedesId
    ));
    if (!predecessor) throw new Error(`Superseded occurrence "${record.supersedesId}" was not found.`);
    if (predecessor.record.programId !== program.id) {
      throw new Error(`Superseded occurrence "${predecessor.record.id}" belongs to Program "${predecessor.record.programId}", not "${program.id}".`);
    }
    if (predecessor.record.status !== "reconciled") {
      throw new Error(`Occurrence "${predecessor.record.id}" must be reconciled before it can be superseded.`);
    }
    const correction = {
      ...record,
      programId: predecessor.record.programId,
      obligationId: predecessor.record.obligationId,
      ruleId: predecessor.record.ruleId,
      occurrenceKey: predecessor.record.occurrenceKey,
      coverage: predecessor.record.coverage,
      membershipCutoffAt: predecessor.record.membershipCutoffAt
    };
    for (const field of [
      "collectionReviewId",
      "collectionReviewCommit",
      "collectionReviewRevision",
      "collectionRevision",
      "scopeRevision"
    ]) {
      if (predecessor.record[field] === undefined) delete correction[field];
      else correction[field] = predecessor.record[field];
    }
    assertOccurrenceMembersMatch(correction, predecessor.record);
    return applyResourceBatch(input, {
      workflowCapability: INTERNAL_WORKFLOW_CAPABILITIES.obligationOccurrenceSupersession,
      create: [correction],
      update: [{ ...predecessor.record, status: "superseded" }],
      contentUpdates: { [correction.id]: options.content || {} },
      expectedRevisions: { [predecessor.record.id]: options.expectedRevision }
    });
  }
  const windowStart = record.coverage?.kind === "range" ? record.coverage.startsOn : record.coverage?.on;
  const scaffold = await scaffoldObligationOccurrence(input, {
    obligationId: record.obligationId,
    programId: record.programId,
    windowStart,
    asOf: currentCalendarDate(loaded.workspace.timezone, now)
  });
  assertOccurrenceDerivedFields(record, scaffold.record);
  assertOccurrenceMembersMatch(record, scaffold.record);
  if (record.status === "reconciled" && !scaffold.membershipFinal) {
    throw new Error(`Occurrence "${record.id}" cannot be reconciled until its membership cutoff is final.`);
  }
  if (existing) requireMutationRevision(options.expectedRevision, `Obligation occurrence "${record.id}"`);
  return existing
    ? updateResource(input, "obligation-occurrence", record.id, record, {
        workflowCapability: INTERNAL_WORKFLOW_CAPABILITIES.obligationOccurrenceReconciliation,
        expectedRevision: options.expectedRevision,
        content: options.content
      })
    : createResource(input, record, {
        workflowCapability: INTERNAL_WORKFLOW_CAPABILITIES.obligationOccurrenceReconciliation,
        content: options.content
      });
}

function assertOccurrenceDerivedFields(record, scaffold) {
  const fields = [
    "id",
    "type",
    "programId",
    "obligationId",
    "ruleId",
    "occurrenceKey",
    "coverage",
    "membershipCutoffAt",
    "collectionReviewId",
    "collectionReviewCommit",
    "collectionReviewRevision",
    "collectionRevision",
    "scopeRevision",
    "ownerIds"
  ];
  if (fields.some((field) => JSON.stringify(record[field]) !== JSON.stringify(scaffold[field]))) {
    throw new Error("The Obligation occurrence identity, coverage, cutoff, or source population changed. Scaffold it again.");
  }
}

function assertOccurrenceMembersMatch(record, scaffold) {
  const memberIds = (record.members || []).map(({ resourceId }) => resourceId);
  const scaffoldMemberIds = (scaffold.members || []).map(({ resourceId }) => resourceId);
  if (JSON.stringify(memberIds) !== JSON.stringify(scaffoldMemberIds)) {
    throw new Error("The Obligation occurrence population changed. Scaffold it again before saving.");
  }
}

function requireMutationRevision(revision, target) {
  if (typeof revision !== "string" || revision.length === 0) {
    throw new Error(`A revision is required when changing ${target}. Reload the resource and try again.`);
  }
}

export async function scaffoldObligationRuleActivation(input, options = {}) {
  const loaded = await loadWorkspace(input);
  if (!modelSupports(loaded.model, "rolled-up-obligations")) {
    throw new Error("Obligation rule activation requires data model v9.");
  }
  const ruleEntry = loaded.entries.find(({ record }) => (
    record.type === "obligation-rule" && record.id === options.ruleId
  ));
  if (!ruleEntry) throw new Error(`Obligation rule "${options.ruleId || ""}" was not found.`);
  if (!["proposed", "approved"].includes(ruleEntry.record.status)) {
    throw new Error(`Obligation rule "${ruleEntry.record.id}" is already ${ruleEntry.record.status}.`);
  }
  const obligationEntry = loaded.entries.find(({ record }) => (
    record.type === "obligation" && record.id === ruleEntry.record.obligationId
  ));
  if (!obligationEntry) throw new Error(`Obligation "${ruleEntry.record.obligationId}" was not found.`);
  const priorEntry = obligationEntry.record.activeRuleId && obligationEntry.record.activeRuleId !== ruleEntry.record.id
    ? loaded.entries.find(({ record }) => record.id === obligationEntry.record.activeRuleId)
    : null;
  const openOccurrenceEntries = priorEntry
    ? loaded.entries.filter(({ record }) => (
        record.type === "obligation-occurrence"
        && record.obligationId === obligationEntry.record.id
        && record.ruleId === priorEntry.record.id
        && record.status === "open"
      ))
    : [];
  const now = options.now ? new Date(options.now) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error("A valid activation time is required.");
  const date = options.approvedOn || currentCalendarDate(loaded.workspace.timezone, now);
  const suggestedInstant = new Date(now.getTime() + 5 * 60 * 1000);
  const effectiveLocal = options.effectiveLocal
    || (options.effectiveAt
      ? localDateTimeValue(options.effectiveAt, loaded.workspace.timezone)
      : localDateTimeValue(suggestedInstant, loaded.workspace.timezone).replace(/:\d{2}$/, ":00"));
  const effectiveAt = options.effectiveLocal
    ? timestampFromLocalDateTime(effectiveLocal, loaded.workspace.timezone)
    : options.effectiveAt || timestampFromLocalDateTime(effectiveLocal, loaded.workspace.timezone);
  const effectiveOn = currentCalendarDate(loaded.workspace.timezone, new Date(effectiveAt));
  const review = {
    revision: contentRevision(ruleEntry.source),
    recurrence: ruleEntry.record.recurrence,
    window: ruleEntry.record.window || null,
    selector: ruleEntry.record.selector || null,
    rationale: ruleEntry.record.rationale,
    sourceResourceIds: ruleEntry.record.sourceResourceIds || [],
    firstAffectedOn: ruleEntry.record.recurrence.mode === "calendar"
      ? nextCalendarOccurrence(ruleEntry.record.recurrence, effectiveOn)
      : null,
    ...(priorEntry ? {
      prior: {
        id: priorEntry.record.id,
        recurrence: priorEntry.record.recurrence,
        window: priorEntry.record.window || null,
        selector: priorEntry.record.selector || null
      }
    } : {})
  };
  return {
    rule: { id: ruleEntry.record.id, title: ruleEntry.record.title },
    obligation: { id: obligationEntry.record.id, title: obligationEntry.record.title },
    priorRule: priorEntry ? { id: priorEntry.record.id, title: priorEntry.record.title } : null,
    openOccurrences: openOccurrenceEntries.map(({ record }) => ({ id: record.id, title: record.title })),
    review,
    payload: {
      ruleId: ruleEntry.record.id,
      confirmedRevision: options.confirmedRevision || null,
      approvedByIds: options.approvedByIds || [],
      approvedOn: date,
      effectiveAt,
      effectiveLocal,
      timezone: options.timezone || loaded.workspace.timezone,
      ...(priorEntry ? { cutoverDecision: options.cutoverDecision || (openOccurrenceEntries.length ? "keep-open-window" : "new-windows-only") } : {}),
      expectedRevisions: {
        [ruleEntry.record.id]: contentRevision(ruleEntry.source),
        [obligationEntry.record.id]: contentRevision(obligationEntry.source),
        ...(priorEntry ? { [priorEntry.record.id]: contentRevision(priorEntry.source) } : {}),
        ...Object.fromEntries(openOccurrenceEntries.map((entry) => [entry.record.id, contentRevision(entry.source)]))
      }
    },
    reviewerCandidates: loaded.resources
      .filter((record) => record.type === "person" && record.status === "active")
      .map(({ id, title }) => ({ id, title }))
  };
}

export async function activateObligationRule(input, options = {}) {
  const scaffold = await scaffoldObligationRuleActivation(input, options);
  if (!(options.approvedByIds || []).length) throw new Error("Select at least one person who approved this rule.");
  if (options.confirmedRevision !== scaffold.review.revision) {
    throw new Error("Confirm the current Obligation rule revision before activation.");
  }
  const loaded = await loadWorkspace(input);
  const approverIds = [...new Set(options.approvedByIds || [])];
  if (approverIds.some((id) => !loaded.resources.some((record) => (
    record.type === "person" && record.id === id && record.status === "active"
  )))) {
    throw new Error("Every Obligation rule approver must be an active Person.");
  }
  const rule = loaded.resources.find((record) => record.id === scaffold.rule.id);
  const obligation = loaded.resources.find((record) => record.id === scaffold.obligation.id);
  const prior = scaffold.priorRule ? loaded.resources.find((record) => record.id === scaffold.priorRule.id) : null;
  const openOccurrences = scaffold.openOccurrences
    .map(({ id }) => loaded.resources.find((record) => record.id === id))
    .filter(Boolean);
  const approvedOn = options.approvedOn || scaffold.payload.approvedOn;
  const effectiveAt = options.effectiveLocal
    ? timestampFromLocalDateTime(options.effectiveLocal, scaffold.payload.timezone)
    : options.effectiveAt || scaffold.payload.effectiveAt;
  const effectiveOn = currentCalendarDate(options.timezone || scaffold.payload.timezone, new Date(effectiveAt));
  const now = options.now ? new Date(options.now) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error("A valid activation time is required.");
  const today = currentCalendarDate(options.timezone || scaffold.payload.timezone, now);
  if (approvedOn > today) throw new Error("The rule approval date cannot be in the future.");
  if (effectiveOn < approvedOn) throw new Error("The rule effective time cannot be before approval.");
  if (new Date(effectiveAt) < now) throw new Error("The rule effective time cannot be in the past.");
  const ruleModeObligation = {
    ...obligation,
    status: "active",
    scheduleMode: "rule",
    ruleIds: [...new Set([...(obligation.ruleIds || []), rule.id])],
    activeRuleId: rule.id
  };
  for (const field of ["recurrence", "window", "startsOn", "endsOn"]) {
    delete ruleModeObligation[field];
  }
  const updates = [
    {
      ...rule,
      status: "active",
      approvedByIds: approverIds,
      approvedOn,
      effectiveAt,
      timezone: options.timezone || scaffold.payload.timezone,
      ...(prior ? {
        supersedesId: prior.id,
        cutoverDecision: options.cutoverDecision || scaffold.payload.cutoverDecision
      } : {})
    },
    ruleModeObligation
  ];
  const cutoverDecision = options.cutoverDecision || scaffold.payload.cutoverDecision;
  if (prior && openOccurrences.length && cutoverDecision === "new-windows-only") {
    throw new Error("This rule has open occurrences. Keep them open or supersede them at cutover.");
  }
  if (cutoverDecision === "supersede-open-window") {
    updates.push(...openOccurrences.map((record) => ({ ...record, status: "superseded" })));
  }
  if (prior) updates.push({ ...prior, status: "retired", retiredOn: effectiveOn });
  return applyResourceBatch(input, {
    workflowCapability: INTERNAL_WORKFLOW_CAPABILITIES.obligationRuleActivation,
    update: updates,
    expectedRevisions: options.expectedRevisions || scaffold.payload.expectedRevisions
  });
}

function completionPassesActivity(record, activity) {
  const aggregate = activity.aggregate;
  if (!aggregate) return true;
  if (aggregate.passingStatuses?.length && !aggregate.passingStatuses.includes(record.status)) return false;
  if (aggregate.passingResults?.length) {
    const result = record.decision ?? record.outcome ?? record.result;
    if (!aggregate.passingResults.includes(result)) return false;
  }
  return true;
}

function completionMatchesMember(record, field, resourceId) {
  if (!field) return false;
  const value = record[field];
  return Array.isArray(value) ? value.includes(resourceId) : value === resourceId;
}

export async function completeObligationAction(input, options) {
  const loaded = await loadWorkspace(input);
  const action = loaded.resources.find((record) => (
    record.type === "action-item" && record.id === options?.actionItemId
  ));
  if (!action) throw new Error(`Action item "${options?.actionItemId ?? ""}" was not found.`);
  if (!action.obligationId) throw new Error(`Action item "${action.id}" is not linked to an obligation.`);
  if (action.status === "blocked") {
    throw new Error(`Action item "${action.id}" is blocked. Resolve its blockingResourceIds before completing it.`);
  }
  const obligation = loaded.resources.find((record) => (
    record.type === "obligation" && record.id === action.obligationId
  ));
  if (!obligation) throw new Error(`Obligation "${action.obligationId}" was not found.`);
  const completedOn = requireDate(options?.completedOn, "completion date");
  const event = loaded.resources.find((record) => record.type === "obligation-event" && record.id === action.sourceResourceId);
  const completionRecord = bindEffectiveReportingRoute(loaded, options.record);
  assertExpectedCompletionType(obligation, completionRecord, loaded.model);
  assertAttestationCompletionScope(obligation, completionRecord, loaded.resources, event);
  if (event?.occurredOn && completedOn < event.occurredOn) {
    throw new Error("The action completion date cannot be before its policy event date.");
  }
  return createResourceAndLink(loaded.root, completionRecord, {
    type: "action-item",
    id: action.id,
    field: "completionResourceIds",
    expectedRevision: options.expectedRevision,
    patch: {
      status: "done",
      completedOn
    }
  }, { content: options.content });
}

export async function completeObligationEvent(input, options) {
  const loaded = await loadWorkspace(input);
  const event = loaded.resources.find((record) => (
    record.type === "obligation-event" && record.id === options?.eventId
  ));
  if (!event) throw new Error(`Policy Event "${options?.eventId ?? ""}" was not found.`);
  const completedOn = requireDate(options?.completedOn, "completion date");
  if (completedOn < event.occurredOn) {
    throw new Error("The event completion date cannot be before its occurrence date.");
  }
  resolveProgram(loaded, options.programId);
  const actions = loaded.resources.filter((record) => (
    record.type === "action-item" && record.sourceResourceId === event.id
  ));
  if (actions.length === 0) {
    throw new Error(`Policy Event "${event.id}" has no action checklist.`);
  }
  const incomplete = actions.filter((action) => !["done", "canceled"].includes(action.status));
  if (incomplete.length) {
    throw new Error(
      `Policy Event "${event.id}" still has incomplete actions across its Programs: ${incomplete.map((action) => action.id).join(", ")}.`
    );
  }
  return updateResource(loaded.root, "obligation-event", event.id, {
    ...event,
    status: "complete",
    completedOn
  }, {
    expectedRevision: options.expectedRevision
  });
}

function assertExpectedCompletionType(obligation, record, model) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("A completion resource record is required.");
  }
  const expected = obligationActivity(model, obligation).completionResourceTypes;
  if (expected.length && !expected.includes(record.type)) {
    throw new Error(
      `Obligation "${obligation.id}" expects a completion resource of type ${expected.join(" or ")}, not "${record.type ?? ""}".`
    );
  }
}

function assertAttestationCompletionScope(obligation, record, resources, event = null) {
  if (record?.type !== "attestation") return;
  const byId = new Map(resources.map((candidate) => [candidate.id, candidate]));
  const eventPeople = (event?.subjectResourceIds || []).filter((id) => byId.get(id)?.type === "person");
  const expectedPeople = eventPeople.length
    ? eventPeople
    : (obligation.scopeResourceIds || []).filter((id) => byId.get(id)?.type === "person");
  if (expectedPeople.length && !expectedPeople.includes(record.personId)) {
    throw new Error(`Attestation personId must name the Person in scope for Obligation "${obligation.id}".`);
  }
  const primarySubjects = [obligation.templateResourceId, ...(obligation.scopeResourceIds || [])]
    .filter((id) => ["policy", "document", "training", "action-item"].includes(byId.get(id)?.type));
  const allowedSubjects = new Set(primarySubjects.length ? primarySubjects : obligation.policyIds || []);
  const actualSubjects = new Set(record.subjectResourceIds || []);
  if (
    actualSubjects.size !== allowedSubjects.size
    || [...actualSubjects].some((id) => !allowedSubjects.has(id))
  ) {
    throw new Error(`Attestation subjects must name the exact authored content in scope for Obligation "${obligation.id}".`);
  }
}

function plannedOccurrenceForScaffold(loaded, obligation, windowStart, completedOn, programId) {
  const start = requireDate(windowStart, "occurrence window start");
  const plan = planObligations(loaded.resources, {
    programId,
    from: start,
    asOf: completedOn,
    through: start,
    includeComplete: true,
    model: loaded.model
  });
  const item = plan.calendarItems.find((candidate) => (
    candidate.obligationId === obligation.id && candidate.dueWindowStart === start
  ));
  if (!item) {
    throw new Error(`No ${obligation.id} occurrence starts on ${start}. Run filegrc obligations --json and use its dueWindowStart.`);
  }
  return item;
}

function plannedActionForScaffold(loaded, action, completedOn, programId) {
  const plan = planObligations(loaded.resources, {
    programId,
    asOf: completedOn,
    through: completedOn,
    includeComplete: true,
    model: loaded.model
  });
  const item = plan.eventItems.find((candidate) => candidate.actionItemId === action.id);
  if (!item) throw new Error(`Action item "${action.id}" is not an active Work Queue item.`);
  return item;
}

function applyCompletionScaffoldDefaults(record, context) {
  const { loaded, item, obligation, completedOn, activity, program } = context;
  const byId = new Map(loaded.resources.map((candidate) => [candidate.id, candidate]));
  const responsiblePeople = currentPeopleForParties(loaded.resources, item.ownerIds || []);
  if (!responsiblePeople.length) {
    throw new Error(`Obligation "${obligation.id}" needs an active owner whose Appointment or Team resolves to a current Person.`);
  }
  const reviewer = loaded.resources.find((candidate) => (
    candidate.type === "person"
    && ["active", "external"].includes(candidate.status)
    && !responsiblePeople.includes(candidate.id)
  ));
  const reviewerIds = reviewer ? [reviewer.id] : [];
  const systemIds = loaded.resources
    .filter((candidate) => (
      candidate.type === "system"
      && candidate.status !== "retired"
      && (program.systemIds || []).includes(candidate.id)
    ))
    .map(({ id }) => id);
  const vendorIds = loaded.resources
    .filter((candidate) => candidate.type === "vendor" && candidate.status !== "terminated")
    .map(({ id }) => id);
  const timestamp = completedOn === new Date().toISOString().slice(0, 10)
    ? new Date().toISOString()
    : null;
  const coverage = {
    kind: "range",
    startsOn: item.dueWindowStart || completedOn,
    endsOn: item.dueWindowEnd || completedOn
  };
  const common = { status: "complete" };
  const defaults = {
    meeting: () => {
      const team = completionTeam(loaded.resources, item.ownerIds || []);
      if (!team) throw new Error("A Meeting completion needs an active Team with an active chair.");
      return {
        ...common,
        teamId: team.id,
        chairIds: currentPeopleForParties(loaded.resources, team.chairIds || []),
        scheduledFor: completedOn,
        startedAt: timestamp,
        endedAt: timestamp,
        attendeeIds: responsiblePeople
      };
    },
    "policy-review": () => ({
      ...common,
      scopeResourceIds: obligation.scopeResourceIds || [],
      reviewerIds,
      completedOn,
      outcome: "passed",
      changesRequired: false,
      evidenceIds: [],
      coverage
    }),
    "risk-assessment": () => ({
      ...common,
      completedOn,
      assessmentKind: "enterprise-risk",
      scope: "In-scope SOC 2 systems and dependencies",
      assessorIds: responsiblePeople,
      reviewerIds,
      methodology: program.riskMethodology?.method || "Documented risk methodology",
      summary: "",
      evidenceIds: [],
      approvedOn: completedOn
    }),
    attestation: () => {
      const personId = (item.subjectResourceIds || []).find((id) => byId.get(id)?.type === "person")
        || (obligation.scopeResourceIds || []).find((id) => byId.get(id)?.type === "person");
      const primarySubjectIds = [...new Set([
        obligation.templateResourceId,
        ...(obligation.scopeResourceIds || [])
      ].filter((id) => ["policy", "document", "training", "action-item"].includes(byId.get(id)?.type)))];
      const subjectResourceIds = primarySubjectIds.length ? primarySubjectIds : [...(obligation.policyIds || [])];
      if (!personId) throw new Error("An Attestation completion needs the Person who made the acknowledgement or completed the training.");
      if (!subjectResourceIds.length) throw new Error("An Attestation completion needs the exact Policy, Document, Training, or Action Item content acknowledged.");
      return {
        status: "completed",
        ...(loaded.model.resources.attestation?.fields?.programId ? { programId: program.id } : {}),
        subjectResourceIds,
        personId,
        attestationKind: obligation.activityType || "completion",
        assignedOn: item.dueWindowStart || completedOn,
        dueOn: item.dueWindowEnd || completedOn,
        completedOn,
        attestationMethod: "git-approval"
      };
    },
    "access-review": () => {
      if (!systemIds.length) throw new Error("An Access Review completion needs an active in-scope System.");
      return {
        ...common,
        completedOn,
        reviewerIds: responsiblePeople,
        systemIds,
        scope: "Privileged, production, and important-system access",
        outcome: "passed",
        evidenceIds: [],
        approvedByIds: reviewerIds,
        approvedOn: completedOn,
        coverage
      };
    },
    "vulnerability-scan": () => ({
      ...common,
      scanKind: "vulnerability",
      scope: "In-scope systems",
      operatorIds: responsiblePeople,
      scheduledFor: completedOn,
      completedAt: timestamp,
      systemIds,
      resultSummary: "",
      evidenceIds: [],
      reviewerIds,
      reviewedOn: completedOn
    }),
    "penetration-test": () => ({
      ...common,
      testKind: "independent",
      scope: "In-scope systems and service boundary",
      coverage: { kind: "as-of", on: completedOn },
      ownerIds: responsiblePeople,
      outcome: "passed",
      evidenceIds: [],
      systemIds,
      completedOn,
      reviewerIds,
      reviewedOn: completedOn
    }),
    "control-test": () => ({
      ...common,
      controlId: obligation.controlIds?.[0] || null,
      testKinds: [obligation.activityType || "control-operation"],
      performedBy: "management",
      testerIds: responsiblePeople,
      reviewerIds,
      completedOn,
      reviewedOn: completedOn,
      outcome: "passed",
      evidenceIds: [],
      coverage
    }),
    "control-activity": () => {
      const allowedScopeTypes = new Set(
        loaded.model.resources["control-activity"].fields.scopeResourceIds.relation || []
      );
      const requestedScopeIds = item.subjectResourceIds || item.scopeResourceIds || obligation.scopeResourceIds || [];
      const validScopeIds = requestedScopeIds.filter((id) => allowedScopeTypes.has(byId.get(id)?.type));
      const fallbackScopeIds = systemIds.length
        ? systemIds
        : (item.controlIds || obligation.controlIds || []).filter((id) => allowedScopeTypes.has(byId.get(id)?.type));
      return {
        ...common,
        profileId: activity.completionProfile || obligation.activityType,
        obligationId: obligation.id,
        controlIds: item.controlIds || obligation.controlIds || [],
        scopeResourceIds: validScopeIds.length
          ? validScopeIds
          : fallbackScopeIds.length ? fallbackScopeIds : [loaded.workspace.id],
        performerIds: responsiblePeople,
        completedAt: timestamp,
        method: "",
        result: "",
        reviewerIds,
        reviewedOn: completedOn,
        ownerIds: item.ownerIds || obligation.ownerIds || []
      };
    },
    exercise: () => ({
      ...common,
      exerciseKind: item.title.toLowerCase().includes("continuity") ? "business-continuity" : "incident-response",
      scheduledFor: completedOn,
      facilitatorIds: responsiblePeople,
      objective: item.title,
      outcome: "passed",
      evidenceIds: [],
      systemIds,
      completedAt: timestamp
    }),
    "backup-test": () => {
      if (!systemIds.length) throw new Error("A Backup Test completion needs an active in-scope System.");
      return {
        ...common,
        systemIds,
        scheduledFor: completedOn,
        operatorIds: responsiblePeople,
        reviewerIds,
        outcome: "passed",
        evidenceIds: [],
        completedAt: timestamp
      };
    },
    "vendor-review": () => {
      const subjectVendor = (item.subjectResourceIds || []).find((id) => vendorIds.includes(id));
      if (!subjectVendor && !vendorIds.length) throw new Error("A Vendor Review completion needs an active Vendor.");
      return {
        ...common,
        vendorId: subjectVendor || vendorIds[0],
        reviewerIds: responsiblePeople,
        completedOn,
        decision: "approved",
        evidenceIds: [],
        coverage
      };
    }
  };
  const values = defaults[record.type]?.() || {
    status: "collected",
    artifactKind: "business-record",
    artifactSubtype: obligation.activityType || "control-operation",
    sourceKind: "authored-record",
    sourceDescription: "Internal control operation",
    collectedOn: completedOn,
    collectorIds: responsiblePeople,
    classificationId: defaultClassificationId(loaded),
    coverage,
    controlIds: item.controlIds || obligation.controlIds || [],
    sourceResourceIds: [obligation.id]
  };
  Object.assign(record, values);
}

function currentPeopleForParties(resources, ids = [], seen = new Set()) {
  const byId = new Map(resources.map((record) => [record.id, record]));
  const people = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const party = byId.get(id);
    if (party?.type === "person" && ["active", "external"].includes(party.status)) people.push(party.id);
    if (party?.type === "team" && party.status === "active") {
      people.push(...currentPeopleForParties(resources, [...(party.memberIds || []), ...(party.chairIds || [])], seen));
    }
    if (party?.type === "appointment" && party.status === "active") {
      people.push(...currentPeopleForParties(resources, [party.holderId], seen));
    }
  }
  return [...new Set(people)];
}

function completionTeam(resources, ownerIds) {
  const owners = new Set(ownerIds);
  const teams = resources.filter((record) => record.type === "team");
  const owned = teams.filter((record) => owners.has(record.id));
  return (owned.length ? owned : teams).find((record) => (
    record.status === "active"
    && currentPeopleForParties(resources, record.chairIds || []).length
  )) || null;
}

function defaultClassificationId(loaded) {
  if (modelSupports(loaded.model, "program-scope")) {
    return loaded.resources.find(({ type, id, status }) => type === "classification" && id === "internal" && status === "active")?.id
      || loaded.resources.find(({ type, status }) => type === "classification" && status === "active")?.id
      || "";
  }
  const definitions = loaded.workspace.classificationDefinitions || {};
  return Object.hasOwn(definitions, "internal") ? "internal" : Object.keys(definitions)[0] || "";
}

function effectiveReportingRoute(loaded, purpose, asOf) {
  const cutoff = timestampFromLocalDateTime(`${asOf}T23:59:59`, loaded.workspace.timezone);
  return loaded.entries
    .filter(({ record }) => (
      record.type === "reporting-route"
      && ["active", "retired"].includes(record.status)
      && record.purpose === purpose
      && record.priority === "primary"
      && new Date(record.effectiveAt) <= new Date(cutoff)
      && (!record.endsAt || new Date(record.endsAt) > new Date(cutoff))
    ))
    .sort((left, right) => right.record.effectiveAt.localeCompare(left.record.effectiveAt))[0] || null;
}

function bindEffectiveReportingRoute(loaded, record) {
  if (
    record?.type !== "attestation"
    || (!loaded.model.resources.attestation?.fields?.reportingRouteId
      && !loaded.model.resources.attestation?.fields?.reportingRouteSetId)
  ) return record;
  const date = record.assignedOn || record.completedOn || currentCalendarDate(loaded.workspace.timezone);
  if (loaded.model.resources.attestation.fields.reportingRouteSetId) {
    return bindAttestationReportingRouteSet(loaded, record);
  }
  const route = effectiveReportingRoute(loaded, "security-reporting", date);
  const bound = { ...record };
  delete bound.reportingRouteId;
  delete bound.reportingRouteRevision;
  if (!route) return bound;
  return {
    ...bound,
    reportingRouteId: route.record.id,
    reportingRouteRevision: reportingRouteRevision(route.record)
  };
}

function contentRevision(source) {
  return createHash("sha256").update(source).digest("hex");
}

function calendarWindow(recurrence, configuredWindow, index) {
  const occurrence = calendarOccurrence(recurrence, index);
  const next = calendarOccurrence(recurrence, index + 1);
  if (!occurrence || !next) return null;
  const startOffset = configuredWindow?.precision === "date" && Number.isInteger(configuredWindow.startsAfter)
    ? configuredWindow.startsAfter
    : 0;
  const dueWindowStart = addCalendarDays(occurrence, startOffset);
  const dueWindowEnd = configuredWindow?.precision === "date" && Number.isInteger(configuredWindow.dueAfter)
    ? addCalendarDays(occurrence, configuredWindow.dueAfter)
    : addCalendarDays(next, -1);
  const overdueOn = dueWindowEnd ? addCalendarDays(dueWindowEnd, 1) : null;
  if (!dueWindowStart || !dueWindowEnd || !overdueOn) return null;
  return {
    dueWindowStart,
    dueWindowEnd,
    overdueOn
  };
}

function eventWindow(obligation, occurredOn, occurredAt, timezone) {
  const configuredWindow = normalizedEventWindow(obligation.window);
  if (configuredWindow.precision === "timestamp" && occurredAt) {
    const startOffset = Number.isInteger(configuredWindow.startsAfter) ? configuredWindow.startsAfter : 0;
    const dueWindowStartAt = addHours(occurredAt, startOffset);
    const dueWindowEndAt = addHours(occurredAt, configuredWindow.dueAfter);
    return {
      dueWindowStart: timestampCalendarDate(dueWindowStartAt, timezone),
      dueWindowEnd: timestampCalendarDate(dueWindowEndAt, timezone),
      overdueOn: timestampCalendarDate(dueWindowEndAt, timezone),
      dueWindowStartAt,
      dueWindowEndAt,
      overdueAt: dueWindowEndAt
    };
  }
  const startOffset = Number.isInteger(configuredWindow.startsAfter) ? configuredWindow.startsAfter : 0;
  const dueWindowStart = addCalendarDays(occurredOn, startOffset);
  const dueWindowEnd = addCalendarDays(occurredOn, configuredWindow.dueAfter);
  const overdueOn = dueWindowEnd ? addCalendarDays(dueWindowEnd, 1) : null;
  if (!dueWindowStart || !dueWindowEnd || !overdueOn) {
    throw new Error("Event deadline dates must fall within the supported calendar range.");
  }
  return {
    dueWindowStart,
    dueWindowEnd,
    overdueOn
  };
}

function planEventRun(event, actionItems, byId, asOf, now, model) {
  const actions = actionItems
    .map((record) => {
      const obligation = byId.get(record.obligationId);
      const expectedCompletionTypes = obligation?.type === "obligation"
        ? obligationActivity(model, obligation).completionResourceTypes
        : [];
      const completionProfile = obligation?.type === "obligation"
        ? obligationActivity(model, obligation).completionProfile || null
        : null;
      const completionType = obligation?.type === "obligation"
        ? preferredCompletionType(obligationActivity(model, obligation), {
            ...obligation,
            subjectResourceIds: event.subjectResourceIds || []
          }, byId)
        : null;
      const completionIds = modelSupports(model, "guided-workflow")
        ? record.completionResourceIds || []
        : [...(record.completionResourceIds || []), ...(record.evidenceIds || [])];
      const linkedCompletionIds = [...new Set(completionIds)];
      const matchingCompletionIds = linkedCompletionIds.filter((id) => completionTypeMatches(byId.get(id), expectedCompletionTypes));
      const completionSatisfied = expectedCompletionTypes.length === 0
        || matchingCompletionIds.length > 0;
      const complete = record.status === "done" && completionSatisfied;
      const window = plannedCompletionWindow(record.completionWindow);
      const lateCompletion = complete && completionWasLate(record, matchingCompletionIds, byId, window);
      const timelinessStatus = !complete || !window.dueWindowEndAt
        ? null
        : matchingCompletionIds.some((id) => completionTimestamp(byId.get(id)))
          ? lateCompletion ? "late" : "on-time"
          : "unknown";
      const timingStatus = complete
        ? "complete"
        : window.overdueAt && new Date(now) > new Date(window.overdueAt)
          ? "overdue"
          : window.dueWindowStartAt && new Date(now) < new Date(window.dueWindowStartAt)
            ? "upcoming"
          : !window.overdueAt && window.overdueOn && window.overdueOn <= asOf
            ? "overdue"
            : window.dueWindowStart <= asOf
              ? "due"
              : "upcoming";
      const status = record.status === "blocked" ? "blocked" : timingStatus;
      return {
        key: record.id,
        kind: "event",
        eventId: event.id,
        actionItemId: record.id,
        obligationId: record.obligationId,
        title: record.title,
        activityType: obligation?.activityType || null,
        ownerIds: record.assigneeIds || [],
        policyIds: obligation?.policyIds || [],
        controlIds: obligation?.controlIds || [],
        subjectResourceIds: event.subjectResourceIds || [],
        scopeResourceIds: obligation?.scopeResourceIds || [],
        templateResourceId: obligation?.templateResourceId || null,
        completionResourceIds: record.completionResourceIds || [],
        evidenceIds: record.evidenceIds || [],
        expectedCompletionTypes,
        completionProfile,
        completionType,
        matchingCompletionIds,
        missingCompletion: record.status === "done" && !completionSatisfied,
        lateCompletion,
        timelinessStatus,
        canceledAction: record.status === "canceled",
        recordedStatus: record.status,
        completedOn: record.completedOn || null,
        blockingResourceIds: record.blockingResourceIds || [],
        blockingReason: actionBlockingReason(record, byId),
        status,
        timingStatus,
        ...window,
        ...relativeTiming(window, asOf),
        ...relativeTimestampTiming(window, now)
      };
    });
  const derivedStatus = event.status === "canceled"
    ? "canceled"
    : actions.length > 0 && actions.every((item) => item.status === "complete")
      ? "complete"
      : actions.some((item) => item.status === "overdue")
        ? "overdue"
        : actions.some((item) => item.status === "blocked")
          ? "blocked"
        : actions.length > 0 && actions.every((item) => item.status === "upcoming")
          ? "upcoming"
          : "due";
  return {
    id: event.id,
    title: event.title,
    eventType: event.eventType,
    occurredOn: event.occurredOn,
    occurredAt: event.occurredAt || null,
    subjectResourceIds: event.subjectResourceIds || [],
    actionItemIds: actions.map((item) => item.actionItemId),
    recordedStatus: event.status,
    status: derivedStatus,
    completeCount: actions.filter((item) => item.status === "complete").length,
    actions
  };
}

function completionWasLate(action, completionIds, byId, window) {
  if (window.dueWindowEndAt) {
    const completedAt = completionIds
      .map((id) => completionTimestamp(byId.get(id)))
      .filter(Boolean)
      .sort()[0];
    if (completedAt) return new Date(completedAt) > new Date(window.dueWindowEndAt);
    return !action.completedOn || action.completedOn >= window.dueWindowEndAt.slice(0, 10);
  }
  return Boolean(window.dueWindowEnd && action.completedOn && action.completedOn > window.dueWindowEnd);
}

function completionTimestamp(record) {
  if (!record) return null;
  return record.completedAt || record.occurredAt || record.collectedAt || record.verifiedAt || null;
}

function preferredCompletionType(activity, item, byId) {
  const primary = activity.completionType;
  const hasPersonSubject = [...(item.subjectResourceIds || []), ...(item.scopeResourceIds || [])]
    .some((id) => byId.get(id)?.type === "person");
  const hasAuthoredSubject = [item.templateResourceId, ...(item.scopeResourceIds || [])]
    .some((id) => ["policy", "document", "training", "action-item"].includes(byId.get(id)?.type))
    || (item.policyIds || []).some((id) => byId.get(id)?.type === "policy");
  if (primary === "attestation" && (!hasPersonSubject || !hasAuthoredSubject) && activity.completionResourceTypes.includes("evidence")) {
    return "evidence";
  }
  if (SCAFFOLDED_COMPLETION_TYPES.has(primary)) return primary;
  if (activity.completionResourceTypes.includes("evidence")) return "evidence";
  return primary;
}

function planStandaloneAction(record, byId, asOf, now) {
  const source = byId.get(record.sourceResourceId);
  const window = plannedCompletionWindow(record.completionWindow);
  const complete = ["done", "canceled"].includes(record.status);
  const timingStatus = complete
    ? "complete"
    : window.overdueAt && new Date(now) > new Date(window.overdueAt)
      ? "overdue"
      : window.dueWindowStartAt && new Date(now) < new Date(window.dueWindowStartAt)
        ? "upcoming"
        : !window.overdueAt && window.overdueOn && window.overdueOn <= asOf
          ? "overdue"
          : window.dueWindowStart && window.dueWindowStart > asOf
            ? "upcoming"
            : "due";
  const status = record.status === "blocked" ? "blocked" : timingStatus;
  return {
    key: record.id,
    kind: "action",
    actionItemId: record.id,
    sourceResourceId: record.sourceResourceId,
    title: record.title,
    ownerIds: record.assigneeIds || [],
    policyIds: source?.policyIds || [],
    controlIds: source?.controlIds || [],
    systemIds: source?.systemIds || [],
    completionResourceIds: record.completionResourceIds || [],
    evidenceIds: record.evidenceIds || [],
    recordedStatus: record.status,
    completedOn: record.completedOn || null,
    blockingResourceIds: record.blockingResourceIds || [],
    blockingReason: actionBlockingReason(record, byId),
    status,
    timingStatus,
    ...window,
    ...relativeTiming(window, asOf),
    ...relativeTimestampTiming(window, now)
  };
}

function actionBlockingReason(record, byId) {
  if (record.status !== "blocked") return null;
  const blockers = (record.blockingResourceIds || []).map((id) => byId.get(id)?.title || id);
  return blockers.length
    ? `Blocked by ${blockers.join(", ")}.`
    : "The Action Item is marked blocked but has no blocking resource.";
}

function storedCompletionWindow(window, timezone) {
  if (window.dueWindowEndAt) {
    return {
      precision: "timestamp",
      startsAt: window.dueWindowStartAt,
      dueAt: window.dueWindowEndAt,
      overdueAt: window.overdueAt || window.dueWindowEndAt,
      timezone
    };
  }
  return {
    precision: "date",
    startsOn: window.dueWindowStart,
    dueOn: window.dueWindowEnd,
    overdueOn: window.overdueOn
  };
}

function plannedCompletionWindow(window) {
  if (window?.precision === "timestamp") {
    return {
      dueWindowStart: timestampCalendarDate(window.startsAt, window.timezone),
      dueWindowEnd: timestampCalendarDate(window.dueAt, window.timezone),
      overdueOn: timestampCalendarDate(window.overdueAt, window.timezone),
      dueWindowStartAt: window.startsAt,
      dueWindowEndAt: window.dueAt,
      overdueAt: window.overdueAt
    };
  }
  return {
    dueWindowStart: window?.startsOn || null,
    dueWindowEnd: window?.dueOn || null,
    overdueOn: window?.overdueOn || null,
    dueWindowStartAt: null,
    dueWindowEndAt: null,
    overdueAt: null
  };
}

function completionFallsInWindow(record, window) {
  const date = completionDate(record);
  return Boolean(date && date >= window.dueWindowStart && date <= window.dueWindowEnd);
}

function normalizedEventWindow(configuredWindow) {
  return configuredWindow && !Array.isArray(configuredWindow) && typeof configuredWindow === "object"
    ? configuredWindow
    : {};
}

function completionTypeMatches(record, expectedTypes = []) {
  return Boolean(record && (expectedTypes.length === 0 || expectedTypes.includes(record.type)));
}

function completionDate(record) {
  const coverageDate = coverageEnd(record.coverage);
  if (parseCalendarDate(coverageDate)) return coverageDate;
  for (const field of COMPLETION_TIMESTAMP_FIELDS) {
    if (isRfc3339Timestamp(record[field])) return record[field].slice(0, 10);
  }
  for (const field of COMPLETION_DATE_FIELDS) {
    if (parseCalendarDate(record[field])) return record[field];
  }
  return null;
}

function occurrenceStatus(window, asOf, complete) {
  if (complete) return "complete";
  if (window.overdueOn <= asOf) return "overdue";
  if (window.dueWindowStart <= asOf) return "due";
  return "upcoming";
}

function obligationActivationDate(obligation, byId, ruleOrModel, timezone = "UTC") {
  if (ruleOrModel?.type === "obligation-rule") {
    return ruleOrModel.effectiveAt
      ? currentCalendarDate(timezone, new Date(ruleOrModel.effectiveAt))
      : null;
  }
  const model = ruleOrModel;
  const policyDates = (obligation.policyIds || [])
    .map((id) => byId.get(id))
    .filter((policy) => policy?.type === "policy")
    .map((policy) => policy.effectiveOn)
    .filter(Boolean);
  const governedContentDates = obligationGovernedContent(obligation, byId, model)
    .map((record) => record.effectiveOn)
    .filter(Boolean);
  return [...policyDates, ...governedContentDates].sort().at(-1) || null;
}

function relativeTiming(window, asOf) {
  return {
    daysUntilStart: window.dueWindowStart > asOf ? calendarDayDifference(asOf, window.dueWindowStart) : 0,
    daysUntilOverdue: window.overdueOn && window.overdueOn > asOf ? calendarDayDifference(asOf, window.overdueOn) : 0,
    daysOverdue: window.overdueOn && window.overdueOn <= asOf ? calendarDayDifference(window.overdueOn, asOf) : 0
  };
}

function relativeTimestampTiming(window, now) {
  const result = {};
  if (window.dueWindowStartAt) {
    const startDifference = new Date(window.dueWindowStartAt) - new Date(now);
    result.hoursUntilStart = startDifference > 0 ? Math.ceil(startDifference / 3_600_000) : 0;
  }
  if (window.overdueAt) {
    const difference = new Date(window.overdueAt) - new Date(now);
    Object.assign(result, {
    hoursUntilOverdue: difference > 0 ? Math.ceil(difference / 3_600_000) : 0,
    hoursOverdue: difference <= 0 ? Math.floor(Math.abs(difference) / 3_600_000) : 0
    });
  }
  return result;
}

function comparePlannedItems(a, b) {
  const rank = { overdue: 0, blocked: 1, due: 2, upcoming: 3, proposed: 4, complete: 5 };
  return (rank[a.status] - rank[b.status])
    || String(a.overdueAt || a.overdueOn || a.dueWindowEndAt || a.dueWindowEnd || a.dueWindowStartAt || a.dueWindowStart)
      .localeCompare(String(b.overdueAt || b.overdueOn || b.dueWindowEndAt || b.dueWindowEnd || b.dueWindowStartAt || b.dueWindowStart))
    || a.title.localeCompare(b.title);
}

function eventActionDescription(obligation, eventType, model) {
  const policy = obligation.policyIds?.length ? ` Policy sources: ${obligation.policyIds.join(", ")}.` : "";
  const scope = obligation.scopeResourceIds?.length ? ` Review scoped resources: ${obligation.scopeResourceIds.join(", ")}.` : "";
  const expected = obligationActivity(model, obligation).completionResourceTypes;
  const completion = expected.length
    ? ` Link completion records of type ${expected.join(", ")} and any evidence before marking this done.`
    : " Link the completion record and evidence before marking this done.";
  return `Triggered by ${eventType}.${policy}${scope}${completion}`;
}

function obligationActivity(model, obligation) {
  const activityType = typeof obligation === "string" ? obligation : obligation?.activityType;
  const activity = model.obligationActivities?.[activityType];
  if (!activity) throw new Error(`Unknown obligation activity type "${activityType ?? ""}".`);
  if (activityType !== "custom") return activity;
  return {
    ...activity,
    ...(obligation?.customActivity || {}),
    completionType: obligation?.customActivity?.completionResourceTypes?.[0] || activity.completionType
  };
}

export function obligationRule(obligation, byId, options = {}) {
  const proposedId = options.includeProposed
    ? [...(obligation.ruleIds || [])].reverse().find((id) => ["proposed", "approved"].includes(byId.get(id)?.status))
    : null;
  if (obligation?.scheduleMode !== "rule" && !proposedId) return null;
  let rule = byId.get(obligation.activeRuleId || proposedId);
  if (rule?.status === "active" && rule.effectiveAt && options.now && new Date(rule.effectiveAt) > new Date(options.now)) {
    const prior = byId.get(rule.supersedesId);
    return prior?.type === "obligation-rule"
      && prior.obligationId === obligation.id
      && ["active", "retired"].includes(prior.status)
      ? prior
      : null;
  }
  return rule?.type === "obligation-rule"
    && rule.obligationId === obligation.id
    && (rule.status === "active" || (options.includeProposed && ["proposed", "approved"].includes(rule.status)))
    ? rule
    : null;
}

function currentOccurrence(records, occurrenceKey, obligationId, ruleId, window) {
  return records.find((record) => (
    record.type === "obligation-occurrence"
    && record.occurrenceKey === occurrenceKey
    && record.obligationId === obligationId
    && record.ruleId === ruleId
    && record.coverage?.kind === "range"
    && record.coverage.startsOn === window.dueWindowStart
    && record.coverage.endsOn === window.dueWindowEnd
    && record.status !== "superseded"
  )) || null;
}

function membershipIsFinal(selector, window, asOf) {
  if (!selector) return true;
  if (selector.cutoff === "window-end") return asOf > window.dueWindowEnd;
  if (["as-of", "event-subject"].includes(selector.membershipMode)) return asOf > window.dueWindowStart;
  return asOf > window.dueWindowEnd;
}

function obligationBelongsToProgram(obligation, program, model) {
  if (!program || !modelSupports(model, "program-scope") || program.type !== "program") return true;
  const controlIds = new Set(program.controlIds || []);
  const policyIds = new Set(program.policyIds || []);
  const scopedIds = new Set([program.id, ...(program.systemIds || [])]);
  const linkedControls = obligation.controlIds || [];
  const linkedPolicies = obligation.policyIds || [];
  const linkedScope = obligation.scopeResourceIds || [];
  if (linkedControls.some((id) => controlIds.has(id))) return true;
  if (linkedPolicies.some((id) => policyIds.has(id))) return true;
  if (linkedScope.some((id) => scopedIds.has(id))) return true;
  return linkedControls.length === 0 && linkedPolicies.length === 0 && linkedScope.length === 0;
}

function workItemBelongsToProgram(item, program, byId, model) {
  if (!program || !modelSupports(model, "program-scope") || program.type !== "program") return true;
  const source = byId.get(item.sourceResourceId);
  if (source?.programId) return source.programId === program.id;
  const controlIds = item.controlIds || [];
  const policyIds = item.policyIds || [];
  if (controlIds.length) return controlIds.some((id) => (program.controlIds || []).includes(id));
  if (policyIds.length) return policyIds.some((id) => (program.policyIds || []).includes(id));
  return true;
}

function requireDate(value, label) {
  if (!parseCalendarDate(value)) throw new Error(`A valid ${label} is required.`);
  return value;
}

function requireTimestamp(value, label) {
  if (!isRfc3339Timestamp(value)) {
    throw new Error(`A valid RFC 3339 ${label} is required.`);
  }
  return value;
}

function addHours(value, hours) {
  const date = new Date(new Date(value).getTime() + hours * 3_600_000);
  if (Number.isNaN(date.valueOf())) throw new Error("Event deadline timestamps must fall within the supported calendar range.");
  const result = date.toISOString();
  if (!isRfc3339Timestamp(result)) throw new Error("Event deadline timestamps must fall within the supported calendar range.");
  return result;
}

function timestampCalendarDate(value, timezone) {
  if (!value) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(value));
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function humanize(value) {
  return String(value).replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
