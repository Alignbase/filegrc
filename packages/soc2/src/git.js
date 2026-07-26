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
    const last = commit ? parseLogLine(tryGit(root, ["log", "-1", "--format=%H%x1f%aI%x1f%an%x1f%s"])) : null;
    return {
      available: true,
      root: topLevel,
      commit,
      shortCommit: commit?.slice(0, 8) ?? "no commits",
      branch,
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

export async function commitWorkspace(input, message) {
  return serializeWorkspaceMutation(input, (root) => commitWorkspaceUnlocked(root, message));
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

function parseLogLine(line) {
  if (!line) return null;
  const [commit, timestamp, author, subject] = line.split("\x1f");
  return { commit, shortCommit: commit?.slice(0, 8), timestamp, author, subject };
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

function gitForWrite(cwd, args) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
      maxBuffer: 20_000_000
    }).trim();
  } catch (error) {
    const message = error.stderr?.trim() || error.stdout?.trim() || error.message;
    throw new Error(`Git could not create the commit. ${message}`);
  }
}
