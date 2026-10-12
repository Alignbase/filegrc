import { getRecordIdentityHistory, getFileAtRevision } from "./git.js";
import { reviewHistoricalWorkspace, reviewHistoryContext } from "./historical-workspace.js";
import { modelSupports } from "../model/index.js";
import { assessReportingRouteSets } from "./reporting-route-sets.js";
import { reportingRouteSourceAppliesToProgram } from "./reporting-route-integrity.js";
import { timestampFromLocalDateTime } from "./time.js";

export async function reportingCutoverIssues(loaded, updates) {
  if (!modelSupports(loaded.model, "schedule-set-review")) return [];
  const sources = updates.filter((record) => ["policy", "document", "commitment", "risk"].includes(record.type)
    && Array.isArray(record.reportingRouteRequirements) && record.reportingRouteRequirements.length);
  if (!sources.length) return [];
  const updated = new Map(updates.map((record) => [record.id, record]));
  const future = { ...loaded, resources: loaded.resources.map((record) => updated.get(record.id) || record) };
  const issues = [];
  for (const source of sources) {
    let effectiveAt;
    try { effectiveAt = timestampFromLocalDateTime(`${source.effectiveOn || source.statusTransition?.changedOn || new Date().toISOString().slice(0, 10)}T00:00:00`, loaded.workspace?.timezone || "UTC"); }
    catch { issues.push({ code: "invalid-cutover-date", sourceId: source.id, message: "The intended content effective date and timezone must be valid." }); continue; }
    for (const program of future.resources.filter((record) => record.type === "program" && record.status !== "retired"
      && reportingRouteSourceAppliesToProgram(source, record, future.resources))) {
      for (const requirement of source.reportingRouteRequirements) {
        if (!requirement || typeof requirement !== "object" || Array.isArray(requirement)) { issues.push({ code: "invalid-reporting-route-requirement", sourceId: source.id, programId: program.id, message: "Each reporting requirement must be an object." }); continue; }
        if (requirement.programScope === "selected-programs" && !requirement.programIds?.includes(program.id)) continue;
        const at = new Date(requirement.effectiveAt) > new Date(effectiveAt) ? requirement.effectiveAt : effectiveAt;
        if (requirement.endsAt && new Date(requirement.endsAt) <= new Date(at)) continue;
        const assessment = await assessReportingRouteSets(future, { programId: program.id, at });
        const candidateIds = new Set(assessment.routeSets.filter(({ record }) => record.purposeKey === requirement.purposeKey).map(({ record }) => record.id));
        const relevant = assessment.issues.filter((issue) => issue.resourceId === source.id || candidateIds.has(issue.resourceId));
        issues.push(...relevant.map((issue) => ({ ...issue, sourceId: source.id, programId: program.id })));
      }
    }
  }
  return [...new Map(issues.map((issue) => [`${issue.code}:${issue.resourceId}:${issue.programId}:${issue.message}`, issue])).values()];
}

export async function requireReportingCutover(loaded, updates) {
  const issues = await reportingCutoverIssues(loaded, updates);
  if (issues.length) throw Object.assign(new Error(`Reporting channels are not ready for activation: ${issues[0].message}`), { code: "FILEGRC_ACTIVATION_NOT_READY" });
}

export async function scheduleCutoverIssues(loaded, updates, options = {}) {
  if (!modelSupports(loaded.model, "schedule-set-review")) return [];
  const { assessCollectionReview } = await import("./collection-review.js");
  const { recordBelongsToProgram } = await import("./program.js");
  const { scheduleSetIssues } = await import("./schedule-set.js");
  const byId = new Map(loaded.resources.map((record) => [record.id, record]));
  const issues = [];
  for (const source of updates.filter((record) => ["policy", "document", "training"].includes(record.type)
    && record.workflowScope !== "engagement")) {
    const programs = loaded.resources.filter((record) => record.type === "program" && record.status !== "retired"
      && recordBelongsToProgram(source, record, byId, loaded.model));
    for (const program of programs) {
      const assessment = assessCollectionReview(loaded, "obligation", { programId: program.id });
      let at;
      try { at = timestampFromLocalDateTime(`${source.effectiveOn}T00:00:00`, loaded.workspace?.timezone || "UTC"); }
      catch { issues.push({ code: "invalid-cutover-date", sourceId: source.id, programId: program.id, message: "The intended content effective date and timezone must be valid." }); continue; }
      if (!assessment.complete) issues.push({ code: "schedule-set-approval-required", sourceId: source.id, programId: program.id, message: assessment.message });
      else if (assessment.review.reviewedOn > source.effectiveOn || source.activatedOn && assessment.review.reviewedOn > source.activatedOn) issues.push({ code: "schedule-set-approval-after-cutover", sourceId: source.id, programId: program.id, message: "The schedule set must be reviewed before the content's actual activation and intended effective date. Do not backdate operation before approval." });
      else issues.push(...scheduleSetIssues(loaded, program, assessment.review, { at }).map((issue) => ({ ...issue, sourceId: source.id, programId: program.id })));
    }
  }
  return issues;
}

export async function requireScheduleCutover(loaded, updates, options = {}) {
  const issues = await scheduleCutoverIssues(loaded, updates, options);
  if (issues.length) throw Object.assign(new Error(`Schedule set is not ready for activation: ${issues[0].message}`), { code: "FILEGRC_ACTIVATION_NOT_READY" });
}

// A commit must not turn a rejected direct-file cutover into an accepted one.
// Content already active before v12 remains an operating fact during migration.
export function historicalContentCutover(loaded, record) {
  if (!record || !["active", "open", "monitoring"].includes(record.status)) return null;
  const key = (value) => JSON.stringify([value.status, value.effectiveOn, value.activatedOn, value.reportingRouteRequirements || []]);
  let boundary = null;
  for (const entry of getRecordIdentityHistory(loaded.root, record.id)) {
    const source = getFileAtRevision(loaded.root, entry.commit, entry.path);
    if (!source) break;
    let prior;
    try { prior = JSON.parse(source); } catch { break; }
    if (key(prior) !== key(record)) break;
    boundary = entry;
  }
  if (!boundary) return null;
  const snapshot = reviewHistoricalWorkspace(reviewHistoryContext(loaded.root, loaded), boundary.commit);
  if (!snapshot || !modelSupports(snapshot.model, "schedule-set-review")) return null;
  const prior = snapshot.resources.find(({ id }) => id === record.id);
  return prior ? { snapshot, record: prior } : null;
}
