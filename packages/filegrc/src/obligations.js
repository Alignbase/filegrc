import { createResourceId } from "./id.js";
import { createResourceAndLink, createResources, updateResource } from "./files.js";
import {
  addCalendarDays,
  calendarDayDifference,
  calendarOccurrence,
  calendarOccurrenceIndex,
  parseCalendarDate,
  validCalendarRecurrence
} from "./recurrence.js";
import { isRfc3339Timestamp } from "./time.js";
import { loadWorkspace } from "./workspace.js";

const COMPLETION_DATE_FIELDS = [
  "completedOn",
  "performedOn",
  "reviewedOn",
  "assessmentDate",
  "meetingDate",
  "scheduledOn",
  "occurredOn",
  "collectedOn",
  "verifiedOn",
  "approvedOn",
  "submittedOn",
  "closedOn",
  "reportDate",
  "periodEnd"
];
const MAX_PLANNED_ITEMS = 10_000;
const DEFAULT_EVENT_DEADLINE_DAYS = 30;

export function planObligations(resources, options = {}) {
  const asOf = requireDate(options.asOf ?? new Date().toISOString().slice(0, 10), "as-of date");
  const defaultNow = options.asOf ? `${asOf}T23:59:59Z` : new Date().toISOString();
  const now = requireTimestamp(options.now ?? defaultNow, "current timestamp");
  const through = requireDate(options.through ?? addCalendarDays(asOf, 90), "through date");
  const requestedFrom = options.from ? requireDate(options.from, "from date") : null;
  if (through < asOf && !requestedFrom) throw new Error("The through date must not be before the as-of date.");
  if (requestedFrom && through < requestedFrom) throw new Error("The through date must not be before the from date.");
  const records = resources.map((item) => item?.record ?? item).filter(Boolean);
  const byId = new Map(records.map((record) => [record.id, record]));
  const obligations = records.filter((record) => record.type === "obligation" && record.status === "active");
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
    if (obligation.recurrence?.mode === "event" && obligation.recurrence.eventType) {
      const eventType = obligation.recurrence.eventType;
      const group = triggerGroups.get(eventType) ?? {
        eventType,
        prompt: obligation.triggerPrompt || humanize(eventType),
        policyIds: [],
        obligationIds: [],
        steps: []
      };
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
        templateResourceId: obligation.templateResourceId || null,
        completionResourceTypes: obligation.completionResourceTypes || [],
        window: normalizedEventWindow(obligation.window)
      });
      triggerGroups.set(eventType, group);
      continue;
    }

    const recurrence = {
      ...(obligation.recurrence || {}),
      anchorDate: obligation.recurrence?.anchorDate || obligation.startsOn
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
          && completionTypeMatches(record, obligation.completionResourceTypes)
        ));
      const status = occurrenceStatus(window, asOf, completions.length > 0);
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
        completionResourceIds: completions.map((record) => record.id),
        status,
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
  const eventRuns = events.map((event) => planEventRun(event, actionsBySource.get(event.id) || [], byId, asOf, now));
  const eventItems = eventRuns
    .filter((run) => run.status !== "canceled")
    .flatMap((run) => run.actions)
    .filter((item) => item.status !== "complete" || options.includeComplete);
  if (calendarItems.length + eventItems.length > MAX_PLANNED_ITEMS) {
    throw new Error(`The obligation query must be narrowed; it exceeds ${MAX_PLANNED_ITEMS.toLocaleString("en-US")} planned items.`);
  }
  const items = [...calendarItems, ...eventItems].sort(comparePlannedItems);
  const counts = { overdue: 0, due: 0, upcoming: 0, complete: 0 };
  for (const item of items) {
    if (counts[item.status] !== undefined) counts[item.status] += 1;
  }

  return {
    asOf,
    through,
    from: requestedFrom,
    counts,
    items,
    calendarItems,
    eventItems,
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
  const templates = records.filter((record) => (
    record.type === "obligation"
    && record.status === "active"
    && record.recurrence?.mode === "event"
    && record.recurrence.eventType === eventType
  ));
  if (!eventType || templates.length === 0) throw new Error(`No active obligations use event type "${eventType}".`);
  if (templates.some((record) => Number.isInteger(normalizedEventWindow(record.window).endOffsetHours)) && !occurredAt) {
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
      schemaVersion: 1,
      id,
      type: "action-item",
      title: obligation.title,
      status: "open",
      assigneeIds: obligation.ownerIds || [],
      sourceResourceId: eventId,
      obligationId: obligation.id,
      description: eventActionDescription(obligation, eventType),
      dueWindowStart: window.dueWindowStart,
      ...(window.dueWindowEnd ? { dueWindowEnd: window.dueWindowEnd, dueOn: window.dueWindowEnd } : {}),
      ...(window.overdueOn ? { overdueOn: window.overdueOn } : {}),
      ...(window.dueWindowStartAt ? { dueWindowStartAt: window.dueWindowStartAt } : {}),
      ...(window.dueWindowEndAt ? { dueWindowEndAt: window.dueWindowEndAt, overdueAt: window.dueWindowEndAt } : {})
    };
  });
  const event = {
    schemaVersion: 1,
    id: eventId,
    type: "obligation-event",
    title,
    status: "open",
    eventType,
    occurredOn,
    ...(occurredAt ? { occurredAt } : {}),
    ownerIds: [...new Set(templates.flatMap((record) => record.ownerIds || []))],
    obligationIds: templates.map((record) => record.id),
    actionItemIds: actions.map((record) => record.id),
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
  assertExpectedCompletionType(obligation, options?.record);
  return createResourceAndLink(loaded.root, options.record, {
    type: "obligation",
    id: obligation.id,
    field: "completionResourceIds",
    expectedRevision: options.expectedRevision
  }, { content: options.content });
}

export async function completeObligationAction(input, options) {
  const loaded = await loadWorkspace(input);
  const action = loaded.resources.find((record) => (
    record.type === "action-item" && record.id === options?.actionItemId
  ));
  if (!action) throw new Error(`Action item "${options?.actionItemId ?? ""}" was not found.`);
  if (!action.obligationId) throw new Error(`Action item "${action.id}" is not linked to an obligation.`);
  const obligation = loaded.resources.find((record) => (
    record.type === "obligation" && record.id === action.obligationId
  ));
  if (!obligation) throw new Error(`Obligation "${action.obligationId}" was not found.`);
  assertExpectedCompletionType(obligation, options?.record);
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
  if (!event) throw new Error(`Obligation event "${options?.eventId ?? ""}" was not found.`);
  const completedOn = requireDate(options?.completedOn, "completion date");
  if (completedOn < event.occurredOn) {
    throw new Error("The event completion date cannot be before its occurrence date.");
  }
  const plan = planObligations(loaded.resources, {
    asOf: completedOn,
    through: completedOn,
    includeComplete: true
  });
  const run = plan.eventRuns.find((item) => item.id === event.id);
  if (!run || run.actions.length === 0) {
    throw new Error(`Obligation event "${event.id}" has no action checklist.`);
  }
  const incomplete = run.actions.filter((action) => action.status !== "complete");
  if (incomplete.length) {
    throw new Error(
      `Obligation event "${event.id}" still has incomplete actions: ${incomplete.map((action) => action.actionItemId).join(", ")}.`
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

function assertExpectedCompletionType(obligation, record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("A completion resource record is required.");
  }
  const expected = obligation.completionResourceTypes ?? [];
  if (expected.length && !expected.includes(record.type)) {
    throw new Error(
      `Obligation "${obligation.id}" expects a completion resource of type ${expected.join(" or ")}, not "${record.type ?? ""}".`
    );
  }
}

function calendarWindow(recurrence, configuredWindow, index) {
  const occurrence = calendarOccurrence(recurrence, index);
  const next = calendarOccurrence(recurrence, index + 1);
  if (!occurrence || !next) return null;
  const startOffset = Number.isInteger(configuredWindow?.startOffsetDays) ? configuredWindow.startOffsetDays : 0;
  const dueWindowStart = addCalendarDays(occurrence, startOffset);
  const dueWindowEnd = Number.isInteger(configuredWindow?.endOffsetDays)
    ? addCalendarDays(occurrence, configuredWindow.endOffsetDays)
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
  if (Number.isInteger(configuredWindow.endOffsetHours) && occurredAt) {
    const startOffset = Number.isInteger(configuredWindow.startOffsetHours) ? configuredWindow.startOffsetHours : 0;
    const dueWindowStartAt = addHours(occurredAt, startOffset);
    const dueWindowEndAt = addHours(occurredAt, configuredWindow.endOffsetHours);
    return {
      dueWindowStart: timestampCalendarDate(dueWindowStartAt, timezone),
      dueWindowEnd: timestampCalendarDate(dueWindowEndAt, timezone),
      overdueOn: timestampCalendarDate(dueWindowEndAt, timezone),
      dueWindowStartAt,
      dueWindowEndAt,
      overdueAt: dueWindowEndAt
    };
  }
  const startOffset = Number.isInteger(configuredWindow.startOffsetDays) ? configuredWindow.startOffsetDays : 0;
  const dueWindowStart = addCalendarDays(occurredOn, startOffset);
  const dueWindowEnd = addCalendarDays(occurredOn, configuredWindow.endOffsetDays);
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

function planEventRun(event, actionItems, byId, asOf, now) {
  const actions = actionItems
    .map((record) => {
      const obligation = byId.get(record.obligationId);
      const expectedCompletionTypes = obligation?.completionResourceTypes || [];
      const linkedCompletionIds = [...new Set([
        ...(record.completionResourceIds || []),
        ...(record.evidenceIds || [])
      ])];
      const matchingCompletionIds = linkedCompletionIds.filter((id) => completionTypeMatches(byId.get(id), expectedCompletionTypes));
      const completionSatisfied = expectedCompletionTypes.length === 0
        || matchingCompletionIds.length > 0;
      const complete = record.status === "done" && completionSatisfied;
      const configuredWindow = normalizedEventWindow(obligation?.window);
      const fallbackEndOffsetDays = Number.isInteger(configuredWindow.endOffsetDays)
        ? configuredWindow.endOffsetDays
        : Math.ceil(configuredWindow.endOffsetHours / 24);
      const dueWindowStart = record.dueWindowStart || event.occurredOn;
      const dueWindowEnd = record.dueWindowEnd || record.dueOn || addCalendarDays(event.occurredOn, fallbackEndOffsetDays);
      const dueWindowStartAt = record.dueWindowStartAt
        || (event.occurredAt && Number.isInteger(configuredWindow.startOffsetHours)
          ? addHours(event.occurredAt, configuredWindow.startOffsetHours)
          : null);
      const dueWindowEndAt = record.dueWindowEndAt
        || (event.occurredAt && Number.isInteger(configuredWindow.endOffsetHours)
          ? addHours(event.occurredAt, configuredWindow.endOffsetHours)
          : null);
      const window = {
        dueWindowStart,
        dueWindowEnd,
        overdueOn: record.overdueOn || (dueWindowEnd ? addCalendarDays(dueWindowEnd, 1) : null),
        dueWindowStartAt,
        dueWindowEndAt,
        overdueAt: record.overdueAt || dueWindowEndAt
      };
      const status = complete
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
      return {
        key: record.id,
        kind: "event",
        eventId: event.id,
        actionItemId: record.id,
        obligationId: record.obligationId,
        title: record.title,
        ownerIds: record.assigneeIds || [],
        policyIds: obligation?.policyIds || [],
        controlIds: obligation?.controlIds || [],
        scopeResourceIds: obligation?.scopeResourceIds || [],
        templateResourceId: obligation?.templateResourceId || null,
        completionResourceIds: record.completionResourceIds || [],
        evidenceIds: record.evidenceIds || [],
        expectedCompletionTypes,
        matchingCompletionIds,
        missingCompletion: record.status === "done" && !completionSatisfied,
        canceledAction: record.status === "canceled",
        recordedStatus: record.status,
        completedOn: record.completedOn || null,
        status,
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
    actionItemIds: event.actionItemIds || [],
    recordedStatus: event.status,
    status: derivedStatus,
    completeCount: actions.filter((item) => item.status === "complete").length,
    actions
  };
}

function completionFallsInWindow(record, window) {
  const date = completionDate(record);
  return Boolean(date && date >= window.dueWindowStart && date <= window.dueWindowEnd);
}

function normalizedEventWindow(configuredWindow) {
  const window = configuredWindow && !Array.isArray(configuredWindow) && typeof configuredWindow === "object"
    ? configuredWindow
    : {};
  if (Number.isInteger(window.endOffsetDays) || Number.isInteger(window.endOffsetHours)) return window;
  if (Number.isInteger(window.startOffsetHours)) {
    return {
      ...window,
      endOffsetHours: window.startOffsetHours + (DEFAULT_EVENT_DEADLINE_DAYS * 24)
    };
  }
  return {
    ...window,
    startOffsetDays: Number.isInteger(window.startOffsetDays) ? window.startOffsetDays : 0,
    endOffsetDays: DEFAULT_EVENT_DEADLINE_DAYS
  };
}

function completionTypeMatches(record, expectedTypes = []) {
  return Boolean(record && (expectedTypes.length === 0 || expectedTypes.includes(record.type)));
}

function completionDate(record) {
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
  const rank = { overdue: 0, due: 1, upcoming: 2, complete: 3 };
  return (rank[a.status] - rank[b.status])
    || String(a.overdueAt || a.overdueOn || a.dueWindowEndAt || a.dueWindowEnd || a.dueWindowStartAt || a.dueWindowStart)
      .localeCompare(String(b.overdueAt || b.overdueOn || b.dueWindowEndAt || b.dueWindowEnd || b.dueWindowStartAt || b.dueWindowStart))
    || a.title.localeCompare(b.title);
}

function eventActionDescription(obligation, eventType) {
  const policy = obligation.policyIds?.length ? ` Policy sources: ${obligation.policyIds.join(", ")}.` : "";
  const scope = obligation.scopeResourceIds?.length ? ` Review scoped resources: ${obligation.scopeResourceIds.join(", ")}.` : "";
  const completion = obligation.completionResourceTypes?.length
    ? ` Link completion records of type ${obligation.completionResourceTypes.join(", ")} and any evidence before marking this done.`
    : " Link the completion record and evidence before marking this done.";
  return `Triggered by ${eventType}.${policy}${scope}${completion}`;
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
