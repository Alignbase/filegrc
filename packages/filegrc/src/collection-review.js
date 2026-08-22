import { createHash } from "node:crypto";
import { modelSupports } from "../model/index.js";
import {
  collectionRevision,
  collectionRevisionMatches
} from "./collection-revision.js";
import { scopedCollectionRecords } from "./collection-scope.js";
import { applyResourceBatch } from "./files.js";
import { getGitSummary } from "./git.js";
import { loadWorkspace } from "./workspace.js";
import { resolveProgram } from "./program.js";

export { collectionRevision };

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
    && (!modelSupports(loaded.model, "program-scope") || (record.scopeResourceIds || []).includes(program.id))
  ));
  const review = reviewEntry?.record || null;
  const authoritativeSourceId = review?.decision === "externally-managed"
    ? review.authoritativeComponentId || review.authoritativeSystemId
    : null;
  const currentRevision = collectionRevision(loaded, resourceType, {
    programId: program.id,
    authoritativeSourceId
  });
  const allowedDecisions = configuration.decisions || ["complete"];
  const allowsEmptyCollection = allowedDecisions.some((decision) => (
    decision === "zero-population" || decision === "externally-managed"
  ));
  const revisionMatches = collectionRevisionMatches(
    loaded,
    resourceType,
    review?.collectionRevision,
    {
      programId: program.id,
      authoritativeSourceId,
      currentRevision
    }
  );
  const complete = Boolean(
    review?.status === "active"
    && allowedDecisions.includes(review.decision)
    && revisionMatches
  );
  const stale = Boolean(
    review?.status === "active"
    && review.collectionRevision
    && !revisionMatches
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
    ...(modelSupports(loaded.model, "program-scope")
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
  const v4 = modelSupports(loaded.model, "program-scope");
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
  const currentRevision = collectionRevision(loaded, resourceType, {
    programId: program.id,
    authoritativeSourceId: decision === "externally-managed" ? authoritativeSourceId : null
  });
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
    collectionRevision: currentRevision,
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
