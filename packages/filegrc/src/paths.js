import { existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export function resolveWorkspaceRoot(input = process.cwd()) {
  let current = resolve(input);
  if (existsSync(current) && !isDirectory(current)) current = dirname(current);

  while (true) {
    if (existsSync(join(current, "data", "workspace.json"))) return canonicalWorkspaceRoot(current);
    if (existsSync(join(current, "workspace.json")) && current.endsWith(`${sep}data`)) {
      return canonicalWorkspaceRoot(dirname(current));
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  throw new Error("No FileGRC workspace was found from the requested path.");
}

export function isWithin(parent, candidate) {
  const path = relative(resolve(parent), resolve(candidate));
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

export function resolveDataPath(root, dataRelativePath) {
  if (typeof dataRelativePath !== "string" || !dataRelativePath) {
    throw new Error("A non-empty data-relative path is required");
  }
  if (isAbsolute(dataRelativePath) || dataRelativePath.includes("\0") || dataRelativePath.includes("\\")) {
    throw new Error(`Unsafe data path: ${dataRelativePath}`);
  }
  const dataRoot = join(resolveWorkspaceRoot(root), "data");
  const target = resolve(dataRoot, dataRelativePath);
  if (!isWithin(dataRoot, target)) throw new Error(`Path leaves data/: ${dataRelativePath}`);
  const realDataRoot = realpathSync(dataRoot);
  const existing = nearestExistingPath(target);
  if (!isWithin(realDataRoot, realExistingPath(existing, dataRelativePath))) {
    throw new Error(`Path resolves outside data/: ${dataRelativePath}`);
  }
  return target;
}

export function resolveWorkspacePath(root, workspacePath) {
  if (typeof workspacePath !== "string" || !workspacePath) {
    throw new Error("A non-empty workspace path is required");
  }
  const workspaceRoot = resolveWorkspaceRoot(root);
  const target = resolve(workspaceRoot, workspacePath);
  if (!isWithin(workspaceRoot, target)) throw new Error(`Path leaves the workspace: ${workspacePath}`);
  const existing = nearestExistingPath(target);
  if (!isWithin(workspaceRoot, realExistingPath(existing, workspacePath))) {
    throw new Error(`Path resolves outside the workspace: ${workspacePath}`);
  }
  return target;
}

export function resolveContentPath(root, dataRelativePath) {
  const segments = typeof dataRelativePath === "string" ? dataRelativePath.split("/") : [];
  if (
    segments.length < 2
    || segments[0] !== "content"
    || segments.some((segment) => !segment || segment === "." || segment === "..")
    || !segments.at(-1).endsWith(".md")
  ) {
    throw new Error("Long-form content must be a Markdown file under data/content/.");
  }
  return resolveDataPath(root, dataRelativePath);
}

export function relativeToWorkspace(root, path) {
  return relative(resolveWorkspaceRoot(root), path).split(sep).join("/");
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function canonicalWorkspaceRoot(path) {
  const root = realpathSync(path);
  const dataRoot = realpathSync(join(root, "data"));
  if (!isWithin(root, dataRoot)) {
    throw new Error("The data directory resolves outside the workspace.");
  }
  return root;
}

function nearestExistingPath(path) {
  let current = path;
  while (!entryExists(current)) {
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

function entryExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function realExistingPath(path, displayPath) {
  try {
    return realpathSync(path);
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`Path contains an unavailable symlink: ${displayPath}`);
    throw error;
  }
}
