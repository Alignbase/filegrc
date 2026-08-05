import { applyResourceBatch } from "./files.js";
import { getGitSummary } from "./git.js";
import { loadWorkspace } from "./workspace.js";

const REVIEWABLE_TYPES = new Set([
  "requirement",
  "control",
  "commitment",
  "complementary-control"
]);

export async function scaffoldApplicabilityReview(input = process.cwd(), options = {}) {
  const loaded = await loadWorkspace(input);
  if (String(loaded.model.modelVersion) !== "3") {
    throw new Error("Batch applicability review requires a model v3 workspace.");
  }
  const requestedType = options.type ? String(options.type) : null;
  if (requestedType && !REVIEWABLE_TYPES.has(requestedType)) {
    throw new Error(`Applicability review type must be one of ${[...REVIEWABLE_TYPES].join(", ")}.`);
  }
  const records = loaded.resources.filter((record) => (
    REVIEWABLE_TYPES.has(record.type)
    && (!requestedType || record.type === requestedType)
    && !record.applicabilityReview
    && !["retired", "superseded"].includes(record.status)
  ));
  return {
    reviewedByIds: [],
    reviewedOn: null,
    decisions: records
      .sort((left, right) => `${left.type}:${left.title}:${left.id}`.localeCompare(`${right.type}:${right.title}:${right.id}`))
      .map((record) => ({
        id: record.id,
        decision: null,
        rationale: null
      }))
  };
}

export async function planApplicabilityReview(input = process.cwd(), options = {}) {
  const loaded = await loadWorkspace(input);
  if (String(loaded.model.modelVersion) !== "3") {
    throw new Error("Batch applicability review requires a model v3 workspace.");
  }
  if (!Array.isArray(options.decisions) || !options.decisions.length) {
    throw new Error("Applicability review needs at least one decision.");
  }
  const byId = new Map(loaded.resources.map((record) => [record.id, record]));
  const update = options.decisions.map((decision) => {
    const record = byId.get(decision.id);
    if (!record || !REVIEWABLE_TYPES.has(record.type)) {
      throw new Error(`Resource "${decision.id}" is not an applicability-review record.`);
    }
    const reviewedByIds = [...new Set((decision.reviewedByIds || options.reviewedByIds || []).map(String))];
    const reviewedOn = String(decision.reviewedOn || options.reviewedOn || "").trim();
    const scopeRevision = String(
      decision.scopeRevision
      || options.scopeRevision
      || getGitSummary(loaded.root).commit
      || "uncommitted"
    ).trim();
    const rationale = String(decision.rationale || "").trim();
    const result = String(decision.decision || "").trim();
    if (!["applicable", "not-applicable", "externally-managed", "zero-population"].includes(result)) {
      throw new Error(`Decision for "${record.id}" must be applicable, not-applicable, externally-managed, or zero-population.`);
    }
    if (!reviewedByIds.length || !reviewedOn || !rationale) {
      throw new Error(`Decision for "${record.id}" needs a reviewer, review date, and rationale.`);
    }
    const next = {
      ...record,
      applicabilityReview: {
        decision: result,
        rationale,
        reviewedByIds,
        reviewedOn,
        scopeRevision
      }
    };
    if (record.type === "requirement") {
      if (!["applicable", "not-applicable"].includes(result)) {
        throw new Error(`Requirement "${record.id}" must be applicable or not-applicable.`);
      }
      next.applicability = result;
      next.applicabilityRationale = rationale;
    }
    if (record.type === "control" && result === "not-applicable") next.status = "not-applicable";
    if (record.type === "control" && result === "applicable" && record.status === "not-applicable") next.status = "planned";
    return next;
  });
  return {
    operation: "applicability-review",
    reviewedIds: update.map(({ id }) => id),
    changes: {
      update,
      expectedRevisions: options.expectedRevisions || {},
      validateWholeWorkspace: true
    }
  };
}

export async function applyApplicabilityReview(input = process.cwd(), options = {}) {
  if (options.confirmed !== true) {
    throw new Error("Preview the applicability decisions and confirm the write.");
  }
  const plan = await planApplicabilityReview(input, options);
  const result = await applyResourceBatch(input, plan.changes);
  return { ...plan, result };
}
