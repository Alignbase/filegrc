import { findResourceReferences } from "./agent.js";
import { resourceReviewRevision, resourceReviewRevisions, retentionReviewResourceIds } from "./retention.js";
import { loadWorkspace } from "./workspace.js";

const SOURCE_TYPES = new Set(["policy", "document", "framework", "requirement", "commitment"]);
const DIRECT_DEPENDENT_TYPES = new Set(["requirement", "commitment", "control", "requirement-mapping", "retention-schedule-item", "obligation"]);

export async function planProgramAmendment(input, options = {}) {
  const loaded = input?.resources && input?.model ? input : await loadWorkspace(input);
  const sourceId = options.sourceResourceId;
  const source = loaded.resources.find((record) => record.id === sourceId);
  if (!source) throw new Error(`Source resource "${sourceId}" was not found.`);
  if (!SOURCE_TYPES.has(source.type)) {
    throw new Error("A program amendment source must be a Policy, Document, Framework, Requirement, or Commitment.");
  }
  const direct = findResourceReferences(loaded, source.id).references.filter((reference) => DIRECT_DEPENDENT_TYPES.has(reference.type));
  const directById = new Map(direct.map((reference) => [reference.id, reference]));
  const reviewRevision = loaded.root ? await resourceReviewRevision(loaded, source.id) : null;
  const relatedIds = new Set([source.id, ...direct.map(({ id }) => id)]);
  const affectedRequirementIds = new Set([
    ...(source.type === "requirement" ? [source.id] : []),
    ...loaded.resources.filter((record) => relatedIds.has(record.id) && record.type === "requirement").map(({ id }) => id)
  ]);
  for (const record of loaded.resources) {
    if (record.type === "commitment" && (record.requirementIds || []).some((id) => affectedRequirementIds.has(id))) relatedIds.add(record.id);
    if (record.type === "requirement-mapping" && [...(record.sourceResourceIds || []), ...(record.targetResourceIds || [])].some((id) => affectedRequirementIds.has(id))) relatedIds.add(record.id);
  }
  const affectedCommitmentIds = new Set([
    ...(source.type === "commitment" ? [source.id] : []),
    ...loaded.resources.filter((record) => relatedIds.has(record.id) && record.type === "commitment").map(({ id }) => id)
  ]);
  const affectedControlIds = new Set([
    ...direct.filter(({ type }) => type === "control").map(({ id }) => id),
    ...(source.controlIds || []).filter((id) => loaded.resources.some((record) => record.id === id && record.type === "control"))
  ]);
  for (const id of affectedControlIds) relatedIds.add(id);
  for (const commitmentId of affectedCommitmentIds) {
    const commitment = loaded.resources.find(({ id }) => id === commitmentId);
    for (const id of [...(commitment?.systemIds || []), ...(commitment?.requirementIds || []), ...(commitment?.controlIds || [])]) relatedIds.add(id);
    for (const id of commitment?.controlIds || []) affectedControlIds.add(id);
  }
  for (const record of loaded.resources) {
    if (record.type === "requirement-mapping" && [...(record.sourceResourceIds || []), ...(record.targetResourceIds || [])].some((id) => affectedCommitmentIds.has(id))) relatedIds.add(record.id);
    if (record.type === "retention-schedule-item" && (record.sourceResourceIds || []).some((id) => affectedCommitmentIds.has(id))) relatedIds.add(record.id);
  }
  const primaryMappings = loaded.resources.filter((record) => record.type === "requirement-mapping" && relatedIds.has(record.id));
  for (const mapping of primaryMappings) {
    for (const id of [...(mapping.sourceResourceIds || []), ...(mapping.targetResourceIds || [])]) {
      relatedIds.add(id);
      if (loaded.resources.find((record) => record.id === id)?.type === "control") affectedControlIds.add(id);
    }
  }
  for (const record of loaded.resources) {
    if (record.type === "requirement" && relatedIds.has(record.id)) affectedRequirementIds.add(record.id);
  }
  for (const record of loaded.resources) {
    if (record.type === "control" && (record.requirementIds || []).some((id) => affectedRequirementIds.has(id))) {
      affectedControlIds.add(record.id);
      relatedIds.add(record.id);
    }
  }
  for (const record of loaded.resources) {
    if (record.type === "requirement-mapping" && (record.sourceResourceIds || []).some((id) => affectedControlIds.has(id))) {
      relatedIds.add(record.id);
      for (const id of [...(record.sourceResourceIds || []), ...(record.targetResourceIds || [])]) relatedIds.add(id);
    }
    if (record.type === "retention-schedule-item" && (record.sourceResourceIds || []).some((id) => affectedControlIds.has(id))) relatedIds.add(record.id);
    if (record.type === "obligation" && (record.controlIds || []).some((id) => affectedControlIds.has(id))) relatedIds.add(record.id);
  }
  const related = loaded.resources.filter((record) => relatedIds.has(record.id) && record.id !== source.id);
  const affected = related.map((record) => {
    const relationFields = ["sourceResourceIds", "targetResourceIds", "requirementIds", "systemIds", "controlIds", "policyIds", "scopeResourceIds"].filter((field) => (
      (record[field] || []).some((id) => relatedIds.has(id))
    ));
    const directReference = directById.get(record.id);
    return {
      type: record.type,
      id: record.id,
      title: record.title,
      status: record.status,
      field: relationFields.length === 1 ? relationFields[0] : directReference?.field || "transitive",
      ...(relationFields.length ? { relationFields } : {})
    };
  });
  const groups = {};
  for (const record of affected) (groups[record.type] ||= []).push(record);
  const missing = [];
  if (["policy", "document", "framework"].includes(source.type) && !(groups.commitment || []).length) {
    missing.push({
      resourceType: "commitment",
      message: "Record each externally or internally stated promise that changes the program scope or operating duties."
    });
  }
  if ((source.type === "commitment" || (groups.commitment || []).length) && !(groups["requirement-mapping"] || []).length) {
    missing.push({
      resourceType: "requirement-mapping",
      message: "Review how the source Commitments relate to existing Requirements and Controls. Do not assume full equivalence."
    });
  }
  const mappingSources = related
    .filter((record) => record.type === "requirement-mapping")
    .flatMap((record) => [...(record.sourceResourceIds || []), ...(record.targetResourceIds || [])]);
  const retentionSources = related
    .filter((record) => record.type === "retention-schedule-item")
    .flatMap((record) => retentionReviewResourceIds(record, loaded));
  const currentReviewRevisions = await resourceReviewRevisions(loaded, [
    source.id,
    ...mappingSources,
    ...retentionSources
  ]);
  const staleMappings = related.filter((record) => (
    record.type === "requirement-mapping"
    && record.status === "active"
    && reviewBindingsDiffer(
      [...new Set([...(record.sourceResourceIds || []), ...(record.targetResourceIds || [])])],
      record.reviewedSourceRevisions,
      currentReviewRevisions
    )
  ));
  if (staleMappings.length) {
    missing.push({
      resourceType: "requirement-mapping",
      resourceIds: staleMappings.map(({ id }) => id),
      message: "Re-review each affected mapping against the current source revision before relying on it."
    });
  }
  const retention = related.filter((record) => (
    record.type === "retention-schedule-item"
    && record.status === "active"
    && reviewBindingsDiffer(retentionReviewResourceIds(record, loaded), record.reviewedSourceRevisions, currentReviewRevisions)
  ));
  if (retention.length) {
    missing.push({
      resourceType: "retention-schedule-item",
      resourceIds: retention.map(({ id }) => id),
      message: "Re-review each affected retention item and bind it to the current source revision before treating it as active."
    });
  }
  return {
    schemaVersion: 1,
    source: {
      type: source.type,
      id: source.id,
      title: source.title,
      status: source.status,
      reviewRevision
    },
    currentReviewRevisions: Object.fromEntries(currentReviewRevisions),
    affected,
    byResourceType: Object.fromEntries(Object.entries(groups).map(([type, records]) => [type, records.map(({ id }) => id)])),
    reviewWork: missing,
    commands: [
      `npx filegrc references ${source.id} --json`,
      "npx filegrc guide commitment --json",
      "npx filegrc guide requirement-mapping --json",
      "npx filegrc guide retention-schedule-item --json",
      "npx filegrc program-readiness --json"
    ],
    principle: "The plan identifies affected records but never creates promises, mappings, retention periods, or deletion behavior without management review."
  };
}

function reviewBindingsDiffer(expectedIds, reviewed = {}, current) {
  const expected = new Set(expectedIds);
  if (Object.keys(reviewed).length !== expected.size) return true;
  return [...expected].some((id) => !current.get(id) || reviewed[id] !== current.get(id));
}

export async function assessProgramAmendmentReadiness(loaded) {
  if (!loaded.model.resources["requirement-mapping"]) return [];
  const byId = new Map(loaded.resources.map((record) => [record.id, record]));
  const commitments = loaded.resources.filter((record) => (
    record.type === "commitment" && !["superseded", "retired"].includes(record.status)
  ));
  const sourceIds = new Set(commitments.flatMap((record) => record.sourceResourceIds || []));
  for (const record of loaded.resources) {
    if (["policy", "document"].includes(record.type) && record.programRole === "supporting" && !["superseded", "retired"].includes(record.status)) {
      sourceIds.add(record.id);
    }
  }
  const sourceRecords = [...new Set([...sourceIds, ...commitments.map(({ id }) => id)])]
    .map((id) => byId.get(id))
    .filter((record) => record && SOURCE_TYPES.has(record.type));
  const plans = await Promise.all(sourceRecords.map((record) => (
    planProgramAmendment(loaded, { sourceResourceId: record.id })
  )));
  const items = [];
  for (const plan of plans) {
    for (const work of plan.reviewWork.filter((candidate) => (
      ["commitment", "requirement-mapping"].includes(candidate.resourceType)
      && !resourceIdsPresent(candidate, loaded)
    ))) {
      const id = `program-amendment-${plan.source.id}-${work.resourceType}`;
      if (items.some((item) => item.id === id)) continue;
      items.push({
        id,
        status: "action",
        title: work.resourceType === "commitment" ? `Record commitments from ${plan.source.title}` : `Map commitments affected by ${plan.source.title}`,
        message: work.message,
        resourceType: plan.source.type,
        resourceId: plan.source.id,
        createResourceType: work.resourceType,
        sourceResourceIds: work.resourceType === "commitment"
          ? [plan.source.id]
          : plan.byResourceType.commitment || (plan.source.type === "commitment" ? [plan.source.id] : []),
        commands: [
          `npx filegrc scaffold ${work.resourceType} --title ${shellArgument(work.resourceType === "commitment" ? `Commitment from ${plan.source.title}` : `Mapping for ${plan.source.title}`)}`,
          `npx filegrc program-amendment ${plan.source.id} --json`
        ]
      });
    }
  }
  return items;
}

function shellArgument(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function resourceIdsPresent(work, loaded) {
  return (work.resourceIds || []).some((id) => loaded.resources.some((record) => record.id === id));
}
