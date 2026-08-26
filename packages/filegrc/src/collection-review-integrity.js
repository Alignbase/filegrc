import { createHash } from "node:crypto";
import { loadModel } from "../model/index.js";
import { collectionRevision } from "./collection-revision.js";
import { scopedCollectionRecords } from "./collection-scope.js";
import { getDataFilesAtRevision, getFileAtRevision, getRecordIdentityHistory, hasGitRevision } from "./git.js";
import { currentCalendarDate, isRfc3339Timestamp } from "./time.js";

export function collectionReviewRevision(record) {
  const reviewedFacts = {
    id: record.id,
    type: record.type,
    title: record.title,
    resourceType: record.resourceType,
    decision: record.decision,
    rationale: record.rationale,
    reviewedByIds: record.reviewedByIds,
    reviewedOn: record.reviewedOn,
    collectionRevision: record.collectionRevision,
    scopeRevision: record.scopeRevision,
    coverage: record.coverage,
    knowledgeCutoffAt: record.knowledgeCutoffAt,
    populationResourceIds: record.populationResourceIds,
    scopeResourceIds: record.scopeResourceIds,
    authoritativeComponentId: record.authoritativeComponentId,
    supersedesId: record.supersedesId
  };
  return createHash("sha256").update(JSON.stringify(reviewedFacts)).digest("hex");
}

export function historicalCollectionReviewSnapshot(root, record, model, timezone, resourceType, cutoff, selector = null, relativePath = null, expectedCommit = null) {
  if (!historicalCollectionReviewIsUsable(record, model, timezone, resourceType, cutoff)) return null;
  const reviewCommit = committedCollectionReviewMatch(root, record, relativePath, expectedCommit, timezone, cutoff);
  if (!reviewCommit) return null;
  const paths = getDataFilesAtRevision(root, record.scopeRevision);
  if (!paths.length || !hasGitRevision(root, record.scopeRevision)) return null;
  const entries = [];
  for (const path of paths) {
    const source = getFileAtRevision(root, record.scopeRevision, path);
    if (source === null) return null;
    try {
      entries.push({ record: JSON.parse(source), source, relativePath: path.slice("data/".length) });
    } catch {
      return null;
    }
  }
  const workspace = entries.find(({ relativePath, record: candidate }) => (
    relativePath === "workspace.json" && candidate?.type === "workspace"
  ))?.record;
  if (!workspace) return null;
  const resources = entries.map(({ record: candidate }) => candidate);
  const programId = (record.scopeResourceIds || []).find((id) => resources.some((candidate) => (
    candidate.type === "program" && candidate.id === id
  )));
  const program = resources.find((candidate) => candidate.type === "program" && candidate.id === programId);
  if (!program) return null;
  const snapshot = { root, entries, resources, workspace, model: loadModel(workspace.dataModelVersion) };
  const collectionIds = scopedCollectionRecords(snapshot, resourceType, program).map(({ id }) => id).sort();
  const currentRevision = collectionRevision(snapshot, resourceType, {
    program,
    authoritativeSourceId: record.authoritativeComponentId
  });
  if (
    record.collectionRevision !== currentRevision
    || JSON.stringify([...(record.populationResourceIds || [])].sort()) !== JSON.stringify(collectionIds)
  ) return null;
  const selectedIds = selector
    ? resources.filter((candidate) => (
        candidate.type === selector.resourceType
        && collectionIds.includes(candidate.id)
        && (!selector.statuses?.length || selector.statuses.includes(candidate.status))
        && (!selector.criticalities?.length || selector.criticalities.includes(candidate.criticality))
      )).map(({ id }) => id).sort()
    : collectionIds;
  return { collectionIds, selectedIds, reviewCommit: reviewCommit.commit };
}

function committedCollectionReviewMatch(root, record, relativePath, expectedCommit, timezone, cutoff) {
  const identityHistory = getRecordIdentityHistory(root, record.id);
  const history = expectedCommit
    ? identityHistory.filter(({ commit }) => commit === expectedCommit)
    : [...identityHistory].reverse();
  const expected = collectionReviewRevision(record);
  return history.find(({ commit, path }) => {
    if (expectedCommit && commit !== expectedCommit) return false;
    const source = getFileAtRevision(root, commit, path);
    if (!source) return false;
    try {
      const historical = JSON.parse(source);
      return historical.type === "collection-review"
        && historical.id === record.id
        && ["active", "retired"].includes(historical.status)
        && collectionReviewRevision(historical) === expected;
    } catch {
      return false;
    }
  }) || null;
}

function historicalCollectionReviewIsUsable(record, model, timezone, resourceType, cutoff) {
  if (
    record?.type !== "collection-review"
    || !["active", "retired"].includes(record.status)
    || record.resourceType !== resourceType
    || record.coverage?.kind !== "as-of"
    || record.coverage.on !== cutoff
    || !Array.isArray(record.populationResourceIds)
    || !record.collectionRevision
    || !record.scopeRevision
    || record.reviewedOn !== cutoff
    || !isRfc3339Timestamp(record.knowledgeCutoffAt)
    || currentCalendarDate(timezone, new Date(record.knowledgeCutoffAt)) !== cutoff
  ) return false;
  const allowed = model.collectionReviews?.[resourceType]?.decisions || ["complete"];
  if (!allowed.includes(record.decision)) return false;
  return record.decision === "zero-population"
    ? record.populationResourceIds.length === 0
    : record.populationResourceIds.length > 0;
}
