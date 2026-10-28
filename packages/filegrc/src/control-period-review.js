import { isDeepStrictEqual } from "node:util";
import { lstat } from "node:fs/promises";
import { currentPeriodImpactRevision, periodImpactReviewersAuthorized } from "./period-impact.js";
import { reviewHistoricalWorkspace, reviewHistoryContext } from "./historical-workspace.js";
import { assessCompletionForObligation, completionDate } from "./obligations.js";
import { getGitSummary, isDataHistoryAncestor, getFileObjectIdAtRevision, getWorkingFileObjectId } from "./git.js";
import { preparationEvidenceIssues } from "./preparation-evidence.js";
import { personWasActiveOn } from "./soc2.js";
import { resolveDataPath } from "./paths.js";
import { resourceDataPath } from "./resource-markdown.js";
import { assertHistoricalRecordValid } from "./validate.js";
import { revisionsMatch } from "./revisions.js";

const passing = new Set(["passed", "passed-with-exceptions"]);
const valid = (loaded, record) => {
  if (!record) return false;
  try { assertHistoricalRecordValid(record, loaded.model, resourceDataPath(loaded.model, record)); return true; }
  catch { return false; }
};
const actualPeople = (ids, byId, on) => Array.isArray(ids) && ids.length > 0 && ids.every(id => personWasActiveOn(byId.get(id), on));

function scopeCovers(control, scopeIds, byId) {
  if (!Array.isArray(scopeIds)) return false;
  if (scopeIds.includes(control.id)) return true;
  const systems = new Set(scopeIds.filter(id => byId.get(id)?.type === "system"));
  for (const id of scopeIds) {
    const program = byId.get(id);
    if (program?.type === "program" && program.status !== "retired" && program.controlIds?.includes(control.id)) {
      for (const systemId of program.systemIds || []) systems.add(systemId);
    }
  }
  return control.systemIds?.length > 0 && control.systemIds.every(id => systems.has(id));
}

// A normal design review can already have reviewed this exact procedure and
// implementation. Reuse its retained inputs and frozen occurrence; a later date
// or a same-looking current file alone is not a revision binding.
export async function assessBoundControlPeriodReview(loaded, control, options = {}) {
  if (control?.type !== "control" || control.status !== "implemented" || !loaded.root || !valid(loaded, control)) return null;
  const asOf = options.asOf;
  if (!asOf) return null;
  const context = reviewHistoryContext(loaded.root, loaded), index = context.index;
  const head = index?.head || getGitSummary(loaded.root).commit;
  if (!head || !index?.available) return null;
  const byId = new Map(loaded.resources.map(record => [record.id, record]));
  const currentRevision = options.currentRevision || await currentPeriodImpactRevision(loaded, control);
  const occurrences = loaded.resources.filter(record => record.type === "obligation-occurrence" && record.status === "reconciled"
    && ["complete", "complete-with-exceptions"].includes(record.conclusion) && valid(loaded, record));
  for (const review of loaded.resources.filter(record => record.type === "control-activity" && record.profileId === "control-design-review"
    && record.status === "complete" && passing.has(record.result) && valid(loaded, record))) {
    const obligation = byId.get(review.obligationId);
    if (obligation?.type !== "obligation" || obligation.activityType !== "control-design-review"
      || !valid(loaded, obligation) || !scopeCovers(control, review.scopeResourceIds, byId)
      || !assessCompletionForObligation(review, obligation, loaded, { asOf }).complete) continue;
    const completedOn = completionDate(review, loaded.workspace.timezone || "UTC");
    if (!completedOn || !review.reviewedOn || review.reviewedOn < completedOn || review.reviewedOn > asOf
      || !actualPeople(review.performerIds, byId, completedOn) || !actualPeople(review.reviewerIds, byId, review.reviewedOn)) continue;
    const relevant = occurrences.filter(occurrence => occurrence.obligationId === obligation.id && occurrence.members?.some(member =>
      member.disposition === "expected" && member.result === "passed" && member.completionResourceIds?.includes(review.id)));
    for (const occurrence of relevant) {
      const first = [...(index.historiesById.get(occurrence.id) || [])].reverse().find(({ commit }) => {
        const snapshot = reviewHistoricalWorkspace(context, commit), prior = snapshot?.byId.get(occurrence.id);
        return prior?.status === "reconciled";
      });
      const frozen = first && reviewHistoricalWorkspace(context, first.commit);
      const frozenOccurrence = frozen?.byId.get(occurrence.id), frozenReview = frozen?.byId.get(review.id), frozenControl = frozen?.byId.get(control.id);
      const frozenProgram = frozen?.byId.get(occurrence.programId), frozenRule = frozen?.byId.get(occurrence.ruleId);
      if (!frozen || frozenProgram?.type !== "program" || !frozenProgram.controlIds?.includes(control.id)
        || frozenRule?.type !== "obligation-rule" || frozenRule.obligationId !== obligation.id || !valid(frozen, frozenRule)
        || !isDeepStrictEqual(frozenOccurrence, occurrence) || !isDeepStrictEqual(frozenReview, review)
        || !frozenControl || !scopeCovers(frozenControl, review.scopeResourceIds, frozen.byId)
        || !valid(frozen, frozenReview) || !valid(frozen, frozenOccurrence)) continue;
      const ownerPerformed = periodImpactReviewersAuthorized(frozen, frozenControl, { reviewedByIds: review.performerIds, reviewedOn: completedOn });
      const ownerReviewed = periodImpactReviewersAuthorized(frozen, frozenControl, { reviewedByIds: review.reviewerIds, reviewedOn: review.reviewedOn });
      if (!ownerPerformed && !ownerReviewed) continue;
      for (const evidenceId of review.evidenceIds || []) {
        const evidence = byId.get(evidenceId), original = frozen.byId.get(evidenceId);
        const frozenSource = frozen.byId.get(original?.sourceComponentId);
        if (!valid(loaded, evidence) || !original || evidence.readinessTest === true || original.readinessTest === true
          || preparationEvidenceIssues(evidence, byId, asOf).length || evidence.collectedOn > completedOn
          || !actualPeople(original.collectorIds, frozen.byId, original.collectedOn)
          || evidence.sourceKind !== "component" || original.sourceKind !== "component"
          || !["system-export", "configuration-export", "capture", "business-record"].includes(evidence.artifactKind)
          || evidence.artifactKind !== original.artifactKind || evidence.sourceCommit !== original.sourceCommit
          || evidence.sourceComponentId !== original.sourceComponentId || !isDeepStrictEqual(evidence.filePaths, original.filePaths)
          || frozenSource?.type !== "component" || !valid(frozen, frozenSource) || frozenSource.status !== "active" || !frozenSource.evidenceSourceKinds?.includes("governance")
          || !evidence.sourceCommit || !isDataHistoryAncestor(loaded, evidence.sourceCommit, first.commit)
          || !Array.isArray(evidence.filePaths) || !evidence.filePaths.length) continue;
        let fixed = true;
        for (const path of evidence.filePaths) {
          try {
            const info = await lstat(resolveDataPath(loaded.root, path));
            if (!info.isFile() || !info.size || getWorkingFileObjectId(loaded.root, `data/${path}`) !== getFileObjectIdAtRevision(loaded.root, first.commit, `data/${path}`)) fixed = false;
          } catch { fixed = false; }
        }
        if (!fixed) continue;
        const captured = reviewHistoricalWorkspace(context, evidence.sourceCommit), capturedControl = captured?.byId.get(control.id);
        if (!capturedControl || !scopeCovers(capturedControl, review.scopeResourceIds, captured.byId)) continue;
        const capturedRevision = await currentPeriodImpactRevision(captured, capturedControl);
        if (revisionsMatch("content", currentRevision, capturedRevision)) return {
          reviewResourceId: review.id, evidenceResourceId: evidence.id, occurrenceResourceId: occurrence.id, sourceRevision: evidence.sourceCommit
        };
      }
    }
  }
  return null;
}
