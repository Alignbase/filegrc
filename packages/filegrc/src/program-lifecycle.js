import { currentPartyPeople } from "./parties.js";
import { modelSupports } from "../model/index.js";

const requiredDocumentsByControlCache = new WeakMap();

export function auditSpecificDocumentKinds(model) {
  return new Set([
    ...(model?.auditReadiness?.managementDocuments || []).map(({ kind }) => kind),
    "soc2-engagement-terms"
  ]);
}

export function documentIsAuditSpecific(document, model) {
  if (document?.type !== "document") return false;
  if (modelSupports(model, "document-workflow-scope")) {
    return document.workflowScope === "engagement";
  }
  return auditSpecificDocumentKinds(model).has(document.documentKind);
}

export function governedDocumentIsOperating(document, asOf, model) {
  if (document?.type !== "document" || document.status !== "active") return false;
  if (!document.effectiveOn || document.effectiveOn > asOf) return false;
  if (!modelSupports(model, "governed-document-activation")) return true;
  if (document.activationBasis === "legacy-v4") {
    return document.workflowScope === "engagement"
      && Boolean(document.approvedOn && document.approvedContentRevisions);
  }
  return Boolean(
    document.activationBasis === "recorded"
    && document.approvedOn
    && document.approvedContentRevisions
    && document.activatedOn
    && document.activatedOn <= asOf
    && (document.activatedByIds || []).length
    && document.activatedContentRevisions
    && contentRevisionBindingsMatch(document.approvedContentRevisions, document.activatedContentRevisions)
  );
}

export function governedTrainingIsOperating(training, asOf, model) {
  if (training?.type !== "training" || training.status !== "active") return false;
  if (!training.effectiveOn || training.effectiveOn > asOf) return false;
  if (!modelSupports(model, "governed-training-activation")) return true;
  if (training.activationBasis === "legacy-v5") {
    return Boolean(training.approvedOn && training.approvedContentRevisions);
  }
  return Boolean(
    training.activationBasis === "recorded"
    && training.approvedOn
    && training.approvedContentRevisions
    && training.activatedOn
    && training.activatedOn <= asOf
    && (training.activatedByIds || []).length
    && training.activatedContentRevisions
    && contentRevisionBindingsMatch(training.approvedContentRevisions, training.activatedContentRevisions)
  );
}

export function governedContentIsOperating(record, asOf, model) {
  if (record?.type === "document") return governedDocumentIsOperating(record, asOf, model);
  if (record?.type === "training") return governedTrainingIsOperating(record, asOf, model);
  return false;
}

export function contentRevisionBindingsMatch(left, right) {
  if (!left || !right || Array.isArray(left) || Array.isArray(right)) return false;
  const normalize = (value) => Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

export function obligationGovernedDocuments(obligation, byId, model) {
  if (!modelSupports(model, "governed-document-activation")) return [];
  const policyDocumentIds = (obligation.policyIds || []).flatMap((id) => {
    const policy = byId.get(id);
    return policy?.type === "policy" ? policy.relatedDocumentIds || [] : [];
  });
  const directDocumentIds = [
    ...(obligation.scopeResourceIds || []),
    ...(obligation.templateResourceId ? [obligation.templateResourceId] : [])
  ];
  const requiredDocumentsByControl = indexRequiredDocumentsByControl(byId, model);
  const controlDocumentIds = (obligation.controlIds || [])
    .flatMap((id) => requiredDocumentsByControl.get(id) || []);
  return [...new Set([...policyDocumentIds, ...directDocumentIds, ...controlDocumentIds])]
    .map((id) => byId.get(id))
    .filter((record) => (
      record?.type === "document"
      && !["superseded", "retired"].includes(record.status)
      && !documentIsAuditSpecific(record, model)
    ));
}

export function obligationGovernedContent(obligation, byId, model) {
  const documents = obligationGovernedDocuments(obligation, byId, model);
  if (!modelSupports(model, "governed-training-activation")) return documents;
  const directIds = [
    ...(obligation.scopeResourceIds || []),
    ...(obligation.templateResourceId ? [obligation.templateResourceId] : [])
  ];
  const training = [...new Set(directIds)]
    .map((id) => byId.get(id))
    .filter((record) => record?.type === "training" && !["superseded", "retired"].includes(record.status));
  return [...documents, ...training];
}

function indexRequiredDocumentsByControl(byId, model) {
  const modelVersion = String(model?.modelVersion || "");
  const cached = requiredDocumentsByControlCache.get(byId);
  if (cached?.modelVersion === modelVersion) return cached.index;
  const index = new Map();
  for (const record of byId.values()) {
    if (
      record.type !== "document"
      || record.programRole !== "required"
      || ["superseded", "retired"].includes(record.status)
      || documentIsAuditSpecific(record, model)
    ) continue;
    for (const controlId of record.controlIds || []) {
      if (!index.has(controlId)) index.set(controlId, []);
      index.get(controlId).push(record.id);
    }
  }
  requiredDocumentsByControlCache.set(byId, { modelVersion, index });
  return index;
}

export function obligationProgramStatus(obligation, byId, asOf, model) {
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
  const governedContentReady = obligationGovernedContent(obligation, byId, model)
    .every((record) => governedContentIsOperating(record, asOf, model));
  if (!governedContentReady) return "proposed";
  const controlIds = obligation.controlIds || [];
  if (!controlIds.length) return "accepted";
  return controlIds.some((id) => byId.get(id)?.type === "control" && byId.get(id).status === "implemented")
    ? "accepted"
    : "proposed";
}

export function obligationIsRunning(obligation, byId, asOf, model) {
  return obligation?.type === "obligation"
    && obligation.status === "active"
    && obligationProgramStatus(obligation, byId, asOf, model) === "accepted";
}

export function obligationIsEnabled(obligation) {
  return obligation?.type === "obligation" && obligation.status === "active";
}
