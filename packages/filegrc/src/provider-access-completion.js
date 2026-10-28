import { reviewHistoryContext, reviewHistoricalWorkspace, reviewHistoryCommits } from "./historical-workspace.js";
import { assessProviderAccessReconciliation } from "./provider-access-reconciliation.js";
import { preparationEvidenceIssues } from "./preparation-evidence.js";
import { personWasActiveOn } from "./soc2.js";
import { currentPartyPeople } from "./parties.js";
import { programComponents, recordBelongsToProgram } from "./program.js";
import { assertHistoricalRecordValid } from "./validate.js";
import { resourceDataPath } from "./resource-markdown.js";
import { currentCalendarDate, timestampFromLocalDateTime } from "./time.js";

const unique = (values) => [...new Set(values.filter(Boolean))];

export function providerAccessControls(loaded, program, controls = loaded.resources.filter((record) => record.type === "control" && program.controlIds?.includes(record.id))) {
  const byId = new Map(loaded.resources.map((record) => [record.id, record]));
  const profile = loaded.model.operatingPreparation?.baselineProfiles?.find(({ id }) => id === "provider-access");
  if (!profile) return [];
  const schedules = loaded.resources.filter((record) => record.type === "obligation" && record.status === "active"
    && profile.activities.includes(record.activityType) && recordBelongsToProgram(record, program, byId, loaded.model));
  return controls.filter((control) => profile.controlCodes.includes(control.code)
    || schedules.some((schedule) => schedule.controlIds?.includes(control.id)
      || byId.get(schedule.activeRuleId)?.controlIds?.includes(control.id)));
}

export function providerAccessPopulation(loaded, program, controls, options = {}) {
  const activeGrantComponents = new Set(loaded.resources.filter((record) => record.type === "access-grant" && record.status === "active").map(({ componentId }) => componentId));
  const historicalIds = options.historicalReviewComponentIds && new Set(options.historicalReviewComponentIds);
  // A provisioned setup login needs an account boundary review even when the
  // provider's service and data processing remain only proposals.
  // New setup-account classifications do not enlarge an already committed
  // review's dated population. Its active providers, selected Control sources
  // and explicitly reviewed setup boundaries remain checked. Current readiness
  // still assesses every real active setup account under the current rules.
  const componentIds = unique([...programComponents(loaded, program).filter(({ id, status }) => (
    ["active", "deprecated"].includes(status)
      || status === "planned" && activeGrantComponents.has(id) && (!historicalIds || historicalIds.has(id))
  )).map(({ id }) => id),
    ...controls.flatMap((control) => [...control.componentIds || [], ...control.evidenceSourceComponentIds || []])]);
  const grants = loaded.resources.filter((grant) => grant.type === "access-grant" && componentIds.includes(grant.componentId) && grant.status === "active");
  return { componentIds, grants };
}

// Keep provider scope, grant decisions and source proof identical for setup and
// program-wide recurring work. The caller owns its allowed completion window.
export function assessProgramAccessReview(candidate, loaded, program, controls, asOf, options = {}) {
  // A completed review proves a dated population, while readiness also asks
  // whether today's providers and active access are covered. Do not rewrite
  // old retain decisions or account totals after an account is later closed.
  if (!options.historicalAssessment && loaded.root && !loaded.historicalCommit && candidate.status === "complete") {
    const context = reviewHistoryContext(loaded.root, loaded);
    const commits = reviewHistoryCommits(context);
    // A review and its supporting grants or Evidence can land in separate
    // commits. Start at its exact committed revision, then consider later
    // source snapshots as well, while requiring that revision to stay intact.
    const firstMatch = context.index?.available
      ? [...context.index.historiesById.get(candidate.id) || []].reverse().find(({ commit }) =>
        JSON.stringify(context.index.recordsByCommit.get(commit)?.get(candidate.id)?.record) === JSON.stringify(candidate))?.commit
      : null;
    const start = context.index?.available ? commits.indexOf(firstMatch) : 0;
    for (const commit of start < 0 ? [] : commits.slice(start)) {
      const snapshot = reviewHistoricalWorkspace(context, commit);
      if (JSON.stringify(snapshot?.byId.get(candidate.id)) !== JSON.stringify(candidate)) continue;
      const priorProgram = snapshot.byId.get(program.id);
      if (!priorProgram) continue;
      const historical = assessProgramAccessReview(candidate, snapshot, priorProgram,
        providerAccessControls(snapshot, priorProgram), candidate.approvedOn, { ...options, historicalAssessment: true });
      if (!historical.complete) continue;
      const liveOptions = { ...options, historicalAssessment: true, historicalComponentIds: historical.reviewedComponentIds };
      const current = assessProgramAccessReview(candidate, loaded, program, controls, asOf, liveOptions);
      // Only these dated-population differences are superseded by the exact
      // historical assessment. Every other current or future failure survives.
      const historicalDifferences = new Set(["supported-grant-decisions", "accountable-provider-identities",
        "account-grant-mappings", "reconciled-account-counts", "unique-scoped-provider-reconciliations"]);
      const missingFacts = current.missingFacts.filter((fact) => !historicalDifferences.has(fact));
      const currentById = new Map(loaded.resources.map((record) => [record.id, record]));
      const invalidClosures = (candidate.grantDecisions || []).map(({ accessGrantId }) => accessGrantId).filter((id) => {
        if (snapshot.byId.get(id)?.status !== "active") return false;
        const grant = currentById.get(id);
        if (grant?.status === "active") return false;
        try { assertHistoricalRecordValid(grant, loaded.model, resourceDataPath(loaded.model, grant)); } catch { return true; }
        return !["revoked", "expired"].includes(grant.status) || !grant.deprovisionedOn
          || grant.deprovisionedOn < candidate.completedOn || grant.deprovisionedOn > asOf;
      });
      if (invalidClosures.length) missingFacts.push("current-authorized-access");
      // Current active grants may not acquire different authority, subject or provider
      // under the identity of an already reviewed grant.
      const liveComponentIds = new Set([...providerAccessPopulation(loaded, program, controls).componentIds, ...historical.reviewedComponentIds]);
      const reviewedGrantIds = new Set((candidate.grantDecisions || []).map(({ accessGrantId }) => accessGrantId));
      const grants = loaded.resources.filter((record) => record.type === "access-grant" && record.status === "active"
        && (liveComponentIds.has(record.componentId) || reviewedGrantIds.has(record.id)));
      const changed = grants.filter((grant) => {
        const prior = snapshot.byId.get(grant.id);
        return prior && (["subjectId", "componentId", "accessLevel", "role", "privileged"].some((field) => prior[field] !== grant[field]));
      }).map(({ id }) => id);
      if (changed.length) missingFacts.push("current-authorized-access");
      // Closed accounts remain historical. Still-live identities without a
      // separate grant (for example an inventoried service identity) retain
      // their current ownership, expiry and review requirements.
      if (candidate.sourceReconciliations) {
        const activeIds = new Set(grants.map(({ id }) => id));
        const liveCandidate = { ...candidate,
          grantDecisions: (candidate.grantDecisions || []).filter(({ accessGrantId, decision }) => activeIds.has(accessGrantId) || decision === "remove"),
          sourceReconciliations: candidate.sourceReconciliations.map((row) => row.accounts === undefined ? row : ({ ...row,
          accounts: row.accounts?.filter((account) => account.disposition !== "authorized"
            || (account.accessGrantIds?.length ? account.accessGrantIds.some((id) => activeIds.has(id))
            : loaded.resources.find(({ id }) => id === account.subjectId)?.status === "active"))
            .map((account) => account.disposition === "authorized" && account.accessGrantIds?.length
              ? { ...account, accessGrantIds: account.accessGrantIds.filter((id) => activeIds.has(id)) } : account)
        })) };
        const live = assessProgramAccessReview(liveCandidate, loaded, program, controls, asOf, liveOptions);
        // Projected account totals differ from the retained original exports;
        // their completeness/proof checks were enforced above on the full rows.
        const projectionDifferences = new Set(["reconciled-account-counts", "actual-provider-population-and-results"]);
        missingFacts.push(...live.missingFacts.filter((fact) => !projectionDifferences.has(fact)));
      }
      return { ...historical, ...current, complete: missingFacts.length === 0, missingFacts: unique(missingFacts),
        historicalReviewCommit: commit, issues: unique(missingFacts),
        reviewedComponentIds: historical.reviewedComponentIds, invalidGrantIds: unique([...current.invalidGrantIds, ...changed, ...invalidClosures]),
        missingSourceIds: [], missingMappedGrantIds: [], unresolvedAccountReferences: [] };
    }
  }
  const byId = new Map(loaded.resources.map((record) => [record.id, record]));
  const population = providerAccessPopulation(loaded, program, controls, loaded.historicalCommit
    ? { historicalReviewComponentIds: candidate.componentIds || [] } : {});
  const componentIds = unique([...population.componentIds, ...options.historicalComponentIds || []]);
  const grants = options.historicalComponentIds ? loaded.resources.filter((record) => record.type === "access-grant"
    && record.status === "active" && componentIds.includes(record.componentId)) : population.grants;
  const valid = (record) => {
    try { assertHistoricalRecordValid(record, loaded.model, resourceDataPath(loaded.model, record)); return true; }
    catch { return false; }
  };
  const actualPeople = (ids, date) => ids?.length > 0 && ids.every((id) => personWasActiveOn(byId.get(id), date));
  const evidence = (record) => (record.evidenceIds || []).map((id) => byId.get(id));
  const proofValid = (record) => {
    const proofs = evidence(record);
    return proofs.length > 0 && proofs.every((proof) => valid(proof) && !preparationEvidenceIssues(proof, byId, asOf).length)
      && proofs.some((proof) => proof.readinessTest !== true);
  };
  const timezone = loaded.workspace?.timezone || "UTC";
  const assessedAt = asOf === currentCalendarDate(timezone) ? new Date().toISOString() : timestampFromLocalDateTime(`${asOf}T23:59:59`, timezone);
  const permittedDate = options.permittedDate || ((date) => Boolean(date && date <= asOf));

  if (!valid(candidate)) return { resourceId: candidate.id, complete: false, missingFacts: ["valid-access-review"], missingScopeIds: [], missingGrantIds: [], missingSourceIds: [], invalidGrantIds: [], unresolvedDecisionIds: [], permittedExceptionIds: [], remediationIds: [] };
  const issues = [], missingScopeIds = componentIds.filter((id) => !candidate.componentIds?.includes(id));
  const decisions = candidate.grantDecisions || [];
  const scopedComponentIds = new Set(programComponents(loaded, program).map(({ id }) => id));
  const invalidGrantIds = grants.filter((grant) => {
    const subject = byId.get(grant.subjectId);
    const component = byId.get(grant.componentId);
    const currentBoundary = ["active", "deprecated"].includes(component?.status)
      || component?.status === "planned" && scopedComponentIds.has(component.id);
    return !currentBoundary || !valid(grant) || grant.expiresOn && grant.expiresOn < asOf || !grant.provisionedOn || grant.provisionedOn > candidate.completedOn
      || !actualPeople(grant.approvedByIds, grant.approvedOn) || !actualPeople(grant.provisionedByIds, grant.provisionedOn)
      || !subject || subject.type === "person" && !personWasActiveOn(subject, asOf)
      || subject.type === "service-account" && (subject.status !== "active" || currentPartyPeople(subject.ownerIds || [], byId).size === 0);
  }).map(({ id }) => id);
  if (invalidGrantIds.length) issues.push("current-authorized-access");
  const missingGrantIds = grants.filter((grant) => !decisions.some(({ accessGrantId }) => accessGrantId === grant.id)).map(({ id }) => id);
  if (!valid(candidate) || candidate.status !== "complete" || !["passed", "passed-with-exceptions"].includes(candidate.outcome)
    || !permittedDate(candidate.completedOn)) issues.push("completed-access-reconciliation");
  if (!candidate.approvedOn || candidate.approvedOn < candidate.completedOn || candidate.approvedOn > asOf
    || !actualPeople(candidate.reviewerIds, candidate.completedOn) || !actualPeople(candidate.approvedByIds, candidate.approvedOn)) issues.push("existing-access-review-approval");
  if (missingScopeIds.length) issues.push("all-provider-components");
  if (missingGrantIds.length || unique(decisions.map(({ accessGrantId }) => accessGrantId)).length !== decisions.length) issues.push("per-grant-decisions");
  const reviewedGrants = decisions.map(({ accessGrantId }) => byId.get(accessGrantId));
  const unresolvedDecisionIds = [];
  const permittedExceptionIds = [];
  const remediationIds = [];
  const followUps = (grant) => loaded.resources.filter((action) => action.type === "action-item" && action.sourceResourceId === grant.id && valid(action));
  const exceptionFor = (grant) => loaded.resources.find((exception) => exception.type === "exception" && exception.status === "approved"
    && valid(exception) && exception.scopeResourceIds?.includes(grant.id) && exception.rationale?.trim()
    && exception.approval.approvedOn <= candidate.approvedOn && exception.approval.expiresOn >= asOf
    && actualPeople(exception.approval.approvedByIds, exception.approval.approvedOn)
    && currentPartyPeople(exception.ownerIds || [], byId).size > 0
    && loaded.resources.some((action) => action.type === "action-item" && [grant.id, exception.id].includes(action.sourceResourceId)
      && valid(action) && ["open", "in-progress", "blocked"].includes(action.status)
      && currentPartyPeople(action.assigneeIds || [], byId).size > 0
      && (action.completionWindow.precision === "timestamp" ? action.completionWindow.dueAt >= assessedAt : action.completionWindow.dueOn >= asOf)
      && (action.completionWindow.precision === "timestamp" ? action.completionWindow.dueAt <= timestampFromLocalDateTime(`${exception.approval.expiresOn}T23:59:59`, timezone) : action.completionWindow.dueOn <= exception.approval.expiresOn)));
  const invalidDecisions = decisions.some((decision, index) => {
    const grant = reviewedGrants[index];
    if (grant?.type !== "access-grant" || !componentIds.includes(grant.componentId)
      || !valid(grant) || !grant.provisionedOn || grant.provisionedOn > candidate.completedOn) return true;
    if (grant.status !== "active") return decision.decision !== "remove" || !grant.deprovisionedOn || grant.deprovisionedOn > asOf;
    if (decision.decision === "retain") return false;
    const completedChange = decision.decision === "change" && followUps(grant).find((action) => action.status === "done"
      && action.completedOn >= candidate.completedOn && action.completedOn <= asOf
      && action.completionResourceIds?.includes(grant.id) && proofValid(action));
    if (completedChange) { remediationIds.push(completedChange.id); return false; }
    const exception = exceptionFor(grant);
    if (exception && candidate.outcome === "passed-with-exceptions") { permittedExceptionIds.push(exception.id); return false; }
    unresolvedDecisionIds.push(grant.id);
    return false;
  });
  if (unresolvedDecisionIds.length || candidate.exceptionCount < unique(permittedExceptionIds).length) issues.push("resolved-access-decisions");
  if (invalidDecisions) issues.push("supported-grant-decisions");
  if ((!candidate.sourceReconciliations && candidate.populationCount !== decisions.length) || candidate.exceptionCount === undefined) issues.push("reconciled-account-counts");
  const generatedOn = (proof) => proof?.generatedAt ? currentCalendarDate(timezone, new Date(proof.generatedAt)) : null;
  const exports = evidence(candidate).filter((proof) => valid(proof) && !preparationEvidenceIssues(proof, byId, asOf).length
    && proof.artifactKind === "population-export" && proof.readinessTest !== true && permittedDate(generatedOn(proof))
    && generatedOn(proof) <= candidate.completedOn && proof.collectedOn >= generatedOn(proof) && proof.collectedOn <= candidate.completedOn && proof.completenessValidation?.trim() && proof.accuracyValidation?.trim());
  const reconciliation = candidate.sourceReconciliations ? assessProviderAccessReconciliation(candidate,
    { componentIds, exports, byId, asOf, valid, proofValid, grants, timezone }) : null;
  if (reconciliation) issues.push(...reconciliation.issues);
  const missingSourceIds = reconciliation?.missingSourceIds || componentIds.filter((id) => !exports.some((proof) => proof.sourceComponentId === id
    && proof.populationCount === reviewedGrants.filter((grant) => grant?.componentId === id).length));
  if (missingSourceIds.length) issues.push("actual-provider-population-and-results");
  return { resourceId: candidate.id, reviewedComponentIds: componentIds, complete: !issues.length, missingFacts: issues, missingScopeIds, missingGrantIds, missingSourceIds, invalidGrantIds, unresolvedDecisionIds, permittedExceptionIds, remediationIds, ...(reconciliation || {}) };
}
