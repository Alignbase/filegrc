import { createHash } from "node:crypto";

const excludedResourceFields = new Set([
  "applicabilityReview",
  "applicability",
  "status",
  "statusTransition",
  "effectiveOn",
  "procedureEffectiveOn",
  "procedureRevision",
  "implementationReviewedByIds",
  "implementationReviewedOn"
]);

const unorderedStringArrayFields = new Set([
  "audience",
  "roles",
  "servicesProvided",
  "exclusions",
  "evidenceSourceKinds",
  "tags"
]);

export function applicabilityScopeRevision(record, program, resources, model) {
  const selectedSystemIds = new Set(program?.systemIds || []);
  const selectedFrameworkIds = new Set(program?.frameworkIds || []);
  const selectedControlIds = new Set(program?.controlIds || []);
  const selectedComponents = resources.filter(({ type, status, systemUses }) => (
    type === "component"
    && status !== "retired"
    && (systemUses || []).some(({ systemId }) => selectedSystemIds.has(systemId))
  ));
  const selectedVendorIds = new Set(selectedComponents.map(({ vendorId }) => vendorId).filter(Boolean));
  const selectedPolicyIds = new Set(resources
    .filter(({ type, id }) => type === "control" && selectedControlIds.has(id))
    .flatMap(({ policyIds }) => policyIds || []));
  for (const policyId of record.policyIds || []) selectedPolicyIds.add(policyId);
  const facts = {
    modelVersion: model.modelVersion,
    program: {
      ...pick(program || {}, [
        "id",
        "assuranceGoal",
        "systemIds",
        "frameworkIds",
        "requirementIds",
        "controlIds",
        "riskMethodology"
      ], model),
      ...(record.type === "requirement" ? {} : {
        requirementApplicability: (program?.requirementApplicability || [])
          .map((review) => pick(review, ["requirementId", "decision"], model, "program-applicability"))
          .sort((left, right) => left.requirementId.localeCompare(right.requirementId))
      })
    },
    resource: canonicalObject(model, record.type, Object.fromEntries(Object.entries(record)
      .filter(([field]) => !excludedResourceFields.has(field)))),
    systems: resources
      .filter(({ type, id }) => type === "system" && selectedSystemIds.has(id))
      .sort(compareRecordIds)
      .map((system) => pick(system, [
        "id",
        "purpose",
        "servicesProvided",
        "boundary",
        "exclusions",
        "criticality",
        "informationTypeIds",
        "classificationId",
        "internetExposed"
      ], model)),
    frameworks: resources
      .filter(({ type, id }) => type === "framework" && selectedFrameworkIds.has(id))
      .sort(compareRecordIds)
      .map((framework) => pick(framework, [
        "id",
        "status",
        "title",
        "version",
        "publisher",
        "description",
        "sourceReference",
        "effectiveOn"
      ], model)),
    components: selectedComponents
      .sort(compareRecordIds)
      .map((component) => pick(component, [
        "id",
        "status",
        "componentKind",
        "description",
        "criticality",
        "environment",
        "vendorId",
        "systemUses",
        "informationUses",
        "internetExposed",
        "classificationId",
        "continuityObjectives"
      ], model)),
    vendors: resources
      .filter(({ type, id }) => type === "vendor" && selectedVendorIds.has(id))
      .sort(compareRecordIds)
      .map((vendor) => pick(vendor, [
        "id",
        "status",
        "category",
        "criticality",
        "description",
        "standardAgreement",
        "agreementDocumentId",
        "startDate",
        "endDate",
        "informationTypeIds",
        "classificationId"
      ], model)),
    policies: resources
      .filter(({ type, id }) => type === "policy" && selectedPolicyIds.has(id))
      .sort(compareRecordIds)
      .map((policy) => pick(policy, [
        "id",
        "status",
        "policyKind",
        "version",
        "programRole",
        "effectiveOn",
        "requirementIds",
        "audience",
        "acknowledgementRequired",
        "relatedDocumentIds",
        "approvedContentRevisions"
      ], model)),
    requirements: resources
      .filter(({ type, frameworkId }) => type === "requirement" && selectedFrameworkIds.has(frameworkId))
      .sort(compareRecordIds)
      .map((requirement) => pick(requirement, ["id", "frameworkId", "reference", "description", "parentRequirementId"], model)),
    commitments: resources
      .filter(({ type, status, systemIds }) => (
        type === "commitment"
        && !["retired", "superseded"].includes(status)
        && (systemIds || []).some((id) => selectedSystemIds.has(id))
      ))
      .sort(compareRecordIds)
      .map((commitment) => pick(commitment, [
        "id",
        "commitmentKind",
        "statement",
        "systemIds",
        "requirementIds",
        "controlIds",
        "customerFacing"
      ], model))
  };
  return `scope:${createHash("sha256").update(stableJson(facts)).digest("hex")}`;
}

function compareRecordIds(left, right) {
  return left.id.localeCompare(right.id);
}

export function applicabilityReviewIsCurrent(review, record, program, resources, model) {
  if (
    review?.scopeRevision
    && !review.scopeRevision.startsWith("scope:")
    && Number(model?.modelVersion || 0) < 7
  ) return true;
  return Boolean(
    review?.scopeRevision
    && review.scopeRevision === applicabilityScopeRevision(record, program, resources, model)
  );
}

function pick(record, fields, model, objectType = null) {
  return canonicalObject(model, objectType || record.type, Object.fromEntries(fields
    .filter((field) => record?.[field] !== undefined)
    .map((field) => [field, record[field]])));
}

function canonicalObject(model, type, value) {
  const fields = model.resources?.[type]
    ? { ...model.commonFields, ...model.resources[type].fields }
    : model.objectTypes?.[type]?.properties || {};
  return Object.fromEntries(Object.keys(value).sort().map((name) => [
    name,
    canonicalFieldValue(model, value[name], fields[name], name)
  ]));
}

function canonicalFieldValue(model, value, field, name) {
  if (Array.isArray(value)) {
    const items = value.map((item) => field?.itemObjectType && item && typeof item === "object"
      ? canonicalObject(model, field.itemObjectType, item)
      : item);
    if (field?.relation || field?.items === "id" || field?.itemObjectType || unorderedStringArrayFields.has(name)) {
      items.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    }
    return items;
  }
  if (value && typeof value === "object") {
    return field?.objectType ? canonicalObject(model, field.objectType, value) : value;
  }
  return value;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
