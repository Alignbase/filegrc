import { loadModel } from "../model/index.js";
import { getDataCommitHistory, getDataFilesAtRevision, getDataRecordHistoryIndex, getFileAtRevision } from "./git.js";
import { performance } from "node:perf_hooks";

const reviewContexts = new WeakMap();

export function reviewHistoryContext(root, owner) {
  const key = owner.resources || owner;
  let context = reviewContexts.get(key);
  if (context?.root === root) return context;
  let index = null;
  try {
    // Leave time for the original Git recovery path if this larger index
    // cannot be built within a browser request.
    index = getDataRecordHistoryIndex(root, { deadline: performance.now() + 3_000 });
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
  context.fallbackCommits ||= getDataCommitHistory(context.root);
  return context.fallbackCommits;
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
  if (context.workspacesByCommit.has(commit)) return context.workspacesByCommit.get(commit);
  const loaded = historicalWorkspace(context, commit);
  context.workspacesByCommit.set(commit, loaded);
  if (context.workspacesByCommit.size > 128) context.workspacesByCommit.delete(context.workspacesByCommit.keys().next().value);
  return loaded;
}

// Preserve recovery beyond the reconciliation index's size and build limits.
// It is slower, but still requires the same substantive comparison.
function historicalWorkspace(context, commit) {
  const { root } = context;
  const entries = [];
  for (const path of getDataFilesAtRevision(root, commit).filter(authoritativeJsonPath)) {
    const source = getFileAtRevision(root, commit, path);
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
  // Reuse a full request-sized history for ordinary workspaces while bounding
  // retained maps when a repository contains many thousands of data files.
  const cacheLimit = Math.max(1, Math.min(512, Math.floor(200_000 / Math.max(1, index.historicalRecordPaths.size))));
  if (context.workspacesByCommit.has(commit)) return context.workspacesByCommit.get(commit);
  let state = context.statesByCommit.get(commit);
  if (!state) {
    const lineage = [];
    let cursor = commit;
    while (cursor && !context.statesByCommit.has(cursor)) {
      lineage.push(cursor);
      cursor = index.parentsByCommit.get(cursor)?.[0] || null;
    }
    state = cursor ? context.statesByCommit.get(cursor) : new Map();
    for (let position = lineage.length - 1; position >= 0; position -= 1) {
      const changedAt = lineage[position];
      const next = new Map(state);
      for (const [path, source] of index.fileChangesByCommit.get(changedAt) || []) {
        if (source === null) next.delete(path);
        else next.set(path, source);
      }
      context.statesByCommit.set(changedAt, next);
      if (context.statesByCommit.size > cacheLimit) context.statesByCommit.delete(context.statesByCommit.keys().next().value);
      state = next;
    }
  }
  const entries = [];
  for (const [path, source] of state) {
    if (!authoritativeJsonPath(path)) continue;
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
      historicalFiles: state, byId: new Map(resources.map((record) => [record.id, record]))
    };
    context.workspacesByCommit.set(commit, loaded);
    if (context.workspacesByCommit.size > cacheLimit) context.workspacesByCommit.delete(context.workspacesByCommit.keys().next().value);
    return loaded;
  } catch {
    return null;
  }
}

function authoritativeJsonPath(path) {
  const parts = path.split("/");
  if (parts[0] !== "data" || !path.endsWith(".json")) return false;
  if (parts.slice(1).some((part) => part.startsWith(".") || part === "content")) return false;
  return !(parts[1] === "evidence" && parts.length > 3 && parts.at(-1) !== "evidence.json");
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
