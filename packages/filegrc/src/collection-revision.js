import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  collectionRevisionInputs,
  collectionScopeRevisionFacts
} from "./collection-scope.js";
import { resolveDataPath } from "./paths.js";
import { resolveProgram } from "./program.js";
import { markdownEntries } from "./resource-markdown.js";

export function collectionRevision(loaded, resourceType, options = {}) {
  const program = Object.hasOwn(options, "program")
    ? options.program
    : resolveProgram(loaded, options.programId);
  const inputs = new Map(collectionRevisionInputs(loaded, resourceType, program)
    .map((input) => [input.record.id, input]));
  const authoritativeSource = loaded.resources.find(({ id }) => id === options.authoritativeSourceId);
  if (authoritativeSource) {
    inputs.set(authoritativeSource.id, { record: authoritativeSource, value: authoritativeSource });
  }
  const records = [...inputs.values()]
    .map(({ record, value }) => ({
      id: record.id,
      revision: createHash("sha256")
        .update(JSON.stringify(canonicalRecordValue(loaded.model, record.type, value)))
        .digest("hex"),
      contentRevisions: markdownEntries(loaded.model, record).flatMap(({ path }) => {
        try {
          const content = readFileSync(resolveDataPath(loaded.root, path), "utf8");
          return [{ path, revision: createHash("sha256").update(content).digest("hex") }];
        } catch (error) {
          if (error.code === "ENOENT") return [];
          throw error;
        }
      })
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const workspaceScope = collectionScopeRevisionFacts(loaded, resourceType, program);
  return createHash("sha256")
    .update(JSON.stringify({ resourceType, records, workspaceScope }))
    .digest("hex");
}

function canonicalRecordValue(model, resourceType, value) {
  const fields = {
    ...model.commonFields,
    ...model.resources[resourceType]?.fields
  };
  return canonicalObject(model, value, fields);
}

function canonicalObject(model, value, fields = {}) {
  return Object.fromEntries(Object.keys(value).sort().map((name) => [
    name,
    canonicalFieldValue(model, value[name], fields[name])
  ]));
}

function canonicalFieldValue(model, value, field) {
  if (Array.isArray(value)) {
    const objectType = field?.itemObjectType;
    const itemFields = objectType ? model.objectTypes?.[objectType]?.properties : undefined;
    const items = value.map((item) => (
      item && typeof item === "object" && !Array.isArray(item)
        ? canonicalObject(model, item, itemFields)
        : item
    ));
    return field?.type === "array"
      ? items.sort(compareCanonicalValues)
      : items;
  }
  if (value && typeof value === "object") {
    const objectType = field?.objectType;
    return canonicalObject(model, value, objectType ? model.objectTypes?.[objectType]?.properties : undefined);
  }
  return value;
}

function compareCanonicalValues(left, right) {
  const leftValue = JSON.stringify(left);
  const rightValue = JSON.stringify(right);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}
