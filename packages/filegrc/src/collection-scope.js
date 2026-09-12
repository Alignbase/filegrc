import { modelSupports } from "../model/index.js";
import { programComponents, selectedRequirementIds } from "./program.js";
import { retentionReviewResourceIds } from "./retention.js";
import { documentIsAuditSpecific } from "./program-lifecycle.js";

export function scopedCollectionRecords(loaded, resourceType, program) {
  if (!modelSupports(loaded.model, "program-scope")) {
    return loaded.resources.filter((record) => record.type === resourceType);
  }
  if (resourceType === "person") {
    return scopedProgramPeople(loaded, program);
  }
  if (resourceType === "vendor") {
    const scopedVendorIds = new Set(programComponents(loaded, program).map(({ vendorId }) => vendorId).filter(Boolean));
    const auditVendorIds = new Set(loaded.resources
      .filter((record) => record.type === "audit" && record.auditorVendorId)
      .map(({ auditorVendorId }) => auditorVendorId));
    const auditOnlyVendorIds = Number(loaded.model.modelVersion) >= 7
      ? auditVendorIds
      : new Set(loaded.resources
          .filter((record) => (
            record.type === "vendor"
            && auditVendorIds.has(record.id)
            && /(?:audit|accounting|cpa)/i.test(record.category || "")
          ))
          .map(({ id }) => id));
    return loaded.resources.filter((record) => (
      record.type === "vendor"
      && (!auditOnlyVendorIds.has(record.id) || scopedVendorIds.has(record.id))
    ));
  }
  const scopedProgram = program || {};
  const components = programComponents(loaded, scopedProgram);
  const componentIds = new Set(components.map(({ id }) => id));
  const systemIds = new Set(scopedProgram.systemIds || []);
  const controlIds = new Set(scopedProgram.controlIds || []);
  const selected = {
    system: systemIds,
    component: componentIds,
    control: controlIds,
    framework: new Set(scopedProgram.frameworkIds || []),
    "complementary-control": new Set(loaded.resources.filter((record) => (
      record.type === "complementary-control"
      && record.status !== "superseded"
      && record.status !== "retired"
      && (
        (record.systemIds || []).some((id) => systemIds.has(id))
        || (record.relatedControlIds || []).some((id) => controlIds.has(id))
        || (record.componentIds || []).some((id) => componentIds.has(id))
      )
    )).map(({ id }) => id)),
    asset: new Set(loaded.resources.filter((record) => (
      record.type === "asset" && (record.componentIds || []).some((id) => componentIds.has(id))
    )).map(({ id }) => id))
  }[resourceType];
  return loaded.resources.filter((record) => (
    record.type === resourceType
    && (!selected || selected.has(record.id))
    && (resourceType !== "control" || record.status === "implemented")
  ));
}

export function selectScopedCollectionRecords(loaded, selector, program) {
  if (!selector?.resourceType) return [];
  return scopedCollectionRecords(loaded, selector.resourceType, program).filter((record) => (
    (!selector.statuses?.length || selector.statuses.includes(record.status))
    && (!selector.criticalities?.length || selector.criticalities.includes(record.criticality))
  ));
}

function scopedProgramPeople(loaded, program = {}) {
  const personIds = new Set(loaded.resources.filter(({ type }) => type === "person").map(({ id }) => id));
  const systemIds = new Set(program.systemIds || []);
  const controlIds = new Set(program.controlIds || []);
  const policyIds = new Set(loaded.resources
    .filter(({ type, status, programRole }) => type === "policy" && status !== "retired" && programRole !== "reference")
    .map(({ id }) => id));
  const components = programComponents(loaded, program);
  const componentIds = new Set(components.map(({ id }) => id));
  const vendorIds = new Set([
    ...components.map(({ vendorId }) => vendorId).filter(Boolean),
    ...scopedCollectionRecords(loaded, "vendor", program).map(({ id }) => id)
  ]);
  const sources = loaded.resources.filter((record) => (
    ["workspace", "program", "appointment", "team"].includes(record.type)
    || record.type === "system" && systemIds.has(record.id)
    || record.type === "component" && componentIds.has(record.id)
    || record.type === "vendor" && vendorIds.has(record.id)
    || record.type === "control" && controlIds.has(record.id)
    || record.type === "policy" && policyIds.has(record.id)
    || record.type === "document" && record.workflowScope !== "engagement"
    || record.type === "obligation" && (
      (record.controlIds || []).some((id) => controlIds.has(id))
      || (record.policyIds || []).some((id) => policyIds.has(id))
    )
  ));
  const selected = new Set();
  const visit = (value) => {
    if (typeof value === "string" && personIds.has(value)) selected.add(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  sources.forEach(visit);
  return loaded.resources.filter((record) => record.type === "person" && selected.has(record.id));
}

export function collectionRevisionInputs(loaded, resourceType, program, options = {}) {
  const legacy = options.legacy === true;
  const reviewed = scopedCollectionRecords(loaded, resourceType, program);
  if (!modelSupports(loaded.model, "program-scope")) {
    return reviewed.map((record) => ({ record, value: record, includeContent: true }));
  }
  const byId = new Map(loaded.resources.map((record) => [record.id, record]));
  const records = new Map(reviewed.map((record) => [record.id, record]));
  const reviewedIds = new Set(records.keys());
  const addIds = (ids) => {
    for (const id of ids || []) {
      const record = byId.get(id);
      if (record) records.set(record.id, record);
    }
  };
  const addPartyIds = (ids) => {
    const pending = [...(ids || [])];
    const visited = new Set();
    while (pending.length) {
      const id = pending.shift();
      if (!id || visited.has(id)) continue;
      visited.add(id);
      const record = byId.get(id);
      if (!record) continue;
      records.set(record.id, record);
      if (record.type === "team") pending.push(...(record.memberIds || []), ...(record.chairIds || []));
      if (record.type === "appointment") pending.push(record.holderId);
    }
  };

  if (resourceType === "framework") {
    addIds(program?.systemIds);
    addIds(selectedRequirementIds(program || {}, loaded.model));
  }
  if (resourceType === "vendor") {
    for (const record of reviewed) {
      addIds([record.agreementDocumentId, record.classificationId]);
      addIds(record.informationTypeIds);
    }
  }
  if (resourceType === "system") {
    for (const record of reviewed) {
      addIds([record.classificationId]);
      addIds(record.informationTypeIds);
    }
  }
  if (resourceType === "component") {
    addIds(program?.systemIds);
    addIds(program?.controlIds);
    for (const record of reviewed) {
      addIds([record.vendorId, record.classificationId]);
      addIds((record.informationUses || []).map(({ informationTypeId }) => informationTypeId));
    }
  }
  if (resourceType === "control") {
    const obligations = loaded.resources.filter((record) => (
      record.type === "obligation"
      && record.status === "active"
      && (record.controlIds || []).some((id) => reviewedIds.has(id))
    ));
    const controlCodes = new Set(reviewed.map(({ code }) => code).filter(Boolean));
    const sourceFamilyIds = new Set((loaded.model.evidenceSourceFamilies || [])
      .filter((family) => (family.controlCodes || []).some((code) => controlCodes.has(code)))
      .map(({ id }) => id));
    const sourceCoverage = loaded.resources.filter((record) => (
      record.type === "source-coverage"
      && record.status !== "retired"
      && sourceFamilyIds.has(record.sourceFamilyId)
    ));
    const policyIds = new Set(reviewed.flatMap((record) => record.policyIds || []));
    const policies = loaded.resources.filter((record) => (
      record.type === "policy"
      && policyIds.has(record.id)
      && record.programRole !== "conditional"
      && !["superseded", "retired"].includes(record.status)
    ));
    const governedIds = new Set([
      ...policies.flatMap((record) => record.relatedDocumentIds || []),
      ...obligations.flatMap((record) => [
        ...(record.scopeResourceIds || []),
        ...(record.templateResourceId ? [record.templateResourceId] : [])
      ])
    ]);
    const governedContent = loaded.resources.filter((record) => (
      ["document", "training"].includes(record.type)
      && !["superseded", "retired"].includes(record.status)
      && (governedIds.has(record.id) || (record.controlIds || []).some((id) => reviewedIds.has(id)))
      && (record.type !== "document" || !documentIsAuditSpecific(record, loaded.model))
    ));
    addIds(program?.systemIds);
    addIds(obligations.map(({ id }) => id));
    addIds(sourceCoverage.map(({ id }) => id));
    addIds(policies.map(({ id }) => id));
    addIds(governedContent.map(({ id }) => id));
    for (const record of reviewed) {
      addIds(record.componentIds);
      addIds(record.evidenceSourceComponentIds);
      addPartyIds(record.ownerIds);
    }
    for (const obligation of obligations) addPartyIds(obligation.ownerIds);
    for (const record of [...policies, ...governedContent]) {
      addPartyIds([...(record.ownerIds || []), ...(record.approverIds || []), ...(record.approvedByIds || [])]);
    }
    for (const coverage of sourceCoverage) {
      addIds([coverage.componentId]);
      addIds(coverage.readinessTestEvidenceIds);
      addIds(coverage.retentionScheduleItemIds);
      addPartyIds([...(coverage.ownerIds || []), ...(coverage.retrieverIds || [])]);
      for (const rule of (coverage.retentionScheduleItemIds || []).map((id) => byId.get(id)).filter(Boolean)) {
        addIds(retentionReviewResourceIds(rule, loaded));
        addPartyIds([...(rule.ownerIds || []), ...(rule.approvedByIds || [])]);
      }
    }
  }
  if (resourceType === "information-type" && !legacy) {
    addIds(program?.systemIds);
    addIds(programComponents(loaded, program || {}).map(({ id }) => id));
    addIds(loaded.resources
      .filter((record) => record.type === "vendor" && record.status !== "retired")
      .map(({ id }) => id));
  }
  if (resourceType === "complementary-control") {
    addIds(program?.systemIds);
    addIds(program?.controlIds);
    for (const record of reviewed) {
      addIds([record.vendorId]);
      addIds(record.requirementIds);
      addIds(record.commitmentIds);
      addIds(record.sourceDocumentIds);
      addIds(record.componentIds);
    }
  }
  return [...records.values()].map((record) => ({
    record,
    value: reviewedIds.has(record.id)
      ? record
      : dependencyRevisionValue(resourceType, record, legacy),
    includeContent: legacy
      || reviewedIds.has(record.id)
      || dependencyContentAffectsRevision(resourceType, record.type)
  }));
}

export function collectionScopeRevisionFacts(loaded, resourceType, program) {
  if (!modelSupports(loaded.model, "program-scope")) {
    const common = { programId: program?.id ?? null };
    if (resourceType === "framework") {
      return {
        ...common,
        assuranceGoal: program?.assuranceGoal ?? null,
        systemIds: sorted(program?.systemIds),
        frameworkIds: sorted(program?.frameworkIds),
        requirementIds: sorted(selectedRequirementIds(program || {}, loaded.model))
      };
    }
    if (resourceType === "vendor" || resourceType === "system" || resourceType === "complementary-control") {
      return {
        ...common,
        systemIds: sorted(program?.systemIds),
        controlIds: sorted(program?.controlIds)
      };
    }
    return common;
  }
  const common = { programId: program?.id ?? null };
  if (resourceType === "framework") {
    return {
      ...common,
      assuranceGoal: program?.assuranceGoal ?? null,
      systemIds: sorted(program?.systemIds),
      frameworkIds: sorted(program?.frameworkIds),
      requirementIds: sorted(selectedRequirementIds(program || {}, loaded.model))
    };
  }
  if (resourceType === "system") {
    return { ...common, systemIds: sorted(program?.systemIds) };
  }
  if (resourceType === "component" || resourceType === "complementary-control" || resourceType === "control") {
    const scope = {
      ...common,
      systemIds: sorted(program?.systemIds),
      controlIds: sorted(program?.controlIds)
    };
    return resourceType === "control" ? {
      ...scope,
      assuranceGoal: program?.assuranceGoal ?? null,
      frameworkIds: sorted(program?.frameworkIds),
      requirementIds: sorted(selectedRequirementIds(program || {}, loaded.model)),
      requirementApplicability: program?.requirementApplicability || [],
      riskMethodology: program?.riskMethodology || null
    } : scope;
  }
  return common;
}

export function authoritativeSourceRevisionValue(record) {
  return Object.fromEntries(Object.entries(record).filter(([field]) => (
    !authoritativeSourceBookkeepingFields.has(field)
  )));
}

const authoritativeSourceBookkeepingFields = new Set([
  "tags",
  "statusTransition"
]);

const dependencyFields = {
  framework: {
    system: ["id", "type", "status", "purpose", "servicesProvided", "boundary", "exclusions", "criticality", "informationTypeIds", "classificationId", "internetExposed", "continuityObjectives"],
    requirement: ["id", "type", "title", "frameworkId", "reference", "description", "parentRequirementId"]
  },
  vendor: {
    document: ["id", "type", "status", "documentKind", "version", "effectiveOn", "approvedOn", "approvedContentRevisions", "systemIds", "controlIds", "componentIds", "classificationId"],
    classification: ["id", "type", "status", "rank", "description", "handlingRequirements"],
    "information-type": ["id", "type", "status", "classificationId", "description"]
  },
  system: {
    classification: ["id", "type", "status", "rank", "description", "handlingRequirements"],
    "information-type": ["id", "type", "status", "classificationId", "description"]
  },
  component: {
    system: ["id", "type", "status", "purpose", "servicesProvided", "boundary", "exclusions", "criticality", "informationTypeIds", "classificationId", "internetExposed", "continuityObjectives"],
    control: ["id", "type", "systemIds", "componentIds", "evidenceSourceComponentIds"],
    vendor: ["id", "type", "status", "category", "criticality", "description", "startDate", "endDate"],
    classification: ["id", "type", "status", "rank", "description", "handlingRequirements"],
    "information-type": ["id", "type", "status", "classificationId", "description"]
  },
  control: {
    system: ["id", "type", "status", "purpose", "servicesProvided", "boundary", "exclusions", "criticality", "informationTypeIds", "classificationId", "internetExposed", "continuityObjectives"],
    component: ["id", "type", "status", "componentKind", "description", "ownerIds", "systemUses", "evidenceSourceKinds", "evidenceOwnerIds"],
    obligation: ["id", "type", "status", "activityType", "scheduleMode", "ownerIds", "activeRuleId", "policyIds", "controlIds", "ruleIds"],
    "source-coverage": ["id", "type", "status", "sourceFamilyId", "coverageKind", "scopeResourceIds", "excludedPopulation", "retrieverIds", "collectionCadence", "retentionScheduleItemIds", "reconciliationMethod", "validFrom", "validThrough", "applicabilityReview", "readinessTestEvidenceIds", "ownerIds", "componentId"],
    evidence: ["id", "type", "status", "artifactKind", "readinessTest", "retrievalResult", "accessConfirmed", "coveredSourceFamilyIds", "sourceComponentId", "componentIds", "systemIds", "collectedOn", "collectorIds", "verifierIds", "verifiedOn"],
    "retention-schedule-item": ["id", "type", "status", "description", "informationTypeIds", "scopeResourceIds", "scheduleDocumentId", "sourceResourceIds", "ownerIds", "approvedByIds", "approvedOn", "reviewedSourceRevisions", "cutoff", "retentionPeriod", "dispositionAction", "dispositionInstructions"],
    document: ["id", "type", "documentKind", "workflowScope", "ownerIds", "approverIds", "approvedOn", "approvedContentRevisions", "controlIds"],
    policy: ["id", "type", "programRole", "ownerIds", "approverIds", "approvedOn", "approvedContentRevisions", "relatedDocumentIds", "controlIds"],
    training: ["id", "type", "ownerIds", "approverIds", "approvedOn", "approvedContentRevisions", "controlIds"],
    "information-type": ["id", "type", "status", "classificationId", "description"],
    person: ["id", "type", "status", "affiliation", "jobTitle"],
    team: ["id", "type", "status", "memberIds", "chairIds"],
    appointment: ["id", "type", "status", "appointmentKind", "scopeResourceIds", "holderId", "startsOn", "endsOn"]
  },
  "information-type": {
    system: ["id", "type", "status", "informationTypeIds"],
    component: ["id", "type", "status", "systemUses", "informationUses"],
    vendor: ["id", "type", "status", "informationTypeIds"]
  },
  "complementary-control": {
    system: ["id", "type", "status", "purpose", "servicesProvided", "boundary", "exclusions", "criticality", "informationTypeIds", "classificationId", "internetExposed", "continuityObjectives"],
    control: ["id", "type", "status", "statement", "activity", "systemIds", "componentIds", "evidenceSourceComponentIds"],
    vendor: ["id", "type", "status", "category", "criticality", "description", "standardAgreement", "agreementDocumentId", "startDate", "endDate", "classificationId", "informationTypeIds"],
    requirement: ["id", "type", "title", "frameworkId", "reference", "description", "parentRequirementId"],
    commitment: ["id", "type", "status", "commitmentKind", "statement", "systemIds", "requirementIds", "controlIds", "customerFacing", "effectiveOn"],
    document: ["id", "type", "status", "documentKind", "version", "effectiveOn", "approvedOn", "approvedContentRevisions", "systemIds", "controlIds", "componentIds", "classificationId"],
    component: ["id", "type", "status", "componentKind", "description", "criticality", "vendorId", "systemUses", "informationUses", "internetExposed", "classificationId", "continuityObjectives"]
  }
};

const legacyDependencyFieldOverrides = {
  framework: {
    system: ["id", "type", "status", "purpose", "servicesProvided", "boundary", "exclusions", "informationTypeIds", "classificationId", "internetExposed"]
  },
  component: {
    control: ["id", "type", "status", "statement", "activity", "controlType", "operationMode", "operationPattern", "systemIds", "componentIds", "evidenceSourceComponentIds"],
    vendor: ["id", "type", "status", "category", "criticality", "description", "standardAgreement", "agreementDocumentId", "startDate", "endDate", "classificationId", "informationTypeIds"]
  },
  "complementary-control": {
    system: ["id", "type", "status", "purpose", "servicesProvided", "boundary", "exclusions", "informationTypeIds", "classificationId", "internetExposed"],
    control: ["id", "type", "status", "statement", "activity", "controlType", "operationMode", "operationPattern", "systemIds", "componentIds", "evidenceSourceComponentIds"],
    component: ["id", "type", "status", "componentKind", "description", "vendorId", "systemUses", "informationUses", "internetExposed"]
  }
};

const dependencyContentTypes = {
  framework: new Set(["system"]),
  vendor: new Set(["document"]),
  component: new Set(["system"]),
  control: new Set(["system", "component", "obligation", "source-coverage", "evidence", "retention-schedule-item", "document", "policy", "training"]),
  "complementary-control": new Set(["system", "control", "document", "component"])
};

function dependencyRevisionValue(resourceType, record, legacy) {
  const fields = legacy
    ? legacyDependencyFieldOverrides[resourceType]?.[record.type]
      || dependencyFields[resourceType]?.[record.type]
    : dependencyFields[resourceType]?.[record.type];
  if (!fields) return { id: record.id, type: record.type };
  return Object.fromEntries(fields
    .filter((field) => record[field] !== undefined)
    .map((field) => [field, record[field]]));
}

function dependencyContentAffectsRevision(resourceType, dependencyType) {
  return dependencyContentTypes[resourceType]?.has(dependencyType) || false;
}

function sorted(values) {
  return [...(values || [])].sort();
}
