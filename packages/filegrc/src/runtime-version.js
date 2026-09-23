import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveWorkspaceRoot } from "./paths.js";

const installedVersion = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

export function workspaceEngineVersion(input = process.cwd()) {
  let root;
  try {
    root = resolveWorkspaceRoot(input);
  } catch (error) {
    if (/No filegrc workspace was found/.test(error.message)) {
      return { installedVersion, lockedVersion: null, lockfilePath: null };
    }
    throw error;
  }
  const manifestPath = join(root, "package.json");
  let packageManaged = false;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    packageManaged = Boolean(manifest.dependencies?.filegrc || manifest.devDependencies?.filegrc);
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error(`Cannot read the workspace package.json: ${error.message}`);
  }
  let lock;
  try {
    lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" && !packageManaged) return { installedVersion, lockedVersion: null, lockfilePath: null };
    if (error.code === "ENOENT") throw versionDriftError("The workspace package-lock.json is missing. Run npm install to create it, then npm ci.");
    throw new Error(`Cannot read the workspace package-lock.json: ${error.message}`);
  }
  const installedEntry = lock.packages?.["node_modules/filegrc"];
  const linkedEntry = installedEntry?.link && installedEntry.resolved
    ? lock.packages?.[installedEntry.resolved]
    : null;
  const lockedVersion = linkedEntry?.version
    || installedEntry?.version
    || lock.dependencies?.filegrc?.version
    || null;
  if (packageManaged && !lockedVersion) {
    throw versionDriftError("The workspace package-lock.json has no filegrc version. Run npm install to repair it, then npm ci.");
  }
  return { installedVersion, lockedVersion, lockfilePath: join(root, "package-lock.json") };
}

function versionDriftError(message) {
  const error = new Error(message);
  error.code = "FILEGRC_VERSION_DRIFT";
  return error;
}

export function assertWorkspaceEngineVersion(input = process.cwd()) {
  const result = workspaceEngineVersion(input);
  if (result.lockedVersion && result.lockedVersion !== result.installedVersion) {
    const error = new Error(
      `Installed filegrc ${result.installedVersion} does not match package-lock.json (${result.lockedVersion}). `
      + "Run npm ci in the workspace, then retry."
    );
    error.code = "FILEGRC_VERSION_DRIFT";
    error.installedVersion = result.installedVersion;
    error.lockedVersion = result.lockedVersion;
    throw error;
  }
  return result;
}
