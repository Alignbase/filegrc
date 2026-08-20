import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { applyResourceBatch } from "./files.js";
import { getWorkspaceRevisionSnapshot } from "./git.js";
import { serializeWorkspaceMutation } from "./mutation.js";
import { resolveDataPath } from "./paths.js";
import { resolveProgram } from "./program.js";
import { markdownEntries } from "./resource-markdown.js";
import { soc2RequirementApplicabilityConstraint } from "./soc2.js";
import { assessWorkflow, buildWorkflowDelta } from "./workflow.js";
import { loadWorkspace } from "./workspace.js";

const REVIEWABLE_TYPES = new Set([
  "requirement",
  "control",
  "commitment",
  "complementary-control"
]);

export async function scaffoldApplicabilityReview(input = process.cwd(), options = {}) {
  const context = await applicabilityReviewContext(input);
  const { loaded } = context;
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
    basis: context.basis,
    reviewedByIds: [],
    reviewedOn: null,
    decisions: records
      .sort((left, right) => `${left.type}:${left.title}:${left.id}`.localeCompare(`${right.type}:${right.title}:${right.id}`))
      .map((record) => {
        const constraint = soc2RequirementApplicabilityConstraint(record, program, loaded.model.modelVersion);
        return {
          id: record.id,
          decision: constraint?.requiredDecision || null,
          rationale: constraint?.defaultRationale || null,
          ...(constraint ? { constraint } : {})
        };
      })
  };
}

export async function planApplicabilityReview(input = process.cwd(), options = {}) {
  const context = await applicabilityReviewContext(input);
  return planApplicabilityReviewWithContext(context, options);
}

function planApplicabilityReviewWithContext(context, options) {
  const { basis, loaded } = context;
  if (!["3", "4"].includes(String(loaded.model.modelVersion))) {
    throw new Error("Batch applicability review requires a model v3 or v4 workspace.");
  }
  if (!Array.isArray(options.decisions) || !options.decisions.length) {
    throw new Error("Applicability review needs at least one decision.");
  }
  if (options.basis !== undefined) assertApplicabilityReviewBasis(options.basis, basis);
  const byId = new Map(loaded.resources.map((record) => [record.id, record]));
  const revisionById = new Map(loaded.entries.map((entry) => [entry.record.id, entry.revision]));
  const expectedRevisions = options.expectedRevisions ?? {};
  if (Array.isArray(expectedRevisions) || typeof expectedRevisions !== "object" || expectedRevisions === null) {
    throw new Error("Batch expected revisions must be keyed by resource ID.");
  }
  const program = resolveProgram(loaded, options.programId);
  const v4RequirementDecisions = [];
  const update = options.decisions.flatMap((decision) => {
    const record = byId.get(decision.id);
    if (!record || !REVIEWABLE_TYPES.has(record.type)) {
      throw new Error(`Resource "${decision.id}" is not an applicability-review record.`);
    }
    const reviewedByIds = [...new Set((decision.reviewedByIds || options.reviewedByIds || []).map(String))];
    const reviewedOn = String(decision.reviewedOn || options.reviewedOn || "").trim();
    const rationale = String(decision.rationale || "").trim();
    const result = String(decision.decision || "").trim();
    if (!["applicable", "not-applicable", "externally-managed", "zero-population"].includes(result)) {
      throw new Error(`Decision for "${record.id}" must be applicable, not-applicable, externally-managed, or zero-population.`);
    }
    if (!reviewedByIds.length || !reviewedOn || !rationale) {
      throw new Error(`Decision for "${record.id}" needs a reviewer, review date, and rationale.`);
    }
    const constraint = soc2RequirementApplicabilityConstraint(record, program, loaded.model.modelVersion);
    if (constraint && !constraint.allowedDecisions.includes(result)) {
      throw new Error(`${record.reference || record.title} must be applicable because it is required for the selected SOC 2 Security program.`);
    }
    const next = {
      ...record,
      applicabilityReview: {
        decision: result,
        rationale,
        reviewedByIds,
        reviewedOn,
        scopeRevision: basis.scopeRevision
      }
    };
    if (record.type === "requirement") {
      if (!["applicable", "not-applicable"].includes(result)) {
        throw new Error(`Requirement "${record.id}" must be applicable or not-applicable.`);
      }
      if (String(loaded.model.modelVersion) === "4") {
        v4RequirementDecisions.push({
          requirementId: record.id,
          decision: result,
          rationale,
          reviewedByIds,
          reviewedOn,
          scopeRevision: basis.scopeRevision
        });
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
    basis,
    reviewedIds: options.decisions.map(({ id }) => id),
    changes: {
      update,
      expectedRevisions: Object.fromEntries(update.map((record) => [
        record.id,
        expectedRevisions[record.id] || revisionById.get(record.id)
      ])),
      validateWholeWorkspace: true
    }
  };
}

export function applyApplicabilityReview(input = process.cwd(), options = {}) {
  return applyApplicabilityReviewWithContext(input, options);
}

export async function applyApplicabilityReviewWithContext(input = process.cwd(), options = {}, contextOptions = {}) {
  if (options.confirmed !== true) {
    throw new Error("Preview the applicability decisions and confirm the write.");
  }
  return serializeWorkspaceMutation(input, async (root) => {
    const context = await applicabilityReviewContext(root, contextOptions);
    if (options.basis === undefined) {
      throw new Error("Applicability review apply requires the basis returned by scaffold or --preview --json. Generate the decisions again before confirming the write.");
    }
    const plan = planApplicabilityReviewWithContext(context, options);
    const before = contextOptions.includeWorkflowDelta
      ? await assessWorkflow(context.loaded, { git: workflowGitState(context.repository) })
      : null;
    const result = await applyResourceBatch(root, plan.changes);
    if (!before) return { ...plan, result };
    const after = await assessWorkflow(result.validation.loaded, {
      git: workflowGitState(context.repository),
      validation: result.validation
    });
    return {
      ...plan,
      result,
      workflowDelta: buildWorkflowDelta(before, after)
    };
  });
}

async function applicabilityReviewContext(input, options = {}) {
  const loaded = await loadWorkspace(input);
  const repository = options.repositorySnapshot ?? await getWorkspaceRevisionSnapshot(loaded.root);
  return {
    basis: await applicabilityReviewBasis(loaded, repository),
    loaded,
    repository
  };
}

function workflowGitState(repository) {
  return {
    ...repository,
    commit: repository.currentCommit ?? repository.commit ?? null
  };
}

async function applicabilityReviewBasis(loaded, repository) {
  const scopeFingerprint = await applicabilityScopeFingerprint(loaded);
  const commit = repository.currentCommit ?? repository.commit ?? null;
  const clean = repository.clean === true || repository.wholeWorktreeClean === true;
  return {
    scopeRevision: commit && clean ? commit : `uncommitted:${scopeFingerprint}`,
    scopeFingerprint
  };
}

function assertApplicabilityReviewBasis(expected, current) {
  if (
    !expected
    || Array.isArray(expected)
    || typeof expected !== "object"
    || typeof expected.scopeRevision !== "string"
    || typeof expected.scopeFingerprint !== "string"
  ) {
    throw new Error("Applicability review basis must include its scope revision and scope fingerprint. Generate a new scaffold or preview.");
  }
  if (
    expected.scopeRevision !== current.scopeRevision
    || expected.scopeFingerprint !== current.scopeFingerprint
  ) {
    throw new Error("The workspace scope changed after this applicability review was prepared. Generate a new preview before confirming the write.");
  }
}

async function applicabilityScopeFingerprint(loaded) {
  const hash = createHash("sha256");
  hash.update(`model\0${loaded.model.modelVersion}\0`);
  for (const entry of [...loaded.entries].sort((left, right) => compareText(left.relativePath, right.relativePath))) {
    hash.update(`record\0${entry.relativePath}\0${stableJson(entry.record)}\0`);
    for (const markdown of markdownEntries(loaded.model, entry.record).sort((left, right) => (
      compareText(left.path, right.path)
    ))) {
      try {
        const source = await readFile(resolveDataPath(loaded.root, markdown.path), "utf8");
        hash.update(`markdown\0${markdown.path}\0${source.length}\0${source}\0`);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        hash.update(`markdown-missing\0${markdown.path}\0`);
      }
    }
  }
  return hash.digest("hex");
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}
