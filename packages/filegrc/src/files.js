import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getResourceDefinition } from "../model/index.js";
import { serializeWorkspaceMutation } from "./mutation.js";
import { resolveContentPath, resolveDataPath, resolveWorkspaceRoot } from "./paths.js";
import { loadWorkspace } from "./workspace.js";
import { validateWorkspace } from "./validate.js";

export async function createResource(input, record, options = {}) {
  return serializeWorkspaceMutation(input, (root) => createResourceUnlocked(root, record, options));
}

export async function createResources(input, records) {
  return serializeWorkspaceMutation(input, (root) => createResourcesUnlocked(root, records));
}

async function createResourcesUnlocked(input, records) {
  if (!Array.isArray(records) || records.length === 0) throw new Error("At least one resource is required.");
  const loaded = await loadWorkspace(input);
  const before = await validateWorkspace(loaded);
  const ids = new Set();
  const writes = [];
  for (const record of records) {
    if (!record || Array.isArray(record) || typeof record !== "object") throw new Error("Every resource must be a JSON object.");
    if (ids.has(record.id)) throw new Error(`Resource "${record.id}" appears more than once in the batch.`);
    ids.add(record.id);
    const path = resourcePath(loaded.root, loaded.model, record);
    try {
      await stat(path);
      throw new Error(`Resource "${record.id}" already exists.`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    writes.push({ path, record });
  }
  const written = [];
  try {
    for (const item of writes) {
      await writeAtomic(item.path, item.record, { exclusive: true });
      written.push(item);
    }
    const result = await validateWorkspace(loaded.root);
    const introduced = newErrors(result, before);
    if (introduced.length) throw new Error(formatWriteFailure(introduced, "resource batch"));
  } catch (error) {
    for (const item of written.reverse()) await rm(item.path, { force: true });
    throw error;
  }
  return records;
}

async function createResourceUnlocked(input, record, options) {
  const loaded = await loadWorkspace(input);
  const before = await validateWorkspace(loaded);
  const path = resourcePath(loaded.root, loaded.model, record);
  try {
    await stat(path);
    throw new Error(`Resource "${record.id}" already exists.`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const contentWrites = await prepareContentWrites(loaded, record, options.content, { exclusive: true });
  const written = [];
  let recordWritten = false;
  try {
    for (const item of contentWrites) {
      await writeTextAtomic(item.path, item.source, { exclusive: true });
      written.push(item);
    }
    await writeAtomic(path, record, { exclusive: true });
    recordWritten = true;
    const result = await validateWorkspace(loaded.root);
    const introduced = newErrors(result, before);
    if (introduced.length) throw new Error(formatWriteFailure(introduced, record.id));
  } catch (error) {
    if (recordWritten) await rm(path, { force: true });
    for (const item of written) await rm(item.path, { force: true });
    throw error;
  }
  return { record, path };
}

export async function updateResource(input, type, id, record, options = {}) {
  return serializeWorkspaceMutation(input, (root) => updateResourceUnlocked(root, type, id, record, options));
}

async function updateResourceUnlocked(input, type, id, record, options) {
  if (record.type !== type || record.id !== id) {
    throw new Error("The type and ID in the record must match the resource being updated.");
  }
  const loaded = await loadWorkspace(input);
  const before = await validateWorkspace(loaded);
  const path = resourcePath(loaded.root, loaded.model, record);
  const previous = await readFile(path, "utf8");
  assertRevision(previous, options.expectedRevision, "The record");
  const contentWrites = await prepareContentWrites(loaded, record, options.content, {
    expectedRevisions: options.expectedContentRevisions
  });
  try {
    for (const item of contentWrites) await writeTextAtomic(item.path, item.source);
    await writeAtomic(path, record);
    const result = await validateWorkspace(loaded.root);
    const introduced = newErrors(result, before);
    if (introduced.length) throw new Error(formatWriteFailure(introduced, id));
  } catch (error) {
    await writeTextAtomic(path, previous);
    for (const item of contentWrites) {
      if (item.previous === null) await rm(item.path, { force: true });
      else await writeTextAtomic(item.path, item.previous);
    }
    throw error;
  }
  return { record, path };
}

export async function updateContent(input, dataRelativePath, source, options = {}) {
  return serializeWorkspaceMutation(input, (root) => updateContentUnlocked(root, dataRelativePath, source, options));
}

async function updateContentUnlocked(input, dataRelativePath, source, options) {
  if (typeof source !== "string") throw new Error("Markdown content must be a string.");
  const path = resolveContentPath(input, dataRelativePath);
  const previous = await readFile(path, "utf8");
  assertRevision(previous, options.expectedRevision, "The Markdown file");
  await writeTextAtomic(path, source.endsWith("\n") ? source : `${source}\n`);
  return { path, dataRelativePath };
}

export async function deleteResource(input, type, id, options = {}) {
  return serializeWorkspaceMutation(input, (root) => deleteResourceUnlocked(root, type, id, options));
}

async function deleteResourceUnlocked(input, type, id, options) {
  const loaded = await loadWorkspace(input);
  const before = await validateWorkspace(loaded);
  const definition = getResourceDefinition(loaded.model, type);
  if (definition.singleton) throw new Error("Singleton records cannot be deleted.");
  const path = resourcePath(loaded.root, loaded.model, { type, id });
  const mode = (await stat(path)).mode & 0o777;
  const source = await readFile(path, "utf8");
  assertRevision(source, options.expectedRevision, "The record");
  const record = JSON.parse(source);
  const contentFiles = await exclusiveContentFiles(loaded, record);
  try {
    await rm(path);
    for (const item of contentFiles) await rm(item.path, { force: true });
    const result = await validateWorkspace(loaded.root);
    const introduced = newErrors(result, before);
    if (introduced.length) throw new Error(formatWriteFailure(introduced, id));
  } catch (error) {
    await writeTextAtomic(path, source, { mode });
    for (const item of contentFiles) {
      if (item.source !== null) await writeTextAtomic(item.path, item.source, { mode: item.mode });
    }
    throw error;
  }
  return { type, id, path, deletedContent: contentFiles.filter(({ source }) => source !== null).map(({ dataRelativePath }) => dataRelativePath) };
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
  const temp = join(dirname(path), `.${randomUUID()}.tmp`);
  let mode = options.mode ?? 0o666;
  if (options.mode === undefined) {
    try {
      mode = (await stat(path)).mode & 0o777;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const handle = await open(temp, options.exclusive ? "wx" : "w", mode);
  try {
    try {
      await handle.writeFile(source, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (options.exclusive) {
      await link(temp, path);
      await rm(temp, { force: true }).catch(() => {});
    } else await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    if (error.code === "EEXIST") throw new Error("The target file already exists.");
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

async function prepareContentWrites(loaded, record, content, options = {}) {
  if (content === undefined || content === null) return [];
  if (Array.isArray(content) || typeof content !== "object") {
    throw new Error("Content updates must be keyed by data-relative Markdown path.");
  }
  const definition = getResourceDefinition(loaded.model, record.type);
  const fields = { ...loaded.model.commonFields, ...definition.fields };
  const allowed = new Set(Object.entries(fields)
    .filter(([, field]) => field.content)
    .flatMap(([name]) => Array.isArray(record[name]) ? record[name] : [record[name]])
    .filter(Boolean));
  const writes = [];
  for (const [dataRelativePath, source] of Object.entries(content)) {
    if (!allowed.has(dataRelativePath)) throw new Error(`Content path "${dataRelativePath}" is not referenced by this record.`);
    if (typeof source !== "string") throw new Error(`Content for "${dataRelativePath}" must be a string.`);
    const path = resolveContentPath(loaded.root, dataRelativePath);
    let previous = null;
    try {
      previous = await readFile(path, "utf8");
      if (options.exclusive) throw new Error(`Content already exists at data/${dataRelativePath}.`);
      assertRevision(previous, options.expectedRevisions?.[dataRelativePath], `Content at data/${dataRelativePath}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    writes.push({ path, dataRelativePath, source: source.endsWith("\n") ? source : `${source}\n`, previous });
  }
  return writes;
}

function assertRevision(source, expected, label) {
  if (expected && contentRevision(source) !== expected) {
    throw new Error(`${label} changed after you opened it. Reload the workspace and apply your change again.`);
  }
}

function contentRevision(source) {
  return createHash("sha256").update(source).digest("hex");
}

async function exclusiveContentFiles(loaded, record) {
  const definition = getResourceDefinition(loaded.model, record.type);
  const fields = { ...loaded.model.commonFields, ...definition.fields };
  const candidates = Object.entries(fields)
    .filter(([, field]) => field.content)
    .flatMap(([name]) => Array.isArray(record[name]) ? record[name] : [record[name]])
    .filter((value) => typeof value === "string");
  const files = [];
  for (const dataRelativePath of new Set(candidates)) {
    const shared = loaded.resources.some((other) => other.id !== record.id && Object.values(other).some((value) => (
      value === dataRelativePath || (Array.isArray(value) && value.includes(dataRelativePath))
    )));
    if (shared) continue;
    let contentPath;
    try {
      contentPath = resolveContentPath(loaded.root, dataRelativePath);
    } catch {
      continue;
    }
    let contentSource = null;
    let mode = 0o666;
    try {
      contentSource = await readFile(contentPath, "utf8");
      mode = (await stat(contentPath)).mode & 0o777;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    files.push({ path: contentPath, dataRelativePath, source: contentSource, mode });
  }
  return files;
}
