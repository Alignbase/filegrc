import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
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
const backgroundSynchronizations = new Map();
const browserRemotePrefetches = new Map();
const browserRemotePrefetchPromises = new Map();
const repositorySnapshotPromises = new Map();
let gitCommandInterceptor = null;
const BROWSER_REMOTE_PREFETCH_MAX_AGE_MS = 30_000;
const GIT_DEFAULT_TIMEOUT_MS = 10_000;
const GIT_REMOTE_TIMEOUT_MS = 30_000;
const GIT_MAX_OUTPUT_BYTES = 20_000_000;
export const BROWSER_VALIDATION = Symbol("filegrc.browserValidation");

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
  try {
    const countArgs = Number(limit) >= Number.MAX_SAFE_INTEGER
      ? []
      : [`--max-count=${Math.max(1, Math.min(Number(limit) || 50, 200))}`];
    const output = git(root, [
      "log",
      "--follow",
      ...countArgs,
      "--format=%H%x1f%aI%x1f%an%x1f%s",
      "--",
      relativePath
    ]);
    if (!output) return [];
    return output.split("\n").map(parseLogLine);
  } catch {
    return null;
  }
}

export function getFileHistoryWithPaths(input, relativePath, limit = 50) {
  const root = resolveWorkspaceRoot(input);
  if (!isSafeDataGitPath(relativePath)) return null;
  try {
    const countArgs = Number(limit) >= Number.MAX_SAFE_INTEGER
      ? []
      : [`--max-count=${Math.max(1, Math.min(Number(limit) || 50, 200))}`];
    const output = gitRaw(root, [
      "log",
      "--follow",
      "-z",
      ...countArgs,
      "--format=%H%x00%aI%x00%an%x00%s%x00",
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
  } catch {
    return null;
  }
}

export function getDataCommitHistory(input) {
  const root = resolveWorkspaceRoot(input);
  try {
    return lines(git(root, ["log", "--reverse", "--format=%H", "--", "data"]));
  } catch {
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
  } catch {
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

export function getDataRecordHistoryIndex(input) {
  const root = resolveWorkspaceRoot(input);
  const head = tryGit(root, ["rev-parse", "HEAD"]) || null;
  const cached = dataRecordHistoryIndexCache.get(root);
  if (cached?.head === head) return cached;
  const changes = [];
  const shallow = head && tryGit(root, ["rev-parse", "--is-shallow-repository"]) === "true";
  let available = Boolean(head) && !shallow;
  let error = !head
    ? new Error("Git history is unavailable because the workspace has no committed HEAD.")
    : shallow ? new Error("Git history is shallow.") : null;
  try {
    if (available) {
      const output = gitRaw(root, [
        "log", "--reverse", "-m", "-z", "--relative",
        "--format=%H%x00%aI%x00%an%x00%s%x00", "--name-status", "-M", "--", "data"
      ]);
      changes.push(...parseDataRecordHistory(output));
    }
  } catch (cause) {
    available = false;
    error = cause;
  }
  const sources = available
    ? getFilesAtRevisions(
      root,
      changes.map(({ summary, path }) => ({ revision: summary.commit, relativePath: path })),
      { batchSize: 512 }
    )
    : [];
  if (head && sources.some((source) => source === null)) {
    available = false;
    error ||= new Error("Git could not read every historical data record.");
  }
  const recordsByCommit = new Map();
  const historiesById = new Map();
  for (let index = 0; index < changes.length; index += 1) {
    const { summary, path } = changes[index];
    try {
      const record = JSON.parse(sources[index]);
      if (!record?.id) continue;
      if (!recordsByCommit.has(summary.commit)) recordsByCommit.set(summary.commit, new Map());
      recordsByCommit.get(summary.commit).set(record.id, { record, path });
      if (!historiesById.has(record.id)) historiesById.set(record.id, []);
      historiesById.get(record.id).push({ ...summary, path });
    } catch {
      // Ignore malformed historical files.
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
    commits: [...new Set(changes.map(({ summary }) => summary.commit))],
    recordsByCommit,
    historiesById
  };
  if (available) {
    dataRecordHistoryIndexCache.set(root, result);
    while (dataRecordHistoryIndexCache.size > 16) dataRecordHistoryIndexCache.delete(dataRecordHistoryIndexCache.keys().next().value);
  }
  return result;
}

function parseDataRecordHistory(output) {
  const fields = output.split("\0");
  const changes = [];
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
      if (status === "D") continue;
      const path = renamed ? second : first;
      if (path.startsWith("data/") && path.endsWith(".json")) {
        if (!isSafeDataGitPath(path)) throw new Error("Git returned an unsafe data-history path.");
        changes.push({ summary, path });
      }
    }
  }
  return changes;
}

export function isGitAncestor(input, ancestor, descendant) {
  if (!/^[a-f0-9]{40}$/i.test(String(ancestor)) || !/^[a-f0-9]{40}$/i.test(String(descendant))) return false;
  const root = resolveWorkspaceRoot(input);
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
      cwd: root,
      stdio: "ignore",
      timeout: 10_000
    });
    return true;
  } catch {
    return false;
  }
}

export function getFileBufferAtRevision(input, revision, relativePath) {
  if (!/^[a-f0-9]{40}$/i.test(String(revision)) || !isSafeDataGitPath(relativePath)) return null;
  const root = resolveWorkspaceRoot(input);
  try {
    const topLevel = git(root, ["rev-parse", "--show-toplevel"]);
    const workspacePrefix = relative(topLevel, root).split(sep).join("/");
    if (workspacePrefix === ".." || workspacePrefix.startsWith("../")) return null;
    const repositoryPath = workspacePrefix ? `${workspacePrefix}/${relativePath}` : relativePath;
    return execFileSync("git", ["show", `${revision}:${repositoryPath}`], {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
      maxBuffer: 20_000_000
    });
  } catch {
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
  } catch {
    return null;
  }
}

export function getWorkingFileObjectId(input, relativePath) {
  if (!isSafeDataGitPath(relativePath)) return null;
  const root = resolveWorkspaceRoot(input);
  try {
    const objectId = git(root, ["hash-object", "--no-filters", "--", relativePath]);
    return /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i.test(objectId) ? objectId : null;
  } catch {
    return null;
  }
}

export function getWorkspaceHistories(input, relativePaths, limitPerFile = 12, options = {}) {
  const root = resolveWorkspaceRoot(input);
  const wanted = new Set(relativePaths);
  const histories = new Map([...wanted].map((path) => [path, []]));
  if (!wanted.size) return histories;
  const head = tryGit(root, ["rev-parse", "HEAD"]) || null;
  const cached = workspaceHistoryCache.get(root);
  if (cached?.head === head && cached.limitPerFile === limitPerFile) {
    if (options.strict === true && cached.available === false) {
      throw new Error("Git history is unavailable for the requested workspace files.");
    }
    for (const path of wanted) histories.set(path, cached.histories.get(path) ?? []);
    return histories;
  }
  const allHistories = new Map();
  let available = true;
  try {
    const output = git(root, ["log", "--relative", "--format=%x1e%H%x1f%aI%x1f%an%x1f%s", "--name-only", "--", "data"]);
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
  } catch {
    available = false;
    if (options.strict === true) {
      throw new Error("Git history is unavailable for the requested workspace files.");
    }
    // Browser and workflow views tolerate an uncommitted workspace with no history yet.
  }
  workspaceHistoryCache.set(root, { head, limitPerFile, histories: allHistories, available });
  for (const path of wanted) histories.set(path, allHistories.get(path) ?? []);
  return histories;
}

export function getFileAtRevision(input, revision, relativePath) {
  return getFilesAtRevisions(input, [{ revision, relativePath }])[0];
}

export function getFilesAtRevisions(input, requests, options = {}) {
  const root = resolveWorkspaceRoot(input);
  const invalid = Array.isArray(requests) && requests.find(({ revision, relativePath } = {}) => (
    !/^[a-f0-9]{40}$/i.test(String(revision)) || !isSafeDataGitPath(relativePath)
  ));
  if (!Array.isArray(requests) || invalid) {
    throw new Error("Historical file exports require a Git commit and a data/ path.");
  }
  if (!requests.length) return [];
  try {
    const topLevel = git(root, ["rev-parse", "--show-toplevel"]);
    const workspacePrefix = relative(topLevel, root).split(sep).join("/");
    if (workspacePrefix === ".." || workspacePrefix.startsWith("../")) return requests.map(() => null);
    const results = [];
    const batchSize = Math.max(1, Math.min(Number(options.batchSize) || 4, 512));
    for (let offset = 0; offset < requests.length; offset += batchSize) {
      const batch = requests.slice(offset, offset + batchSize);
      const specifications = batch.map(({ revision, relativePath }) => {
        const repositoryPath = workspacePrefix ? `${workspacePrefix}/${relativePath}` : relativePath;
        return `${revision}:${repositoryPath}`;
      });
      try {
        const output = measureTimingSync("git-history-export", () => execFileSync("git", ["cat-file", "--batch"], {
          cwd: root,
          input: `${specifications.join("\n")}\n`,
          stdio: ["pipe", "pipe", "ignore"],
          timeout: 10_000,
          maxBuffer: 80_000_000
        }));
        results.push(...parseBatchObjects(output, batch.length));
      } catch {
        results.push(...specifications.map((specification) => readHistoricalFile(root, specification)));
      }
    }
    return results;
  } catch {
    return requests.map(() => null);
  }
}

export function getDataFilesAtRevision(input, revision) {
  if (!/^[a-f0-9]{40}$/i.test(String(revision))) return [];
  const root = resolveWorkspaceRoot(input);
  try {
    const topLevel = git(root, ["rev-parse", "--show-toplevel"]);
    const workspacePrefix = relative(topLevel, root).split(sep).join("/");
    if (workspacePrefix === ".." || workspacePrefix.startsWith("../")) return [];
    const dataPrefix = workspacePrefix ? `${workspacePrefix}/data` : "data";
    return lines(git(root, ["ls-tree", "-r", "--name-only", revision, "--", dataPrefix]))
      .filter((path) => path.startsWith(`${dataPrefix}/`) && path.endsWith(".json"))
      .map((path) => workspacePrefix ? path.slice(workspacePrefix.length + 1) : path);
  } catch {
    return [];
  }
}

function readHistoricalFile(root, specification) {
  try {
    return measureTimingSync("git-history-export", () => execFileSync("git", ["show", specification], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
      maxBuffer: 20_000_000
    }));
  } catch {
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
  } catch {
    return null;
  }
}

export function hasGitRevision(input, revision) {
  if (!/^[a-f0-9]{40}$/i.test(String(revision))) return false;
  const root = resolveWorkspaceRoot(input);
  try {
    git(root, ["cat-file", "-e", `${revision}^{commit}`]);
    return true;
  } catch {
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

export async function getWorkspaceRevisionSnapshot(input = process.cwd()) {
  const root = resolveWorkspaceRoot(input);
  try {
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
    return unavailableSnapshot(error);
  }
  const [topLevel, gitDirectory] = repositoryPaths.split("\n");
  try {
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
  await fetchConfiguredRemote(root, prepared.config.remote);
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
    await fetchConfiguredRemote(root, config.remote);
    const synchronized = inspectTrunkRepository(root, config, await getRepositorySnapshot(root, { fresh: true }));
    if (synchronized.behind > 0 && synchronized.ahead > 0) {
      throw new Error("The authoritative branch has diverged from its upstream. FileGRC will not merge or rebase it. Reconcile the repository with Git, then reload.");
    }
    if (synchronized.behind > 0) {
      await fastForwardConfiguredBranchAsync(root, synchronized.upstream);
    }
    const ready = inspectTrunkRepository(root, config, await getRepositorySnapshot(root, { fresh: true }));
    if (ready.ahead > 0 && !ready.pendingCommitsFilegrcOnly) {
      throw new Error("At least one commit ahead of upstream changes files outside this FileGRC workspace. FileGRC will not push it. Reconcile the repository with Git.");
    }
    if (ready.ahead > 0) await pushConfiguredBranch(root, config);
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
    await fetchConfiguredRemote(root, config.remote);
    synchronized = inspectTrunkRepository(root, config, await getRepositorySnapshot(root, { fresh: true }));
  }
  if (synchronized.ahead > 0 && synchronized.behind > 0) {
    throw new Error("The authoritative branch has diverged from its upstream. FileGRC will not merge or rebase it. Reconcile the repository with Git, then reload.");
  }
  if (synchronized.ahead > 0) {
    throw new Error("The authoritative branch has local commits waiting to be pushed. Use Retry sync before making another browser change.");
  }
  if (synchronized.behind > 0) {
    await fastForwardConfiguredBranchAsync(root, synchronized.upstream);
    synchronized = inspectTrunkRepository(root, config, await getRepositorySnapshot(root, { fresh: true }));
  }
  if (synchronized.ahead !== 0 || synchronized.behind !== 0) {
    throw new Error("The authoritative branch is not synchronized with its upstream. Reload after reconciling the repository with Git.");
  }

  let result;
  let subject;
  let validationProof;
  try {
    result = await measureTiming("write", () => withDeferredWorkspaceValidation(() => task(root, {
      repositorySnapshot: synchronized
    })));
    subject = generatedCommitMessage(typeof options?.message === "function" ? options.message(result) : options?.message);
    const validation = await validateWorkspace(root);
    if (!validation.ok) {
      throw new Error(`The workspace has ${validation.counts.errors} validation ${validation.counts.errors === 1 ? "error" : "errors"}. The browser change was rolled back.`);
    }
    validationProof = options?.includeValidationProof === false
      ? null
      : {
          validation,
          fingerprint: (await measureTiming("fingerprint", () => fingerprintWorkspace(validation.loaded))).fingerprint
        };
    await assertNoOutsideWorktreeChangesAsync(root);
  } catch (error) {
    try {
      await rollbackWorkspaceChangesAsync(root);
    } catch (rollbackError) {
      throw new Error(`${error.message} FileGRC could not roll back the workspace change. ${rollbackError.message} Later browser mutations are blocked until the Git worktree is reconciled.`);
    }
    throw error;
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
  let identity;
  try {
    identity = await runGitCommand(root, ["config", "--get-regexp", "^user\\.(name|email)$"], {
      operation: "read the Git user identity"
    });
  } catch (error) {
    if (error instanceof GitOperationError && error.kind === "command-failure") identity = "";
    else throw error;
  }
  if (!/^user\.name\s+.+$/m.test(identity) || !/^user\.email\s+.+$/m.test(identity)) {
    throw new Error("Configure git user.name and git user.email before browser changes can be committed. The saved files remain uncommitted and later browser changes are blocked.");
  }
  await measureTiming("stage", () => runGitCommand(root, ["add", "--all", "--", "."], {
    operation: "stage the FileGRC workspace change",
    timeoutMs: GIT_REMOTE_TIMEOUT_MS
  }));
  await assertNoOutsideWorktreeChangesAsync(root, false);
  await assertOnlyWorkspaceFilesStagedAsync(root);
  try {
    await measureTiming("commit", () => runGitCommand(root, ["commit", "-m", subject, "--", "."], {
      operation: "create the FileGRC browser commit",
      timeoutMs: GIT_REMOTE_TIMEOUT_MS
    }));
  } catch (error) {
    throw new Error(`${error.message} The saved files remain in the Git worktree and later browser changes are blocked.`);
  }

  const commit = await runGitCommand(root, ["rev-parse", "HEAD"], {
    operation: "read the FileGRC browser commit"
  });
  const committed = { commit, shortCommit: commit.slice(0, 8) };
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
      const ready = await requireTrunkPreconditionsAsync(root, config, { allowAhead: true });
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
  try {
    await pushConfiguredBranch(root, config, committed.commit);
    const after = inspectTrunkRepository(root, config, await getRepositorySnapshot(root, { fresh: true }), { ignoreBackground: true });
    if (after.ahead !== 0 || after.behind !== 0) {
      throw new Error("The authoritative branch is still not synchronized after the background push.");
    }
    const synchronizedAt = new Date().toISOString();
    lastSuccessfulSynchronizations.set(root, synchronizedAt);
    backgroundSynchronizations.delete(root);
    outcome = "synced";
  } catch (error) {
    recordBackgroundPushFailure(root, committed, error);
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
  backgroundSynchronizations.set(root, {
    status: "failed",
    commit: committed.commit,
    shortCommit: committed.shortCommit,
    startedAt: backgroundSynchronizations.get(root)?.startedAt ?? null,
    finishedAt: new Date().toISOString(),
    error: `${error.message} The local FileGRC commit was retained. Use Retry sync after the remote is available.`
  });
}

async function commitWorkspaceUnlocked(root, message) {
  const subject = String(message ?? "").trim();
  if (!subject || subject.length > 200 || /[\u0000-\u001f\u007f]/.test(subject)) {
    throw new Error("Commit messages must be one line from 1 through 200 characters.");
  }
  const validation = await validateWorkspace(root);
  if (!validation.ok) {
    throw new Error(`The workspace has ${validation.counts.errors} validation ${validation.counts.errors === 1 ? "error" : "errors"}. Fix them before committing.`);
  }
  const before = getGitSummary(root);
  if (!before.available) throw new Error("Git history is unavailable for this workspace.");
  if (!before.branch) throw new Error("Check out a branch before creating a browser commit.");
  if (before.clean) throw new Error("The workspace has no changes to commit.");
  if (!tryGit(root, ["config", "user.name"]) || !tryGit(root, ["config", "user.email"])) {
    throw new Error("Configure git user.name and user.email before committing.");
  }
  gitForWrite(root, ["add", "--all", "--", "."]);
  gitForWrite(root, ["commit", "-m", subject, "--", "."]);
  const after = getGitSummary(root);
  return {
    commit: after.commit,
    shortCommit: after.shortCommit,
    subject: after.lastCommit?.subject || subject
  };
}

async function commitAndPushWorkspaceUnlocked(root, message) {
  const before = getGitSummary(root);
  const committed = await commitWorkspaceUnlocked(root, message);
  if (!before.upstream && !before.remotes?.length) {
    return {
      ...committed,
      pushed: false,
      pushSkipped: true
    };
  }
  try {
    const pushed = await pushWorkspaceUnlocked(root);
    return {
      ...committed,
      pushed: true,
      pushSkipped: false,
      upstream: pushed.upstream
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
  if (!before.upstream) {
    throw new Error("This branch has no upstream branch. Push it first or configure an upstream with Git.");
  }
  try {
    gitForWrite(root, ["pull", "--rebase", "--no-autostash"], "pull with rebase");
  } catch (error) {
    tryGitForWrite(root, ["rebase", "--abort"]);
    throw error;
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
  const validation = await validateWorkspace(root);
  if (!validation.ok) {
    throw new Error(`The workspace has ${validation.counts.errors} validation ${validation.counts.errors === 1 ? "error" : "errors"}. Fix them before pushing.`);
  }
  if (before.upstream) {
    gitForWrite(root, ["push"], "push");
  } else {
    const remote = before.remotes.includes("origin")
      ? "origin"
      : before.remotes.length === 1
        ? before.remotes[0]
        : null;
    if (!remote) {
      throw new Error(before.remotes.length
        ? "This branch has no upstream and the repository has multiple remotes. Configure an upstream with Git."
        : "This repository has no Git remote. Add one before pushing.");
    }
    gitForWrite(root, ["push", "--set-upstream", "--", remote, "HEAD"], "push");
  }
  const after = getGitSummary(root);
  return {
    commit: after.commit,
    shortCommit: after.shortCommit,
    branch: after.branch,
    upstream: after.upstream
  };
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
      && counts.ahead > 0
      && counts.behind === 0
      && pendingCommitsFilegrcOnly
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
            : "The authoritative branch is behind upstream. The next browser mutation will fast-forward before writing."),
      writesAllowed: counts.ahead === 0 && counts.behind > 0,
      retrySafe: counts.ahead > 0 && counts.behind === 0 && pendingCommitsFilegrcOnly,
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
  if (state.operationInProgress) throw new Error(state.message);
  if (!state.wholeWorktreeClean) throw new Error(state.message);
  if (!options.allowAhead && state.ahead > 0) {
    throw new Error("The authoritative branch has local commits waiting to be pushed. Use Retry sync before making another browser change.");
  }
  return state;
}

async function fetchConfiguredRemote(root, remote) {
  return measureTiming("fetch", () => gitForWriteAsync(root, ["fetch", "--prune", "--", remote], `fetch ${remote}`));
}

function fastForwardConfiguredBranchAsync(root, upstream) {
  return runGitCommand(root, ["merge", "--ff-only", "--", upstream], {
    operation: `fast-forward from ${upstream}`,
    timeoutMs: GIT_REMOTE_TIMEOUT_MS
  });
}

async function pushConfiguredBranch(root, config, source = "HEAD") {
  return measureTiming("push", () => gitForWriteAsync(
    root,
    ["push", "--porcelain", "--", config.remote, `${source}:refs/heads/${config.authoritativeBranch}`],
    `push ${config.authoritativeBranch} to ${config.remote}`
  ));
}

async function assertNoOutsideWorktreeChangesAsync(root, rollbackExpected = true) {
  const topLevel = (await runGitCommand(root, ["rev-parse", "--show-toplevel"], {
    operation: "locate the repository before checking worktree changes"
  })).trim();
  const prefix = relative(topLevel, root).split(sep).join("/");
  const output = await runGitCommand(topLevel, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
    operation: "inspect worktree changes"
  });
  const paths = statusPathsFromRaw(output);
  if (paths.some((path) => !pathInsideWorkspace(path, prefix))) {
    throw new Error(rollbackExpected
      ? "Files outside this FileGRC workspace changed while the browser action was running. The FileGRC change was rolled back; reconcile the other Git work first."
      : "Files outside this FileGRC workspace changed while the browser action was being staged. The saved FileGRC files remain uncommitted and later browser mutations are blocked; reconcile the Git worktree.");
  }
}

async function assertOnlyWorkspaceFilesStagedAsync(root) {
  const topLevel = (await runGitCommand(root, ["rev-parse", "--show-toplevel"], {
    operation: "locate the repository before checking staged files"
  })).trim();
  const prefix = relative(topLevel, root).split(sep).join("/");
  const output = await runGitCommand(topLevel, [
    "diff", "--cached", "--name-only", "-z", "--diff-filter=ACDMRTUXB"
  ], { operation: "inspect staged FileGRC files" });
  const staged = nulFields(output);
  if (!staged.length) throw new Error("The browser action did not stage any FileGRC workspace files.");
  if (staged.some((path) => !pathInsideWorkspace(path, prefix))) {
    throw new Error("Git has staged files outside this FileGRC workspace. FileGRC will not create a browser commit until those files are unstaged.");
  }
}

async function rollbackWorkspaceChangesAsync(root) {
  await runGitCommand(root, ["restore", "--staged", "--worktree", "--source=HEAD", "--", "."], {
    operation: "roll back the FileGRC workspace change",
    timeoutMs: GIT_REMOTE_TIMEOUT_MS
  });
  const untracked = nulFields(await runGitCommand(
    root,
    ["ls-files", "-z", "--others", "--exclude-standard", "--", "."],
    { operation: "list untracked FileGRC files" }
  ));
  for (const path of untracked) {
    const absolute = resolve(root, path);
    if (absolute === root || !absolute.startsWith(`${root}${sep}`)) continue;
    await rm(absolute, { force: true });
  }
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
    ["cherry-pick", "CHERRY_PICK_HEAD"]
  ]) {
    if (existsSync(resolve(gitDirectory, path))) return name;
  }
  return null;
}

export function setGitCommandInterceptorForTests(interceptor) {
  if (interceptor !== null && typeof interceptor !== "function") {
    throw new TypeError("The Git command interceptor must be a function or null.");
  }
  const previous = gitCommandInterceptor;
  gitCommandInterceptor = interceptor;
  return () => { gitCommandInterceptor = previous; };
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

function runGitCommandNative(cwd, args, options = {}) {
  const operation = options.operation || "run a Git command";
  const configuredTimeout = options.timeoutMs ?? GIT_DEFAULT_TIMEOUT_MS;
  const timeoutMs = Math.max(1, Number(configuredTimeout) || GIT_DEFAULT_TIMEOUT_MS);
  const maxOutputBytes = Math.max(1, Number(options.maxOutputBytes) || GIT_MAX_OUTPUT_BYTES);
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_ASKPASS: "",
        SSH_ASKPASS: "",
        GIT_MERGE_AUTOEDIT: "no"
      }
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
      rejectCommand(new GitOperationError(kind, operation, detail));
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

function git(cwd, args) {
  return measureTimingSync("git-command-sync", () => execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 10_000,
    maxBuffer: 20_000_000
  }).trim());
}

function tryGit(cwd, args) {
  try {
    return git(cwd, args);
  } catch {
    return "";
  }
}

function tryGitRaw(cwd, args) {
  try {
    return gitRaw(cwd, args);
  } catch {
    return "";
  }
}

function gitRaw(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 10_000,
    maxBuffer: 20_000_000
  });
}

function nulFields(source) {
  return source ? source.split("\0").filter(Boolean) : [];
}

function gitForWrite(cwd, args, action = "create the commit") {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
      maxBuffer: 20_000_000,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_MERGE_AUTOEDIT: "no"
      }
    }).trim();
  } catch (error) {
    const message = sanitizeGitErrorMessage(error.stderr?.trim() || error.stdout?.trim() || error.message);
    throw new Error(`Git could not ${action}. ${message}`);
  }
}

async function gitForWriteAsync(cwd, args, action = "update the repository") {
  return runGitCommand(cwd, args, {
    operation: action,
    timeoutMs: GIT_REMOTE_TIMEOUT_MS
  });
}

export function sanitizeGitErrorMessage(value) {
  const sanitized = String(value || "Git returned no error detail.")
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, "$1[redacted]@")
    .replace(/([?&](?:access[_-]?token|auth|key|password|secret|token)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\b(authorization:\s*)(?:basic|bearer)\s+\S+/gi, "$1[redacted]");
  return sanitized.length > 8_000 ? `${sanitized.slice(0, 8_000)}…` : sanitized;
}

function tryGitForWrite(cwd, args) {
  try {
    gitForWrite(cwd, args);
  } catch {
    // Best-effort cleanup after a failed remote operation.
  }
}
