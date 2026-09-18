import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { modelSupports } from "../model/index.js";
import {
  collectionRevision,
  collectionRevisionMatches
} from "./collection-revision.js";
import { collectionRecordProposals, retentionScheduleReviewScope, scopedCollectionRecords } from "./collection-scope.js";
import { applyResourceBatch, applyRetentionScheduleReviewBatch, contentRevision, INTERNAL_WORKFLOW_CAPABILITIES } from "./files.js";
import { getGitSummary } from "./git.js";
import { createResourceId } from "./id.js";
import { loadWorkspace } from "./workspace.js";
import { resolveProgram } from "./program.js";
import { currentCalendarDate } from "./time.js";
import { currentPartyPeople } from "./parties.js";
import { retentionScheduleApprovalIssues } from "./retention-schedule-approval.js";
import { markdownEntries } from "./resource-markdown.js";
import { resolveDataPath } from "./paths.js";

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
  const workspaceWideRetentionReview = resourceType === "retention-schedule-item"
    && modelSupports(loaded.model, "retention-schedule-approval");
  const retentionScope = workspaceWideRetentionReview ? retentionScheduleReviewScope(loaded) : null;
  const records = scopedCollectionRecords(loaded, resourceType, program);
  const reviewEntries = loaded.entries.filter(({ record }) => (
    record.type === "collection-review"
    && record.resourceType === resourceType
    && record.status !== "retired"
    && (workspaceWideRetentionReview
      || !modelSupports(loaded.model, "program-scope")
      || (record.scopeResourceIds || []).includes(program.id))
  ));
  const reviewEntry = workspaceWideRetentionReview
    ? reviewEntries.find(({ record }) => sameIds(record.scopeResourceIds, retentionScope.programIds)) || reviewEntries[0]
    : reviewEntries[0];
  const review = reviewEntry?.record || null;
  const authoritativeSourceId = review?.decision === "externally-managed"
    ? review.authoritativeComponentId || review.authoritativeSystemId
    : null;
  const currentRevision = collectionRevision(loaded, resourceType, {
    programId: program.id,
    authoritativeSourceId
  });
  const allowedDecisions = configuration.decisions || ["complete"];
  const temporalReview = !modelSupports(loaded.model, "temporal-collection-reviews") || Boolean(
    review?.coverage?.kind === "as-of"
    && review.coverage.on === review.reviewedOn
    && review.knowledgeCutoffAt
    && Array.isArray(review.populationResourceIds)
    && sameIds(review.populationResourceIds, records.map(({ id }) => id))
  );
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
  const reviewerEligibility = resourceType === "control"
    ? assessControlReviewers(loaded, records)
    : resourceType === "retention-schedule-item" && modelSupports(loaded.model, "retention-schedule-approval")
      ? assessRetentionScheduleReviewers(loaded, records)
      : null;
  const approvalIssues = resourceType === "retention-schedule-item" && modelSupports(loaded.model, "retention-schedule-approval")
    ? retentionScheduleApprovalIssues(loaded, retentionScope, records, {
        informationTypesReviewed: retentionScope.programIds.every((id) => (
          assessCollectionReview(loaded, "information-type", { programId: id }).complete
        )),
        approvalReview: review?.status === "active" ? review : null
      })
    : [];
  const recordProposals = collectionRecordProposals(loaded, resourceType, records, program);
  const incompleteRecordProposals = recordProposals.filter(({ complete: ready }) => !ready);
  const reviewersEligible = !reviewerEligibility || Boolean(
    review?.reviewedByIds?.length
    && review.reviewedByIds.every((id) => reviewerEligibility.eligibleReviewerIds.includes(id))
  );
  const reviewScopeMatches = !workspaceWideRetentionReview
    || sameIds(review?.scopeResourceIds, retentionScope.programIds);
  const complete = Boolean(
    review?.status === "active"
    && allowedDecisions.includes(review.decision)
    && revisionMatches
    && temporalReview
    && reviewScopeMatches
    && reviewersEligible
    && !incompleteRecordProposals.length
    && !approvalIssues.length
  );
  const stale = Boolean(
    review?.status === "active"
    && review.collectionRevision
    && (!revisionMatches || !reviewScopeMatches)
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
    reviewEntries,
    collectionRevision: currentRevision,
    status: complete ? "current" : stale ? "stale" : "review-required",
    complete,
    ...(reviewerEligibility || {}),
    ...(recordProposals.length ? { recordProposals, incompleteRecordProposals } : {}),
    ...(approvalIssues.length ? { approvalIssues } : {}),
    message: complete
      ? `${configuration.title} were reviewed on ${review.reviewedOn}.`
      : approvalIssues.length
        ? approvalIssues[0].message
      : incompleteRecordProposals.length
        ? `Complete ${incompleteRecordProposals.length} ${configuration.title.toLowerCase()} ${incompleteRecordProposals.length === 1 ? "record proposal" : "record proposals"} before the collection review.`
      : revisionMatches && review?.status === "active" && !reviewersEligible
        ? resourceType === "retention-schedule-item"
          ? "Review the Data Retention Schedule again with a reviewer who does not own its governing document or an included schedule row."
          : "Review the Control collection again with a reviewer who does not own an included Control or its enabled Obligation."
      : stale
        ? `${configuration.title} changed after the last confirmation. Review the current records again.`
        : !records.length && !allowsEmptyCollection
          ? `Add at least one ${loaded.model.resources[resourceType].title.toLowerCase()} before confirming this collection.`
        : `Review ${configuration.title.toLowerCase()} before this page can be ready.`
  };
}

export function retentionScheduleIsAuthoritative(loaded, program) {
  return !modelSupports(loaded.model, "retention-schedule-approval")
    || assessCollectionReview(loaded, "retention-schedule-item", { programId: program?.id }).complete;
}

export async function scaffoldCollectionReview(input = process.cwd(), options = {}) {
  const loaded = await loadWorkspace(input);
  const program = resolveProgram(loaded, options.programId);
  const resourceType = requiredType(loaded, options.resourceType);
  const assessment = assessCollectionReview(loaded, resourceType, { programId: program.id });
  await requireControlReviewReady(loaded, resourceType, program.id);
  const allowedDecisions = assessment.configuration.decisions || ["complete"];
  const now = options.now ? new Date(options.now) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error("A valid Collection Review time is required.");
  const priorReview = assessment.review;
  const v4 = modelSupports(loaded.model, "program-scope");
  const priorAuthoritativeSourceId = priorReview?.authoritativeComponentId || priorReview?.authoritativeSystemId || null;
  const priorAuthoritativeSourceActive = priorReview?.decision !== "externally-managed" || loaded.resources.some((record) => (
    record.type === (v4 ? "component" : "system")
    && record.id === priorAuthoritativeSourceId
    && record.status === "active"
  ));
  const priorDecisionStillValid = allowedDecisions.includes(priorReview?.decision)
    && priorAuthoritativeSourceActive
    && (assessment.records.length
      ? priorReview.decision !== "zero-population"
      : priorReview.decision !== "complete");
  const preservedAuthoritativeSourceId = priorDecisionStillValid && priorReview.decision === "externally-managed"
    ? priorAuthoritativeSourceId
    : null;
  return {
    resourceType,
    decision: priorDecisionStillValid ? priorReview.decision : (assessment.records.length
      ? "complete"
      : allowedDecisions.includes("zero-population") ? "zero-population" : null),
    rationale: priorReview?.rationale || null,
    reviewedByIds: [...(priorReview?.reviewedByIds || [])],
    reviewedOn: priorReview?.reviewedOn
      ? currentCalendarDate(loaded.workspace.timezone, now)
      : null,
    ...(resourceType === "retention-schedule-item" && modelSupports(loaded.model, "retention-schedule-approval")
      ? { expectedCollectionRevision: assessment.collectionRevision }
      : {}),
    ...(v4
      ? { authoritativeComponentId: preservedAuthoritativeSourceId }
      : { authoritativeSystemId: preservedAuthoritativeSourceId })
  };
}

export async function planCollectionReview(input = process.cwd(), options = {}) {
  const loaded = await loadWorkspace(input);
  const program = resolveProgram(loaded, options.programId);
  const resourceType = requiredType(loaded, options.resourceType);
  const workspaceWideRetentionReview = resourceType === "retention-schedule-item"
    && modelSupports(loaded.model, "retention-schedule-approval");
  const retentionScope = workspaceWideRetentionReview ? retentionScheduleReviewScope(loaded) : null;
  const assessment = assessCollectionReview(loaded, resourceType, { programId: program.id });
  if (options.expectedCollectionRevision && options.expectedCollectionRevision !== assessment.collectionRevision) {
    throw new Error(`${assessment.configuration.title} changed after it was displayed. Reload and review the current revision before approving it.`);
  }
  if (resourceType === "retention-schedule-item" && modelSupports(loaded.model, "retention-schedule-approval") && !options.expectedCollectionRevision) {
    throw new Error("Data Retention Schedule approval requires the displayed collection revision. Reload or scaffold the current review before approving it.");
  }
  await requireControlReviewReady(loaded, resourceType, program.id);
  await requireRetentionScheduleReady(loaded, resourceType, program, retentionScope);
  requireCollectionRecordProposalsReady(assessment);
  const configuration = assessment.configuration;
  const decision = String(options.decision || "").trim();
  const rationale = String(options.rationale || "").trim();
  const reviewedByIds = [...new Set((options.reviewedByIds || []).map(String).filter(Boolean))];
  const reviewedOn = String(options.reviewedOn || "").trim();
  const temporalReviews = modelSupports(loaded.model, "temporal-collection-reviews");
  const now = options.now ? new Date(options.now) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error("A valid Collection Review time is required.");
  const today = currentCalendarDate(loaded.workspace.timezone, now);
  const gitSummary = getGitSummary(loaded.root);
  if (temporalReviews && (!gitSummary.available || !gitSummary.clean || !gitSummary.commit)) {
    throw new Error("Commit the current workspace before recording a Collection Review so its scope revision is retrievable from Git.");
  }
  const scopeRevision = temporalReviews
    ? gitSummary.commit
    : String(options.scopeRevision || gitSummary.commit || "uncommitted").trim();
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
  if (resourceType === "control") {
    const eligible = new Set(assessment.eligibleReviewerIds || []);
    const conflicts = reviewedByIds.filter((id) => !eligible.has(id));
    if (conflicts.length) {
      throw new Error(`Control collection review needs a reviewer who does not own an included Control or its enabled Obligation: ${conflicts.join(", ")}.`);
    }
  }
  if (resourceType === "retention-schedule-item" && modelSupports(loaded.model, "retention-schedule-approval")) {
    const eligible = new Set(assessment.eligibleReviewerIds || []);
    const conflicts = reviewedByIds.filter((id) => !eligible.has(id));
    if (conflicts.length) {
      throw new Error(`Data Retention Schedule approval needs a reviewer who does not own its governing document or an included schedule row: ${conflicts.join(", ")}.`);
    }
  }
  if (temporalReviews) {
    if (reviewedOn !== today) {
      throw new Error("A current Collection Review must use today's workspace-local review date. Reconstruct an older population from Git history instead of backdating today's files.");
    }
    if (options.scopeRevision && options.scopeRevision !== scopeRevision) {
      throw new Error("Collection Review scope revision is derived from Git and cannot be supplied.");
    }
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
  const existingEntries = workspaceWideRetentionReview
    ? assessment.reviewEntries
    : assessment.reviewEntries.filter(({ record }) => record.id === existing?.id);
  const preservesReviewHistory = temporalReviews;
  const record = {
    ...(!existing ? {
      id: modelSupports(loaded.model, "program-scope")
        ? createResourceId(
            "collection-review",
            `${program.id} ${configuration.title} review`,
            loaded.resources.map(({ id }) => id)
          )
        : `collection-review-${resourceType}`,
      type: "collection-review",
      title: `${configuration.title} review`,
      resourceType,
      scopeResourceIds: workspaceWideRetentionReview ? retentionScope.programIds : [program.id]
    } : preservesReviewHistory ? {
      ...existing,
      id: createResourceId(
        "collection-review",
        `${configuration.title} review ${reviewedOn}`,
        loaded.resources.map(({ id }) => id)
      ),
      supersedesId: existing.id
    } : existing),
    status: "active",
    decision,
    rationale,
    reviewedByIds,
    reviewedOn,
    collectionRevision: currentRevision,
    scopeRevision,
    ...(workspaceWideRetentionReview ? { scopeResourceIds: retentionScope.programIds } : {}),
    ...(temporalReviews ? {
      coverage: { kind: "as-of", on: reviewedOn },
      knowledgeCutoffAt: now.toISOString(),
      populationResourceIds: assessment.records.map(({ id }) => id).sort()
    } : {}),
    ...(decision === "externally-managed"
      ? { [v4 ? "authoritativeComponentId" : "authoritativeSystemId"]: authoritativeSourceId }
      : {})
  };
  if (decision !== "externally-managed") {
    delete record.authoritativeSystemId;
    delete record.authoritativeComponentId;
  }
  const creates = !existing || preservesReviewHistory ? [record] : [];
  const updates = !existing || preservesReviewHistory ? [] : [record];
  const expectedRevisions = Object.fromEntries(existingEntries.map((entry) => [
    entry.record.id,
    entry.record.id === existing?.id && options.expectedRevision
      ? options.expectedRevision
      : createHash("sha256").update(entry.source).digest("hex")
  ]));
  if (existingEntries.length && preservesReviewHistory) {
    for (const entry of existingEntries) {
      updates.push({
        ...entry.record,
        status: "retired",
        statusTransition: {
          changedByIds: reviewedByIds,
          changedOn: reviewedOn,
          reason: `Superseded by ${record.id}.`
        }
      });
    }
  }
  if (resourceType === "retention-schedule-item" && modelSupports(loaded.model, "retention-schedule-approval")) {
    const scheduleEntry = loaded.entries.find(({ record: candidate }) => (
      candidate.type === "document"
      && candidate.documentKind === "schedule"
      && candidate.workflowScope === "program"
      && !["superseded", "retired"].includes(candidate.status)
    ));
    if (scheduleEntry && ["draft", "approved", "active"].includes(scheduleEntry.record.status)) {
      const currentContentRevisions = await contentRevisions(loaded, scheduleEntry.record);
      const approvedSchedule = {
        ...scheduleEntry.record,
        status: "approved",
        approverIds: reviewedByIds,
        approvedOn: reviewedOn,
        approvedContentRevisions: currentContentRevisions
      };
      for (const field of [
        "activationBasis",
        "activatedByIds",
        "activatedOn",
        "activatedContentRevisions",
        "effectiveOn",
        "statusTransition"
      ]) delete approvedSchedule[field];
      updates.push(approvedSchedule);
      expectedRevisions[scheduleEntry.record.id] = scheduleEntry.revision;
    }
  }
  return {
    operation: "collection-review",
    resourceType,
    assessment,
    changes: {
      ...(creates.length ? { create: creates } : {}),
      ...(updates.length ? { update: updates } : {}),
      ...(Object.keys(expectedRevisions).length ? { expectedRevisions } : {}),
      validateWholeWorkspace: true,
      workflowCapability: INTERNAL_WORKFLOW_CAPABILITIES.collectionReviewReassessment
    }
  };
}

function requireCollectionRecordProposalsReady(assessment) {
  const incomplete = assessment.incompleteRecordProposals || [];
  if (!incomplete.length) return;
  throw new Error(
    `Complete every ${assessment.configuration.title.toLowerCase()} record proposal before the collection review. Remaining: ${incomplete.map(({ title }) => title).join(", ")}.`
  );
}

async function contentRevisions(loaded, record) {
  const revisions = {};
  for (const markdown of markdownEntries(loaded.model, record)) {
    const source = await readFile(resolveDataPath(loaded.root, markdown.path), "utf8");
    revisions[markdown.path] = contentRevision(source);
  }
  return revisions;
}

async function requireControlReviewReady(loaded, resourceType, programId) {
  if (resourceType !== "control") return;
  const { assessProgramReadiness } = await import("./program-readiness.js");
  const readiness = await assessProgramReadiness(loaded, { programId });
  const earlierItems = readiness.stages
    .find(({ id }) => id === "controls")
    ?.items.filter(({ id }) => (
      id !== "collection-review-control"
      && !id.startsWith("document-activation-")
      && !id.startsWith("training-activation-")
      && !id.startsWith("policy-activation-")
    )) || [];
  if (!earlierItems.length || earlierItems.some(({ status }) => status !== "complete")) {
    throw new Error("Complete the Step 3 implementation work before recording the Control collection review. Program content activation follows this review.");
  }
}

async function requireRetentionScheduleReady(loaded, resourceType, program, retentionScope) {
  if (resourceType !== "retention-schedule-item" || !modelSupports(loaded.model, "retention-schedule-approval")) return;
  const rows = scopedCollectionRecords(loaded, resourceType, program);
  const approvalIssues = retentionScheduleApprovalIssues(loaded, retentionScope || program, rows, {
    informationTypesReviewed: (retentionScope?.programIds || [program.id]).every((id) => (
      assessCollectionReview(loaded, "information-type", { programId: id }).complete
    ))
  });
  if (approvalIssues.length) throw new Error(approvalIssues[0].message);
}

function assessControlReviewers(loaded, controls) {
  const byId = new Map(loaded.resources.map((record) => [record.id, record]));
  const controlIds = new Set(controls.map(({ id }) => id));
  const conflictIds = new Set();
  for (const control of controls) {
    for (const id of currentPartyPeople(control.ownerIds || [], byId)) conflictIds.add(id);
  }
  for (const obligation of loaded.resources.filter((record) => (
    record.type === "obligation"
    && record.status === "active"
    && (record.controlIds || []).some((id) => controlIds.has(id))
  ))) {
    for (const id of currentPartyPeople(obligation.ownerIds || [], byId)) conflictIds.add(id);
  }
  const people = loaded.resources.filter(({ type, status }) => type === "person" && status === "active");
  return {
    eligibleReviewerIds: people.map(({ id }) => id).filter((id) => !conflictIds.has(id)),
    reviewerConflictIds: people.map(({ id }) => id).filter((id) => conflictIds.has(id))
  };
}

function assessRetentionScheduleReviewers(loaded, rows) {
  const byId = new Map(loaded.resources.map((record) => [record.id, record]));
  const conflictIds = new Set();
  const schedules = loaded.resources.filter((record) => (
    record.type === "document"
    && record.documentKind === "schedule"
    && record.workflowScope === "program"
    && !["superseded", "retired"].includes(record.status)
  ));
  for (const record of [...schedules, ...rows]) {
    for (const id of currentPartyPeople(record.ownerIds || [], byId)) conflictIds.add(id);
  }
  const people = loaded.resources.filter(({ type, status }) => type === "person" && status === "active");
  return {
    eligibleReviewerIds: people.map(({ id }) => id).filter((id) => !conflictIds.has(id)),
    reviewerConflictIds: people.map(({ id }) => id).filter((id) => conflictIds.has(id))
  };
}

function sameIds(left = [], right = []) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

export async function applyCollectionReview(input = process.cwd(), options = {}) {
  if (options.confirmed !== true) {
    throw new Error("Preview the collection review and confirm the write.");
  }
  const plan = await planCollectionReview(input, options);
  const result = plan.resourceType === "retention-schedule-item"
    ? await applyRetentionScheduleReviewBatch(input, plan.changes)
    : await applyResourceBatch(input, plan.changes);
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
