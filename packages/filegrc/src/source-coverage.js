import { resolveSourceCoverageRetention } from "./retention.js";
import { retentionScheduleIsAuthoritative } from "./collection-review.js";
import { modelSupports } from "../model/index.js";
import { resolveProgram } from "./program.js";

export async function sourceCoverageComplete(record, loaded, program = loaded.workspace) {
  const structuredRetention = loaded.model.resources["retention-schedule-item"];
  if (!record?.validFrom || !record.collectionCadence || !record.reconciliationMethod) {
    return false;
  }
  if (structuredRetention) {
    const retentionProgram = modelSupports(loaded.model, "program-scope")
      ? resolveProgram(loaded, program?.type === "program" ? program.id : undefined)
      : program;
    if (!retentionScheduleIsAuthoritative(loaded, retentionProgram)) return false;
    const retained = await resolveSourceCoverageRetention(loaded, record, retentionProgram);
    if (!retained.rules.length) return false;
  } else if (!record.retention) return false;
  const external = record.coverageKind === "external-system" || record.coverageKind === "external-component";
  const sourceId = record.componentId || record.systemId;
  if (external && (!sourceId || !(record.retrieverIds || []).length)) {
    return false;
  }
  if (["not-applicable", "zero-population"].includes(record.coverageKind) && !record.applicabilityReview) {
    return false;
  }
  if (program?.candidateCoverage && !(record.readinessTestEvidenceIds || []).length) {
    return false;
  }
  if (program?.candidateCoverage) {
    const tests = (record.readinessTestEvidenceIds || []).map((id) => (
      loaded.resources.find((resource) => resource.id === id && resource.type === "evidence")
    ));
    if (tests.some((test) => (
      !test
      || test.readinessTest !== true
      || test.retrievalResult !== "passed"
      || test.accessConfirmed !== true
      || !(test.coveredSourceFamilyIds || []).includes(record.sourceFamilyId)
      || (external && !(
        test.sourceComponentId === sourceId
        || test.sourceSystemId === sourceId
        || (test.componentIds || []).includes(sourceId)
        || (test.systemIds || []).includes(sourceId)
      ))
    ))) return false;
  }
  return true;
}

export async function assessSourceCoverageReadiness(loaded, selectedControlIds = [], program = loaded.workspace) {
  if (!loaded.model.resources["source-coverage"]) return [];
  const selected = new Set(selectedControlIds);
  const selectedControlCodes = new Set(loaded.resources
    .filter((record) => (
      record.type === "control"
      && selected.has(record.id)
      && !["not-applicable", "retired"].includes(record.status)
    ))
    .map(({ code }) => code)
    .filter(Boolean));
  return Promise.all((loaded.model.evidenceSourceFamilies || [])
    .filter((family) => family.controlCodes.some((code) => selectedControlCodes.has(code)))
    .map(async (family) => {
      const records = loaded.resources.filter((record) => (
        record.type === "source-coverage"
        && record.sourceFamilyId === family.id
        && record.status !== "retired"
      ));
      const record = records.find(({ status }) => status === "active")
        || records.find(({ status }) => status === "planned")
        || null;
      return {
        family,
        record,
        complete: Boolean(record?.status === "active" && await sourceCoverageComplete(record, loaded, program))
      };
    }));
}

// Preparation is scoped to actual sources and reuses the existing preservation
// and Evidence lifecycles. It is separate from legacy audit-period coverage.
export async function sourcePreparationFacts(loaded, record, program, context = {}) {
  const { preparationEvidenceIssues } = await import("./preparation-evidence.js");
  const { applicabilityReviewIsCurrent } = await import("./applicability-scope.js");
  const { currentPartyPeople } = await import("./parties.js");
  const byId = new Map(loaded.resources.map((current) => [current.id, current]));
  const asOf = context.asOf;
  const issues = [];
  const add = (field, message) => issues.push({ field, message });
  if (!record) return { complete: false, issues: [{ field: "source-coverage", message: "Select or create scoped Source Coverage for this source and family." }], evidenceIds: [], retentionRuleIds: [] };
  if (record.status !== "active") add("status", "Finish the source decision and make this Source Coverage active after the source and collection method work.");
  const scopeIds = [program.id, ...(program.systemIds || []), ...(context.controlIds || []), context.sourceId];
  if (!record.scopeResourceIds?.some((id) => scopeIds.includes(id))) add("scopeResourceIds", "Set the declared scope to this Program, the affected Systems, or the linked Controls.");
  if (!record.validFrom || record.validFrom > asOf || record.validThrough && record.validThrough < (program.candidateCoverage?.endsOn || asOf)) add("validFrom/validThrough", "Record when this source is authoritative; extend or replace expired coverage for the intended operating dates.");
  if (record.coverageKind === "not-applicable") {
    if (!applicabilityReviewIsCurrent(record.applicabilityReview, record, program, loaded.resources, loaded.model, loaded.root)) add("applicabilityReview", "Record the actual reason this family does not apply to the current scope through the existing applicability review. Do not manufacture a retrieval test.");
    return { complete: !issues.length, issues, evidenceIds: [], retentionRuleIds: [] };
  }
  if (!record.collectionCadence?.trim()) add("collectionCadence", "Choose when the owner retrieves proof, early enough to collect it before the source or artifact expires.");
  if (!record.reconciliationMethod?.trim()) add("reconciliationMethod", "Name the export or query, its scope and filters, and how the owner checks counts, missing items and failed collection.");
  if (!currentPartyPeople(record.ownerIds || [], byId).size) add("ownerIds", "Assign an active accountable party to own this collection and reconciliation work.");
  if (record.coverageKind === "external-component" && (record.componentId !== context.sourceId || !currentPartyPeople(record.retrieverIds || [], byId).size)) add("componentId/retrieverIds", "Select the actual authoritative Component and the active People who can run the export or query.");
  const evidenceIds = (record.readinessTestEvidenceIds || []).filter((id) => {
    const proof = byId.get(id);
    if (preparationEvidenceIssues(proof, byId, asOf).length || proof.readinessTest !== true || proof.retrievalResult !== "passed" || proof.accessConfirmed !== true) return false;
    if (proof.collectedOn < record.validFrom) return false;
    if (!proof.coveredSourceFamilyIds?.includes(record.sourceFamilyId)) return false;
    if (context.sourceId && proof.sourceComponentId !== context.sourceId && !proof.componentIds?.includes(context.sourceId)) return false;
    if (record.retrievalMethodKey && proof.retrievalMethodKey !== record.retrievalMethodKey) return false;
    const controlIds = context.controlIds || [];
    const scopedSystemIds = [...new Set(controlIds.flatMap((id) => byId.get(id)?.systemIds || []))];
    const systemIds = scopedSystemIds.length ? scopedSystemIds : program.systemIds || [];
    const scopeMatch = (controlIds.length || systemIds.length)
      && controlIds.every((id) => proof.controlIds?.includes(id))
      && systemIds.every((id) => proof.systemIds?.includes(id));
    if (!scopeMatch) return false;
    return record.coverageKind !== "zero-population" || proof.artifactKind === "population-export" && proof.populationCount === 0 && proof.completenessValidation?.trim() && proof.accuracyValidation?.trim();
  });
  if (!evidenceIds.length) add("readinessTestEvidenceIds", "Run the documented retrieval with actual access for this source and scope. Keep a safe example or a checked zero-result export, record its actual date and collector, source Component, covered family, affected Control and System IDs, access confirmation and passed result, then link the Evidence. An applicability decision is not a successful retrieval.");
  const retained = await resolveSourceCoverageRetention(loaded, record, program);
  const retentionRuleIds = retained.rules.map(({ id }) => id);
  if (!retentionRuleIds.length) add("retentionScheduleItemIds", "Link an existing current preservation row covering this Source Coverage, or define the proof, cutoff, period and disposition that are actually needed. Preserve control metadata, approvals, results or scoped exports without retaining all logs or deleted customer content.");
  if (!retentionScheduleIsAuthoritative(loaded, program)) add("retention-schedule-approval", "Finish the existing Data Retention Schedule workflow. A separate eligible reviewer approves only a new or changed schedule; keep an unchanged exact approval.");
  return { complete: !issues.length, issues, evidenceIds, retentionRuleIds };
}
