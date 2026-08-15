export function sourceCoverageComplete(record, loaded, program = loaded.workspace) {
  if (!record?.validFrom || !record.collectionCadence || !record.retention || !record.reconciliationMethod) {
    return false;
  }
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

export function assessSourceCoverageReadiness(loaded, selectedControlIds = [], program = loaded.workspace) {
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
  return (loaded.model.evidenceSourceFamilies || [])
    .filter((family) => family.controlCodes.some((code) => selectedControlCodes.has(code)))
    .map((family) => {
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
        complete: Boolean(record?.status === "active" && sourceCoverageComplete(record, loaded, program))
      };
    });
}
