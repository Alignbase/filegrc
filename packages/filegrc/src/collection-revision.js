import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { modelSupports } from "../model/index.js";
import {
  authoritativeSourceRevisionValue,
  collectionRevisionInputs,
  collectionScopeRevisionFacts
} from "./collection-scope.js";
import { resolveDataPath } from "./paths.js";
import { resolveProgram } from "./program.js";
import { markdownEntries } from "./resource-markdown.js";
import { CALCULATED_REVISION_FIELDS, CALCULATED_REVISION_MAP_FIELDS, calculateRevision, canonicalCalculatedRevision, revisionsMatch } from "./revisions.js";

export function collectionRevision(loaded, resourceType, options = {}) {
  return calculateCollectionRevision(loaded, resourceType, options, false, options.scopeHashInput || "legacy", options.scopeFactsInput || "legacy");
}

export function legacyCollectionRevision(loaded, resourceType, options = {}) {
  return calculateCollectionRevision(loaded, resourceType, options, true, options.scopeHashInput || "legacy", options.scopeFactsInput || "legacy");
}

export function collectionRevisionMatches(loaded, resourceType, storedRevision, options = {}) {
  if (!storedRevision) return false;
  const currentRevision = options.currentRevision
    || collectionRevision(loaded, resourceType, options);
  // Accept both the pre-0.16 scope: input and the digest-only input used by
  // 0.16.0, as well as the older collection basis from 0.9.1.
  if (revisionsMatch("collection", storedRevision, currentRevision)) return true;
  const allowOlderBasis = resourceType !== "retention-schedule-item"
    || !modelSupports(loaded.model, "retention-schedule-approval");
  for (const olderBasis of [false, true]) {
    if (olderBasis && !allowOlderBasis) continue;
    for (const scopeHashInput of ["legacy", "digest"]) {
      for (const scopeFactsInput of ["legacy", "source"]) {
        if (!olderBasis && scopeHashInput === "legacy" && scopeFactsInput === "legacy") continue;
        if (revisionsMatch("collection", storedRevision, calculateCollectionRevision(
          loaded, resourceType, options, olderBasis, scopeHashInput, scopeFactsInput
        ))) return true;
      }
    }
  }
  return false;
}

function calculateCollectionRevision(loaded, resourceType, options, legacy, scopeHashInput = "legacy", scopeFactsInput = "legacy") {
  const workspaceWideRetentionReview = resourceType === "retention-schedule-item"
    && modelSupports(loaded.model, "retention-schedule-approval")
    && !legacy;
  const program = workspaceWideRetentionReview
    ? null
    : Object.hasOwn(options, "program")
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
        .update(JSON.stringify(canonicalRecordValue(loaded.model, record.type, value, scopeHashInput)))
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
  const scopeFacts = collectionScopeRevisionFacts(loaded, resourceType, program);
  const workspaceScope = scopeFactsInput === "source" ? scopeFacts : canonicalScopeFacts(scopeFacts);
  const source = JSON.stringify({ resourceType, records, workspaceScope });
  return legacy
    ? createHash("sha256").update(source).digest("hex")
    : calculateRevision("collection", source);
}

function canonicalScopeFacts(value, field = null) {
  if (Array.isArray(value)) return value.map((item) => canonicalScopeFacts(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, canonicalScopeFacts(item, key)]));
  }
  return field === "scopeRevision" && typeof value === "string"
    ? canonicalCalculatedRevision(value, field)
    : value;
}

function canonicalRecordValue(model, resourceType, value, scopeHashInput) {
  const fields = {
    ...model.commonFields,
    ...model.resources[resourceType]?.fields
  };
  return canonicalObject(model, value, fields, false, scopeHashInput);
}

function canonicalObject(model, value, fields = {}, revisionMap = false, scopeHashInput = "legacy") {
  return Object.fromEntries(Object.keys(value).sort().map((name) => [
    name,
    canonicalFieldValue(model, value[name], fields[name], name, revisionMap, scopeHashInput)
  ]));
}

function canonicalFieldValue(model, value, field, name, revisionMap = false, scopeHashInput = "legacy") {
  if (Array.isArray(value)) {
    const objectType = field?.itemObjectType;
    const itemFields = objectType ? model.objectTypes?.[objectType]?.properties : undefined;
    const items = value.map((item) => (
      item && typeof item === "object" && !Array.isArray(item)
        ? canonicalObject(model, item, itemFields, false, scopeHashInput)
        : item
    ));
    return field?.type === "array"
      ? items.sort(compareCanonicalValues)
      : items;
  }
  if (value && typeof value === "object") {
    const objectType = field?.objectType;
    return canonicalObject(model, value, objectType ? model.objectTypes?.[objectType]?.properties : undefined, CALCULATED_REVISION_MAP_FIELDS.has(name), scopeHashInput);
  }
  return typeof value === "string" && (revisionMap || CALCULATED_REVISION_FIELDS.has(name))
    ? canonicalCalculatedRevision(value, name, scopeHashInput)
    : value;
}

function compareCanonicalValues(left, right) {
  const leftValue = JSON.stringify(left);
  const rightValue = JSON.stringify(right);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}
