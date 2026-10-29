import { governedMarkdownSource, registerGovernedLookup, governedContentBaseline, governedApprovalContentMatches } from "./governed-content-baseline.js";
import { assessProgramAccessReview, providerAccessPopulation, providerAccessControls } from "./provider-access-completion.js";
import { markdownEntries, resourceDataPath } from "./resource-markdown.js";
import { contentRevision } from "./files.js";
import { revisionsMatch } from "./revisions.js";
import { substantiveMarkdown, openPlaceholderCount } from "./content-readiness.js";
import { preparationEvidenceIssues } from "./preparation-evidence.js";
import { personWasActiveOn } from "./soc2.js";
import { currentPartyPeople, partiesIndependent } from "./parties.js";
import { programComponents, recordBelongsToProgram } from "./program.js";
import { selectScopedCollectionRecords } from "./collection-scope.js";
import { planObligations } from "./obligations.js";
import { currentCalendarDate, timestampFromLocalDateTime } from "./time.js";
import { modelSupports } from "../model/index.js";
import { assertHistoricalRecordValid } from "./validate.js";

const unique = (values) => [...new Set(values.filter(Boolean))];

export async function currentProcedureContent(loaded, record, revisions = null) {
  if (!record) return false;
  const entries = markdownEntries(loaded.model, record);
  const matches = await Promise.all(entries.map(async ({ path }) => {
    try {
      const text = governedMarkdownSource(loaded, record, path) || "";
      return substantiveMarkdown(text) && !openPlaceholderCount(text)
        && (!revisions || revisionsMatch("content", contentRevision(text), revisions[path]));
    } catch (error) { if (error.code === "ENOENT") return false; throw error; }
  }));
  return matches.length > 0 && matches.every(Boolean);
}

// This is current setup proof, not a substitute for reconciliation of each
// recurring occurrence. The selected Controls and their schedules choose the
// work; actual actors, dates, populations and results establish completion.
export async function assessProgramBaseline(loaded, program, controls, asOf, makeCheck) {
  const byId = registerGovernedLookup(new Map(loaded.resources.map((record) => [record.id, record])), loaded);
  const obligations = loaded.resources.filter((record) => record.type === "obligation" && record.status === "active"
    && recordBelongsToProgram(record, program, byId, loaded.model));
  const ruleFor = (record) => byId.get(record.activeRuleId) || record;
  const valid = (record) => {
    try { assertHistoricalRecordValid(record, loaded.model, resourceDataPath(loaded.model, record)); return true; }
    catch { return false; }
  };
  const actualPeople = (ids, date) => ids?.length > 0 && ids.every((id) => personWasActiveOn(byId.get(id), date));
  const evidence = (record) => (record.evidenceIds || []).map((id) => byId.get(id));
  const proofValid = (record) => {
    const proofs = evidence(record);
    // A rehearsal may support an assessment without proving operation itself.
    // Keep every linked artifact valid and require actual operating proof too.
    return proofs.length > 0 && proofs.every((proof) =>
      valid(proof) && !preparationEvidenceIssues(proof, byId, asOf).length)
      && proofs.some((proof) => proof.readinessTest !== true);
  };
  const timezone = loaded.workspace?.timezone || "UTC";
  const assessedAt = asOf === currentCalendarDate(timezone) ? new Date().toISOString() : timestampFromLocalDateTime(`${asOf}T23:59:59`, timezone);
  const calendar = planObligations(loaded.resources, { root: loaded.root, loaded, model: loaded.model, programId: program.id, asOf, from: asOf, through: asOf, includeComplete: true }).calendarItems;
  const checks = [];
  for (const profile of loaded.model.operatingPreparation?.baselineProfiles || []) {
    const schedules = obligations.filter((record) => profile.activities.includes(record.activityType));
    const selected = profile.id === "provider-access" ? providerAccessControls(loaded, program, controls) : controls.filter((control) => profile.controlCodes.includes(control.code)
      || schedules.some((record) => record.controlIds?.includes(control.id) || ruleFor(record).controlIds?.includes(control.id)));
    if (!selected.length) continue;
    const controlIds = selected.map(({ id }) => id);
    const notBefore = selected.flatMap((control) => [control.effectiveOn, control.procedureEffectiveOn]).filter(Boolean).sort().at(-1);
    const windows = schedules.map((schedule) => {
      const task = calendar.filter((task) => task.obligationId === schedule.id && task.dueWindowStart <= asOf)
        .sort((a, b) => b.dueWindowStart.localeCompare(a.dueWindowStart))[0];
      if (!task) return null;
      // Setup proof may precede content cutover within the adopted cycle.
      // Use the planner's exact rule, anchor and configured offsets instead of
      // reconstructing a cycle from its shifted or clipped operating start.
      return task.cycleWindowStart && task.cycleWindowStart < task.dueWindowStart
        ? { ...task, dueWindowStart: task.cycleWindowStart }
        : task;
    }).filter(Boolean);
    const currentDate = (date) => Boolean(date && date <= asOf && (!notBefore || date >= notBefore));
    const permittedDate = (date, relevantWindows = windows) => currentDate(date)
      && relevantWindows.every((window) => date >= window.dueWindowStart && date <= window.dueWindowEnd);
    const candidates = loaded.resources.filter((record) => {
      if (record.type !== profile.resourceType) return false;
      // Invalid direct edits remain repair candidates; malformed relationships
      // cannot establish completion or be traversed safely for program scope.
      if (!valid(record)) return !record.programId || record.programId === program.id;
      return recordBelongsToProgram(record, program, byId, loaded.model);
    });
    let details = { controlIds, obligationIds: schedules.map(({ id }) => id), candidateIds: candidates.map(({ id }) => id),
      completionWindows: windows.map(({ obligationId, dueWindowStart, dueWindowEnd }) => ({ obligationId, startsOn: dueWindowStart, endsOn: dueWindowEnd })),
      approval: "Reuse the record's normal review and existing proof. This baseline adds no separate independent approval; reconcile scheduled occurrences separately using their allowed dates and scope." };
    let record = candidates[0], complete = false, title, work, acceptance;
    if (profile.id === "program-risk") {
      const components = programComponents(loaded, program).filter(({ status }) => status === "active");
      const scope = { systemIds: program.systemIds || [], componentIds: components.map(({ id }) => id),
        vendorIds: unique(components.map(({ vendorId }) => vendorId)),
        commitmentIds: loaded.resources.filter((record) => record.type === "commitment" && record.status === "active"
          && recordBelongsToProgram(record, program, byId, loaded.model)).map(({ id }) => id),
        riskIds: loaded.resources.filter((record) => record.type === "risk" && ["open", "monitoring"].includes(record.status)
          && recordBelongsToProgram(record, program, byId, loaded.model)).map(({ id }) => id) };
      const assessments = await Promise.all(candidates.map(async (candidate) => {
        if (!valid(candidate)) return { resourceId: candidate.id, complete: false, missingFacts: ["valid-risk-assessment"], missingScopeIds: [] };
        const missingScopeIds = Object.entries(scope).flatMap(([field, ids]) => ids.filter((id) => !candidate[field]?.includes(id)));
        const issues = [];
        if (!valid(candidate) || candidate.status !== "complete" || !["enterprise-risk", "system-risk"].includes(candidate.assessmentKind)) issues.push("completed-program-assessment");
        if (!scope.systemIds.length || missingScopeIds.length) issues.push("full-program-scope");
        if (!permittedDate(candidate.completedOn)) issues.push("current-completion-date");
        if (!candidate.approvedOn || candidate.approvedOn < candidate.completedOn || candidate.approvedOn > asOf
          || !actualPeople(candidate.assessorIds, candidate.completedOn) || !actualPeople(candidate.reviewerIds, candidate.approvedOn)
          || !partiesIndependent(candidate.assessorIds || [], candidate.reviewerIds || [], byId)) issues.push("existing-independent-risk-review");
        if (!proofValid(candidate) || !await currentProcedureContent(loaded, candidate)) issues.push("assessment-results-and-proof");
        return { resourceId: candidate.id, complete: !issues.length, missingFacts: issues, missingScopeIds };
      }));
      const result = assessments.find(({ complete }) => complete) || assessments.sort((a, b) => a.missingFacts.length - b.missingFacts.length)[0];
      record = byId.get(result?.resourceId) || record; complete = result?.complete === true;
      title = "Complete the full program risk assessment";
      work = `Inspect threats, fraud, dependencies and changes across ${scope.systemIds.map((id) => byId.get(id)?.title || id).join(", ") || "the selected Systems"}, their Components, providers and approved commitments. Rate the risks and record response decisions, including the current risk register. Finish the existing Risk Assessment's results, methodology and evidence, then obtain its normal review by a person separate from the assessor. A vendor-only or narrow assessment cannot cover the program.`;
      acceptance = "A completed current enterprise or system risk assessment explicitly covers every scoped System, active Component, provider, commitment and current Risk, with real results, proof and its existing independent review.";
      details = { ...details, populationIds: unique(Object.values(scope).flat()), scope, candidateResults: assessments,
        resultIds: complete ? [record.id] : [], missingFacts: result?.missingFacts || ["completed-program-assessment"],
        instructions: result?.missingScopeIds.length ? [`Include the missing program scope: ${result.missingScopeIds.map((id) => byId.get(id)?.title || id).join(", ")}.`] : [] };
    } else if (profile.id.startsWith("workforce-")) {
      const training = profile.id === "workforce-training";
      const policyIds = unique([...program.policyIds || [], ...selected.flatMap(({ policyIds = [] }) => policyIds)]);
      const scheduleSubjectIds = (schedule) => unique([...(ruleFor(schedule).scopeResourceIds || schedule.scopeResourceIds || []), ruleFor(schedule).templateResourceId || schedule.templateResourceId])
        .map((id) => modelSupports(loaded.model, "operating-preparation")
          ? governedContentBaseline(byId.get(id), byId, asOf, loaded.model)?.id || id : id);
      const scheduledSubjects = modelSupports(loaded.model, "operating-preparation")
        ? unique(schedules.flatMap(scheduleSubjectIds))
        : unique(schedules.flatMap((schedule) => [...ruleFor(schedule).scopeResourceIds || [], ...schedule.scopeResourceIds || [], ruleFor(schedule).templateResourceId, schedule.templateResourceId]));
      const sourceSubjects = loaded.resources.filter((subject) => ["policy", "document", "training"].includes(subject.type));
      const subjects = modelSupports(loaded.model, "operating-preparation")
        ? [...new Map(sourceSubjects.map((subject) => {
          const baseline = governedContentBaseline(subject, byId, asOf, loaded.model,
            { contentMatches: (candidate) => governedApprovalContentMatches(loaded, candidate) }) || subject;
          return [baseline.id, baseline];
        })).values()] : sourceSubjects;
      const operatingSubjects = subjects.filter((subject) => valid(subject) && ["approved", "active"].includes(subject.status) && (training
        ? subject.type === "training" && (subject.controlIds?.some((id) => controlIds.includes(id))
          || scheduledSubjects.includes(subject.id))
        : subject.type === "policy" && policyIds.includes(subject.id)
          || subject.type === "document" && subject.acknowledgementRequired === true && subject.workflowScope === "program"
            && (subject.controlIds?.some((id) => controlIds.includes(id)) || scheduledSubjects.includes(subject.id))));
      // All current internal workers are included, even when a new hire has not
      // yet acquired an owner role. Explicit schedule selectors can add the
      // applicable external workforce without pulling in external reviewers.
      const workers = loaded.resources.filter((person) => person.type === "person" && person.affiliation === "internal"
        && personWasActiveOn(person, asOf));
      const internalWorkerIds = unique(workers.map(({ id }) => id));
      const subjectSchedules = (subject) => schedules.filter((schedule) => scheduleSubjectIds(schedule).includes(subject.id));
      const subjectPopulations = operatingSubjects.map((subject) => {
        const matching = subjectSchedules(subject);
        const roleOnly = training && matching.length > 0 && matching.every(({ activityType }) => activityType === "role-training");
        const people = roleOnly ? [] : [...internalWorkerIds];
        let audienceConfigured = !roleOnly;
        for (const schedule of matching) {
          const selector = ruleFor(schedule).selector || schedule.selector;
          if (selector?.resourceType === "person") {
            audienceConfigured = true;
            people.push(...selectScopedCollectionRecords(loaded, selector, program).filter((person) => personWasActiveOn(person, asOf)).map(({ id }) => id));
          }
          const explicitPeople = (ruleFor(schedule).scopeResourceIds || schedule.scopeResourceIds || []).filter((id) => byId.get(id)?.type === "person" && personWasActiveOn(byId.get(id), asOf));
          if (explicitPeople.length) { audienceConfigured = true; people.push(...explicitPeople); }
        }
        return { subjectId: subject.id, personIds: unique(people), audienceConfigured };
      });
      const population = unique(subjectPopulations.flatMap(({ personIds }) => personIds));
      const missingAudiences = subjectPopulations.filter(({ audienceConfigured }) => !audienceConfigured);
      const results = [];
      const missing = [];
      for (const subject of operatingSubjects) {
        const subjectCurrent = subject.approvedOn && subject.approvedOn <= asOf
          && await currentProcedureContent(loaded, subject, subject.approvedContentRevisions);
        for (const personId of subjectPopulations.find(({ subjectId }) => subjectId === subject.id).personIds) {
          const eligible = candidates.filter((candidate) => valid(candidate) && candidate.personId === personId && candidate.subjectResourceIds?.includes(subject.id));
          let accepted;
          for (const candidate of eligible) {
            if (subjectCurrent && valid(candidate) && candidate.status === "completed" && permittedDate(candidate.completedOn, windows.filter((window) => {
              const schedule = byId.get(window.obligationId);
              const ids = scheduleSubjectIds(schedule);
              return !ids.length || ids.includes(subject.id);
            }))
              && candidate.completedOn >= (byId.get(personId)?.startDate || "") && candidate.completedOn >= subject.approvedOn
              && (!candidate.expiresOn || candidate.expiresOn >= asOf)
              && candidate.contentRevisions && await currentProcedureContent(loaded, subject, candidate.contentRevisions)
              && (candidate.attestationMethod === "git-approval" || proofValid(candidate))) { accepted = candidate; break; }
          }
          if (accepted) results.push(accepted.id);
          else missing.push({ personId, subjectId: subject.id, candidateIds: eligible.map(({ id }) => id), missingFacts: [training ? "current-training-completion" : "current-policy-acknowledgement"] });
        }
      }
      complete = operatingSubjects.length > 0 && population.length > 0 && missing.length === 0 && missingAudiences.length === 0;
      record = missing.length ? byId.get(missing[0].candidateIds[0]) : byId.get(results[0]);
      title = training ? "Complete current workforce training" : "Collect current workforce policy acknowledgements";
      work = `${training ? "Have each current worker finish the approved security training and its passing criteria" : "Have each current worker read and acknowledge the approved program policies and required Documents"}. Compare the workforce roster with the person-by-subject gaps below, including new hires. Reuse completed Attestations only for the current content revision and applicable worker. Record actual completion dates and retain signed or external completion proof when used. An export rehearsal, pending assignment or old-content acknowledgement does not complete this work.`;
      acceptance = "Each current worker has a completed, unexpired Attestation for every applicable current subject revision. External or signed completion also retains actual completion Evidence. Resolve an empty roster or missing subjects through the existing inventory and content workflow.";
      details = { ...details, instructions: [...missingAudiences.map(({ subjectId }) => `Define the applicable people for ${byId.get(subjectId)?.title || subjectId} in its existing role-training Obligation selector or explicit person scope; do not assign it to unrelated workers.`), ...missing.map(({ personId, subjectId }) => `${byId.get(personId)?.title || personId}: ${training ? "complete training and its passing criteria" : "read and acknowledge"} for ${byId.get(subjectId)?.title || subjectId}; retain a dated Attestation of its current revision.`)],
        suggestedValues: missing.length ? { programId: program.id, personId: missing[0].personId, subjectResourceIds: [missing[0].subjectId] } : {},
        populationIds: population, subjectPopulations, subjectIds: operatingSubjects.map(({ id }) => id), missingMembers: missing, resultIds: unique(results),
        missingFacts: complete ? [] : [...(!operatingSubjects.length ? ["approved-subjects"] : []), ...(!population.length ? ["current-workforce"] : []), ...(missingAudiences.length ? ["configured-role-training-audience"] : []), ...unique(missing.flatMap(({ missingFacts }) => missingFacts))] };
    } else if (profile.id === "provider-access") {
      const { componentIds, grants } = providerAccessPopulation(loaded, program, selected);
      const assessments = await Promise.all(candidates.map(async (candidate) => {
        const assessment = assessProgramAccessReview(candidate, loaded, program, selected, asOf, { permittedDate });
        if (!await currentProcedureContent(loaded, candidate)) {
          assessment.missingFacts.push("actual-provider-population-and-results");
          assessment.complete = false;
        }
        return assessment;
      }));
      const result = assessments.find(({ complete }) => complete) || assessments.sort((a, b) => a.missingFacts.length - b.missingFacts.length)[0];
      complete = componentIds.length > 0 && result?.complete === true; record = byId.get(result?.resourceId) || record;
      title = "Reconcile actual provider access";
      work = `Obtain the actual human and service-account lists from ${componentIds.map((id) => byId.get(id)?.title || id).join(", ") || "the scoped providers"}. Check export filters and completeness, compare every account and permission with approved Access Grants and current people or Service Accounts, and decide whether each grant stays, changes or is removed. Investigate missing accounts, orphan access and count differences, record exceptions and follow-up work, then complete the existing Access Review and its normal approval. A successful export rehearsal does not perform this reconciliation.`;
      acceptance = "A completed Access Review explains every scoped provider's identity boundary and retains checked actual account populations, including real zero counts. Reconcile each account row with its accountable Person or Service Account, mapped grants, explained provider-managed exclusion, or retained removal proof. Inherited identity stores link the reconciled provider; Components without an identity store retain bounded configuration proof. Account and grant counts are separate. Cover all active grants and their decisions, resolve unknown access, and keep the existing dated review approval. Removal and change decisions need actual resolution or an unexpired approved Exception with assigned remediation and a deadline. Captured authenticated UI populations are allowed when provenance, capture time, completeness and accuracy are retained; do not label them API exports.";
      details = { ...details, suggestedValues: { sourceReconciliations: componentIds.map((componentId) => ({ componentId, boundary: null })) }, populationIds: grants.map(({ id }) => id), componentIds, candidateResults: assessments,
        resultIds: complete ? [record.id] : [], missingFacts: result?.missingFacts || ["completed-access-reconciliation"],
        instructions: result ? [
          ...(result.missingScopeIds.length ? [`Include provider Components: ${result.missingScopeIds.map((id) => byId.get(id)?.title || id).join(", ")}.`] : []),
          ...(result.unresolvedDecisionIds.length ? [`Finish removal/change or use the existing approved Exception and assigned remediation workflow for: ${result.unresolvedDecisionIds.map((id) => byId.get(id)?.title || id).join(", ")}.`] : []),
          ...(result.missingGrantIds.length ? [`Review and record a decision for: ${result.missingGrantIds.map((id) => byId.get(id)?.title || id).join(", ")}.`] : []),
          ...(result.missingSourceIds.length ? [`Retain a checked actual account export with reconciled counts from: ${result.missingSourceIds.map((id) => byId.get(id)?.title || id).join(", ")}.`] : [])
        ] : [] };
    }
    if (title) checks.push(makeCheck(`baseline-${profile.id}`, title, complete, work, acceptance, record, profile.resourceType, details, program));
  }
  return checks;
}
