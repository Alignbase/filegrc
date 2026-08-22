import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  authoritativeSourceRevisionValue,
  collectionRevisionInputs,
  collectionScopeRevisionFacts
} from "./collection-scope.js";
import { resolveDataPath } from "./paths.js";
import { resolveProgram } from "./program.js";
import { markdownEntries } from "./resource-markdown.js";

export function collectionRevision(loaded, resourceType, options = {}) {
  return calculateCollectionRevision(loaded, resourceType, options, false);
}

export function legacyCollectionRevision(loaded, resourceType, options = {}) {
  return calculateCollectionRevision(loaded, resourceType, options, true);
}

export function collectionRevisionMatches(loaded, resourceType, storedRevision, options = {}) {
  if (!storedRevision) return false;
  const currentRevision = options.currentRevision
    || collectionRevision(loaded, resourceType, options);
  // Version 0.9.2 narrowed this hash basis. Keep unchanged 0.9.1 reviews valid
  // until management records a new review on the current basis.
  return storedRevision === currentRevision
    || storedRevision === legacyCollectionRevision(loaded, resourceType, options);
}

function calculateCollectionRevision(loaded, resourceType, options, legacy) {
  const program = Object.hasOwn(options, "program")
    ? options.program
    : resolveProgram(loaded, options.programId);
  const inputs = new Map(collectionRevisionInputs(loaded, resourceType, program, { legacy })
    .map((input) => [input.record.id, input]));
  const authoritativeSource = loaded.resources.find(({ id }) => id === options.authoritativeSourceId);
  if (authoritativeSource) {
    inputs.set(authoritativeSource.id, {
      record: authoritativeSource,
      value: legacy
        ? authoritativeSource
        : authoritativeSourceRevisionValue(authoritativeSource),
      includeContent: true
    });
  }
  const records = [...inputs.values()]
    .map(({ record, value, includeContent }) => ({
      id: record.id,
      revision: createHash("sha256")
        .update(JSON.stringify(canonicalRecordValue(loaded.model, record.type, value)))
        .digest("hex"),
      contentRevisions: (legacy || includeContent ? markdownEntries(loaded.model, record) : []).flatMap(({ path }) => {
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
