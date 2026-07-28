import { stat } from "node:fs/promises";
import { getResourceDefinition } from "../model/index.js";
import { isCanonicalDataPath, resolveDataPath } from "./paths.js";
import { parseCalendarDate, validCalendarRecurrence } from "./recurrence.js";
import { obligationIsRunning } from "./program-lifecycle.js";
import { isMarkdownChoice, markdownEntries } from "./resource-markdown.js";
import { currentCalendarDate, isRfc3339Timestamp } from "./time.js";
import { indexResources, loadWorkspace } from "./workspace.js";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_OBLIGATION_OFFSET_DAYS = 36_600;
const MAX_OBLIGATION_OFFSET_HOURS = MAX_OBLIGATION_OFFSET_DAYS * 24;

export async function validateWorkspace(input = process.cwd()) {
  const loaded = typeof input === "object" && input.entries ? input : await loadWorkspace(input);
  const diagnostics = [...loaded.diagnostics];
  const { byId } = indexResources(loaded.resources);
  const seen = new Map();
  const asOf = currentCalendarDate(loaded.workspace?.timezone || "UTC");
  const obligationsByControl = new Map();
  for (const obligation of loaded.resources.filter((record) => record.type === "obligation" && record.status !== "retired")) {
    for (const controlId of obligation.controlIds || []) {
      if (!obligationsByControl.has(controlId)) obligationsByControl.set(controlId, []);
      obligationsByControl.get(controlId).push(obligation);
    }
  }

  for (const entry of loaded.entries) {
    const { record } = entry;
    const displayPath = `data/${entry.relativePath}`;
    if (!record || Array.isArray(record) || typeof record !== "object") {
      diagnostics.push(error("invalid-record", displayPath, "A resource must be a JSON object."));
      continue;
    }
    if (typeof record.id === "string") {
      if (seen.has(record.id)) {
        diagnostics.push(error("duplicate-id", displayPath, `ID "${record.id}" is already used by ${seen.get(record.id)}.`));
      } else {
        seen.set(record.id, displayPath);
      }
    }

    let definition;
    try {
      definition = getResourceDefinition(loaded.model, record.type);
    } catch {
      diagnostics.push(error("unknown-type", displayPath, `Unknown resource type "${record.type ?? ""}".`));
      continue;
    }

    validateLocation(record, definition, entry.relativePath, diagnostics);
    validateRecord(record, definition, loaded.model, displayPath, diagnostics);
    validateDateRanges(record, displayPath, diagnostics);
    if (record.type === "obligation") validateObligation(record, displayPath, diagnostics);
    if (record.type === "evidence") validateEvidencePaths(record, displayPath, diagnostics);

    const fields = { ...loaded.model.commonFields, ...definition.fields };
    for (const [fieldName, field] of Object.entries(fields)) {
      const value = record[fieldName];
      if (value === undefined || value === null) continue;
      if (field.format === "data-path" || field.items === "data-path") {
        const values = Array.isArray(value) ? value : [value];
        for (const item of values) {
          if (typeof item !== "string") continue;
          try {
            const path = resolveDataPath(loaded.root, item);
            if (!(await stat(path)).isFile()) throw new Error("The data path is not a file.");
          } catch {
            diagnostics.push(error(
              "missing-content",
              displayPath,
              `${fieldName} points to unavailable data path "${item}".`
            ));
          }
        }
      }
      if (field.relation) {
        const ids = Array.isArray(value) ? value : [value];
        for (const id of ids) {
          const target = byId.get(id);
          if (!target) {
            diagnostics.push(error("missing-reference", displayPath, `${fieldName} references unknown ID "${id}".`));
            continue;
          }
          const allowed = field.relation;
          if (!allowed.includes("*") && !allowed.includes(target.type)) {
            diagnostics.push(error(
              "wrong-reference-type",
              displayPath,
              `${fieldName} references ${target.type} "${id}", expected ${allowed.join(" or ")}.`
            ));
          }
        }
      }
    }
    validateIndependentApproval(record, byId, displayPath, diagnostics);
    validateCompletedObligationEvent(record, byId, displayPath, diagnostics);
    validateImplementedControlSchedules(record, obligationsByControl, byId, asOf, displayPath, diagnostics);
    await validateMarkdown(record, definition, loaded.model, loaded.root, displayPath, diagnostics);
  }

  diagnostics.sort((a, b) => `${a.severity}:${a.path}:${a.code}`.localeCompare(`${b.severity}:${b.path}:${b.code}`));
  return {
    ok: !diagnostics.some(({ severity }) => severity === "error"),
    diagnostics,
    counts: {
      resources: loaded.resources.length,
      errors: diagnostics.filter(({ severity }) => severity === "error").length,
      warnings: diagnostics.filter(({ severity }) => severity === "warning").length
    },
    loaded
  };
}

function validateImplementedControlSchedules(record, obligationsByControl, byId, asOf, path, diagnostics) {
  if (record.type !== "control" || record.status !== "implemented") return;
  const schedules = obligationsByControl.get(record.id) || [];
  if (!schedules.length || schedules.every((obligation) => obligationIsRunning(obligation, byId, asOf))) return;
  const stopped = schedules.filter((obligation) => !obligationIsRunning(obligation, byId, asOf));
  const paused = stopped.filter((obligation) => obligation.status === "paused");
  const waiting = stopped.filter((obligation) => obligation.status === "active");
  const policyBlockers = [...new Set(waiting.flatMap((obligation) => (obligation.policyIds || []).map((id) => {
    const policy = byId.get(id);
    if (!policy || policy.type !== "policy") return `${id} (missing)`;
    if (policy.status !== "active") return `${policy.title} (${policy.status})`;
    if (!policy.effectiveOn) return `${policy.title} (effective date missing)`;
    if (policy.effectiveOn > asOf) return `${policy.title} (effective ${policy.effectiveOn})`;
    return null;
  })).filter(Boolean))];
  const reasons = [
    waiting.length
      ? `${waiting.length} enabled ${waiting.length === 1 ? "schedule is" : "schedules are"} waiting for governing ${policyBlockers.length === 1 ? "policy" : "policies"} to become active and effective${policyBlockers.length ? `: ${policyBlockers.join(", ")}` : ""}. Complete Step 2 first.`
      : "",
    paused.length
      ? `${paused.length} linked ${paused.length === 1 ? "schedule is" : "schedules are"} paused. Enable ${paused.length === 1 ? "it" : "them"} before implementing the control.`
      : ""
  ].filter(Boolean).join(" ");
  diagnostics.push(error(
    "control-work-queue-not-running",
    path,
    `This control cannot be marked implemented yet. ${reasons}`
  ));
}

function validateDateRanges(record, path, diagnostics) {
  for (const [startField, endField] of [
    ["startDate", "endDate"],
    ["periodStart", "periodEnd"],
    ["candidatePeriodStart", "candidatePeriodEnd"],
    ["dueWindowStart", "dueWindowEnd"]
  ]) {
    const start = record[startField];
    const end = record[endField];
    if (parseCalendarDate(start) && parseCalendarDate(end) && end < start) {
      diagnostics.push(error(
        "invalid-date-range",
        path,
        `${endField} cannot be before ${startField}.`
      ));
    }
  }
}

function validateCompletedObligationEvent(record, byId, path, diagnostics) {
  if (record.type !== "obligation-event" || record.status !== "complete") return;
  if (record.completedOn && record.occurredOn && record.completedOn < record.occurredOn) {
    diagnostics.push(error(
      "incomplete-obligation-event",
      path,
      "completedOn cannot be before occurredOn."
    ));
  }
  const actionIds = [...byId.values()]
    .filter((candidate) => candidate.type === "action-item" && candidate.sourceResourceId === record.id)
    .map((candidate) => candidate.id);
  if (actionIds.length === 0) {
    diagnostics.push(error("incomplete-obligation-event", path, "A complete Policy Event must have action items."));
    return;
  }
  for (const actionId of actionIds) {
    const action = byId.get(actionId);
    if (!action || action.type !== "action-item") continue;
    if (action.status !== "done") {
      diagnostics.push(error(
        "incomplete-obligation-event",
        path,
        `Action item "${actionId}" must be done before the event is complete.`
      ));
      continue;
    }
    const obligation = byId.get(action.obligationId);
    const expectedTypes = obligation?.type === "obligation" ? obligation.completionResourceTypes || [] : [];
    if (!expectedTypes.length) continue;
    const linked = [...new Set([...(action.completionResourceIds || []), ...(action.evidenceIds || [])])]
      .map((id) => byId.get(id))
      .filter(Boolean);
    if (!linked.some((item) => expectedTypes.includes(item.type))) {
      diagnostics.push(error(
        "incomplete-obligation-event",
        path,
        `Action item "${actionId}" needs a linked completion of type ${expectedTypes.join(" or ")}.`
      ));
    }
  }
}

function validateEvidencePaths(record, path, diagnostics) {
  const expectedPrefix = `evidence/${record.id}/`;
  for (const filePath of record.filePaths || []) {
    if (
      typeof filePath === "string"
      && (!isCanonicalDataPath(filePath) || !filePath.startsWith(expectedPrefix))
    ) {
      diagnostics.push(error(
        "misplaced-evidence-attachment",
        path,
        `filePaths attachments must stay under data/${expectedPrefix}.`
      ));
    }
  }
}

function validateIndependentApproval(record, byId, path, diagnostics) {
  if (!["policy", "document"].includes(record.type) || !(record.approverIds || []).length) return;
  const owners = expandPeople(record.ownerIds || [], byId);
  const approvers = expandPeople(record.approverIds || [], byId);
  const overlap = [...owners].filter((id) => approvers.has(id));
  if (overlap.length) {
    diagnostics.push(error(
      "overlapping-approval-participants",
      path,
      `Approvers must be separate from owners, including through team membership: ${overlap.join(", ")}.`
    ));
  }
  if (["approved", "active"].includes(record.status)) {
    const incompleteStarterApprover = [...approvers]
      .map((id) => byId.get(id))
      .find((person) => (
        person?.id === "person-independent-approver"
        && ["Independent Approver", "Independent Reviewer"].includes(person.title)
      ));
    if (incompleteStarterApprover) {
      diagnostics.push(error(
        "independent-approver-not-appointed",
        path,
        `The selected approver "${incompleteStarterApprover.title}" is still the starter placeholder. Open People and replace it with the reviewer's actual name before approving this record. The reviewer may be internal or external but must be separate from the owner.`
      ));
    }
  }
}

function expandPeople(ids, byId, seen = new Set()) {
  const people = new Set();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const record = byId.get(id);
    if (record?.type === "person") people.add(id);
    if (record?.type === "team") {
      for (const personId of expandPeople([...(record.memberIds || []), ...(record.chairIds || [])], byId, seen)) {
        people.add(personId);
      }
    }
  }
  return people;
}

function validateObligation(record, path, diagnostics) {
  const recurrence = record.recurrence;
  if (!recurrence || Array.isArray(recurrence) || typeof recurrence !== "object") return;
  if (recurrence.mode === "calendar") {
    const normalized = { ...recurrence, anchorDate: recurrence.anchorDate || record.startsOn };
    if (!validCalendarRecurrence(normalized)) {
      diagnostics.push(error(
        "invalid-obligation-recurrence",
        path,
        "Calendar recurrence requires a positive safe-integer interval, day/week/month/year unit, and a valid anchorDate or startsOn date."
      ));
    }
  } else if (recurrence.mode === "event") {
    if (typeof recurrence.eventType !== "string" || !ID_PATTERN.test(recurrence.eventType)) {
      diagnostics.push(error(
        "invalid-obligation-recurrence",
        path,
        "Event recurrence requires a lowercase kebab-case eventType."
      ));
    }
  } else {
    diagnostics.push(error(
      "invalid-obligation-recurrence",
      path,
      'Obligation recurrence mode must be "calendar" or "event".'
    ));
  }

  const window = record.window;
  if (!window || Array.isArray(window) || typeof window !== "object") return;
  const dayFields = ["startOffsetDays", "endOffsetDays"].filter((name) => window[name] !== undefined);
  const hourFields = ["startOffsetHours", "endOffsetHours"].filter((name) => window[name] !== undefined);
  for (const name of [...dayFields, ...hourFields]) {
    if (!Number.isInteger(window[name])) {
      diagnostics.push(error("invalid-obligation-window", path, `window.${name} must be an integer.`));
    }
  }
  for (const name of dayFields) {
    if (Number.isInteger(window[name]) && Math.abs(window[name]) > MAX_OBLIGATION_OFFSET_DAYS) {
      diagnostics.push(error("invalid-obligation-window", path, `window.${name} must stay within ${MAX_OBLIGATION_OFFSET_DAYS.toLocaleString("en-US")} days of the policy event.`));
    }
  }
  for (const name of hourFields) {
    if (Number.isInteger(window[name]) && Math.abs(window[name]) > MAX_OBLIGATION_OFFSET_HOURS) {
      diagnostics.push(error("invalid-obligation-window", path, `window.${name} must stay within ${MAX_OBLIGATION_OFFSET_HOURS.toLocaleString("en-US")} hours of the policy event.`));
    }
  }
  if (dayFields.length && hourFields.length) {
    diagnostics.push(error("invalid-obligation-window", path, "An obligation window cannot mix day and hour offsets."));
  }
  if (recurrence.mode === "calendar" && hourFields.length) {
    diagnostics.push(error("invalid-obligation-window", path, "Calendar obligations use day offsets; hour offsets are only valid for event obligations."));
  }
  if (
    recurrence.mode === "calendar"
    && Number.isInteger(window.startOffsetDays)
    && window.startOffsetDays > 0
    && window.endOffsetDays === undefined
  ) {
    diagnostics.push(error(
      "invalid-obligation-window",
      path,
      "Calendar obligations with a positive window.startOffsetDays must set window.endOffsetDays."
    ));
  }
  if (
    Number.isInteger(window.endOffsetDays)
    && window.endOffsetDays < (Number.isInteger(window.startOffsetDays) ? window.startOffsetDays : 0)
  ) {
    diagnostics.push(error("invalid-obligation-window", path, "window.endOffsetDays must be on or after window.startOffsetDays."));
  }
  if (
    Number.isInteger(window.endOffsetHours)
    && window.endOffsetHours < (Number.isInteger(window.startOffsetHours) ? window.startOffsetHours : 0)
  ) {
    diagnostics.push(error("invalid-obligation-window", path, "window.endOffsetHours must be on or after window.startOffsetHours."));
  }
}

function validateLocation(record, definition, relativePath, diagnostics) {
  if (definition.singleton) {
    if (relativePath !== definition.singleton) {
      diagnostics.push(error("wrong-location", `data/${relativePath}`, `${record.type} belongs at data/${definition.singleton}.`));
    }
    return;
  }
  const recordPath = (definition.recordPath ?? "{id}.json").replaceAll("{id}", record.id);
  const expected = `${definition.collection}/${recordPath}`;
  if (relativePath !== expected) {
    diagnostics.push(error("wrong-location", `data/${relativePath}`, `${record.type} belongs at data/${expected}.`));
  }
}

function validateRecord(record, definition, model, path, diagnostics) {
  const fields = { ...model.commonFields, ...definition.fields };
  const required = new Set([
    ...Object.entries(model.commonFields).filter(([, field]) => field.required).map(([name]) => name),
    ...(definition.required ?? [])
  ]);
  for (const [name, field] of Object.entries(fields)) {
    if (field.requiredWhen && conditionMatches(record, field.requiredWhen)) required.add(name);
    if (field.disjointFrom) {
      const values = normalizedValues(record[name]);
      const otherValues = new Set(normalizedValues(record[field.disjointFrom]));
      const overlap = values.filter((value) => otherValues.has(value));
      if (overlap.length) {
        diagnostics.push(error(
          "overlapping-fields",
          path,
          `${name} must not contain the same IDs as ${field.disjointFrom}: ${overlap.join(", ")}.`
        ));
      }
    }
  }
  for (const name of required) {
    if (isMissing(record[name])) {
      diagnostics.push(error("missing-field", path, `Required field "${name}" is missing.`));
    }
  }
  if (record.type && record.type !== findDefinitionType(model, definition)) {
    diagnostics.push(error("wrong-type", path, `Resource type "${record.type}" does not match its model definition.`));
  }

  for (const [name, value] of Object.entries(record)) {
    const field = fields[name];
    if (!field) {
      diagnostics.push(warning("unknown-field", path, `Field "${name}" is not defined by model v${model.modelVersion}.`));
      continue;
    }
    validateValue(name, value, field, model, path, diagnostics);
  }

}

function normalizedValues(value) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string");
  return typeof value === "string" ? [value] : [];
}

async function validateMarkdown(record, definition, model, root, path, diagnostics) {
  const present = new Set();
  for (const item of markdownEntries(model, record)) {
    try {
      if ((await stat(resolveDataPath(root, item.path))).isFile()) present.add(item.name);
      else throw new Error("The Markdown path is not a file.");
    } catch (cause) {
      if (item.required || cause.code !== "ENOENT") {
        const message = item.required && cause.code === "ENOENT"
          ? `Required ${item.label} Markdown is missing at data/${item.path}.`
          : `${item.label} Markdown must be a regular file at data/${item.path}.`;
        diagnostics.push(error("missing-markdown", path, message));
      }
    }
  }

  for (const group of definition.oneOf ?? []) {
    const choices = Array.isArray(group) ? group : group.fields;
    if (!Array.isArray(choices) || (!Array.isArray(group) && !conditionMatches(record, group.when))) continue;
    const satisfied = choices.some((name) => (
      isMarkdownChoice(name)
        ? present.has(name.slice("$markdown:".length))
        : !isMissing(record[name])
    ));
    if (!satisfied) {
      const labels = choices.map((name) => (
        isMarkdownChoice(name) ? `${name.slice("$markdown:".length)} Markdown` : name
      ));
      diagnostics.push(error("missing-choice", path, `At least one of ${labels.join(", ")} is required.`));
    }
  }
}

function isMissing(value) {
  return value === undefined
    || value === null
    || (typeof value === "string" && value.trim() === "")
    || (Array.isArray(value) && value.length === 0);
}

function validateValue(name, value, field, model, path, diagnostics) {
  const fail = (message) => diagnostics.push(error("invalid-field", path, `${name}: ${message}`));
  if (field.const !== undefined && value !== field.const) fail(`must equal ${JSON.stringify(field.const)}.`);
  switch (field.type) {
    case "string":
    case "id":
    case "date":
    case "timestamp":
    case "enum":
    case "rating":
    case "outcome":
      if (typeof value !== "string") {
        fail("must be a string.");
        return;
      }
      break;
    case "integer":
      if (!Number.isInteger(value)) {
        fail("must be an integer.");
        return;
      }
      validateNumericRange(value, field, fail);
      return;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        fail("must be a finite number.");
        return;
      }
      validateNumericRange(value, field, fail);
      return;
    case "boolean":
      if (typeof value !== "boolean") fail("must be a boolean.");
      return;
    case "object":
      if (!value || Array.isArray(value) || typeof value !== "object") fail("must be an object.");
      return;
    case "array":
      if (!Array.isArray(value)) {
        fail("must be an array.");
        return;
      }
      for (const item of value) validateArrayItem(name, item, field.items, path, diagnostics);
      return;
    default:
      fail(`uses unsupported model type "${field.type}".`);
      return;
  }

  const enumValues = field.values
    ?? (field.type === "rating" ? model.primitives?.rating : undefined)
    ?? (field.type === "outcome" ? model.primitives?.outcome : undefined);
  if (enumValues && !enumValues.includes(value)) fail(`must be one of ${enumValues.join(", ")}.`);
  if ((field.type === "id" || field.format === "id") && !ID_PATTERN.test(value)) fail("must use lowercase kebab-case.");
  if ((field.type === "date" || field.format === "date") && !isDate(value)) fail("must be an ISO 8601 date (YYYY-MM-DD).");
  if (field.type === "timestamp" && !isRfc3339Timestamp(value)) {
    fail("must be an RFC 3339 timestamp with a timezone.");
  }
  if (field.format === "email" && !EMAIL_PATTERN.test(value)) fail("must be an email address.");
  if (field.format === "timezone" && !isTimezone(value)) fail("must be an IANA time zone.");
}

function validateNumericRange(value, field, fail) {
  if (field.minimum !== undefined && value < field.minimum) {
    fail(`must be at least ${field.minimum}.`);
  }
  if (field.maximum !== undefined && value > field.maximum) {
    fail(`must be at most ${field.maximum}.`);
  }
}

function validateArrayItem(name, value, type, path, diagnostics) {
  if (type === "object" && (!value || Array.isArray(value) || typeof value !== "object")) {
    diagnostics.push(error("invalid-field", path, `${name} items must be objects.`));
  } else if ((type === "string" || type === "data-path") && typeof value !== "string") {
    diagnostics.push(error("invalid-field", path, `${name} items must be strings.`));
  } else if (type === "id" && (typeof value !== "string" || !ID_PATTERN.test(value))) {
    diagnostics.push(error("invalid-field", path, `${name} items must be lowercase kebab-case IDs.`));
  }
}

function isDate(value) {
  return DATE_PATTERN.test(value) && Boolean(parseCalendarDate(value));
}

function isTimezone(value) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function conditionMatches(record, condition) {
  return Boolean(condition) && Object.entries(condition).every(([name, expected]) => (
    Array.isArray(expected) ? expected.includes(record[name]) : record[name] === expected
  ));
}

function findDefinitionType(model, definition) {
  return Object.entries(model.resources).find(([, item]) => item === definition)?.[0];
}

function error(code, path, message) {
  return { severity: "error", code, path, message };
}

function warning(code, path, message) {
  return { severity: "warning", code, path, message };
}
