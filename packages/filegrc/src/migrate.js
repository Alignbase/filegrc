import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadModel } from "../model/index.js";
import { getGitSummary } from "./git.js";
import { serializeWorkspaceMutation } from "./mutation.js";
import { resolveDataPath, resolveWorkspacePath } from "./paths.js";
import { markdownDataPath, markdownSlots } from "./resource-markdown.js";
import { validateWorkspace } from "./validate.js";

export async function planModelMigration(input = process.cwd(), targetVersion) {
  const validation = await validateWorkspace(input);
  const { loaded } = validation;
  const sourceVersion = loaded.model.modelVersion;
  const target = String(targetVersion);
  if (!validation.ok) throw new Error("Fix workspace validation errors before planning a model migration.");
  if (sourceVersion === target) throw new Error(`The workspace already uses data model v${target}.`);
  if (sourceVersion !== "1" || target !== "2") {
    throw new Error(`No migration is available from data model v${sourceVersion} to v${target}.`);
  }

  const targetModel = loadModel(target);
  const records = [];
  const markdown = [];
  const blockers = [];
  const targetPaths = new Set();
  for (const entry of loaded.entries) {
    const record = structuredClone(entry.record);
    const removedFields = [];
    const targetSlots = new Set(markdownSlots(targetModel, record.type).map(({ name }) => name));
    for (const sourceSlot of markdownSlots(loaded.model, record.type)) {
      const sourcePath = markdownDataPath(loaded.model, record, sourceSlot.name);
      if (!sourcePath) continue;
      const targetSlot = legacyTargetSlot(sourceSlot.name);
      if (!targetSlots.has(targetSlot)) {
        blockers.push({
          path: `data/${entry.relativePath}`,
          message: `${sourceSlot.name} has no unambiguous v2 Markdown companion. Move or merge that content before migrating.`
        });
        continue;
      }
      const targetPath = markdownDataPath(targetModel, record, targetSlot);
      if (targetPaths.has(targetPath)) {
        blockers.push({ path: `data/${targetPath}`, message: "More than one Markdown source would use this companion path." });
        continue;
      }
      targetPaths.add(targetPath);
      if (await pathExists(resolveDataPath(loaded.root, targetPath))) {
        blockers.push({ path: `data/${targetPath}`, message: "The v2 companion path already exists and would be overwritten." });
        continue;
      }
      markdown.push({ resourceId: record.id, slot: targetSlot, from: `data/${sourcePath}`, to: `data/${targetPath}` });
      delete record[sourceSlot.name];
      removedFields.push(sourceSlot.name);
    }
    if (record.type === "workspace") record.dataModelVersion = target;
    records.push({
      id: record.id,
      type: record.type,
      path: `data/${entry.relativePath}`,
      removedFields,
      record
    });
  }

  return {
    sourceVersion,
    targetVersion: target,
    summary: {
      records: records.length,
      changedRecords: records.filter(({ removedFields, type }) => removedFields.length || type === "workspace").length,
      markdownFiles: markdown.length,
      blockers: blockers.length
    },
    blockers,
    records,
    markdown
  };
}

export async function applyModelMigration(input = process.cwd(), targetVersion) {
  return serializeWorkspaceMutation(input, async (root) => {
    const git = getGitSummary(root);
    if (!git.available) throw new Error("Initialize Git and commit the workspace before applying a model migration.");
    if (!git.clean) throw new Error("Commit or discard current changes before applying a model migration.");
    const plan = await planModelMigration(root, targetVersion);
    if (plan.blockers.length) {
      throw new Error(`The migration has ${plan.blockers.length} unresolved ${plan.blockers.length === 1 ? "blocker" : "blockers"}. Review the migration plan before applying it.`);
    }

    const migrationId = `v${plan.sourceVersion}-to-v${plan.targetVersion}-${randomUUID()}`;
    const migrationRoot = resolveWorkspacePath(root, `.filegrc/migrations/${migrationId}`);
    const candidateRoot = join(migrationRoot, "candidate");
    const backupRoot = join(migrationRoot, "backup");
    await mkdir(migrationRoot, { recursive: true });
    await cp(resolveDataPath(root, "."), join(candidateRoot, "data"), { recursive: true, errorOnExist: true });
    try {
      for (const item of plan.markdown) {
        const source = await readFile(resolveWorkspacePath(root, item.from), "utf8");
        const target = resolveWorkspacePath(candidateRoot, item.to);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, source, { encoding: "utf8", flag: "wx" });
      }
      for (const item of plan.records) {
        const target = resolveWorkspacePath(candidateRoot, item.path);
        await writeFile(target, `${JSON.stringify(item.record, null, 2)}\n`, "utf8");
      }
      for (const item of new Set(plan.markdown.map(({ from }) => from))) {
        await rm(resolveWorkspacePath(candidateRoot, item));
      }
      const candidateValidation = await validateWorkspace(candidateRoot);
      if (!candidateValidation.ok) {
        const detail = candidateValidation.diagnostics.find(({ severity }) => severity === "error")?.message ?? "Unknown validation error.";
        throw new Error(`The v2 migration candidate is invalid. ${detail}`);
      }
      const currentGit = getGitSummary(root);
      if (!currentGit.clean || currentGit.commit !== git.commit) {
        throw new Error("The workspace changed while the migration candidate was being prepared. Review the changes and plan the migration again.");
      }

      await mkdir(backupRoot, { recursive: true });
      const sourceData = resolveDataPath(root, ".");
      const backupData = join(backupRoot, "data");
      const candidateData = join(candidateRoot, "data");
      await rename(sourceData, backupData);
      try {
        await rename(candidateData, sourceData);
      } catch (error) {
        await rename(backupData, sourceData);
        throw error;
      }
      const result = await validateWorkspace(root);
      if (!result.ok) {
        await rm(sourceData, { recursive: true, force: true });
        await rename(backupData, sourceData);
        throw new Error("The applied migration did not validate; the original data was restored.");
      }
      await rm(candidateRoot, { recursive: true, force: true });
      return {
        ...plan,
        backup: `.filegrc/migrations/${migrationId}/backup/data`,
        rollbackCommit: git.commit
      };
    } catch (error) {
      await rm(candidateRoot, { recursive: true, force: true });
      throw error;
    }
  });
}

function legacyTargetSlot(name) {
  if (name === "notesPath") return "record";
  return name.replace(/Path$/, "");
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
