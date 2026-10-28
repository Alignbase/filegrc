import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getDataRecordHistoryIndex, runGitCommandSync } from "./git.js";
import { runtimeCompatibilityLine } from "./runtime-version.js";

export const WORKFLOW_SOURCE_MINIMUM_VERSION = "0.21.6";
const instruction = "Adopt FileGRC 0.21.6 or newer in both package.json and package-lock.json, and upgrade every hosted reader, before saving withdrawn rules or period-impact decisions.";
const historicalPins = new Map();

function version(value) {
  if (!runtimeCompatibilityLine(value)) return null;
  return value.split("+")[0].split(".").map(Number);
}
function atLeast(value, minimum) {
  const parsed = version(value), required = version(minimum);
  if (!parsed || !required) return false;
  for (let index = 0; index < 3; index++) {
    if (parsed[index] !== required[index]) return parsed[index] > required[index];
  }
  return true;
}
function inDeclaredRange(declared, minimum, locked) {
  const start = version(minimum), actual = version(locked);
  if (!start || !actual || !atLeast(locked, minimum)) return false;
  if (declared.startsWith("~")) return actual[0] === start[0] && actual[1] === start[1];
  if (declared.startsWith("^")) return actual[0] === start[0] && (start[0] > 0 || actual[1] === start[1] && (start[1] > 0 || actual[2] === start[2]));
  return actual.every((part, index) => part === start[index]);
}

export function workflowSourceRuntimeAdopted(loaded, commit = loaded.historicalCommit || null) {
  const cacheKey = commit && `${loaded.root}\0${commit}`;
  if (cacheKey && historicalPins.has(cacheKey)) return historicalPins.get(cacheKey);
  try {
    if (commit && !/^[a-f0-9]{40}$/i.test(commit)) return false;
    const read = name => JSON.parse(commit ? runGitCommandSync(loaded.root, ["show", `${commit}:./${name}`]) : readFileSync(join(loaded.root, name), "utf8"));
    const manifest = read("package.json"), lock = read("package-lock.json");
    const declared = manifest.dependencies?.filegrc || manifest.devDependencies?.filegrc;
    const minimum = typeof declared === "string" && /^(?:\^|~)?(\d+\.\d+\.\d+)$/.exec(declared)?.[1];
    const rootDeclaration = lock.packages?.[""]?.dependencies?.filegrc || lock.packages?.[""]?.devDependencies?.filegrc;
    const installed = lock.packages?.["node_modules/filegrc"];
    const supported = rootDeclaration === declared && !installed?.link && atLeast(minimum, WORKFLOW_SOURCE_MINIMUM_VERSION)
      && atLeast(installed?.version, WORKFLOW_SOURCE_MINIMUM_VERSION) && inDeclaredRange(declared, minimum, installed?.version);
    if (cacheKey) { historicalPins.set(cacheKey, supported); if (historicalPins.size > 512) historicalPins.delete(historicalPins.keys().next().value); }
    return supported;
  } catch { return false; }
}

export function assertWorkflowSourceRuntimeAdopted(loaded) {
  if (!workflowSourceRuntimeAdopted(loaded)) throw Object.assign(new Error(instruction), { code: "FILEGRC_SOURCE_RUNTIME_ADOPTION" });
}
export function assertWorkflowSourceRecordAdopted(loaded, record) {
  if (usesNewSource(record)) assertWorkflowSourceRuntimeAdopted(loaded);
}

function usesNewSource(record) {
  return record && (Object.hasOwn(record, "periodImpactReview") || record.type === "obligation-rule"
    && (record.status === "withdrawn" || ["withdrawnByIds", "withdrawnOn", "withdrawalReason"].some(field => Object.hasOwn(record, field))));
}

export function workflowSourceRuntimeIssues(loaded) {
  const current = loaded.resources.filter(usesNewSource);
  const index = loaded.root ? getDataRecordHistoryIndex(loaded.root) : null;
  const firstUses = new Map();
  if (index?.available) {
    let ancestors = null;
    if (loaded.historicalCommit) {
      ancestors = new Set(); const pending = [loaded.historicalCommit];
      while (pending.length) { const commit = pending.pop(); if (ancestors.has(commit)) continue; ancestors.add(commit); pending.push(...index.parentsByCommit.get(commit) || []); }
    }
    for (const [id, history] of index.historiesById) for (const { commit, path } of [...history].reverse()) {
      if (ancestors && !ancestors.has(commit)) continue;
      const record = index.recordsByCommit.get(commit)?.get(id)?.record;
      if (usesNewSource(record)) { firstUses.set(id, { commit, path }); break; }
    }
  }
  if (!current.length && !firstUses.size) return [];
  if (!workflowSourceRuntimeAdopted(loaded)) return [{ severity: "error", code: "source-runtime-adoption-required", path: "package-lock.json", message: instruction }];
  const checked = new Map(), issues = [];
  for (const { commit, path } of firstUses.values()) {
    if (!checked.has(commit)) checked.set(commit, workflowSourceRuntimeAdopted(loaded, commit));
    if (!checked.get(commit)) issues.push({ severity: "warning", code: "historical-source-runtime-adoption", path,
      message: `New source fields were first committed at ${commit.slice(0, 12)} before the repository adopted their reader. The current dependency is repaired; preserve this historical format limitation. Older-pin snapshots cannot prove these new decisions were readable then. No business dates or prior approvals need to change.` });
  }
  return issues;
}
