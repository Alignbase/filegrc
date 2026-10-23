import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SUPPORTED_MODEL_VERSIONS } from "../model/index.js";
import { resolveWorkspaceRoot } from "./paths.js";

export const installedVersion = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
export const RUNTIME_API_CONTRACT_VERSION = 1;

// Stable SemVer only. Build metadata does not change the compatibility line.
export function runtimeCompatibilityLine(version) {
  if (typeof version !== "string") return null;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(version);
  if (!match || match.slice(1, 4).some((part) => !Number.isSafeInteger(Number(part)))) return null;
  return match[1] === "0" ? `0.${match[2]}.x` : `${match[1]}.x`;
}

export function assessRuntimeCompatibility(runtimeVersion, repositoryVersion, options = {}) {
  const supportedLine = runtimeCompatibilityLine(runtimeVersion);
  const repositoryLine = runtimeCompatibilityLine(repositoryVersion);
  // 0.19 adds optional nonmaterial-amendment records. It reads existing 0.18
  // workspaces unchanged; 0.18 runtimes must reject the new release line.
  const supportedRepositoryLines = supportedLine === "0.19.x" ? ["0.18.x", "0.19.x"] : [supportedLine];
  const dataModelVersion = options.dataModelVersion ?? null;
  const requiredApiContractVersion = Object.hasOwn(options, "requiredApiContractVersion") ? options.requiredApiContractVersion : RUNTIME_API_CONTRACT_VERSION;
  const reason = !supportedLine ? "invalid-runtime-version"
    : repositoryVersion !== null && !repositoryLine ? "invalid-repository-version"
      : repositoryLine && !supportedRepositoryLines.includes(repositoryLine) ? "unsupported-compatibility-line"
        : dataModelVersion !== null && !SUPPORTED_MODEL_VERSIONS.includes(dataModelVersion) ? "unsupported-workspace-model"
          : requiredApiContractVersion !== RUNTIME_API_CONTRACT_VERSION ? "unsupported-api-contract" : null;
  return { compatible: reason === null, installedVersion: runtimeVersion, repositoryVersion,
    supportedLine, supportedRepositoryLines, repositoryLine, dataModelVersion, apiContractVersion: RUNTIME_API_CONTRACT_VERSION,
    supportedModelVersions: [...SUPPORTED_MODEL_VERSIONS], reason };
}

export function workspaceEngineVersion(input = process.cwd()) {
  let root;
  try {
    root = resolveWorkspaceRoot(input);
  } catch (error) {
    if (/No filegrc workspace was found/.test(error.message)) return { installedVersion, lockedVersion: null, lockfilePath: null };
    throw error;
  }
  let packageManaged = false;
  try {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    if (!manifest || Array.isArray(manifest) || typeof manifest !== "object") throw new Error("Expected a JSON object.");
    packageManaged = Boolean(manifest.dependencies?.filegrc || manifest.devDependencies?.filegrc);
  } catch (error) {
    if (error.code !== "ENOENT") throw versionDriftError(`Cannot read the workspace package.json: ${error.message}`, "invalid-manifest");
  }
  let lock;
  try {
    lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
    if (!lock || Array.isArray(lock) || typeof lock !== "object") throw new Error("Expected a JSON object.");
  } catch (error) {
    if (error.code === "ENOENT" && !packageManaged) return { installedVersion, lockedVersion: null, lockfilePath: null };
    if (error.code === "ENOENT") throw versionDriftError("The workspace package-lock.json is missing. Run npm install to create it, then npm ci.", "missing-lockfile");
    throw versionDriftError(`Cannot read the workspace package-lock.json: ${error.message}`, "invalid-lockfile");
  }
  const installedEntry = lock.packages?.["node_modules/filegrc"];
  const linkedEntry = installedEntry?.link && installedEntry.resolved ? lock.packages?.[installedEntry.resolved] : null;
  const lockedVersion = installedEntry?.link ? linkedEntry?.version : installedEntry?.version ?? lock.dependencies?.filegrc?.version ?? null;
  if ((packageManaged || installedEntry) && !lockedVersion) {
    throw versionDriftError("The workspace package-lock.json has no filegrc version. Run npm install to repair it, then npm ci.", "missing-repository-version");
  }
  return { installedVersion, lockedVersion: lockedVersion ?? null, lockfilePath: join(root, "package-lock.json") };
}

function versionDriftError(message, reason) {
  const error = new Error(message);
  error.code = "FILEGRC_VERSION_DRIFT";
  error.reason = reason;
  return error;
}

export function assessWorkspaceRuntimeCompatibility(input = process.cwd(), options = {}) {
  let versions;
  try {
    versions = workspaceEngineVersion(input);
  } catch (error) {
    return { ...assessRuntimeCompatibility(installedVersion, null, options), compatible: false,
      lockedVersion: null, lockfilePath: null, reason: error.reason || "invalid-version-files", message: error.message };
  }
  const versionCompatibility = { ...versions, ...assessRuntimeCompatibility(installedVersion, versions.lockedVersion, options) };
  if (!versionCompatibility.compatible) return { ...versionCompatibility, message: compatibilityMessage(versionCompatibility) };
  let dataModelVersion = null;
  try {
    const root = resolveWorkspaceRoot(input);
    const workspace = JSON.parse(readFileSync(join(root, "data/workspace.json"), "utf8"));
    dataModelVersion = workspace?.dataModelVersion;
    if (!workspace || Array.isArray(workspace) || typeof workspace !== "object" || typeof dataModelVersion !== "string") {
      return { ...versions, ...assessRuntimeCompatibility(installedVersion, versions.lockedVersion, options), compatible: false,
        reason: "invalid-workspace-model", message: "data/workspace.json must declare a supported string dataModelVersion. Restore the authoritative model declaration or preview an explicit migration; do not guess a version." };
    }
  } catch (error) {
    // Structural workspace validation reports missing or malformed records.
    if (!/No filegrc workspace was found/.test(error.message)) {
      return { ...versions, ...assessRuntimeCompatibility(installedVersion, versions.lockedVersion, options), compatible: false,
        reason: "invalid-workspace", message: `Cannot read data/workspace.json: ${error.message}` };
    }
  }
  const result = { ...versions, ...assessRuntimeCompatibility(installedVersion, versions.lockedVersion, { ...options, dataModelVersion }) };
  if (!result.compatible) result.message = compatibilityMessage(result);
  return result;
}

function compatibilityMessage(result) {
  if (result.reason === "unsupported-workspace-model") return `Workspace model ${result.dataModelVersion} is unsupported by filegrc ${result.installedVersion}. Use a runtime supporting this model or preview an explicit model migration${result.dataModelVersion === "1" ? " with npx filegrc migrate --to-model 2 --preview --json" : ""}; do not change the workspace version to bypass validation.`;
  if (result.reason === "unsupported-api-contract") return `Requested API contract is unsupported by filegrc ${result.installedVersion}; use API contract ${result.apiContractVersion} or a runtime supporting the requested contract.`;
  return `Installed filegrc ${result.installedVersion} cannot use package-lock.json (${result.repositoryVersion}). Supported compatibility line: ${result.supportedLine || "none"}; reason: ${result.reason}. Deploy a tested stable hosted runtime supporting the repository compatibility line and model, or run npm ci locally. Repair malformed version files through normal dependency installation; do not rewrite customer versions to bypass this check.`;
}

export function assertWorkspaceEngineVersion(input = process.cwd(), options = {}) {
  const result = assessWorkspaceRuntimeCompatibility(input, options);
  // Explicit migrations retain their existing unsupported-model preview path.
  const modelFailure = ["unsupported-workspace-model", "invalid-workspace-model", "invalid-workspace"].includes(result.reason);
  const allowDiagnostics = options.allowModelDiagnostics === true && modelFailure;
  if (!result.compatible && !allowDiagnostics && !(options.allowModelMigration && result.reason === "unsupported-workspace-model")) {
    const error = versionDriftError(result.message, result.reason);
    Object.assign(error, { installedVersion: result.installedVersion, lockedVersion: result.repositoryVersion, compatibility: result });
    throw error;
  }
  return result;
}
