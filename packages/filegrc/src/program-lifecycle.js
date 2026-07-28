export function obligationProgramStatus(obligation, byId, asOf) {
  const policyIds = obligation.policyIds || [];
  const policiesReady = policyIds.every((id) => {
    const policy = byId.get(id);
    return policy?.type === "policy"
      && policy.status === "active"
      && policy.effectiveOn
      && policy.effectiveOn <= asOf;
  });
  if (!policiesReady) return "proposed";
  const controlIds = obligation.controlIds || [];
  if (!controlIds.length) return "accepted";
  return controlIds.some((id) => byId.get(id)?.type === "control" && byId.get(id).status === "implemented")
    ? "accepted"
    : "proposed";
}

export function obligationIsRunning(obligation, byId, asOf) {
  return obligation?.type === "obligation"
    && obligation.status === "active"
    && obligationProgramStatus(obligation, byId, asOf) === "accepted";
}
