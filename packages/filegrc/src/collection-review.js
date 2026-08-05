import { createHash } from "node:crypto";
import { applyResourceBatch } from "./files.js";
import { getGitSummary } from "./git.js";
import { loadWorkspace } from "./workspace.js";

export function collectionRevision(loaded, resourceType) {
  const records = loaded.entries
    .filter(({ record }) => record.type === resourceType)
    .map(({ record, source }) => ({
      id: record.id,
      revision: createHash("sha256").update(source).digest("hex")
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const workspaceScope = {
    assuranceGoal: loaded.workspace?.assuranceGoal ?? null,
    candidateCoverage: loaded.workspace?.candidateCoverage ?? null,
    systemIds: [...(loaded.workspace?.systemIds || [])].sort(),
    frameworkIds: [...(loaded.workspace?.frameworkIds || [])].sort(),
    requirementIds: [...(loaded.workspace?.requirementIds || [])].sort(),
    controlIds: [...(loaded.workspace?.controlIds || [])].sort()
  };
  return createHash("sha256")
    .update(JSON.stringify({ resourceType, records, workspaceScope }))
    .digest("hex");
}

export function assessCollectionReviews(input) {
  const loaded = input?.resources && input?.model && input?.entries
    ? input
    : null;
  if (!loaded) throw new Error("Collection review assessment requires a loaded workspace.");
  return Object.keys(loaded.model.collectionReviews || {})
    .map((resourceType) => assessCollectionReview(loaded, resourceType));
}

export function assessCollectionReview(loaded, resourceType) {
  const configuration = loaded.model.collectionReviews?.[resourceType];
  if (!configuration) return null;
  const records = loaded.resources.filter((record) => record.type === resourceType);
  const reviewEntry = loaded.entries.find(({ record }) => (
    record.type === "collection-review"
    && record.resourceType === resourceType
    && record.status !== "retired"
  ));
  const review = reviewEntry?.record || null;
  const currentRevision = collectionRevision(loaded, resourceType);
  const allowedDecisions = configuration.decisions || ["complete"];
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
        : `Review ${configuration.title.toLowerCase()} before this page can be ready.`
  };
}

export async function scaffoldCollectionReview(input = process.cwd(), options = {}) {
  const loaded = await loadWorkspace(input);
  const resourceType = requiredType(loaded, options.resourceType);
  const assessment = assessCollectionReview(loaded, resourceType);
  const allowedDecisions = assessment.configuration.decisions || ["complete"];
  return {
    resourceType,
    decision: assessment.records.length
      ? "complete"
      : allowedDecisions.includes("zero-population") ? "zero-population" : null,
    rationale: null,
    reviewedByIds: [],
    reviewedOn: null,
    authoritativeSystemId: null
  };
}

export async function planCollectionReview(input = process.cwd(), options = {}) {
  const loaded = await loadWorkspace(input);
  const resourceType = requiredType(loaded, options.resourceType);
  const assessment = assessCollectionReview(loaded, resourceType);
  const configuration = assessment.configuration;
  const decision = String(options.decision || "").trim();
  const rationale = String(options.rationale || "").trim();
  const reviewedByIds = [...new Set((options.reviewedByIds || []).map(String).filter(Boolean))];
  const reviewedOn = String(options.reviewedOn || "").trim();
  const scopeRevision = String(options.scopeRevision || getGitSummary(loaded.root).commit || "uncommitted").trim();
  const authoritativeSystemId = String(options.authoritativeSystemId || "").trim();
  if (!(configuration.decisions || ["complete"]).includes(decision)) {
    throw new Error(
      `${configuration.title} review must use one of: ${(configuration.decisions || ["complete"]).join(", ")}.`
    );
  }
  if (!assessment.records.length && decision === "complete") {
    throw new Error(`${configuration.title} has no records. Use zero-population or another allowed conclusion.`);
  }
  if (assessment.records.length && decision === "zero-population") {
    throw new Error(`${configuration.title} has ${assessment.records.length} records and cannot be confirmed as a zero population.`);
  }
  if (!rationale || !reviewedByIds.length || !reviewedOn) {
    throw new Error(`${configuration.title} review needs review notes, a reviewer, and a review date.`);
  }
  if (decision === "externally-managed") {
    const system = loaded.resources.find((record) => (
      record.type === "system"
      && record.id === authoritativeSystemId
      && record.status === "active"
    ));
    if (!system) throw new Error(`${configuration.title} review needs an active authoritative System.`);
  }
  const existing = assessment.review;
  const record = {
    ...(existing || {
      id: `collection-review-${resourceType}`,
      type: "collection-review",
      title: `${configuration.title} review`,
      resourceType,
      scopeResourceIds: [loaded.workspace.id]
    }),
    status: "active",
    decision,
    rationale,
    reviewedByIds,
    reviewedOn,
    collectionRevision: assessment.collectionRevision,
    scopeRevision,
    ...(decision === "externally-managed" ? { authoritativeSystemId } : {})
  };
  if (decision !== "externally-managed") delete record.authoritativeSystemId;
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
    assessment: assessCollectionReview(loaded, plan.resourceType)
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
