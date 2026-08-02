import { createHash, randomUUID } from "node:crypto";
import { constants, link, lstat, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { getResourceDefinition } from "../model/index.js";
import { serializeWorkspaceMutation } from "./mutation.js";
import { isCanonicalDataPath, resolveDataPath, resolveWorkspaceRoot } from "./paths.js";
import { markdownEntries } from "./resource-markdown.js";
import { loadWorkspace } from "./workspace.js";
import { validateWorkspace } from "./validate.js";

export async function createResource(input, record, options = {}) {
  return serializeWorkspaceMutation(input, (root) => createResourceUnlocked(root, record, options));
}

export async function addEvidenceAttachment(input, evidenceId, sourcePath, options = {}) {
  return serializeWorkspaceMutation(input, (root) => addEvidenceAttachmentUnlocked(root, evidenceId, sourcePath, options));
}

export async function removeEvidenceAttachment(input, evidenceId, attachment, options = {}) {
  return serializeWorkspaceMutation(input, (root) => removeEvidenceAttachmentUnlocked(root, evidenceId, attachment, options));
}

async function addEvidenceAttachmentUnlocked(input, evidenceId, sourcePath, options) {
  const loaded = await loadWorkspace(input);
  const entry = loaded.entries.find(({ record }) => record.type === "evidence" && record.id === evidenceId);
  if (!entry) throw new Error(`Evidence "${evidenceId}" was not found.`);
  const source = resolve(String(sourcePath || ""));
  let sourceStat;
  try {
    sourceStat = await lstat(source);
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`Attachment source "${sourcePath}" was not found.`);
    throw error;
  }
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
    throw new Error("An attachment source must be a regular file, not a directory or symlink.");
  }
  const fileName = String(options.name || basename(source)).trim();
  if (
    !fileName
    || fileName === "."
    || fileName === ".."
    || fileName.startsWith(".")
    || fileName.includes("/")
    || fileName.includes("\\")
    || fileName.includes("\0")
    || /[\u0000-\u001f\u007f]/.test(fileName)
    || Buffer.byteLength(fileName, "utf8") > 200
  ) {
    throw new Error("An attachment name must be a non-hidden file name of 200 bytes or fewer without control characters or path separators.");
  }
  const dataRelativePath = join("evidence", evidenceId, fileName).replaceAll("\\", "/");
  const destination = resolveDataPath(loaded.root, dataRelativePath);
  if (source === destination) throw new Error("The attachment source is already at its evidence destination.");
  await mkdir(dirname(destination), { recursive: true });
  const temp = join(dirname(destination), `.${randomUUID()}.attachment`);
  let destinationCreated = false;
  try {
    await copyRegularFileExclusive(source, temp, sourceStat);
    await link(temp, destination);
    destinationCreated = true;
    await rm(temp, { force: true });
    const filePaths = [...new Set([...(entry.record.filePaths || []), dataRelativePath])];
    const updated = await updateResourceUnlocked(loaded.root, "evidence", evidenceId, {
      ...entry.record,
      filePaths
    }, {
      expectedRevision: options.expectedRevision
    });
    return { record: updated.record, path: destination, dataRelativePath };
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    if (destinationCreated) await rm(destination, { force: true }).catch(() => {});
    if (error.code === "EEXIST") throw new Error(`Attachment destination data/${dataRelativePath} already exists.`);
    throw error;
  }
}

async function removeEvidenceAttachmentUnlocked(input, evidenceId, attachment, options) {
  const loaded = await loadWorkspace(input);
  const entry = loaded.entries.find(({ record }) => record.type === "evidence" && record.id === evidenceId);
  if (!entry) throw new Error(`Evidence "${evidenceId}" was not found.`);
  const requested = String(attachment || "").trim();
  const matches = (entry.record.filePaths || []).filter((path) => (
    path === requested || basename(path) === requested
  ));
  if (matches.length === 0) throw new Error(`Attachment "${requested}" is not linked from evidence "${evidenceId}".`);
  if (matches.length > 1) throw new Error(`Attachment name "${requested}" is ambiguous; pass its full data-relative path.`);
  const dataRelativePath = matches[0];
  const expectedPrefix = `evidence/${evidenceId}/`;
  if (!isCanonicalDataPath(dataRelativePath) || !dataRelativePath.startsWith(expectedPrefix)) {
    throw new Error(`Attachment "${dataRelativePath}" is outside evidence/${evidenceId}/ and must be handled manually.`);
  }
  const shared = loaded.resources.some((record) => (
    record.id !== evidenceId
    && Array.isArray(record.filePaths)
    && record.filePaths.includes(dataRelativePath)
  ));
  if (shared) throw new Error(`Attachment "${dataRelativePath}" is referenced by another record.`);
  const path = resolveDataPath(loaded.root, dataRelativePath);
  const fileStat = await lstat(path);
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
    throw new Error("An evidence attachment must be a regular file, not a directory or symlink.");
  }
  const parked = join(dirname(path), `.${randomUUID()}.detached`);
  let moved = false;
  try {
    await rename(path, parked);
    moved = true;
    const filePaths = entry.record.filePaths.filter((item) => item !== dataRelativePath);
    const nextRecord = { ...entry.record };
    if (filePaths.length) nextRecord.filePaths = filePaths;
    else delete nextRecord.filePaths;
    const updated = await updateResourceUnlocked(loaded.root, "evidence", evidenceId, nextRecord, {
      expectedRevision: options.expectedRevision
    });
    try {
      await rm(parked);
      moved = false;
    } catch (cleanupError) {
      await rename(parked, path);
      moved = false;
      await updateResourceUnlocked(loaded.root, "evidence", evidenceId, entry.record, {});
      throw cleanupError;
    }
    return { record: updated.record, dataRelativePath };
  } catch (error) {
    if (moved) await rename(parked, path).catch(() => {});
    throw error;
  }
}

async function copyRegularFileExclusive(source, destination, originalStat) {
  let sourceHandle;
  let destinationHandle;
  try {
    sourceHandle = await open(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const [openedStat, currentStat] = await Promise.all([sourceHandle.stat(), lstat(source)]);
    if (
      !openedStat.isFile()
      || currentStat.isSymbolicLink()
      || !sameFile(originalStat, openedStat)
      || !sameFile(currentStat, openedStat)
    ) {
      throw new Error("The attachment source changed while it was being opened.");
    }
    destinationHandle = await open(
      destination,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      openedStat.mode & 0o666
    );
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    while (true) {
      const { bytesRead } = await sourceHandle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      let written = 0;
      while (written < bytesRead) {
        const result = await destinationHandle.write(
          buffer,
          written,
          bytesRead - written,
          position + written
        );
        if (!result.bytesWritten) throw new Error("The attachment copy stopped before the source file was complete.");
        written += result.bytesWritten;
      }
      position += bytesRead;
    }
    const finalStat = await sourceHandle.stat();
    if (
      position !== openedStat.size
      || finalStat.size !== openedStat.size
      || finalStat.mtimeMs !== openedStat.mtimeMs
      || finalStat.ctimeMs !== openedStat.ctimeMs
    ) {
      throw new Error("The attachment source changed while it was being copied.");
    }
    await destinationHandle.sync();
  } catch (error) {
    if (error.code === "ELOOP") {
      throw new Error("An attachment source must be a regular file, not a directory or symlink.");
    }
    throw error;
  } finally {
    await Promise.allSettled([
      destinationHandle?.close(),
      sourceHandle?.close()
    ]);
  }
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

export async function createResources(input, records) {
  return serializeWorkspaceMutation(input, (root) => createResourcesUnlocked(root, records));
}

export async function applyResourceBatch(input, changes) {
  return serializeWorkspaceMutation(input, (root) => applyResourceBatchUnlocked(root, changes));
}

async function applyResourceBatchUnlocked(input, changes = {}) {
  const creates = changes.create || [];
  const updates = changes.update || [];
  const expectedRevisions = changes.expectedRevisions || {};
  if (!Array.isArray(creates) || !Array.isArray(updates) || (!creates.length && !updates.length)) {
    throw new Error("A resource batch needs at least one create or update.");
  }
  if (Array.isArray(expectedRevisions) || typeof expectedRevisions !== "object") {
    throw new Error("Batch expected revisions must be keyed by resource ID.");
  }
  const loaded = await loadWorkspace(input);
  const before = await validateWorkspace(loaded);
  const existingById = new Map(loaded.entries.map((entry) => [entry.record.id, entry]));
  const ids = new Set();
  const writes = [];
  for (const record of creates) {
    validateBatchRecord(record, ids);
    if (existingById.has(record.id)) throw new Error(`Resource "${record.id}" already exists.`);
    const path = resourcePath(loaded.root, loaded.model, record);
    writes.push({ mode: "create", path, record, previous: null });
  }
  for (const record of updates) {
    validateBatchRecord(record, ids);
    const existing = existingById.get(record.id);
    if (!existing) throw new Error(`Resource "${record.id}" was not found.`);
    if (existing.record.type !== record.type) {
      throw new Error(`Resource "${record.id}" cannot change type.`);
    }
    const path = resourcePath(loaded.root, loaded.model, record);
    const previous = await readFile(path, "utf8");
    assertRevision(
      previous,
      expectedRevisions[record.id] || existing.revision,
      `Resource "${record.id}"`
    );
    writes.push({ mode: "update", path, record, previous });
  }
  const written = [];
  try {
    for (const item of writes) {
      await writeAtomic(item.path, item.record, { exclusive: item.mode === "create" });
      written.push(item);
    }
    const result = await validateWorkspace(loaded.root);
    const introduced = newErrors(result, before);
    if (introduced.length) throw new Error(formatWriteFailure(introduced, "resource batch"));
  } catch (error) {
    for (const item of written.reverse()) {
      if (item.mode === "create") await rm(item.path, { force: true });
      else await writeTextAtomic(item.path, item.previous);
    }
    throw error;
  }
  return {
    created: creates,
    updated: updates
  };
}

function validateBatchRecord(record, ids) {
  if (!record || Array.isArray(record) || typeof record !== "object") {
    throw new Error("Every resource in a batch must be a JSON object.");
  }
  if (ids.has(record.id)) throw new Error(`Resource "${record.id}" appears more than once in the batch.`);
  ids.add(record.id);
}

export async function createResourceAndLink(input, record, linkTarget, options = {}) {
  return serializeWorkspaceMutation(input, (root) => createResourceAndLinkUnlocked(root, record, linkTarget, options));
}

async function createResourceAndLinkUnlocked(input, record, linkTarget, options) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("A resource record is required.");
  }
  if (!linkTarget || typeof linkTarget !== "object" || Array.isArray(linkTarget)) {
    throw new Error("A resource link target is required.");
  }
  const loaded = await loadWorkspace(input);
  const targetEntry = loaded.entries.find(({ record: target }) => target.type === linkTarget.type && target.id === linkTarget.id);
  if (!targetEntry) throw new Error(`Resource "${linkTarget.type}/${linkTarget.id}" was not found.`);
  const targetDefinition = getResourceDefinition(loaded.model, linkTarget.type);
  const targetFields = { ...loaded.model.commonFields, ...targetDefinition.fields };
  const linkField = targetFields[linkTarget.field];
  if (linkField?.type !== "array" || !linkField.relation) {
    throw new Error(`Field "${linkTarget.field}" cannot link resources.`);
  }
  const allowedTypes = Array.isArray(linkField.relation) ? linkField.relation : [linkField.relation];
  if (!allowedTypes.includes("*") && !allowedTypes.includes(record.type)) {
    throw new Error(`Field "${linkTarget.field}" cannot link resource type "${record.type}".`);
  }
  const linkedIds = Array.isArray(targetEntry.record[linkTarget.field]) ? targetEntry.record[linkTarget.field] : [];
  if (linkedIds.includes(record.id)) throw new Error(`Resource "${record.id}" is already linked.`);

  const created = await createResourceUnlocked(input, record, { content: options.content });
  try {
    const patch = linkTarget.patch && !Array.isArray(linkTarget.patch) && typeof linkTarget.patch === "object"
      ? linkTarget.patch
      : {};
    if (
      (patch.id !== undefined && patch.id !== linkTarget.id)
      || (patch.type !== undefined && patch.type !== linkTarget.type)
    ) {
      throw new Error("A linked resource patch cannot change the target type or ID.");
    }
    const linkedRecord = {
      ...targetEntry.record,
      ...patch,
      [linkTarget.field]: [...linkedIds, record.id]
    };
    const linked = await updateResourceUnlocked(input, linkTarget.type, linkTarget.id, linkedRecord, {
      expectedRevision: linkTarget.expectedRevision
    });
    return { created: created.record, linked: linked.record };
  } catch (error) {
    await deleteResourceUnlocked(input, record.type, record.id, {});
    throw error;
  }
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
  const loaded = await loadWorkspace(input);
  const allowed = loaded.entries.some(({ record }) => (
    markdownEntries(loaded.model, record).some(({ path }) => path === dataRelativePath)
  ));
  if (!allowed) {
    const error = new Error(`Markdown path "${dataRelativePath}" was not found.`);
    error.code = "ENOENT";
    throw error;
  }
  const path = resolveDataPath(loaded.root, dataRelativePath);
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
  if (record.type === "evidence" && (record.filePaths || []).length) {
    throw new Error(`Evidence "${id}" still has local attachments. Detach them explicitly before deleting the record.`);
  }
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
  return resolveDataPath(root, join(definition.collection, recordFile).replaceAll("\\", "/"));
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
  const allowed = new Map();
  for (const item of markdownEntries(loaded.model, record)) {
    allowed.set(item.name, item.path);
    allowed.set(item.path, item.path);
  }
  const writes = [];
  for (const [key, source] of Object.entries(content)) {
    const dataRelativePath = allowed.get(key);
    if (!dataRelativePath) throw new Error(`Markdown "${key}" does not belong to this record.`);
    if (typeof source !== "string") throw new Error(`Content for "${dataRelativePath}" must be a string.`);
    const path = resolveDataPath(loaded.root, dataRelativePath);
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

export function contentRevision(source) {
  return createHash("sha256").update(source).digest("hex");
}

async function exclusiveContentFiles(loaded, record) {
  const candidates = markdownEntries(loaded.model, record).map(({ path }) => path);
  const files = [];
  for (const dataRelativePath of new Set(candidates)) {
    let contentPath;
    try {
      contentPath = resolveDataPath(loaded.root, dataRelativePath);
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
