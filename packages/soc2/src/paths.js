import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export function resolveWorkspaceRoot(input = process.cwd()) {
  let current = resolve(input);
  if (existsSync(current) && !isDirectory(current)) current = dirname(current);

  while (true) {
    if (existsSync(join(current, "data", "workspace.json"))) return current;
    if (existsSync(join(current, "workspace.json")) && current.endsWith(`${sep}data`)) {
      return dirname(current);
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  throw new Error(`No SOC 2 workspace found from ${resolve(input)}`);
}

export function isWithin(parent, candidate) {
  const path = relative(resolve(parent), resolve(candidate));
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

export function resolveDataPath(root, dataRelativePath) {
  if (typeof dataRelativePath !== "string" || !dataRelativePath) {
    throw new Error("A non-empty data-relative path is required");
  }
  if (isAbsolute(dataRelativePath) || dataRelativePath.includes("\0")) {
    throw new Error(`Unsafe data path: ${dataRelativePath}`);
  }
  const dataRoot = join(resolveWorkspaceRoot(root), "data");
  const target = resolve(dataRoot, dataRelativePath);
  if (!isWithin(dataRoot, target)) throw new Error(`Path leaves data/: ${dataRelativePath}`);
  const realDataRoot = realpathSync(dataRoot);
  const existing = nearestExistingPath(target);
  if (!isWithin(realDataRoot, realpathSync(existing))) {
    throw new Error(`Path resolves outside data/: ${dataRelativePath}`);
  }
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

function nearestExistingPath(path) {
  let current = path;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}
