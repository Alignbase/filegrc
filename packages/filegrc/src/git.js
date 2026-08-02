import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { isSafeGitName } from "./git-name.js";
import { serializeWorkspaceMutation, withDeferredWorkspaceValidation } from "./mutation.js";
import { resolveWorkspaceRoot } from "./paths.js";
import { measureTiming, measureTimingSync, timingEnabled } from "./timing.js";
import { fingerprintWorkspace, validateWorkspace } from "./validate.js";
import { loadWorkspace } from "./workspace.js";

const lastSuccessfulSynchronizations = new Map();
const workspaceHistoryCache = new Map();
const backgroundSynchronizations = new Map();
export const BROWSER_VALIDATION = Symbol("filegrc.browserValidation");

export function getGitSummary(input = process.cwd()) {
  const root = resolveWorkspaceRoot(input);
  try {
    const topLevel = git(root, ["rev-parse", "--show-toplevel"]);
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
  try {
    const output = git(root, [
      "log",
      "--follow",
      `--max-count=${Math.max(1, Math.min(Number(limit) || 50, 200))}`,
      "--format=%H%x1f%aI%x1f%an%x1f%s",
      "--",
      relativePath
    ]);
    if (!output) return [];
    return output.split("\n").map(parseLogLine);
  } catch {
    return [];
  }
}

export function getWorkspaceHistories(input, relativePaths, limitPerFile = 12) {
  const root = resolveWorkspaceRoot(input);
  const wanted = new Set(relativePaths);
  const histories = new Map([...wanted].map((path) => [path, []]));
  if (!wanted.size) return histories;
  const head = tryGit(root, ["rev-parse", "HEAD"]) || null;
  const cached = workspaceHistoryCache.get(root);
  if (cached?.head === head && cached.limitPerFile === limitPerFile) {
    for (const path of wanted) histories.set(path, cached.histories.get(path) ?? []);
    return histories;
  }
  const allHistories = new Map();
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
    // An uncommitted workspace has no history yet.
  }
  workspaceHistoryCache.set(root, { head, limitPerFile, histories: allHistories });
  for (const path of wanted) histories.set(path, allHistories.get(path) ?? []);
  return histories;
}

export function getFileAtRevision(input, revision, relativePath) {
  const root = resolveWorkspaceRoot(input);
  if (!/^[a-f0-9]{40}$/i.test(String(revision)) || typeof relativePath !== "string" || !relativePath.startsWith("data/")) {
    throw new Error("Historical file exports require a Git commit and a data/ path.");
  }
  try {
    return execFileSync("git", ["show", `${revision}:${relativePath}`], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
      maxBuffer: 20_000_000
    });
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

export async function getBrowserRepositoryState(input = process.cwd(), options = {}) {
  const root = resolveWorkspaceRoot(input);
  const config = await getRepositoryConfig(root);
  const gitSummary = getGitSummary(root);
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
    const before = requireTrunkPreconditions(root, config, { allowAhead: true });
    await fetchConfiguredRemote(root, config.remote);
    const synchronized = inspectTrunkRepository(root, config, getGitSummary(root));
    if (synchronized.behind > 0 && synchronized.ahead > 0) {
      throw new Error("The authoritative branch has diverged from its upstream. FileGRC will not merge or rebase it. Reconcile the repository with Git, then reload.");
    }
    if (synchronized.behind > 0) {
      fastForwardConfiguredBranch(root, synchronized.upstream);
    }
    const ready = inspectTrunkRepository(root, config, getGitSummary(root));
    if (ready.ahead > 0 && !ready.pendingCommitsFilegrcOnly) {
      throw new Error("At least one commit ahead of upstream changes files outside this FileGRC workspace. FileGRC will not push it. Reconcile the repository with Git.");
    }
    if (ready.ahead > 0) await pushConfiguredBranch(root, config);
    const after = inspectTrunkRepository(root, config, getGitSummary(root));
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
  requireTrunkPreconditions(root, config);
  await fetchConfiguredRemote(root, config.remote);
  let synchronized = inspectTrunkRepository(root, config, getGitSummary(root));
  if (synchronized.ahead > 0 && synchronized.behind > 0) {
    throw new Error("The authoritative branch has diverged from its upstream. FileGRC will not merge or rebase it. Reconcile the repository with Git, then reload.");
  }
  if (synchronized.ahead > 0) {
    throw new Error("The authoritative branch has local commits waiting to be pushed. Use Retry sync before making another browser change.");
  }
  if (synchronized.behind > 0) {
    fastForwardConfiguredBranch(root, synchronized.upstream);
    synchronized = inspectTrunkRepository(root, config, getGitSummary(root));
  }
  if (synchronized.ahead !== 0 || synchronized.behind !== 0) {
    throw new Error("The authoritative branch is not synchronized with its upstream. Reload after reconciling the repository with Git.");
  }

  let result;
  let subject;
  let validationProof;
  try {
    result = await withDeferredWorkspaceValidation(() => task(root));
    subject = generatedCommitMessage(typeof options?.message === "function" ? options.message(result) : options?.message);
    const validation = await validateWorkspace(root);
    if (!validation.ok) {
      throw new Error(`The workspace has ${validation.counts.errors} validation ${validation.counts.errors === 1 ? "error" : "errors"}. The browser change was rolled back.`);
    }
    validationProof = {
      validation,
      fingerprint: (await fingerprintWorkspace(validation.loaded)).fingerprint
    };
    assertNoOutsideWorktreeChanges(root);
  } catch (error) {
    try {
      await rollbackWorkspaceChanges(root);
    } catch (rollbackError) {
      throw new Error(`${error.message} FileGRC could not roll back the workspace change. ${rollbackError.message} Later browser mutations are blocked until the Git worktree is reconciled.`);
    }
    throw error;
  }

  if (!getGitSummary(root).changes.length && options?.allowNoChanges === true) {
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
  if (!getGitSummary(root).changes.length) {
    throw new Error("The browser action did not change any FileGRC workspace files.");
  }
  if (!tryGit(root, ["config", "user.name"]) || !tryGit(root, ["config", "user.email"])) {
    throw new Error("Configure git user.name and git user.email before browser changes can be committed. The saved files remain uncommitted and later browser changes are blocked.");
  }
  gitForWrite(root, ["add", "--all", "--", "."], "stage the FileGRC workspace change");
  assertNoOutsideWorktreeChanges(root, false);
  assertOnlyWorkspaceFilesStaged(root);
  try {
    measureTimingSync("commit", () => {
      gitForWrite(root, ["commit", "-m", subject, "--", "."], "create the FileGRC browser commit");
    });
  } catch (error) {
    throw new Error(`${error.message} The saved files remain in the Git worktree and later browser changes are blocked.`);
  }

  const committed = getGitSummary(root);
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
  if (result && typeof result === "object") {
    Object.defineProperty(result, BROWSER_VALIDATION, { value: proof });
  }
  return result;
}

function queueBackgroundPush(root, config, committed, delayMs = 0) {
  backgroundSynchronizations.set(root, {
    status: "syncing",
    commit: committed.commit,
    shortCommit: committed.shortCommit,
    startedAt: new Date().toISOString(),
    error: null
  });
  const start = () => {
    try {
      const ready = requireTrunkPreconditions(root, config, { allowAhead: true });
      if (ready.currentCommit !== committed.commit) {
        throw new Error("The authoritative branch changed after FileGRC created its browser commit. FileGRC did not push it.");
      }
      if (ready.behind > 0) {
        throw new Error("The authoritative branch changed upstream after FileGRC created its browser commit. FileGRC did not push it.");
      }
      if (ready.ahead < 1 || !ready.pendingCommitsFilegrcOnly) {
        throw new Error("The pending commits are no longer limited to this FileGRC workspace. FileGRC did not push them.");
      }
      void finishBackgroundPush(root, config, committed);
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
    const after = inspectTrunkRepository(root, config, getGitSummary(root), { ignoreBackground: true });
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

async function getRepositoryConfig(root) {
  const loaded = await loadWorkspace(root);
  const renderer = loaded.resources.find(({ type, id }) => type === "renderer-settings" && id === "renderer-settings");
  const mode = renderer?.repositoryMode === "trunk" ? "trunk" : "manual";
  const authoritativeBranch = cleanGitName(renderer?.authoritativeBranch, "main");
  const remote = cleanGitName(renderer?.repositoryRemote, "origin");
  return {
    mode,
    authoritativeBranch,
    remote,
    configurationError: !isSafeGitName(authoritativeBranch)
      ? "The configured authoritative branch is not a safe Git branch name. Update renderer settings before using browser writes."
      : !isSafeGitName(remote)
        ? "The configured repository remote is not a safe Git remote name. Update renderer settings before using browser writes."
        : null
  };
}

function inspectTrunkRepository(root, config, summary = getGitSummary(root), options = {}) {
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
    wholeWorktreeClean: summary.available ? wholeWorktreeClean(root) : null,
    operationInProgress: summary.available ? repositoryOperation(root) : null,
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
      status: "git-setup-required",
      label: "Git setup required",
      message: "Git is unavailable. Install Git and open this workspace from its authoritative repository checkout."
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
  const upstreamCommit = tryGit(root, ["rev-parse", expectedUpstream]) || null;
  const counts = upstreamCommit ? aheadBehind(root, expectedUpstream) : { ahead: null, behind: null };
  const pendingCommits = counts.ahead > 0 ? commitsAhead(root, expectedUpstream) : [];
  const pendingCommitsFilegrcOnly = counts.ahead > 0 ? commitsOnlyTouchWorkspace(root, expectedUpstream) : true;
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

function requireTrunkPreconditions(root, config, options = {}) {
  const summary = getGitSummary(root);
  const state = inspectTrunkRepository(root, config, summary);
  if (config.configurationError) throw new Error(state.message);
  if (!summary.available) throw new Error(state.message);
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

function fastForwardConfiguredBranch(root, upstream) {
  gitForWrite(root, ["merge", "--ff-only", "--", upstream], `fast-forward from ${upstream}`);
}

async function pushConfiguredBranch(root, config, source = "HEAD") {
  return measureTiming("push", () => gitForWriteAsync(
    root,
    ["push", "--porcelain", "--", config.remote, `${source}:refs/heads/${config.authoritativeBranch}`],
    `push ${config.authoritativeBranch} to ${config.remote}`
  ));
}

function wholeWorktreeClean(root) {
  return git(root, ["status", "--porcelain=v1"]) === "";
}

function repositoryOperation(root) {
  for (const [name, gitPath] of [
    ["merge", "MERGE_HEAD"],
    ["rebase", "rebase-merge"],
    ["rebase", "rebase-apply"],
    ["cherry-pick", "CHERRY_PICK_HEAD"]
  ]) {
    const path = tryGit(root, ["rev-parse", "--git-path", gitPath]);
    if (path && existsSync(resolve(root, path))) return name;
  }
  return null;
}

function aheadBehind(root, upstream) {
  const output = tryGit(root, ["rev-list", "--left-right", "--count", `HEAD...${upstream}`]);
  const [ahead, behind] = output.split(/\s+/).map(Number);
  return Number.isInteger(ahead) && Number.isInteger(behind)
    ? { ahead, behind }
    : { ahead: null, behind: null };
}

function commitsAhead(root, upstream) {
  return lines(tryGit(root, ["log", "--format=%H%x1f%s", `${upstream}..HEAD`])).map((line) => {
    const [commit, subject] = line.split("\x1f");
    return { commit, shortCommit: commit.slice(0, 8), subject };
  });
}

function commitsOnlyTouchWorkspace(root, upstream) {
  const topLevel = git(root, ["rev-parse", "--show-toplevel"]);
  const prefix = relative(topLevel, root).split(sep).join("/");
  const commits = lines(tryGit(root, ["rev-list", `${upstream}..HEAD`]));
  return commits.every((commit) => {
    const paths = nulFields(tryGitRaw(topLevel, [
      "diff-tree",
      "--no-commit-id",
      "--name-only",
      "-z",
      "-r",
      "--root",
      commit
    ]));
    return paths.length > 0 && paths.every((path) => pathInsideWorkspace(path, prefix));
  });
}

function assertNoOutsideWorktreeChanges(root, rollbackExpected = true) {
  const topLevel = git(root, ["rev-parse", "--show-toplevel"]);
  const prefix = relative(topLevel, root).split(sep).join("/");
  const paths = statusPaths(topLevel);
  if (paths.some((path) => !pathInsideWorkspace(path, prefix))) {
    throw new Error(rollbackExpected
      ? "Files outside this FileGRC workspace changed while the browser action was running. The FileGRC change was rolled back; reconcile the other Git work first."
      : "Files outside this FileGRC workspace changed while the browser action was being staged. The saved FileGRC files remain uncommitted and later browser mutations are blocked; reconcile the Git worktree.");
  }
}

function assertOnlyWorkspaceFilesStaged(root) {
  const topLevel = git(root, ["rev-parse", "--show-toplevel"]);
  const prefix = relative(topLevel, root).split(sep).join("/");
  const staged = nulFields(tryGitRaw(topLevel, [
    "diff",
    "--cached",
    "--name-only",
    "-z",
    "--diff-filter=ACDMRTUXB"
  ]));
  if (!staged.length) throw new Error("The browser action did not stage any FileGRC workspace files.");
  if (staged.some((path) => !pathInsideWorkspace(path, prefix))) {
    throw new Error("Git has staged files outside this FileGRC workspace. FileGRC will not create a browser commit until those files are unstaged.");
  }
}

async function rollbackWorkspaceChanges(root) {
  gitForWrite(root, ["restore", "--staged", "--worktree", "--source=HEAD", "--", "."], "roll back the FileGRC workspace change");
  const untracked = nulFields(tryGitRaw(root, ["ls-files", "-z", "--others", "--exclude-standard", "--", "."]));
  for (const path of untracked) {
    const absolute = resolve(root, path);
    if (absolute === root || !absolute.startsWith(`${root}${sep}`)) continue;
    await rm(absolute, { force: true });
  }
}

function statusPaths(topLevel) {
  const output = tryGitRaw(topLevel, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
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

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 10_000,
    maxBuffer: 20_000_000
  }).trim();
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
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_MERGE_AUTOEDIT: "no"
      }
    });
    const stdout = [];
    const stderr = [];
    let size = 0;
    let timedOut = false;
    let forceKillTimer = null;
    const terminate = (signal) => {
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        try {
          child.kill(signal);
        } catch {
          // The process may have exited between the timeout and termination.
        }
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminate("SIGTERM");
      forceKillTimer = setTimeout(() => terminate("SIGKILL"), 2_000);
    }, 30_000);
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size <= 20_000_000) stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      size += chunk.length;
      if (size <= 20_000_000) stderr.push(chunk);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      clearTimeout(forceKillTimer);
      reject(new Error(`Git could not ${action}. ${sanitizeGitErrorMessage(error.message)}`));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      clearTimeout(forceKillTimer);
      const output = Buffer.concat(stdout).toString("utf8").trim();
      const errorOutput = Buffer.concat(stderr).toString("utf8").trim();
      if (code === 0 && !timedOut && size <= 20_000_000) {
        resolve(output);
        return;
      }
      const detail = size > 20_000_000
        ? "Git output exceeded 20 MB."
        : timedOut
          ? "Git timed out after 30 seconds."
          : errorOutput || output || `Git exited with status ${code}.`;
      const message = sanitizeGitErrorMessage(detail);
      reject(new Error(`Git could not ${action}. ${message}`));
    });
  });
}

export function sanitizeGitErrorMessage(value) {
  return String(value || "Git returned no error detail.")
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, "$1[redacted]@")
    .replace(/([?&](?:access[_-]?token|auth|key|password|secret|token)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\b(authorization:\s*)(?:basic|bearer)\s+\S+/gi, "$1[redacted]");
}

function tryGitForWrite(cwd, args) {
  try {
    gitForWrite(cwd, args);
  } catch {
    // Best-effort cleanup after a failed remote operation.
  }
}
