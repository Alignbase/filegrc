import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { getResourceDefinition } from "../model/index.js";
import { scopedCollectionRecords } from "./collection-scope.js";
import { collectionRevision } from "./collection-revision.js";
import { isSafeGitName } from "./git-name.js";
import { isCanonicalDataPath, resolveDataPath } from "./paths.js";
import { parseCalendarDate, validCalendarRecurrence } from "./recurrence.js";
import { obligationIsEnabled } from "./program-lifecycle.js";
import { partyPeople } from "./parties.js";
import { isMarkdownChoice, markdownEntries } from "./resource-markdown.js";
import { currentCalendarDate, isRfc3339Timestamp } from "./time.js";
import { recordTiming } from "./timing.js";
import { indexResources, loadWorkspace } from "./workspace.js";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NAMESPACE_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_OBLIGATION_OFFSET_DAYS = 36_600;
const MAX_OBLIGATION_OFFSET_HOURS = MAX_OBLIGATION_OFFSET_DAYS * 24;

export async function validateWorkspace(input = process.cwd()) {
  const timingStarted = performance.now();
  try {
    return await validateWorkspaceUnmeasured(input);
  } finally {
    recordTiming("validation", performance.now() - timingStarted);
  }
}

async function validateWorkspaceUnmeasured(input) {
  const loaded = typeof input === "object" && input.entries ? input : await loadWorkspace(input);
  const diagnostics = [...loaded.diagnostics];
  const { byId } = indexResources(loaded.resources);
  const seen = new Map();
  const pathById = new Map(loaded.entries.map((entry) => [
    entry.record?.id,
    `data/${entry.relativePath}`
  ]));
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
    validateProposedEffectiveDate(record, asOf, displayPath, diagnostics);
    if (record.type === "appointment") validateAppointment(record, byId, displayPath, diagnostics);
    if (record.type === "program") validateProgram(record, displayPath, diagnostics);
    if (record.type === "component") validateComponent(record, displayPath, diagnostics);
    if (record.type === "control") validateControlComponents(record, byId, displayPath, diagnostics);
    if (record.type === "audit") validateAuditSubservices(record, byId, displayPath, diagnostics);
    if (record.type === "collection-review") {
      validateCollectionReview(record, loaded, byId, displayPath, diagnostics);
    }
    if (record.type === "obligation") validateObligation(record, loaded.model, byId, displayPath, diagnostics);
    if (record.type === "action-item") {
      validateCompletedObligationAction(record, byId, loaded.model, displayPath, diagnostics);
    }
    if (record.type === "obligation-event") validatePolicyEvent(record, loaded.model, byId, displayPath, diagnostics);
    if (record.type === "evidence") validateEvidencePaths(record, displayPath, diagnostics);
    validateCoverage(record, displayPath, diagnostics);
    validateClassification(record, loaded, displayPath, diagnostics);
    validateCompletionDates(record, displayPath, diagnostics);
    await validateAttestationBinding(record, loaded.model, loaded.root, byId, displayPath, diagnostics);

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
      validateNestedRelations(fieldName, value, field, loaded.model, byId, displayPath, diagnostics);
    }
    validateIndependentApproval(record, byId, displayPath, diagnostics);
    validateCompletedObligationEvent(record, byId, loaded.model, displayPath, diagnostics);
    validateImplementedControlSchedules(record, obligationsByControl, displayPath, diagnostics);
    await validateMarkdown(record, definition, loaded.model, loaded.root, displayPath, diagnostics);
    await validateApprovalBinding(record, loaded.model, loaded.root, displayPath, diagnostics);
  }
  validateRelationshipConstraints(
    loaded.resources,
    loaded.model,
    byId,
    pathById,
    diagnostics
  );

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

function validateCollectionReview(record, loaded, byId, path, diagnostics) {
  if (record.status !== "active") return;
  const { model } = loaded;
  const configuration = model.collectionReviews?.[record.resourceType];
  if (!configuration) return;
  const allowedDecisions = configuration.decisions || ["complete"];
  if (!allowedDecisions.includes(record.decision)) {
    diagnostics.push(error(
      "invalid-collection-review-decision",
      path,
      `${configuration.title} review must use one of: ${allowedDecisions.join(", ")}.`
    ));
    return;
  }
  const program = String(model.modelVersion) === "4"
    ? (record.scopeResourceIds || []).map((id) => byId.get(id)).find(({ type } = {}) => type === "program")
    : null;
  const recordCount = scopedCollectionRecords(loaded, record.resourceType, program).length;
  const currentRevision = collectionRevision(loaded, record.resourceType, {
    program,
    authoritativeSourceId: record.decision === "externally-managed"
      ? record.authoritativeComponentId || record.authoritativeSystemId
      : null
  });
  const current = record.collectionRevision === currentRevision;
  if (current && !recordCount && record.decision === "complete") {
    diagnostics.push(error(
      "invalid-collection-review-decision",
      path,
      `${configuration.title} has no records and cannot use the complete conclusion.`
    ));
  }
  if (current && recordCount && record.decision === "zero-population") {
    diagnostics.push(error(
      "invalid-collection-review-decision",
      path,
      `${configuration.title} has ${recordCount} records and cannot use the zero-population conclusion.`
    ));
  }
  if (
    current
    && record.decision === "externally-managed"
    && byId.get(record.authoritativeComponentId || record.authoritativeSystemId)?.status !== "active"
  ) {
    diagnostics.push(error(
      "inactive-authoritative-system",
      path,
      `${configuration.title} must name an active authoritative ${String(model.modelVersion) === "4" ? "Component" : "System"} for an externally managed conclusion.`
    ));
  }
}

export async function fingerprintWorkspace(input = process.cwd()) {
  const loaded = typeof input === "object" && input.entries ? input : await loadWorkspace(input);
  const hash = createHash("sha256");
  hash.update(`model\0${loaded.model.modelVersion}\0`);
  for (const entry of [...loaded.entries].sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
    hash.update(`record\0${entry.relativePath}\0${entry.source.length}\0${entry.source}`);
    const definition = loaded.model.resources[entry.record?.type];
    if (!definition) continue;
    for (const item of markdownEntries(loaded.model, entry.record).sort((a, b) => a.path.localeCompare(b.path))) {
      try {
        const source = await readFile(resolveDataPath(loaded.root, item.path), "utf8");
        hash.update(`markdown\0${item.path}\0${source.length}\0${source}`);
      } catch {
        hash.update(`markdown-missing\0${item.path}\0`);
      }
    }
    const fields = { ...loaded.model.commonFields, ...definition.fields };
    for (const [name, field] of Object.entries(fields)) {
      if (field.format !== "data-path" && field.items !== "data-path") continue;
      const value = entry.record[name];
      const paths = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
      for (const path of [...paths].sort()) {
        try {
          const file = await stat(resolveDataPath(loaded.root, path));
          hash.update(`data-path\0${path}\0${file.isFile() ? "file" : "other"}\0`);
        } catch {
          hash.update(`data-path-missing\0${path}\0`);
        }
      }
    }
  }
  return { fingerprint: hash.digest("hex"), loaded };
}

function validateImplementedControlSchedules(record, obligationsByControl, path, diagnostics) {
  if (record.type !== "control" || record.status !== "implemented") return;
  const schedules = obligationsByControl.get(record.id) || [];
  if (!schedules.length) {
    if (record.operationPattern === "continuous") return;
    diagnostics.push(error(
      "control-work-queue-missing",
      path,
      "An implemented scheduled, event-driven, or mixed Control must link at least one active Obligation."
    ));
    return;
  }
  if (schedules.some(obligationIsEnabled)) return;
  const stopped = schedules.filter((obligation) => !obligationIsEnabled(obligation));
  const paused = stopped.filter((obligation) => obligation.status === "paused");
  const proposed = stopped.filter((obligation) => obligation.status === "proposed");
  const reasons = [
    proposed.length
      ? `${proposed.length} linked ${proposed.length === 1 ? "schedule is" : "schedules are"} still proposed. Enable ${proposed.length === 1 ? "it" : "them"} before implementing the control; the schedule will remain dormant until its governing Policy is active and effective.`
      : "",
    paused.length
      ? `${paused.length} linked ${paused.length === 1 ? "schedule is" : "schedules are"} paused. Enable ${paused.length === 1 ? "it" : "them"} before implementing the control.`
      : ""
  ].filter(Boolean).join(" ");
  diagnostics.push(error(
    "control-work-queue-not-running",
    path,
    `This control cannot be marked implemented yet. ${reasons || "Enable at least one linked schedule."}`
  ));
}

function validateDateRanges(record, path, diagnostics) {
  for (const [startField, endField] of [
    ["startDate", "endDate"],
    ["startsOn", "endsOn"]
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

function validateProposedEffectiveDate(record, asOf, path, diagnostics) {
  if (
    !["policy", "document"].includes(record.type)
    || !record.proposedEffectiveOn
    || record.proposedEffectiveOn >= asOf
  ) return;
  diagnostics.push(warning(
    "past-proposed-effective-date",
    path,
    `The proposed effective date ${record.proposedEffectiveOn} has passed. Choose a current or future date when management activates the approved content; do not backdate adoption.`
  ));
}

function validateAppointment(record, byId, path, diagnostics) {
  if ((record.scopeResourceIds || []).includes(record.id)) {
    diagnostics.push(error(
      "invalid-appointment-scope",
      path,
      "An Appointment cannot include itself in scopeResourceIds."
    ));
  }
  if (record.status !== "active") return;
  const holder = byId.get(record.holderId);
  if (holder?.type === "person" && holder.status === "active") return;
  diagnostics.push(error(
    "inactive-appointment-holder",
    path,
    "An active Appointment must have an active Person as its holder."
  ));
}

function validateProgram(record, path, diagnostics) {
  const requirementIds = (record.requirementApplicability || [])
    .map(({ requirementId }) => requirementId)
    .filter(Boolean);
  if (new Set(requirementIds).size !== requirementIds.length) {
    diagnostics.push(error(
      "duplicate-program-applicability",
      path,
      "A Program may record each Requirement only once in requirementApplicability."
    ));
  }
}

function validateComponent(record, path, diagnostics) {
  const systemIds = (record.systemUses || []).map(({ systemId }) => systemId).filter(Boolean);
  if (new Set(systemIds).size !== systemIds.length) {
    diagnostics.push(error("duplicate-system-use", path, "A Component may name each System only once in systemUses."));
  }
  for (const [index, use] of (record.systemUses || []).entries()) {
    if (!(use.roles || []).length || !String(use.rationale || "").trim()) {
      diagnostics.push(error("incomplete-system-use", path, `systemUses[${index}] needs at least one role and a rationale.`));
    }
  }
}

function validateControlComponents(record, byId, path, diagnostics) {
  if (record.status !== "implemented") return;
  const systemIds = new Set(record.systemIds || []);
  for (const field of ["componentIds", "evidenceSourceComponentIds"]) {
    for (const id of record[field] || []) {
      const component = byId.get(id);
      if (component?.type !== "component") continue;
      const uses = (component.systemUses || []).filter(({ systemId }) => systemIds.has(systemId));
      if (!uses.length) {
        diagnostics.push(error("component-outside-control-scope", path, `${field} Component "${id}" has no use in a System where this Control applies.`));
      }
      if (field === "evidenceSourceComponentIds" && !uses.some(({ roles }) => (roles || []).includes("evidence-source"))) {
        diagnostics.push(error("invalid-evidence-source-component", path, `Component "${id}" must have the evidence-source role in a System where this Control applies.`));
      }
    }
  }
}

function validateAuditSubservices(record, byId, path, diagnostics) {
  const selectedSystemIds = new Set(record.systemIds || []);
  const seenComponentIds = new Set();
  for (const [index, treatment] of (record.subserviceTreatments || []).entries()) {
    for (const componentId of treatment.componentIds || []) {
      const component = byId.get(componentId);
      if (seenComponentIds.has(componentId)) {
        diagnostics.push(error(
          "duplicate-subservice-component",
          path,
          `subserviceTreatments[${index}] repeats Component "${componentId}" in more than one treatment.`
        ));
      }
      seenComponentIds.add(componentId);
      if (component?.type === "component" && component.vendorId !== treatment.vendorId) {
        diagnostics.push(error(
          "subservice-vendor-mismatch",
          path,
          `subserviceTreatments[${index}] Component "${componentId}" is not supplied by Vendor "${treatment.vendorId}".`
        ));
      }
      if (
        component?.type === "component"
        && !(component.systemUses || []).some(({ systemId }) => selectedSystemIds.has(systemId))
      ) {
        diagnostics.push(error(
          "subservice-component-outside-audit-scope",
          path,
          `subserviceTreatments[${index}] Component "${componentId}" has no use in a System selected by this Audit.`
        ));
      }
    }
  }
}

function validateCompletedObligationEvent(record, byId, model, path, diagnostics) {
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
    const expectedTypes = obligation?.type === "obligation"
      ? model.obligationActivities?.[obligation.activityType]?.completionResourceTypes || []
      : [];
    if (!expectedTypes.length) continue;
    const completionIds = ["3", "4"].includes(String(model.modelVersion))
      ? action.completionResourceIds || []
      : [...(action.completionResourceIds || []), ...(action.evidenceIds || [])];
    const linked = [...new Set(completionIds)]
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

function validateCompletedObligationAction(record, byId, model, path, diagnostics) {
  if (
    !["3", "4"].includes(String(model.modelVersion))
    || record.status !== "done"
    || !record.obligationId
  ) return;
  const obligation = byId.get(record.obligationId);
  if (obligation?.type !== "obligation") return;
  const expectedTypes = model.obligationActivities?.[obligation.activityType]?.completionResourceTypes || [];
  if (!expectedTypes.length) return;
  const linked = [...new Set(record.completionResourceIds || [])]
    .map((id) => byId.get(id))
    .filter(Boolean);
  if (linked.some((item) => expectedTypes.includes(item.type))) return;
  diagnostics.push(error(
    "missing-obligation-completion",
    path,
    `A done Action Item linked to "${obligation.id}" needs completionResourceIds containing ${expectedTypes.join(" or ")}.`
  ));
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
  if (!["policy", "document"].includes(record.type)) return;
  if (!(record.approverIds || []).length) return;
  const owners = partyPeople(record.ownerIds || [], byId);
  const approvers = partyPeople(record.approverIds || [], byId);
  const overlap = [...owners].filter((id) => approvers.has(id));
  if (overlap.length) {
    diagnostics.push(error(
      "overlapping-approval-participants",
      path,
      `Approvers must be separate from owners, including through team membership: ${overlap.join(", ")}.`
    ));
  }
}

function validateObligation(record, model, byId, path, diagnostics) {
  const recurrence = record.recurrence;
  if (!recurrence || Array.isArray(recurrence) || typeof recurrence !== "object") return;
  const activity = model.obligationActivities?.[record.activityType];
  if (
    activity
    && Array.isArray(activity.recurrenceModes)
    && !activity.recurrenceModes.includes(recurrence.mode)
  ) {
    diagnostics.push(error(
      "invalid-obligation-activity",
      path,
      `${record.activityType} obligations require ${activity.recurrenceModes.join(" or ")} recurrence.`
    ));
  }
  if (activity) {
    const allowedScopeTypes = new Set(activity.scopeResourceTypes || []);
    for (const [field, ids] of [
      ["scopeResourceIds", record.scopeResourceIds || []],
      ["templateResourceId", record.templateResourceId ? [record.templateResourceId] : []]
    ]) {
      for (const id of ids) {
        const target = byId.get(id);
        if (!target || allowedScopeTypes.has(target.type)) continue;
        diagnostics.push(error(
          "invalid-obligation-scope",
          path,
          `${field} references ${target.type} "${id}", but ${record.activityType} allows ${[...allowedScopeTypes].join(" or ")} scope.`
        ));
      }
    }
  }
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
    if (!model.policyEvents?.[recurrence.eventType]) {
      diagnostics.push(error(
        "invalid-obligation-recurrence",
        path,
        "Event recurrence must use a policy event defined by the model."
      ));
    }
    if (record.eventRiskLevels?.length) {
      if (recurrence.eventType !== "person-ended") {
        diagnostics.push(error(
          "invalid-obligation-event-filter",
          path,
          "eventRiskLevels may be used only with the person-ended Policy Event."
        ));
      }
      const invalid = record.eventRiskLevels.filter((value) => !["normal", "high"].includes(value));
      if (invalid.length) {
        diagnostics.push(error(
          "invalid-obligation-event-filter",
          path,
          `Departure risk filters must be normal or high, not ${invalid.join(", ")}.`
        ));
      }
    }
  } else {
    diagnostics.push(error(
      "invalid-obligation-recurrence",
      path,
      'Obligation recurrence mode must be "calendar" or "event".'
    ));
  }

  const window = record.window;
  if (!window || Array.isArray(window) || typeof window !== "object") {
    if (recurrence.mode === "event") {
      diagnostics.push(error("invalid-obligation-window", path, "Event obligations require an explicit deadline window."));
    }
    return;
  }
  for (const name of ["startsAfter", "dueAfter"]) {
    if (window[name] === undefined) continue;
    if (!Number.isInteger(window[name])) {
      diagnostics.push(error("invalid-obligation-window", path, `window.${name} must be an integer.`));
    }
  }
  const limit = window.precision === "timestamp" ? MAX_OBLIGATION_OFFSET_HOURS : MAX_OBLIGATION_OFFSET_DAYS;
  const unit = window.precision === "timestamp" ? "hours" : "days";
  for (const name of ["startsAfter", "dueAfter"]) {
    if (Number.isInteger(window[name]) && Math.abs(window[name]) > limit) {
      diagnostics.push(error("invalid-obligation-window", path, `window.${name} must stay within ${limit.toLocaleString("en-US")} ${unit} of the policy event.`));
    }
  }
  if (recurrence.mode === "calendar" && window.precision !== "date") {
    diagnostics.push(error("invalid-obligation-window", path, "Calendar obligations require a date-precision window."));
  }
  if (
    Number.isInteger(window.dueAfter)
    && window.dueAfter < (Number.isInteger(window.startsAfter) ? window.startsAfter : 0)
  ) {
    diagnostics.push(error("invalid-obligation-window", path, "window.dueAfter must be on or after window.startsAfter."));
  }
}

function validatePolicyEvent(record, model, byId, path, diagnostics) {
  const event = model.policyEvents?.[record.eventType];
  if (!event) return;
  const rules = event.subjectRules || [];
  const allowedTypes = new Set(rules.map(({ resourceType }) => resourceType));
  const counts = new Map();
  for (const id of new Set(record.subjectResourceIds || [])) {
    const target = byId.get(id);
    if (!target) continue;
    counts.set(target.type, (counts.get(target.type) || 0) + 1);
    if (!allowedTypes.has(target.type)) {
      diagnostics.push(error(
        "invalid-policy-event-subject",
        path,
        `${record.eventType} cannot use ${target.type} "${id}" as a subject.`
      ));
    }
  }
  for (const { resourceType, minimum = 0, maximum } of rules) {
    const count = counts.get(resourceType) || 0;
    if (count < minimum) {
      diagnostics.push(error(
        "invalid-policy-event-subject",
        path,
        `${record.eventType} requires at least ${minimum} ${resourceType} subject${minimum === 1 ? "" : "s"}.`
      ));
    }
    if (Number.isInteger(maximum) && count > maximum) {
      diagnostics.push(error(
        "invalid-policy-event-subject",
        path,
        `${record.eventType} allows at most ${maximum} ${resourceType} subject${maximum === 1 ? "" : "s"}.`
      ));
    }
  }
}

function validateCompletionDates(record, path, diagnostics) {
  if (record.startedAt && record.completedAt && record.completedAt < record.startedAt) {
    diagnostics.push(error("invalid-completion-order", path, "completedAt cannot be before startedAt."));
  }
  if (record.completedOn && record.reviewedOn && record.reviewedOn < record.completedOn) {
    diagnostics.push(error("invalid-completion-order", path, "reviewedOn cannot be before completedOn."));
  }
  if (record.completedOn && record.approvedOn && record.approvedOn < record.completedOn) {
    diagnostics.push(error("invalid-completion-order", path, "approvedOn cannot be before completedOn."));
  }
  validateOrderedDates(record, path, diagnostics, [
    "requestedOn",
    "approvedOn",
    "provisionedOn",
    "deprovisionedOn"
  ]);
  validateOrderedDates(record, path, diagnostics, [
    "detectedAt",
    "declaredAt",
    "containedAt",
    "eradicatedAt",
    "recoveredAt",
    "closedAt"
  ]);
  validateOrderedDates(record, path, diagnostics, ["startedAt", "endedAt"]);
  validateOrderedDates(record, path, diagnostics, ["fieldworkStart", "fieldworkEnd", "reportDate"]);
  if (record.acceptance) {
    validateOrderedDates(record.acceptance, path, diagnostics, ["acceptedOn", "expiresOn"], "acceptance.");
  }
  if (record.approval) {
    validateOrderedDates(record.approval, path, diagnostics, ["approvedOn", "expiresOn"], "approval.");
    if (
      record.resolution?.resolvedOn
      && record.approval.approvedOn
      && record.resolution.resolvedOn < record.approval.approvedOn
    ) {
      diagnostics.push(error(
        "invalid-completion-order",
        path,
        "resolution.resolvedOn cannot be before approval.approvedOn."
      ));
    }
  }
}

function validateOrderedDates(record, path, diagnostics, fields, prefix = "") {
  let previous = null;
  for (const field of fields) {
    const value = record[field];
    if (!value) continue;
    if (previous && value < previous.value) {
      diagnostics.push(error(
        "invalid-completion-order",
        path,
        `${prefix}${field} cannot be before ${prefix}${previous.field}.`
      ));
    }
    previous = { field, value };
  }
}

async function validateAttestationBinding(record, model, root, byId, path, diagnostics) {
  if (
    record.type !== "attestation"
    || record.status !== "completed"
    || record.attestationMethod !== "git-approval"
    || !record.contentRevisions
  ) return;
  const expectedPaths = new Set();
  const subjectPaths = new Map();
  for (const id of record.subjectResourceIds || []) {
    const subject = byId.get(id);
    if (!subject) continue;
    const paths = [];
    for (const item of markdownEntries(model, subject)) {
      try {
        if ((await stat(resolveDataPath(root, item.path))).isFile()) paths.push(item.path);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    subjectPaths.set(id, paths);
    for (const item of paths) expectedPaths.add(item);
  }
  const actualPaths = Object.keys(record.contentRevisions);
  if (!expectedPaths.size) {
    diagnostics.push(error(
      "invalid-attestation-binding",
      path,
      "A git-approval Attestation must reference authored Policy, Document, or Training content."
    ));
    return;
  }
  if (!actualPaths.length) {
    diagnostics.push(error(
      "invalid-attestation-binding",
      path,
      "A git-approval Attestation must bind at least one subject Markdown file."
    ));
    return;
  }
  const invalid = actualPaths.filter((item) => (
    !expectedPaths.has(item)
    || !/^[a-f0-9]{64}$/.test(String(record.contentRevisions[item] || ""))
  ));
  const unboundSubjects = [...subjectPaths].filter(([, paths]) => (
    paths.length && !paths.some((item) => actualPaths.includes(item))
  )).map(([id]) => id);
  if (invalid.length || unboundSubjects.length) {
    diagnostics.push(error(
      "invalid-attestation-binding",
      path,
      unboundSubjects.length
        ? `Attestation contentRevisions must bind authored Markdown for every subject; missing ${unboundSubjects.join(", ")}.`
        : "Attestation contentRevisions must contain valid SHA-256 hashes for subject Markdown paths and no unrelated paths."
    ));
  }
}

async function validateApprovalBinding(record, model, root, path, diagnostics) {
  const bindingField = approvalBindingField(record, model);
  if (!bindingField || !approvalBound(record) || !record[bindingField]) return;
  const actual = {};
  for (const item of markdownEntries(model, record)) {
    try {
      const source = await readFile(resolveDataPath(root, item.path), "utf8");
      actual[item.path] = createHash("sha256").update(source).digest("hex");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const expected = record[bindingField];
  const paths = [...new Set([...Object.keys(actual), ...Object.keys(expected)])].sort();
  const invalid = paths.filter((item) => (
    !/^[a-f0-9]{64}$/.test(String(expected[item] || ""))
    || expected[item] !== actual[item]
  ));
  if (invalid.length) {
    diagnostics.push(error(
      "approval-content-changed",
      path,
      `Approved content no longer matches ${invalid.map((item) => `data/${item}`).join(", ")}. Move the record to draft or in-review, review the change, then approve it again.`
    ));
  }
}

function approvalBound(record) {
  if (record.type === "policy") return ["approved", "active", "superseded", "retired"].includes(record.status);
  if (record.type === "document") return ["active", "superseded", "retired"].includes(record.status);
  if (record.type === "training") return ["active", "retired"].includes(record.status);
  return false;
}

function approvalBindingField(record, model) {
  if (["policy", "document"].includes(record.type)) return "approvedContentRevisions";
  if (record.type === "training" && model.resources.training?.fields?.effectiveContentRevisions) {
    return "effectiveContentRevisions";
  }
  return null;
}

function validateCoverage(record, path, diagnostics) {
  const coverage = record.type === "workspace" ? record.candidateCoverage : record.coverage;
  if (!coverage) return;
  if (coverage.kind === "range" && coverage.startsOn && coverage.endsOn && coverage.endsOn < coverage.startsOn) {
    diagnostics.push(error("invalid-date-range", path, "coverage.endsOn cannot be before coverage.startsOn."));
  }
  if (
    record.type === "audit"
    && record.auditKind === "soc-2-type-1"
    && coverage.kind !== "as-of"
  ) {
    diagnostics.push(error("invalid-audit-coverage", path, "A SOC 2 Type 1 Audit requires as-of coverage."));
  }
  if (
    record.type === "audit"
    && record.auditKind === "soc-2-type-2"
    && coverage.kind !== "range"
  ) {
    diagnostics.push(error("invalid-audit-coverage", path, "A SOC 2 Type 2 Audit requires range coverage."));
  }
  if (
    record.type === "workspace"
    && record.assuranceGoal === "soc-2-type-1"
    && coverage.kind !== "as-of"
  ) {
    diagnostics.push(error("invalid-candidate-coverage", path, "A Type 1 management goal requires as-of candidate coverage."));
  }
  if (
    record.type === "workspace"
    && record.assuranceGoal === "soc-2-type-2"
    && coverage.kind !== "range"
  ) {
    diagnostics.push(error("invalid-candidate-coverage", path, "A Type 2 management goal requires range candidate coverage."));
  }
  if (
    ["audit-population", "penetration-test"].includes(record.type)
    && coverage.kind !== "range"
  ) {
    diagnostics.push(error("invalid-coverage", path, `${record.type} requires range coverage.`));
  }
  if (
    record.type === "evidence"
    && record.artifactKind === "population-export"
    && coverage.kind !== "range"
  ) {
    diagnostics.push(error("invalid-coverage", path, "Population Export Evidence requires range coverage."));
  }
}

function validateClassification(record, loaded, path, diagnostics) {
  if (!record.classificationId) return;
  if (String(loaded.model.modelVersion) === "4") {
    if (!loaded.resources.some(({ id, type }) => id === record.classificationId && type === "classification")) {
      diagnostics.push(error(
        "unknown-classification",
        path,
        `classificationId references undefined Classification "${record.classificationId}".`
      ));
    }
    return;
  }
  const definitions = loaded.workspace?.classificationDefinitions;
  if (
    !definitions
    || Array.isArray(definitions)
    || typeof definitions !== "object"
    || !Object.hasOwn(definitions, record.classificationId)
  ) {
    diagnostics.push(error(
      "unknown-classification",
      path,
      `classificationId references undefined Workspace classification "${record.classificationId}".`
    ));
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
    if (!isMissing(record[name]) && field.allowedWhen && !conditionMatches(record, field.allowedWhen)) {
      diagnostics.push(error(
        "invalid-field",
        path,
        `${name} is not allowed for the selected ${Object.keys(field.allowedWhen).join(" and ")}.`
      ));
    }
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
      diagnostics.push(error(
        "unknown-field",
        path,
        `Field "${name}" is not defined by model v${model.modelVersion}. Put organization-specific data under extensions.`
      ));
      continue;
    }
    validateValue(name, value, field, model, path, diagnostics);
  }

}

function normalizedValues(value) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string");
  return typeof value === "string" ? [value] : [];
}

function validateNestedRelations(name, value, field, model, byId, path, diagnostics) {
  if (
    field.type === "object"
    && field.objectType
    && value
    && !Array.isArray(value)
    && typeof value === "object"
  ) {
    validateObjectRelations(name, value, model.objectTypes?.[field.objectType], model, byId, path, diagnostics);
  }
  if (field.type === "array" && field.itemObjectType && Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      if (!item || Array.isArray(item) || typeof item !== "object") continue;
      validateObjectRelations(
        `${name}[${index}]`,
        item,
        model.objectTypes?.[field.itemObjectType],
        model,
        byId,
        path,
        diagnostics
      );
    }
  }
}

function validateObjectRelations(name, value, schema, model, byId, path, diagnostics) {
  if (!schema) return;
  for (const [propertyName, property] of Object.entries(schema.properties || {})) {
    const nested = value[propertyName];
    if (nested === undefined || nested === null) continue;
    if (property.relation) {
      const ids = Array.isArray(nested) ? nested : [nested];
      for (const id of ids) {
        const target = byId.get(id);
        if (!target) {
          diagnostics.push(error(
            "missing-reference",
            path,
            `${name}.${propertyName} references unknown ID "${id}".`
          ));
        } else if (!property.relation.includes("*") && !property.relation.includes(target.type)) {
          diagnostics.push(error(
            "wrong-reference-type",
            path,
            `${name}.${propertyName} references ${target.type} "${id}", expected ${property.relation.join(" or ")}.`
          ));
        }
      }
    }
    validateNestedRelations(`${name}.${propertyName}`, nested, property, model, byId, path, diagnostics);
  }
}

function validateRelationshipConstraints(resources, model, byId, pathById, diagnostics) {
  for (const constraint of model.relationshipConstraints?.acyclic || []) {
    const candidates = resources.filter(({ type }) => type === constraint.resourceType);
    const visited = new Set();
    for (const record of candidates) {
      if (visited.has(record.id)) continue;
      const chain = [];
      const positions = new Map();
      let current = record;
      while (current?.type === constraint.resourceType && !visited.has(current.id)) {
        if (positions.has(current.id)) {
          const cycle = [...chain.slice(positions.get(current.id)), current.id];
          const cycleRecord = chain[positions.get(current.id)];
          diagnostics.push(error(
            "cyclic-relationship",
            pathById.get(cycleRecord) || `data/${cycleRecord}`,
            `${constraint.field} forms a cycle: ${cycle.join(" -> ")}.`
          ));
          break;
        }
        positions.set(current.id, chain.length);
        chain.push(current.id);
        current = byId.get(current[constraint.field]);
      }
      for (const id of chain) visited.add(id);
    }
  }

  for (const constraint of model.relationshipConstraints?.unique || []) {
    const keys = new Map();
    for (const record of resources) {
      if (record.type !== constraint.resourceType) continue;
      if (constraint.statuses && !constraint.statuses.includes(record.status)) continue;
      const key = JSON.stringify((constraint.fields || []).map((field) => {
        const value = record[field];
        return Array.isArray(value) ? [...value].sort() : value ?? null;
      }));
      const previous = keys.get(key);
      if (previous) {
        diagnostics.push(error(
          "duplicate-active-relationship",
          pathById.get(record.id) || `data/${record.id}`,
          `${record.title} duplicates ${previous.title} for ${constraint.fields.join(", ")} while both are ${record.status}.`
        ));
      } else keys.set(key, record);
    }
  }
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
      if (!value || Array.isArray(value) || typeof value !== "object") {
        fail("must be an object.");
        return;
      }
      if (field.objectType) {
        validateObjectValue(name, value, field.objectType, model, path, diagnostics);
      }
      return;
    case "array":
      if (!Array.isArray(value)) {
        fail("must be an array.");
        return;
      }
      if (
        ["id", "string", "data-path"].includes(field.items)
        && new Set(value).size !== value.length
      ) {
        fail("must not contain duplicate values.");
      }
      for (const [index, item] of value.entries()) {
        validateArrayItem(name, item, field, model, path, diagnostics, index);
      }
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
  if (field.format === "git-name" && !isSafeGitName(value)) fail("must be a safe Git name.");
}

function validateNumericRange(value, field, fail) {
  if (field.minimum !== undefined && value < field.minimum) {
    fail(`must be at least ${field.minimum}.`);
  }
  if (field.maximum !== undefined && value > field.maximum) {
    fail(`must be at most ${field.maximum}.`);
  }
}

function validateArrayItem(name, value, field, model, path, diagnostics, index) {
  const type = field.items;
  if (type === "object" && (!value || Array.isArray(value) || typeof value !== "object")) {
    diagnostics.push(error("invalid-field", path, `${name} items must be objects.`));
  } else if (type === "object" && field.itemObjectType) {
    validateObjectValue(`${name}[${index}]`, value, field.itemObjectType, model, path, diagnostics);
  } else if ((type === "string" || type === "data-path" || type === "enum") && typeof value !== "string") {
    diagnostics.push(error("invalid-field", path, `${name} items must be strings.`));
  } else if (type === "enum" && field.values && !field.values.includes(value)) {
    diagnostics.push(error("invalid-field", path, `${name} items must be one of ${field.values.join(", ")}.`));
  } else if (type === "id" && (typeof value !== "string" || !ID_PATTERN.test(value))) {
    diagnostics.push(error("invalid-field", path, `${name} items must be lowercase kebab-case IDs.`));
  }
}

function validateObjectValue(name, value, objectType, model, path, diagnostics) {
  const schema = model.objectTypes?.[objectType];
  if (!schema) {
    diagnostics.push(error("invalid-field", path, `${name}: uses unknown object type "${objectType}".`));
    return;
  }
  const properties = schema.properties || {};
  const required = new Set(schema.required || []);
  for (const [propertyName, property] of Object.entries(properties)) {
    if (property.requiredWhen && conditionMatches(value, property.requiredWhen)) required.add(propertyName);
    if (!isMissing(value[propertyName]) && property.allowedWhen && !conditionMatches(value, property.allowedWhen)) {
      diagnostics.push(error(
        "invalid-field",
        path,
        `${name}.${propertyName} is not allowed for the selected ${Object.keys(property.allowedWhen).join(" and ")}.`
      ));
    }
  }
  for (const propertyName of required) {
    if (isMissing(value[propertyName])) {
      diagnostics.push(error("missing-field", path, `Required field "${name}.${propertyName}" is missing.`));
    }
  }
  for (const [propertyName, propertyValue] of Object.entries(value)) {
    const property = properties[propertyName];
    if (property) {
      validateValue(`${name}.${propertyName}`, propertyValue, property, model, path, diagnostics);
      continue;
    }
    if (schema.additionalProperties === true) continue;
    if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
      validateValue(`${name}.${propertyName}`, propertyValue, schema.additionalProperties, model, path, diagnostics);
      continue;
    }
    diagnostics.push(error(
      "unknown-field",
      path,
      `Field "${name}.${propertyName}" is not defined by object type "${objectType}".`
    ));
  }
  for (const propertyName of Object.keys(value)) {
    if (schema.keyFormat === "namespace" && !NAMESPACE_PATTERN.test(propertyName)) {
      diagnostics.push(error(
        "invalid-field",
        path,
        `${name}.${propertyName}: extension namespaces must use lowercase dot-separated names.`
      ));
    }
    if (schema.keyFormat === "data-path" && !isCanonicalDataPath(propertyName)) {
      diagnostics.push(error("invalid-field", path, `${name}.${propertyName}: must be a canonical data-relative path.`));
    }
  }
  validateObjectDateRanges(name, value, path, diagnostics);
}

function validateObjectDateRanges(name, value, path, diagnostics) {
  for (const [startField, endField] of [
    ["startsOn", "dueOn"],
    ["dueOn", "overdueOn"],
    ["startsAt", "dueAt"],
    ["dueAt", "overdueAt"],
    ["startsOn", "endsOn"]
  ]) {
    const start = value[startField];
    const end = value[endField];
    if (!start || !end) continue;
    const invalid = startField.endsWith("At")
      ? new Date(end) < new Date(start)
      : parseCalendarDate(start) && parseCalendarDate(end) && end < start;
    if (invalid) {
      diagnostics.push(error(
        "invalid-date-range",
        path,
        `${name}.${endField} cannot be before ${name}.${startField}.`
      ));
    }
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
