import { resourceIndex } from "./resource-index.js";
import { calculationMemo } from "./calculation-cache.js";
import { CALCULATED_REVISION_FIELDS, CALCULATED_REVISION_MAP_FIELDS, calculateRevision, canonicalCalculatedRevision, revisionsMatch } from "./revisions.js";
import { reviewCommitsChangingTypes, reviewHistoricalWorkspace, reviewHistoryCommits, reviewHistoryContext } from "./historical-workspace.js";
import { loadModel } from "../model/index.js";

const scopeSourceTypes = new Set([
  "workspace", "program", "commitment", "control", "complementary-control",
  "system", "framework", "component", "vendor", "policy", "requirement"
]);

const excludedResourceFields = new Set([
  "applicabilityReview",
  "periodImpactReview",
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

const applicabilityDecisionFields = {
  requirement: ["frameworkId", "reference", "description", "parentRequirementId"],
  control: ["statement", "requirementIds", "code", "systemIds"],
  commitment: ["commitmentKind", "statement", "systemIds", "sourceResourceIds", "requirementIds", "controlIds", "customerFacing", "reportingRouteRequirements"],
  "complementary-control": ["responsibleParty", "statement", "systemIds", "vendorId", "requirementIds", "commitmentIds", "relatedControlIds", "sourceDocumentIds"]
};
const legacyApplicabilityDecisionFields = {
  requirement: applicabilityDecisionFields.requirement,
  control: ["statement", "requirementIds", "code", "activity", "controlType", "operationMode", "operationPattern", "systemIds", "policyIds", "componentIds", "evidenceSourceComponentIds"],
  commitment: ["commitmentKind", "statement", "systemIds", "sourceResourceIds", "requirementIds", "controlIds", "customerFacing", "reportingRouteRequirements"],
  "complementary-control": ["responsibleParty", "statement", "systemIds", "vendorId", "requirementIds", "commitmentIds", "relatedControlIds", "sourceDocumentIds", "componentIds"]
};

// Build once at a calculation boundary, rather than retaining an index over
// mutable current records between calculations. Preserve duplicates for exact
// hash compatibility even when structural validation will reject them.
export function createApplicabilityScopeIndex(resources, program) {
  const index = resourceIndex(resources);
  const group = (values, key) => {
    const result = new Map();
    for (const value of values) {
      const id = key(value);
      if (!result.has(id)) result.set(id, []);
      result.get(id).push(value);
    }
    return result;
  };
  return {
    requirements: index.idsOfType("requirement"),
    frameworks: index.idsOfType("framework"),
    programIds: Object.fromEntries(["systemIds", "frameworkIds", "requirementIds"].map((field) => [
      field, group((program?.[field] || []).map((id, position) => ({ id, position })), ({ id }) => id)
    ])),
    decisions: group(program?.requirementApplicability || [], ({ requirementId }) => requirementId)
  };
}

function indexedValues(index, ids) {
  return [...new Set(ids)].flatMap((id) => index.get(id) || []);
}

const historicalScopeIndexes = new WeakMap();
let compatibleModel11;
let compatibleModel12;

export function applicabilityScopeRevision(record, program, resources, model, options = {}) {
  const { scopeIndex, ...modes } = options;
  return calculationMemo(resources, "applicability-scope", [record, program, model, JSON.stringify(modes)], () =>
    applicabilityScopeRevisionUncached(record, program, resources, model, {
      ...options, scopeIndex: scopeIndex || calculationMemo(resources, "scope-index", [program], () => createApplicabilityScopeIndex(resources, program))
    }));
}

function applicabilityScopeRevisionUncached(record, program, resources, model, options) {
  if (Number(model.modelVersion) >= 11 && !options.legacyDecisionScope) {
    const index = options.scopeIndex;
    const linkedRequirements = index
      ? indexedValues(index.requirements, record.type === "requirement" ? [record.id] : record.requirementIds || [])
      : resources.filter((candidate) => candidate.type === "requirement"
        && (record.type === "requirement" ? candidate.id === record.id : (record.requirementIds || []).includes(candidate.id)));
    const linkedIds = new Set(linkedRequirements.map(({ id }) => id));
    const selected = (field, ids) => index
      ? indexedValues(index.programIds[field], ids).sort((left, right) => left.position - right.position).map(({ id }) => id)
      : (program?.[field] || []).filter((id) => ids.has(id));
    const frameworkIds = new Set(linkedRequirements.map(({ frameworkId }) => frameworkId));
    const scopedProgram = record.type === "requirement" ? {
      ...program,
      systemIds: [],
      frameworkIds: selected("frameworkIds", new Set([record.frameworkId])),
      requirementIds: selected("requirementIds", new Set([record.id]))
    } : {
      ...program,
      systemIds: selected("systemIds", new Set(record.systemIds || [])),
      frameworkIds: frameworkIds.size ? selected("frameworkIds", frameworkIds) : program?.frameworkIds || [],
      requirementIds: selected("requirementIds", linkedIds)
    };
    const facts = {
      modelVersion: model.modelVersion,
      resource: applicabilityResourceFacts(record, model, options),
      program: pick(scopedProgram || {}, ["id", "assuranceGoal", "systemIds", "frameworkIds", "requirementIds"], model, "program"),
      requirements: linkedRequirements.sort(compareRecordIds).map((candidate) => pick(candidate,
        ["id", "frameworkId", "reference", "description", "parentRequirementId"], model)),
      frameworks: (index ? indexedValues(index.frameworks, frameworkIds)
        : resources.filter(({ type, id }) => type === "framework" && frameworkIds.has(id)))
        .sort(compareRecordIds).map((candidate) => pick(candidate, ["id", "version", "status"], model)),
      requirementDecisions: (record.type === "requirement" ? [] : index
        ? indexedValues(index.decisions, linkedIds)
        : (program?.requirementApplicability || []).filter(({ requirementId }) => linkedIds.has(requirementId)))
        .map(({ requirementId, decision }) => ({ requirementId, decision }))
        .sort((left, right) => left.requirementId.localeCompare(right.requirementId))
    };
    return calculateRevision("applicability-scope", stableJson(facts));
  }
  const index = resourceIndex(resources);
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
    !scopedResource || !linkedRequirementIds.size || index.related("requirement", "frameworkId", [id]).some((candidate) => linkedRequirementIds.has(candidate.id))
  )));
  const selectedControlIds = new Set((program?.controlIds || []).filter((id) => (
    !scopedResource || !linkedControlIds.length || linkedControlIds.includes(id)
  )));
  const selectedComponents = index.related("component", "systemUses.systemId", selectedSystemIds).filter(({ status, id }) => (
    status !== "retired"
    && (!scopedResource || !(record.componentIds || []).length || record.componentIds.includes(id))
  ));
  const selectedVendorIds = new Set(selectedComponents.map(({ vendorId }) => vendorId).filter(Boolean));
  const selectedPolicyIds = new Set(index.matchingIds("control", selectedControlIds)
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
    resource: applicabilityResourceFacts(record, model, options),
    systems: index.matchingIds("system", selectedSystemIds)
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
    frameworks: index.matchingIds("framework", selectedFrameworkIds)
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
    vendors: index.matchingIds("vendor", selectedVendorIds)
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
    policies: index.matchingIds("policy", selectedPolicyIds)
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
    requirements: index.related("requirement", "frameworkId", selectedFrameworkIds)
      .filter(({ id }) => !scopedResource || !linkedRequirementIds.size || linkedRequirementIds.has(id))
      .sort(compareRecordIds)
      .map((requirement) => pick(requirement, ["id", "frameworkId", "reference", "description", "parentRequirementId"], model)),
    commitments: index.related("commitment", "systemIds", selectedSystemIds)
      .filter(({ status, controlIds, id }) => (
        !["retired", "superseded"].includes(status)
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

function applicabilityResourceFacts(record, model, options) {
  return calculationMemo(record, "scope-resource-projection", [model, Boolean(options.legacyDecisionScope), Boolean(options.legacyResourceProjection)], () =>
    applicabilityResourceFactsUncached(record, model, options));
}

function applicabilityResourceFactsUncached(record, model, options) {
  const fields = Number(model.modelVersion) >= 11 && !options.legacyResourceProjection
    ? (options.legacyDecisionScope ? legacyApplicabilityDecisionFields : applicabilityDecisionFields)[record.type] : null;
  if (!fields) return canonicalObject(model, record.type, Object.fromEntries(Object.entries(record)
    .filter(([field]) => !excludedResourceFields.has(field))));
  const value = Object.fromEntries(["id", "type", ...(options.legacyDecisionScope ? ["title"] : []), "externalIds", "extensions", ...fields]
    .filter((field) => record[field] !== undefined).map((field) => [field, record[field]]));
  value.unavailable = ["not-applicable", "retired", "superseded"].includes(record.status);
  return canonicalObject(model, record.type, value);
}

export function applicabilityReviewIsCurrent(review, record, program, resources, model, root = null, scopeIndex = null) {
  return calculationMemo(resources, "applicability-current", [JSON.stringify(review), record, program, model, root], () =>
    applicabilityReviewIsCurrentUncached(review, record, program, resources, model, root, scopeIndex));
}

function applicabilityReviewIsCurrentUncached(review, record, program, resources, model, root, scopeIndex) {
  if (
    review?.scopeRevision
    && !review.scopeRevision.startsWith("scope:")
    && !review.scopeRevision.startsWith("filegrc:applicability-scope:")
    && Number(model?.modelVersion || 0) < 7
  ) return true;
  if (!review?.scopeRevision) return false;
  if (Number(model.modelVersion) >= 11 && record?.type === "control"
    && (review.decision === "not-applicable") !== (record.status === "not-applicable")) return false;
  if (Number(model.modelVersion) >= 11 && ["retired", "superseded"].includes(record?.status)) return false;
  const revision = (options = {}) => applicabilityScopeRevision(record, program, resources, model, { ...options, scopeIndex });
  const current = revision();
  const matches = (revision) => revisionsMatch("applicability-scope", review.scopeRevision, revision);
  if (matches(current)) return true;
  // Model 12 adds schedule-set approval, but leaves applicability facts and
  // decision semantics unchanged. Re-evaluate the current facts with the
  // published v11 calculation, including its historical recovery paths.
  // Keep this bridge explicit: future models must establish equivalence before
  // accepting reviews from another version. Never rewrite the stored review.
  if (String(model.modelVersion) === "13" && applicabilityDecisionFields[record?.type]
    && applicabilityReviewIsCurrent(review, record, program, resources, compatibleModel12 ||= loadModel("12"), root, scopeIndex)) return true;
  if (String(model.modelVersion) === "12" && applicabilityDecisionFields[record?.type]
    && applicabilityReviewIsCurrent(review, record, program, resources, compatibleModel11 ||= loadModel("11"), root, scopeIndex)) return true;
  if (Number(model.modelVersion) >= 11 && matches(revision({
    legacyDecisionScope: true
  }))) return true;
  if (Number(model.modelVersion) >= 11 && applicabilityDecisionFields[record?.type]
    && matches(revision({ legacyDecisionScope: true, legacyResourceProjection: true }))) return true;
  if (Number(model.modelVersion) >= 11 && applicabilityDecisionFields[record?.type]
    && matches(revision({ legacyResourceProjection: true }))) return true;
  if (["commitment", "control", "complementary-control"].includes(record?.type) && matches(revision({ legacyDecisionScope: true, legacyBroadScope: true }
  ))) return true;
  if (Number(model.modelVersion) >= 11 && applicabilityDecisionFields[record?.type] && root && historicalScopedReviewMatches(
    review.scopeRevision, record, program, resources, model, root, current
  )) return true;
  // Older reviews hashed Policy approval metadata alongside scope facts.
  // Reconstruct each Policy independently because other Policies may already
  // have been approved when one Policy changes. Material fields stay current.
  for (const legacyPolicyStatus of ["current", "draft", "in-review", "approved", "active"]) {
    for (const legacyPolicyWithoutApprovalBinding of [false, true]) {
      for (const legacyPolicyWithoutEffectiveOn of [false, true]) {
        if (matches(revision({
          legacyPolicyStatus,
          legacyDecisionScope: true,
          legacyPolicyWithoutApprovalBinding,
          legacyPolicyWithoutEffectiveOn
        }))) return true;
      }
    }
  }
  const index = resourceIndex(resources);
  const selectedControlIds = new Set(program?.controlIds || []);
  const selectedPolicyIds = new Set(index.matchingIds("control", selectedControlIds)
    .flatMap(({ policyIds }) => policyIds || []));
  for (const id of record.policyIds || []) selectedPolicyIds.add(id);
  const policies = index.matchingIds("policy", selectedPolicyIds);
  // One Policy may advance while the others retain different approval states.
  // Reconstruct that Policy's former lifecycle fields without changing any
  // material scope fact or searching combinations of unrelated Policies.
  for (const policy of policies) {
    for (const value of legacyPolicyAlternatives(policy)) {
      if (matches(revision({
        legacyPolicyOverrides: { [policy.id]: value },
        legacyDecisionScope: true
      }))) return true;
    }
  }
  return false;
}

function historicalScopedReviewMatches(stored, record, program, resources, model, root, current) {
  const context = reviewHistoryContext(root, resources);
  const { index } = context;
  // The current projection is recalculated, so edits to the same resource array
  // cannot reuse a successful historical match for different material facts.
  const key = JSON.stringify([record.id, program?.id, model.modelVersion, current, stored]);
  context.applicabilityMatches ||= new Map();
  if (context.applicabilityMatches.has(key)) return context.applicabilityMatches.get(key);
  const remember = (result) => {
    context.applicabilityMatches.set(key, result);
    if (context.applicabilityMatches.size > 10_000) context.applicabilityMatches.delete(context.applicabilityMatches.keys().next().value);
    return result;
  };
  const commits = context.applicabilityCommits ||= index?.available
    ? reviewCommitsChangingTypes(index, scopeSourceTypes)
    : reviewHistoryCommits(context);
  for (const commit of [...commits].reverse()) {
    const snapshot = reviewHistoricalWorkspace(context, commit);
    if (!snapshot) continue;
    const historicalResources = snapshot.resources;
    const historicalRecord = snapshot.byId?.get(record.id)
      || historicalResources.find(({ id }) => id === record.id);
    const historicalProgram = snapshot.byId?.get(program?.id)
      || historicalResources.find(({ id }) => id === program?.id);
    if (!historicalRecord || !historicalProgram) continue;
    const historicalModel = snapshot.model;
    // Every applicability hash includes modelVersion. Cross-version review
    // equivalence uses the explicit compatibility bridge above; a projection
    // from another version cannot match this current-version scope.
    if (historicalModel.modelVersion !== model.modelVersion) continue;
    let indexes = historicalScopeIndexes.get(snapshot);
    if (!indexes) historicalScopeIndexes.set(snapshot, indexes = new Map());
    if (!indexes.has(historicalProgram)) indexes.set(historicalProgram,
      createApplicabilityScopeIndex(historicalResources, historicalProgram));
    const scopeIndex = indexes.get(historicalProgram);
    if (!revisionsMatch("applicability-scope", current, applicabilityScopeRevision(
      historicalRecord, historicalProgram, historicalResources, historicalModel, { scopeIndex }
    ))) continue;
    for (const legacyDecisionScope of [false, true]) {
      for (const legacyBroadScope of [false, true]) {
        for (const legacyResourceProjection of [false, true]) {
          if (revisionsMatch("applicability-scope", stored, applicabilityScopeRevision(
            historicalRecord, historicalProgram, historicalResources, historicalModel,
            { legacyDecisionScope, legacyBroadScope, legacyResourceProjection, scopeIndex }
          ))) return remember(true);
        }
      }
    }
  }
  return remember(false);
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
  return calculationMemo(record, "scope-field-projection", [model, objectType, fields.join(",")], () => pickUncached(record, fields, model, objectType));
}

function pickUncached(record, fields, model, objectType) {
  return canonicalObject(model, objectType || record.type, Object.fromEntries(fields
    .filter((field) => record?.[field] !== undefined)
    .map((field) => [field, record[field]])));
}

const canonicalScopeValues = new WeakSet();

function canonicalObject(model, type, value, revisionMap = false) {
  const resource = model.resources?.[type];
  const fields = resource?.fields || model.objectTypes?.[type]?.properties || {};
  const canonical = Object.fromEntries(Object.keys(value).sort().map((name) => [
    name,
    canonicalFieldValue(model, value[name], fields[name] ?? (resource ? model.commonFields?.[name] : undefined), name, revisionMap)
  ]));
  canonicalScopeValues.add(canonical);
  return canonical;
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
  // Shared canonical projections are immutable inside a read snapshot. Reuse
  // their exact serialized bytes across different scope and history checks.
  // Fresh aggregate containers are deliberately not retained here.
  return value && typeof value === "object" && canonicalScopeValues.has(value)
    ? calculationMemo(value, "serialized-scope-projection", [], () => stableJsonUncached(value))
    : stableJsonUncached(value);
}

function stableJsonUncached(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
