import { createHash, randomUUID } from "node:crypto";
import { constants, link, lstat, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { getResourceDefinition, loadModel, modelSupports } from "../model/index.js";
import { openPlaceholderCount } from "./content-readiness.js";
import { serializeWorkspaceMutation, workspaceValidationDeferred } from "./mutation.js";
import { isCanonicalDataPath, resolveDataPath, resolveWorkspaceRoot } from "./paths.js";
import { documentIsAuditSpecific } from "./program-lifecycle.js";
import { markdownEntries } from "./resource-markdown.js";
import { reportingRouteRevision } from "./reporting-route-integrity.js";
import { measureTiming } from "./timing.js";
import { currentCalendarDate, timestampFromLocalDateTime } from "./time.js";
import { loadWorkspace } from "./workspace.js";
import { validateWorkspace } from "./validate.js";

export const INTERNAL_WORKFLOW_CAPABILITIES = Object.freeze({
  auditManagementReconciliation: Symbol("audit-management-reconciliation"),
  auditPopulationSupersession: Symbol("audit-population-supersession"),
  obligationOccurrenceReconciliation: Symbol("obligation-occurrence-reconciliation"),
  obligationOccurrenceSupersession: Symbol("obligation-occurrence-supersession"),
  obligationRuleActivation: Symbol("obligation-rule-activation"),
  collectionReviewReassessment: Symbol("collection-review-reassessment")
});

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
  assertFinalizedOccurrenceProofMutable(loaded, entry.record);
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
  assertFinalizedOccurrenceProofMutable(loaded, entry.record);
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

export async function applyDocumentActivationBatch(input, changes) {
  return serializeWorkspaceMutation(input, (root) => (
    applyResourceBatchUnlocked(root, changes, "document-activation")
  ));
}

export async function applyGovernedContentActivationBatch(input, changes) {
  return serializeWorkspaceMutation(input, (root) => (
    applyResourceBatchUnlocked(root, changes, "governed-content-activation")
  ));
}

export async function applyModelMigrationBatch(input, changes) {
  return serializeWorkspaceMutation(input, (root) => (
    applyResourceBatchUnlocked(root, changes, "model-migration")
  ));
}

async function applyResourceBatchUnlocked(input, changes = {}, lifecycleOperation = null) {
  const creates = changes.create || [];
  const updates = changes.update || [];
  const moves = changes.movePaths || [];
  const contentUpdates = changes.contentUpdates || {};
  const expectedRevisions = changes.expectedRevisions || {};
  if (
    !Array.isArray(creates)
    || !Array.isArray(updates)
    || !Array.isArray(moves)
    || (!creates.length && !updates.length && !moves.length && !Object.keys(contentUpdates).length)
  ) {
    throw new Error("A resource batch needs at least one create, update, or content update.");
  }
  if (Array.isArray(expectedRevisions) || typeof expectedRevisions !== "object") {
    throw new Error("Batch expected revisions must be keyed by resource ID.");
  }
  if (Array.isArray(contentUpdates) || typeof contentUpdates !== "object") {
    throw new Error("Batch content updates must be keyed by resource ID.");
  }
  const expectedContentRevisions = changes.expectedContentRevisions || {};
  if (Array.isArray(expectedContentRevisions) || typeof expectedContentRevisions !== "object") {
    throw new Error("Batch expected content revisions must be keyed by resource ID.");
  }
  const loaded = await loadWorkspace(input);
  const workspaceUpdate = updates.find((record) => (
    record.type === "workspace" && record.id === loaded.workspace?.id
  ));
  const changesModelVersion = workspaceUpdate
    && String(workspaceUpdate.dataModelVersion || "") !== String(loaded.workspace?.dataModelVersion || "");
  const targetModelVersion = changes.targetModelVersion
    ? String(changes.targetModelVersion)
    : null;
  if (changesModelVersion && !targetModelVersion) {
    throw new Error(
      "A resource batch that changes dataModelVersion must declare targetModelVersion."
    );
  }
  if (
    targetModelVersion
    && (
      changes.validateWholeWorkspace !== true
      || String(workspaceUpdate?.dataModelVersion || "") !== targetModelVersion
    )
  ) {
    throw new Error(
      "A cross-model resource batch must validate the whole workspace and update its dataModelVersion to the target model."
    );
  }
  if (lifecycleOperation === "model-migration" && !targetModelVersion) {
    throw new Error("The model-migration lifecycle operation requires a cross-model resource batch.");
  }
  if (
    ["document-activation", "governed-content-activation"].includes(lifecycleOperation)
    && (targetModelVersion || changes.validateWholeWorkspace !== true)
  ) {
    throw new Error("The governed-content activation lifecycle operation requires same-model whole-workspace validation.");
  }
  const writeModel = targetModelVersion ? loadModel(targetModelVersion) : loaded.model;
  const deferValidation = workspaceValidationDeferred();
  const before = deferValidation || changes.validateWholeWorkspace
    ? null
    : await validateWorkspace(loaded);
  const existingById = new Map(loaded.entries.map((entry) => [entry.record.id, entry]));
  for (const record of updates) {
    if (!record || Array.isArray(record) || typeof record !== "object" || typeof record.id !== "string") continue;
    const existing = existingById.get(record.id);
    if (!existing) continue;
    assertRevision(
      existing.source,
      expectedRevisions[record.id] || existing.revision,
      `Resource "${record.id}"`
    );
  }
  const ids = new Set();
  const writes = [];
  const contentWrites = [];
  const preparedContentIds = new Set();
  const allowedPathMoves = new Set();
  for (const record of creates) {
    validateBatchRecord(record, ids);
    assertSpecializedWorkflowCreate(record, { ...changes, lifecycleOperation }, loaded);
    if (existingById.has(record.id)) throw new Error(`Resource "${record.id}" already exists.`);
    const hasContentUpdate = Object.hasOwn(contentUpdates, record.id);
    const recordContentWrites = await prepareContentWrites(loaded, record, contentUpdates[record.id], {
      requireExpectedRevisions: false
    });
    if (hasContentUpdate) preparedContentIds.add(record.id);
    contentWrites.push(...recordContentWrites);
    const nextRecord = hasContentUpdate
      ? await prepareApprovalBinding(loaded, record, recordContentWrites, null)
      : record;
    const path = resourcePath(loaded.root, writeModel, nextRecord);
    writes.push({ operation: "create", path, record: nextRecord, previous: null, fileMode: 0o666 });
  }
  for (const record of updates) {
    validateBatchRecord(record, ids);
    const existing = existingById.get(record.id);
    if (!existing) throw new Error(`Resource "${record.id}" was not found.`);
    assertImmutableWorkflowRecord(existing.record, record, { ...changes, lifecycleOperation }, loaded);
    if (existing.record.type !== record.type && !targetModelVersion) {
      throw new Error(`Resource "${record.id}" cannot change type.`);
    }
    if (existing.record.type !== record.type) {
      const targetMarkdownByName = new Map(
        markdownEntries(writeModel, record).map((entry) => [entry.name, entry.path])
      );
      for (const sourceMarkdown of markdownEntries(loaded.model, existing.record)) {
        const targetMarkdown = targetMarkdownByName.get(sourceMarkdown.name);
        if (targetMarkdown && targetMarkdown !== sourceMarkdown.path) {
          allowedPathMoves.add(`${sourceMarkdown.path}\0${targetMarkdown}`);
        }
      }
    }
    const path = resourcePath(loaded.root, writeModel, record);
    const previousPath = existing.path;
    const previous = await readFile(previousPath, "utf8");
    const mode = (await stat(previousPath)).mode & 0o777;
    assertRevision(
      previous,
      expectedRevisions[record.id] || existing.revision,
      `Resource "${record.id}"`
    );
    if (path !== previousPath) {
      try {
        await stat(path);
        throw new Error(`Migration destination for resource "${record.id}" already exists.`);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    const hasContentUpdate = Object.hasOwn(contentUpdates, record.id);
    const recordContentWrites = await prepareContentWrites(loaded, record, contentUpdates[record.id], {
      expectedRevisions: expectedContentRevisions[record.id],
      requireExpectedRevisions: hasContentUpdate
    });
    if (hasContentUpdate) preparedContentIds.add(record.id);
    if (recordContentWrites.length) assertWorkflowContentMutable(loaded, existing.record);
    contentWrites.push(...recordContentWrites);
    const nextRecord = hasContentUpdate
      ? await prepareApprovalBinding(loaded, record, recordContentWrites, existing.record)
      : record;
    assertGovernedContentLifecycleMutation(existing.record, nextRecord, loaded.model, lifecycleOperation);
    writes.push({ operation: path === previousPath ? "update" : "move-update", path, previousPath, record: nextRecord, previous, fileMode: mode });
  }
  for (const resourceId of Object.keys(contentUpdates)) {
    if (preparedContentIds.has(resourceId)) continue;
    const existing = existingById.get(resourceId);
    if (!existing) throw new Error(`Resource "${resourceId}" was not found.`);
    if (approvalBound(existing.record, loaded.model)) {
      throw new Error(`Batch content for approved or active resource "${resourceId}" needs a matching resource update and validation of its approval binding.`);
    }
    assertWorkflowContentMutable(loaded, existing.record);
    contentWrites.push(...await prepareContentWrites(loaded, existing.record, contentUpdates[resourceId], {
      expectedRevisions: expectedContentRevisions[resourceId],
      requireExpectedRevisions: true
    }));
  }
  const pathMoves = [];
  const seenMovePaths = new Set();
  for (const move of moves) {
    if (!move || Array.isArray(move) || typeof move !== "object") {
      throw new Error("Every migration path move must name a companion Markdown source and destination.");
    }
    const moveKey = `${move.from}\0${move.to}`;
    if (!targetModelVersion || !allowedPathMoves.has(moveKey)) {
      throw new Error("A migration path move must match companion Markdown for a resource whose type changes.");
    }
    if (seenMovePaths.has(moveKey)) throw new Error("A migration path move may appear only once.");
    seenMovePaths.add(moveKey);
    const from = resolveDataPath(loaded.root, move.from);
    const to = resolveDataPath(loaded.root, move.to);
    if (from === to) continue;
    const mode = (await stat(from)).mode & 0o777;
    try {
      await stat(to);
      throw new Error(`Migration destination data/${move.to} already exists.`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    pathMoves.push({ from, to, mode });
  }
  const written = [];
  const writtenContent = [];
  const moved = [];
  try {
    for (const item of contentWrites) {
      await writeTextAtomic(item.path, item.source);
      writtenContent.push(item);
    }
    for (const item of writes) {
      await writeAtomic(item.path, item.record, { exclusive: item.operation === "create" });
      written.push(item);
      if (item.operation === "move-update") await rm(item.previousPath);
    }
    for (const item of pathMoves) {
      await mkdir(dirname(item.to), { recursive: true });
      await rename(item.from, item.to);
      moved.push(item);
    }
    let validation = null;
    if (!deferValidation) {
      validation = await validateWorkspace(loaded.root);
      const errors = changes.validateWholeWorkspace
        ? validation.diagnostics.filter(({ severity }) => severity === "error")
        : newErrors(validation, before);
      if (errors.length) throw new Error(formatWriteFailure(errors, "resource batch"));
    }
    return {
      created: creates,
      updated: updates,
      validation
    };
  } catch (error) {
    const rollbackErrors = [];
    for (const item of moved.reverse()) {
      try {
        await mkdir(dirname(item.from), { recursive: true });
        await rename(item.to, item.from);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError.message);
      }
    }
    for (const item of written.reverse()) {
      try {
        if (item.operation === "create") await rm(item.path, { force: true });
        else if (item.operation === "move-update") {
          await rm(item.path, { force: true });
          await writeTextAtomic(item.previousPath, item.previous, { mode: item.fileMode });
        } else await writeTextAtomic(item.path, item.previous, { mode: item.fileMode });
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError.message);
      }
    }
    for (const item of writtenContent.reverse()) {
      try {
        if (item.previous === null) await rm(item.path, { force: true });
        else await writeTextAtomic(item.path, item.previous);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError.message);
      }
    }
    if (rollbackErrors.length) {
      throw new Error(`${error.message} FileGRC could not restore every file in the resource batch: ${rollbackErrors.join(" ")}`);
    }
    throw error;
  }
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
  const deferValidation = workspaceValidationDeferred();
  const before = deferValidation ? null : await validateWorkspace(loaded);
  const ids = new Set();
  const writes = [];
  for (const record of records) {
    assertSpecializedWorkflowCreate(record, {}, loaded);
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
    if (!deferValidation) {
      const result = await validateWorkspace(loaded.root);
      const introduced = newErrors(result, before);
      if (introduced.length) throw new Error(formatWriteFailure(introduced, "resource batch"));
    }
  } catch (error) {
    for (const item of written.reverse()) await rm(item.path, { force: true });
    throw error;
  }
  return records;
}

async function createResourceUnlocked(input, record, options) {
  const loaded = await loadWorkspace(input);
  assertSpecializedWorkflowCreate(record, options, loaded);
  const deferValidation = workspaceValidationDeferred();
  const before = deferValidation ? null : await validateWorkspace(loaded);
  const path = resourcePath(loaded.root, loaded.model, record);
  try {
    await stat(path);
    throw new Error(`Resource "${record.id}" already exists.`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const contentWrites = await prepareContentWrites(loaded, record, options.content, { exclusive: true });
  const nextRecord = await prepareApprovalBinding(loaded, record, contentWrites);
  const written = [];
  let recordWritten = false;
  try {
    for (const item of contentWrites) {
      await writeTextAtomic(item.path, item.source, { exclusive: true });
      written.push(item);
    }
    await writeAtomic(path, nextRecord, { exclusive: true });
    recordWritten = true;
    if (!deferValidation) {
      const result = await validateWorkspace(loaded.root);
      const introduced = newErrors(result, before);
      if (introduced.length) throw new Error(formatWriteFailure(introduced, record.id));
    }
  } catch (error) {
    if (recordWritten) await rm(path, { force: true });
    for (const item of written) await rm(item.path, { force: true });
    throw error;
  }
  return { record: nextRecord, path };
}

export async function updateResource(input, type, id, record, options = {}) {
  return serializeWorkspaceMutation(input, (root) => updateResourceUnlocked(root, type, id, record, options));
}

async function updateResourceUnlocked(input, type, id, record, options) {
  if (record.type !== type || record.id !== id) {
    throw new Error("The type and ID in the record must match the resource being updated.");
  }
  const loaded = await loadWorkspace(input);
  const deferValidation = workspaceValidationDeferred();
  const before = deferValidation ? null : await validateWorkspace(loaded);
  const path = resourcePath(loaded.root, loaded.model, record);
  const previous = await readFile(path, "utf8");
  assertRevision(previous, options.expectedRevision, "The record");
  const contentWrites = await prepareContentWrites(loaded, record, options.content, {
    expectedRevisions: options.expectedContentRevisions,
    requireExpectedRevisions: options.requireExpectedContentRevisions
  });
  const existing = loaded.entries.find(({ record: candidate }) => candidate.id === id)?.record;
  assertImmutableWorkflowRecord(existing, record, options, loaded);
  if (contentWrites.length) assertWorkflowContentMutable(loaded, existing);
  const nextRecord = await prepareApprovalBinding(loaded, record, contentWrites, existing);
  assertGovernedContentLifecycleMutation(existing, nextRecord, loaded.model, null);
  try {
    for (const item of contentWrites) await writeTextAtomic(item.path, item.source);
    await writeAtomic(path, nextRecord);
    if (!deferValidation) {
      const result = await validateWorkspace(loaded.root);
      const introduced = newErrors(result, before);
      if (introduced.length) throw new Error(formatWriteFailure(introduced, id));
    }
  } catch (error) {
    await writeTextAtomic(path, previous);
    for (const item of contentWrites) {
      if (item.previous === null) await rm(item.path, { force: true });
      else await writeTextAtomic(item.path, item.previous);
    }
    throw error;
  }
  return { record: nextRecord, path };
}

function assertImmutableWorkflowRecord(existing, next, options = {}, loaded = null) {
  if (!existing) return;
  const preservesExisting = (allowed = []) => [...new Set([...Object.keys(existing), ...Object.keys(next)])].every((key) => (
    allowed.includes(key) || JSON.stringify(next[key]) === JSON.stringify(existing[key])
  ));
  if (existing.type === "collection-review" && ["active", "retired"].includes(existing.status)) {
    const retirement = options.workflowCapability === INTERNAL_WORKFLOW_CAPABILITIES.collectionReviewReassessment
      && existing.status === "active"
      && next.status === "retired"
      && next.statusTransition?.changedOn
      && next.statusTransition?.changedByIds?.length
      && next.statusTransition?.reason
      && preservesExisting(["status", "statusTransition"]);
    const legacyReplacement = options.workflowCapability === INTERNAL_WORKFLOW_CAPABILITIES.collectionReviewReassessment
      && existing.status === "active"
      && next.status === "active";
    if (!retirement && !legacyReplacement && options.lifecycleOperation !== "model-migration") {
      throw new Error(`Finalized Collection Review "${existing.id}" is immutable. Record a superseding review instead.`);
    }
  }
  if (options.lifecycleOperation === "model-migration") return;
  if (!modelSupports(loaded?.model || 0, "rolled-up-obligations")) return;
  const capability = options.workflowCapability;
  if (
    existing.type === "obligation-occurrence"
    && existing.status === "open"
    && ![
      INTERNAL_WORKFLOW_CAPABILITIES.obligationOccurrenceReconciliation,
      INTERNAL_WORKFLOW_CAPABILITIES.obligationOccurrenceSupersession,
      INTERNAL_WORKFLOW_CAPABILITIES.obligationRuleActivation
    ].includes(capability)
  ) {
    throw new Error(`Obligation occurrence "${existing.id}" is workflow-managed. Scaffold and save its reconciliation instead of editing it directly.`);
  }
  const finalizedOccurrence = finalizedOccurrenceUsingProof(loaded, existing.id);
  if (finalizedOccurrence && !preservesExisting()) {
    throw new Error(
      `Completion record "${existing.id}" is immutable because finalized occurrence "${finalizedOccurrence.id}" relies on it. `
      + "Create a corrected completion and superseding occurrence instead."
    );
  }
  if (existing.type === "obligation-rule" && ["active", "retired"].includes(existing.status)) {
    const retirement = capability === INTERNAL_WORKFLOW_CAPABILITIES.obligationRuleActivation
      && existing.status === "active"
      && next.status === "retired"
      && preservesExisting(["status", "retiredOn"]);
    if (!retirement) throw new Error(`Effective Obligation rule "${existing.id}" is immutable. Create and activate a new rule revision instead.`);
  }
  if (
    existing.type === "obligation-rule"
    && existing.status !== "active"
    && next.status === "active"
    && capability !== INTERNAL_WORKFLOW_CAPABILITIES.obligationRuleActivation
  ) {
    throw new Error(`Obligation rule "${existing.id}" activation is workflow-managed. Review and activate the rule instead of editing it directly.`);
  }
  if (existing.type === "obligation" && capability !== INTERNAL_WORKFLOW_CAPABILITIES.obligationRuleActivation) {
    const managedFields = ["scheduleMode", "ruleIds", "activeRuleId"];
    if (managedFields.some((field) => JSON.stringify(next[field]) !== JSON.stringify(existing[field]))) {
      throw new Error(`Obligation "${existing.id}" rule adoption is workflow-managed. Activate a reviewed rule instead of editing its schedule binding directly.`);
    }
  }
  if (
    existing.type === "obligation"
    && existing.scheduleMode === "rule"
    && capability !== INTERNAL_WORKFLOW_CAPABILITIES.obligationRuleActivation
    && JSON.stringify(next.completionResourceIds) !== JSON.stringify(existing.completionResourceIds)
  ) {
    throw new Error(`Obligation "${existing.id}" historical completion links are immutable after rule activation.`);
  }
  if (existing.type === "obligation-occurrence" && ["reconciled", "superseded"].includes(existing.status)) {
    const supersession = [
      INTERNAL_WORKFLOW_CAPABILITIES.obligationOccurrenceSupersession,
      INTERNAL_WORKFLOW_CAPABILITIES.obligationRuleActivation
    ].includes(capability)
      && existing.status === "reconciled"
      && next.status === "superseded"
      && preservesExisting(["status"]);
    if (!supersession) throw new Error(`Finalized Obligation occurrence "${existing.id}" is immutable. Create a superseding reconciliation instead.`);
  }
  if (existing.type === "audit-population" && ["reconciled", "not-applicable", "superseded"].includes(existing.status)) {
    const supersession = capability === INTERNAL_WORKFLOW_CAPABILITIES.auditPopulationSupersession
      && ["reconciled", "not-applicable"].includes(existing.status)
      && next.status === "superseded"
      && preservesExisting(["status"]);
    if (!supersession) throw new Error(`Finalized Audit population "${existing.id}" is immutable. Create a superseding correction instead.`);
  }
  if (
    (existing.type === "obligation-event" && ["complete", "canceled"].includes(existing.status))
    || (existing.type === "action-item" && ["done", "canceled"].includes(existing.status) && existing.obligationId)
  ) {
    const existingEvidenceIds = existing.evidenceIds || [];
    const nextEvidenceIds = next.evidenceIds || [];
    const evidenceRepair = existing.type === "action-item"
      && existing.status === "done"
      && next.status === "done"
      && existingEvidenceIds.every((id) => nextEvidenceIds.includes(id))
      && preservesExisting(["evidenceIds"]);
    if (!evidenceRepair && !preservesExisting()) {
      throw new Error(`Finalized ${existing.type === "obligation-event" ? "Policy Event" : "generated Action Item"} "${existing.id}" is immutable. Preserve it and record a new corrective event or task.`);
    }
  }
  if (existing.type === "reporting-route" && ["active", "retired"].includes(existing.status)) {
    const retirement = existing.status === "active"
      && next.status === "retired"
      && next.endsAt
      && preservesExisting(["status", "endsAt"]);
    if (!retirement) throw new Error(`Effective Reporting Route "${existing.id}" is immutable. Create a new route revision instead.`);
  }
  if (existing.type === "attestation" && existing.status === "completed" && !preservesExisting()) {
    throw new Error(`Completed Attestation "${existing.id}" is immutable. Preserve it and record a correction separately.`);
  }
}

function assertFinalizedOccurrenceProofMutable(loaded, record) {
  const occurrence = finalizedOccurrenceUsingProof(loaded, record.id);
  if (occurrence) {
    throw new Error(
      `Proof record "${record.id}" is immutable because finalized occurrence "${occurrence.id}" relies on it. `
      + "Create corrected proof and a superseding occurrence instead."
    );
  }
}

function assertWorkflowContentMutable(loaded, record) {
  assertFinalizedOccurrenceProofMutable(loaded, record);
  if (
    (record.type === "obligation-rule" && ["active", "retired"].includes(record.status))
    || (record.type === "obligation-occurrence" && ["reconciled", "superseded"].includes(record.status))
    || (record.type === "audit-population" && ["reconciled", "not-applicable", "superseded"].includes(record.status))
    || (record.type === "obligation-event" && ["complete", "canceled"].includes(record.status))
    || (record.type === "action-item" && record.obligationId && ["done", "canceled"].includes(record.status))
    || (record.type === "collection-review" && ["active", "retired"].includes(record.status))
    || (record.type === "reporting-route" && ["active", "retired"].includes(record.status))
    || (record.type === "attestation" && record.status === "completed")
  ) {
    throw new Error(`Finalized ${record.type} Markdown is immutable. Preserve it and use the record's correction workflow.`);
  }
}

function finalizedOccurrenceUsingProof(loaded, targetId) {
  if (!loaded?.resources?.length || !targetId) return null;
  const byId = new Map(loaded.resources.map((record) => [record.id, record]));
  const proofTypes = new Set(["evidence", "exception", "attestation"]);
  const proofFields = [
    "completionResourceIds",
    "evidenceIds",
    "sampleEvidenceIds",
    "sourceEvidenceId",
    "sourceResourceIds",
    "exceptionId",
    "exceptionIds",
    "attestationIds"
  ];
  for (const occurrence of loaded.resources.filter((record) => (
    record.type === "obligation-occurrence" && ["reconciled", "superseded"].includes(record.status)
  ))) {
    const pending = (occurrence.members || []).flatMap((member) => [
      ...(member.completionResourceIds || []),
      ...(member.exceptionId ? [member.exceptionId] : [])
    ]);
    const visited = new Set();
    while (pending.length) {
      const id = pending.pop();
      if (!id || visited.has(id)) continue;
      if (id === targetId) return occurrence;
      visited.add(id);
      const record = byId.get(id);
      if (!record) continue;
      for (const field of proofFields) {
        const value = record[field];
        for (const relatedId of Array.isArray(value) ? value : value ? [value] : []) {
          if (proofTypes.has(byId.get(relatedId)?.type)) pending.push(relatedId);
        }
      }
    }
  }
  for (const owner of loaded.resources.filter((record) => (
    (record.type === "audit-population" && ["reconciled", "not-applicable", "superseded"].includes(record.status))
    || (record.type === "attestation" && record.status === "completed")
  ))) {
    const pending = [
      ...(owner.evidenceIds || []),
      ...(owner.sourceEvidenceId ? [owner.sourceEvidenceId] : [])
    ];
    const visited = new Set();
    while (pending.length) {
      const id = pending.pop();
      if (!id || visited.has(id)) continue;
      if (id === targetId) return owner;
      visited.add(id);
      const record = byId.get(id);
      if (!record) continue;
      for (const field of proofFields) {
        const value = record[field];
        for (const relatedId of Array.isArray(value) ? value : value ? [value] : []) {
          if (proofTypes.has(byId.get(relatedId)?.type)) pending.push(relatedId);
        }
      }
    }
  }
  return null;
}

function assertSpecializedWorkflowCreate(record, options = {}, loaded = null) {
  if (
    record?.type === "collection-review"
    && options.workflowCapability !== INTERNAL_WORKFLOW_CAPABILITIES.collectionReviewReassessment
    && options.lifecycleOperation !== "model-migration"
  ) {
    throw new Error(`Collection Review "${record.id || ""}" is workflow-managed. Preview and confirm the collection review instead of creating it directly.`);
  }
  if (!modelSupports(loaded?.model || 0, "rolled-up-obligations")) return;
  if (
    record?.type === "obligation-occurrence"
    && ![
      INTERNAL_WORKFLOW_CAPABILITIES.obligationOccurrenceReconciliation,
      INTERNAL_WORKFLOW_CAPABILITIES.obligationOccurrenceSupersession
    ].includes(options.workflowCapability)
  ) {
    throw new Error(`Obligation occurrence "${record.id || ""}" is workflow-managed. Scaffold and save its reconciliation instead of creating it directly.`);
  }
}

export async function updateContent(input, dataRelativePath, source, options = {}) {
  return serializeWorkspaceMutation(input, (root) => updateContentUnlocked(root, dataRelativePath, source, options));
}

async function updateContentUnlocked(input, dataRelativePath, source, options) {
  if (typeof source !== "string") throw new Error("Markdown content must be a string.");
  const loaded = await loadWorkspace(input);
  const owner = loaded.entries.find(({ record }) => (
    markdownEntries(loaded.model, record).some(({ path }) => path === dataRelativePath)
  ));
  const allowed = Boolean(owner);
  if (!allowed) {
    const error = new Error(`Markdown path "${dataRelativePath}" was not found.`);
    error.code = "ENOENT";
    throw error;
  }
  assertWorkflowContentMutable(loaded, owner.record);
  const path = resolveDataPath(loaded.root, dataRelativePath);
  const previous = await readFile(path, "utf8");
  assertRevision(previous, options.expectedRevision, "The Markdown file");
  const before = await validateWorkspace(loaded);
  const nextSource = source.endsWith("\n") ? source : `${source}\n`;
  await writeTextAtomic(path, nextSource);
  try {
    const result = await validateWorkspace(loaded.root);
    const introduced = newErrors(result, before);
    if (introduced.length) throw new Error(formatWriteFailure(introduced, dataRelativePath));
    return { path, dataRelativePath };
  } catch (error) {
    await writeTextAtomic(path, previous);
    throw error;
  }
}

export async function deleteResource(input, type, id, options = {}) {
  return serializeWorkspaceMutation(input, (root) => deleteResourceUnlocked(root, type, id, options));
}

async function deleteResourceUnlocked(input, type, id, options) {
  const loaded = await loadWorkspace(input);
  const deferValidation = workspaceValidationDeferred();
  const before = deferValidation ? null : await validateWorkspace(loaded);
  const definition = getResourceDefinition(loaded.model, type);
  if (definition.singleton) throw new Error("Singleton records cannot be deleted.");
  const path = resourcePath(loaded.root, loaded.model, { type, id });
  const mode = (await stat(path)).mode & 0o777;
  const source = await readFile(path, "utf8");
  assertRevision(source, options.expectedRevision, "The record");
  const record = JSON.parse(source);
  if (
    (record.type === "obligation-occurrence" && ["reconciled", "superseded"].includes(record.status))
    || (record.type === "audit-population" && ["reconciled", "not-applicable", "superseded"].includes(record.status))
    || (record.type === "obligation-event" && ["complete", "canceled"].includes(record.status))
    || (record.type === "action-item" && record.obligationId && ["done", "canceled"].includes(record.status))
    || (record.type === "collection-review" && ["active", "retired"].includes(record.status))
    || (record.type === "obligation-rule" && ["active", "retired"].includes(record.status))
    || (record.type === "reporting-route" && ["active", "retired"].includes(record.status))
    || (record.type === "attestation" && record.status === "completed")
  ) {
    throw new Error(`Finalized ${record.type} "${id}" cannot be deleted. Preserve it and create a superseding correction.`);
  }
  assertFinalizedOccurrenceProofMutable(loaded, record);
  if (record.type === "evidence" && (record.filePaths || []).length) {
    throw new Error(`Evidence "${id}" still has local attachments. Detach them explicitly before deleting the record.`);
  }
  const contentFiles = await exclusiveContentFiles(loaded, record);
  try {
    await rm(path);
    for (const item of contentFiles) await rm(item.path, { force: true });
    if (!deferValidation) {
      const result = await validateWorkspace(loaded.root);
      const introduced = newErrors(result, before);
      if (introduced.length) throw new Error(formatWriteFailure(introduced, id));
    }
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
  return measureTiming("writes", async () => {
    const source = `${JSON.stringify(value, null, 2)}\n`;
    await writeTextAtomicUnmeasured(path, source, options);
  });
}

async function writeTextAtomic(path, source, options = {}) {
  return measureTiming("writes", () => writeTextAtomicUnmeasured(path, source, options));
}

async function writeTextAtomicUnmeasured(path, source, options = {}) {
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
  return after.diagnostics
    .filter(({ severity }) => severity === "error")
    .filter((item) => item.code === "unsupported-model" || !existing.has(diagnosticKey(item)));
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
      if (
        options.requireExpectedRevisions
        && !Object.hasOwn(options.expectedRevisions ?? {}, dataRelativePath)
      ) {
        throw new Error(`A content revision is required for existing content at data/${dataRelativePath}.`);
      }
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

async function prepareApprovalBinding(loaded, record, contentWrites, previousRecord = null) {
  if (record.type === "attestation") {
    return prepareAttestationBinding(loaded, record, previousRecord);
  }
  const bindingFields = contentBindingFields(record, loaded.model);
  if (!bindingFields.length) return record;
  if (
    (
      record.type === "document" && modelSupports(loaded.model, "governed-document-activation")
      || record.type === "training" && modelSupports(loaded.model, "governed-training-activation")
    )
    && record.status === "active"
    && previousRecord?.status !== "active"
  ) {
    const step = record.type === "document" && documentIsAuditSpecific(record, loaded.model) ? "Step 5" : "Step 3";
    const title = getResourceDefinition(loaded.model, record.type).title;
    throw new Error(`${title} "${record.id}" must use the dedicated ${step} ${title} activation operation after approval.`);
  }
  const nextRecord = structuredClone(record);
  const proposed = new Map(contentWrites.map((item) => [item.dataRelativePath, item.source]));
  for (const { field, bound, label } of bindingFields) {
    if (!bound(record)) {
      delete nextRecord[field];
      continue;
    }
    if (bound(previousRecord) && previousRecord[field]) {
      nextRecord[field] = structuredClone(previousRecord[field]);
      continue;
    }
    const revisions = {};
    for (const item of markdownEntries(loaded.model, nextRecord)) {
      let source = proposed.get(item.path);
      if (source === undefined) {
        try {
          source = await readFile(resolveDataPath(loaded.root, item.path), "utf8");
        } catch (error) {
          if (error.code === "ENOENT") continue;
          throw error;
        }
      }
      const placeholders = openPlaceholderCount(source);
      if (placeholders) {
        throw new Error(`Cannot ${label} ${record.title} while its ${item.label} Markdown contains ${placeholders} open ${placeholders === 1 ? "placeholder" : "placeholders"}. Complete the facts and review the exact content first.`);
      }
      revisions[item.path] = contentRevision(source);
    }
    nextRecord[field] = revisions;
  }
  return nextRecord;
}

function assertGovernedContentLifecycleMutation(previousRecord, nextRecord, model, lifecycleOperation) {
  if (lifecycleOperation === "model-migration") return;
  const governedTraining = previousRecord?.type === "training"
    && nextRecord?.type === "training"
    && modelSupports(model, "governed-training-activation");
  const governedDocument = previousRecord?.type === "document"
    && nextRecord?.type === "document"
    && modelSupports(model, "governed-document-activation");
  if (
    !previousRecord
    || (!governedDocument && !governedTraining)
  ) return;
  const title = getResourceDefinition(model, nextRecord.type).title;
  const approvedStatuses = new Set(["approved", "active", "superseded", "retired"]);
  const activatedStatuses = new Set(["active", "superseded", "retired"]);
  if (approvedStatuses.has(previousRecord.status) && approvedStatuses.has(nextRecord.status)) {
    assertLifecycleFieldsUnchanged(previousRecord, nextRecord, [
      "approverIds",
      "approvedOn",
      "approvedContentRevisions"
    ], "approval", title);
  }
  if (activatedStatuses.has(previousRecord.status) && activatedStatuses.has(nextRecord.status)) {
    assertLifecycleFieldsUnchanged(previousRecord, nextRecord, [
      "activationBasis",
      "activatedByIds",
      "activatedOn",
      "activatedContentRevisions",
      "effectiveOn"
    ], "activation", title);
  }
  if (
    nextRecord.status === "active"
    && previousRecord.status !== "active"
    && !["document-activation", "governed-content-activation"].includes(lifecycleOperation)
  ) {
    const step = governedDocument && documentIsAuditSpecific(nextRecord, model) ? "Step 5" : "Step 3";
    throw new Error(`${title} "${nextRecord.id}" must use the dedicated ${step} ${title} activation operation after approval.`);
  }
}

function assertLifecycleFieldsUnchanged(previousRecord, nextRecord, fields, eventLabel, resourceTitle) {
  const changed = fields.filter((field) => (
    JSON.stringify(previousRecord[field] ?? null) !== JSON.stringify(nextRecord[field] ?? null)
  ));
  if (!changed.length) return;
  throw new Error(
    `${resourceTitle} "${nextRecord.id}" ${eventLabel} facts are immutable after the event: ${changed.join(", ")}. `
    + `Move the ${resourceTitle} back to ${eventLabel === "approval" ? "draft" : "approved"} and record a new lifecycle event.`
  );
}

async function prepareAttestationBinding(loaded, record, previousRecord = null) {
  const nextRecord = structuredClone(record);
  const bound = record.status === "completed" && record.attestationMethod === "git-approval";
  if (!bound) {
    delete nextRecord.contentRevisions;
    return bindAttestationReportingRoute(loaded, nextRecord);
  }
  if (
    previousRecord?.status === "completed"
    && previousRecord.attestationMethod === "git-approval"
    && previousRecord.contentRevisions
  ) {
    nextRecord.contentRevisions = structuredClone(previousRecord.contentRevisions);
    return bindAttestationReportingRoute(loaded, nextRecord);
  }
  const revisions = {};
  for (const id of record.subjectResourceIds || []) {
    const subject = loaded.resources.find((candidate) => candidate.id === id);
    if (!subject) continue;
    for (const item of markdownEntries(loaded.model, subject)) {
      try {
        const source = await readFile(resolveDataPath(loaded.root, item.path), "utf8");
        revisions[item.path] = contentRevision(source);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }
  nextRecord.contentRevisions = revisions;
  return bindAttestationReportingRoute(loaded, nextRecord);
}

function bindAttestationReportingRoute(loaded, record) {
  if (
    record?.type !== "attestation"
    || record.status !== "completed"
    || !loaded.model.resources.attestation?.fields?.reportingRouteId
  ) return record;
  const date = record.assignedOn || record.completedOn || currentCalendarDate(loaded.workspace.timezone);
  const cutoff = timestampFromLocalDateTime(`${date}T23:59:59`, loaded.workspace.timezone);
  const route = loaded.resources
    .filter((candidate) => (
      candidate.type === "reporting-route"
      && ["active", "retired"].includes(candidate.status)
      && candidate.purpose === "security-reporting"
      && candidate.priority === "primary"
      && new Date(candidate.effectiveAt) <= new Date(cutoff)
      && (!candidate.endsAt || new Date(candidate.endsAt) > new Date(cutoff))
    ))
    .sort((left, right) => right.effectiveAt.localeCompare(left.effectiveAt))[0] || null;
  const bound = { ...record };
  delete bound.reportingRouteId;
  delete bound.reportingRouteRevision;
  return route ? {
    ...bound,
    reportingRouteId: route.id,
    reportingRouteRevision: reportingRouteRevision(route)
  } : bound;
}

function approvalBound(record, model) {
  if (!record || !["policy", "document", "training"].includes(record.type)) return false;
  const statuses = record.type === "policy"
    ? ["approved", "active", "superseded", "retired"]
    : record.type === "document"
      ? ["approved", "active", "superseded", "retired"]
      : modelSupports(model || 0, "governed-training-activation")
        ? ["approved", "active", "superseded", "retired"]
        : ["active", "retired"];
  return statuses.includes(record.status);
}

function contentBindingFields(record, model) {
  const fields = [];
  if (["policy", "document"].includes(record?.type)) {
    fields.push({
      field: "approvedContentRevisions",
      bound: (candidate) => approvalBound(candidate, model),
      label: record.type === "policy" ? "approve or activate" : "approve"
    });
  }
  if (record?.type === "document" && model.resources.document?.fields?.activatedContentRevisions) {
    fields.push({
      field: "activatedContentRevisions",
      bound: (candidate) => (
        ["active", "superseded", "retired"].includes(candidate?.status)
        && candidate.activationBasis === "recorded"
      ),
      label: "activate"
    });
  }
  if (record?.type === "training" && model.resources.training?.fields?.effectiveContentRevisions) {
    fields.push({ field: "effectiveContentRevisions", bound: (candidate) => approvalBound(candidate, model), label: "approve or activate" });
  }
  if (record?.type === "training" && model.resources.training?.fields?.approvedContentRevisions) {
    fields.push({ field: "approvedContentRevisions", bound: (candidate) => approvalBound(candidate, model), label: "approve" });
  }
  if (record?.type === "training" && model.resources.training?.fields?.activatedContentRevisions) {
    fields.push({
      field: "activatedContentRevisions",
      bound: (candidate) => (
        ["active", "superseded", "retired"].includes(candidate?.status)
        && candidate.activationBasis === "recorded"
      ),
      label: "activate"
    });
  }
  return fields;
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
