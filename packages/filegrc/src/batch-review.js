import { applyResourceBatch } from "./files.js";
import { getGitSummary } from "./git.js";
import { loadWorkspace } from "./workspace.js";
import { resolveProgram } from "./program.js";

const REVIEWABLE_TYPES = new Set([
  "requirement",
  "control",
  "commitment",
  "complementary-control"
]);

export async function scaffoldApplicabilityReview(input = process.cwd(), options = {}) {
  const loaded = await loadWorkspace(input);
  if (!["3", "4"].includes(String(loaded.model.modelVersion))) {
    throw new Error("Batch applicability review requires a model v3 or v4 workspace.");
  }
  const requestedType = options.type ? String(options.type) : null;
  if (requestedType && !REVIEWABLE_TYPES.has(requestedType)) {
    throw new Error(`Applicability review type must be one of ${[...REVIEWABLE_TYPES].join(", ")}.`);
  }
  const program = resolveProgram(loaded, options.programId);
  const reviewedRequirementIds = new Set((program.requirementApplicability || [])
    .filter(({ decision }) => ["applicable", "not-applicable"].includes(decision))
    .map(({ requirementId }) => requirementId));
  const records = loaded.resources.filter((record) => (
    REVIEWABLE_TYPES.has(record.type)
    && (!requestedType || record.type === requestedType)
    && (record.type === "requirement" && String(loaded.model.modelVersion) === "4"
      ? !reviewedRequirementIds.has(record.id)
      : !record.applicabilityReview)
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
  if (!["3", "4"].includes(String(loaded.model.modelVersion))) {
    throw new Error("Batch applicability review requires a model v3 or v4 workspace.");
  }
  if (!Array.isArray(options.decisions) || !options.decisions.length) {
    throw new Error("Applicability review needs at least one decision.");
  }
  const byId = new Map(loaded.resources.map((record) => [record.id, record]));
  const program = resolveProgram(loaded, options.programId);
  const v4RequirementDecisions = [];
  const update = options.decisions.flatMap((decision) => {
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
      if (String(loaded.model.modelVersion) === "4") {
        v4RequirementDecisions.push({ requirementId: record.id, decision: result, rationale, reviewedByIds, reviewedOn, scopeRevision });
        return [];
      }
      next.applicability = result;
      next.applicabilityRationale = rationale;
    }
    if (record.type === "control" && result === "not-applicable") next.status = "not-applicable";
    if (record.type === "control" && result === "applicable" && record.status === "not-applicable") next.status = "planned";
    return [next];
  });
  if (v4RequirementDecisions.length) {
    const replaced = new Set(v4RequirementDecisions.map(({ requirementId }) => requirementId));
    update.push({
      ...program,
      requirementApplicability: [
        ...(program.requirementApplicability || []).filter(({ requirementId }) => !replaced.has(requirementId)),
        ...v4RequirementDecisions
      ]
    });
  }
  return {
    operation: "applicability-review",
    reviewedIds: options.decisions.map(({ id }) => id),
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
