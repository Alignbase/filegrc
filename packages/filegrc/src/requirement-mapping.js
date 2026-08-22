import { resourceReviewRevisions } from "./retention.js";

export async function assessRequirementMappingReadiness(loaded) {
  if (!loaded.model.resources["requirement-mapping"]) return [];
  const mappings = loaded.resources.filter((record) => (
    record.type === "requirement-mapping" && !["superseded", "retired"].includes(record.status)
  ));
  const ids = mappings.flatMap((record) => [
    ...(record.sourceResourceIds || []),
    ...(record.targetResourceIds || [])
  ]);
  const revisions = await resourceReviewRevisions(loaded, ids);
  const byId = new Map(loaded.resources.map((record) => [record.id, record]));
  return mappings.map((mapping) => {
    const mappedIds = [...new Set([
      ...(mapping.sourceResourceIds || []),
      ...(mapping.targetResourceIds || [])
    ])];
    const staleIds = mappedIds.filter((id) => (
      !revisions.get(id) || mapping.reviewedSourceRevisions?.[id] !== revisions.get(id)
    )).concat(Object.keys(mapping.reviewedSourceRevisions || {}).filter((id) => !mappedIds.includes(id)));
    const structurallyComplete = mappingStructureIsComplete(mapping);
    const complete = mapping.status === "active" && structurallyComplete && staleIds.length === 0;
    return {
      id: `requirement-mapping-${mapping.id}`,
      status: complete ? "complete" : "action",
      title: complete ? `Mapping current: ${mapping.title}` : `Review mapping: ${mapping.title}`,
      message: mapping.status !== "active"
        ? "This mapping is still planned. Review both sides, choose the relationship and comparison method, and bind the current revisions before activation."
        : !structurallyComplete
          ? "This active mapping is incomplete. Add distinct source and target records, the relationship and method, a rationale, owners, reviewer, review date, and current revision bindings."
        : `This mapping no longer matches ${staleIds.length} mapped ${staleIds.length === 1 ? "record" : "records"}. Review it before relying on the stated relationship.`,
      resourceType: "requirement-mapping",
      resourceId: mapping.id,
      staleResourceIds: staleIds,
      commands: [
        `npx filegrc get ${mapping.id} --mutation`,
        `npx filegrc review-bindings ${mapping.id} --json`,
        ...staleIds
          .filter((id) => ["policy", "document", "framework", "requirement", "commitment"].includes(byId.get(id)?.type))
          .map((id) => `npx filegrc program-amendment ${id} --json`)
      ]
    };
  });
}

function mappingStructureIsComplete(mapping) {
  const sourceIds = [...new Set(mapping.sourceResourceIds || [])];
  const targetIds = [...new Set(mapping.targetResourceIds || [])];
  return sourceIds.length > 0
    && targetIds.length > 0
    && !sourceIds.some((id) => targetIds.includes(id))
    && ["equal-to", "equivalent-to", "subset-of", "superset-of", "intersects-with", "no-relationship"].includes(mapping.relationship)
    && ["syntactic", "semantic", "functional"].includes(mapping.method)
    && Boolean(String(mapping.rationale || "").trim())
    && (mapping.ownerIds || []).length > 0
    && (mapping.reviewedByIds || []).length > 0
    && Boolean(mapping.reviewedOn)
    && mapping.reviewedSourceRevisions
    && typeof mapping.reviewedSourceRevisions === "object";
}
