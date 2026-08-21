import { createHash } from "node:crypto";
import { scaffoldResourceMutation } from "./agent.js";
import { createResourceId } from "./id.js";
import { createResourceAndLink, createResources, updateResource } from "./files.js";
import { loadModel, modelSupports } from "../model/index.js";
import { coverageEnd } from "./coverage.js";
import {
  addCalendarDays,
  calendarDayDifference,
  calendarOccurrence,
  calendarOccurrenceIndex,
  parseCalendarDate,
  validCalendarRecurrence
} from "./recurrence.js";
import { currentCalendarDate, isRfc3339Timestamp } from "./time.js";
import { loadWorkspace } from "./workspace.js";
import { obligationGovernedContent, obligationProgramStatus } from "./program-lifecycle.js";
import { resolveProgram } from "./program.js";

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

export function planObligations(resources, options = {}) {
  const records = resources.map((item) => item?.record ?? item).filter(Boolean);
  const declaredModelVersion = records.find((record) => record.type === "workspace")?.dataModelVersion;
  const model = options.model || (declaredModelVersion ? loadModel(declaredModelVersion) : null);
  if (!model) {
    throw new Error(
      "Obligation planning requires options.model or a Workspace record with dataModelVersion."
    );
  }
  const asOf = requireDate(options.asOf ?? new Date().toISOString().slice(0, 10), "as-of date");
  const defaultNow = options.asOf ? `${asOf}T23:59:59Z` : new Date().toISOString();
  const now = requireTimestamp(options.now ?? defaultNow, "current timestamp");
  const through = requireDate(options.through ?? addCalendarDays(asOf, 90), "through date");
  const requestedFrom = options.from ? requireDate(options.from, "from date") : null;
  if (through < asOf && !requestedFrom) throw new Error("The through date must not be before the as-of date.");
  if (requestedFrom && through < requestedFrom) throw new Error("The through date must not be before the from date.");
  const byId = new Map(records.map((record) => [record.id, record]));
  const obligations = records.filter((record) => (
    record.type === "obligation"
    && ["active", "proposed"].includes(record.status)
  ));
  if (obligations.length > MAX_PLANNED_ITEMS) {
    throw new Error(`The obligation query must be narrowed; it includes more than ${MAX_PLANNED_ITEMS.toLocaleString("en-US")} active obligations.`);
  }
  const calendarItems = [];
  const triggerGroups = new Map();
  let scannedCalendarOccurrences = 0;
  const scanCalendarWindow = (recurrence, window, index) => {
    if (scannedCalendarOccurrences++ >= MAX_PLANNED_ITEMS) {
      throw new Error(`The obligation query must be narrowed; it scans more than ${MAX_PLANNED_ITEMS.toLocaleString("en-US")} calendar occurrences.`);
    }
    return calendarWindow(recurrence, window, index);
  };

  for (const obligation of obligations) {
    const activity = obligationActivity(model, obligation.activityType);
    const expectedCompletionTypes = activity.completionResourceTypes;
    const programStatus = obligationProgramStatus(obligation, byId, asOf, model);
    if (obligation.recurrence?.mode === "event" && obligation.recurrence.eventType) {
      const eventType = obligation.recurrence.eventType;
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
        title: obligation.title,
        activityType: obligation.activityType,
        ownerIds: obligation.ownerIds || [],
        policyIds: obligation.policyIds || [],
        controlIds: obligation.controlIds || [],
        scopeResourceIds: obligation.scopeResourceIds || [],
        eventRiskLevels: obligation.eventRiskLevels || [],
        templateResourceId: obligation.templateResourceId || null,
        completionResourceTypes: expectedCompletionTypes,
        completionType: activity.completionType,
        completionProfile: activity.completionProfile || null,
        programStatus,
        window: normalizedEventWindow(obligation.window)
      });
      triggerGroups.set(eventType, group);
      continue;
    }

    const configuredAnchor = obligation.recurrence?.anchorDate || obligation.startsOn;
    const activationDate = obligationActivationDate(obligation, byId, model);
    const recurrence = {
      ...(obligation.recurrence || {}),
      anchorDate: configuredAnchor && activationDate
        ? [configuredAnchor, activationDate].sort().at(-1)
        : configuredAnchor || activationDate
    };
    if (!validCalendarRecurrence(recurrence)) continue;
    const from = requestedFrom || recurrence.anchorDate;
    let index = Math.max(0, calendarOccurrenceIndex(recurrence, from));
    while (index > 0) {
      const previousWindow = scanCalendarWindow(recurrence, obligation.window, index);
      if (!previousWindow || previousWindow.overdueOn <= from) break;
      index -= 1;
    }
    for (; ; index += 1) {
      const window = scanCalendarWindow(recurrence, obligation.window, index);
      if (!window || window.dueWindowStart > through) break;
      if (obligation.endsOn && window.dueWindowStart > obligation.endsOn) break;
      if (window.overdueOn <= from) continue;
      const completions = (obligation.completionResourceIds || [])
        .map((id) => byId.get(id))
        .filter((record) => (
          record
          && completionFallsInWindow(record, window)
          && completionTypeMatches(record, expectedCompletionTypes)
        ));
      const timingStatus = occurrenceStatus(window, asOf, completions.length > 0);
      const status = timingStatus === "complete" || programStatus === "accepted" ? timingStatus : "proposed";
      if (status === "complete" && !options.includeComplete) continue;
      if (calendarItems.length >= MAX_PLANNED_ITEMS) {
        throw new Error(`The obligation query must be narrowed with a later from date; it exceeds ${MAX_PLANNED_ITEMS.toLocaleString("en-US")} calendar occurrences.`);
      }
      calendarItems.push({
        key: `${obligation.id}:${window.dueWindowStart}`,
        kind: "calendar",
        obligationId: obligation.id,
        title: obligation.title,
        activityType: obligation.activityType,
        ownerIds: obligation.ownerIds || [],
        policyIds: obligation.policyIds || [],
        controlIds: obligation.controlIds || [],
        scopeResourceIds: obligation.scopeResourceIds || [],
        completionResourceTypes: expectedCompletionTypes,
        completionType: activity.completionType,
        completionProfile: activity.completionProfile || null,
        completionResourceIds: completions.map((record) => record.id),
        status,
        timingStatus,
        programStatus,
        ...window,
        ...relativeTiming(window, asOf)
      });
    }
  }

  const events = records.filter((record) => record.type === "obligation-event");
  if (events.length > MAX_PLANNED_ITEMS) {
    throw new Error(`The obligation query must be narrowed; it includes more than ${MAX_PLANNED_ITEMS.toLocaleString("en-US")} event runs.`);
  }
  const eventIds = new Set(events.map((event) => event.id));
  const actionsBySource = new Map();
  let eventActionCount = 0;
  for (const record of records) {
    if (record.type !== "action-item" || !eventIds.has(record.sourceResourceId)) continue;
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
  ));
  const eventItems = eventRuns
    .filter((run) => run.status !== "canceled")
    .flatMap((run) => run.actions)
    .filter((item) => item.status !== "complete" || options.includeComplete);
  const standaloneItems = records
    .filter((record) => record.type === "action-item" && !eventIds.has(record.sourceResourceId))
    .map((record) => planStandaloneAction(record, byId, asOf, now))
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

export async function createObligationEvent(input, options) {
  const loaded = await loadWorkspace(input);
  const records = loaded.resources;
  const byId = new Map(records.map((record) => [record.id, record]));
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
  const templates = records.filter((record) => (
    record.type === "obligation"
    && record.status === "active"
    && record.recurrence?.mode === "event"
    && record.recurrence.eventType === eventType
    && (
      !Array.isArray(record.eventRiskLevels)
      || record.eventRiskLevels.includes(riskLevel)
    )
  ));
  if (!eventType || templates.length === 0) throw new Error(`No active obligations use event type "${eventType}".`);
  if (templates.some((record) => obligationProgramStatus(record, byId, occurredOn, loaded.model) === "proposed")) {
    throw new Error(`Event type "${eventType}" still has starter proposals. Make every governing Policy and required governed-content record active and effective, then implement at least one linked Control before starting this workflow.`);
  }
  if (templates.some((record) => normalizedEventWindow(record.window).precision === "timestamp") && !occurredAt) {
    throw new Error(`Event type "${eventType}" has hour-based deadlines and requires an RFC 3339 occurredAt timestamp.`);
  }
  const subjectResourceIds = [...new Set((options.subjectResourceIds || []).map(String).filter(Boolean))];
  const existingIds = records.map((record) => record.id);
  const prompt = templates.find((record) => record.triggerPrompt)?.triggerPrompt || humanize(eventType);
  const title = String(options.title || `${prompt.replace(/\?$/, "")} · ${occurredOn}`).trim();
  const eventId = createResourceId("obligation-event", title, existingIds);
  existingIds.push(eventId);
  const actions = templates.map((obligation) => {
    const id = createResourceId("action-item", `${eventId} ${obligation.title}`, existingIds);
    existingIds.push(id);
    const window = eventWindow(obligation, occurredOn, occurredAt, loaded.workspace.timezone);
    return {
      id,
      type: "action-item",
      title: obligation.title,
      status: "open",
      assigneeIds: obligation.ownerIds || [],
      sourceResourceId: eventId,
      obligationId: obligation.id,
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
  assertExpectedCompletionType(obligation, options?.record, loaded.model);
  return createResourceAndLink(loaded.root, options.record, {
    type: "obligation",
    id: obligation.id,
    field: "completionResourceIds",
    expectedRevision: options.expectedRevision
  }, { content: options.content });
}

export async function scaffoldObligationCompletion(input, options = {}) {
  const loaded = await loadWorkspace(input);
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
    ? plannedActionForScaffold(loaded, action, completedOn)
    : plannedOccurrenceForScaffold(loaded, obligation, options.windowStart, completedOn);
  const activity = obligationActivity(loaded.model, obligation.activityType);
  const type = activity.completionType;
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
    activity
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
      requiredFacts: loaded.model.completionProfiles?.[activity.completionProfile]?.requiredFacts || [],
      dueWindowStart: item.dueWindowStart || null,
      dueWindowEnd: item.dueWindowEnd || null,
      instructions: "Replace every null or empty required value with the actual work performed. Keep the actual completion date and time, actors, result, scope, independent review, and supporting evidence. This revision makes the completed write safe against a stale Work Queue item."
    }
  };
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
  assertExpectedCompletionType(obligation, options?.record, loaded.model);
  const completedOn = requireDate(options?.completedOn, "completion date");
  const event = loaded.resources.find((record) => record.type === "obligation-event" && record.id === action.sourceResourceId);
  if (event?.occurredOn && completedOn < event.occurredOn) {
    throw new Error("The action completion date cannot be before its policy event date.");
  }
  return createResourceAndLink(loaded.root, options.record, {
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
  const plan = planObligations(loaded.resources, {
    asOf: completedOn,
    through: completedOn,
    includeComplete: true,
    model: loaded.model
  });
  const run = plan.eventRuns.find((item) => item.id === event.id);
  if (!run || run.actions.length === 0) {
    throw new Error(`Policy Event "${event.id}" has no action checklist.`);
  }
  const incomplete = run.actions.filter((action) => action.status !== "complete");
  if (incomplete.length) {
    throw new Error(
      `Policy Event "${event.id}" still has incomplete actions: ${incomplete.map((action) => action.actionItemId).join(", ")}.`
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
  const expected = obligationActivity(model, obligation.activityType).completionResourceTypes;
  if (expected.length && !expected.includes(record.type)) {
    throw new Error(
      `Obligation "${obligation.id}" expects a completion resource of type ${expected.join(" or ")}, not "${record.type ?? ""}".`
    );
  }
}

function plannedOccurrenceForScaffold(loaded, obligation, windowStart, completedOn) {
  const start = requireDate(windowStart, "occurrence window start");
  const plan = planObligations(loaded.resources, {
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

function plannedActionForScaffold(loaded, action, completedOn) {
  const plan = planObligations(loaded.resources, {
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
  const { loaded, item, obligation, completedOn, activity } = context;
  const program = resolveProgram(loaded);
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
    attestation: () => ({
      status: "completed",
      subjectResourceIds: [...new Set([
        obligation.templateResourceId,
        ...(obligation.scopeResourceIds || [])
      ].filter(Boolean))],
      personId: responsiblePeople[0],
      attestationKind: obligation.activityType || "completion",
      assignedOn: item.dueWindowStart || completedOn,
      dueOn: item.dueWindowEnd || completedOn,
      completedOn,
      attestationMethod: "git-approval"
    }),
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
    "control-activity": () => ({
      ...common,
      profileId: activity.completionProfile || obligation.activityType,
      obligationId: obligation.id,
      controlIds: item.controlIds || obligation.controlIds || [],
      scopeResourceIds: (item.scopeResourceIds || obligation.scopeResourceIds || []).length
        ? (item.scopeResourceIds || obligation.scopeResourceIds)
        : [program.id],
      performerIds: responsiblePeople,
      completedAt: timestamp,
      method: "",
      result: "",
      reviewerIds,
      reviewedOn: completedOn,
      ownerIds: item.ownerIds || obligation.ownerIds || []
    }),
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
        ? obligationActivity(model, obligation.activityType).completionResourceTypes
        : [];
      const completionProfile = obligation?.type === "obligation"
        ? obligationActivity(model, obligation.activityType).completionProfile || null
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
        scopeResourceIds: obligation?.scopeResourceIds || [],
        templateResourceId: obligation?.templateResourceId || null,
        completionResourceIds: record.completionResourceIds || [],
        evidenceIds: record.evidenceIds || [],
        expectedCompletionTypes,
        completionProfile,
        matchingCompletionIds,
        missingCompletion: record.status === "done" && !completionSatisfied,
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

function obligationActivationDate(obligation, byId, model) {
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
  const expected = obligationActivity(model, obligation.activityType).completionResourceTypes;
  const completion = expected.length
    ? ` Link completion records of type ${expected.join(", ")} and any evidence before marking this done.`
    : " Link the completion record and evidence before marking this done.";
  return `Triggered by ${eventType}.${policy}${scope}${completion}`;
}

function obligationActivity(model, activityType) {
  const activity = model.obligationActivities?.[activityType];
  if (!activity) throw new Error(`Unknown obligation activity type "${activityType ?? ""}".`);
  return activity;
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
