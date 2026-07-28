import { existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";

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

  throw new Error("No filegrc workspace was found from the requested path.");
}

export function isWithin(parent, candidate) {
  const path = relative(resolve(parent), resolve(candidate));
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

export function resolveDataPath(root, dataRelativePath) {
  if (typeof dataRelativePath !== "string" || !dataRelativePath) {
    throw new Error("A non-empty data-relative path is required");
  }
  if (!isCanonicalDataPath(dataRelativePath)) {
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
  assertNoSymlinkComponents(dataRoot, target, dataRelativePath);
  return target;
}

export function isCanonicalDataPath(value) {
  return typeof value === "string"
    && Boolean(value)
    && !isAbsolute(value)
    && !value.includes("\0")
    && !value.includes("\\")
    && posix.normalize(value) === value;
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
  assertNoSymlinkComponents(workspaceRoot, target, workspacePath);
  return target;
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
  const dataPath = join(root, "data");
  const dataRoot = realpathSync(dataPath);
  if (!isWithin(root, dataRoot)) {
    throw new Error("The data directory resolves outside the workspace.");
  }
  if (lstatSync(dataPath).isSymbolicLink()) {
    throw new Error("The data directory must be a real directory, not a symbolic link.");
  }
  return root;
}

function assertNoSymlinkComponents(parent, target, displayPath) {
  const path = relative(parent, target);
  if (!path) return;
  let current = parent;
  for (const segment of path.split(sep)) {
    current = join(current, segment);
    try {
      if (lstatSync(current).isSymbolicLink()) {
        throw new Error(`Path contains a symbolic link: ${displayPath}`);
      }
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
  }
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
