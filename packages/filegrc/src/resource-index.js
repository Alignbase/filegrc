import { calculationMemo } from "./calculation-cache.js";

// Indexes belong to an explicit immutable calculation snapshot. Without one,
// rebuild so ordinary domain calls still observe edits to the supplied array.
export function resourceIndex(resources) {
  return calculationMemo(resources, "resource-index", [], () => createResourceIndex(resources));
}

export function createResourceIndex(resources) {
  const byId = new Map();
  const types = new Map();
  const typeIds = new Map();
  const relationships = new Map();
  for (const [position, record] of resources.entries()) {
    byId.set(record.id, record); // Match existing Map construction: last ID wins.
    if (!types.has(record.type)) types.set(record.type, []);
    types.get(record.type).push({ position, record });
  }
  const idsOfType = (type) => {
    if (!typeIds.has(type)) {
      const ids = new Map();
      for (const { record } of types.get(type) || []) {
        if (!ids.has(record.id)) ids.set(record.id, []);
        ids.get(record.id).push(record);
      }
      typeIds.set(type, ids);
    }
    return typeIds.get(type);
  };
  const ofType = (type) => (types.get(type) || []).map(({ record }) => record);
  const related = (type, path, ids) => {
    let fields = relationships.get(type);
    if (!fields) relationships.set(type, fields = new Map());
    let index = fields.get(path);
    if (!index) {
      fields.set(path, index = new Map());
      const segments = path.split(".");
      for (const row of types.get(type) || []) {
        let values = [row.record];
        for (const [depth, segment] of segments.entries()) {
          values = values.flatMap((value) => {
            const field = value?.[segment];
            return Array.isArray(field) ? field : field === undefined && depth < segments.length - 1 ? [] : [field];
          });
        }
        for (const value of new Set(values)) {
          if (!index.has(value)) index.set(value, []);
          index.get(value).push(row);
        }
      }
    }
    // A row may match several IDs. Deduplicate by array position, rather than
    // ID or object identity, preserving duplicate input rows and their order.
    const matches = new Map();
    for (const id of ids) for (const row of index.get(id) || []) matches.set(row.position, row.record);
    return [...matches.entries()].sort(([left], [right]) => left - right).map(([, record]) => record);
  };
  return { byId, ofType, related, idsOfType,
    matchingIds: (type, ids) => related(type, "id", ids) };
}
