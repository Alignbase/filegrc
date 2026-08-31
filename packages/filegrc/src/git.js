import { execFileSync, spawn } from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, readSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { devNull } from "node:os";
import { relative, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { isSafeGitName } from "./git-name.js";
import { serializeWorkspaceMutation, withDeferredWorkspaceValidation } from "./mutation.js";
import { isCanonicalDataPath, resolveWorkspaceRoot } from "./paths.js";
import { measureTiming, measureTimingSync, recordTiming, timingEnabled } from "./timing.js";
import { fingerprintWorkspace, validateWorkspace } from "./validate.js";
import { loadWorkspace } from "./workspace.js";

const lastSuccessfulSynchronizations = new Map();
const workspaceHistoryCache = new Map();
const dataRecordHistoryIndexCache = new Map();
let dataRecordHistoryIndexCacheBytes = 0;
const historicalFileCache = new Map();
const dataHistoryContextCache = new WeakMap();
const backgroundSynchronizations = new Map();
const browserRemotePrefetches = new Map();
const browserRemotePrefetchPromises = new Map();
const repositorySnapshotPromises = new Map();
const repositoryObjectFormats = new Map();
const gitCommandCaches = new AsyncLocalStorage();
const gitCommandDeadlines = new AsyncLocalStorage();
const gitCommandCacheBytes = new WeakMap();
let gitCommandInterceptor = null;
let gitSubprocessObserver = null;
let historicalBatchInterceptor = null;
let historicalRevisionReadObserver = null;
let workspaceBlobObjectIdOverride = null;
const BROWSER_REMOTE_PREFETCH_MAX_AGE_MS = 30_000;
const GIT_DEFAULT_TIMEOUT_MS = 10_000;
const GIT_REMOTE_TIMEOUT_MS = 30_000;
const GIT_MAX_OUTPUT_BYTES = 20_000_000;
const DATA_HISTORY_MAX_SOURCE_BYTES = 16 * 1024 * 1024;
const DATA_HISTORY_MAX_SOURCE_REQUESTS = 20_000;
const DATA_HISTORY_MAX_COMMITS = 5_000;
const DATA_HISTORY_MAX_CHANGES = 20_000;
const DATA_HISTORY_MAX_ANCESTRY_COMMITS = 20_000;
const DATA_HISTORY_CACHE_MAX_BYTES = 64 * 1024 * 1024;
const DATA_HISTORY_BUILD_TIMEOUT_MS = 10_000;
const DATA_HISTORY_FAILURE_CACHE_MS = 2_000;
const GIT_COMMAND_CACHE_MAX_ENTRIES = 128;
const GIT_COMMAND_CACHE_MAX_BYTES = 4 * 1024 * 1024;
const GIT_COMMAND_CACHE_MAX_ENTRY_BYTES = 512 * 1024;
export const BROWSER_VALIDATION = Symbol("filegrc.browserValidation");

export function withGitCommandCache(cache, callback) {
  if (!(cache instanceof Map)) throw new TypeError("The Git command cache must be a Map.");
  return gitCommandCaches.run(cache, callback);
}

export function withGitCommandDeadline(deadlineAt, callback) {
  if (!Number.isFinite(deadlineAt)) throw new TypeError("The Git command deadline must be finite.");
  return gitCommandDeadlines.run(deadlineAt, callback);
}

function gitEnvironment(overrides = {}) {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith("GIT_"))
    ),
    ...overrides,
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_GRAFT_FILE: devNull,
    GIT_NO_LAZY_FETCH: "1",
    GIT_ASKPASS: "",
    SSH_ASKPASS: "",
    SSH_ASKPASS_REQUIRE: "never",
    GIT_CONFIG_COUNT: "8",
    GIT_CONFIG_KEY_0: "core.fsmonitor",
    GIT_CONFIG_VALUE_0: "false",
    GIT_CONFIG_KEY_1: "core.hooksPath",
    GIT_CONFIG_VALUE_1: devNull,
    GIT_CONFIG_KEY_2: "protocol.ext.allow",
    GIT_CONFIG_VALUE_2: "never",
    GIT_CONFIG_KEY_3: "protocol.allow",
    GIT_CONFIG_VALUE_3: "never",
    GIT_CONFIG_KEY_4: "protocol.http.allow",
    GIT_CONFIG_VALUE_4: "always",
    GIT_CONFIG_KEY_5: "protocol.https.allow",
    GIT_CONFIG_VALUE_5: "always",
    GIT_CONFIG_KEY_6: "protocol.ssh.allow",
    GIT_CONFIG_VALUE_6: "always",
    GIT_CONFIG_KEY_7: "protocol.file.allow",
    GIT_CONFIG_VALUE_7: "always"
  };
}

export class GitOperationError extends Error {
  constructor(kind, operation, detail, options = {}) {
    const prefix = kind === "missing-executable"
      ? "Git is unavailable. Install Git and open this workspace from its authoritative repository checkout."
      : kind === "timeout"
        ? `Git timed out while trying to ${operation}.`
        : kind === "invalid-repository"
          ? `Git could not ${operation} because this workspace is not in a valid Git repository.`
          : `Git could not ${operation}.`;
    super(detail ? `${prefix} ${sanitizeGitErrorMessage(detail)}` : prefix, options);
    this.name = "GitOperationError";
    this.kind = kind;
    this.operation = operation;
    this.code = options.code;
  }
}

export function getGitSummary(input = process.cwd()) {
  const root = resolveWorkspaceRoot(input);
  try {
    const topLevel = measureTimingSync("git-discovery", () => git(root, ["rev-parse", "--show-toplevel"]));
    assertNoWorkspaceContentFilters(root);
    const status = git(root, ["status", "--porcelain=v1", "--", "."]);
    const commit = tryGit(root, ["rev-parse", "HEAD"]) || null;
    const branch = tryGit(root, ["symbolic-ref", "--short", "HEAD"]) || null;
    const upstream = branch ? tryGit(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]) || null : null;
    const remotes = lines(tryGit(root, ["remote"]));
    const last = commit ? parseLogLine(tryGit(root, ["log", "-1", "--format=%H%x1f%aI%x1f%an%x1f%s"])) : null;
    return {
      available: true,
      root: topLevel,
      commit,
      shortCommit: commit?.slice(0, 8) ?? "no commits",
      branch,
      upstream,
      remotes,
      clean: status === "",
      changes: status ? status.split("\n") : [],
      lastCommit: last
    };
  } catch (error) {
    if (error?.code === "FILEGRC_GIT_DEADLINE") throw error;
    return {
      available: false,
      clean: null,
      changes: [],
      message: "Git history is unavailable. Commit the workspace to enable audit metadata."
    };
  }
}

export function getFileHistory(input, relativePath, limit = 50) {
  const root = resolveWorkspaceRoot(input);
  if (!isSafeDataGitPath(relativePath)) return null;
  const indexed = indexedPathHistory(dataRecordHistoryIndexCache.get(root), relativePath);
  if (indexed) return limitedHistory(indexed, limit);
  try {
    const countArgs = Number(limit) >= Number.MAX_SAFE_INTEGER
      ? []
      : [`--max-count=${Math.max(1, Math.min(Number(limit) || 50, 200))}`];
    const output = git(root, [
      "log",
      "--follow",
      ...countArgs,
      "--format=%H%x1f%cI%x1f%an%x1f%s",
      "--",
      relativePath
    ]);
    if (!output) return [];
    return output.split("\n").map(parseLogLine);
  } catch (error) {
    rethrowGitDeadline(error);
    return null;
  }
}

export function getFileHistoryWithPaths(input, relativePath, limit = 50) {
  const root = resolveWorkspaceRoot(input);
  if (!isSafeDataGitPath(relativePath)) return null;
  const indexed = indexedPathHistory(dataRecordHistoryIndexCache.get(root), relativePath);
  if (indexed) return limitedHistory(indexed, limit);
  try {
    const countArgs = Number(limit) >= Number.MAX_SAFE_INTEGER
      ? []
      : [`--max-count=${Math.max(1, Math.min(Number(limit) || 50, 200))}`];
    const output = gitRaw(root, [
      "log",
      "--follow",
      "-z",
      ...countArgs,
      "--format=%H%x00%cI%x00%an%x00%s%x00",
      "--name-status",
      "-M",
      "--",
      relativePath
    ]);
    if (!output) return [];
    const tokens = output.split("\0");
    let trackedPath = relativePath;
    const history = [];
    let index = 0;
    while (index < tokens.length) {
      while (index < tokens.length && !/^[a-f0-9]{40}$/i.test(tokens[index].trim())) index += 1;
      if (index >= tokens.length) break;
      const summary = {
        commit: tokens[index++].trim(),
        timestamp: tokens[index++] || "",
        author: tokens[index++] || "",
        subject: tokens[index++] || ""
      };
      history.push({ ...summary, path: trackedPath });
      while (index < tokens.length && !/^[a-f0-9]{40}$/i.test(tokens[index].trim())) {
        const status = tokens[index++].trim();
        if (!status) continue;
        const oldPath = tokens[index++] || "";
        if (status.startsWith("R") || status.startsWith("C")) {
          const newPath = tokens[index++] || "";
          if (status.startsWith("R") && newPath === trackedPath) trackedPath = oldPath;
        }
      }
    }
    return history;
  } catch (error) {
    rethrowGitDeadline(error);
    return null;
  }
}

export function getFilePathAtRevision(input, relativePath, revision) {
  const root = resolveWorkspaceRoot(input);
  if (!isSafeDataGitPath(relativePath) || !/^[a-f0-9]{40}$/i.test(String(revision || ""))) return null;
  const index = dataRecordHistoryIndexCache.get(root);
  const indexed = indexedPathHistory(index, relativePath);
  if (indexed) {
    return indexed.find(({ commit }) => indexedAncestor(index, commit, revision))?.path || null;
  }
  const history = getFileHistoryWithPaths(root, relativePath, Number.MAX_SAFE_INTEGER) || [];
  const summary = history.find(({ commit }) => commit === revision)
    || history.find(({ commit }) => isDataHistoryAncestor(root, commit, revision));
  return summary?.path || null;
}

export function getDataCommitHistory(input) {
  const root = resolveWorkspaceRoot(input);
  try {
    return lines(git(root, ["log", "--reverse", "--format=%H", "--", "data"]));
  } catch (error) {
    rethrowGitDeadline(error);
    return [];
  }
}

export function getChangedDataJsonFilesAtRevision(input, revision) {
  if (!/^[a-f0-9]{40}$/i.test(String(revision))) return [];
  const root = resolveWorkspaceRoot(input);
  try {
    const topLevel = git(root, ["rev-parse", "--show-toplevel"]);
    const workspacePrefix = relative(topLevel, root).split(sep).join("/");
    if (workspacePrefix === ".." || workspacePrefix.startsWith("../")) return [];
    const dataPrefix = workspacePrefix ? `${workspacePrefix}/data` : "data";
    const output = git(root, [
      "diff-tree", "--root", "--no-commit-id", "--name-status", "-M", "-m", "-r", revision, "--", dataPrefix
    ]);
    const paths = [];
    for (const line of lines(output)) {
      const [status, first, second] = line.split("\t");
      if (status === "D") continue;
      const repositoryPath = status?.startsWith("R") || status?.startsWith("C") ? second : first;
      if (!repositoryPath?.startsWith(`${dataPrefix}/`) || !repositoryPath.endsWith(".json")) continue;
      paths.push(workspacePrefix ? repositoryPath.slice(workspacePrefix.length + 1) : repositoryPath);
    }
    return [...new Set(paths)];
  } catch (error) {
    rethrowGitDeadline(error);
    return [];
  }
}

export function getRecordIdentityHistory(input, id) {
  return getRecordIdentityHistories(input, [id]).get(id) || [];
}

export function getRecordIdentityHistories(input, ids) {
  const index = getDataRecordHistoryIndex(input);
  return new Map([...new Set(ids)].map((id) => [id, index.historiesById.get(id) || []]));
}

export function getDataRecordHistoryIndex(input, options = {}) {
  const root = resolveWorkspaceRoot(input);
  const cached = dataRecordHistoryIndexCache.get(root);
  const suppliedHead = /^[a-f0-9]{40}$/i.test(String(options.head)) ? String(options.head) : undefined;
  if (
    suppliedHead
    && cached?.head === suppliedHead
    && !cached.available
    && cached.failureExpiresAt > performance.now()
  ) return cached;
  if (suppliedHead && cached?.head === suppliedHead && cached.available) return cached;
  const hasDeadline = options.deadline !== undefined;
  const deadline = hasDeadline ? Number(options.deadline) : performance.now() + DATA_HISTORY_BUILD_TIMEOUT_MS;
  if (!Number.isFinite(deadline) || deadline <= performance.now()) {
    const error = new Error("Git data history exceeded its cumulative time limit.");
    error.code = "FILEGRC_HISTORY_DEADLINE";
    throw error;
  }
  const remainingTime = () => {
    const remainingMs = Math.floor(deadline - performance.now());
    if (remainingMs <= 0) {
      const error = new Error("Git data history exceeded its cumulative time limit.");
      error.code = "FILEGRC_HISTORY_DEADLINE";
      throw error;
    }
    return remainingMs;
  };
  const historyGit = (args) => git(root, args, { timeoutMs: remainingTime() });
  const historyGitRaw = (args) => gitRaw(root, args, { timeoutMs: remainingTime() });
  let head = null;
  let discoveryError = null;
  if (suppliedHead) {
    head = suppliedHead;
  } else {
    try {
      head = historyGit(["rev-parse", "HEAD"]) || null;
    } catch (cause) {
      rethrowGitDeadline(cause);
      discoveryError = cause;
    }
  }
  if (cached?.head === head && cached.available) return cached;
  if (cached) {
    dataRecordHistoryIndexCache.delete(root);
    dataRecordHistoryIndexCacheBytes -= cached.cacheBytes || 0;
  }
  const changes = [];
  const sourceChanges = [];
  const changesByCommit = new Map();
  let shallow = false;
  if (head) {
    try {
      shallow = historyGit(["rev-parse", "--is-shallow-repository"]) === "true";
    } catch (cause) {
      rethrowGitDeadline(cause);
      discoveryError = cause;
    }
  }
  let available = Boolean(head) && !shallow;
  let error = discoveryError || (!head
    ? new Error("Git history is unavailable because the workspace has no committed HEAD.")
    : shallow ? new Error("Git history is shallow.") : null);
  if (discoveryError) available = false;
  try {
    if (available) {
      const output = historyGitRaw([
        "log", "--topo-order", "--reverse", "--diff-merges=first-parent", "-z", "--relative",
        "--format=%H%x00%cI%x00%an%x00%s%x00", "--name-status", "-M", head, "--", "data"
      ]);
      const parsed = parseDataRecordHistory(output);
      if (parsed.commitCount > DATA_HISTORY_MAX_COMMITS || parsed.changes.length > DATA_HISTORY_MAX_CHANGES) {
        throw dataHistoryLimitError("Git data history is too large to reconcile safely.");
      }
      changes.push(...parsed.recordChanges);
      sourceChanges.push(...parsed.sourceChanges);
      for (const change of parsed.changes) {
        if (!changesByCommit.has(change.summary.commit)) changesByCommit.set(change.summary.commit, []);
        changesByCommit.get(change.summary.commit).push(change);
      }
    }
  } catch (cause) {
    rethrowGitDeadline(cause);
    available = false;
    error = cause;
  }
  let sources = [];
  if (available) {
    try {
      sources = getFilesAtRevisions(
        root,
        sourceChanges.map(({ summary, path }) => ({ revision: summary.commit, relativePath: path })),
        {
          batchSize: 512,
          maxRequests: DATA_HISTORY_MAX_SOURCE_REQUESTS,
          maxTotalBytes: DATA_HISTORY_MAX_SOURCE_BYTES,
          deadline
        }
      );
    } catch (cause) {
      rethrowGitDeadline(cause);
      available = false;
      error = cause;
    }
  }
  if (head && sources.some((source) => source === null)) {
    available = false;
    error ||= new Error("Git could not read every historical data record.");
  }
  const recordsByCommit = new Map();
  const historiesById = new Map();
  const fileChangesByCommit = new Map();
  const historicalRecordPaths = new Set();
  const sourceByCommitAndPath = new Map();
  sourceChanges.forEach(({ summary, path }, index) => {
    sourceByCommitAndPath.set(`${summary.commit}\0${path}`, sources[index]);
  });
  for (const [commit, commitChanges] of changesByCommit) {
    const fileChanges = new Map();
    for (const change of commitChanges) {
      if (change.beforePath?.match(/\.(?:json|md)$/) && change.beforePath !== change.afterPath) {
        if (change.beforePath.endsWith(".json")) historicalRecordPaths.add(change.beforePath);
        fileChanges.set(change.beforePath, null);
      }
      if (change.afterPath?.match(/\.(?:json|md)$/)) {
        if (change.afterPath.endsWith(".json")) historicalRecordPaths.add(change.afterPath);
        fileChanges.set(change.afterPath, sourceByCommitAndPath.get(`${commit}\0${change.afterPath}`) ?? null);
      }
    }
    fileChangesByCommit.set(commit, fileChanges);
  }
  for (let index = 0; index < changes.length; index += 1) {
    const { summary, path } = changes[index];
    try {
      const record = JSON.parse(sourceByCommitAndPath.get(`${summary.commit}\0${path}`));
      if (!record || Array.isArray(record) || typeof record.id !== "string" || typeof record.type !== "string") {
        throw new Error("Historical data records require string IDs and types.");
      }
      if (!recordsByCommit.has(summary.commit)) recordsByCommit.set(summary.commit, new Map());
      if (recordsByCommit.get(summary.commit).has(record.id)) {
        throw new Error(`Historical data records reuse ID "${record.id}" in one commit.`);
      }
      recordsByCommit.get(summary.commit).set(record.id, { record, path });
      if (!historiesById.has(record.id)) historiesById.set(record.id, []);
      historiesById.get(record.id).push({ ...summary, path });
    } catch (cause) {
      rethrowGitDeadline(cause);
      available = false;
      error = new Error(`Git history contains an unreadable data record at ${summary.commit.slice(0, 12)}:${path}.`, { cause });
      break;
    }
  }
  const parentsByCommit = new Map();
  if (available) {
    try {
      for (const line of lines(historyGit(["rev-list", "--parents", head]))) {
        const [commit, ...parents] = line.split(" ");
        if (!/^[a-f0-9]{40}$/i.test(commit) || parents.some((parent) => !/^[a-f0-9]{40}$/i.test(parent))) {
          throw new Error("Git returned invalid commit ancestry.");
        }
        parentsByCommit.set(commit, parents);
        if (parentsByCommit.size > DATA_HISTORY_MAX_ANCESTRY_COMMITS) {
          throw dataHistoryLimitError("Git ancestry is too large to reconcile safely.");
        }
      }
      if (!parentsByCommit.has(head) || [...changesByCommit.keys()].some((commit) => !parentsByCommit.has(commit))) {
        throw new Error("Git returned incomplete commit ancestry.");
      }
    } catch (cause) {
      rethrowGitDeadline(cause);
      available = false;
      error = cause;
    }
  }
  for (const [id, history] of historiesById) {
    history.reverse();
    const seen = new Set();
    historiesById.set(id, history.filter(({ commit, path }) => {
      const key = `${commit}\u0000${path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }));
  }
  const result = {
    head,
    available,
    error,
    commits: available ? [...changesByCommit.keys()] : [],
    changesByCommit: available ? changesByCommit : new Map(),
    parentsByCommit: available ? parentsByCommit : new Map(),
    fileChangesByCommit: available ? fileChangesByCommit : new Map(),
    historicalRecordPaths: available ? historicalRecordPaths : new Set(),
    recordsByCommit: available ? recordsByCommit : new Map(),
    historiesById: available ? historiesById : new Map(),
    sourceBytes: available
      ? sources.reduce((total, source) => total + (typeof source === "string" ? Buffer.byteLength(source, "utf8") : 0), 0)
      : 0,
    ancestryCache: new Map(),
    indexedFileCache: new Map()
  };
  result.failureExpiresAt = available ? null : performance.now() + DATA_HISTORY_FAILURE_CACHE_MS;
  result.estimatedBytes = available
    ? result.sourceBytes * 3
      + [...result.changesByCommit.values()].reduce((total, commitChanges) => total + commitChanges.length * 512, 0)
      + result.parentsByCommit.size * 256
      + [...result.historiesById.values()].reduce((total, history) => total + history.length * 128, 0)
    : 512 + Buffer.byteLength(error?.message || "", "utf8");
  result.cacheBytes = result.estimatedBytes;
  if (result.estimatedBytes <= DATA_HISTORY_CACHE_MAX_BYTES) {
    dataRecordHistoryIndexCache.set(root, result);
    dataRecordHistoryIndexCacheBytes += result.cacheBytes;
  }
  if (dataRecordHistoryIndexCache.has(root)) {
    while (dataRecordHistoryIndexCache.size > 4 || dataRecordHistoryIndexCacheBytes > DATA_HISTORY_CACHE_MAX_BYTES) {
      const oldestRoot = dataRecordHistoryIndexCache.keys().next().value;
      const oldest = dataRecordHistoryIndexCache.get(oldestRoot);
      dataRecordHistoryIndexCache.delete(oldestRoot);
      dataRecordHistoryIndexCacheBytes -= oldest?.cacheBytes || 0;
    }
  }
  return result;
}

function parseDataRecordHistory(output) {
  const fields = output.split("\0");
  const changes = [];
  const recordChanges = [];
  const sourceChanges = [];
  const commits = new Set();
  let index = 0;
  while (index < fields.length) {
    while (fields[index] === "") index += 1;
    const commit = fields[index++];
    if (commit === undefined) break;
    if (!/^[a-f0-9]{40}$/i.test(commit)) throw new Error("Git returned an invalid data-history commit.");
    const timestamp = fields[index++];
    const author = fields[index++];
    const subject = fields[index++];
    if (timestamp === undefined || author === undefined || subject === undefined) {
      throw new Error("Git returned an incomplete data-history header.");
    }
    const summary = { commit, shortCommit: commit.slice(0, 8), timestamp, author, subject };
    if (commits.has(commit)) throw new Error("Git returned duplicate data-history commit output.");
    commits.add(commit);
    while (index < fields.length) {
      while (fields[index] === "") index += 1;
      const rawStatus = fields[index];
      if (rawStatus === undefined || /^[a-f0-9]{40}$/i.test(rawStatus)) break;
      const status = rawStatus.replace(/^\n+/, "");
      if (!/^(?:[ACDMRTUXB]|R\d{1,3}|C\d{1,3})$/.test(status)) {
        throw new Error("Git returned an invalid data-history status.");
      }
      index += 1;
      const first = fields[index++];
      const renamed = status.startsWith("R") || status.startsWith("C");
      const second = renamed ? fields[index++] : null;
      if (!first || (renamed && !second)) throw new Error("Git returned an incomplete data-history path.");
      const beforePath = status === "A" ? null : first;
      const afterPath = status === "D" ? null : renamed ? second : first;
      for (const path of [beforePath, afterPath].filter(Boolean)) {
        if (!isSafeDataGitPath(path)) throw new Error("Git returned an unsafe data-history path.");
      }
      const change = { summary, status, beforePath, afterPath };
      changes.push(change);
      if (afterPath?.endsWith(".json")) {
        recordChanges.push({ summary, path: afterPath });
      }
      if (afterPath?.endsWith(".json") || afterPath?.endsWith(".md")) {
        sourceChanges.push({ summary, path: afterPath });
      }
    }
  }
  return { changes, recordChanges, sourceChanges, commitCount: commits.size };
}

function indexedPathHistory(index, relativePath) {
  if (!index?.available) return null;
  for (const history of index.historiesById.values()) {
    if (history[0]?.path === relativePath) return history;
  }
  return null;
}

function limitedHistory(history, limit) {
  if (Number(limit) >= Number.MAX_SAFE_INTEGER) return history;
  return history.slice(0, Math.max(1, Math.min(Number(limit) || 50, 200)));
}

function indexedDataFile(index, revision, relativePath) {
  if (
    !index?.available
    || !relativePath?.match(/\.(?:json|md)$/)
    || !index.parentsByCommit.has(revision)
  ) return undefined;
  const key = `${revision}\0${relativePath}`;
  if (index.indexedFileCache.has(key)) return index.indexedFileCache.get(key);
  let commit = revision;
  let source = null;
  while (commit) {
    const changes = index.fileChangesByCommit.get(commit);
    if (changes?.has(relativePath)) {
      source = changes.get(relativePath);
      break;
    }
    commit = index.parentsByCommit.get(commit)?.[0] || null;
  }
  index.indexedFileCache.set(key, source);
  while (index.indexedFileCache.size > 20_000) index.indexedFileCache.delete(index.indexedFileCache.keys().next().value);
  return source;
}

function indexedAncestor(index, ancestor, descendant) {
  if (ancestor === descendant) return true;
  const key = `${ancestor}\0${descendant}`;
  if (index.ancestryCache.has(key)) return index.ancestryCache.get(key);
  const pending = [descendant];
  const visited = new Set();
  let result = false;
  while (pending.length) {
    const commit = pending.pop();
    if (commit === ancestor) {
      result = true;
      break;
    }
    if (visited.has(commit)) continue;
    visited.add(commit);
    pending.push(...(index.parentsByCommit.get(commit) || []));
  }
  index.ancestryCache.set(key, result);
  while (index.ancestryCache.size > 20_000) index.ancestryCache.delete(index.ancestryCache.keys().next().value);
  return result;
}

export function isGitAncestor(input, ancestor, descendant) {
  if (!/^[a-f0-9]{40}$/i.test(String(ancestor)) || !/^[a-f0-9]{40}$/i.test(String(descendant))) return false;
  const root = resolveWorkspaceRoot(input);
  try {
    observedExecFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
      cwd: root,
      stdio: "ignore",
      timeout: 10_000,
      env: gitEnvironment()
    });
    return true;
  } catch (error) {
    rethrowGitDeadline(error);
    return false;
  }
}

export function isDataHistoryAncestor(input, ancestor, descendant) {
  const context = input && typeof input === "object" ? input : null;
  const root = resolveWorkspaceRoot(context?.root || input);
  let index = context ? dataHistoryContextCache.get(context) : null;
  if (!index) {
    index = getDataRecordHistoryIndex(root);
    if (context) dataHistoryContextCache.set(context, index);
  }
  if (!index.available || !index.parentsByCommit.has(descendant)) {
    return isGitAncestor(root, ancestor, descendant);
  }
  return indexedAncestor(index, ancestor, descendant);
}

export function getFileBufferAtRevision(input, revision, relativePath) {
  if (!/^[a-f0-9]{40}$/i.test(String(revision)) || !isSafeDataGitPath(relativePath)) return null;
  const root = resolveWorkspaceRoot(input);
  try {
    const topLevel = git(root, ["rev-parse", "--show-toplevel"]);
    const workspacePrefix = relative(topLevel, root).split(sep).join("/");
    if (workspacePrefix === ".." || workspacePrefix.startsWith("../")) return null;
    const repositoryPath = workspacePrefix ? `${workspacePrefix}/${relativePath}` : relativePath;
    return observedExecFileSync("git", ["show", `${revision}:${repositoryPath}`], {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
      maxBuffer: 20_000_000,
      env: gitEnvironment()
    });
  } catch (error) {
    rethrowGitDeadline(error);
    return null;
  }
}

export function getFileObjectIdAtRevision(input, revision, relativePath) {
  if (!/^[a-f0-9]{40}$/i.test(String(revision)) || !isSafeDataGitPath(relativePath)) return null;
  const root = resolveWorkspaceRoot(input);
  try {
    const topLevel = git(root, ["rev-parse", "--show-toplevel"]);
    const workspacePrefix = relative(topLevel, root).split(sep).join("/");
    if (workspacePrefix === ".." || workspacePrefix.startsWith("../")) return null;
    const repositoryPath = workspacePrefix ? `${workspacePrefix}/${relativePath}` : relativePath;
    const objectId = git(root, ["rev-parse", `${revision}:${repositoryPath}`]);
    return /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i.test(objectId) ? objectId : null;
  } catch (error) {
    rethrowGitDeadline(error);
    return null;
  }
}

export function getWorkingFileObjectId(input, relativePath) {
  if (!isSafeDataGitPath(relativePath)) return null;
  const root = resolveWorkspaceRoot(input);
  let descriptor;
  try {
    const objectFormat = repositoryObjectFormat(root);
    if (!objectFormat) return null;
    descriptor = openSync(resolve(root, relativePath), constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const before = fstatSync(descriptor);
    if (!before.isFile()) return null;
    const hash = createHash(objectFormat).update(`blob ${before.size}\0`);
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    while (position < before.size) {
      const count = readSync(descriptor, buffer, 0, Math.min(buffer.length, before.size - position), position);
      if (!count) return null;
      hash.update(buffer.subarray(0, count));
      position += count;
    }
    const after = fstatSync(descriptor);
    if (
      after.size !== before.size
      || after.dev !== before.dev
      || after.ino !== before.ino
      || after.mtimeMs !== before.mtimeMs
      || after.ctimeMs !== before.ctimeMs
    ) return null;
    return hash.digest("hex");
  } catch (error) {
    rethrowGitDeadline(error);
    return null;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function repositoryObjectFormat(root) {
  if (repositoryObjectFormats.has(root)) return repositoryObjectFormats.get(root);
  if (!tryGit(root, ["rev-parse", "--git-dir"])) return null;
  const objectFormat = tryGit(root, ["config", "--get", "extensions.objectFormat"]) || "sha1";
  if (!["sha1", "sha256"].includes(objectFormat)) {
    throw new Error(`FileGRC does not support the repository object format "${objectFormat}".`);
  }
  repositoryObjectFormats.set(root, objectFormat);
  return objectFormat;
}

export function getWorkspaceHistories(input, relativePaths, limitPerFile = 12, options = {}) {
  const root = resolveWorkspaceRoot(input);
  const wanted = new Set(relativePaths);
  const histories = new Map([...wanted].map((path) => [path, []]));
  if (!wanted.size) return histories;
  const remainingTime = () => {
    if (options.deadlineAt === undefined) return undefined;
    const remaining = Math.ceil(options.deadlineAt - performance.now());
    if (remaining > 0) return remaining;
    const error = new Error("The Git history deadline expired before another subprocess could start.");
    error.code = "FILEGRC_GIT_DEADLINE";
    throw error;
  };
  const withinDeadline = (task) => options.deadlineAt === undefined
    ? task()
    : withGitCommandDeadline(options.deadlineAt, task);
  let head = null;
  try {
    head = withinDeadline(() => git(root, ["rev-parse", "HEAD"], { timeoutMs: remainingTime() })) || null;
  } catch (error) {
    if (error?.code === "FILEGRC_GIT_DEADLINE") throw error;
    head = null;
  }
  const cached = workspaceHistoryCache.get(root);
  if (cached?.head === head && cached.limitPerFile === limitPerFile) {
    if (options.strict === true && cached.available === false) {
      throw gitHistoryUnavailableError();
    }
    for (const path of wanted) histories.set(path, cached.histories.get(path) ?? []);
    return histories;
  }
  const allHistories = new Map();
  let available = true;
  try {
    const output = withinDeadline(() => git(root, ["log", "--relative", "--format=%x1e%H%x1f%aI%x1f%an%x1f%s", "--name-only", "--", "data"], {
      timeoutMs: remainingTime()
    }));
    for (const block of output.split("\x1e")) {
      const lines = block.trim().split("\n").filter(Boolean);
      if (lines.length < 2) continue;
      const commit = parseLogLine(lines[0]);
      for (const path of lines.slice(1)) {
        if (!allHistories.has(path)) allHistories.set(path, []);
        const history = allHistories.get(path);
        if (history.length < limitPerFile) history.push(commit);
      }
    }
  } catch (error) {
    if (error?.code === "FILEGRC_GIT_DEADLINE") throw error;
    available = false;
    if (options.strict === true) {
      throw gitHistoryUnavailableError(error);
    }
    // Browser and workflow views tolerate an uncommitted workspace with no history yet.
  }
  if (available) workspaceHistoryCache.set(root, { head, limitPerFile, histories: allHistories, available });
  for (const path of wanted) histories.set(path, allHistories.get(path) ?? []);
  return histories;
}

function gitHistoryUnavailableError(cause) {
  const error = new Error("Git history is unavailable for the requested workspace files.", { cause });
  error.code = "FILEGRC_GIT_HISTORY_UNAVAILABLE";
  return error;
}

export function getFileAtRevision(input, revision, relativePath) {
  const root = resolveWorkspaceRoot(input);
  historicalRevisionReadObserver?.({ root, revision, relativePath });
  const indexed = indexedDataFile(dataRecordHistoryIndexCache.get(root), revision, relativePath);
  return indexed === undefined
    ? getFilesAtRevisions(root, [{ revision, relativePath }])[0]
    : indexed;
}

export function getFilesAtRevisions(input, requests, options = {}) {
  const root = resolveWorkspaceRoot(input);
  const hasDeadline = options.deadline !== undefined;
  const deadline = hasDeadline ? Number(options.deadline) : performance.now() + DATA_HISTORY_BUILD_TIMEOUT_MS;
  if (!Number.isFinite(deadline) || deadline <= performance.now()) {
    const error = new Error("Git historical file export exceeded its cumulative deadline.");
    error.code = "FILEGRC_HISTORY_DEADLINE";
    throw error;
  }
  const remainingTime = () => {
    const remainingMs = Math.floor(deadline - performance.now());
    if (remainingMs <= 0) {
      const error = new Error("Git historical file export exceeded its cumulative deadline.");
      error.code = "FILEGRC_HISTORY_DEADLINE";
      throw error;
    }
    return remainingMs;
  };
  const invalid = Array.isArray(requests) && requests.find(({ revision, relativePath } = {}) => (
    !/^[a-f0-9]{40}$/i.test(String(revision)) || !isSafeDataGitPath(relativePath)
  ));
  if (!Array.isArray(requests) || invalid) {
    throw new Error("Historical file exports require a Git commit and a data/ path.");
  }
  const maxRequests = Number(options.maxRequests) > 0 ? Math.floor(Number(options.maxRequests)) : null;
  if (maxRequests && requests.length > maxRequests) {
    const error = new Error(`Git historical file exports exceed the ${maxRequests}-request safety limit.`);
    error.code = "FILEGRC_HISTORY_EXPORT_LIMIT";
    throw error;
  }
  if (!requests.length) return [];
  const results = new Array(requests.length);
  const missing = [];
  requests.forEach((request, index) => {
    const key = `${root}\0${request.revision}\0${request.relativePath}`;
    if (historicalFileCache.has(key)) {
      results[index] = historicalFileCache.get(key);
      historicalFileCache.delete(key);
      historicalFileCache.set(key, results[index]);
    } else {
      missing.push({ ...request, index, key });
    }
  });
  const maxTotalBytes = Number(options.maxTotalBytes) > 0 ? Number(options.maxTotalBytes) : null;
  const cachedBytes = maxTotalBytes
    ? results.reduce((total, value) => total + (typeof value === "string" ? Buffer.byteLength(value, "utf8") : 0), 0)
    : 0;
  if (maxTotalBytes && cachedBytes > maxTotalBytes) throw historicalExportLimitError(maxTotalBytes);
  if (!missing.length) return results;
  try {
    const topLevel = git(root, ["rev-parse", "--show-toplevel"], { timeoutMs: remainingTime() });
    const workspacePrefix = relative(topLevel, root).split(sep).join("/");
    if (workspacePrefix === ".." || workspacePrefix.startsWith("../")) return requests.map(() => null);
    const missingSpecifications = missing.map(({ revision, relativePath }) => {
      const repositoryPath = workspacePrefix ? `${workspacePrefix}/${relativePath}` : relativePath;
      return `${revision}:${repositoryPath}`;
    });
    if (maxTotalBytes) {
      assertHistoricalExportSize(root, missingSpecifications, maxTotalBytes - cachedBytes, maxTotalBytes, remainingTime());
    }
    const batchSize = Math.max(1, Math.min(Number(options.batchSize) || 4, 512));
    for (let offset = 0; offset < missing.length; offset += batchSize) {
      const batch = missing.slice(offset, offset + batchSize);
      const specifications = missingSpecifications.slice(offset, offset + batchSize);
      let values;
      try {
        const run = () => {
          const remainingMs = remainingTime();
          return observedExecFileSync("git", ["cat-file", "--batch"], {
            cwd: root,
            input: `${specifications.join("\n")}\n`,
            stdio: ["pipe", "pipe", "ignore"],
            timeout: remainingMs,
            maxBuffer: 80_000_000,
            env: gitEnvironment()
          });
        };
        const output = measureTimingSync("git-history-export", () => (
          historicalBatchInterceptor ? historicalBatchInterceptor({ root, specifications, run }) : run()
        ));
        values = parseBatchObjects(output, batch.length);
      } catch (cause) {
        rethrowGitDeadline(cause);
        const error = new Error("Git could not read the historical file batch safely.", { cause });
        error.code = "FILEGRC_HISTORY_BATCH_FAILED";
        throw error;
      }
      batch.forEach(({ index, key }, batchIndex) => {
        const value = values[batchIndex];
        results[index] = value;
        if (value !== null && Buffer.byteLength(value, "utf8") <= 65_536) historicalFileCache.set(key, value);
      });
      while (historicalFileCache.size > 2_048) {
        historicalFileCache.delete(historicalFileCache.keys().next().value);
      }
    }
    return results;
  } catch (error) {
    if (["FILEGRC_HISTORY_EXPORT_LIMIT", "FILEGRC_HISTORY_BATCH_FAILED", "FILEGRC_HISTORY_DEADLINE", "FILEGRC_GIT_DEADLINE"].includes(error?.code)) throw error;
    return results.map((value) => value ?? null);
  }
}

export function setHistoricalBatchInterceptorForTests(interceptor) {
  const previous = historicalBatchInterceptor;
  historicalBatchInterceptor = interceptor;
  return () => {
    historicalBatchInterceptor = previous;
  };
}

function assertHistoricalExportSize(root, specifications, remainingBytes, maxTotalBytes, timeoutMs = GIT_DEFAULT_TIMEOUT_MS) {
  const output = measureTimingSync("git-history-size", () => observedExecFileSync("git", [
    "cat-file",
    "--batch-check=%(objectname) %(objecttype) %(objectsize)"
  ], {
    cwd: root,
    input: `${specifications.join("\n")}\n`,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "ignore"],
    timeout: timeoutMs,
    maxBuffer: 20_000_000,
    env: gitEnvironment()
  }));
  let total = 0;
  for (const line of output.trim().split("\n")) {
    if (!line || line.endsWith(" missing")) continue;
    const match = line.match(/^[a-f0-9]+ blob (\d+)$/i);
    if (!match) throw new Error("Git returned invalid historical object metadata.");
    total += Number(match[1]);
    if (!Number.isSafeInteger(total) || total > remainingBytes) throw historicalExportLimitError(maxTotalBytes);
  }
}

function historicalExportLimitError(maxTotalBytes) {
  const megabytes = maxTotalBytes / (1024 * 1024);
  const limit = Number.isInteger(megabytes) && megabytes >= 1
    ? `${megabytes} MB`
    : `${maxTotalBytes} byte`;
  const error = new Error(`Git historical file exports exceed the ${limit} safety limit.`);
  error.code = "FILEGRC_HISTORY_EXPORT_LIMIT";
  return error;
}

function dataHistoryLimitError(message) {
  const error = new Error(message);
  error.code = "FILEGRC_HISTORY_INDEX_LIMIT";
  return error;
}

export function getDataFilesAtRevision(input, revision) {
  if (!/^[a-f0-9]{40}$/i.test(String(revision))) return [];
  const root = resolveWorkspaceRoot(input);
  const index = dataRecordHistoryIndexCache.get(root);
  if (index?.available && index.parentsByCommit.has(revision)) {
    const lineage = [];
    let commit = revision;
    while (commit) {
      lineage.push(commit);
      commit = index.parentsByCommit.get(commit)?.[0] || null;
    }
    const files = new Set();
    for (let position = lineage.length - 1; position >= 0; position -= 1) {
      for (const [path, source] of index.fileChangesByCommit.get(lineage[position]) || []) {
        if (source === null) files.delete(path);
        else files.add(path);
      }
    }
    return [...files].filter((path) => path.endsWith(".json"));
  }
  try {
    const topLevel = git(root, ["rev-parse", "--show-toplevel"]);
    const workspacePrefix = relative(topLevel, root).split(sep).join("/");
    if (workspacePrefix === ".." || workspacePrefix.startsWith("../")) return [];
    const dataPrefix = workspacePrefix ? `${workspacePrefix}/data` : "data";
    return lines(git(root, ["ls-tree", "-r", "--name-only", revision, "--", dataPrefix]))
      .filter((path) => path.startsWith(`${dataPrefix}/`) && path.endsWith(".json"))
      .map((path) => workspacePrefix ? path.slice(workspacePrefix.length + 1) : path);
  } catch (error) {
    rethrowGitDeadline(error);
    return [];
  }
}

function readHistoricalFile(root, specification) {
  try {
    return measureTimingSync("git-history-export", () => observedExecFileSync("git", ["show", specification], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
      maxBuffer: 20_000_000,
      env: gitEnvironment()
    }));
  } catch (error) {
    rethrowGitDeadline(error);
    return null;
  }
}

function parseBatchObjects(output, expected) {
  const results = [];
  let offset = 0;
  for (let index = 0; index < expected; index += 1) {
    const headerEnd = output.indexOf(10, offset);
    if (headerEnd < 0) throw new Error("Git returned an incomplete historical object header.");
    const header = output.subarray(offset, headerEnd).toString("utf8");
    offset = headerEnd + 1;
    if (header.endsWith(" missing")) {
      results.push(null);
      continue;
    }
    const size = Number(header.split(" ").at(-1));
    if (!Number.isSafeInteger(size) || size < 0 || offset + size >= output.length) {
      throw new Error("Git returned an invalid historical object size.");
    }
    results.push(output.subarray(offset, offset + size).toString("utf8"));
    offset += size;
    if (output[offset++] !== 10) throw new Error("Git returned an incomplete historical object.");
  }
  return results;
}

function isSafeDataGitPath(value) {
  return isCanonicalDataPath(value)
    && !/[\r\n]/.test(value)
    && value.startsWith("data/")
    && value !== "data/";
}

export function getChangedDataPathsSinceRevision(input, revision) {
  if (!/^[a-f0-9]{40}$/i.test(String(revision))) return null;
  const root = resolveWorkspaceRoot(input);
  try {
    return [...new Set([
      ...lines(git(root, ["diff", "--name-only", "--relative", revision, "--", "data"])),
      ...lines(git(root, ["ls-files", "--others", "--exclude-standard", "--", "data"]))
    ])].filter((path) => path.startsWith("data/"));
  } catch (error) {
    rethrowGitDeadline(error);
    return null;
  }
}

export function hasGitRevision(input, revision) {
  if (!/^[a-f0-9]{40}$/i.test(String(revision))) return false;
  const root = resolveWorkspaceRoot(input);
  const index = dataRecordHistoryIndexCache.get(root);
  if (index?.available && index.parentsByCommit.has(revision)) return true;
  try {
    git(root, ["cat-file", "-e", `${revision}^{commit}`]);
    return true;
  } catch (error) {
    rethrowGitDeadline(error);
    return false;
  }
}

export async function commitWorkspace(input, message) {
  return serializeWorkspaceMutation(input, (root) => commitWorkspaceUnlocked(root, message));
}

export async function commitAndPushWorkspace(input, message) {
  return serializeWorkspaceMutation(input, (root) => commitAndPushWorkspaceUnlocked(root, message));
}

export async function pullWorkspace(input = process.cwd()) {
  return serializeWorkspaceMutation(input, pullWorkspaceUnlocked);
}

export async function pushWorkspace(input = process.cwd()) {
  return serializeWorkspaceMutation(input, pushWorkspaceUnlocked);
}

export function getRepositorySnapshot(input = process.cwd(), options = {}) {
  const root = resolveWorkspaceRoot(input);
  if (!options.fresh && repositorySnapshotPromises.has(root)) {
    recordTiming("repository-snapshot-reused", 0);
    return repositorySnapshotPromises.get(root);
  }
  const snapshot = buildRepositorySnapshot(root).finally(() => {
    if (repositorySnapshotPromises.get(root) === snapshot) repositorySnapshotPromises.delete(root);
  });
  repositorySnapshotPromises.set(root, snapshot);
  return snapshot;
}

export async function getRepositoryStateSignature(input = process.cwd(), options = {}) {
  const root = resolveWorkspaceRoot(input);
  const timeout = { timeoutMs: options.timeoutMs };
  let status;
  let gitDirectory;
  let refs;
  let remotes;
  try {
    [status, gitDirectory, refs, remotes] = await Promise.all([
      runGitCommand(root, [
        "status",
        "--porcelain=v2",
        "--branch",
        "-z",
        "--untracked-files=all"
      ], { ...timeout, operation: "verify repository state" }),
      runGitCommand(root, ["rev-parse", "--absolute-git-dir"], {
        ...timeout,
        operation: "locate repository state"
      }),
      runGitCommand(root, ["rev-parse", "--verify", "@{upstream}"], {
        ...timeout,
        operation: "verify the upstream repository revision"
      }).catch((error) => {
        if (error?.code === "FILEGRC_GIT_DEADLINE") throw error;
        return "";
      }),
      runGitCommand(root, ["remote", "-v"], { ...timeout, operation: "verify repository remotes" })
    ]);
  } catch (error) {
    if (error?.code === "FILEGRC_GIT_DEADLINE") throw error;
    status = "git-unavailable";
    gitDirectory = "";
    refs = "";
    remotes = "";
  }
  const background = backgroundSynchronizations.get(root);
  const backgroundState = background ? {
    status: background.status,
    commit: background.commit,
    startedAt: background.startedAt ?? null,
    finishedAt: background.finishedAt ?? null,
    remotePushed: background.remotePushed === true,
    error: background.error ?? null
  } : null;
  return createHash("sha256")
    .update(status)
    .update("\0")
    .update(refs)
    .update("\0")
    .update(remotes)
    .update("\0")
    .update(repositoryOperationFromDirectory(gitDirectory.trim()) || "")
    .update("\0")
    .update(JSON.stringify(backgroundState))
    .update("\0")
    .update(lastSuccessfulSynchronizations.get(root) || "")
    .digest("hex");
}

export async function getWorkspaceRevisionSnapshot(input = process.cwd()) {
  const root = resolveWorkspaceRoot(input);
  try {
    assertNoWorkspaceContentFilters(root);
    const source = await measureTiming("repository-revision", () => runGitCommand(root, [
      "status",
      "--porcelain=v2",
      "--branch",
      "-z",
      "--untracked-files=all",
      "--",
      "data"
    ], { operation: "resolve the workspace revision" }));
    const parsed = parseWorkspaceRevision(source);
    return {
      available: true,
      commit: parsed.commit,
      shortCommit: parsed.commit?.slice(0, 8) ?? "no commits",
      branch: parsed.branch,
      clean: parsed.changePaths.length === 0,
      changes: parsed.changePaths,
      workspaceChangePaths: parsed.changePaths
    };
  } catch (error) {
    if (error?.code === "FILEGRC_GIT_DEADLINE") throw error;
    return unavailableSnapshot(error, { workspaceChangePaths: [] });
  }
}

async function buildRepositorySnapshot(root) {
  let repositoryPaths;
  try {
    repositoryPaths = await measureTiming("git-discovery", () => runGitCommand(
      root,
      ["rev-parse", "--show-toplevel", "--absolute-git-dir"],
      { operation: "locate the repository" }
    ));
  } catch (error) {
    if (error?.code === "FILEGRC_GIT_DEADLINE") throw error;
    return unavailableSnapshot(error);
  }
  const [topLevel, gitDirectory] = repositoryPaths.split("\n");
  try {
    assertNoWorkspaceContentFilters(root);
    const [status, remotes] = await Promise.all([
      runGitCommand(topLevel, ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"], {
        operation: "inspect repository status"
      }),
      runGitCommand(root, ["remote"], { operation: "list repository remotes" })
    ]);
    const parsed = parsePorcelainV2(status, topLevel, root);
    const last = parsed.commit
      ? parseLogLine(await runGitCommand(root, ["log", "-1", "--format=%H%x1f%aI%x1f%an%x1f%s"], {
          operation: "read the latest commit"
        }))
      : null;
    let upstreamCommit = null;
    let pendingCommits = [];
    let pendingCommitsFilegrcOnly = parsed.ahead === 0 ? true : null;
    if (parsed.upstream) {
      upstreamCommit = (await runGitCommand(root, ["rev-parse", parsed.upstream], {
        operation: `resolve upstream ${parsed.upstream}`
      })).trim() || null;
    }
    if (parsed.ahead > 0 && parsed.upstream) {
      const pending = await runGitCommand(root, [
        "log",
        "--format=%x1e%H%x1f%s",
        "--name-only",
        `${parsed.upstream}..HEAD`
      ], { operation: `inspect commits ahead of ${parsed.upstream}` });
      const prefix = relative(topLevel, root).split(sep).join("/");
      const commits = parsePendingCommitPaths(pending);
      pendingCommits = commits.map(({ commit, subject }) => ({
        commit,
        shortCommit: commit.slice(0, 8),
        subject
      }));
      pendingCommitsFilegrcOnly = commits.every(({ paths }) => (
        paths.length > 0 && paths.every((path) => pathInsideWorkspace(path, prefix))
      ));
    }
    return {
      available: true,
      root: topLevel,
      gitDirectory,
      commit: parsed.commit,
      shortCommit: parsed.commit?.slice(0, 8) ?? "no commits",
      branch: parsed.branch,
      upstream: parsed.upstream,
      remotes: lines(remotes),
      clean: parsed.workspaceChanges.length === 0,
      changes: parsed.workspaceChanges,
      wholeWorktreeClean: parsed.allChanges.length === 0,
      operationInProgress: repositoryOperationFromDirectory(gitDirectory),
      upstreamCommit,
      ahead: parsed.ahead,
      behind: parsed.behind,
      pendingCommits,
      pendingCommitsFilegrcOnly,
      lastCommit: last,
      invocationCount: 3 + (parsed.commit ? 1 : 0) + (parsed.upstream ? 1 : 0) + (parsed.ahead > 0 ? 1 : 0)
    };
  } catch (error) {
    if (error?.code === "FILEGRC_GIT_DEADLINE") throw error;
    return unavailableSnapshot(error, { root: topLevel, gitDirectory });
  }
}

function unavailableSnapshot(error, extra = {}) {
  return {
    available: false,
    clean: null,
    changes: [],
    error,
    message: error instanceof GitOperationError
      ? error.message
      : "Git history is unavailable. Commit the workspace to enable audit metadata.",
    ...extra
  };
}

export async function getBrowserRepositoryState(input = process.cwd(), options = {}) {
  const root = input?.entries && input?.root ? input.root : resolveWorkspaceRoot(input);
  const config = await getRepositoryConfig(input);
  const gitSummary = options.repositorySnapshot ?? await getRepositorySnapshot(root);
  if (config.mode !== "trunk") {
    return {
      mode: "manual",
      authoritativeBranch: config.authoritativeBranch,
      remote: config.remote,
      developmentOverride: false,
      status: "manual",
      label: "Manual Git",
      writesAllowed: !options.readOnly,
      currentCommit: gitSummary.commit,
      upstreamCommit: null,
      ahead: null,
      behind: null,
      pendingCommits: [],
      pendingCommitsFilegrcOnly: null,
      lastSuccessfulSynchronization: lastSuccessfulSynchronizations.get(root) ?? null,
      message: "Browser writes stay local until a user commits and synchronizes them."
    };
  }

  const details = inspectTrunkRepository(root, config, gitSummary);
  const developmentOverride = options.allowNonAuthoritativeWrites === true;
  if (developmentOverride) {
    return {
      ...details,
      developmentOverride: true,
      writesAllowed: !options.readOnly,
      status: "not-synced",
      label: "Not synced",
      message: "Development override is active. Browser writes stay local and FileGRC will not commit or push them."
    };
  }
  return {
    ...details,
    developmentOverride: false,
    writesAllowed: !options.readOnly && details.writesAllowed
  };
}

export async function runBrowserMutation(input, options, task) {
  return serializeWorkspaceMutation(input, async (root) => {
    const config = await getRepositoryConfig(root);
    if (config.mode !== "trunk" || options?.allowNonAuthoritativeWrites === true) {
      return task(root);
    }
    return runTrunkMutationUnlocked(root, config, options, task);
  });
}

export async function prefetchBrowserRemote(input = process.cwd(), options = {}) {
  const root = resolveWorkspaceRoot(input);
  const key = `${root}\0${options.allowNonAuthoritativeWrites === true}`;
  if (browserRemotePrefetchPromises.has(key)) {
    recordTiming("prefetch-coalesced", 0);
    return browserRemotePrefetchPromises.get(key);
  }
  const prefetch = prefetchBrowserRemoteCoalesced(root, options).finally(() => {
    if (browserRemotePrefetchPromises.get(key) === prefetch) browserRemotePrefetchPromises.delete(key);
  });
  browserRemotePrefetchPromises.set(key, prefetch);
  return prefetch;
}

async function prefetchBrowserRemoteCoalesced(root, options) {
  const prepared = await serializeWorkspaceMutation(root, async () => {
    const config = await getRepositoryConfig(root);
    if (config.mode !== "trunk" || options.allowNonAuthoritativeWrites === true) return { config, repository: null };
    const repository = await measureTiming("git-preconditions", () => requireTrunkPreconditionsAsync(root, config));
    return { config, repository };
  });
  if (!prepared.repository) return { status: "not-needed", token: null, fetchedAt: null, expiresAt: null };

  // Fetch updates only remote-tracking refs, so it does not occupy the source mutation queue.
  await fetchConfiguredRemote(root, prepared.config);
  return serializeWorkspaceMutation(root, async () => {
    const summary = await getRepositorySnapshot(root, { fresh: true });
    if (!summary.available) throw summary.error;
    if (summary.commit !== prepared.repository.currentCommit) {
      throw new Error("The authoritative branch changed while FileGRC checked its remote. Reload and try again.");
    }
    const repository = inspectTrunkRepository(root, prepared.config, summary);
    const fetchedAt = new Date().toISOString();
    const token = randomUUID();
    browserRemotePrefetches.set(root, {
      token,
      remote: prepared.config.remote,
      currentCommit: summary.commit,
      upstreamCommit: repository.upstreamCommit,
      fetchedAt: Date.parse(fetchedAt)
    });
    return {
      status: "checked",
      token,
      fetchedAt,
      expiresAt: new Date(Date.parse(fetchedAt) + BROWSER_REMOTE_PREFETCH_MAX_AGE_MS).toISOString()
    };
  });
}

export async function retryBrowserSync(input = process.cwd(), options = {}) {
  return serializeWorkspaceMutation(input, async (root) => {
    const config = await getRepositoryConfig(root);
    if (config.mode !== "trunk") throw new Error("Retry sync is available only in trunk repository mode.");
    if (backgroundSynchronizations.get(root)?.status === "syncing") {
      throw new Error("A FileGRC background push is already in progress. Wait for it to finish before retrying sync.");
    }
    if (options.allowNonAuthoritativeWrites === true) {
      throw new Error("Retry sync is disabled while the development write override is active.");
    }
    const before = await requireTrunkPreconditionsAsync(root, config, { allowAhead: true });
    await fetchConfiguredRemote(root, config);
    const synchronized = inspectTrunkRepository(root, config, await getRepositorySnapshot(root, { fresh: true }));
    if (synchronized.behind > 0 && synchronized.ahead > 0) {
      throw new Error("The authoritative branch has diverged from its upstream. FileGRC will not merge or rebase it. Reconcile the repository with Git, then reload.");
    }
    if (synchronized.behind > 0) {
      throw new Error("The authoritative branch is behind its upstream. Fast-forward it with Git, then reload before retrying sync.");
    }
    const ready = inspectTrunkRepository(root, config, await getRepositorySnapshot(root, { fresh: true }));
    if (ready.ahead > 0 && !ready.pendingCommitsFilegrcOnly) {
      throw new Error("At least one commit ahead of upstream changes files outside this FileGRC workspace. FileGRC will not push it. Reconcile the repository with Git.");
    }
    if (ready.ahead > 0) {
      const pushed = await pushConfiguredBranch(root, config, ready.currentCommit, ready.upstreamCommit);
      if (pushed.trackingError) {
        const committed = { commit: ready.currentCommit, shortCommit: ready.currentCommit.slice(0, 8) };
        recordBackgroundTrackingFailure(root, committed, pushed.trackingError);
        throw new Error(pushed.trackingError);
      }
    }
    const after = inspectTrunkRepository(root, config, await getRepositorySnapshot(root, { fresh: true }));
    if (after.ahead !== 0 || after.behind !== 0) {
      throw new Error("The authoritative branch is still not synchronized. Reload the repository state before trying again.");
    }
    const synchronizedAt = new Date().toISOString();
    lastSuccessfulSynchronizations.set(root, synchronizedAt);
    backgroundSynchronizations.delete(root);
    return {
      commit: after.currentCommit,
      shortCommit: after.currentCommit?.slice(0, 8) ?? null,
      branch: config.authoritativeBranch,
      upstream: after.upstream,
      synchronizedAt,
      retriedCommits: before.ahead ?? 0
    };
  });
}

async function runTrunkMutationUnlocked(root, config, options, task) {
  const beforeFetch = await measureTiming("git-preconditions", () => requireTrunkPreconditionsAsync(root, config));
  let synchronized = beforeFetch;
  if (!consumeFreshBrowserRemotePrefetch(root, config, options?.prefetchToken, beforeFetch)) {
    await fetchConfiguredRemote(root, config);
    synchronized = inspectTrunkRepository(root, config, await getRepositorySnapshot(root, { fresh: true }));
  }
  if (synchronized.ahead > 0 && synchronized.behind > 0) {
    throw new Error("The authoritative branch has diverged from its upstream. FileGRC will not merge or rebase it. Reconcile the repository with Git, then reload.");
  }
  if (synchronized.ahead > 0) {
    throw new Error("The authoritative branch has local commits waiting to be pushed. Use Retry sync before making another browser change.");
  }
  if (synchronized.behind > 0) {
    throw new Error("The authoritative branch is behind its upstream. Fast-forward it with Git, then reload before making a browser change.");
  }
  if (synchronized.ahead !== 0 || synchronized.behind !== 0) {
    throw new Error("The authoritative branch is not synchronized with its upstream. Reload after reconciling the repository with Git.");
  }

  let result;
  let subject;
  let validationProof;
  let validatedManifest;
  try {
    result = await measureTiming("write", () => withDeferredWorkspaceValidation(() => task(root, {
      repositorySnapshot: synchronized
    })));
    subject = generatedCommitMessage(typeof options?.message === "function" ? options.message(result) : options?.message);
    assertNoIgnoredAuthoritativeFiles(root);
    const beforeValidation = measureTimingSync("workspace-manifest", () => workspaceByteManifest(root));
    const validation = await withGitCommandCache(new Map(), () => validateWorkspace(root));
    if (!validation.ok) {
      throw new Error(`The workspace has ${validation.counts.errors} validation ${validation.counts.errors === 1 ? "error" : "errors"}.`);
    }
    validationProof = options?.includeValidationProof === false
      ? null
      : {
          validation,
          fingerprint: (await measureTiming("fingerprint", () => fingerprintWorkspace(validation.loaded))).fingerprint
    };
    validatedManifest = measureTimingSync("workspace-manifest", () => workspaceByteManifest(root));
    assertWorkspaceManifestEqual(beforeValidation, validatedManifest);
    await measureTiming("outside-worktree-check", () => assertNoOutsideWorktreeChangesAsync(root));
  } catch (error) {
    throw new Error(`${error.message} FileGRC preserved every current file instead of guessing which edits it owns. Review the Git diff; later browser mutations are blocked until the worktree is reconciled.`);
  }

  const changed = Boolean(await runGitCommand(root, ["status", "--porcelain=v1", "--", "."], {
    operation: "check the FileGRC workspace change"
  }));
  if (!changed && options?.allowNoChanges === true) {
    return withValidationProof({
      ...result,
      synchronization: {
        status: "unchanged",
        commit: synchronized.currentCommit,
        shortCommit: synchronized.currentCommit?.slice(0, 8) ?? null,
        upstream: synchronized.upstream,
        synchronizedAt: lastSuccessfulSynchronizations.get(root) ?? null,
        pushError: null
      }
    }, validationProof);
  }
  if (!changed) {
    throw new Error("The browser action did not change any FileGRC workspace files.");
  }
  assertValidGitIdentity(root);
  assertNoWorkspaceContentFilters(root);
  await measureTiming("outside-worktree-check", () => assertNoOutsideWorktreeChangesAsync(root));
  let commit;
  let indexReconciled;
  try {
    const expectedRef = `refs/heads/${config.authoritativeBranch}`;
    assertExpectedCheckout(root, expectedRef, synchronized.currentCommit);
    validatedManifest = measureTimingSync("workspace-manifest-objects", () => writeWorkspaceManifestObjects(root, validatedManifest));
    ({ commit, indexReconciled } = await measureTiming("commit", () => commitValidatedIndexAsync(root, subject, validatedManifest, {
      expectedParent: synchronized.currentCommit,
      expectedRef
    })));
  } catch (error) {
    throw new Error(`${error.message} The saved files remain in the Git worktree and later browser changes are blocked.`);
  }

  const committed = { commit, shortCommit: commit.slice(0, 8), upstreamCommit: synchronized.upstreamCommit };
  if (!indexReconciled) {
    const error = new Error("FileGRC created the commit, but the shared Git index changed or could not be reconciled afterward. Review and reconcile the Git index before syncing.");
    recordBackgroundPushFailure(root, committed, error);
    return withValidationProof({
      ...result,
      synchronization: {
        status: "not-synced",
        commit: committed.commit,
        shortCommit: committed.shortCommit,
        upstream: synchronized.upstream,
        synchronizedAt: null,
        pushError: backgroundSynchronizations.get(root)?.error ?? error.message
      }
    }, validationProof);
  }
  queueBackgroundPush(root, config, committed, options?.backgroundPushDelayMs);
  return withValidationProof({
    ...result,
    synchronization: {
      status: "syncing",
      commit: committed.commit,
      shortCommit: committed.shortCommit,
      upstream: synchronized.upstream,
      synchronizedAt: null,
      pushError: null
    }
  }, validationProof);
}

function withValidationProof(result, proof) {
  if (proof && result && typeof result === "object") {
    Object.defineProperty(result, BROWSER_VALIDATION, { value: proof });
  }
  return result;
}

function consumeFreshBrowserRemotePrefetch(root, config, token, repository) {
  const prefetch = browserRemotePrefetches.get(root);
  browserRemotePrefetches.delete(root);
  if (
    !token
    || !prefetch
    || prefetch.token !== token
    || prefetch.remote !== config.remote
    || Date.now() - prefetch.fetchedAt > BROWSER_REMOTE_PREFETCH_MAX_AGE_MS
  ) {
    return false;
  }
  const reusable = repository.currentCommit === prefetch.currentCommit
    && repository.upstreamCommit === prefetch.upstreamCommit;
  if (reusable) recordTiming("fetch-reused", 0);
  return reusable;
}

function queueBackgroundPush(root, config, committed, delayMs = 0) {
  backgroundSynchronizations.set(root, {
    status: "syncing",
    commit: committed.commit,
    shortCommit: committed.shortCommit,
    startedAt: new Date().toISOString(),
    error: null
  });
  const start = async () => {
    try {
      const ready = await requireTrunkPreconditionsAsync(root, config, {
        allowAhead: true,
        backgroundCommit: committed.commit
      });
      if (ready.currentCommit !== committed.commit) {
        throw new Error("The authoritative branch changed after FileGRC created its browser commit. FileGRC did not push it.");
      }
      if (ready.behind > 0) {
        throw new Error("The authoritative branch changed upstream after FileGRC created its browser commit. FileGRC did not push it.");
      }
      if (ready.ahead < 1 || !ready.pendingCommitsFilegrcOnly) {
        throw new Error("The pending commits are no longer limited to this FileGRC workspace. FileGRC did not push them.");
      }
      await finishBackgroundPush(root, config, committed);
    } catch (error) {
      recordBackgroundPushFailure(root, committed, error);
    }
  };
  const delay = Math.max(0, Math.min(Number(delayMs) || 0, 30_000));
  if (delay) setTimeout(start, delay);
  else setImmediate(start);
}

async function finishBackgroundPush(root, config, committed) {
  const started = performance.now();
  let outcome = "failed";
  let remotePushed = false;
  try {
    const pushed = await pushConfiguredBranch(root, config, committed.commit, committed.upstreamCommit);
    remotePushed = pushed.remotePushed;
    if (pushed.trackingError) {
      recordBackgroundTrackingFailure(root, committed, pushed.trackingError);
      outcome = "pushed-tracking-stale";
      return;
    }
    const after = inspectTrunkRepository(root, config, await getRepositorySnapshot(root, { fresh: true }), { ignoreBackground: true });
    if (after.ahead !== 0 || after.behind !== 0) {
      throw new Error("The authoritative branch is still not synchronized after the background push.");
    }
    const synchronizedAt = new Date().toISOString();
    lastSuccessfulSynchronizations.set(root, synchronizedAt);
    deleteBackgroundSynchronizationIfCurrent(root, committed.commit);
    outcome = "synced";
  } catch (error) {
    if (remotePushed) recordBackgroundRemoteSuccessFailure(root, committed, error.message);
    else recordBackgroundPushFailure(root, committed, error);
  } finally {
    if (timingEnabled()) {
      console.error(`[filegrc timing] ${JSON.stringify({
        operation: "background-sync",
        push: { count: 1, durationMs: performance.now() - started },
        outcome
      })}`);
    }
  }
}

function recordBackgroundPushFailure(root, committed, error) {
  setBackgroundSynchronizationIfCurrent(root, committed, {
    status: "failed",
    commit: committed.commit,
    shortCommit: committed.shortCommit,
    startedAt: backgroundSynchronizations.get(root)?.startedAt ?? null,
    finishedAt: new Date().toISOString(),
    remotePushed: false,
    error: `${error.message} The local FileGRC commit was retained. Use Retry sync after the remote is available.`
  }, { allowMissing: true });
}

function recordBackgroundTrackingFailure(root, committed, error) {
  recordBackgroundRemoteSuccessFailure(root, committed, error);
}

function recordBackgroundRemoteSuccessFailure(root, committed, error) {
  setBackgroundSynchronizationIfCurrent(root, committed, {
    status: "failed",
    commit: committed.commit,
    shortCommit: committed.shortCommit,
    startedAt: backgroundSynchronizations.get(root)?.startedAt ?? null,
    finishedAt: new Date().toISOString(),
    remotePushed: true,
    error: `${error} The remote accepted the exact FileGRC commit. Fetch with Git to reconcile local state; do not retry the push.`
  }, { allowMissing: true });
}

function setBackgroundSynchronizationIfCurrent(root, committed, next, options = {}) {
  const current = backgroundSynchronizations.get(root);
  if (current && current.commit !== committed.commit) return false;
  if (!current && options.allowMissing !== true) return false;
  backgroundSynchronizations.set(root, {
    ...next,
    remotePushed: current?.remotePushed === true || next.remotePushed === true
  });
  return true;
}

function deleteBackgroundSynchronizationIfCurrent(root, commit) {
  if (backgroundSynchronizations.get(root)?.commit !== commit) return false;
  return backgroundSynchronizations.delete(root);
}

async function commitWorkspaceUnlocked(root, message) {
  const subject = String(message ?? "").trim();
  if (!subject || subject.length > 200 || /[\u0000-\u001f\u007f]/.test(subject)) {
    throw new Error("Commit messages must be one line from 1 through 200 characters.");
  }
  assertNoWorkspaceContentFilters(root);
  const before = getGitSummary(root);
  if (!before.available) throw new Error("Git history is unavailable for this workspace.");
  if (!before.branch) throw new Error("Check out a branch before creating a browser commit.");
  assertNoGitOperationInProgress(root);
  if (before.clean) throw new Error("The workspace has no changes to commit.");
  if (!tryGit(root, ["config", "user.name"]) || !tryGit(root, ["config", "user.email"])) {
    throw new Error("Configure git user.name and user.email before committing.");
  }
  assertValidGitIdentity(root);
  assertNoIgnoredAuthoritativeFiles(root);
  const beforeValidation = workspaceByteManifest(root);
  const validation = await validateWorkspace(root);
  if (!validation.ok) {
    throw new Error(`The workspace has ${validation.counts.errors} validation ${validation.counts.errors === 1 ? "error" : "errors"}. Fix them before committing.`);
  }
  let validatedManifest = workspaceByteManifest(root);
  assertWorkspaceManifestEqual(beforeValidation, validatedManifest);
  const commitOptions = {
    expectedParent: before.commit,
    expectedRef: `refs/heads/${before.branch}`
  };
  assertExpectedCheckout(root, commitOptions.expectedRef, commitOptions.expectedParent);
  validatedManifest = writeWorkspaceManifestObjects(root, validatedManifest);
  const committed = await commitValidatedIndexAsync(root, subject, validatedManifest, commitOptions);
  const after = getGitSummary(root);
  return {
    commit: committed.commit,
    shortCommit: committed.commit.slice(0, 8),
    indexReconciled: committed.indexReconciled,
    subject: after.lastCommit?.subject || subject
  };
}

async function commitAndPushWorkspaceUnlocked(root, message) {
  const before = getGitSummary(root);
  const target = before.upstream || before.remotes?.length
    ? captureManualPushTarget(root, before)
    : null;
  const committed = await commitWorkspaceUnlocked(root, message);
  if (!target) {
    return {
      ...committed,
      pushed: false,
      pushSkipped: true
    };
  }
  try {
    const pushed = await pushCapturedWorkspaceCommit(root, {
      before,
      target,
      commit: committed.commit
    });
    return {
      ...committed,
      pushed: true,
      pushSkipped: false,
      upstream: pushed.upstream,
      trackingConfigured: pushed.trackingConfigured,
      trackingError: pushed.trackingError
    };
  } catch (error) {
    return {
      ...committed,
      pushed: false,
      pushSkipped: false,
      pushError: error.message
    };
  }
}

async function pullWorkspaceUnlocked(root) {
  const before = syncReadySummary(root, "pull");
  assertNoGitOperationInProgress(root);
  if (!before.upstream) {
    throw new Error("This branch has no upstream branch. Push it first or configure an upstream with Git.");
  }
  const remote = before.upstream.split("/")[0];
  const branch = before.upstream.slice(remote.length + 1);
  const url = assertSafeAutomaticTransport(root, remote);
  gitForWrite(root, exactFetchArgs({ remote, branch, url }), `fetch ${remote} before checking incoming commits`);
  const target = git(root, ["rev-parse", "--verify", `${before.upstream}^{commit}`]);
  const incomingCommits = lines(git(root, ["rev-list", "--reverse", `${before.commit}..${target}`]));
  assertCommitsInsideWorkspace(root, incomingCommits);
  for (const commit of incomingCommits) {
    assertNoCommitWorkspaceContentFilters(root, commit);
  }
  assertExpectedCheckout(root, `refs/heads/${before.branch}`, before.commit);
  if (incomingCommits.length) {
    throw new Error("FileGRC fetched incoming commits but did not integrate them. Reconcile the branch with Git, then reload FileGRC.");
  }
  const after = getGitSummary(root);
  return {
    updated: before.commit !== after.commit,
    commit: after.commit,
    shortCommit: after.shortCommit,
    branch: after.branch,
    upstream: after.upstream
  };
}

async function pushWorkspaceUnlocked(root) {
  const before = syncReadySummary(root, "push");
  assertNoGitOperationInProgress(root);
  const target = captureManualPushTarget(root, before);
  const validation = await validateWorkspace(root);
  if (!validation.ok) {
    throw new Error(`The workspace has ${validation.counts.errors} validation ${validation.counts.errors === 1 ? "error" : "errors"}. Fix them before pushing.`);
  }
  return pushCapturedWorkspaceCommit(root, { before, target, commit: before.commit });
}

async function pushCapturedWorkspaceCommit(root, { before, target, commit }) {
  assertExpectedCheckout(root, `refs/heads/${before.branch}`, commit);
  await gitForWriteAsync(root, exactPushArgs(target, commit), "push", {
    expectedCheckout: {
      expectedRef: `refs/heads/${before.branch}`,
      expectedCommit: commit
    }
  });
  let trackingError = reconcileRemoteTracking(root, target, commit);
  if (!before.upstream && !trackingError) {
    try {
      assertExpectedCheckout(root, `refs/heads/${before.branch}`, commit);
      gitForWrite(root, ["branch", "--set-upstream-to", `${target.remote}/${before.branch}`, before.branch], "configure the pushed branch upstream");
    } catch (error) {
      trackingError = error.message;
    }
  }
  return {
    commit,
    shortCommit: commit.slice(0, 8),
    branch: before.branch,
    upstream: before.upstream || (trackingError ? null : `${target.remote}/${before.branch}`),
    trackingConfigured: Boolean(before.upstream) || !trackingError,
    trackingError
  };
}

function captureManualPushTarget(root, before) {
  let remote;
  let destination;
  if (before.upstream) {
    remote = tryGit(root, ["config", "--get", `branch.${before.branch}.remote`]);
    destination = tryGit(root, ["config", "--get", `branch.${before.branch}.merge`]);
    const destinationBranch = destination?.startsWith("refs/heads/")
      ? destination.slice("refs/heads/".length)
      : "";
    if (!isSafeGitName(remote) || !isSafeGitName(destinationBranch) || before.upstream !== `${remote}/${destinationBranch}`) {
      throw new Error("The current branch has an unsafe or unsupported upstream configuration. Configure a normal remote branch with Git before pushing.");
    }
  } else {
    remote = before.remotes.includes("origin")
      ? "origin"
      : before.remotes.length === 1
        ? before.remotes[0]
        : null;
    if (!remote) {
      throw new Error(before.remotes.length
        ? "This branch has no upstream and the repository has multiple remotes. Configure an upstream with Git."
        : "This repository has no Git remote. Add one before pushing.");
    }
    destination = `refs/heads/${before.branch}`;
  }
  const destinationBranch = destination.slice("refs/heads/".length);
  return {
    remote,
    destination,
    destinationBranch,
    trackingRef: `refs/remotes/${remote}/${destinationBranch}`,
    expectedTrackingCommit: before.upstream ? tryGit(root, ["rev-parse", "--verify", before.upstream]) : null,
    url: assertSafeAutomaticTransport(root, remote, { push: true })
  };
}

function reconcileRemoteTracking(root, target, commit) {
  try {
    gitForWrite(root, [
      "update-ref", "-m", "FileGRC exact push",
      target.trackingRef,
      commit,
      target.expectedTrackingCommit || "0000000000000000000000000000000000000000"
    ], "reconcile the remote-tracking branch after a successful push");
    return null;
  } catch (error) {
    return `${error.message} The exact commit was pushed, but the local remote-tracking branch needs reconciliation with Git.`;
  }
}

function exactPushArgs(target, commit) {
  const expected = target.expectedTrackingCommit || "";
  return [
    "-c", "push.pushOption=",
    "push", "--porcelain", "--no-follow-tags", "--recurse-submodules=no", "--no-signed", "--no-push-option",
    `--force-with-lease=${target.destination}:${expected}`,
    "--", target.url, `${commit}:${target.destination}`
  ];
}

function syncReadySummary(root, action) {
  const summary = getGitSummary(root);
  if (!summary.available) throw new Error(`Git history is unavailable for this workspace, so filegrc cannot ${action}.`);
  if (!summary.branch) throw new Error(`Check out a branch before trying to ${action}.`);
  if (!summary.clean) throw new Error(`Commit or discard workspace changes before trying to ${action}.`);
  return summary;
}

async function getRepositoryConfig(input) {
  const loaded = input?.entries && input?.root ? input : await loadWorkspace(input);
  const renderer = loaded.resources.find(({ type, id }) => type === "renderer-settings" && id === "renderer-settings");
  const mode = renderer?.repositoryMode;
  const authoritativeBranch = cleanGitName(renderer?.authoritativeBranch);
  const remote = cleanGitName(renderer?.repositoryRemote);
  return {
    mode,
    authoritativeBranch,
    remote,
    configurationError: !["trunk", "manual"].includes(mode)
      ? "Repository mode is missing or invalid. Run the model migration or update renderer settings."
      : !isSafeGitName(authoritativeBranch)
      ? "The configured authoritative branch is not a safe Git branch name. Update renderer settings before using browser writes."
      : !isSafeGitName(remote)
        ? "The configured repository remote is not a safe Git remote name. Update renderer settings before using browser writes."
        : null
  };
}

function inspectTrunkRepository(root, config, summary, options = {}) {
  const background = options.ignoreBackground ? null : backgroundSynchronizations.get(root);
  const base = {
    mode: "trunk",
    authoritativeBranch: config.authoritativeBranch,
    remote: config.remote,
    currentCommit: summary.commit,
    upstreamCommit: null,
    upstream: summary.upstream,
    ahead: null,
    behind: null,
    pendingCommits: [],
    pendingCommitsFilegrcOnly: null,
    lastSuccessfulSynchronization: lastSuccessfulSynchronizations.get(root) ?? null,
    wholeWorktreeClean: summary.available ? summary.wholeWorktreeClean : null,
    operationInProgress: summary.available ? summary.operationInProgress : null,
    backgroundSynchronization: background ? {
      status: background.status,
      commit: background.commit,
      shortCommit: background.shortCommit,
      startedAt: background.startedAt,
      finishedAt: background.finishedAt ?? null,
      remotePushed: background.remotePushed === true,
      error: background.error
    } : null,
    writesAllowed: false
  };
  if (config.configurationError) {
    return {
      ...base,
      status: "git-setup-required",
      label: "Git setup required",
      message: config.configurationError
    };
  }
  if (!summary.available) {
    return {
      ...base,
      status: summary.error?.kind === "missing-executable" ? "git-setup-required" : "git-error",
      label: summary.error?.kind === "missing-executable" ? "Git setup required" : "Git error",
      message: summary.message || "Git history is unavailable for this workspace."
    };
  }
  if (summary.branch !== config.authoritativeBranch) {
    return {
      ...base,
      status: "read-only-checkout",
      label: "Read-only checkout",
      message: "This checkout is not the authoritative FileGRC branch. You can review the program here, but browser changes are disabled. Run FileGRC from the main checkout or use the explicit development override."
    };
  }
  if (!summary.remotes.includes(config.remote)) {
    return {
      ...base,
      status: "git-setup-required",
      label: "Git setup required",
      message: `The configured Git remote "${config.remote}" does not exist. Add it and configure the authoritative branch upstream before using browser writes.`
    };
  }
  const expectedUpstream = `${config.remote}/${config.authoritativeBranch}`;
  if (summary.upstream !== expectedUpstream) {
    return {
      ...base,
      status: "git-setup-required",
      label: "Git setup required",
      message: `The authoritative branch must track ${expectedUpstream}. Configure that upstream with Git before using browser writes.`
    };
  }
  const upstreamCommit = summary.upstreamCommit;
  const counts = { ahead: summary.ahead, behind: summary.behind };
  const pendingCommits = summary.pendingCommits;
  const pendingCommitsFilegrcOnly = summary.pendingCommitsFilegrcOnly;
  const details = {
    ...base,
    upstreamCommit,
    ahead: counts.ahead,
    behind: counts.behind,
    pendingCommits,
    pendingCommitsFilegrcOnly
  };
  if (base.operationInProgress) {
    return {
      ...details,
      status: "not-synced",
      label: "Not synced",
      message: `A Git ${base.operationInProgress} is in progress. Finish or abort it with Git before using browser writes.`
    };
  }
  if (!base.wholeWorktreeClean) {
    return {
      ...details,
      status: "not-synced",
      label: "Not synced",
      message: "The Git worktree has uncommitted changes. Commit, discard, or move them with Git before using browser writes."
    };
  }
  if (background?.status === "syncing" && background.commit === summary.commit) {
    return {
      ...details,
      status: "syncing",
      label: "Syncing",
      message: `The FileGRC commit ${background.shortCommit} is saved locally and is being pushed to ${expectedUpstream}.`,
      writesAllowed: false,
      retrySafe: false
    };
  }
  if (counts.ahead === null || counts.behind === null) {
    return {
      ...details,
      status: "git-setup-required",
      label: "Git setup required",
      message: `The upstream ${expectedUpstream} is unavailable locally. Fetch ${config.remote} with Git, then reload.`
    };
  }
  if (counts.ahead > 0 || counts.behind > 0) {
    const external = counts.ahead > 0 && !pendingCommitsFilegrcOnly;
    const backgroundFailure = background?.status === "failed"
      && background.commit === summary.commit
      && (background.remotePushed === true || (
        counts.ahead > 0
        && counts.behind === 0
        && pendingCommitsFilegrcOnly
      ))
      ? background.error
      : null;
    return {
      ...details,
      status: "not-synced",
      label: "Not synced",
      message: backgroundFailure || (external
        ? "A commit ahead of upstream changes files outside this FileGRC workspace. Reconcile it with Git. FileGRC will not push it."
        : counts.ahead > 0 && counts.behind > 0
          ? "The authoritative branch has diverged from upstream. Reconcile it with Git. FileGRC will not merge or rebase it."
          : counts.ahead > 0
            ? "FileGRC-only commits are waiting to be pushed. Use Retry sync."
            : "The authoritative branch is behind upstream. Fast-forward it with Git, then reload FileGRC."),
      writesAllowed: false,
      retrySafe: counts.ahead > 0 && counts.behind === 0 && pendingCommitsFilegrcOnly && background?.remotePushed !== true,
      backgroundSyncError: backgroundFailure
    };
  }
  return {
    ...details,
    status: "synced",
    label: "Synced",
    message: `The authoritative branch is synchronized with ${expectedUpstream}.`,
    writesAllowed: true,
    retrySafe: false
  };
}

async function requireTrunkPreconditionsAsync(root, config, options = {}) {
  const summary = await getRepositorySnapshot(root, { fresh: true });
  const state = inspectTrunkRepository(root, config, summary);
  if (config.configurationError) throw new Error(state.message);
  if (!summary.available) throw summary.error || new Error(state.message);
  if (summary.branch !== config.authoritativeBranch) throw new Error(state.message);
  if (!summary.remotes.includes(config.remote)) throw new Error(state.message);
  if (summary.upstream !== `${config.remote}/${config.authoritativeBranch}`) throw new Error(state.message);
  if (
    state.backgroundSynchronization?.status === "syncing"
    && state.backgroundSynchronization.commit !== options.backgroundCommit
  ) {
    throw new Error("A FileGRC background push is still finalizing. Wait for it to finish before making another browser change.");
  }
  if (state.operationInProgress) throw new Error(state.message);
  if (!state.wholeWorktreeClean) throw new Error(state.message);
  if (!options.allowAhead && state.ahead > 0) {
    throw new Error("The authoritative branch has local commits waiting to be pushed. Use Retry sync before making another browser change.");
  }
  return state;
}

async function fetchConfiguredRemote(root, config) {
  const url = assertSafeAutomaticTransport(root, config.remote);
  return measureTiming("fetch", () => gitForWriteAsync(
    root,
    exactFetchArgs({ remote: config.remote, branch: config.authoritativeBranch, url }),
    `fetch ${config.remote}`
  ));
}

function exactFetchArgs({ remote, branch, url }) {
  return [
    "fetch", "--prune", "--no-prune-tags", "--no-tags", "--recurse-submodules=no",
    "--", url, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`
  ];
}

function assertCommitsInsideWorkspace(root, commits) {
  const topLevel = git(root, ["rev-parse", "--show-toplevel"]);
  const prefix = relative(topLevel, root).split(sep).join("/");
  if (prefix === ".." || prefix.startsWith("../")) throw new Error("The FileGRC workspace is outside its Git repository.");
  if (!prefix) return;
  for (const commit of commits) {
    const changed = nulFields(gitRaw(topLevel, [
      "diff-tree", "--root", "--no-commit-id", "--name-only", "-z", "-m", "-r", commit, "--"
    ]));
    const outside = changed.filter((path) => !pathInsideWorkspace(path, prefix));
    if (outside.length) {
      throw new Error(`FileGRC will not rebase commit ${commit.slice(0, 12)} because it changes files outside this nested workspace: ${outside.slice(0, 5).join(", ")}${outside.length > 5 ? "…" : ""}. Reconcile the whole repository with Git.`);
    }
  }
}

async function pushConfiguredBranch(root, config, source, expectedTrackingCommit) {
  if (!/^[a-f0-9]{40}$/i.test(source)) {
    throw new Error("FileGRC requires an exact commit ID before pushing the authoritative branch.");
  }
  const url = assertSafeAutomaticTransport(root, config.remote, { push: true });
  const target = {
    remote: config.remote,
    url,
    destination: `refs/heads/${config.authoritativeBranch}`,
    trackingRef: `refs/remotes/${config.remote}/${config.authoritativeBranch}`,
    expectedTrackingCommit
  };
  await measureTiming("push", () => gitForWriteAsync(
    root,
    exactPushArgs(target, source),
    `push ${config.authoritativeBranch} to ${config.remote}`,
    {
      expectedCheckout: {
        expectedRef: `refs/heads/${config.authoritativeBranch}`,
        expectedCommit: source
      }
    }
  ));
  const trackingError = await reconcileRemoteTrackingAsync(root, target, source);
  return { remotePushed: true, trackingError };
}

async function reconcileRemoteTrackingAsync(root, target, commit) {
  try {
    await gitForWriteAsync(root, [
      "update-ref", "-m", "FileGRC exact push",
      target.trackingRef,
      commit,
      target.expectedTrackingCommit || "0000000000000000000000000000000000000000"
    ], "reconcile the remote-tracking branch after a successful push");
    return null;
  } catch (error) {
    return `${error.message} The exact commit was pushed, but the local remote-tracking branch needs reconciliation with Git.`;
  }
}

function assertSafeAutomaticTransport(root, remote, options = {}) {
  assertNoRepositoryExecutableGitConfig(root);
  const url = tryGit(root, ["remote", "get-url", ...(options.push ? ["--push"] : []), "--", remote]);
  const safe = url
    && !/[\0\r\n]/.test(url)
    && (
      /^(?:https?|ssh|file):\/\//i.test(url)
      || /^(?:\.\.?[\\/]|[\\/]|[A-Za-z]:[\\/])/.test(url)
      || /^[^\s/@:]+@[^\s/:]+:.+$/.test(url)
    );
  if (!safe) {
    throw new Error(`FileGRC will not use the configured remote "${remote}" because its URL scheme is not allowed for automatic fetch or push.`);
  }
  return url;
}

function assertNoRepositoryExecutableGitConfig(root) {
  assertWorkspaceInsideGitWorktree(root);
  const pattern = "^(core\\.(sshcommand|gitproxy|askpass|alternaterefscommand|worktree|sparsecheckout.*)|credential\\.(helper|.*\\.helper)|fetch\\.bundleuri|filter\\..*\\.(clean|smudge|process)|merge\\..*\\.driver|http\\..*|remote\\..*\\.(proxy|uploadpack|receivepack)|url\\..*\\.(insteadof|pushinsteadof)|protocol\\..*\\.allow)$";
  const scopes = ["--local"];
  if (gitOptionalMatch(root, ["config", "--local", "--type=bool", "--get", "extensions.worktreeConfig"]) === "true") {
    scopes.push("--worktree");
  }
  const executableConfiguration = scopes
    .map((scope) => gitOptionalMatch(root, ["config", scope, "--get-regexp", pattern]))
    .find(Boolean);
  if (executableConfiguration) {
    throw new Error("FileGRC will not run managed Git synchronization while repository-local executable transport, filter, merge, HTTP, credential, URL rewrite, or protocol configuration is present. Move trusted user and transport settings to normal user-level Git configuration and remove the local override.");
  }
  assertNoHiddenIndexEntries(root);
}

function assertWorkspaceInsideGitWorktree(root) {
  const workspace = realpathSync(root);
  const topLevel = realpathSync(git(root, ["rev-parse", "--show-toplevel"]));
  if (workspace !== topLevel && !workspace.startsWith(`${topLevel}${sep}`)) {
    throw new Error("FileGRC will not run managed Git writes because repository configuration redirects the Git worktree outside this workspace. Remove core.worktree and reopen the authoritative checkout.");
  }
}

function assertExpectedCheckout(root, expectedRef, expectedCommit) {
  if (!checkoutMatches(root, expectedRef, expectedCommit)) {
    throw new Error("The checked-out Git branch or commit changed while FileGRC prepared the operation. Review the worktree and return to the expected branch before trying again.");
  }
}

function checkoutMatches(root, expectedRef, expectedCommit) {
  return tryGit(root, ["symbolic-ref", "--quiet", "HEAD"]) === expectedRef
    && tryGit(root, ["rev-parse", "HEAD"]) === expectedCommit;
}

function assertValidGitIdentity(root) {
  try {
    git(root, ["var", "GIT_AUTHOR_IDENT"]);
    git(root, ["var", "GIT_COMMITTER_IDENT"]);
  } catch {
    throw new Error("Configure valid git user.name and git user.email values before FileGRC creates commits. The saved files remain uncommitted and later browser changes are blocked.");
  }
}

async function assertNoOutsideWorktreeChangesAsync(root) {
  const topLevel = (await runGitCommand(root, ["rev-parse", "--show-toplevel"], {
    operation: "locate the repository before checking worktree changes"
  })).trim();
  const prefix = relative(topLevel, root).split(sep).join("/");
  const output = await runGitCommand(topLevel, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
    operation: "inspect worktree changes"
  });
  const paths = statusPathsFromRaw(output);
  if (paths.some((path) => !pathInsideWorkspace(path, prefix))) {
    throw new Error("Files outside this FileGRC workspace changed while the browser action was running. FileGRC preserved the current worktree; reconcile the Git diff before another browser mutation.");
  }
}

function assertNoWorkspaceContentFilters(root) {
  const paths = [...new Set(nulFields(gitRaw(root, [
    "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "."
  ])))];
  for (let offset = 0; offset < paths.length; offset += 256) {
    const batch = paths.slice(offset, offset + 256);
    const attributes = nulFields(gitRaw(root, ["check-attr", "-z", "filter", "merge", "--", ...batch]));
    for (let index = 0; index < attributes.length; index += 3) {
      const [path, attribute, value] = attributes.slice(index, index + 3);
      if (attribute === "filter" && value && !["unspecified", "unset"].includes(value)) {
        throw new Error(`FileGRC will not commit "${path}" because Git content filter "${value}" could change or execute while staging authoritative files. Remove the filter attribute and review the resulting diff.`);
      }
      if (attribute === "merge" && value && !["unspecified", "unset", "set"].includes(value)) {
        throw new Error(`FileGRC will not manage "${path}" because Git merge driver "${value}" could execute while synchronizing authoritative files. Remove the named merge attribute and review the resulting diff.`);
      }
    }
  }
}

function assertNoCommitWorkspaceContentFilters(root, commit) {
  const topLevel = git(root, ["rev-parse", "--show-toplevel"]);
  const gitDirectory = git(root, ["rev-parse", "--absolute-git-dir"]);
  const prefix = relative(topLevel, root).split(sep).join("/");
  if (prefix === ".." || prefix.startsWith("../")) {
    throw new Error("The FileGRC workspace is outside its Git repository.");
  }
  const exactCommit = git(root, ["rev-parse", "--verify", `${commit}^{commit}`]);
  const paths = nulFields(gitRaw(topLevel, [
    "ls-tree", "-r", "-z", exactCommit, "--", prefix || "."
  ])).map((entry) => {
    const separator = entry.indexOf("\t");
    const metadata = separator === -1 ? [] : entry.slice(0, separator).split(" ");
    const path = separator === -1 ? "" : entry.slice(separator + 1);
    const [mode, type, objectId] = metadata;
    if (!/^(?:100644|100755)$/.test(mode || "") || type !== "blob" || !/^[a-f0-9]+$/i.test(objectId || "") || !path) {
      throw new Error(`FileGRC will not check out incoming commit ${exactCommit.slice(0, 12)} because its workspace tree contains a non-regular entry. Replace symlinks and submodules with regular, reviewable files before synchronizing.`);
    }
    return path;
  });
  const indexFile = resolve(gitDirectory, `filegrc-inspection-index-${randomUUID()}`);
  try {
    gitForWrite(topLevel, ["read-tree", exactCommit], "inspect the incoming Git tree", { gitIndexFile: indexFile });
    for (let offset = 0; offset < paths.length; offset += 256) {
      const batch = paths.slice(offset, offset + 256);
      const attributes = nulFields(gitRaw(topLevel, ["check-attr", "-z", "--cached", "filter", "merge", "--", ...batch], {
        gitIndexFile: indexFile
      }));
      for (let index = 0; index < attributes.length; index += 3) {
        const [path, attribute, value] = attributes.slice(index, index + 3);
        if (attribute === "filter" && value && !["unspecified", "unset"].includes(value)) {
          throw new Error(`FileGRC will not check out incoming commit ${exactCommit.slice(0, 12)} because "${path}" uses Git content filter "${value}". Remove the filter attribute in a reviewed Git change before synchronizing.`);
        }
        if (attribute === "merge" && value && !["unspecified", "unset", "set"].includes(value)) {
          throw new Error(`FileGRC will not check out incoming commit ${exactCommit.slice(0, 12)} because "${path}" uses Git merge driver "${value}". Remove the named merge attribute in a reviewed Git change before synchronizing.`);
        }
      }
    }
  } finally {
    rmSync(indexFile, { force: true });
    rmSync(`${indexFile}.lock`, { force: true });
  }
}

function assertNoIgnoredAuthoritativeFiles(root) {
  const ignored = nulFields(gitRaw(root, [
    "ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--", "data"
  ]));
  if (ignored.length) {
    throw new Error(`FileGRC will not commit while authoritative data files are ignored by Git: ${ignored.slice(0, 5).join(", ")}${ignored.length > 5 ? "…" : ""}. Remove the ignore rule and review the complete staged diff.`);
  }
}

function workspaceByteManifest(root) {
  assertNoHiddenIndexEntries(root);
  const objectFormat = repositoryObjectFormat(root);
  if (!objectFormat) throw new Error("FileGRC could not determine the Git repository object format.");
  const paths = [...new Set(nulFields(gitRaw(root, [
    "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "."
  ])))].sort();
  const workspace = realpathSync(root);
  return new Map(paths.map((path) => {
    if (!path || path.startsWith("/") || path.split("/").includes("..") || /[\0\r\n]/.test(path)) {
      throw new Error("Git reported an unsafe workspace path. Reconcile the worktree before committing.");
    }
    const absolute = resolve(root, path);
    let stat;
    try {
      stat = lstatSync(absolute);
    } catch (error) {
      if (error?.code === "ENOENT") return [path, { objectId: null, mode: null }];
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`FileGRC will not commit symbolic link "${path}". Store authoritative content as a regular file and review its target explicitly.`);
    }
    if (!stat.isFile()) {
      throw new Error(`FileGRC will not commit non-file workspace entry "${path}".`);
    }
    const descriptor = openSync(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const opened = fstatSync(descriptor);
      const resolved = realpathSync(absolute);
      const current = lstatSync(absolute);
      if (
        !opened.isFile()
        || (resolved !== workspace && !resolved.startsWith(`${workspace}${sep}`))
        || current.isSymbolicLink()
        || !current.isFile()
        || opened.dev !== current.dev
        || opened.ino !== current.ino
      ) {
        throw new Error(`FileGRC will not commit workspace entry "${path}" because it changed while its bytes were being inspected.`);
      }
      const objectHash = createHash(objectFormat).update(`blob ${opened.size}\0`);
      const byteHash = createHash("sha256");
      const buffer = Buffer.allocUnsafe(64 * 1024);
      let position = 0;
      while (position < opened.size) {
        const count = readSync(descriptor, buffer, 0, Math.min(buffer.length, opened.size - position), position);
        if (!count) throw new Error(`FileGRC could not read complete workspace entry "${path}".`);
        const chunk = buffer.subarray(0, count);
        objectHash.update(chunk);
        byteHash.update(chunk);
        position += count;
      }
      const after = fstatSync(descriptor);
      if (
        after.size !== opened.size
        || after.dev !== opened.dev
        || after.ino !== opened.ino
        || after.mtimeMs !== opened.mtimeMs
        || after.ctimeMs !== opened.ctimeMs
      ) {
        throw new Error(`FileGRC will not commit workspace entry "${path}" because it changed while its bytes were being inspected.`);
      }
      const calculatedObjectId = objectHash.digest("hex");
      const objectId = workspaceBlobObjectIdOverride?.(null, objectFormat, path) ?? calculatedObjectId;
      return [path, {
        objectId,
        byteDigest: byteHash.digest("hex"),
        size: opened.size,
        mode: opened.mode & 0o111 ? "100755" : "100644"
      }];
    } finally {
      closeSync(descriptor);
    }
  }));
}

function assertNoHiddenIndexEntries(root) {
  const hidden = nulFields(gitRaw(root, ["ls-files", "-v", "-z", "--cached", "--", "."]))
    .filter((entry) => entry[0] === "S" || entry[0] === entry[0]?.toLowerCase());
  if (hidden.length) {
    const paths = hidden.slice(0, 5).map((entry) => entry.slice(2));
    throw new Error(`FileGRC will not run managed Git operations while index entries use skip-worktree or assume-unchanged: ${paths.join(", ")}${hidden.length > 5 ? "…" : ""}. Clear those Git index flags and review the complete workspace diff.`);
  }
}

function writeWorkspaceManifestObjects(root, manifest) {
  const valuesByObjectId = new Map();
  for (const value of manifest.values()) {
    if (!value.objectId) continue;
    const prior = valuesByObjectId.get(value.objectId);
    if (prior && (prior.size !== value.size || prior.byteDigest !== value.byteDigest)) {
      throw new Error(`Git object ${value.objectId} identifies different validated workspace bytes.`);
    }
    valuesByObjectId.set(value.objectId, value);
  }
  if (!valuesByObjectId.size) return manifest;
  const entries = [...manifest].filter(([, value]) => value.objectId);
  const topLevel = git(root, ["rev-parse", "--show-toplevel"]);
  const workspacePrefix = relative(topLevel, root).split(sep).join("/");
  if (workspacePrefix === ".." || workspacePrefix.startsWith("../")) {
    throw new Error("The FileGRC workspace is outside its Git repository.");
  }
  const written = observedExecFileSync("git", ["hash-object", "-w", "--stdin-paths"], {
    cwd: root,
    input: `${entries.map(([path]) => workspacePrefix ? `${workspacePrefix}/${path}` : path).join("\n")}\n`,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "ignore"],
    timeout: 30_000,
    maxBuffer: 20_000_000,
    env: gitEnvironment()
  }).trim().split("\n");
  if (written.length !== entries.length) {
    throw new Error("Git returned an unexpected number of workspace objects.");
  }
  for (let index = 0; index < entries.length; index += 1) {
    if (written[index] !== entries[index][1].objectId) {
      throw new Error(`Git wrote an unexpected object while preparing validated workspace bytes for commit.`);
    }
  }
  assertWorkspaceManifestEqual(manifest, workspaceByteManifest(root));
  return manifest;
}

function assertWorkspaceManifestEqual(expected, current) {
  if (!workspaceManifestsEqual(expected, current)) {
    throw new Error("Workspace files changed while FileGRC was validating them. Review the concurrent edit and try the action again.");
  }
}

function workspaceManifestsEqual(expected, current) {
  return expected.size === current.size
    && [...expected].every(([path, value]) => {
      const other = current.get(path);
      return other
        && value.objectId === other.objectId
        && value.mode === other.mode
        && value.size === other.size
        && value.byteDigest === other.byteDigest;
    });
}

async function commitValidatedIndexAsync(root, subject, manifest, options) {
  assertWorkspaceInsideGitWorktree(root);
  assertNoGitOperationInProgress(root);
  const parent = options.expectedParent;
  const ref = options.expectedRef;
  assertExpectedCheckout(root, ref, parent);
  const gitDirectory = await runGitCommand(root, ["rev-parse", "--absolute-git-dir"], { operation: "locate the repository index" });
  const sharedIndex = resolve(root, await runGitCommand(root, ["rev-parse", "--git-path", "index"], { operation: "locate the shared repository index" }));
  const expectedSharedIndex = readFileSync(sharedIndex);
  const indexFile = resolve(gitDirectory, `filegrc-index-${randomUUID()}`);
  const sharedUpdateIndex = resolve(gitDirectory, `filegrc-shared-index-${randomUUID()}`);
  let indexReconciled = false;
  try {
    writeFileSync(sharedUpdateIndex, expectedSharedIndex);
    await applyManifestToIndexAsync(root, manifest, sharedUpdateIndex);
    await runGitCommand(root, ["read-tree", parent], { operation: "initialize the private FileGRC index", gitIndexFile: indexFile });
    await applyManifestToIndexAsync(root, manifest, indexFile);
    const tree = await runGitCommand(root, ["write-tree"], { operation: "capture the validated FileGRC tree", gitIndexFile: indexFile });
    const commit = await runGitCommand(root, ["commit-tree", tree, "-p", parent, "-m", subject], {
      operation: "create the validated FileGRC browser commit",
      timeoutMs: GIT_REMOTE_TIMEOUT_MS
    });
    assertNoGitOperationInProgress(root);
    await runGitCommand(root, ["update-ref", "-m", subject, ref, commit, parent], {
      operation: "advance the authoritative branch to the validated FileGRC commit",
      expectedCheckout: { expectedRef: ref, expectedCommit: parent },
      expectedNoOperation: true
    });
    if (!gitOperationInProgress(root) && checkoutMatches(root, ref, commit)) {
      indexReconciled = replaceSharedIndexIfUnchanged(sharedIndex, sharedUpdateIndex, expectedSharedIndex);
    }
    return { commit, indexReconciled: indexReconciled ?? false };
  } finally {
    await Promise.all([
      rm(indexFile, { force: true }),
      rm(`${indexFile}.lock`, { force: true }),
      rm(sharedUpdateIndex, { force: true }),
      rm(`${sharedUpdateIndex}.lock`, { force: true })
    ].map((cleanup) => cleanup.catch(() => undefined)));
  }
}

function replaceSharedIndexIfUnchanged(sharedIndex, privateIndex, expected) {
  const lock = `${sharedIndex}.lock`;
  let descriptor;
  let installed = false;
  let ownsLock = false;
  try {
    descriptor = openSync(lock, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o666);
    ownsLock = true;
    if (!readFileSync(sharedIndex).equals(expected)) return false;
    writeFileSync(descriptor, readFileSync(privateIndex));
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(lock, sharedIndex);
    installed = true;
    return true;
  } catch {
    return false;
  } finally {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { /* Best-effort cleanup after reconciliation. */ }
    }
    if (ownsLock && !installed) {
      try { rmSync(lock, { force: true }); } catch { /* Best-effort cleanup after reconciliation. */ }
    }
  }
}

async function applyManifestToIndexAsync(root, manifest, indexFile) {
  const options = { operation: "write the validated FileGRC index", ...(indexFile ? { gitIndexFile: indexFile } : {}) };
  for (const args of manifestIndexCommands(root, manifest)) await runGitCommand(root, args, options);
}

function manifestIndexCommands(root, manifest) {
  const topLevel = git(root, ["rev-parse", "--show-toplevel"]);
  const prefix = relative(topLevel, root).split(sep).join("/");
  if (prefix === ".." || prefix.startsWith("../")) throw new Error("The FileGRC workspace is outside its Git repository.");
  const additions = [];
  const deletions = [];
  for (const [path, value] of manifest) {
    const repositoryPath = prefix ? `${prefix}/${path}` : path;
    if (value.objectId) additions.push(`${value.mode},${value.objectId},${repositoryPath}`);
    else deletions.push(repositoryPath);
  }
  const commands = [];
  for (let offset = 0; offset < additions.length; offset += 128) {
    commands.push(["update-index", "--add", ...additions.slice(offset, offset + 128).flatMap((entry) => ["--cacheinfo", entry])]);
  }
  for (let offset = 0; offset < deletions.length; offset += 256) {
    commands.push(["update-index", "--force-remove", "--", ...deletions.slice(offset, offset + 256)]);
  }
  return commands;
}

function statusPathsFromRaw(output) {
  if (!output) return [];
  const fields = nulFields(output);
  const paths = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (!/^[ MADRCU?!]{2} /.test(field)) {
      paths.push(field);
      continue;
    }
    const status = field.slice(0, 2);
    paths.push(field.slice(3));
    if (/[RC]/.test(status) && fields[index + 1] !== undefined) paths.push(fields[++index]);
  }
  return paths;
}

function pathInsideWorkspace(path, prefix) {
  return !prefix || path === prefix || path.startsWith(`${prefix}/`);
}

function generatedCommitMessage(value) {
  const subject = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (subject || "Update FileGRC workspace").slice(0, 200);
}

function cleanGitName(value, fallback) {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
}

function parseLogLine(line) {
  if (!line) return null;
  const [commit, timestamp, author, subject] = line.split("\x1f");
  return { commit, shortCommit: commit?.slice(0, 8), timestamp, author, subject };
}

function lines(source) {
  return source ? source.split("\n").filter(Boolean) : [];
}

function parsePorcelainV2(source, topLevel, root) {
  const fields = source.split("\0").filter(Boolean);
  const prefix = relative(topLevel, root).split(sep).join("/");
  let commit = null;
  let branch = null;
  let upstream = null;
  let ahead = null;
  let behind = null;
  const allChanges = [];
  const workspaceChanges = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (field.startsWith("# branch.oid ")) commit = field.slice(13) === "(initial)" ? null : field.slice(13);
    else if (field.startsWith("# branch.head ")) branch = field.slice(14) === "(detached)" ? null : field.slice(14);
    else if (field.startsWith("# branch.upstream ")) upstream = field.slice(18);
    else if (field.startsWith("# branch.ab ")) {
      const match = /\+(\d+) -(\d+)/.exec(field);
      if (match) [ahead, behind] = match.slice(1).map(Number);
    } else if (/^[12u?!] /.test(field)) {
      const path = porcelainV2Path(field);
      allChanges.push(field);
      const originalPath = field.startsWith("2 ") ? fields[index + 1] : null;
      if (pathInsideWorkspace(path, prefix) || originalPath && pathInsideWorkspace(originalPath, prefix)) {
        workspaceChanges.push(field);
      }
      if (originalPath) index += 1;
    }
  }
  return { commit, branch, upstream, ahead, behind, allChanges, workspaceChanges };
}

function parseWorkspaceRevision(source) {
  const fields = source.split("\0").filter(Boolean);
  let commit = null;
  let branch = null;
  const changePaths = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (field.startsWith("# branch.oid ")) {
      commit = field.slice(13) === "(initial)" ? null : field.slice(13);
    } else if (field.startsWith("# branch.head ")) {
      branch = field.slice(14) === "(detached)" ? null : field.slice(14);
    } else if (/^[12u?!] /.test(field)) {
      changePaths.push(porcelainV2Path(field));
      if (field.startsWith("2 ")) {
        changePaths.push(fields[++index]);
      }
    }
  }
  return {
    commit,
    branch,
    changePaths: [...new Set(changePaths.filter(Boolean))].sort()
  };
}

function porcelainV2Path(field) {
  if (field.startsWith("? ") || field.startsWith("! ")) return field.slice(2);
  const requiredSpaces = field.startsWith("2 ") ? 9 : field.startsWith("u ") ? 10 : 8;
  let offset = 0;
  for (let count = 0; count < requiredSpaces; count += 1) {
    offset = field.indexOf(" ", offset) + 1;
    if (!offset) return "";
  }
  return field.slice(offset);
}

function parsePendingCommitPaths(source) {
  return source.split("\x1e").flatMap((block) => {
    const [header, ...paths] = block.trim().split("\n").filter(Boolean);
    if (!header) return [];
    const [commit, subject] = header.split("\x1f");
    return [{ commit, subject, paths }];
  });
}

function repositoryOperationFromDirectory(gitDirectory) {
  if (!gitDirectory) return null;
  for (const [name, path] of [
    ["merge", "MERGE_HEAD"],
    ["rebase", "rebase-merge"],
    ["rebase", "rebase-apply"],
    ["cherry-pick", "CHERRY_PICK_HEAD"],
    ["sequencer", "sequencer"],
    ["revert", "REVERT_HEAD"],
    ["bisect", "BISECT_START"]
  ]) {
    if (existsSync(resolve(gitDirectory, path))) return name;
  }
  return null;
}

function assertNoGitOperationInProgress(root) {
  const operation = gitOperationInProgress(root);
  if (operation) {
    throw new Error(`A Git ${operation} is already in progress. Finish or abort it with Git before using FileGRC synchronization.`);
  }
}

function gitOperationInProgress(root) {
  const gitDirectory = tryGit(root, ["rev-parse", "--absolute-git-dir"]);
  return repositoryOperationFromDirectory(gitDirectory);
}

export function setGitCommandInterceptorForTests(interceptor) {
  if (interceptor !== null && typeof interceptor !== "function") {
    throw new TypeError("The Git command interceptor must be a function or null.");
  }
  const previous = gitCommandInterceptor;
  gitCommandInterceptor = interceptor;
  return () => { gitCommandInterceptor = previous; };
}

export function setGitSubprocessObserverForTests(observer) {
  if (observer !== null && typeof observer !== "function") {
    throw new TypeError("The Git subprocess observer must be a function or null.");
  }
  const previous = gitSubprocessObserver;
  gitSubprocessObserver = observer;
  return () => { gitSubprocessObserver = previous; };
}

export function setHistoricalRevisionReadObserverForTests(observer) {
  if (observer !== null && typeof observer !== "function") {
    throw new TypeError("The historical revision-read observer must be a function or null.");
  }
  const previous = historicalRevisionReadObserver;
  historicalRevisionReadObserver = observer;
  return () => { historicalRevisionReadObserver = previous; };
}

export function setWorkspaceBlobObjectIdOverrideForTests(override) {
  if (override !== null && typeof override !== "function") {
    throw new TypeError("The workspace blob object ID override must be a function or null.");
  }
  const previous = workspaceBlobObjectIdOverride;
  workspaceBlobObjectIdOverride = override;
  return () => { workspaceBlobObjectIdOverride = previous; };
}

export function runGitCommand(cwd, args, options = {}) {
  if (gitCommandInterceptor) {
    return Promise.resolve().then(() => gitCommandInterceptor({
      cwd,
      args: [...args],
      options: { ...options },
      run: () => runGitCommandNative(cwd, args, options)
    }));
  }
  return runGitCommandNative(cwd, args, options);
}

export function runGitCommandSync(cwd, args, options = {}) {
  return git(resolveWorkspaceRoot(cwd), args, options);
}

function runGitCommandNative(cwd, args, options = {}) {
  if (options.expectedCheckout) {
    assertExpectedCheckout(
      cwd,
      options.expectedCheckout.expectedRef,
      options.expectedCheckout.expectedCommit
    );
  }
  if (options.expectedNoOperation) assertNoGitOperationInProgress(cwd);
  const operation = options.operation || "run a Git command";
  const configuredTimeout = options.timeoutMs ?? GIT_DEFAULT_TIMEOUT_MS;
  const { timeoutMs, deadlineLimited } = gitTimeoutPlan(configuredTimeout, GIT_DEFAULT_TIMEOUT_MS);
  const maxOutputBytes = Math.max(1, Number(options.maxOutputBytes) || GIT_MAX_OUTPUT_BYTES);
  gitSubprocessObserver?.({ kind: "async", cwd, args: [...args], options: { ...options } });
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      env: gitEnvironment({
        ...(options.gitIndexFile ? { GIT_INDEX_FILE: options.gitIndexFile } : {}),
        GIT_TERMINAL_PROMPT: "0",
        GIT_ASKPASS: "",
        SSH_ASKPASS: "",
        GIT_MERGE_AUTOEDIT: "no"
      })
    });
    const stdout = [];
    const stderr = [];
    let outputSize = 0;
    let settled = false;
    let timedOut = false;
    let outputExceeded = false;
    let forceKillTimer;
    const terminate = (signal) => {
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        try { child.kill(signal); } catch { /* The child already exited. */ }
      }
    };
    const stop = () => {
      terminate("SIGTERM");
      forceKillTimer = setTimeout(() => terminate("SIGKILL"), 1_000);
      forceKillTimer.unref?.();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeoutMs);
    timer.unref?.();
    const collect = (target, chunk) => {
      outputSize += chunk.length;
      if (outputSize <= maxOutputBytes) target.push(chunk);
      else if (!outputExceeded) {
        outputExceeded = true;
        stop();
      }
    };
    child.stdout.on("data", (chunk) => collect(stdout, chunk));
    child.stderr.on("data", (chunk) => collect(stderr, chunk));
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(forceKillTimer);
      rejectCommand(new GitOperationError(
        error.code === "ENOENT" ? "missing-executable" : "command-failure",
        operation,
        error.code === "ENOENT" ? "" : error.message,
        { cause: error, code: error.code }
      ));
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(forceKillTimer);
      const output = Buffer.concat(stdout).toString("utf8");
      const errorOutput = Buffer.concat(stderr).toString("utf8").trim();
      if (code === 0 && !timedOut && !outputExceeded) return resolveCommand(output.trim());
      const detail = outputExceeded
        ? `Git output exceeded ${maxOutputBytes} bytes.`
        : timedOut
          ? `The operation exceeded ${timeoutMs} ms and the process group was terminated.`
          : errorOutput || `Git exited with status ${code ?? signal ?? "unknown"}.`;
      const kind = timedOut
        ? "timeout"
        : /not a git repository|outside repository/i.test(errorOutput)
          ? "invalid-repository"
          : "command-failure";
      rejectCommand(new GitOperationError(kind, operation, detail, {
        code: timedOut && deadlineLimited ? "FILEGRC_GIT_DEADLINE" : undefined
      }));
    });
  });
}

async function tryGitAsync(cwd, args, operation) {
  try {
    return await runGitCommand(cwd, args, { operation });
  } catch {
    return "";
  }
}

function git(cwd, args, options = {}) {
  return cachedGitCommand("text", cwd, args, options, () => {
    return measureTimingSync("git-command-sync", () => observedExecFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: Math.max(1, Number(options.timeoutMs) || GIT_DEFAULT_TIMEOUT_MS),
      maxBuffer: 20_000_000,
      env: gitEnvironment()
    }).trim());
  });
}

function tryGit(cwd, args) {
  try {
    return git(cwd, args);
  } catch (error) {
    if (error?.code === "FILEGRC_GIT_DEADLINE") throw error;
    return "";
  }
}

function gitOptionalMatch(cwd, args) {
  try {
    return git(cwd, args);
  } catch (error) {
    if (error?.status === 1) return "";
    throw error;
  }
}

function tryGitRaw(cwd, args) {
  try {
    return gitRaw(cwd, args);
  } catch (error) {
    if (error?.code === "FILEGRC_GIT_DEADLINE") throw error;
    return "";
  }
}

function gitRaw(cwd, args, options = {}) {
  return cachedGitCommand("raw", cwd, args, options, () => {
    return observedExecFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: Math.max(1, Number(options.timeoutMs) || GIT_DEFAULT_TIMEOUT_MS),
      maxBuffer: 20_000_000,
      env: gitEnvironment(options.gitIndexFile ? { GIT_INDEX_FILE: options.gitIndexFile } : {})
    });
  });
}

function cachedGitCommand(outputKind, cwd, args, options, run) {
  const cache = gitCommandCaches.getStore();
  if (!cache) return run();
  const key = JSON.stringify([
    outputKind,
    resolve(cwd),
    args,
    options.gitIndexFile || null
  ]);
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached.value;
  }
  const value = run();
  const size = Buffer.byteLength(value);
  if (size <= GIT_COMMAND_CACHE_MAX_ENTRY_BYTES) {
    let totalBytes = gitCommandCacheBytes.get(cache) || 0;
    while (cache.size >= GIT_COMMAND_CACHE_MAX_ENTRIES || totalBytes + size > GIT_COMMAND_CACHE_MAX_BYTES) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey === undefined) break;
      totalBytes -= cache.get(oldestKey)?.size || 0;
      cache.delete(oldestKey);
    }
    cache.set(key, { value, size });
    gitCommandCacheBytes.set(cache, totalBytes + size);
  }
  return value;
}

function observedExecFileSync(executable, args, options = {}) {
  const timeoutPlan = executable === "git"
    ? gitTimeoutPlan(options.timeout, GIT_DEFAULT_TIMEOUT_MS)
    : null;
  const boundedOptions = timeoutPlan
    ? { ...options, timeout: timeoutPlan.timeoutMs }
    : options;
  try {
    if (executable === "git") {
      gitSubprocessObserver?.({
        kind: "sync",
        cwd: boundedOptions.cwd,
        args: [...args],
        options: { ...boundedOptions, input: boundedOptions.input === undefined ? undefined : "[redacted]" }
      });
    }
    return execFileSync(executable, args, boundedOptions);
  } catch (error) {
    if (timeoutPlan?.deadlineLimited && (error?.code === "ETIMEDOUT" || error?.signal)) {
      const deadlineError = new Error("The Git command exceeded the shared request deadline.", { cause: error });
      deadlineError.code = "FILEGRC_GIT_DEADLINE";
      throw deadlineError;
    }
    throw error;
  }
}

function boundedGitTimeout(configured, fallback) {
  return gitTimeoutPlan(configured, fallback).timeoutMs;
}

function gitTimeoutPlan(configured, fallback) {
  const requested = Math.max(1, Number(configured) || fallback);
  const deadlineAt = gitCommandDeadlines.getStore();
  if (deadlineAt === undefined) return { timeoutMs: requested, deadlineLimited: false };
  const remaining = Math.ceil(deadlineAt - performance.now());
  if (remaining <= 0) {
    const error = new Error("The Git command deadline expired before another subprocess could start.");
    error.code = "FILEGRC_GIT_DEADLINE";
    throw error;
  }
  return {
    timeoutMs: Math.min(requested, remaining),
    deadlineLimited: remaining <= requested
  };
}

function rethrowGitDeadline(error) {
  if (error?.code === "FILEGRC_GIT_DEADLINE") throw error;
}

function nulFields(source) {
  return source ? source.split("\0").filter(Boolean) : [];
}

function gitForWrite(cwd, args, action = "create the commit", options = {}) {
  try {
    assertWorkspaceInsideGitWorktree(cwd);
    return observedExecFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
      maxBuffer: 20_000_000,
      env: gitEnvironment({
        ...(options.gitIndexFile ? { GIT_INDEX_FILE: options.gitIndexFile } : {}),
        GIT_TERMINAL_PROMPT: "0",
        GIT_MERGE_AUTOEDIT: "no"
      })
    }).trim();
  } catch (error) {
    const message = sanitizeGitErrorMessage(error.stderr?.trim() || error.stdout?.trim() || error.message);
    throw new Error(`Git could not ${action}. ${message}`);
  }
}

async function gitForWriteAsync(cwd, args, action = "update the repository", options = {}) {
  assertWorkspaceInsideGitWorktree(cwd);
  return runGitCommand(cwd, args, {
    operation: action,
    timeoutMs: GIT_REMOTE_TIMEOUT_MS,
    ...options
  });
}

export function sanitizeGitErrorMessage(value) {
  const sanitized = String(value || "Git returned no error detail.")
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, "$1[redacted]@")
    .replace(/([?&][^=&#\s]+)=([^&#\s]*)/g, "$1=[redacted]")
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s#]+)#[^\s]*/gi, "$1#[redacted]")
    .replace(/\b(authorization:\s*)(?:basic|bearer)\s+\S+/gi, "$1[redacted]");
  return sanitized.length > 8_000 ? `${sanitized.slice(0, 8_000)}…` : sanitized;
}
