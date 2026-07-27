import { execFileSync } from "node:child_process";
import { serializeWorkspaceMutation } from "./mutation.js";
import { resolveWorkspaceRoot } from "./paths.js";
import { validateWorkspace } from "./validate.js";

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
  try {
    const output = git(root, ["log", "--relative", "--format=%x1e%H%x1f%aI%x1f%an%x1f%s", "--name-only", "--", "data"]);
    for (const block of output.split("\x1e")) {
      const lines = block.trim().split("\n").filter(Boolean);
      if (lines.length < 2) continue;
      const commit = parseLogLine(lines[0]);
      for (const path of lines.slice(1)) {
        const history = histories.get(path);
        if (history && history.length < limitPerFile) history.push(commit);
      }
    }
  } catch {
    // An uncommitted workspace has no history yet.
  }
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
  if (!summary.available) throw new Error(`Git history is unavailable for this workspace, so FileGRC cannot ${action}.`);
  if (!summary.branch) throw new Error(`Check out a branch before trying to ${action}.`);
  if (!summary.clean) throw new Error(`Commit or discard workspace changes before trying to ${action}.`);
  return summary;
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
    const message = error.stderr?.trim() || error.stdout?.trim() || error.message;
    throw new Error(`Git could not ${action}. ${message}`);
  }
}

function tryGitForWrite(cwd, args) {
  try {
    gitForWrite(cwd, args);
  } catch {
    // Best-effort cleanup after a failed remote operation.
  }
}
