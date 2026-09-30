import { loadModel } from "../model/index.js";
import { getDataFilesAtRevision, getFileAtRevision } from "./git.js";

// Rebuild only the authoritative data needed for a historical revision check.
// The caller must compare current and historical facts before accepting a
// legacy binding; this snapshot never supplies a new approval.
export function historicalWorkspace(root, commit) {
  const entries = [];
  for (const path of getDataFilesAtRevision(root, commit).filter(authoritativeJsonPath)) {
    const source = getFileAtRevision(root, commit, path);
    if (!source) return null;
    try {
      entries.push({ record: JSON.parse(source), source, relativePath: path.slice("data/".length) });
    } catch {
      return null;
    }
  }
  const resources = entries.map(({ record }) => record);
  const workspace = resources.find(({ type }) => type === "workspace");
  if (!workspace) return null;
  try {
    return { root, entries, resources, workspace, model: loadModel(workspace.dataModelVersion) };
  } catch {
    return null;
  }
}

function authoritativeJsonPath(path) {
  const parts = path.split("/");
  if (parts[0] !== "data" || !path.endsWith(".json")) return false;
  if (parts.slice(1).some((part) => part.startsWith(".") || part === "content")) return false;
  return !(parts[1] === "evidence" && parts.length > 3 && parts.at(-1) !== "evidence.json");
}
