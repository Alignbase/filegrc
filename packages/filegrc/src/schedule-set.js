import { personWasActiveOn } from "./soc2.js";
import { currentCalendarDate } from "./time.js";
import { modelSupports } from "../model/index.js";
import { recordBelongsToProgram } from "./program.js";
import { currentPartyPeople } from "./parties.js";
import { obligationRule } from "./obligation-rule.js";

export function scheduleSetRecords(loaded, program) {
  const byId = new Map(loaded.resources.map((record) => [record.id, record]));
  return loaded.resources.filter((record) => record.type === "obligation"
    && recordBelongsToProgram(record, program, byId, loaded.model));
}

export function scheduleSetInputs(loaded, program) {
  const obligations = scheduleSetRecords(loaded, program);
  const ids = new Set(obligations.flatMap((record) => [record.id, ...(record.ruleIds || []),
    ...(record.controlIds || []), ...(record.policyIds || []), ...(record.scopeResourceIds || []), record.templateResourceId]).filter(Boolean));
  for (const rule of loaded.resources.filter((record) => record.type === "obligation-rule" && obligations.some(({ id }) => id === record.obligationId))) {
    ids.add(rule.id);
    for (const id of rule.sourceResourceIds || []) ids.add(id);
  }
  const byId = new Map(loaded.resources.map((record) => [record.id, record]));
  const pending = [...ids];
  const seen = new Set();
  while (pending.length) {
    const id = pending.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    const record = byId.get(id);
    if (!record) continue;
    const related = [...(record.ownerIds || []), ...(record.approverIds || []), ...(record.approvedByIds || []),
      ...(record.policyIds || []), ...(record.relatedDocumentIds || []), ...(record.memberIds || []), ...(record.chairIds || []), record.holderId].filter(Boolean);
    for (const relatedId of related) { ids.add(relatedId); pending.push(relatedId); }
  }
  return loaded.resources.filter(({ id }) => ids.has(id)).map((record) => {
    const value = structuredClone(record);
    if (value.type === "obligation") delete value.completionResourceIds;
    // Content adoption is the cutover after this review, not a change to its approved design.
    if (["policy", "document", "training"].includes(value.type) && ["approved", "active"].includes(value.status)) {
      value.status = "approved";
      for (const name of ["effectiveOn", "proposedEffectiveOn", "activationBasis", "activatedByIds", "activatedOn", "activatedContentRevisions"]) delete value[name];
    }
    return { record, value, includeContent: true };
  });
}

export function scheduleReviewerConflicts(loaded, program) {
  const byId = new Map(loaded.resources.map((record) => [record.id, record]));
  const controls = loaded.resources.filter((record) => record.type === "control" && program?.controlIds?.includes(record.id));
  return [...new Set([...controls, ...scheduleSetRecords(loaded, program)]
    .flatMap((record) => [...currentPartyPeople(record.ownerIds || [], byId)]))].sort();
}

export function scheduleSetIssues(loaded, program, review, options = {}) {
  if (!modelSupports(loaded.model, "schedule-set-review")) return [];
  if (!review) return [{ code: "schedule-set-approval-required", resourceId: program?.id, message: "Review and independently approve the complete Program schedule set before activation." }];
  const obligations = scheduleSetRecords(loaded, program);
  const byId = new Map(loaded.resources.map((record) => [record.id, record]));
  const rawDecisions = review?.scheduleDecisions;
  const decisions = Array.isArray(rawDecisions) ? rawDecisions.filter((value) => value && typeof value === "object" && !Array.isArray(value)) : [];
  const issues = [];
  const add = (id, message) => issues.push({ code: "unresolved-schedule-set", resourceId: id || program?.id, message });
  if (!Array.isArray(rawDecisions) || decisions.length !== rawDecisions.length) add(program?.id, "Schedule decisions must be an array of decision objects.");
  if (review?.scopeResourceIds?.length !== 1 || review.scopeResourceIds[0] !== program?.id) add(program?.id, "Schedule-set approval must cover exactly one selected Program.");
  const population = new Set(obligations.map(({ id }) => id));
  if (decisions.length !== population.size || new Set(decisions.map(({ obligationId }) => obligationId)).size !== population.size
    || decisions.some(({ obligationId }) => !population.has(obligationId))) add(program?.id, "Review every linked Obligation, including active schedules, proposals, and retired duplicates, once in this Program's schedule set.");
  const adopted = new Map();
  for (const decision of decisions) {
    const obligation = byId.get(decision.obligationId);
    if (!population.has(decision.obligationId)) continue;
    if (typeof decision.rationale !== "string" || !decision.rationale.trim()) add(obligation.id, `${obligation.title} needs a schedule disposition rationale.`);
    const rules = loaded.resources.filter((record) => record.type === "obligation-rule" && record.obligationId === obligation.id);
    if (decision.disposition === "adopted") {
      const rule = options.at ? obligationRule(obligation, byId, { now: options.at }) : byId.get(obligation.activeRuleId);
      if (obligation.status !== "active" || (obligation.scheduleMode === "rule"
        && (!rule || rule.obligationId !== obligation.id || !["active", "retired"].includes(rule.status) || decision.ruleId !== obligation.activeRuleId || !reviewedRuleChainContains(obligation, decision.ruleId, rule.id, byId) || !rule.approvedByIds?.length || !rule.approvedOn))) {
        add(obligation.id, `${obligation.title} needs its adopted, approved rule effective at cutover.`);
      } else if (rule && (rule.approvedOn > currentCalendarDate(rule.timezone || loaded.workspace?.timezone || "UTC")
        || !Array.isArray(rule.approvedByIds) || rule.approvedByIds.some((id) => !personWasActiveOn(byId.get(id), rule.approvedOn)))) {
        add(obligation.id, `${obligation.title} needs an actual rule approval by People active on its approval date.`);
      } else adopted.set(obligation.id, obligation);
      if (options.at && obligation.endsOn && obligation.endsOn < currentCalendarDate(loaded.workspace?.timezone || "UTC", new Date(options.at))) add(obligation.id, `${obligation.title} ends before the intended cutover.`);
      const excluded = Array.isArray(decision.excludedRuleIds) ? decision.excludedRuleIds : [];
      if (decision.excludedRuleIds !== undefined && !Array.isArray(decision.excludedRuleIds)) add(obligation.id, "Excluded rule IDs must be an array.");
      if (excluded.some((id) => !rules.some((rule) => rule.id === id && ["proposed", "approved"].includes(rule.status)))
        || rules.some((rule) => ["proposed", "approved"].includes(rule.status) && rule.id !== decision.ruleId && !excluded.includes(rule.id))) {
        add(obligation.id, `${obligation.title} has unresolved rule proposals. Explicitly exclude unused proposals in the schedule review.`);
      }
    } else if (decision.disposition === "retired") {
      if (obligation.status !== "retired") add(obligation.id, `${obligation.title} must be retired before it can be reviewed as a retired duplicate.`);
    } else if (["replaced", "inapplicable"].includes(decision.disposition)) {
      if (!["proposed", "retired"].includes(obligation.status)) add(obligation.id, `${obligation.title} is an adopted operating schedule. Retire it before replacing or excluding it.`);
    } else add(obligation.id, `${obligation.title} needs an adopted, replaced, retired, or inapplicable decision.`);
  }
  for (const decision of decisions.filter(({ disposition }) => disposition === "replaced")) {
    const original = byId.get(decision.obligationId);
    const replacements = (Array.isArray(decision.replacementObligationIds) ? decision.replacementObligationIds : []).map((id) => adopted.get(id));
    if (!replacements.length || replacements.some((record) => !record)
      || (original?.controlIds || []).filter((id) => program.controlIds?.includes(id)).some((id) => !replacements.some((record) => record?.controlIds?.includes(id)))) {
      add(decision.obligationId, "A replacement must name adopted schedules covering the same selected Controls in this Program.");
    }
    if (original && !replacements.some((record) => {
      if (!record) return false;
      if (record.activityType === original.activityType) return true;
      const requiredTypes = loaded.model.obligationActivities?.[original.activityType]?.completionResourceTypes || original.customActivity?.completionResourceTypes || [];
      return record.activityType === "custom" && requiredTypes.length > 0
        && requiredTypes.every((type) => record.customActivity?.completionResourceTypes?.includes(type));
    })) add(decision.obligationId, "An adopted replacement must cover the original activity's required completion proof.");
    const originalRule = byId.get(original?.activeRuleId) || rulesFor(original, loaded)[0];
    const event = originalRule?.recurrence?.eventType || original?.recurrence?.eventType;
    const matching = replacements.filter((record) => {
      if (!record) return false;
      const rule = options.at ? obligationRule(record, byId, { now: options.at })
        : byId.get(decisions.find(({ obligationId }) => obligationId === record.id)?.ruleId);
      const sameEvent = (rule?.recurrence?.eventType || record.recurrence?.eventType) === event;
      const requiredTypes = loaded.model.obligationActivities?.[original?.activityType]?.completionResourceTypes || original?.customActivity?.completionResourceTypes || [];
      const sameProof = record.activityType === original?.activityType || record.activityType === "custom" && requiredTypes.length > 0 && requiredTypes.every((type) => record.customActivity?.completionResourceTypes?.includes(type));
      return sameEvent && sameProof;
    });
    const requiredRiskLevels = original?.eventRiskLevels?.length ? original.eventRiskLevels : loaded.model.resources.obligation.fields.eventRiskLevels.values;
    if (event && requiredRiskLevels.some((level) => !matching.some((record) => !record.eventRiskLevels?.length || record.eventRiskLevels.includes(level)))) add(decision.obligationId, "Adopted replacements must cover every required event risk level for the same event and completion proof.");
    if (event && !matching.length) add(decision.obligationId, `The replacement must cover the required ${event} event; otherwise record an explicit inapplicability decision.`);
  }
  return issues;
}

function rulesFor(obligation, loaded) {
  return loaded.resources.filter((record) => record.type === "obligation-rule" && record.obligationId === obligation?.id);
}

function reviewedRuleChainContains(obligation, headId, targetId, byId) {
  const seen = new Set();
  let rule = byId.get(headId);
  while (rule?.type === "obligation-rule" && rule.obligationId === obligation.id
    && ["active", "retired"].includes(rule.status) && !seen.has(rule.id)) {
    seen.add(rule.id);
    if (rule.id === targetId) return true;
    rule = byId.get(rule.supersedesId);
  }
  return false;
}
