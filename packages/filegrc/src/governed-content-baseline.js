import { retentionScheduleOperatingProofMatches, retentionScheduleOperatingHistoryIds } from "./retention-schedule-approval.js";
import { getFileAtRevision, getFileHistoryWithPaths, getFilesAtRevisions, isGitAncestor } from "./git.js";
import { reviewHistoryContext, reviewHistoryCommits, reviewHistoricalWorkspace } from "./historical-workspace.js";
import { calculationMemo } from "./calculation-cache.js";
import { readFileSync } from "node:fs";
import { markdownEntries, resourceDataPath } from "./resource-markdown.js";
import { resolveDataPath } from "./paths.js";
import { modelSupports } from "../model/index.js";
import { calculateRevision, revisionDigest, revisionsMatch } from "./revisions.js";
import { partiesIndependent, partyPeople } from "./parties.js";
import { personWasActiveOn } from "./soc2.js";
import { parseCalendarDate } from "./recurrence.js";

const lookupSources = new WeakMap();
const recordSources = new WeakMap();

// Context is derived and request-local. Source records never hold Git metadata.
export function registerGovernedLookup(byId, loaded) {
  if (loaded) lookupSources.set(byId, loaded);
  return byId;
}

export function governedContentSource(loaded, record) {
  const historical = recordSources.get(record);
  if (historical) return historical;
  return { loaded, record, commit: loaded?.historicalCommit || null,
    entry: loaded?.entries?.find((entry) => entry.record === record || entry.record.id === record?.id) || null };
}

export function governedMarkdownSource(loaded, record, path) {
  const source = governedContentSource(loaded, record);
  const workspace = source.loaded;
  if (!workspace) return null;
  return calculationMemo(workspace.resources || workspace, "governed-markdown-source", [workspace.root || null,
    source.commit || null, workspace.historicalFiles || null, path], () => {
    if (workspace.historicalFiles instanceof Map) return workspace.historicalFiles.get(`data/${path}`) ?? null;
    if (source.commit) return getFileAtRevision(workspace.root, source.commit, `data/${path}`);
    if (!workspace.root) return null;
    try { return readFileSync(resolveDataPath(workspace.root, path), "utf8"); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  });
}

const governedTypes = new Set(["policy", "document", "training"]);
const pendingStatuses = new Set(["draft", "in-review", "proposed", "approved"]);
const date = (value) => typeof value === "string" && parseCalendarDate(value) ? value : null;

function contentRevisionBindingsMatch(left, right) {
  if (!left || !right || Array.isArray(left) || Array.isArray(right)) return false;
  const entries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b));
  const other = Object.entries(right).sort(([a], [b]) => a.localeCompare(b));
  return entries.length > 0 && entries.length === other.length
    && entries.every(([path, revision], index) => other[index][0] === path
      && revisionsMatch("content", revision, other[index][1]));
}

function bound(revisions) {
  return revisions && !Array.isArray(revisions) && Object.keys(revisions).length > 0
    && Object.values(revisions).every((revision) => revisionDigest("content", revision));
}

function operatingStart(record, model) {
  const effective = date(record?.effectiveOn);
  if (!effective) return null;
  if (record.type === "policy" || !modelSupports(model, record.type === "document" ? "governed-document-activation" : "governed-training-activation")) return effective;
  if (record.type === "training" && record.activationBasis === "legacy-v5") return effective;
  const activated = date(record.activatedOn);
  return activated ? [effective, activated].sort().at(-1) : null;
}

function operatingEnd(record) {
  if (!["retired", "superseded"].includes(record.status)) return null;
  return date(record.retiredOn) || date(record.statusTransition?.changedOn);
}

function authorized(record, byId, model) {
  if (!date(record.approvedOn) || !date(record.effectiveOn) || record.approvedOn > record.effectiveOn) return false;
  if (!modelSupports(model, "operating-preparation")) return true;
  if (!bound(record.approvedContentRevisions)
    || !partiesIndependent(record.ownerIds || [], record.approverIds || record.approvedByIds || [], byId)
    || [...partyPeople(record.approverIds || record.approvedByIds || [], byId)].some((id) => !personWasActiveOn(byId.get(id), record.approvedOn))) return false;
  if (record.type === "policy") return true;
  if (record.type === "training" && record.activationBasis === "legacy-v5") return true;
  return record.activationBasis === "recorded" && date(record.activatedOn)
    && record.approvedOn <= record.activatedOn
    && record.activatedByIds?.length > 0
    && record.activatedByIds.every((id) => personWasActiveOn(byId.get(id), record.activatedOn))
    && contentRevisionBindingsMatch(record.approvedContentRevisions, record.activatedContentRevisions);
}

function predecessorCoversScope(proposed, predecessor) {
  for (const field of ["policyKind", "documentKind", "workflowScope"]) {
    if ((proposed[field] ?? null) !== (predecessor[field] ?? null)) return false;
  }
  for (const field of ["requirementIds", "policyIds", "systemIds", "controlIds", "componentIds", "trainingIds"]) {
    const oldIds = new Set(predecessor[field] || []);
    if ((proposed[field] || []).some(id => !oldIds.has(id))) return false;
  }
  return true;
}

function historySnapshots(loaded, ids) {
  if (!loaded?.root || !loaded.resources) return [];
  const context = reviewHistoryContext(loaded.root, loaded);
  let commits = reviewHistoryCommits(context);
  if (context.index?.available && ids?.size) {
    // Only these source changes can alter a governed edition. Avoid building
    // whole historical workspaces for unrelated evidence and operating work.
    const paths = new Set();
    const relevantIds = new Set(ids);
    for (const id of ids) {
      const record = loaded.resources.find((item) => item.id === id);
      if (record) for (const relatedId of retentionScheduleOperatingHistoryIds(loaded, record)) relevantIds.add(relatedId);
    }
    for (const id of relevantIds) {
      for (const item of context.index.historiesById.get(id) || []) paths.add(item.path);
      const record = loaded.resources.find((item) => item.id === id);
      if (record) for (const { path } of markdownEntries(loaded.model, record)) paths.add(`data/${path}`);
    }
    commits = commits.filter((commit) => [...(context.index.fileChangesByCommit.get(commit)?.keys() || [])]
      .some((path) => paths.has(path)));
  }
  if (loaded.historicalCommit) {
    // Indexed and fallback histories must obey the same ancestry boundary.
    const ancestors = context.index?.available ? new Set() : null;
    if (ancestors) {
      const pending = [loaded.historicalCommit];
      while (pending.length) {
        const commit = pending.pop();
        if (ancestors.has(commit)) continue;
        ancestors.add(commit);
        pending.push(...(context.index.parentsByCommit.get(commit) || []));
      }
    }
    commits = commits.filter((commit) => ancestors ? ancestors.has(commit)
      : isGitAncestor(loaded.root, commit, loaded.historicalCommit));
  }
  return [...commits].reverse().map((commit) => ({ commit, snapshot: () => reviewHistoricalWorkspace(context, commit) }));
}

// Distinguish an initial approval from a proposal whose actual operating
// edition ended or failed. This is derived from the same bounded Git lineage.
export function governedContentHasOperatingHistory(loaded, record) {
  if (!governedTypes.has(record?.type)) return false;
  for (const { snapshot: readSnapshot } of historySnapshots(loaded, new Set([record.id]))) {
    const snapshot = readSnapshot();
    const candidate = snapshot?.resources.find((item) => item.id === record.id && item.type === record.type);
    if (!candidate) continue;
    if (["retired", "superseded"].includes(candidate.status)) return true;
    if (candidate.status !== "active") continue;
    const byId = snapshot.byId || new Map(snapshot.resources.map((item) => [item.id, item]));
    if (operatingStart(candidate, loaded.model) && authorized(candidate, byId, loaded.model)
      && governedApprovalContentMatches(snapshot, candidate)
      && retentionScheduleOperatingProofMatches(snapshot, candidate, operatingStart(candidate, loaded.model))) return true;
  }
  return false;
}

function awaitsCutover(record, asOf, model) {
  return pendingStatuses.has(record.status) || ["active", "retired", "superseded"].includes(record.status)
    && (date(record.effectiveOn) > asOf || operatingStart(record, model) > asOf);
}

function historicalEdition(record, byId, asOf, model, options) {
  const loaded = lookupSources.get(byId);
  if (!loaded || !modelSupports(model, "operating-preparation")) return undefined;
  for (const { commit, snapshot: readSnapshot } of historySnapshots(loaded, new Set([record.id]))) {
    const snapshot = readSnapshot();
    const candidate = snapshot?.resources.find((item) => item.id === record.id);
    if (!candidate || candidate.type !== record.type) continue;
    if (awaitsCutover(candidate, asOf, snapshot.model)) continue;
    if (!["active", "retired", "superseded"].includes(candidate.status)) continue;
    const end = operatingEnd(candidate);
    // The latest actual retirement or broken cutover cannot revive old duties.
    if (["retired", "superseded"].includes(candidate.status) && (!end || end <= asOf)) return null;
    const sourceById = snapshot.byId || new Map(snapshot.resources.map((item) => [item.id, item]));
    const start = operatingStart(candidate, snapshot.model);
    const entry = snapshot.entries?.find((item) => item.record.id === candidate.id) || null;
    // Historical workspaces intern identical JSON across commits. Provenance
    // belongs to this selected edition, never to the shared snapshot record.
    const edition = { ...candidate };
    recordSources.set(edition, { loaded: snapshot, record: edition, entry, commit });
    if (!start || start > asOf || !authorized(edition, sourceById, snapshot.model)
      || !governedApprovalContentMatches(snapshot, edition)
      || !retentionScheduleOperatingProofMatches(snapshot, edition, asOf)) return null;
    if (options.contentMatches && !options.contentMatches(edition)) return null;
    return edition;
  }
  return undefined;
}

// A proposal changes review work. Only an actual activation/effective cutover
// changes the operating baseline. A broken claimed cutover never falls back.
export function governedContentBaseline(record, byId, asOf, model, options = {}) {
  if (!governedTypes.has(record?.type) || !date(asOf)) return null;
  const seen = new Set();
  let candidate = record;
  while (candidate && !seen.has(candidate.id)) {
    seen.add(candidate.id);
    if (awaitsCutover(candidate, asOf, model)) {
      const historical = historicalEdition(candidate, byId, asOf, model, options);
      if (historical === null) return null;
      if (historical) candidate = historical;
      else {
        const prior = byId.get(candidate.supersedesId);
        if (prior?.type !== record.type || !predecessorCoversScope(candidate, prior)) return null;
        candidate = prior;
        continue;
      }
    }
    if (!["active", "superseded", "retired"].includes(candidate.status)) return null;
    const successors = [...byId.values()].filter((next) => next.type === candidate.type && next.supersedesId === candidate.id
      && ["active", "superseded", "retired"].includes(next.status) && date(next.effectiveOn) && next.effectiveOn <= asOf
      && !(operatingStart(next, model) > asOf));
    if (successors.length > 1) return null;
    if (successors.length === 1) {
      if (seen.has(successors[0].id)) return null;
      candidate = successors[0]; continue;
    }
    const start = operatingStart(candidate, model);
    const end = operatingEnd(candidate);
    const source = recordSources.get(candidate)?.loaded || lookupSources.get(byId);
    const authorizationById = recordSources.has(candidate)
      ? source.byId || new Map(source.resources.map((item) => [item.id, item])) : byId;
    if (!start || start > asOf || (["superseded", "retired"].includes(candidate.status) && !end)
      || end && end <= asOf || !authorized(candidate, authorizationById, model)
      || source?.root && modelSupports(model, "operating-preparation")
        && (!governedApprovalContentMatches(source, candidate) || !retentionScheduleOperatingProofMatches(source, candidate, asOf))
      || options.contentMatches && !options.contentMatches(candidate)) return null;
    return candidate;
  }
  return null;
}

export function pendingGovernedSuccessor(record, byId, asOf, model, options = {}) {
  if (!record || !(pendingStatuses.has(record.status) || record.status === "active" && awaitsCutover(record, asOf, model))) return null;
  const baseline = governedContentBaseline(record, byId, asOf, model, options);
  return baseline && (baseline.id !== record.id || recordSources.has(baseline))
    && predecessorCoversScope(record, baseline) ? baseline : null;
}

// Date discovery needs only governed JSON versions, never full workspace states.
// Exact record/Markdown approval and activation checks remain in the resolver.
function originHistoryRecords(loaded, byId, record, dependencyIds) {
  const owner = loaded?.resources || byId;
  return calculationMemo(owner, "governed-origin-history-records", [loaded?.root || null, loaded?.historicalCommit || null,
    loaded?.model?.modelVersion || null, record.id, [...dependencyIds].sort().join("\0")], () => {
    const ids = new Set([record.id, ...dependencyIds]);
    const records = [];
    const context = loaded?.root ? reviewHistoryContext(loaded.root, loaded) : null;
    const allowed = (commit) => !loaded?.historicalCommit || commit === loaded.historicalCommit
      || isGitAncestor(loaded.root, commit, loaded.historicalCommit);
    const seen = new Set();
    while ([...ids].some((id) => !seen.has(id))) {
      const id = [...ids].find((candidate) => !seen.has(candidate));
      seen.add(id);
      const current = byId.get(id);
      if (current && governedTypes.has(current.type)) records.push(current);
      if (context?.index?.available) {
        for (const item of context.index.historiesById.get(id) || []) {
          if (!allowed(item.commit)) continue;
          const entry = context.index.recordsByCommit.get(item.commit)?.get(id);
          if (entry && governedTypes.has(entry.record.type)) records.push(entry.record);
        }
      } else if (context && context.index?.error?.code !== "FILEGRC_INVALID_HISTORY_RECORD") {
        const entry = loaded.entries?.find((item) => item.record.id === id);
        const path = `data/${entry?.relativePath || resourceDataPath(loaded.model, current || { ...record, id })}`;
        const history = (getFileHistoryWithPaths(loaded.root, path, Number.MAX_SAFE_INTEGER) || []).filter((item) => allowed(item.commit));
        const sources = getFilesAtRevisions(loaded.root, history.map((item) => ({ revision: item.commit, relativePath: item.path })));
        for (const source of sources) {
          try {
            const candidate = JSON.parse(source);
            if (candidate?.id === id && governedTypes.has(candidate.type)) records.push(candidate);
          } catch { /* The normal historical resolver reports unreadable proof. */ }
        }
      }
      for (const candidate of records) {
        if (candidate.supersedesId && !ids.has(candidate.supersedesId)) ids.add(candidate.supersedesId);
      }
      for (const candidate of byId.values()) {
        if (governedTypes.has(candidate.type) && ids.has(candidate.supersedesId)) ids.add(candidate.id);
      }
    }
    return records;
  });
}

// Calendar debt starts with actual governing operation, not each later content
// revision. This origin makes no claim that the intervening period is covered.
export function governedContentOperatingOrigin(record, byId, asOf, model, options = {}) {
  const loaded = lookupSources.get(byId);
  const owner = loaded?.resources || byId;
  const policy = record?.type === "policy" && !options.appliesOn;
  return calculationMemo(owner, "governed-operating-origin", [loaded?.root || null, loaded?.historicalCommit || null,
    model.modelVersion, record?.id, asOf, policy ? null : options.scopeKey || null], () => {
    const source = byId.get(record.id) || record;
    const current = governedContentBaseline(source, byId, asOf, model);
    if (!current) return null;
    const currentStart = operatingStart(current, model);
    const records = originHistoryRecords(loaded, byId, source, policy ? [] : options.dependencyIds || []);
    const dates = [...new Set([...records.filter((candidate) => ["active", "retired", "superseded"].includes(candidate.status))
      .map((candidate) => operatingStart(candidate, model) || date(candidate.effectiveOn)), currentStart, asOf]
      .filter((value) => date(value) && value <= asOf))].sort();
    if (!dates.some((on) => on < currentStart) && (!options.appliesOn || options.appliesOn(currentStart, current))) return currentStart;
    for (const on of dates) {
      const edition = governedContentBaseline(source, byId, on, model);
      if (edition && (!options.appliesOn || options.appliesOn(on, edition))) return on;
    }
    return null;
  });
}

export function governedContentCoversPeriod(record, start, end, byId, model, options = {}) {
  if (!date(start) || !date(end) || start > end) return false;
  const lineage = new Set([record?.id]);
  for (let changed = true; changed;) {
    changed = false;
    for (const candidate of byId.values()) {
      if (candidate.type !== record?.type) continue;
      if (lineage.has(candidate.id) && candidate.supersedesId && !lineage.has(candidate.supersedesId)) { lineage.add(candidate.supersedesId); changed = true; }
      if (lineage.has(candidate.supersedesId) && !lineage.has(candidate.id)) { lineage.add(candidate.id); changed = true; }
    }
  }
  const candidates = [...lineage].map((id) => byId.get(id)).filter(Boolean);
  if (modelSupports(model, "operating-preparation")) {
    for (const { snapshot } of historySnapshots(lookupSources.get(byId), lineage)) {
      for (const candidate of snapshot()?.resources || []) {
        if (lineage.has(candidate.id) && candidate.type === record?.type) candidates.push(candidate);
      }
    }
  }
  const boundaries = new Set([start, end]);
  for (const candidate of candidates) {
    for (const value of [candidate.effectiveOn, candidate.activatedOn, operatingEnd(candidate)]) {
      if (date(value) && value >= start && value <= end) boundaries.add(value);
    }
  }
  return [...boundaries].every((asOf) => governedContentBaseline(record, byId, asOf, model, options));
}

export function governedApprovalContentMatches(loaded, record) {
  const source = governedContentSource(loaded, record);
  const entries = markdownEntries(source.loaded.model, record);
  if (!entries.length || Object.keys(record.approvedContentRevisions || {}).length !== entries.length) return false;
  return entries.every(({ path }) => {
    const text = governedMarkdownSource(loaded, record, path);
    return typeof text === "string"
      && revisionsMatch("content", record.approvedContentRevisions?.[path], calculateRevision("content", text));
  });
}
