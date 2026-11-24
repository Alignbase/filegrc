import { historicalAttachmentPaths, historicalJsonRecordPath } from "./historical-paths.js";
import { loadModel } from "../model/index.js";
import { getDataCommitHistory, getDataFilesAtRevision, getDataRecordHistoryIndex, getFileAtRevision } from "./git.js";
import { performance } from "node:perf_hooks";
import { calculationMemo } from "./calculation-cache.js";
import { revisionDigest } from "./revisions.js";

const reviewContexts = new WeakMap();
const indexedSources = new WeakMap();

// Only snapshots materialized from this index have an immutable identity.
export function indexedReviewSource(loaded) {
  return indexedSources.get(loaded);
}

export function reviewHistoryContext(root, owner) {
  const key = owner.resources || owner;
  let context = reviewContexts.get(key);
  if (context?.root === root) return context;
  let index = null;
  try {
    // Keep index construction bounded before the complete Git recovery path.
    index = getDataRecordHistoryIndex(root);
  } catch (error) {
    if (error.code !== "FILEGRC_HISTORY_DEADLINE") throw error;
  }
  context = {
    root, index, statesByCommit: new Map(), workspacesByCommit: new Map(),
    recordsBySource: new Map(), modelsByVersion: new Map()
  };
  reviewContexts.set(key, context);
  return context;
}

export function reviewHistoryCommits(context) {
  if (context.index?.available) return context.index.commits;
  if (context.index?.error?.code === "FILEGRC_INVALID_HISTORY_RECORD") return [];
  context.fallbackCommits ||= getDataCommitHistory(context.root);
  return context.fallbackCommits;
}

// Recovery still checks the same complete history, but first tries the Git
// basis where the stored binding entered the records. Only a full semantic and
// digest comparison by the caller can accept a binding.
export function prioritizeReviewCommits(context, kind, revision, commits) {
  if (!context.index?.available) return commits;
  const origins = calculationMemo(context.index, "review-binding-origins", [], () => {
    const result = new Map();
    const add = (kind, value, commit, basis) => {
      if (typeof value !== "string") return;
      const digest = revisionDigest(kind, value);
      const key = `${kind}:${digest}`;
      if (!digest || result.has(key) || result.size >= 20_000) return;
      result.set(key, [basis, ...(context.index.parentsByCommit.get(commit) || []), commit].filter(Boolean));
    };
    for (const commit of context.index.commits) {
      for (const { record } of context.index.recordsByCommit.get(commit)?.values() || []) {
        add("applicability-scope", record.applicabilityReview?.scopeRevision, commit);
        for (const review of Array.isArray(record.requirementApplicability) ? record.requirementApplicability : []) add("applicability-scope", review?.scopeRevision, commit);
        add("collection", record.collectionRevision, commit, record.scopeRevision);
        for (const revision of Object.values(record.reviewedSourceRevisions || {})) add("content", revision, commit);
      }
    }
    return result;
  });
  const available = new Set(commits);
  const preferred = [...new Set(origins.get(`${kind}:${revisionDigest(kind, revision)}`) || [])].filter(commit => available.has(commit));
  const selected = new Set(preferred);
  return [...preferred, ...commits.filter(commit => !selected.has(commit))];
}

export function reviewCommitsChangingTypes(index, types) {
  const paths = new Set();
  for (const records of index.recordsByCommit.values()) {
    for (const { record, path } of records.values()) {
      if (types.has(record.type)) paths.add(path);
    }
  }
  return index.commits.filter((commit) => [...(index.fileChangesByCommit.get(commit)?.keys() || [])]
    .some((path) => paths.has(path)));
}

export function reviewHistoricalWorkspace(context, commit) {
  if (context.index?.available) return indexedHistoricalWorkspace(context, commit);
  if (context.index?.error?.code === "FILEGRC_INVALID_HISTORY_RECORD") return null;
  if (context.workspacesByCommit.has(commit)) return context.workspacesByCommit.get(commit);
  const loaded = historicalWorkspace(context, commit);
  if (loaded) loaded.historicalCommit = commit;
  context.workspacesByCommit.set(commit, loaded);
  if (context.workspacesByCommit.size > 128) context.workspacesByCommit.delete(context.workspacesByCommit.keys().next().value);
  return loaded;
}

// Preserve recovery beyond the reconciliation index's size and build limits.
// It is slower, but still requires the same substantive comparison.
function historicalWorkspace(context, commit) {
  const { root } = context;
  const state = new Map(getDataFilesAtRevision(root, commit).filter(historicalJsonRecordPath)
    .map((path) => [path, getFileAtRevision(root, commit, path)]));
  const attachments = historicalAttachmentPaths(state, calculationMemo(context, "attachment-sources", [], () => new Map()));
  const entries = [];
  for (const [path, source] of state) {
    if (attachments.has(path)) continue;
    if (!source) return null;
    try {
      entries.push({ record: historicalRecord(context, source), source, relativePath: path.slice("data/".length) });
    } catch {
      return null;
    }
  }
  const resources = entries.map(({ record }) => record);
  const workspace = resources.find(({ type }) => type === "workspace");
  if (!workspace) return null;
  try {
    return { root, entries, resources, workspace, model: historicalModel(context, workspace.dataModelVersion),
      byId: new Map(resources.map((record) => [record.id, record])) };
  } catch {
    return null;
  }
}

// The history index already contains every committed JSON and Markdown source.
// Materialize its first-parent states once instead of asking Git to list and
// read the entire workspace for every legacy review binding.
export function indexedHistoricalWorkspace(context, commit) {
  const { root, index } = context;
  if (!index?.available || !index.parentsByCommit.has(commit)) return null;
  // Every reader of one immutable index shares its materializations. Separate
  // per-record contexts otherwise rebuild the same complete historical trees.
  const shared = calculationMemo(index, "historical-materialization-context", [], () => context);
  return materializeIndexedWorkspace(shared, commit);
}

function materializeIndexedWorkspace(context, commit) {
  const { root, index } = context;
  // Reuse a full request-sized history for ordinary workspaces while bounding
  // retained maps when a repository contains many thousands of data files.
  const cacheLimit = Math.max(1, Math.min(512, Math.floor(500_000 / Math.max(1, index.historicalRecordPaths.size))));
  if (context.workspacesByCommit.has(commit)) return context.workspacesByCommit.get(commit);
  let state = context.statesByCommit.get(commit);
  if (!state) {
    const lineage = [];
    let cursor = commit;
    while (cursor && !context.statesByCommit.has(cursor)) {
      lineage.push(cursor);
      cursor = index.parentsByCommit.get(cursor)?.[0] || null;
    }
    state = new Map(cursor ? context.statesByCommit.get(cursor) : []);
    for (let position = lineage.length - 1; position >= 0; position -= 1) {
      const changedAt = lineage[position];
      for (const [path, source] of index.fileChangesByCommit.get(changedAt) || []) {
        if (source === null) state.delete(path);
        else state.set(path, source);
      }
      if (position === 0 || position % 32 === 0) {
        context.statesByCommit.set(changedAt, position === 0 ? state : new Map(state));
        if (context.statesByCommit.size > cacheLimit) context.statesByCommit.delete(context.statesByCommit.keys().next().value);
      }
    }
  }
  const attachments = historicalAttachmentPaths(state, calculationMemo(context, "attachment-sources", [], () => new Map()));
  const entries = [];
  for (const [path, source] of state) {
    if (!historicalJsonRecordPath(path) || attachments.has(path)) continue;
    try {
      entries.push({ record: historicalRecord(context, source), source, relativePath: path.slice("data/".length) });
    } catch {
      return null;
    }
  }
  const resources = entries.map(({ record }) => record);
  const workspace = resources.find(({ type }) => type === "workspace");
  if (!workspace) return null;
  try {
    const loaded = {
      root, entries, resources, workspace, model: historicalModel(context, workspace.dataModelVersion),
      historicalCommit: commit, historicalFiles: state, byId: new Map(resources.map((record) => [record.id, record]))
    };
    indexedSources.set(loaded, index);
    context.workspacesByCommit.set(commit, loaded);
    if (context.workspacesByCommit.size > cacheLimit) context.workspacesByCommit.delete(context.workspacesByCommit.keys().next().value);
    return loaded;
  } catch {
    return null;
  }
}

function historicalRecord(context, source) {
  if (context.recordsBySource.has(source)) return context.recordsBySource.get(source);
  const record = JSON.parse(source);
  context.recordsBySource.set(source, record);
  if (context.recordsBySource.size > 200_000) context.recordsBySource.delete(context.recordsBySource.keys().next().value);
  return record;
}

function historicalModel(context, version) {
  const key = String(version);
  if (!context.modelsByVersion.has(key)) context.modelsByVersion.set(key, loadModel(version));
  return context.modelsByVersion.get(key);
}
