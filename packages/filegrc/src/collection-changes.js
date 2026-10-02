import { readFileSync } from "node:fs";
import { modelSupports } from "../model/index.js";
import { authoritativeSourceRevisionValue, collectionRevisionInputs, collectionScopeRevisionFacts, scopedCollectionRecords } from "./collection-scope.js";
import { collectionRevisionMatches } from "./collection-revision.js";
import { getFileAtRevision } from "./git.js";
import { reviewHistoricalWorkspace, reviewHistoryContext } from "./historical-workspace.js";
import { markdownEntries } from "./resource-markdown.js";
import { resolveProgram } from "./program.js";
import { resolveDataPath } from "./paths.js";
import { canonicalCalculatedRevision } from "./revisions.js";

export function collectionChangesSinceReview(loaded, resourceType, review, programId) {
  if (!/^[a-f0-9]{40,64}$/i.test(review?.scopeRevision || "") || !loaded.root) return unavailable("The reviewed Git snapshot is unavailable. Compare the current records with the prior review.");
  const before = reviewHistoricalWorkspace(reviewHistoryContext(loaded.root, loaded), review.scopeRevision);
  if (!before) return unavailable("The reviewed Git snapshot is unavailable. Compare the current records with the prior review.");
  const workspaceWide = resourceType === "retention-schedule-item"
    && modelSupports(loaded.model, "retention-schedule-approval");
  let priorProgram = null;
  let currentProgram = null;
  try {
    if (!workspaceWide) {
      priorProgram = resolveProgram(before, programId);
      currentProgram = resolveProgram(loaded, programId);
    }
  } catch {
    return unavailable("The reviewed Program could not be reconstructed. Compare the current scope with the prior review.");
  }
  if (!collectionRevisionMatches(before, resourceType, review.collectionRevision, {
    programId,
    historicalCommit: review.scopeRevision,
    authoritativeSourceId: review.authoritativeComponentId || review.authoritativeSystemId
  })) {
    return unavailable("The stored revision does not match the reviewed Git snapshot. Compare the current records with the prior review.");
  }
  const priorInputs = new Map(collectionRevisionInputs(before, resourceType, priorProgram)
    .map((input) => [input.record.id, input]));
  const currentInputs = new Map(collectionRevisionInputs(loaded, resourceType, currentProgram)
    .map((input) => [input.record.id, input]));
  const authoritativeSourceId = review.authoritativeComponentId || review.authoritativeSystemId;
  for (const [source, inputs] of [[before, priorInputs], [loaded, currentInputs]]) {
    const record = source.resources.find(({ id }) => id === authoritativeSourceId);
    if (record) inputs.set(record.id, {
      record,
      value: authoritativeSourceRevisionValue(record),
      includeContent: true
    });
  }
  const priorMembers = new Set(scopedCollectionRecords(before, resourceType, priorProgram).map(({ id }) => id));
  const currentMembers = new Set(scopedCollectionRecords(loaded, resourceType, currentProgram).map(({ id }) => id));
  const changes = [];
  for (const id of new Set([...priorInputs.keys(), ...currentInputs.keys()])) {
    const prior = priorInputs.get(id);
    const current = currentInputs.get(id);
    const record = current?.record || prior?.record;
    const fields = prior && current ? changedFields(prior.value, current.value, loaded.model, record.type) : [];
    const contentChanged = prior && current && (prior.includeContent || current.includeContent)
      ? changedContent(before, loaded, review.scopeRevision, prior.record, current.record)
      : false;
    const membershipChanged = priorMembers.has(id) !== currentMembers.has(id);
    if (!prior || !current || fields.length || contentChanged || membershipChanged) {
      changes.push({
        id,
        type: record.type,
        title: record.title || id,
        kind: !prior ? "added" : !current ? "removed" : "changed",
        fields,
        ...(contentChanged ? { contentChanged: true } : {}),
        ...(membershipChanged ? { membershipChanged: true } : {})
      });
    }
  }
  const scopeFields = changedFields(
    collectionScopeRevisionFacts(before, resourceType, priorProgram),
    collectionScopeRevisionFacts(loaded, resourceType, currentProgram),
    loaded.model,
    "program"
  );
  if (!changes.length && !scopeFields.length) {
    return unavailable("The stored revision does not match the reviewed Git snapshot. Compare the current records with the prior review.");
  }
  changes.sort((left, right) => left.type.localeCompare(right.type) || left.title.localeCompare(right.title) || left.id.localeCompare(right.id));
  const overview = [
    ...changes.slice(0, 3).map(describeChange),
    ...(changes.length > 3 ? [`${changes.length - 3} more changed records`] : []),
    ...(scopeFields.length ? [`Program scope (${scopeFields.join(", ")})`] : [])
  ].join("; ");
  const headlineParts = [
    ...changes.slice(0, 2).map(describeShortChange),
    ...(changes.length > 2 ? [`${changes.length - 2} more changed records`] : []),
    ...(scopeFields.length ? [`Program scope: ${scopeFields.slice(0, 2).join(", ")}${scopeFields.length > 2 ? ", more" : ""}`] : [])
  ];
  return {
    status: "available",
    summary: `Changed since the last review: ${overview}.`,
    headline: `${headlineParts.join("; ")}. Open the review for details.`,
    changes,
    scopeFields
  };
}

function unavailable(summary) {
  return { status: "unavailable", summary, headline: "Changes could not be reconstructed. Open the review for details.", changes: [], scopeFields: [] };
}

function describeChange(change) {
  const name = `${change.title} (${change.type})`;
  if (change.kind !== "changed") return `${name} ${change.kind === "added" ? "entered review scope" : "left review scope"}`;
  const details = [...change.fields, ...(change.contentChanged ? ["Markdown"] : []), ...(change.membershipChanged ? ["collection membership"] : [])];
  return `${name}: ${details.join(", ")}`;
}

function describeShortChange(change) {
  const name = change.title.length > 44 ? `${change.title.slice(0, 43)}…` : change.title;
  if (change.kind !== "changed") return `${name} ${change.kind === "added" ? "entered scope" : "left scope"}`;
  const details = [...change.fields, ...(change.contentChanged ? ["Markdown"] : []), ...(change.membershipChanged ? ["membership"] : [])];
  return `${name}: ${details.slice(0, 2).join(", ")}${details.length > 2 ? ", more" : ""}`;
}

function changedFields(before, after, model, type) {
  const definitions = { ...model.commonFields, ...model.resources[type]?.fields };
  return [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])]
    .filter((field) => !sameValue(before?.[field], after?.[field]))
    .map((field) => definitions[field]?.label || field.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\bIds\b/g, "IDs").replace(/^./, (letter) => letter.toUpperCase()));
}

function sameValue(left, right) {
  if (typeof left === "string" && typeof right === "string") {
    return canonicalCalculatedRevision(left) === canonicalCalculatedRevision(right);
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.every((value) => typeof value === "string") && right.every((value) => typeof value === "string")) {
      return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
    }
    return left.length === right.length && left.every((value, index) => sameValue(value, right[index]));
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    return [...keys].every((key) => sameValue(left[key], right[key]));
  }
  return left === right;
}

function changedContent(before, current, commit, priorRecord, currentRecord) {
  const priorPaths = markdownEntries(before.model, priorRecord).map(({ path }) => path);
  const currentPaths = markdownEntries(current.model, currentRecord).map(({ path }) => path);
  for (const path of new Set([...priorPaths, ...currentPaths])) {
    const priorSource = priorPaths.includes(path)
      ? before.historicalFiles?.get(`data/${path}`) ?? getFileAtRevision(before.root, commit, `data/${path}`)
      : null;
    let currentSource = null;
    if (currentPaths.includes(path)) {
      try { currentSource = readFileSync(resolveDataPath(current.root, path), "utf8"); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    if (priorSource !== currentSource) return true;
  }
  return false;
}
