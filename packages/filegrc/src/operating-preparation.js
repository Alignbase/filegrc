import { selectScopedCollectionRecords } from "./collection-scope.js";
import { readFile } from "node:fs/promises";
import { modelSupports } from "../model/index.js";
import { resolveDataPath } from "./paths.js";
import { markdownEntries } from "./resource-markdown.js";
import { contentRevision } from "./files.js";
import { revisionsMatch } from "./revisions.js";
import { substantiveMarkdown, openPlaceholderCount } from "./content-readiness.js";
import { sourcePreparationFacts } from "./source-coverage.js";
import { currentPartyPeople, partiesIndependent } from "./parties.js";
import { preparationEvidenceIssues } from "./preparation-evidence.js";
import { personWasActiveOn } from "./soc2.js";
import { currentCalendarDate } from "./time.js";
import { planObligations, assessCompletionForObligation } from "./obligations.js";
import { recordBelongsToProgram } from "./program.js";

const shell = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
const unique = (values) => [...new Set(values.filter(Boolean))];

function mutationCommands(type, record, title, program) {
  return [
    `npx filegrc guide ${type} --program ${shell(program.id)} --json`,
    ...(record ? [`npx filegrc get ${shell(record.id)} --mutation > MUTATION.json`]
      : [`npx filegrc list ${type} --json`, `npx filegrc scaffold ${type} --title ${shell(title)} --program ${shell(program.id)} > MUTATION.json`]),
    "npx filegrc preview-mutation MUTATION.json --json",
    record ? `npx filegrc update ${type} ${shell(record.id)} MUTATION.json --json` : "npx filegrc create MUTATION.json --json"
  ];
}

function check(id, title, complete, work, acceptance, record, type, details, program) {
  return { id, title, status: complete ? "complete" : "ready", complete, work, acceptance,
    missingFacts: complete ? [] : details.fields || ["recorded-proof"],
    resourceType: record?.type || type, resourceId: record?.id || null,
    destination: record ? { kind: "record", resourceType: record.type, resourceId: record.id }
      : { kind: "collection", resourceType: type },
    commands: mutationCommands(record?.type || type, record, title, program),
    acceptedRecordIds: complete ? unique([record?.id, ...(details.evidenceIds || []), ...(details.retentionRuleIds || []), ...(details.resultIds || [])]) : [], ...details };
}

async function approvedProcedure(loaded, record, asOf, byId) {
  if (record?.type !== "document" || record.workflowScope !== "program" || !["approved", "active"].includes(record.status)
    || !record.approvedOn || record.approvedOn > asOf || !record.approvedContentRevisions
    || !partiesIndependent(record.ownerIds || [], record.approverIds || [], byId)
    || record.approverIds.some((id) => !personWasActiveOn(byId.get(id), record.approvedOn))) return false;
  const entries = markdownEntries(loaded.model, record);
  const matches = await Promise.all(entries.map(async ({ path }) => {
    try {
      const text = await readFile(resolveDataPath(loaded.root, path), "utf8");
      return substantiveMarkdown(text) && !openPlaceholderCount(text)
        && revisionsMatch("content", contentRevision(text), record.approvedContentRevisions[path]);
    } catch (error) { if (error.code === "ENOENT") return false; throw error; }
  }));
  return matches.length > 0 && matches.every(Boolean);
}

export async function assessOperatingPreparation(loaded, program, selectedControls, asOf) {
  const byId = new Map(loaded.resources.map((record) => [record.id, record]));
  const controls = selectedControls.filter(({ status }) => !["not-applicable", "retired"].includes(status));
  const sourceWork = new Map();
  for (const control of controls) {
    for (const sourceId of control.evidenceSourceComponentIds || []) {
      const source = byId.get(sourceId);
      const families = (loaded.model.evidenceSourceFamilies || []).filter((family) =>
        family.controlCodes.includes(control.code) && family.sourceKinds.some((kind) => source?.evidenceSourceKinds?.includes(kind)));
      const matched = families.length ? families : (loaded.model.evidenceSourceFamilies || []).filter((family) =>
        family.sourceKinds.some((kind) => source?.evidenceSourceKinds?.includes(kind)));
      for (const family of matched) {
        const key = `${sourceId}:${family.id}`;
        const current = sourceWork.get(key) || { source, sourceId, family, controlIds: [] };
        current.controlIds.push(control.id); sourceWork.set(key, current);
      }
      if (!matched.length) sourceWork.set(`${sourceId}:mapping`, { source, sourceId, family: null, controlIds: [control.id] });
    }
  }
  const baseline = controls.filter((control) => !control.evidenceSourceComponentIds?.length).map((control) => check(
    `source-mapping-${control.id}`, `Connect the actual proof source for ${control.title}`, false,
    `Inspect the system or service that produces ${control.title}'s proof. Select its existing Component, check access and repeatable extraction instructions, and record evidenceSourceComponentIds on this Control.`,
    "The Control names its actual authoritative source Component; the source collection and rehearsal checks can then run.", control, "control", { fields: ["evidenceSourceComponentIds"], candidateIds: loaded.resources.filter((record) => record.type === "component" && record.status === "active").map(({ id }) => id) }, program));
  for (const { source, sourceId, family, controlIds } of sourceWork.values()) {
    if (!family) {
      baseline.push(check(`source-role-${sourceId}`, `Identify the evidence role for ${source?.title || sourceId}`, false,
        `Inspect the actual export or query from ${source?.title || sourceId} used by ${controlIds.map((id) => byId.get(id)?.title || id).join(", ")}. Select its model-defined evidence source role and document the retrieval instructions.`,
        "The Control points to an active Component with the matching source role, access owners and repeatable extraction instructions.", source, "component", { missingFacts: ["evidenceSourceKinds"], controlIds, candidateIds: [] }, program));
      continue;
    }
    const candidates = loaded.resources.filter((record) => record.type === "source-coverage" && record.status !== "retired"
      && record.sourceFamilyId === family.id && record.scopeResourceIds?.some((id) => [program.id, ...program.systemIds || [], ...controlIds, sourceId].includes(id))
      && (record.coverageKind === "filegrc" || record.coverageKind === "not-applicable" || record.componentId === sourceId));
    const assessed = await Promise.all(candidates.map(async (record) => ({ record,
      facts: await sourcePreparationFacts(loaded, record, program, { asOf, sourceId, controlIds }) })));
    assessed.sort((a, b) => Number(b.facts.complete) - Number(a.facts.complete) || a.facts.issues.length - b.facts.issues.length);
    const record = assessed[0]?.record;
    const facts = assessed[0]?.facts || await sourcePreparationFacts(loaded, null, program, { asOf, sourceId, controlIds });
    const work = `Use ${source?.title || sourceId} to ${family.evidencePrompt.replace(/\.$/, "").replace(/^./, (letter) => letter.toLowerCase())}. Check its filters and count against ${controlIds.map((id) => byId.get(id)?.title || id).join(", ")}. `;
    const commands = mutationCommands("source-coverage", record, `${family.title} collection from ${source?.title || sourceId}`, program);
    if (facts.issues.some(({ field }) => field === "readinessTestEvidenceIds")) commands.push(
      ...mutationCommands("evidence", null, `${source?.title || sourceId} ${family.title} retrieval rehearsal`, program));
    if (facts.issues.some(({ field }) => field.startsWith("retention"))) commands.push(
      "npx filegrc list retention-schedule-item --json", "npx filegrc review-collection retention-schedule-item --scaffold > RETENTION-REVIEW.json",
      "npx filegrc review-collection retention-schedule-item RETENTION-REVIEW.json --preview --json",
      "npx filegrc review-collection retention-schedule-item RETENTION-REVIEW.json --yes --json");
    baseline.push(check(`source-${sourceId}-${family.id}`, `${family.title}: ${source?.title || sourceId}`, facts.complete,
      work, "Scoped coverage is active, the named people can retrieve a safe sample or checked zero export, linked rehearsal proof matches this source/family/scope and the approved preservation rule covers the proof.", record, "source-coverage",
      { missingFacts: facts.issues.map(({ field }) => field), instructions: facts.issues.map(({ message }) => message),
        sourceId, sourceFamilyId: family.id, controlIds, candidateIds: candidates.map(({ id }) => id),
        evidenceIds: facts.evidenceIds, retentionRuleIds: facts.retentionRuleIds, commands,
        suggestedValues: { sourceFamilyId: family.id, scopeResourceIds: [program.id], componentId: sourceId },
        approval: "Use the normal Evidence collection/verification fields. Only a changed preservation schedule needs its existing independent whole-schedule approval." }, program));
  }
  const preview = firstOperatingTasks(loaded, program, { effectiveOn: asOf });
  for (const task of preview.tasks.filter(({ requiredTest, adopted }) => requiredTest && adopted)) {
    const obligation = byId.get(task.obligationId);
    const rule = byId.get(task.ruleId);
    const selector = rule?.selector || obligation.selector;
    const populationIds = selector
      ? selectScopedCollectionRecords(loaded, selector, program).map(({ id }) => id).sort()
      : [...new Set(obligation.scopeResourceIds?.length ? obligation.scopeResourceIds : [loaded.workspace.id])];
    const applicableControls = controls.filter(({ id }) => task.controlIds.includes(id));
    const notBeforeFor = (memberId) => {
      const scoped = applicableControls.filter((control) => control.id === memberId || control.systemIds?.includes(memberId)
        || control.componentIds?.includes(memberId) || byId.get(memberId)?.controlIds?.includes(control.id));
      return (scoped.length ? scoped : applicableControls).flatMap((control) => [control.effectiveOn, control.procedureEffectiveOn]).filter(Boolean).sort().at(-1);
    };
    const candidates = loaded.resources.filter((record) => task.completionResourceTypes.includes(record.type));
    const assessments = candidates.map((record) => {
      const coveredMemberIds = populationIds.filter((memberId) => assessCompletionForObligation(record, obligation, loaded,
        { asOf, notBefore: notBeforeFor(memberId), memberIds: [memberId] }).complete);
      return { record, assessment: assessCompletionForObligation(record, obligation, loaded,
        { asOf, memberIds: populationIds }), coveredMemberIds };
    });
    const results = assessments.filter(({ coveredMemberIds }) => coveredMemberIds.length > 0);
    const populationCovered = populationIds.length > 0 && populationIds.every((id) => results.some(({ coveredMemberIds }) => coveredMemberIds.includes(id)));
    const zeroComplete = populationIds.length === 0 && task.status === "complete" && task.operatingResult === "zero-population";
    const isZero = populationIds.length === 0;
    baseline.push(check(`baseline-${obligation.id}`, `${isZero ? "Reconcile the empty population" : "Run the baseline"}: ${task.title}`, populationCovered || zeroComplete,
      isZero ? "Run the source query with the actual scope and filters, check the zero count, and record the existing occurrence's zero-population reconciliation. Do not invent a test subject."
        : `Perform ${task.title} for ${populationIds.map((id) => byId.get(id)?.title || id).join(", ")}. Reuse a completed result only if it covers this population and current implementation; an applicability or cadence decision does not execute the test.`,
      "The normal completion rules accept a real completed result for every applicable member, or a reconciled and supported zero-population conclusion. The occurrence remains separate and must accept the result's date and scope before reuse.", obligation, "obligation",
      { obligationId: obligation.id, missingFacts: populationCovered || zeroComplete ? [] : [isZero ? "zero-population-proof" : "completed-result"], controlIds: task.controlIds,
        candidateIds: candidates.map(({ id }) => id), resultIds: results.map(({ record }) => record.id),
        candidateResults: assessments.map(({ record, assessment, coveredMemberIds }) => ({ resourceId: record.id, ...assessment, coveredMemberIds })), populationIds: populationIds,
        approval: "Use this operating record's existing review fields. This task adds no separate baseline approval.",
        commands: ["npx filegrc obligations --json", ...mutationCommands(task.completionType, null, `${task.title} baseline`, program),
          `npx filegrc reconcile-obligation ${shell(obligation.id)} --program ${shell(program.id)} --window-start ${task.dueWindowStart} --scaffold > OCCURRENCE.json`,
          `npx filegrc reconcile-obligation ${shell(obligation.id)} OCCURRENCE.json --program ${shell(program.id)} --json`] }, program));
  }
  const owner = program.operatingOwnership || {};
  const obligations = loaded.resources.filter((record) => record.type === "obligation" && record.status === "active"
    && recordBelongsToProgram(record, program, byId, loaded.model));
  const events = obligations.filter((record) => (byId.get(record.activeRuleId)?.recurrence || record.recurrence)?.mode === "event");
  const eventNames = unique(events.map((record) => (byId.get(record.activeRuleId)?.recurrence || record.recurrence)?.eventType));
  const eventSources = (owner.eventSourceComponentIds || []).map((id) => byId.get(id));
  const procedure = byId.get(owner.procedureDocumentId);
  const procedureReady = await approvedProcedure(loaded, procedure, asOf, byId);
  const documentCandidates = loaded.resources.filter((record) => record.type === "document" && record.workflowScope === "program" && !["retired", "superseded"].includes(record.status)
    && (record.controlIds?.some((id) => controls.some((control) => control.id === id)) || record.id === owner.procedureDocumentId));
  const handoffProof = (owner.rehearsalEvidenceIds || []).map((id) => byId.get(id)).filter((record) =>
    !preparationEvidenceIssues(record, byId, asOf).length && record.readinessTest === true && record.retrievalResult === "passed"
    && record.sourceResourceIds?.includes(procedure?.id) && record.collectedOn >= procedure.approvedOn);
  const sourceProof = eventSources.every((source) => source && handoffProof.some((record) => record.sourceComponentId === source.id || record.componentIds?.includes(source.id)));
  const eventProof = events.every((event) => handoffProof.some((record) => record.sourceResourceIds?.includes(event.id)));
  const ownershipChecks = [
    check("event-discovery", "Assign event discovery and triggering", !events.length || currentPartyPeople(owner.eventOwnerIds || [], byId).size > 0 && eventSources.length > 0 && eventSources.every((source) => source?.status === "active" && source.type === "component"),
      events.length ? `For ${eventNames.join(", ")}, identify who reads the real source changes and records the matching Policy Event. Select the source Components that supply those changes, then record the responsible party and source IDs on this Program.` : "No event rules are adopted. Recheck this assignment when an event rule is adopted.",
      "Adopted event rules have named active discovery/trigger owners and active authoritative source Components; Obligation queue owners remain on their existing schedules.", program, "program",
      { eventTypes: eventNames, obligationIds: events.map(({ id }) => id), candidateIds: unique(controls.flatMap(({ evidenceSourceComponentIds = [] }) => evidenceSourceComponentIds)), fields: ["operatingOwnership.eventOwnerIds", "operatingOwnership.eventSourceComponentIds"] }, program),
    check("queue-checks", "Assign queue checks and escalation", currentPartyPeople(owner.queueOwnerIds || [], byId).size > 0 && Boolean(owner.queueCheckCadence?.trim()),
      `Name who opens the Work Queue and checks due, overdue, blocked and failed collection work. Agree how often they check it and who they contact when an assigned owner cannot finish. Record the checker and cadence on ${program.title}; keep each task owner on its existing Obligation.`,
      "An active checker and a concrete check cadence are recorded, and the governed procedure describes whom to contact and when escalation happens.", program, "program",
      { fields: ["operatingOwnership.queueOwnerIds", "operatingOwnership.queueCheckCadence"], candidateIds: program.ownerIds || [] }, program),
    check("source-reconciliation", "Reconcile source changes against recorded events", !events.length || Boolean(owner.reconciliationCadence?.trim()),
      events.length ? `Agree when the owner compares ${eventSources.map((source) => source?.title || "the source").join(", ") || "the event-source exports"} with recorded ${eventNames.join(", ")} events and their generated tasks. Describe how missing events, duplicates, late triggers and failed queries are investigated; record the check cadence on the Program and the method in the procedure.` : "No event reconciliation is needed until an event rule is adopted.",
      "The source reconciliation has a recorded cadence and a documented method for investigating missing, duplicate or failed items.", program, "program", { fields: ["operatingOwnership.reconciliationCadence"] }, program),
    check("operating-procedure", "Review the discovery, reconciliation and escalation procedure", procedureReady,
      `Inspect ${procedure?.title || "the existing program procedures"} for the actual source queries, matching event triggers, queue checks and escalation conditions. Reuse the listed Document if its approved text covers this work. If text is missing or changes, update its Markdown and use its normal independent Document approval; link it on ${program.title}.`,
      "The linked program Document has substantive unchanged Markdown, no open placeholders and an existing valid independent approval of that exact revision.", procedure, "document",
      { candidateIds: documentCandidates.map(({ id }) => id), approval: "Only new or changed Document content requires independent approval. Unchanged approvals and historical Control oversight remain valid.", fields: ["operatingOwnership.procedureDocumentId"] }, program),
    check("handoff-rehearsal", "Rehearse manual discovery, reconciliation and queue handling", handoffProof.length > 0 && (!events.length || sourceProof && eventProof),
      `Have the assigned people retrieve a safe example or a checked zero-result export, match existing real events to their generated task preview, compare source counts with recorded events, open the Work Queue and walk through one escalation condition in ${procedure?.title || "the procedure"}. Do not create a fictional Policy Event. Retain a dated rehearsal result as Evidence, link the procedure, relevant Obligation IDs and source Components, then link that proof on the Program.`,
      "Collected rehearsal Evidence links the approved procedure and covers each adopted event rule and discovery source. Actual collection actors and dates are recorded through the normal Evidence lifecycle.", program, "program",
      { fields: ["operatingOwnership.rehearsalEvidenceIds"], candidateIds: loaded.resources.filter((record) => record.type === "evidence" && record.readinessTest === true).map(({ id }) => id), evidenceIds: handoffProof.map(({ id }) => id),
        commands: [...mutationCommands("program", program, program.title, program), "npx filegrc obligations --json", "npx filegrc reconcile --preview --json", ...mutationCommands("evidence", null, `${program.title} operating handoff rehearsal`, program)],
        approval: "No separate handoff approval is introduced. Use existing Evidence verification and the procedure's independent content approval." }, program)
  ];
  return { baseline, ownership: { ...owner, preparationChecks: ownershipChecks, complete: ownershipChecks.every(({ complete }) => complete),
    eventObligationIds: events.map(({ id }) => id) }, active: controls.some((control) => control.policyIds?.some((id) => byId.get(id)?.status === "active")) };
}

export function firstOperatingTasks(loaded, program, options = {}) {
  const timezone = loaded.workspace?.timezone || "UTC";
  const asOf = options.effectiveOn || currentCalendarDate(timezone);
  const selectedIds = options.resourceIds ? new Set(options.resourceIds) : null;
  const records = loaded.resources.map((record) => ["policy", "document", "training"].includes(record.type)
    && record.status === "approved" && (!selectedIds || selectedIds.has(record.id)) && recordBelongsToProgram(record, program, new Map(loaded.resources.map((current) => [current.id, current])), loaded.model)
    ? { ...record, status: "active", effectiveOn: asOf, ...(record.type === "policy" ? {} : {
      activatedOn: options.activatedOn || asOf, activationBasis: "recorded", activatedByIds: options.activatedByIds || [], activatedContentRevisions: record.approvedContentRevisions
    }) } : record);
  const through = new Date(`${asOf}T12:00:00Z`); through.setUTCFullYear(through.getUTCFullYear() + 2);
  const futureDates = records.filter((record) => record.type === "obligation-rule" || record.type === "obligation")
    .flatMap((record) => [record.effectiveAt?.slice(0, 10), record.recurrence?.anchorDate, record.startsOn]).filter(Boolean);
  const horizon = [through.toISOString().slice(0, 10), ...futureDates].sort().at(-1);
  const plan = planObligations(records, { model: loaded.model, programId: program.id, asOf,
    through: horizon, includeComplete: true, firstOnly: true });
  const byId = new Map(loaded.resources.map((record) => [record.id, record]));
  const first = new Map();
  for (const task of [...plan.calendarItems].filter((task) => task.occurrenceKey === `${program.id}:${task.obligationId}:${task.dueWindowStart}`).sort((a, b) => a.dueWindowStart.localeCompare(b.dueWindowStart))) {
    if (first.has(task.obligationId)) continue;
    const obligation = byId.get(task.obligationId); const rule = byId.get(task.ruleId);
    const purpose = rule?.preparationPurpose || obligation?.preparationPurpose || loaded.model.obligationActivities[task.activityType]?.preparationPurpose || "operation";
    const ruleAdopted = obligation?.status === "active" && (!rule || ["active", "retired"].includes(rule.status));
    first.set(task.obligationId, { ...task, preparationPurpose: purpose,
      adopted: ruleAdopted, requiredTest: purpose === "test-execution", executionRequired: purpose === "test-execution",
      ruleApproval: rule ? { status: rule.status, approvedOn: rule.approvedOn || null, approvedByIds: rule.approvedByIds || [] } : null,
      deadlineBasis: rule?.rationale || "The legacy schedule's allowed completion window and first overdue cutoff. Inspect its governing Policy for the actual basis.", sourceResourceIds: rule?.sourceResourceIds || task.policyIds,
      baselineReuse: task.status === "complete" ? "This occurrence is reconciled using its existing completion rules." : "Link existing proof only through normal occurrence reconciliation when its actual date, scope and result satisfy this window." });
  }
  return { effectiveOn: asOf, tasks: [...first.values()], events: plan.triggers.map((event) => ({ ...event,
      subjectRules: loaded.model.policyEvents?.[event.eventType]?.subjectRules || [],
      steps: event.steps.map((step) => {
        const rule = byId.get(step.ruleId); const obligation = byId.get(step.obligationId);
        return { ...step, population: { kind: "event-subject", subjectRules: loaded.model.policyEvents?.[event.eventType]?.subjectRules || [],
          scopeResourceIds: step.scopeResourceIds, riskLevels: step.eventRiskLevels, selector: rule?.selector || null },
          preparationPurpose: rule?.preparationPurpose || obligation?.preparationPurpose || loaded.model.obligationActivities[step.activityType]?.preparationPurpose || "operation",
          deadlineBasis: rule?.rationale || "The governing legacy event rule defines this relative deadline.", sourceResourceIds: rule?.sourceResourceIds || step.policyIds,
          ruleApproval: rule ? { status: rule.status, approvedOn: rule.approvedOn || null, approvedByIds: rule.approvedByIds || [] } : null };
      }) })),
    guidance: "Inspect adopted rules and resolve proposals. An applicability/cadence review decides whether a test is needed; it does not execute an adopted test. Keep existing activation and frozen occurrence dates. Complete current gaps with real dates and reconcile each occurrence separately." };
}

export function activationPrerequisiteMessage(readiness) {
  if (readiness?.preparationReady === false) {
    const groups = readiness.stages.find(({ id }) => id === "controls")?.items.filter(({ preparationChecks, status }) => preparationChecks && status !== "complete") || [];
    return `Finish the current operating preparation before the next activation: ${groups.map(({ title }) => title).join("; ")}. Keep existing activation dates and historical Control oversight. Run npx filegrc program-readiness --json for the specific missing facts, records and commands.`;
  }
  return "Complete the current Control collection review before Program Content Activation.";
}
