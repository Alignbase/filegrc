import { governedContentBaseline, governedApprovalContentMatches, governedContentSource, governedMarkdownSource, governedContentHasOperatingHistory, registerGovernedLookup } from "./governed-content-baseline.js";
import { recordBelongsToProgram, recordProgramRelationships } from "./program.js";
import { assessCollectionReview } from "./collection-review.js";
import { reviewHistoryContext } from "./historical-workspace.js";
import { resourceDataPath } from "./resource-markdown.js";
import { calculationMemo } from "./calculation-cache.js";
import { modelSupports } from "../model/index.js";
import { currentCalendarDate } from "./time.js";
import { applicationCoversUse, retentionUseWasIndependentlyReviewed } from "./retention-applications.js";
import { openPlaceholderCount, substantiveMarkdown } from "./content-readiness.js";
import { markdownEntries } from "./resource-markdown.js";
import { currentPartyPeople } from "./parties.js";
import {
  nearDuplicateInformationTypes,
  resourceReviewRevisionsSync,
  retentionReviewResourceIds,
  retentionRuleIsCurrent,
  retentionUses
} from "./retention.js";
import { calculateRevision, revisionsMatch } from "./revisions.js";

function isProgramRetentionSchedule(record) {
  return record?.type === "document" && record.documentKind === "schedule" && record.workflowScope === "program";
}

// The whole-schedule assessor hashes the parent as a source. During that one
// synchronous proof calculation, nested parent lookup verifies its own content
// binding without starting the same whole-schedule calculation again.
const operatingProofCalculations = new WeakSet();
export function retentionScheduleOperatingProofMatches(loaded, record, asOf = currentCalendarDate(loaded.workspace?.timezone || "UTC")) {
  if (!isProgramRetentionSchedule(record) || !modelSupports(loaded.model, "retention-schedule-approval")) return true;
  if (operatingProofCalculations.has(loaded.resources)) return true;
  const schedules = calculationMemo(loaded.resources, "operating-proof-schedules", [], () => loaded.resources.filter(isProgramRetentionSchedule));
  const pending = new Set();
  const lineage = new Set([record.id]);
  for (let changed = true; changed;) {
    changed = false;
    for (const item of schedules) {
      if (!lineage.has(item.supersedesId) || lineage.has(item.id)) continue;
      if (!["draft", "in-review", "proposed", "approved"].includes(item.status)
        && !(item.effectiveOn > asOf) && !(item.activatedOn > asOf)) continue;
      lineage.add(item.id); pending.add(item.id); changed = true;
    }
  }
  const source = calculationMemo(loaded.entries || loaded.resources, "operating-proof-source-context", [], () => ({
    revision: calculateRevision("content", JSON.stringify(loaded.entries?.map((entry) => [entry.record.id, entry.source || null, entry.reviewCommit || null])
      || loaded.resources)),
    files: loaded.entries?.filter((entry) => entry.reviewFiles).map((entry) => entry.reviewFiles) || []
  }));
  return calculationMemo(loaded.resources, "operating-schedule-proof", [record.id, loaded.root, loaded.model.modelVersion,
    loaded.historicalCommit || null, loaded.historicalFiles || null, source.revision, ...source.files, [...pending].sort().join("\0")], () =>
    calculateOperatingScheduleProof(loaded, record, pending));
}

function calculateOperatingScheduleProof(loaded, record, pending) {
  operatingProofCalculations.add(loaded.resources);
  try {
    const include = (item) => !pending.has(item.id)
      && !(item.type === "retention-schedule-item" && pending.has(item.scheduleDocumentId));
    const resources = pending.size ? loaded.resources.filter(include) : loaded.resources;
    const entries = loaded.entries ? loaded.entries.filter(({ record: item }) => include(item))
      : resources.map((item) => ({ record: item, source: JSON.stringify(item), relativePath: resourceDataPath(loaded.model, item) }));
    const input = pending.size || !loaded.entries ? { ...loaded, resources, entries } : loaded;
    if (input !== loaded) operatingProofCalculations.add(input.resources);
    try {
      const byId = new Map(resources.map((item) => [item.id, item]));
      const programs = resources.filter((item) => item.type === "program" && item.status !== "retired");
      const scope = recordProgramRelationships(record, byId);
      const owners = programs.filter((program) => recordBelongsToProgram(record, program, byId, loaded.model));
      if (!owners.length || owners.length > 1 && ![scope.programIds, scope.controlIds, scope.systemIds, scope.policyIds].some((ids) => ids.length)) return false;
      if (scope.programIds.some((id) => !owners.some((program) => program.id === id))
        || scope.controlIds.some((id) => !owners.some((program) => (program.controlIds || []).includes(id)))) return false;
      return owners.every((program) => Boolean(assessCollectionReview(input, "retention-schedule-item", { programId: program.id })?.complete));
    } finally { if (input !== loaded) operatingProofCalculations.delete(input.resources); }
  } finally { operatingProofCalculations.delete(loaded.resources); }
}

export function retentionScheduleOperatingHistoryIds(loaded, record) {
  if (!isProgramRetentionSchedule(record) || !loaded.root) return [];
  return calculationMemo(loaded, "operating-schedule-history-ids", [record.id], () => {
    const context = reviewHistoryContext(loaded.root, loaded);
    const records = [...loaded.resources];
    if (context.index?.available) {
      for (const changed of context.index.recordsByCommit.values()) {
        for (const item of changed.values()) records.push(item.record);
      }
    }
    const rows = new Set(records.filter((item) => item.type === "retention-schedule-item"
      && item.scheduleDocumentId === record.id).map(({ id }) => id));
    const reviews = records.filter((item) => item.type === "collection-review" && item.resourceType === "retention-schedule-item"
      && (item.populationResourceIds || []).some((id) => rows.has(id)));
    return [...rows, ...reviews.map(({ id }) => id)];
  });
}

export function retentionScheduleApprovalIssues(loaded, program, rows, options = {}) {
  const byId = registerGovernedLookup(new Map(loaded.resources.map((record) => [record.id, record])), loaded);
  const issues = [];
  const planned = rows.filter(({ status }) => status === "planned");
  if (planned.length) {
    issues.push(issue("planned-retention-schedule-row", `Complete or retire every planned retention row before approving the schedule revision: ${planned[0].title}.`));
  }
  const schedules = loaded.resources.filter((record) => (
    record.type === "document"
    && record.documentKind === "schedule"
    && record.workflowScope === "program"
    && !["superseded", "retired"].includes(record.status)
  ));
  if (!schedules.length) {
    issues.push(issue("missing-retention-schedule-document", "Add the Data Retention Schedule document before requesting approval of the complete schedule."));
  }
  if (schedules.length !== 1) {
    if (schedules.length) {
      issues.push(issue("multiple-retention-schedule-documents", "Keep exactly one current program Data Retention Schedule document before approving the schedule revision."));
    }
  }
  const schedule = schedules.length === 1 ? schedules[0] : null;
  const scheduleContent = schedule ? primaryMarkdown(loaded, schedule) : "";
  const linkedControl = schedule && (schedule.controlIds || []).some((id) => (program.controlIds || []).includes(id));
  if (
    schedule
    && (currentPartyPeople(schedule.ownerIds || [], byId).size === 0
    || !linkedControl
    || !substantiveMarkdown(scheduleContent)
    || openPlaceholderCount(scheduleContent) > 0)
  ) {
    issues.push(issue("incomplete-retention-schedule-document", "Complete the Data Retention Schedule document, its owner, linked Control, and Markdown before requesting approval of the complete schedule.", schedule.id));
  }
  if (
    schedule
    && options.approvalReview
    && (!["approved", "active"].includes(schedule.status)
    || schedule.approvedOn !== options.approvalReview.reviewedOn
    || !sameIds(schedule.approverIds, options.approvalReview.reviewedByIds)
    || !approvalBindingsMatch(loaded, schedule))
  ) {
    issues.push(issue("invalid-retention-schedule-approval-binding", "The Data Retention Schedule document no longer matches the recorded whole-schedule approval. Review and approve the current complete schedule again."));
  }
  const activeRows = rows.filter(({ status }) => status === "active");
  const mismatched = schedule
    ? activeRows.filter(({ scheduleDocumentId }) => scheduleDocumentId !== schedule.id)
    : [];
  if (mismatched.length) {
    issues.push(issue("retention-row-wrong-schedule-document", `Link every active retention row to the current Data Retention Schedule document before approval: ${mismatched[0].title}.`, mismatched[0].id));
  }
  const revisions = resourceReviewRevisionsSync(
    loaded,
    activeRows.flatMap((row) => retentionReviewResourceIds(row, loaded))
  );
  const incomplete = activeRows.filter((row) => !retentionRuleIsCurrent(row, revisions, byId, loaded));
  if (incomplete.length) {
    issues.push(issue("incomplete-retention-schedule-row", `Complete the retention decisions before approving the schedule revision: ${incomplete[0].title}.`, incomplete[0].id));
  }
  const proposedRows = rows.filter(rowProposesCoverage);
  const scopedPrograms = program.programIds
    ? program.programIds.map((id) => byId.get(id)).filter((record) => record?.type === "program")
    : [program];
  const uncovered = scopedPrograms.flatMap((candidate) => (
    retentionUses(loaded, candidate).map((use) => ({ ...use, programId: candidate.id }))
  )).find((use) => !applicationCoversUse(loaded, use, use.programId) && (!proposedRows.some((row) => (
    (row.informationTypeIds || []).includes(use.informationTypeId)
    && ((row.scopeResourceIds || []).includes(use.resource.id) || (row.scopeResourceIds || []).includes(use.programId))
  )) || options.approvalReview && !retentionUseWasIndependentlyReviewed(loaded, use, use.programId)));
  if (uncovered) {
    issues.push(issue(
      "uncovered-retention-information-use",
      `${uncovered.resource.title} uses ${byId.get(uncovered.informationTypeId)?.title || uncovered.informationTypeId}, needs a reviewed retention decision for this type and scope. Apply an unchanged independently approved rule through apply-retention-rule, or propose a material rule change for independent approval.`
    ));
  }
  if (nearDuplicateInformationTypes(loaded.resources).length && !options.informationTypesReviewed) {
    issues.push(issue("unreviewed-similar-information-types", "Review similar Information Types before approving the Data Retention Schedule."));
  }
  return issues;
}

function sameIds(left = [], right = []) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function issue(code, message, resourceId) {
  return { code, message, ...(resourceId ? { resourceId } : {}) };
}

function primaryMarkdown(loaded, record) {
  const definition = loaded.model.resources[record.type];
  const selected = markdownEntries(loaded.model, record).find((entry) => (
    definition.markdown?.[entry.name]?.primary || entry.name === loaded.model.recordContent?.slot
  ));
  if (!selected) return "";
  try {
    return governedMarkdownSource(loaded, record, selected.path) || "";
  } catch {
    return "";
  }
}

function rowProposesCoverage(row) {
  return Boolean(
    (row.informationTypeIds || []).length
    && (row.scopeResourceIds || []).length
    && row.scheduleDocumentId
  );
}

function approvalBindingsMatch(loaded, record) {
  const actual = {};
  for (const entry of markdownEntries(loaded.model, record)) {
    try {
      const source = governedMarkdownSource(loaded, record, entry.path);
      if (typeof source === "string") actual[entry.path] = calculateRevision("content", source);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const expected = record.approvedContentRevisions || {};
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  return actualKeys.length === expectedKeys.length
    && actualKeys.every((key, index) => (
      key === expectedKeys[index] && revisionsMatch("content", actual[key], expected[key])
    ));
}

// Proposed schedule successors remain review work. The operating authority uses
// only the exact live schedule and its rows, while retaining today's source,
// inventory and source facts so a real material change cannot reuse stale approval.
export function operatingRetentionScheduleWorkspace(loaded, asOf = currentCalendarDate(loaded.workspace?.timezone || "UTC")) {
  if (!modelSupports(loaded.model, "operating-preparation")) return loaded;
  const byId = registerGovernedLookup(new Map(loaded.resources.map((record) => [record.id, record])), loaded);
  const excluded = new Set();
  const replacements = new Map();
  const proposedRowSchedules = new Set();
  const affectedRowIds = new Set();
  for (const schedule of loaded.resources.filter((record) => record.type === "document"
    && record.documentKind === "schedule" && record.workflowScope === "program")) {
    const baseline = governedContentBaseline(schedule, byId, asOf, loaded.model,
      { contentMatches: (record) => governedApprovalContentMatches(loaded, record) });
    if (!baseline && (schedule.status === "active" || governedContentHasOperatingHistory(loaded, schedule))) {
      // An actual claimed cutover with invalid activation cannot use an old
      // whole-schedule approval merely because the proposed bytes match it.
      excluded.add(schedule.id);
      continue;
    }
    if (baseline?.documentKind !== "schedule" || baseline.workflowScope !== "program") continue;
    if (baseline.id !== schedule.id) { excluded.add(schedule.id); continue; }
    if (baseline === schedule) continue;
    const source = governedContentSource(loaded, baseline);
    if (!source.commit || !source.loaded) continue;
    const approvedRows = source.loaded.resources.filter((record) => record.type === "retention-schedule-item"
      && record.scheduleDocumentId === baseline.id);
    const rowIds = new Set(approvedRows.map(({ id }) => id));
    for (const row of loaded.resources.filter((record) => record.type === "retention-schedule-item"
      && record.scheduleDocumentId === schedule.id)) rowIds.add(row.id);
    for (const id of rowIds) affectedRowIds.add(id);
    const approvedReviews = source.loaded.resources.filter((record) => record.type === "collection-review"
      && record.resourceType === "retention-schedule-item"
      && (record.populationResourceIds || []).some((id) => rowIds.has(id)));
    for (const record of [baseline, ...approvedRows, ...approvedReviews]) {
      const entry = source.loaded.entries?.find((item) => item.record.id === record.id);
      replacements.set(record.id, { ...(entry || {}), record, source: entry?.source || JSON.stringify(record),
        reviewCommit: source.commit, reviewFiles: source.loaded.historicalFiles });
    }
    proposedRowSchedules.add(schedule.id);
  }
  if (!excluded.size && !replacements.size) return loaded;
  const include = (record) => !excluded.has(record.id)
    && !(record.type === "retention-schedule-item" && (excluded.has(record.scheduleDocumentId)
      || proposedRowSchedules.has(record.scheduleDocumentId)))
    && !(record.type === "collection-review" && record.resourceType === "retention-schedule-item"
      && (record.populationResourceIds || []).some((id) => affectedRowIds.has(id)))
    && !replacements.has(record.id);
  return { ...loaded,
    resources: [...loaded.resources.filter(include), ...[...replacements.values()].map(({ record }) => record)],
    entries: [...loaded.entries.filter(({ record }) => include(record)), ...replacements.values()] };
}
