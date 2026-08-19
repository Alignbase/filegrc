import { currentPartyPeople } from "./parties.js";

export function obligationProgramStatus(obligation, byId, asOf) {
  if (obligation.status !== "active") return "proposed";
  if (currentPartyPeople(obligation.ownerIds || [], byId).size === 0) return "proposed";
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

export function obligationIsEnabled(obligation) {
  return obligation?.type === "obligation" && obligation.status === "active";
}
