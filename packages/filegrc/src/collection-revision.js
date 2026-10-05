import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { modelSupports } from "../model/index.js";
import {
  authoritativeSourceRevisionValue,
  collectionRevisionInputs,
  collectionScopeRevisionFacts,
  scopedCollectionRecords
} from "./collection-scope.js";
import { resolveDataPath } from "./paths.js";
import { getFileAtRevision } from "./git.js";
import { reviewHistoricalWorkspace, reviewHistoryCommits, reviewHistoryContext } from "./historical-workspace.js";
import { resolveProgram } from "./program.js";
import { currentPartyPeople } from "./parties.js";
import { markdownEntries } from "./resource-markdown.js";
import { CALCULATED_REVISION_FIELDS, CALCULATED_REVISION_MAP_FIELDS, calculateRevision, canonicalCalculatedRevision, revisionDigest, revisionsMatch } from "./revisions.js";

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
  if (resourceType === "retention-schedule-item" && modelSupports(loaded.model, "retention-schedule-approval")
    && revisionsMatch("collection", storedRevision, calculateCollectionRevision(
      loaded, resourceType, { ...options, legacyRetentionSourceBasis: true }, false
    ))) return true;
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
  return historicallyEquivalentCollection(loaded, resourceType, storedRevision, options, currentRevision);
}

// Ordinary Collection Reviews record that setup was completed. Their original
// population remains evidence of what management reviewed at that time;
// subsequent operating records are assessed by their own workflows. The Data
// Retention Schedule is an approval of exact content and keeps its binding.
export function collectionReviewDecisionMatches(loaded, resourceType, review, records, options = {}) {
  if (!review) return false;
  if (resourceType === "retention-schedule-item" || Number(loaded.model.modelVersion) < 11) {
    return collectionRevisionMatches(loaded, resourceType, review.collectionRevision, options);
  }
  if (!revisionDigest("collection", review.collectionRevision) || review.status !== "active") return false;
  if (!originalCollectionReviewMatches(loaded, resourceType, review, options)) return false;
  if (review.decision === "zero-population") return records.length === 0;
  if (review.decision === "complete") return records.length > 0;
  if (review.decision === "externally-managed") {
    const id = review.authoritativeComponentId || review.authoritativeSystemId;
    return loaded.resources.some((record) => record.id === id && record.status === "active");
  }
  return collectionRevisionMatches(loaded, resourceType, review.collectionRevision, options);
}

function originalCollectionReviewMatches(loaded, resourceType, review, options) {
  const currentRevision = options.currentRevision || collectionRevision(loaded, resourceType, options);
  if (revisionsMatch("collection", review.collectionRevision, currentRevision)) {
    if (!review.populationResourceIds) return true;
    const program = options.program || resolveProgram(loaded, options.programId || review.scopeResourceIds?.[0]);
    const currentPopulation = scopedCollectionRecords(loaded, resourceType, program).map(({ id }) => id).sort();
    const reviewedPopulation = [...review.populationResourceIds].sort();
    return currentPopulation.length === reviewedPopulation.length
      && currentPopulation.every((id, index) => id === reviewedPopulation[index]);
  }
  if (!loaded.root || !review.scopeRevision) {
    return collectionRevisionMatches(loaded, resourceType, review.collectionRevision, { ...options, currentRevision });
  }
  const snapshot = reviewHistoricalWorkspace(reviewHistoryContext(loaded.root, loaded), review.scopeRevision);
  if (!snapshot) return false;
  const programId = options.programId || options.program?.id || review.scopeResourceIds?.[0];
  let program;
  try {
    program = resolveProgram(snapshot, programId);
  } catch {
    return false;
  }
  const currentProgram = resolveProgram(loaded, programId);
  const selectionField = {
    framework: "frameworkIds",
    system: "systemIds",
    component: "systemIds",
    control: "controlIds"
  }[resourceType];
  if (selectionField && JSON.stringify([...(program[selectionField] || [])].sort())
    !== JSON.stringify([...(currentProgram[selectionField] || [])].sort())) return false;
  const population = scopedCollectionRecords(snapshot, resourceType, program).map(({ id }) => id).sort();
  const reviewedPopulation = [...(review.populationResourceIds || [])].sort();
  if (review.populationResourceIds && (
    population.length !== reviewedPopulation.length
    || population.some((id, index) => id !== reviewedPopulation[index])
  )) return false;
  return collectionRevisionMatches(snapshot, resourceType, review.collectionRevision, {
    programId,
    authoritativeSourceId: options.authoritativeSourceId,
    historicalCommit: review.scopeRevision
  });
}

export function reviewedControlConflictIds(loaded, review) {
  const snapshot = loaded.root && /^[a-f0-9]{40,64}$/i.test(review?.scopeRevision || "")
    ? reviewHistoricalWorkspace(reviewHistoryContext(loaded.root, loaded), review.scopeRevision)
    : null;
  const source = snapshot || loaded;
  let program;
  try {
    program = resolveProgram(source, review.scopeResourceIds?.[0]);
  } catch {
    return [];
  }
  const controls = scopedCollectionRecords(source, "control", program);
  const controlIds = new Set(controls.map(({ id }) => id));
  const byId = new Map(source.resources.map((record) => [record.id, record]));
  const conflicts = new Set();
  for (const record of [
    ...controls,
    ...source.resources.filter((record) => record.type === "obligation"
      && record.status === "active"
      && (record.controlIds || []).some((id) => controlIds.has(id)))
  ]) {
    for (const id of currentPartyPeople(record.ownerIds || [], byId)) conflicts.add(id);
  }
  return [...conflicts].sort();
}

function historicallyEquivalentCollection(loaded, resourceType, stored, options, current) {
  if (!loaded.root) return false;
  const context = reviewHistoryContext(loaded.root, loaded);
  for (const commit of [...reviewHistoryCommits(context)].reverse()) {
    const snapshot = reviewHistoricalWorkspace(context, commit);
    if (!snapshot) continue;
    const historicalOptions = {
      ...options,
      programId: options.programId || options.program?.id,
      historicalCommit: commit
    };
    delete historicalOptions.program;
    delete historicalOptions.currentRevision;
    // Require the complete reviewed basis to be unchanged under the current
    // semantic calculation before accepting an older byte-sensitive digest.
    if (!revisionsMatch("collection", current, collectionRevision(snapshot, resourceType, historicalOptions))) continue;
    for (const legacyRetentionSourceBasis of resourceType === "retention-schedule-item" ? [false, true] : [false]) {
      for (const historicalReviewMetadata of legacyRetentionSourceBasis ? [false] : [true]) {
        for (const legacy of [false, true]) {
          for (const scopeHashInput of ["legacy", "digest"]) {
            for (const scopeFactsInput of ["legacy", "source"]) {
              if (revisionsMatch("collection", stored, calculateCollectionRevision(
                snapshot, resourceType, { ...historicalOptions, historicalReviewMetadata, legacyRetentionSourceBasis },
                legacy, scopeHashInput, scopeFactsInput
              ))) return true;
            }
          }
        }
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
  const inputs = new Map(collectionRevisionInputs(loaded, resourceType, program, {
    legacy,
    historicalReviewMetadata: options.historicalReviewMetadata,
    historicalCommit: options.historicalCommit,
    legacyRetentionSourceBasis: options.legacyRetentionSourceBasis
  })
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
          const content = options.historicalCommit
            ? loaded.historicalFiles
              ? loaded.historicalFiles.get(`data/${path}`) ?? null
              : getFileAtRevision(loaded.root, options.historicalCommit, `data/${path}`)
            : readFileSync(resolveDataPath(loaded.root, path), "utf8");
          if (content === null) return [];
          return [{ path, revision: createHash("sha256").update(content).digest("hex") }];
        } catch (error) {
          if (error.code === "ENOENT") return [];
          throw error;
        }
      })
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const scopeFacts = collectionScopeRevisionFacts(loaded, resourceType, program, {
    historicalReviewMetadata: options.historicalReviewMetadata
  });
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
