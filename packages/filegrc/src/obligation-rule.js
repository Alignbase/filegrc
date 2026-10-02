export function obligationRule(obligation, byId, options = {}) {
  const proposedId = options.includeProposed
    ? [...(obligation.ruleIds || [])].reverse().find((id) => ["proposed", "approved"].includes(byId.get(id)?.status))
    : null;
  if (obligation?.scheduleMode !== "rule" && !proposedId) return null;
  let rule = byId.get(obligation.activeRuleId || proposedId);
  if (rule?.status === "active" && rule.effectiveAt && options.now && new Date(rule.effectiveAt) > new Date(options.now)) {
    const prior = byId.get(rule.supersedesId);
    return prior?.type === "obligation-rule"
      && prior.obligationId === obligation.id
      && ["active", "retired"].includes(prior.status)
      ? prior
      : null;
  }
  return rule?.type === "obligation-rule"
    && rule.obligationId === obligation.id
    && (rule.status === "active" || (options.includeProposed && ["proposed", "approved"].includes(rule.status)))
    ? rule
    : null;
}
