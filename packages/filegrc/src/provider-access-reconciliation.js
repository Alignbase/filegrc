import { currentCalendarDate } from "./time.js";
import { appointmentWasAuthorizedOn, personWasActiveOn } from "./soc2.js";

// Provider accounts, permissions and Access Grants are different populations.
// Reconcile actual export rows without treating a grant count as an account count.
export function assessProviderAccessReconciliation(candidate, context) {
  const { componentIds, exports, byId, asOf, valid, proofValid, grants } = context;
  const rows = candidate.sourceReconciliations;
  const missingSourceIds = [], issues = [], unresolvedAccountReferences = [], mappedGrantIds = new Set();
  const byComponent = new Map();
  for (const row of rows) {
    if (byComponent.has(row.componentId) || !componentIds.includes(row.componentId)) issues.push("unique-scoped-provider-reconciliations");
    byComponent.set(row.componentId, row);
  }
  const hasCurrentOwner = (ids, seen = new Set()) => (ids || []).some((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    const owner = byId.get(id);
    if (owner?.status !== "active") return false;
    if (owner.type === "person") return personWasActiveOn(owner, asOf);
    if (owner.type === "appointment") return appointmentWasAuthorizedOn(owner, asOf, byId);
    return owner.type === "team" && hasCurrentOwner([...(owner.memberIds || []), ...(owner.chairIds || [])], seen);
  });
  const retained = (proof) => Boolean(proof?.filePaths?.length || proof?.externalReference?.url?.trim()
    || proof?.externalReference?.system?.trim() && proof?.externalReference?.reference?.trim());
  const boundedProof = (ids, componentId, notBefore = null) => ids?.length > 0 && ids.every((id) => {
    const proof = byId.get(id);
    const observedAt = proof?.generatedAt || proof?.businessEventAt;
    const observedTime = new Date(observedAt).getTime();
    const observedOn = Number.isFinite(observedTime) ? currentCalendarDate(context.timezone || "UTC", new Date(observedTime)) : null;
    const observationDatesValid = [proof?.generatedAt, proof?.businessEventAt].filter(Boolean).every((value) => {
      const time = new Date(value).getTime();
      const on = Number.isFinite(time) ? currentCalendarDate(context.timezone || "UTC", new Date(time)) : null;
      return on && on <= candidate.approvedOn && proof.collectedOn >= on;
    });
    return candidate.evidenceIds?.includes(id) && retained(proof) && valid(proof)
      && proof.collectedOn <= candidate.approvedOn && proof.collectedOn <= asOf
      && observationDatesValid
      && (!notBefore || observedOn && observedTime >= new Date(notBefore).getTime())
      && (proof.sourceComponentId === componentId || proof.componentIds?.includes(componentId))
      && proofValid({ evidenceIds: [id] });
  });
  const directSource = (componentId, seen = new Set()) => {
    if (seen.has(componentId)) return null;
    seen.add(componentId);
    const row = byComponent.get(componentId);
    if (row?.boundary === "direct") return componentId;
    if (row?.boundary !== "inherited" || !row.rationale?.trim()
      || !boundedProof(row.boundaryEvidenceIds, componentId)) return null;
    return directSource(row.identityComponentId, seen);
  };
  let populationCount = 0;
  for (const componentId of componentIds) {
    const row = byComponent.get(componentId);
    if (!row) { missingSourceIds.push(componentId); continue; }
    if (row.boundary !== "direct") {
      const hasGrant = grants.some((grant) => grant.componentId === componentId);
      if (!row.rationale?.trim() || !boundedProof(row.boundaryEvidenceIds, componentId)
        || row.boundary === "inherited" && !directSource(componentId)
        || row.boundary === "no-account-store" && hasGrant) missingSourceIds.push(componentId);
      continue;
    }
    const proof = exports.find((proof) => proof.id === row.populationEvidenceId && proof.sourceComponentId === componentId && retained(proof));
    const accounts = row.accounts || [];
    if (!proof || proof.populationCount !== accounts.length) missingSourceIds.push(componentId);
    if (proof) populationCount += proof.populationCount;
    const references = new Set();
    for (const account of accounts) {
      const reference = account.accountReference?.trim();
      if (!reference || references.has(reference)) issues.push("unique-provider-account-references");
      references.add(reference);
      if (account.disposition === "unresolved") { unresolvedAccountReferences.push({ componentId, accountReference: reference }); continue; }
      const mapped = (account.accessGrantIds || []).map((id) => byId.get(id));
      if (new Set(account.accessGrantIds || []).size !== mapped.length
        || mapped.some((grant) => grant?.type !== "access-grant" || !valid(grant)
          || directSource(grant.componentId) !== componentId || grant.subjectId !== account.subjectId
          || !candidate.grantDecisions?.some(({ accessGrantId }) => accessGrantId === grant.id))) {
        issues.push("account-grant-mappings"); continue;
      }
      if (account.disposition === "provider-managed") {
        if (!account.rationale?.trim() || account.subjectId || mapped.length) issues.push("bounded-provider-managed-exclusions");
        continue;
      }
      if (account.disposition === "removed") {
        if (!account.rationale?.trim() || !boundedProof(account.resolutionEvidenceIds, componentId, proof?.generatedAt)
          || mapped.some((grant) => !["revoked", "expired"].includes(grant.status) || !grant.deprovisionedOn || grant.deprovisionedOn > candidate.approvedOn)) {
          issues.push("resolved-provider-account-removals");
        }
        for (const grant of mapped) mappedGrantIds.add(grant.id);
        continue;
      }
      const subject = byId.get(account.subjectId);
      const currentSubject = subject?.type === "person" ? personWasActiveOn(subject, asOf)
        : subject?.type === "service-account" && valid(subject) && subject.status === "active"
          && (!subject.expiresOn || subject.expiresOn >= asOf)
          && (!subject.lastReviewedOn || subject.lastReviewedOn <= asOf)
          && (!subject.reviewDueOn || subject.reviewDueOn >= asOf)
          && subject.componentIds?.some((id) => directSource(id) === componentId)
          && hasCurrentOwner(subject.ownerIds);
      const authorization = account.authorizationKind === "access-grant" ? mapped.length > 0
        : account.authorizationKind === "review-renewal" ? subject?.type === "person" && account.rationale?.trim()
          && candidate.approvedByIds?.length > 0 && candidate.approvedByIds.every((id) => personWasActiveOn(byId.get(id), candidate.approvedOn))
          && candidate.approvedOn >= candidate.completedOn && candidate.approvedOn <= asOf
        : account.authorizationKind === "service-account-inventory" && subject?.type === "service-account";
      if (account.disposition !== "authorized" || !currentSubject || !authorization || mapped.some((grant) => grant.status !== "active")) issues.push("accountable-provider-identities");
      for (const grant of mapped) mappedGrantIds.add(grant.id);
    }
  }
  const missingMappedGrantIds = grants.filter((grant) => !mappedGrantIds.has(grant.id)).map(({ id }) => id);
  if (missingMappedGrantIds.length) issues.push("mapped-current-access-grants");
  if (unresolvedAccountReferences.length) issues.push("unresolved-provider-accounts");
  if (candidate.populationCount !== populationCount) issues.push("reconciled-account-counts");
  return { issues: [...new Set(issues)], missingSourceIds, missingMappedGrantIds, unresolvedAccountReferences };
}
