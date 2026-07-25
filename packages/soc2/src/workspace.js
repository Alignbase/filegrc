import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { loadModel } from "../model/index.js";
import { resolveWorkspaceRoot } from "./paths.js";

export async function loadWorkspace(input = process.cwd()) {
  const root = resolveWorkspaceRoot(input);
  const dataRoot = join(root, "data");
  const diagnostics = [];
  const files = await collectJsonFiles(dataRoot);
  const resources = [];

  for (const path of files) {
    const relativePath = relative(dataRoot, path).split(sep).join("/");
    try {
      const source = await readFile(path, "utf8");
      const record = JSON.parse(source);
      resources.push({ record, path, relativePath, source });
    } catch (error) {
      diagnostics.push({
        severity: "error",
        code: "invalid-json",
        path: `data/${relativePath}`,
        message: error.message
      });
    }
  }

  const workspaceEntry = resources.find(({ record }) => record?.type === "workspace");
  if (!workspaceEntry) {
    diagnostics.push({
      severity: "error",
      code: "missing-workspace",
      path: "data/workspace.json",
      message: "The workspace record is missing."
    });
  }

  let model;
  try {
    model = loadModel(String(workspaceEntry?.record?.dataModelVersion ?? "1"));
  } catch (error) {
    diagnostics.push({
      severity: "error",
      code: "unsupported-model",
      path: "data/workspace.json",
      message: error.message
    });
    model = loadModel("1");
  }

  return {
    root,
    dataRoot,
    model,
    workspace: workspaceEntry?.record ?? null,
    entries: resources,
    resources: resources.map(({ record }) => record),
    diagnostics
  };
}

export function indexResources(resources) {
  const byId = new Map();
  const byType = new Map();
  for (const resource of resources) {
    if (typeof resource?.id === "string") byId.set(resource.id, resource);
    if (typeof resource?.type === "string") {
      if (!byType.has(resource.type)) byType.set(resource.type, []);
      byType.get(resource.type).push(resource);
    }
  }
  return { byId, byType };
}

async function collectJsonFiles(directory) {
  const paths = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (item.name.startsWith(".") || item.name === "content") continue;
    const path = join(directory, item.name);
    if (item.isDirectory()) paths.push(...await collectJsonFiles(path));
    else if (item.isFile() && item.name.endsWith(".json")) paths.push(path);
  }
  return paths.sort();
}
