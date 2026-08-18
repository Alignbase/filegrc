import { createHash } from "node:crypto";
import { scopedCollectionRecords } from "./collection-scope.js";
import { applyResourceBatch } from "./files.js";
import { getGitSummary } from "./git.js";
import { loadWorkspace } from "./workspace.js";
import { resolveProgram, selectedRequirementIds } from "./program.js";

export function collectionRevision(loaded, resourceType, options = {}) {
  const program = resolveProgram(loaded, options.programId);
  const scopedIds = new Set(scopedCollectionRecords(loaded, resourceType, program).map(({ id }) => id));
  const records = loaded.entries
    .filter(({ record }) => record.type === resourceType && scopedIds.has(record.id))
    .map(({ record, source }) => ({
      id: record.id,
      revision: createHash("sha256").update(source).digest("hex")
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const workspaceScope = {
    programId: program?.id ?? null,
    assuranceGoal: program?.assuranceGoal ?? null,
    candidateCoverage: program?.candidateCoverage ?? null,
    systemIds: [...(program?.systemIds || [])].sort(),
    frameworkIds: [...(program?.frameworkIds || [])].sort(),
    requirementIds: [...selectedRequirementIds(program || {}, loaded.model)].sort(),
    controlIds: [...(program?.controlIds || [])].sort()
  };
  return createHash("sha256")
    .update(JSON.stringify({ resourceType, records, workspaceScope }))
    .digest("hex");
}

export function assessCollectionReviews(input, options = {}) {
  const loaded = input?.resources && input?.model && input?.entries
    ? input
    : null;
  if (!loaded) throw new Error("Collection review assessment requires a loaded workspace.");
  return Object.keys(loaded.model.collectionReviews || {})
    .map((resourceType) => assessCollectionReview(loaded, resourceType, options));
}

export function assessCollectionReview(loaded, resourceType, options = {}) {
  const configuration = loaded.model.collectionReviews?.[resourceType];
  if (!configuration) return null;
  const program = resolveProgram(loaded, options.programId);
  const records = scopedCollectionRecords(loaded, resourceType, program);
  const reviewEntry = loaded.entries.find(({ record }) => (
    record.type === "collection-review"
    && record.resourceType === resourceType
    && record.status !== "retired"
    && (String(loaded.model.modelVersion) !== "4" || (record.scopeResourceIds || []).includes(program.id))
  ));
  const review = reviewEntry?.record || null;
  const currentRevision = collectionRevision(loaded, resourceType, { programId: program.id });
  const allowedDecisions = configuration.decisions || ["complete"];
  const allowsEmptyCollection = allowedDecisions.some((decision) => (
    decision === "zero-population" || decision === "externally-managed"
  ));
  const complete = Boolean(
    review?.status === "active"
    && allowedDecisions.includes(review.decision)
    && review.collectionRevision === currentRevision
  );
  const stale = Boolean(
    review?.status === "active"
    && review.collectionRevision
    && review.collectionRevision !== currentRevision
  );
  return {
    resourceType,
    configuration,
    records,
    recordCount: records.length,
    review,
    reviewRevision: reviewEntry
      ? createHash("sha256").update(reviewEntry.source).digest("hex")
      : null,
    collectionRevision: currentRevision,
    status: complete ? "current" : stale ? "stale" : "review-required",
    complete,
    message: complete
      ? `${configuration.title} were reviewed on ${review.reviewedOn}.`
      : stale
        ? `${configuration.title} changed after the last confirmation. Review the current records again.`
        : !records.length && !allowsEmptyCollection
          ? `Add at least one ${loaded.model.resources[resourceType].title.toLowerCase()} before confirming this collection.`
        : `Review ${configuration.title.toLowerCase()} before this page can be ready.`
  };
}

export async function scaffoldCollectionReview(input = process.cwd(), options = {}) {
  const loaded = await loadWorkspace(input);
  const program = resolveProgram(loaded, options.programId);
  const resourceType = requiredType(loaded, options.resourceType);
  const assessment = assessCollectionReview(loaded, resourceType, { programId: program.id });
  const allowedDecisions = assessment.configuration.decisions || ["complete"];
  return {
    resourceType,
    decision: assessment.records.length
      ? "complete"
      : allowedDecisions.includes("zero-population") ? "zero-population" : null,
    rationale: null,
    reviewedByIds: [],
    reviewedOn: null,
    ...(String(loaded.model.modelVersion) === "4"
      ? { authoritativeComponentId: null }
      : { authoritativeSystemId: null })
  };
}

export async function planCollectionReview(input = process.cwd(), options = {}) {
  const loaded = await loadWorkspace(input);
  const program = resolveProgram(loaded, options.programId);
  const resourceType = requiredType(loaded, options.resourceType);
  const assessment = assessCollectionReview(loaded, resourceType, { programId: program.id });
  const configuration = assessment.configuration;
  const decision = String(options.decision || "").trim();
  const rationale = String(options.rationale || "").trim();
  const reviewedByIds = [...new Set((options.reviewedByIds || []).map(String).filter(Boolean))];
  const reviewedOn = String(options.reviewedOn || "").trim();
  const scopeRevision = String(options.scopeRevision || getGitSummary(loaded.root).commit || "uncommitted").trim();
  const v4 = String(loaded.model.modelVersion) === "4";
  const authoritativeSourceId = String(v4 ? options.authoritativeComponentId : options.authoritativeSystemId || "").trim();
  if (!(configuration.decisions || ["complete"]).includes(decision)) {
    throw new Error(
      `${configuration.title} review must use one of: ${(configuration.decisions || ["complete"]).join(", ")}.`
    );
  }
  if (!assessment.records.length && decision === "complete") {
    const emptyDecisions = (configuration.decisions || []).filter((value) => (
      value === "zero-population" || value === "externally-managed"
    ));
    throw new Error(emptyDecisions.length
      ? `${configuration.title} has no records. Use one of the allowed empty-collection conclusions: ${emptyDecisions.join(", ")}.`
      : `${configuration.title} has no records. Add the required records before confirming this collection.`);
  }
  if (assessment.records.length && decision === "zero-population") {
    throw new Error(`${configuration.title} has ${assessment.records.length} records and cannot be confirmed as a zero population.`);
  }
  if (!rationale || !reviewedByIds.length || !reviewedOn) {
    throw new Error(`${configuration.title} review needs review notes, a reviewer, and a review date.`);
  }
  if (decision === "externally-managed") {
    const system = loaded.resources.find((record) => (
      record.type === (v4 ? "component" : "system")
      && record.id === authoritativeSourceId
      && record.status === "active"
    ));
    if (!system) throw new Error(`${configuration.title} review needs an active authoritative ${v4 ? "Component" : "System"}.`);
  }
  const existing = assessment.review;
  const record = {
    ...(existing || {
      id: `collection-review-${resourceType}`,
      type: "collection-review",
      title: `${configuration.title} review`,
      resourceType,
      scopeResourceIds: [program.id]
    }),
    status: "active",
    decision,
    rationale,
    reviewedByIds,
    reviewedOn,
    collectionRevision: assessment.collectionRevision,
    scopeRevision,
    ...(decision === "externally-managed"
      ? { [v4 ? "authoritativeComponentId" : "authoritativeSystemId"]: authoritativeSourceId }
      : {})
  };
  if (decision !== "externally-managed") {
    delete record.authoritativeSystemId;
    delete record.authoritativeComponentId;
  }
  return {
    operation: "collection-review",
    resourceType,
    assessment,
    changes: {
      ...(existing ? { update: [record] } : { create: [record] }),
      ...(existing ? {
        expectedRevisions: {
          [existing.id]: options.expectedRevision || assessment.reviewRevision
        }
      } : {}),
      validateWholeWorkspace: true
    }
  };
}

export async function applyCollectionReview(input = process.cwd(), options = {}) {
  if (options.confirmed !== true) {
    throw new Error("Preview the collection review and confirm the write.");
  }
  const plan = await planCollectionReview(input, options);
  const result = await applyResourceBatch(input, plan.changes);
  const loaded = await loadWorkspace(input);
  return {
    ...plan,
    result,
    assessment: assessCollectionReview(loaded, plan.resourceType, { programId: options.programId })
  };
}

function requiredType(loaded, value) {
  const resourceType = String(value || "").trim();
  if (!loaded.model.collectionReviews?.[resourceType]) {
    throw new Error(
      `Collection review type must be one of: ${Object.keys(loaded.model.collectionReviews || {}).join(", ")}.`
    );
  }
  return resourceType;
}
