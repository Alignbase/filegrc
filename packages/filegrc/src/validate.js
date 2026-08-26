import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { getResourceDefinition, modelSupports } from "../model/index.js";
import { scopedCollectionRecords, selectScopedCollectionRecords } from "./collection-scope.js";
import {
  collectionRevision,
  collectionRevisionMatches
} from "./collection-revision.js";
import { isSafeGitName } from "./git-name.js";
import { getFileObjectIdAtRevision, getGitSummary, getWorkingFileObjectId, hasGitRevision } from "./git.js";
import { isCanonicalDataPath, resolveDataPath } from "./paths.js";
import {
  addCalendarDays,
  calendarOccurrence,
  calendarOccurrenceIndex,
  parseCalendarDate,
  validCalendarRecurrence
} from "./recurrence.js";
import { resourceReviewRevisions, retentionReviewResourceIds } from "./retention.js";
import { obligationIsEnabled } from "./program-lifecycle.js";
import { partyPeople } from "./parties.js";
import { isMarkdownChoice, markdownEntries } from "./resource-markdown.js";
import { currentCalendarDate, isRfc3339Timestamp, localDateTimeValue, timestampFromLocalDateTime } from "./time.js";
import { recordTiming } from "./timing.js";
import { personWasActiveOn } from "./soc2.js";
import { indexResources, loadWorkspace } from "./workspace.js";
import { collectionReviewRevision, historicalCollectionReviewSnapshot } from "./collection-review-integrity.js";
import { reportingRouteRevision } from "./reporting-route-integrity.js";
import { validateWorkflowHistoryIntegrity } from "./workflow-history-integrity.js";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NAMESPACE_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_OBLIGATION_OFFSET_DAYS = 36_600;
const MAX_OBLIGATION_OFFSET_HOURS = MAX_OBLIGATION_OFFSET_DAYS * 24;
const COMPLETION_DATE_FIELDS = [
  "completedOn", "performedOn", "reviewedOn", "occurredOn", "collectedOn",
  "verifiedOn", "approvedOn", "submittedOn", "closedOn", "reportDate"
];
const COMPLETION_TIMESTAMP_FIELDS = [
  "completedAt", "endedAt", "closedAt", "provisionedOn", "deprovisionedOn"
];

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
  const reviewRecords = loaded.resources.filter((record) => (
    record.status === "active" && ["retention-schedule-item", "requirement-mapping"].includes(record.type)
  ));
  const reviewDependencyIds = reviewRecords.flatMap((record) => (
    record.type === "retention-schedule-item"
      ? retentionReviewResourceIds(record, loaded)
      : [...(record.sourceResourceIds || []), ...(record.targetResourceIds || [])]
  ));
  const currentReviewRevisions = await resourceReviewRevisions(loaded, reviewDependencyIds);
  if (modelSupports(loaded.model, "rolled-up-obligations")) {
    await validateWorkflowHistoryIntegrity(loaded, diagnostics);
  }
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
    if (record.type === "obligation-rule") validateObligationRule(record, loaded.model, byId, displayPath, diagnostics);
    if (record.type === "obligation-occurrence") {
      validateObligationOccurrence(record, loaded.model, loaded.resources, loaded.entries, loaded.root, loaded.workspace.timezone, byId, asOf, displayPath, diagnostics);
    }
    if (record.type === "retention-schedule-item") validateRetentionScheduleItem(record, loaded, byId, currentReviewRevisions, displayPath, diagnostics);
    if (record.type === "requirement-mapping") validateRequirementMapping(record, currentReviewRevisions, displayPath, diagnostics);
    if (record.type === "action-item") {
      validateCompletedObligationAction(record, byId, loaded.model, displayPath, diagnostics);
    }
    if (record.type === "obligation-event") validatePolicyEvent(record, loaded.model, byId, displayPath, diagnostics);
    if (record.type === "evidence") validateEvidencePaths(record, displayPath, diagnostics);
    validateCoverage(record, displayPath, diagnostics);
    validateClassification(record, loaded, displayPath, diagnostics);
    validateCompletionDates(record, displayPath, diagnostics);
    validateReportingRouteBinding(record, loaded, displayPath, diagnostics);
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
    validateActionObligationRule(record, byId, displayPath, diagnostics);
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
  if (modelSupports(loaded.model, "document-workflow-scope")) {
    validateDocumentWorkflowScopes(loaded.resources, loaded.model, byId, pathById, diagnostics);
  }
  if (modelSupports(loaded.model, "rolled-up-obligations")) {
    validateObligationRuleSet(loaded.resources, pathById, diagnostics);
    validateAuditPopulationSet(loaded.resources, byId, pathById, diagnostics);
  }
  if (modelSupports(loaded.model, "reporting-routes")) {
    validateReportingRouteSet(loaded.resources, pathById, diagnostics, loaded.workspace?.timezone || "UTC");
  }
  if (modelSupports(loaded.model, "temporal-collection-reviews")) {
    validateCollectionReviewSet(loaded.resources, pathById, diagnostics);
  }
  if (modelSupports(loaded.model, "guided-workflow")) {
    const { planReconciliation } = await import("./reconciliation.js");
    const reconciliation = await planReconciliation(loaded);
    for (const candidate of reconciliation.candidates.filter(({ committedRevision }) => committedRevision)) {
      diagnostics.push(warning(
        "unreconciled-committed-transition",
        candidate.sourcePath,
        `${candidate.eventType} transition in Git commit ${candidate.committedRevision.slice(0, 8)} still needs confirmation or dismissal.`
      ));
    }
  }

  diagnostics.sort((a, b) => `${a.severity}:${a.path}:${a.code}`.localeCompare(`${b.severity}:${b.path}:${b.code}`));
  const result = {
    ok: !diagnostics.some(({ severity }) => severity === "error"),
    diagnostics,
    counts: {
      resources: loaded.resources.length,
      errors: diagnostics.filter(({ severity }) => severity === "error").length,
      warnings: diagnostics.filter(({ severity }) => severity === "warning").length
    }
  };
  Object.defineProperty(result, "loaded", {
    value: loaded,
    enumerable: false
  });
  return result;
}

function validateDocumentWorkflowScopes(resources, model, byId, pathById, diagnostics) {
  const managementFields = [
    "engagementTermsDocumentId",
    ...(model.auditReadiness?.managementDocuments || []).map(({ field }) => field)
  ];
  const auditReferences = new Map();
  const governedAuditReferences = new Map();
  const addAuditReference = (map, documentId, audit, field) => {
    if (!documentId) return;
    if (!map.has(documentId)) map.set(documentId, []);
    map.get(documentId).push({ audit, field });
  };
  for (const audit of resources.filter(({ type }) => type === "audit")) {
    for (const field of managementFields) {
      const documentId = audit[field];
      if (!documentId) continue;
      addAuditReference(auditReferences, documentId, audit, field);
      addAuditReference(governedAuditReferences, documentId, audit, field);
      const document = byId.get(documentId);
      if (document?.type === "document" && document.workflowScope !== "engagement") {
        diagnostics.push(error(
          "invalid-document-workflow-scope",
          pathById.get(audit.id) || `data/${audit.id}`,
          `${field} must reference an engagement-scoped Document; "${document.title}" is scoped to the program workflow.`
        ));
      }
    }
    for (const documentId of audit.supplementalDocumentIds || []) {
      addAuditReference(auditReferences, documentId, audit, "supplementalDocumentIds");
    }
  }

  const programDocumentReferences = new Map();
  const addProgramReference = (documentId, record, field) => {
    if (!documentId) return;
    if (!programDocumentReferences.has(documentId)) programDocumentReferences.set(documentId, []);
    programDocumentReferences.get(documentId).push({ record, field });
  };
  for (const policy of resources.filter(({ type }) => type === "policy")) {
    for (const documentId of policy.relatedDocumentIds || []) addProgramReference(documentId, policy, "relatedDocumentIds");
  }
  for (const obligation of resources.filter(({ type }) => type === "obligation")) {
    for (const documentId of obligation.scopeResourceIds || []) {
      if (byId.get(documentId)?.type === "document") addProgramReference(documentId, obligation, "scopeResourceIds");
    }
    if (byId.get(obligation.templateResourceId)?.type === "document") {
      addProgramReference(obligation.templateResourceId, obligation, "templateResourceId");
    }
  }

  for (const document of resources.filter(({ type }) => type === "document")) {
    const path = pathById.get(document.id) || `data/${document.id}`;
    const auditRefs = auditReferences.get(document.id) || [];
    const auditIds = new Set(auditRefs.map(({ audit }) => audit.id));
    const programRefs = programDocumentReferences.get(document.id) || [];
    if (document.workflowScope === "engagement" && programRefs.length) {
      const references = programRefs.map(({ record, field }) => `${record.id}.${field}`).join(", ");
      diagnostics.push(error(
        "engagement-document-in-program-workflow",
        path,
        `Engagement-scoped Document "${document.title}" cannot govern reusable program work through ${references}. Split the engagement deliverable from the program Document.`
      ));
    }
    if (
      document.workflowScope === "engagement"
      && ["approved", "active"].includes(document.status)
      && auditIds.size !== 1
    ) {
      diagnostics.push(error(
        "invalid-engagement-document-audit-count",
        path,
        `Approved or active engagement Document "${document.title}" must belong to exactly one Audit; found ${auditIds.size}.`
      ));
    }
    if (document.workflowScope === "program" && (governedAuditReferences.get(document.id) || []).length) {
      diagnostics.push(error(
        "program-document-in-engagement-workflow",
        path,
        `Program-scoped Document "${document.title}" cannot fill an Audit engagement or management-Document field.`
      ));
    }
    if (!["legacy-v4", "historical"].includes(document.activationBasis)) continue;
    const historicalAuditIds = new Set(auditRefs
      .filter(({ audit }) => ["issued", "delivered", "complete"].includes(audit.status))
      .map(({ audit }) => audit.id));
    if (document.workflowScope !== "engagement" || historicalAuditIds.size !== 1 || auditIds.size !== 1) {
      diagnostics.push(error(
        "invalid-legacy-document-activation",
        path,
        `The historical activation basis is reserved for an engagement Document tied to exactly one issued, delivered, or completed Audit.`
      ));
    }
  }

  for (const document of resources.filter(({ type, activationBasis }) => (
    type === "document" && activationBasis === "recorded"
  ))) {
    const invalidActorIds = (document.activatedByIds || []).filter((id) => (
      !personWasActiveOn(byId.get(id), document.activatedOn)
    ));
    if (invalidActorIds.length) {
      diagnostics.push(error(
        "invalid-document-activation-actor",
        pathById.get(document.id) || `data/${document.id}`,
        `Document activation actors must have been active on ${document.activatedOn}: ${invalidActorIds.join(", ")}.`
      ));
    }
  }
  for (const training of resources.filter(({ type, activationBasis }) => (
    type === "training" && activationBasis === "recorded"
  ))) {
    const invalidActorIds = (training.activatedByIds || []).filter((id) => (
      !personWasActiveOn(byId.get(id), training.activatedOn)
    ));
    if (invalidActorIds.length) {
      diagnostics.push(error(
        "invalid-training-activation-actor",
        pathById.get(training.id) || `data/${training.id}`,
        `Training activation actors must have been active on ${training.activatedOn}: ${invalidActorIds.join(", ")}.`
      ));
    }
  }
}

function validateObligationRule(record, model, byId, path, diagnostics) {
  const obligation = byId.get(record.obligationId);
  if (obligation?.type !== "obligation") return;
  validateObligation({
    ...obligation,
    recurrence: record.recurrence,
    window: record.window
  }, model, byId, path, diagnostics);
  if (record.selector?.resourceType) {
    const activity = obligation.activityType === "custom"
      ? { ...model.obligationActivities?.custom, ...obligation.customActivity }
      : model.obligationActivities?.[obligation.activityType];
    if (!activity?.aggregate?.completionMemberField) {
      diagnostics.push(error(
        "unbound-obligation-selector",
        path,
        `Selector-based ${obligation.activityType} rules need a model-defined completion member field and passing states.`
      ));
    }
    const selectedDefinition = model.resources[record.selector.resourceType];
    if (!selectedDefinition) return;
    const selectedFields = { ...model.commonFields, ...selectedDefinition.fields };
    const allowedStatuses = selectedFields.status?.values || [];
    const invalidStatuses = (record.selector.statuses || []).filter((status) => !allowedStatuses.includes(status));
    if (invalidStatuses.length) {
      diagnostics.push(error(
        "invalid-obligation-selector-status",
        path,
        `Selector statuses are not valid for ${record.selector.resourceType}: ${invalidStatuses.join(", ")}.`
      ));
    }
    const criticalityField = selectedFields.criticality;
    if ((record.selector.criticalities || []).length && !criticalityField) {
      diagnostics.push(error(
        "invalid-obligation-selector-criticality",
        path,
        `${record.selector.resourceType} records do not have a criticality field.`
      ));
    }
  }
  if (record.status === "active" && obligation.activeRuleId !== record.id) {
    diagnostics.push(error(
      "inactive-obligation-rule-binding",
      path,
      `Active rule "${record.id}" must be the activeRuleId on Obligation "${obligation.id}".`
    ));
  }
  if (
    record.approvedOn
    && record.effectiveAt
    && currentCalendarDate(record.timezone || "UTC", new Date(record.effectiveAt)) < record.approvedOn
  ) {
    diagnostics.push(error("backdated-obligation-rule", path, "effectiveAt cannot be before the management approval date."));
  }
  if (record.supersedesId) {
    const prior = byId.get(record.supersedesId);
    if (prior?.type === "obligation-rule" && prior.obligationId !== record.obligationId) {
      diagnostics.push(error("wrong-obligation-rule", path, "A rule may supersede only a rule for the same Obligation."));
    }
    if (!record.cutoverDecision) {
      diagnostics.push(error("missing-rule-cutover", path, "A superseding rule needs an explicit cutover decision for any open occurrence."));
    }
  }
}

function validateObligationOccurrence(record, model, resources, entries, root, workspaceTimezone, byId, asOf, path, diagnostics) {
  const members = record.members || [];
  const memberIds = members.map(({ resourceId }) => resourceId);
  if (new Set(memberIds).size !== memberIds.length) {
    diagnostics.push(error("duplicate-obligation-member", path, "An occurrence may contain each population member only once."));
  }
  const expected = members.filter(({ disposition }) => disposition === "expected");
  const completed = expected.filter(({ result }) => result === "passed");
  if (record.expectedCount !== expected.length || record.completedCount !== completed.length) {
    diagnostics.push(error(
      "invalid-obligation-occurrence-count",
      path,
      `expectedCount and completedCount must equal the reconciled member facts (${expected.length} expected, ${completed.length} passed).`
    ));
  }
  const rule = byId.get(record.ruleId);
  const obligation = byId.get(record.obligationId);
  if (record.collectionReviewId) {
    const review = byId.get(record.collectionReviewId);
    const reviewEntry = entries.find(({ record: candidate }) => candidate.id === record.collectionReviewId);
    const historicalSnapshot = historicalCollectionReviewSnapshot(
      root,
      review,
      model,
      workspaceTimezone,
      rule?.selector?.resourceType,
      record.membershipCutoffAt,
      rule?.selector,
      reviewEntry?.relativePath,
      record.collectionReviewCommit
    );
    const memberIds = [...(record.members || []).map(({ resourceId }) => resourceId)].sort();
    const reviewedIds = [...(historicalSnapshot?.selectedIds || [])].sort();
    const reviewCoversCutoff = review?.coverage?.kind === "as-of"
      ? review.coverage.on === record.membershipCutoffAt
      : review?.coverage?.kind === "range"
        && review.coverage.startsOn <= record.membershipCutoffAt
        && review.coverage.endsOn >= record.membershipCutoffAt;
    if (
      review?.type !== "collection-review"
      || !(review.scopeResourceIds || []).includes(record.programId)
      || !historicalSnapshot
      || record.collectionReviewCommit !== historicalSnapshot.reviewCommit
      || record.collectionReviewRevision !== collectionReviewRevision(review)
      || record.collectionRevision !== review.collectionRevision
      || record.scopeRevision !== review.scopeRevision
      || !reviewCoversCutoff
      || JSON.stringify(memberIds) !== JSON.stringify(reviewedIds)
    ) {
      diagnostics.push(error(
        "invalid-obligation-collection-review-binding",
        path,
        "A historical occurrence must bind the exact immutable Collection Review revision, scope, cutoff coverage, and reviewed population."
      ));
    }
  } else if (rule?.selector && record.membershipCutoffAt < asOf) {
    diagnostics.push(error(
      "missing-obligation-population-provenance",
      path,
      "A historical occurrence must bind an immutable Collection Review for its exact population cutoff."
    ));
  } else if (rule?.selector) {
    const selectedIds = selectScopedCollectionRecords(
      { resources, model },
      rule.selector,
      byId.get(record.programId)
    ).map(({ id }) => id).sort();
    if (JSON.stringify([...memberIds].sort()) !== JSON.stringify(selectedIds)) {
      diagnostics.push(error(
        "invalid-obligation-occurrence-population",
        path,
        "An occurrence without a historical Collection Review must contain the exact current selector population."
      ));
    }
  }
  if (record.supersedesId) {
    const prior = byId.get(record.supersedesId);
    if (
      prior?.type === "obligation-occurrence"
      && (
        prior.programId !== record.programId
        || prior.obligationId !== record.obligationId
        || prior.ruleId !== record.ruleId
        || prior.occurrenceKey !== record.occurrenceKey
        || JSON.stringify(prior.coverage) !== JSON.stringify(record.coverage)
        || prior.membershipCutoffAt !== record.membershipCutoffAt
        || prior.collectionReviewId !== record.collectionReviewId
        || prior.collectionReviewCommit !== record.collectionReviewCommit
        || prior.collectionReviewRevision !== record.collectionReviewRevision
        || prior.collectionRevision !== record.collectionRevision
        || prior.scopeRevision !== record.scopeRevision
      )
    ) {
      diagnostics.push(error(
        "wrong-obligation-occurrence-supersession",
        path,
        "An occurrence correction must preserve its predecessor's Program, Obligation, rule, key, coverage, and membership cutoff."
      ));
    }
  }
  const activity = obligation?.type === "obligation"
    ? obligation.activityType === "custom"
      ? { ...model.obligationActivities?.custom, ...(obligation.customActivity || {}) }
      : model.obligationActivities?.[obligation.activityType]
    : null;
  if (rule?.type === "obligation-rule" && rule.obligationId !== record.obligationId) {
    diagnostics.push(error("wrong-obligation-rule", path, "The occurrence rule must belong to the same Obligation."));
  }
  validateOccurrenceScheduleBinding(record, obligation, rule, resources, path, diagnostics);
  for (const member of members) {
    if (!byId.has(member.resourceId)) continue;
    const validCompletions = [];
    for (const completionId of member.completionResourceIds || []) {
      const completion = byId.get(completionId);
      if (!completion) {
        diagnostics.push(error("missing-member-completion-record", path, `Completion "${completionId}" does not exist.`));
        continue;
      }
      if (!activity?.completionResourceTypes.includes(completion.type)) {
        diagnostics.push(error(
          "wrong-member-completion-type",
          path,
          `Completion "${completionId}" has type "${completion.type}", which cannot satisfy ${obligation?.activityType || "this activity"}.`
        ));
        continue;
      }
      const memberField = activity.aggregate?.completionMemberField;
      const memberValue = memberField ? completion[memberField] : null;
      if (!memberField || (Array.isArray(memberValue) ? !memberValue.includes(member.resourceId) : memberValue !== member.resourceId)) {
        diagnostics.push(error(
          "wrong-member-completion",
          path,
          `Completion "${completionId}" does not belong to population member "${member.resourceId}".`
        ));
        continue;
      }
      if (!completionFallsInOccurrence(completion, record.coverage, rule?.timezone || "UTC")) {
        diagnostics.push(error(
          "completion-outside-occurrence",
          path,
          `Completion "${completionId}" does not fall inside this occurrence's coverage.`
        ));
        continue;
      }
      if (completionPassesObligationActivity(completion, activity)) validCompletions.push(completion);
    }
    if (member.result === "passed" && validCompletions.length === 0) {
      diagnostics.push(error(
        "missing-passing-member-completion",
        path,
        `Passed member "${member.resourceId}" needs a matching completion inside the occurrence window with an allowed passing status and result.`
      ));
    }
    if (member.disposition === "exception") {
      const exception = byId.get(member.exceptionId);
      const occurrenceStart = record.coverage?.kind === "as-of" ? record.coverage.on : record.coverage?.startsOn;
      const occurrenceEnd = record.coverage?.kind === "as-of" ? record.coverage.on : record.coverage?.endsOn;
      const exceptionCoversMember = exception?.scopeResourceIds?.includes(member.resourceId)
        || exception?.scopeResourceIds?.includes(record.obligationId);
      if (
        exception?.type !== "exception"
        || exception.status !== "approved"
        || !exceptionCoversMember
        || exception.approval?.approvedOn > occurrenceStart
        || exception.approval?.expiresOn < occurrenceEnd
      ) {
        diagnostics.push(error(
          "invalid-member-exception",
          path,
          `Exception member "${member.resourceId}" needs an approved Exception that covers the member or Obligation for the full occurrence.`
        ));
      }
    }
    if (member.disposition === "not-applicable" && !String(member.rationale || "").trim()) {
      diagnostics.push(error(
        "missing-member-non-applicability-rationale",
        path,
        `Non-applicable member "${member.resourceId}" needs the reviewed rationale for excluding it.`
      ));
    }
  }
  if (record.status !== "reconciled") {
    if (record.status === "open" && (record.conclusion || record.reconciledAt || (record.reviewedByIds || []).length)) {
      diagnostics.push(error("premature-obligation-conclusion", path, "Only a reconciled occurrence may record a conclusion, reconciliation time, or reviewers."));
    }
    return;
  }
  const reconciledOn = record.reconciledAt
    ? currentCalendarDate(rule?.timezone || "UTC", new Date(record.reconciledAt))
    : null;
  if (record.reconciledAt && new Date(record.reconciledAt) > new Date()) {
    diagnostics.push(error(
      "future-obligation-reconciliation",
      path,
      "An occurrence reconciliation time cannot be in the future."
    ));
  }
  const populationStillOpen = reconciledOn <= record.membershipCutoffAt;
  if (reconciledOn && populationStillOpen) {
    diagnostics.push(error(
      "obligation-population-still-open",
      path,
      `This occurrence cannot be reconciled before its ${record.membershipCutoffAt} population cutoff.`
    ));
  }
  if (record.conclusion === "zero-population" && members.length !== 0) {
    diagnostics.push(error("invalid-zero-population", path, "A zero-population conclusion requires an empty frozen population."));
  }
  if (record.conclusion === "complete" && record.completedCount !== record.expectedCount) {
    diagnostics.push(error("incomplete-obligation-occurrence", path, "A complete conclusion requires every expected member to pass."));
  }
  if (
    record.conclusion === "complete-with-exceptions"
    && members.some((member) => (
      (member.disposition === "expected" && member.result !== "passed")
      || (member.disposition === "exception" && !member.exceptionId)
    ))
  ) {
    diagnostics.push(error("incomplete-obligation-occurrence", path, "A complete-with-exceptions conclusion requires every expected member to pass and every exception to name its approved Exception."));
  }
}

function validateOccurrenceScheduleBinding(record, obligation, rule, resources, path, diagnostics) {
  if (obligation?.type !== "obligation" || rule?.type !== "obligation-rule") return;
  const start = record.coverage?.kind === "range" ? record.coverage.startsOn : null;
  if (!start || !validCalendarRecurrence(rule.recurrence)) return;
  const index = calendarOccurrenceIndex(rule.recurrence, start);
  const occurrence = calendarOccurrence(rule.recurrence, index);
  const next = calendarOccurrence(rule.recurrence, index + 1);
  const startOffset = rule.window?.precision === "date" && Number.isInteger(rule.window.startsAfter)
    ? rule.window.startsAfter
    : 0;
  const expectedStart = occurrence ? addCalendarDays(occurrence, startOffset) : null;
  const expectedEnd = rule.window?.precision === "date" && Number.isInteger(rule.window.dueAfter)
    ? addCalendarDays(occurrence, rule.window.dueAfter)
    : next ? addCalendarDays(next, -1) : null;
  const expectedCutoff = rule.selector?.cutoff === "window-end" ? expectedEnd : expectedStart;
  const program = resources.find(({ type, id }) => type === "program" && id === record.programId);
  const expectedKey = `${program?.id || "program"}:${obligation.id}:${expectedStart}`;
  const governingRule = resources
    .filter((candidate) => (
      candidate.type === "obligation-rule"
      && candidate.obligationId === obligation.id
      && ["active", "retired"].includes(candidate.status)
      && candidate.effectiveAt
      && expectedStart
      && currentCalendarDate(candidate.timezone || "UTC", new Date(candidate.effectiveAt)) <= expectedStart
    ))
    .sort((left, right) => right.effectiveAt.localeCompare(left.effectiveAt))[0];
  if (
    expectedStart !== start
    || record.coverage.endsOn !== expectedEnd
    || record.membershipCutoffAt !== expectedCutoff
    || record.occurrenceKey !== expectedKey
    || record.programId !== program?.id
    || governingRule?.id !== rule.id
    || JSON.stringify([...(record.ownerIds || [])].sort()) !== JSON.stringify([...(obligation.ownerIds || [])].sort())
  ) {
    diagnostics.push(error(
      "invalid-obligation-occurrence-schedule-binding",
      path,
      "The occurrence must bind the exact governing rule, Program, schedule window, population cutoff, key, and owners."
    ));
  }
}

function completionPassesObligationActivity(record, activity) {
  const aggregate = activity?.aggregate;
  if (!aggregate) return true;
  if (aggregate.passingStatuses?.length && !aggregate.passingStatuses.includes(record.status)) return false;
  if (aggregate.passingResults?.length) {
    const result = record.decision ?? record.outcome ?? record.result;
    if (!aggregate.passingResults.includes(result)) return false;
  }
  return true;
}

function completionFallsInOccurrence(record, coverage, timezone = "UTC") {
  const date = completionDateForOccurrence(record, timezone);
  if (!date || !coverage) return false;
  if (coverage.kind === "as-of") return date === coverage.on;
  return coverage.kind === "range" && date >= coverage.startsOn && date <= coverage.endsOn;
}

function completionDateForOccurrence(record, timezone = "UTC") {
  for (const field of COMPLETION_TIMESTAMP_FIELDS) {
    if (isRfc3339Timestamp(record[field])) return currentCalendarDate(timezone, new Date(record[field]));
  }
  for (const field of COMPLETION_DATE_FIELDS) {
    if (parseCalendarDate(record[field])) return record[field];
  }
  const coverage = record.coverage;
  const coverageDate = coverage?.kind === "as-of" ? coverage.on : coverage?.endsOn;
  if (parseCalendarDate(coverageDate)) return coverageDate;
  return null;
}

function validateObligationRuleSet(resources, pathById, diagnostics) {
  const activeByObligation = new Map();
  const currentOccurrences = new Map();
  const rulesById = new Map(resources.filter(({ type }) => type === "obligation-rule").map((record) => [record.id, record]));
  const supersedingRulesByPriorId = new Map();
  for (const rule of rulesById.values()) {
    if (!rule.supersedesId) continue;
    if (!supersedingRulesByPriorId.has(rule.supersedesId)) supersedingRulesByPriorId.set(rule.supersedesId, []);
    supersedingRulesByPriorId.get(rule.supersedesId).push(rule);
  }
  for (const record of resources) {
    if (record.type === "obligation-rule" && record.status === "active") {
      const prior = activeByObligation.get(record.obligationId);
      if (prior) diagnostics.push(error(
        "multiple-active-obligation-rules",
        pathById.get(record.id),
        `Obligation "${record.obligationId}" has multiple active rules: ${prior.id}, ${record.id}.`
      ));
      else activeByObligation.set(record.obligationId, record);
    }
    if (record.type === "obligation-occurrence" && record.status !== "superseded") {
      const prior = currentOccurrences.get(record.occurrenceKey);
      if (prior) diagnostics.push(error(
        "multiple-current-obligation-occurrences",
        pathById.get(record.id),
        `Occurrence key "${record.occurrenceKey}" has multiple current reconciliations: ${prior.id}, ${record.id}.`
      ));
      else currentOccurrences.set(record.occurrenceKey, record);
      if (
        record.status === "open"
        && (supersedingRulesByPriorId.get(record.ruleId) || []).some((rule) => (
          rule.obligationId === record.obligationId && rule.cutoverDecision === "supersede-open-window"
        ))
      ) {
        diagnostics.push(error(
          "open-occurrence-after-rule-cutover",
          pathById.get(record.id),
          `Occurrence "${record.id}" remains open even though its rule cutover selected supersede open occurrences.`
        ));
      }
    }
  }
}

function validateAuditPopulationSet(resources, byId, pathById, diagnostics) {
  const current = new Map();
  for (const record of resources.filter(({ type }) => type === "audit-population")) {
    if (record.supersedesId) {
      const prior = byId.get(record.supersedesId);
      if (
        prior?.type === "audit-population"
        && (prior.auditId !== record.auditId || prior.populationKind !== record.populationKind)
      ) {
        diagnostics.push(error(
          "wrong-audit-population-supersession",
          pathById.get(record.id),
          "An Audit population correction must keep the same Audit and population kind as its predecessor."
        ));
      }
    }
    if (record.status === "superseded") continue;
    const key = `${record.auditId}:${record.populationKind}`;
    const prior = current.get(key);
    if (prior) {
      diagnostics.push(error(
        "multiple-current-audit-populations",
        pathById.get(record.id),
        `Audit "${record.auditId}" has multiple current ${record.populationKind} populations: ${prior.id}, ${record.id}.`
      ));
    } else current.set(key, record);
  }
}

function validateReportingRouteSet(resources, pathById, diagnostics, timezone) {
  const routes = resources.filter((record) => (
    record.type === "reporting-route" && ["active", "retired"].includes(record.status)
  ));
  for (const route of routes) {
    const effectiveAt = new Date(route.effectiveAt).getTime();
    const approvedAt = route.approvedOn
      ? new Date(timestampFromLocalDateTime(`${route.approvedOn}T00:00:00`, timezone)).getTime()
      : null;
    const endsAt = route.endsAt ? new Date(route.endsAt).getTime() : null;
    if (approvedAt !== null && effectiveAt < approvedAt) {
      diagnostics.push(error("invalid-reporting-route-order", pathById.get(route.id), "A Reporting Route cannot become effective before its approval date."));
    }
    if (endsAt !== null && endsAt <= effectiveAt) {
      diagnostics.push(error("invalid-reporting-route-order", pathById.get(route.id), "A Reporting Route must end after it becomes effective."));
    }
    if (
      !localDateTimeValue(new Date(route.effectiveAt), timezone).endsWith("T00:00:00")
      || (route.endsAt && !localDateTimeValue(new Date(route.endsAt), timezone).endsWith("T00:00:00"))
    ) {
      diagnostics.push(error(
        "ambiguous-reporting-route-cutover",
        pathById.get(route.id),
        `Reporting Route cutovers must use midnight in ${timezone} so date-bound assignments resolve one route for the full day.`
      ));
    }
  }
  for (let index = 0; index < routes.length; index += 1) {
    for (let next = index + 1; next < routes.length; next += 1) {
      const left = routes[index];
      const right = routes[next];
      if (left.purpose !== right.purpose || left.priority !== right.priority) continue;
      const leftEnd = left.endsAt ? new Date(left.endsAt).getTime() : Number.POSITIVE_INFINITY;
      const rightEnd = right.endsAt ? new Date(right.endsAt).getTime() : Number.POSITIVE_INFINITY;
      if (new Date(left.effectiveAt).getTime() < rightEnd && new Date(right.effectiveAt).getTime() < leftEnd) {
        diagnostics.push(error(
          "overlapping-reporting-routes",
          pathById.get(right.id),
          `Reporting routes "${left.id}" and "${right.id}" overlap for ${left.purpose}/${left.priority}.`
        ));
      }
    }
  }
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
  const program = modelSupports(model, "program-scope")
    ? (record.scopeResourceIds || []).map((id) => byId.get(id)).find(({ type } = {}) => type === "program")
    : null;
  const recordCount = scopedCollectionRecords(loaded, record.resourceType, program).length;
  const currentPopulationIds = scopedCollectionRecords(loaded, record.resourceType, program)
    .map(({ id }) => id)
    .sort();
  const currentRevision = collectionRevision(loaded, record.resourceType, {
    program,
    authoritativeSourceId: record.decision === "externally-managed"
      ? record.authoritativeComponentId || record.authoritativeSystemId
      : null
  });
  const current = collectionRevisionMatches(
    loaded,
    record.resourceType,
    record.collectionRevision,
    {
      program,
      authoritativeSourceId: record.decision === "externally-managed"
        ? record.authoritativeComponentId || record.authoritativeSystemId
        : null,
      currentRevision
    }
  );
  if (modelSupports(model, "temporal-collection-reviews")) {
    const temporalValues = [record.coverage, record.knowledgeCutoffAt, record.populationResourceIds];
    const hasTemporalBinding = temporalValues.every((value) => value !== undefined && value !== null);
    if (temporalValues.some((value) => value !== undefined && value !== null) && !hasTemporalBinding) {
      diagnostics.push(error(
        "incomplete-collection-review-binding",
        path,
        "A temporal Collection Review must record coverage, a knowledge cutoff, and the reviewed population together."
      ));
    } else if (hasTemporalBinding && (
      !hasGitRevision(loaded.root, record.scopeRevision)
      || record.coverage.kind !== "as-of"
      || record.coverage.on !== record.reviewedOn
      || !isRfc3339Timestamp(record.knowledgeCutoffAt)
      || currentCalendarDate(loaded.workspace.timezone, new Date(record.knowledgeCutoffAt)) !== record.reviewedOn
      || (current && JSON.stringify([...record.populationResourceIds].sort()) !== JSON.stringify(currentPopulationIds))
    )) {
      diagnostics.push(error(
        "invalid-current-collection-review",
        path,
        "A temporal Collection Review must bind its review date to a retrievable Git scope revision and the exact reviewed population."
      ));
    }
    if (hasTemporalBinding) {
      const head = getGitSummary(loaded.root).commit;
      const committed = head
        && getFileObjectIdAtRevision(loaded.root, head, path) === getWorkingFileObjectId(loaded.root, path);
      const cutoff = new Date(record.knowledgeCutoffAt);
      const now = new Date();
      if (!committed && (
        currentCalendarDate(loaded.workspace.timezone, now) !== record.reviewedOn
        || now.getTime() - cutoff.getTime() > 86_400_000
      )) {
        diagnostics.push(error(
          "stale-uncommitted-collection-review",
          path,
          "Commit a temporal Collection Review on its review date and within 24 hours of its knowledge cutoff, or create a new current review."
        ));
      }
    }
  }
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
      `${configuration.title} must name an active authoritative ${modelSupports(model, "component-sources") ? "Component" : "System"} for an externally managed conclusion.`
    ));
  }
}

function validateCollectionReviewSet(resources, pathById, diagnostics) {
  const current = new Map();
  for (const review of resources.filter((record) => record.type === "collection-review" && record.status !== "retired")) {
    const programId = (review.scopeResourceIds || []).find((id) => (
      resources.find((record) => record.id === id)?.type === "program"
    )) || "workspace";
    const key = `${programId}:${review.resourceType}`;
    const prior = current.get(key);
    if (prior) {
      diagnostics.push(error(
        "multiple-current-collection-reviews",
        pathById.get(review.id),
        `Program "${programId}" has multiple current ${review.resourceType} Collection Reviews: ${prior.id}, ${review.id}. Retire or supersede the duplicate.`
      ));
    } else current.set(key, review);
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
      ? obligationCompletionTypes(model, obligation)
      : [];
    if (!expectedTypes.length) continue;
    const completionIds = modelSupports(model, "guided-workflow")
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

function validateActionObligationRule(record, byId, path, diagnostics) {
  if (record.type !== "action-item" || !record.obligationId) return;
  const event = byId.get(record.sourceResourceId);
  const obligation = byId.get(record.obligationId);
  if (event?.type !== "obligation-event" || obligation?.type !== "obligation" || obligation.scheduleMode !== "rule") return;
  const rule = byId.get(record.obligationRuleId);
  const eventInstant = event.occurredAt
    ? new Date(event.occurredAt)
    : new Date(timestampFromLocalDateTime(`${event.occurredOn}T23:59:59`, rule?.timezone || "UTC"));
  const governingRule = [...byId.values()]
    .filter((candidate) => (
      candidate.type === "obligation-rule"
      && candidate.obligationId === obligation.id
      && ["active", "retired"].includes(candidate.status)
      && candidate.effectiveAt
      && new Date(candidate.effectiveAt) <= eventInstant
    ))
    .sort((left, right) => right.effectiveAt.localeCompare(left.effectiveAt))[0];
  if (rule?.type !== "obligation-rule" || rule.obligationId !== obligation.id || governingRule?.id !== rule.id) {
    diagnostics.push(error(
      "invalid-action-obligation-rule",
      path,
      "An event Action Item must bind the exact Obligation Rule that governed its event time."
    ));
  }
}

function validateCompletedObligationAction(record, byId, model, path, diagnostics) {
  if (
    !modelSupports(model, "guided-workflow")
    || record.status !== "done"
    || !record.obligationId
  ) return;
  const obligation = byId.get(record.obligationId);
  if (obligation?.type !== "obligation") return;
  const expectedTypes = obligationCompletionTypes(model, obligation);
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
  const activity = record.activityType === "custom"
    ? { ...model.obligationActivities?.custom, ...record.customActivity }
    : model.obligationActivities?.[record.activityType];
  if (record.activityType === "custom") {
    const invalidTypes = (record.customActivity?.completionResourceTypes || []).filter((type) => !model.resources[type]);
    if (invalidTypes.length) {
      diagnostics.push(error(
        "invalid-obligation-activity",
        path,
        `customActivity.completionResourceTypes contains unknown resource types: ${invalidTypes.join(", ")}.`
      ));
    }
  }
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
    if (!model.policyEvents?.[recurrence.eventType] && !modelSupports(model, "custom-obligations")) {
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

function validateRetentionScheduleItem(record, loaded, byId, currentReviewRevisions, path, diagnostics) {
  if (record.status !== "active") return;
  const schedule = byId.get(record.scheduleDocumentId);
  if (schedule?.type !== "document" || schedule.documentKind !== "schedule" || schedule.workflowScope !== "program" || ["superseded", "retired"].includes(schedule.status)) {
    diagnostics.push(error(
      "invalid-retention-schedule-document",
      path,
      "scheduleDocumentId must reference a current program Document whose documentKind is schedule."
    ));
  }
  const sources = retentionReviewResourceIds(record, loaded);
  const revisions = record.reviewedSourceRevisions || {};
  const missing = sources.filter((id) => (
    !currentReviewRevisions.get(id) || revisions[id] !== currentReviewRevisions.get(id)
  )).concat(Object.keys(revisions).filter((id) => !sources.includes(id)));
  if (missing.length) {
    diagnostics.push(error(
      "stale-retention-review",
      path,
      `reviewedSourceRevisions must bind the schedule Document, Information Types, operational scope, and authority or source records before activation: ${missing.join(", ")}.`
    ));
  }
}

function validateRequirementMapping(record, currentReviewRevisions, path, diagnostics) {
  const overlap = (record.sourceResourceIds || []).filter((id) => (record.targetResourceIds || []).includes(id));
  if (overlap.length) {
    diagnostics.push(error(
      "invalid-requirement-mapping",
      path,
      `A Requirement Mapping cannot place the same record on both sides: ${[...new Set(overlap)].join(", ")}.`
    ));
  }
  if (record.status !== "active") return;
  const mappedIds = [...new Set([...(record.sourceResourceIds || []), ...(record.targetResourceIds || [])])];
  const revisions = record.reviewedSourceRevisions || {};
  const missing = mappedIds.filter((id) => (
    !currentReviewRevisions.get(id) || revisions[id] !== currentReviewRevisions.get(id)
  )).concat(Object.keys(revisions).filter((id) => !mappedIds.includes(id)));
  if (missing.length) {
    diagnostics.push(error(
      "stale-requirement-mapping",
      path,
      `reviewedSourceRevisions must bind every mapped resource before activation: ${missing.join(", ")}.`
    ));
  }
}

function obligationCompletionTypes(model, obligation) {
  if (obligation.activityType === "custom") return obligation.customActivity?.completionResourceTypes || [];
  return model.obligationActivities?.[obligation.activityType]?.completionResourceTypes || [];
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
  if (["document", "training"].includes(record.type) && record.activatedOn) {
    validateOrderedDates(record, path, diagnostics, ["approvedOn", "activatedOn", "effectiveOn"]);
  }
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

function validateReportingRouteBinding(record, loaded, path, diagnostics) {
  if (
    record.type !== "attestation"
    || record.status !== "completed"
    || !loaded.model.resources.attestation?.fields?.reportingRouteId
  ) return;
  const date = record.assignedOn || record.completedOn;
  if (!date) return;
  const cutoff = timestampFromLocalDateTime(`${date}T23:59:59`, loaded.workspace.timezone);
  const route = loaded.entries
    .filter(({ record: candidate }) => (
      candidate.type === "reporting-route"
      && ["active", "retired"].includes(candidate.status)
      && candidate.purpose === "security-reporting"
      && candidate.priority === "primary"
      && new Date(candidate.effectiveAt) <= new Date(cutoff)
      && (!candidate.endsAt || new Date(candidate.endsAt) > new Date(cutoff))
    ))
    .sort((left, right) => right.record.effectiveAt.localeCompare(left.record.effectiveAt))[0] || null;
  const expectedId = route?.record.id;
  const expectedRevision = route ? reportingRouteRevision(route.record) : undefined;
  if (record.reportingRouteId !== expectedId || record.reportingRouteRevision !== expectedRevision) {
    diagnostics.push(error(
      "invalid-reporting-route-binding",
      path,
      route
        ? `A completed Attestation must bind the primary security reporting route effective on ${date} and its exact revision.`
        : `A completed Attestation cannot claim a reporting route when none was effective on ${date}.`
    ));
  }
}

async function validateApprovalBinding(record, model, root, path, diagnostics) {
  const bindingFields = contentBindingFields(record, model);
  for (const binding of bindingFields) {
    await validateContentBinding(record, model, root, path, diagnostics, binding);
  }
}

async function validateContentBinding(record, model, root, path, diagnostics, binding) {
  const { field: bindingField, bound, label } = binding;
  if (!bound(record) || !record[bindingField]) return;
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
      `${label} content no longer matches ${invalid.map((item) => `data/${item}`).join(", ")}. Move the record to draft or in-review, review the change, then approve and activate it again.`
    ));
  }
}

function approvalBound(record, model) {
  if (record.type === "policy") return ["approved", "active", "superseded", "retired"].includes(record.status);
  if (record.type === "document") return ["approved", "active", "superseded", "retired"].includes(record.status);
  if (record.type === "training") {
    return (modelSupports(model, "governed-training-activation")
      ? ["approved", "active", "superseded", "retired"]
      : ["active", "retired"]).includes(record.status);
  }
  return false;
}

function contentBindingFields(record, model) {
  const fields = [];
  if (["policy", "document"].includes(record.type)) {
    fields.push({ field: "approvedContentRevisions", bound: (candidate) => approvalBound(candidate, model), label: "Approved" });
  }
  if (record.type === "document" && model.resources.document?.fields?.activatedContentRevisions) {
    fields.push({
      field: "activatedContentRevisions",
      bound: (candidate) => ["active", "superseded", "retired"].includes(candidate?.status),
      label: "Activated"
    });
  }
  if (record.type === "training" && model.resources.training?.fields?.effectiveContentRevisions) {
    fields.push({ field: "effectiveContentRevisions", bound: (candidate) => approvalBound(candidate, model), label: "Approved" });
  }
  if (record.type === "training" && model.resources.training?.fields?.approvedContentRevisions) {
    fields.push({ field: "approvedContentRevisions", bound: (candidate) => approvalBound(candidate, model), label: "Approved" });
  }
  if (record.type === "training" && model.resources.training?.fields?.activatedContentRevisions) {
    fields.push({
      field: "activatedContentRevisions",
      bound: (candidate) => ["active", "superseded", "retired"].includes(candidate?.status),
      label: "Activated"
    });
  }
  return fields;
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
  if (modelSupports(loaded.model, "program-scope")) {
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
