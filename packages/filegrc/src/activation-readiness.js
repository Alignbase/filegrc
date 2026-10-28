import { getRecordIdentityHistory, getFileAtRevision } from "./git.js";
import { reviewHistoricalWorkspace, reviewHistoryContext } from "./historical-workspace.js";
import { modelSupports } from "../model/index.js";
import { assessReportingRouteSets } from "./reporting-route-sets.js";
import { reportingRouteSourceAppliesToProgram } from "./reporting-route-integrity.js";
import { timestampFromLocalDateTime } from "./time.js";

export async function reportingCutoverIssues(loaded, updates, { operatingAsOf, includeHistoryContext = false } = {}) {
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
    const original = loaded.resources.find(({ id }) => id === source.id);
    // Current preparation may repair a legacy operating gap. Actual activation
    // still uses the original cutover, and historical period checks stay strict.
    if (operatingAsOf && original?.status === "active" && original.effectiveOn
      && new Date(effectiveAt) <= new Date(operatingAsOf)) effectiveAt = operatingAsOf;
    for (const program of future.resources.filter((record) => record.type === "program" && record.status !== "retired"
      && reportingRouteSourceAppliesToProgram(source, record, future.resources))) {
      for (const requirement of source.reportingRouteRequirements) {
        if (!requirement || typeof requirement !== "object" || Array.isArray(requirement)) { issues.push({ code: "invalid-reporting-route-requirement", sourceId: source.id, programId: program.id, message: "Each reporting requirement must be an object." }); continue; }
        if (requirement.programScope === "selected-programs" && !requirement.programIds?.includes(program.id)) continue;
        const at = new Date(requirement.effectiveAt) > new Date(effectiveAt) ? requirement.effectiveAt : effectiveAt;
        if (requirement.endsAt && new Date(requirement.endsAt) <= new Date(at)) continue;
        const assessment = await assessReportingRouteSets(future, { programId: program.id, at, operatingOnly: true });
        const candidateIds = new Set(assessment.routeSets.filter(({ record }) => record.purposeKey === requirement.purposeKey).map(({ record }) => record.id));
        const relevant = assessment.issues.filter((issue) => issue.resourceId === source.id || candidateIds.has(issue.resourceId));
        for (const issue of relevant) {
          const temporal = includeHistoryContext && issue.code === "uncovered-reporting-route-interval"
            ? await resolvedReportingAuthorizationInterval(future, issue, { programId: program.id, purposeKey: requirement.purposeKey, at }) : null;
          issues.push({ ...issue, sourceId: source.id, programId: program.id, ...(temporal ? { temporal } : {}) });
        }
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

// Missing earlier authorization records do not prove that channels were absent.
// A valid current baseline and a dated valid effective cutover can bound the
// retained evidence limitation. Proposal and approval review dates alone cannot.
async function resolvedReportingAuthorizationInterval(loaded, issue, { programId, purposeKey, at }) {
  const startsAt = new Date(at), now = new Date();
  if (!Number.isFinite(startsAt.getTime()) || startsAt >= now) return null;
  const current = await assessReportingRouteSets(loaded, { programId, at: now.toISOString(), operatingOnly: true });
  const covers = assessment => {
    const baseline = assessment.routeSets.filter(item => item.record.purposeKey === purposeKey && item.effective && !item.canceled);
    if (baseline.length !== 1 || baseline[0].state !== "complete") return false;
    const ids = new Set([issue.resourceId, baseline[0].record.id]);
    return !assessment.issues.some(item => ids.has(item.resourceId));
  };
  if (!covers(current)) return null;
  const boundaries = [...new Set(loaded.resources.filter(record => record.type === "reporting-route-set"
    && record.programId === programId && record.purposeKey === purposeKey)
    .map(record => record.approval?.effectiveAt).filter(value => typeof value === "string"
      && Number.isFinite(Date.parse(value)) && new Date(value) > startsAt && new Date(value) <= now))].sort((a, b) => Date.parse(a) - Date.parse(b));
  for (const boundary of boundaries) {
    const assessment = await assessReportingRouteSets(loaded, { programId, at: boundary, operatingOnly: true });
    if (covers(assessment)) return { programId, startsAt: startsAt.toISOString(), endsAt: new Date(boundary).toISOString(),
      resolved: true, evidenceLimitation: true, purposeKey };
  }
  return null;
}
