import { CALCULATED_REVISION_FIELDS, CALCULATED_REVISION_MAP_FIELDS, calculateRevision, canonicalCalculatedRevision, revisionsMatch } from "./revisions.js";
import { reviewCommitsChangingTypes, reviewHistoricalWorkspace, reviewHistoryCommits, reviewHistoryContext } from "./historical-workspace.js";

const scopeSourceTypes = new Set([
  "workspace", "program", "commitment", "control", "complementary-control",
  "system", "framework", "component", "vendor", "policy", "requirement"
]);

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

export function applicabilityScopeRevision(record, program, resources, model, options = {}) {
  const scopedResource = ["commitment", "control", "complementary-control"].includes(record?.type)
    && !options.legacyBroadScope && !options.legacyBroadCommitment;
  const linkedRequirementIds = new Set(record?.requirementIds || []);
  const linkedControlIds = record?.type === "control"
    ? [record.id]
    : record?.type === "complementary-control"
      ? record.relatedControlIds || []
      : record?.controlIds || [];
  const selectedSystemIds = new Set((program?.systemIds || []).filter((id) => (
    !scopedResource || !(record.systemIds || []).length || record.systemIds.includes(id)
  )));
  const selectedFrameworkIds = new Set((program?.frameworkIds || []).filter((id) => (
    !scopedResource || !linkedRequirementIds.size || resources.some((candidate) => (
      candidate.type === "requirement" && candidate.frameworkId === id && linkedRequirementIds.has(candidate.id)
    ))
  )));
  const selectedControlIds = new Set((program?.controlIds || []).filter((id) => (
    !scopedResource || !linkedControlIds.length || linkedControlIds.includes(id)
  )));
  const selectedComponents = resources.filter(({ type, status, systemUses, id }) => (
    type === "component"
    && status !== "retired"
    && (systemUses || []).some(({ systemId }) => selectedSystemIds.has(systemId))
    && (!scopedResource || !(record.componentIds || []).length || record.componentIds.includes(id))
  ));
  const selectedVendorIds = new Set(selectedComponents.map(({ vendorId }) => vendorId).filter(Boolean));
  const selectedPolicyIds = new Set(resources
    .filter(({ type, id }) => type === "control" && selectedControlIds.has(id))
    .flatMap(({ policyIds }) => policyIds || []));
  for (const policyId of record.policyIds || []) selectedPolicyIds.add(policyId);
  const facts = {
    modelVersion: model.modelVersion,
    program: {
      ...pick(scopedResource ? {
        ...program,
        systemIds: [...selectedSystemIds],
        frameworkIds: [...selectedFrameworkIds],
        requirementIds: (program?.requirementIds || []).filter((id) => !linkedRequirementIds.size || linkedRequirementIds.has(id)),
        controlIds: [...selectedControlIds]
      } : program || {}, [
        "id",
        "assuranceGoal",
        "systemIds",
        "frameworkIds",
        "requirementIds",
        "controlIds",
        ...(record?.type === "commitment" && scopedResource ? [] : ["riskMethodology"])
      ], model),
      ...(record.type === "requirement" ? {} : {
        requirementApplicability: (program?.requirementApplicability || [])
          .filter((review) => !scopedResource || !linkedRequirementIds.size || linkedRequirementIds.has(review.requirementId))
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
      .map((policy) => options.legacyPolicyStatus || options.legacyPolicyOverrides
        ? pick({
            ...policy,
            status: (options.legacyPolicyOverrides?.[policy.id]?.status || options.legacyPolicyStatus || "current") === "current"
              ? policy.status : options.legacyPolicyOverrides?.[policy.id]?.status || options.legacyPolicyStatus,
            effectiveOn: (options.legacyPolicyOverrides?.[policy.id]?.withoutEffectiveOn
              ?? options.legacyPolicyWithoutEffectiveOn) ? undefined : policy.effectiveOn,
            approvedContentRevisions: (options.legacyPolicyOverrides?.[policy.id]?.withoutApprovalBinding
              ?? options.legacyPolicyWithoutApprovalBinding)
              ? undefined : policy.approvedContentRevisions
          }, [
            "id", "status", "policyKind", "version", "programRole", "effectiveOn",
            "requirementIds", "audience", "acknowledgementRequired",
            "relatedDocumentIds", "approvedContentRevisions"
          ], model)
        : pick(policy, ["id", "requirementIds"], model)),
    requirements: resources
      .filter(({ type, frameworkId, id }) => type === "requirement" && selectedFrameworkIds.has(frameworkId)
        && (!scopedResource || !linkedRequirementIds.size || linkedRequirementIds.has(id)))
      .sort(compareRecordIds)
      .map((requirement) => pick(requirement, ["id", "frameworkId", "reference", "description", "parentRequirementId"], model)),
    commitments: resources
      .filter(({ type, status, systemIds, controlIds, id }) => (
        type === "commitment"
        && !["retired", "superseded"].includes(status)
        && (systemIds || []).some((id) => selectedSystemIds.has(id))
        && (!scopedResource
          || record.type === "commitment" && id === record.id
          || record.type === "control" && (controlIds || []).includes(record.id)
          || record.type === "complementary-control" && (controlIds || []).some((controlId) => selectedControlIds.has(controlId)))
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
  return calculateRevision("applicability-scope", stableJson(facts));
}

function compareRecordIds(left, right) {
  return left.id.localeCompare(right.id);
}

export function applicabilityReviewIsCurrent(review, record, program, resources, model, root = null) {
  if (
    review?.scopeRevision
    && !review.scopeRevision.startsWith("scope:")
    && !review.scopeRevision.startsWith("filegrc:applicability-scope:")
    && Number(model?.modelVersion || 0) < 7
  ) return true;
  if (!review?.scopeRevision) return false;
  const matches = (revision) => revisionsMatch("applicability-scope", review.scopeRevision, revision);
  if (matches(applicabilityScopeRevision(record, program, resources, model))) return true;
  if (["commitment", "control", "complementary-control"].includes(record?.type) && matches(applicabilityScopeRevision(
    record, program, resources, model, { legacyBroadScope: true }
  ))) return true;
  if (["commitment", "control", "complementary-control"].includes(record?.type) && root && historicalScopedReviewMatches(
    review.scopeRevision, record, program, resources, model, root
  )) return true;
  // Older reviews hashed Policy approval metadata alongside scope facts.
  // Reconstruct each Policy independently because other Policies may already
  // have been approved when one Policy changes. Material fields stay current.
  for (const legacyPolicyStatus of ["current", "draft", "in-review", "approved", "active"]) {
    for (const legacyPolicyWithoutApprovalBinding of [false, true]) {
      for (const legacyPolicyWithoutEffectiveOn of [false, true]) {
        if (matches(applicabilityScopeRevision(record, program, resources, model, {
          legacyPolicyStatus,
          legacyPolicyWithoutApprovalBinding,
          legacyPolicyWithoutEffectiveOn
        }))) return true;
      }
    }
  }
  const selectedControlIds = new Set(program?.controlIds || []);
  const selectedPolicyIds = new Set(resources
    .filter(({ type, id }) => type === "control" && selectedControlIds.has(id))
    .flatMap(({ policyIds }) => policyIds || []));
  for (const id of record.policyIds || []) selectedPolicyIds.add(id);
  const policies = resources.filter(({ type, id }) => type === "policy" && selectedPolicyIds.has(id));
  // One Policy may advance while the others retain different approval states.
  // Reconstruct that Policy's former lifecycle fields without changing any
  // material scope fact or searching combinations of unrelated Policies.
  for (const policy of policies) {
    for (const value of legacyPolicyAlternatives(policy)) {
      if (matches(applicabilityScopeRevision(record, program, resources, model, {
        legacyPolicyOverrides: { [policy.id]: value }
      }))) return true;
    }
  }
  return false;
}

function historicalScopedReviewMatches(stored, record, program, resources, model, root) {
  const current = applicabilityScopeRevision(record, program, resources, model);
  const context = reviewHistoryContext(root, resources);
  const { index } = context;
  const commits = index?.available
    ? reviewCommitsChangingTypes(index, scopeSourceTypes)
    : reviewHistoryCommits(context);
  for (const commit of [...commits].reverse()) {
    const snapshot = reviewHistoricalWorkspace(context, commit);
    if (!snapshot) continue;
    const historicalResources = snapshot.resources;
    const historicalRecord = historicalResources.find(({ id }) => id === record.id);
    const historicalProgram = historicalResources.find(({ id }) => id === program?.id);
    if (!historicalRecord || !historicalProgram) continue;
    const historicalModel = snapshot.model;
    if (!revisionsMatch("applicability-scope", current, applicabilityScopeRevision(
      historicalRecord, historicalProgram, historicalResources, historicalModel
    ))) continue;
    if (revisionsMatch("applicability-scope", stored, applicabilityScopeRevision(
      historicalRecord, historicalProgram, historicalResources, historicalModel, { legacyBroadScope: true }
    ))) return true;
  }
  return false;
}

function legacyPolicyAlternatives(policy) {
  const prior = {
    active: ["approved", "in-review", "draft"],
    approved: ["in-review", "draft"],
    "in-review": ["draft"]
  }[policy.status] || [];
  return prior.map((status) => ({
    status,
    withoutApprovalBinding: status === "draft" || status === "in-review",
    withoutEffectiveOn: true
  }));
}

function pick(record, fields, model, objectType = null) {
  return canonicalObject(model, objectType || record.type, Object.fromEntries(fields
    .filter((field) => record?.[field] !== undefined)
    .map((field) => [field, record[field]])));
}

function canonicalObject(model, type, value, revisionMap = false) {
  const fields = model.resources?.[type]
    ? { ...model.commonFields, ...model.resources[type].fields }
    : model.objectTypes?.[type]?.properties || {};
  return Object.fromEntries(Object.keys(value).sort().map((name) => [
    name,
    canonicalFieldValue(model, value[name], fields[name], name, revisionMap)
  ]));
}

function canonicalFieldValue(model, value, field, name, revisionMap = false) {
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
    return field?.objectType
      ? canonicalObject(model, field.objectType, value, CALCULATED_REVISION_MAP_FIELDS.has(name))
      : value;
  }
  return typeof value === "string" && (revisionMap || CALCULATED_REVISION_FIELDS.has(name))
    ? canonicalCalculatedRevision(value, name)
    : value;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
