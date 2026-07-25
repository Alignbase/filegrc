import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getResourceDefinition } from "../model/index.js";
import { resolveDataPath, resolveWorkspaceRoot } from "./paths.js";
import { loadWorkspace } from "./workspace.js";
import { validateWorkspace } from "./validate.js";

export async function createResource(input, record) {
  const loaded = await loadWorkspace(input);
  const before = await validateWorkspace(loaded);
  const path = resourcePath(loaded.root, loaded.model, record);
  try {
    await stat(path);
    throw new Error(`Resource already exists at ${path}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await writeAtomic(path, record, { exclusive: true });
  const result = await validateWorkspace(loaded.root);
  const introduced = newErrors(result, before);
  if (introduced.length) {
    await rm(path, { force: true });
    throw new Error(formatWriteFailure(introduced, record.id));
  }
  return { record, path };
}

export async function updateResource(input, type, id, record) {
  if (record.type !== type || record.id !== id) {
    throw new Error("The type and ID in the record must match the resource being updated.");
  }
  const loaded = await loadWorkspace(input);
  const before = await validateWorkspace(loaded);
  const path = resourcePath(loaded.root, loaded.model, record);
  const previous = await readFile(path, "utf8");
  await writeAtomic(path, record);
  const result = await validateWorkspace(loaded.root);
  const introduced = newErrors(result, before);
  if (introduced.length) {
    await writeTextAtomic(path, previous);
    throw new Error(formatWriteFailure(introduced, id));
  }
  return { record, path };
}

export async function deleteResource(input, type, id) {
  const loaded = await loadWorkspace(input);
  const before = await validateWorkspace(loaded);
  const definition = getResourceDefinition(loaded.model, type);
  if (definition.singleton) throw new Error("The workspace record cannot be deleted.");
  const path = resourcePath(loaded.root, loaded.model, { type, id });
  const source = await readFile(path, "utf8");
  await rm(path);
  const result = await validateWorkspace(loaded.root);
  const introduced = newErrors(result, before);
  if (introduced.length) {
    await writeTextAtomic(path, source);
    throw new Error(formatWriteFailure(introduced, id));
  }
  return { type, id, path };
}

export function resourcePath(input, model, record) {
  const root = resolveWorkspaceRoot(input);
  const definition = getResourceDefinition(model, record.type);
  if (definition.singleton) return resolveDataPath(root, definition.singleton);
  if (typeof record.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(record.id)) {
    throw new Error("Resource IDs must use lowercase kebab-case.");
  }
  const recordFile = (definition.recordPath ?? "{id}.json").replaceAll("{id}", record.id);
  return resolveDataPath(root, join(definition.collection, recordFile));
}

async function writeAtomic(path, value, options = {}) {
  const source = `${JSON.stringify(value, null, 2)}\n`;
  await writeTextAtomic(path, source, options);
}

async function writeTextAtomic(path, source, options = {}) {
  await mkdir(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`);
  const handle = await open(temp, options.exclusive ? "wx" : "w", 0o600);
  try {
    await handle.writeFile(source, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    if (options.exclusive) {
      try {
        await stat(path);
        throw new Error(`Resource already exists at ${path}`);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

function newErrors(after, before) {
  const existing = new Set(before.diagnostics.filter(({ severity }) => severity === "error").map(diagnosticKey));
  return after.diagnostics.filter(({ severity }) => severity === "error").filter((item) => !existing.has(diagnosticKey(item)));
}

function diagnosticKey(item) {
  return `${item.code}\0${item.path}\0${item.message}`;
}

function formatWriteFailure(diagnostics, id) {
  const related = diagnostics.filter(({ path, message }) => !id || path.includes(id) || message.includes(id));
  const details = (related.length ? related : diagnostics)
    .slice(0, 5)
    .map(({ message }) => message)
    .join(" ");
  return `The write would leave the workspace invalid. ${details}`.trim();
}
