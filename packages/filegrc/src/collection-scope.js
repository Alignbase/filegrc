import { programComponents, selectedRequirementIds } from "./program.js";

export function scopedCollectionRecords(loaded, resourceType, program) {
  if (String(loaded.model.modelVersion) !== "4") {
    return loaded.resources.filter((record) => record.type === resourceType);
  }
  if (resourceType === "vendor") {
    return loaded.resources.filter((record) => record.type === "vendor");
  }
  const scopedProgram = program || {};
  const components = programComponents(loaded, scopedProgram);
  const componentIds = new Set(components.map(({ id }) => id));
  const systemIds = new Set(scopedProgram.systemIds || []);
  const controlIds = new Set(scopedProgram.controlIds || []);
  const selected = {
    system: systemIds,
    component: componentIds,
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
    record.type === resourceType && (!selected || selected.has(record.id))
  ));
}

export function collectionRevisionInputs(loaded, resourceType, program) {
  const reviewed = scopedCollectionRecords(loaded, resourceType, program);
  if (String(loaded.model.modelVersion) !== "4") {
    return reviewed.map((record) => ({ record, value: record }));
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
      : dependencyRevisionValue(resourceType, record)
  }));
}

export function collectionScopeRevisionFacts(loaded, resourceType, program) {
  if (String(loaded.model.modelVersion) !== "4") {
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
  if (resourceType === "component" || resourceType === "complementary-control") {
    return {
      ...common,
      systemIds: sorted(program?.systemIds),
      controlIds: sorted(program?.controlIds)
    };
  }
  return common;
}

const dependencyFields = {
  framework: {
    system: ["id", "type", "status", "purpose", "servicesProvided", "boundary", "exclusions", "informationTypeIds", "classificationId", "internetExposed"],
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
    control: ["id", "type", "status", "statement", "activity", "controlType", "operationMode", "operationPattern", "systemIds", "componentIds", "evidenceSourceComponentIds"],
    vendor: ["id", "type", "status", "category", "criticality", "description", "standardAgreement", "agreementDocumentId", "startDate", "endDate", "classificationId", "informationTypeIds"],
    classification: ["id", "type", "status", "rank", "description", "handlingRequirements"],
    "information-type": ["id", "type", "status", "classificationId", "description"]
  },
  "complementary-control": {
    system: ["id", "type", "status", "purpose", "servicesProvided", "boundary", "exclusions", "informationTypeIds", "classificationId", "internetExposed"],
    control: ["id", "type", "status", "statement", "activity", "controlType", "operationMode", "operationPattern", "systemIds", "componentIds", "evidenceSourceComponentIds"],
    vendor: ["id", "type", "status", "category", "criticality", "description", "standardAgreement", "agreementDocumentId", "startDate", "endDate", "classificationId", "informationTypeIds"],
    requirement: ["id", "type", "title", "frameworkId", "reference", "description", "parentRequirementId"],
    commitment: ["id", "type", "status", "commitmentKind", "statement", "systemIds", "requirementIds", "controlIds", "customerFacing", "effectiveOn"],
    document: ["id", "type", "status", "documentKind", "version", "effectiveOn", "approvedOn", "approvedContentRevisions", "systemIds", "controlIds", "componentIds", "classificationId"],
    component: ["id", "type", "status", "componentKind", "description", "vendorId", "systemUses", "informationUses", "internetExposed"]
  }
};

function dependencyRevisionValue(resourceType, record) {
  const fields = dependencyFields[resourceType]?.[record.type];
  if (!fields) return { id: record.id, type: record.type };
  return Object.fromEntries(fields
    .filter((field) => record[field] !== undefined)
    .map((field) => [field, record[field]]));
}

function sorted(values) {
  return [...(values || [])].sort();
}
