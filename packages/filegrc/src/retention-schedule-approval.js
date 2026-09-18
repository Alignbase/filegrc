import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { openPlaceholderCount, substantiveMarkdown } from "./content-readiness.js";
import { markdownEntries } from "./resource-markdown.js";
import { resolveDataPath } from "./paths.js";
import { currentPartyPeople } from "./parties.js";
import {
  nearDuplicateInformationTypes,
  resourceReviewRevisionsSync,
  retentionReviewResourceIds,
  retentionRuleIsCurrent,
  retentionUses
} from "./retention.js";

export function retentionScheduleApprovalIssues(loaded, program, rows, options = {}) {
  const byId = new Map(loaded.resources.map((record) => [record.id, record]));
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
    issues.push(issue("incomplete-retention-schedule-document", "Complete the Data Retention Schedule document, its owner, linked Control, and Markdown before requesting approval of the complete schedule."));
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
    issues.push(issue("retention-row-wrong-schedule-document", `Link every active retention row to the current Data Retention Schedule document before approval: ${mismatched[0].title}.`));
  }
  const revisions = resourceReviewRevisionsSync(
    loaded,
    activeRows.flatMap((row) => retentionReviewResourceIds(row, loaded))
  );
  const incomplete = activeRows.filter((row) => !retentionRuleIsCurrent(row, revisions, byId, loaded));
  if (incomplete.length) {
    issues.push(issue("incomplete-retention-schedule-row", `Complete the retention decisions before approving the schedule revision: ${incomplete[0].title}.`));
  }
  const proposedRows = rows.filter(rowProposesCoverage);
  const scopedPrograms = program.programIds
    ? program.programIds.map((id) => byId.get(id)).filter((record) => record?.type === "program")
    : [program];
  const uncovered = scopedPrograms.flatMap((candidate) => (
    retentionUses(loaded, candidate).map((use) => ({ ...use, programId: candidate.id }))
  )).find((use) => !proposedRows.some((row) => (
    (row.informationTypeIds || []).includes(use.informationTypeId)
    && ((row.scopeResourceIds || []).includes(use.resource.id) || (row.scopeResourceIds || []).includes(use.programId))
  )));
  if (uncovered) {
    issues.push(issue(
      "uncovered-retention-information-use",
      `${uncovered.resource.title} uses ${byId.get(uncovered.informationTypeId)?.title || uncovered.informationTypeId}, but no proposed retention schedule row covers both the type and scope.`
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

function issue(code, message) {
  return { code, message };
}

function primaryMarkdown(loaded, record) {
  const definition = loaded.model.resources[record.type];
  const selected = markdownEntries(loaded.model, record).find((entry) => (
    definition.markdown?.[entry.name]?.primary || entry.name === loaded.model.recordContent?.slot
  ));
  if (!selected) return "";
  try {
    return readFileSync(resolveDataPath(loaded.root, selected.path), "utf8");
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
      actual[entry.path] = createHash("sha256")
        .update(readFileSync(resolveDataPath(loaded.root, entry.path), "utf8"))
        .digest("hex");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const expected = record.approvedContentRevisions || {};
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  return actualKeys.length === expectedKeys.length
    && actualKeys.every((key, index) => key === expectedKeys[index] && actual[key] === expected[key]);
}
