import { currentCalendarDate } from "./time.js";

export function obligationRule(obligation, byId, options = {}) {
  const proposedId = options.includeProposed
    ? [...(obligation.ruleIds || [])].reverse().find((id) => ["proposed", "approved"].includes(byId.get(id)?.status))
    : null;
  if (obligation?.scheduleMode !== "rule" && !proposedId) return null;
  let rule = byId.get(obligation.activeRuleId || proposedId);
  if (rule?.status === "active" && options.now) {
    const seen = new Set();
    while (rule?.type === "obligation-rule" && rule.obligationId === obligation.id
      && ["active", "retired"].includes(rule.status) && !seen.has(rule.id)) {
      seen.add(rule.id);
      if (rule.effectiveAt && new Date(rule.effectiveAt) <= new Date(options.now)) return rule;
      rule = byId.get(rule.supersedesId);
    }
    return null;
  }
  return rule?.type === "obligation-rule"
    && rule.obligationId === obligation.id
    && (rule.status === "active" || (options.includeProposed && ["proposed", "approved"].includes(rule.status)))
    ? rule
    : null;
}

export function obligationRuleRecurrence(rule, timezone = "UTC") {
  const recurrence = rule.recurrence || {};
  return recurrence.anchorMode === "activation" && rule.effectiveAt
    ? { ...recurrence, anchorDate: currentCalendarDate(rule.timezone || timezone, new Date(rule.effectiveAt)) }
    : recurrence;
}
