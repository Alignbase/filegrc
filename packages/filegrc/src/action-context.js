// Keep a short, source-backed inventory beside a derived next action. A link
// means a record exists; it never proves that the recorded process operated.
export function buildActionContext(loaded, item) {
  const records = loaded.resources;
  const byId = new Map(records.map((record) => [record.id, record]));
  const subjectId = item.subject?.id || item.resourceId;
  const subject = subjectId ? byId.get(subjectId) : null;
  const found = new Map();
  const add = (id, relationship) => {
    const record = byId.get(id);
    if (!record || found.has(id)) return;
    found.set(id, {
      type: record.type,
      id: record.id,
      title: record.title,
      status: record.status ?? null,
      relationship
    });
  };
  if (subject) add(subject.id, "subject");
  if (item.source?.id) add(item.source.id, "source");
  for (const id of item.sourceResourceIds || []) add(id, "source");
  for (const dependency of item.dependencies || []) if (dependency.id) add(dependency.id, "prerequisite");
  const matchingType = item.createResourceType || (!subject && (item.subject?.type || item.resourceType));
  const sameType = matchingType
    ? records.filter((record) => record.type === matchingType)
    : [];
  if (subject) {
    const fields = { ...loaded.model.commonFields, ...loaded.model.resources[subject.type]?.fields };
    for (const [name, definition] of Object.entries(fields)) {
      if (!definition?.relation) continue;
      const ids = Array.isArray(subject[name]) ? subject[name] : [subject[name]];
      for (const id of ids) if (typeof id === "string") add(id, name);
    }
    for (const record of records) {
      if (record.id === subject.id) continue;
      const incomingFields = { ...loaded.model.commonFields, ...loaded.model.resources[record.type]?.fields };
      for (const [name, definition] of Object.entries(incomingFields)) {
        if (!definition?.relation) continue;
        const ids = Array.isArray(record[name]) ? record[name] : [record[name]];
        if (ids.includes(subject.id)) add(record.id, name);
      }
    }
  }
  for (const record of sameType) add(record.id, "same-type-candidate");
  const existing = [...found.values()];
  const unmetChecks = item.unmetChecks || Object.entries(item.checks || {})
    .filter(([, passed]) => passed === false)
    .map(([name]) => name);
  return {
    workPhase: actionPhase(item),
    operation: item.createResourceType
      ? sameType.length ? "inspect-before-create" : "check-before-create"
      : subject ? "inspect-existing" : sameType.length ? "inspect-before-create" : "check-before-create",
    unmetChecks,
    existing: existing.slice(0, 20),
    existingCount: existing.length,
    existingTruncated: existing.length > 20,
    ...(matchingType ? { sameTypeCount: sameType.length } : {}),
    operationProof: "not-inferred-from-links",
    reminder: "Related records show current design or recorded work. Verify actual operation before claiming it occurred."
  };
}

function actionPhase(item) {
  if (item.assessment === "period-health" || ["run", "operation"].includes(item.stage)) return "operation";
  if (["audit-readiness", "delivery-readiness", "audit-closure"].includes(item.assessment) || item.stage === "audit") return "audit";
  if (item.assessment === "program-configuration" || ["scope", "policies", "controls"].includes(item.stage)) return "setup";
  return "record";
}
