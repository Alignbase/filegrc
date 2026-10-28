import { getFileAtRevision } from "./git.js";
import { readFileSync } from "node:fs";
import { markdownEntries } from "./resource-markdown.js";
import { resolveDataPath } from "./paths.js";
import { modelSupports } from "../model/index.js";
import { calculateRevision, revisionDigest, revisionsMatch } from "./revisions.js";
import { partiesIndependent, partyPeople } from "./parties.js";
import { personWasActiveOn } from "./soc2.js";
import { parseCalendarDate } from "./recurrence.js";

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

// A proposal changes review work. Only an actual activation/effective cutover
// changes the operating baseline. A broken claimed cutover never falls back.
export function governedContentBaseline(record, byId, asOf, model, options = {}) {
  if (!governedTypes.has(record?.type) || !date(asOf)) return null;
  const seen = new Set();
  let candidate = record;
  while (candidate && !seen.has(candidate.id)) {
    seen.add(candidate.id);
    if (pendingStatuses.has(candidate.status) || candidate.status === "active" && date(candidate.effectiveOn) > asOf) {
      const prior = byId.get(candidate.supersedesId);
      if (prior?.type !== record.type || !predecessorCoversScope(candidate, prior)) return null;
      candidate = prior;
      continue;
    }
    if (!["active", "superseded", "retired"].includes(candidate.status)) return null;
    const successors = [...byId.values()].filter((next) => next.type === candidate.type && next.supersedesId === candidate.id
      && ["active", "superseded", "retired"].includes(next.status) && date(next.effectiveOn) && next.effectiveOn <= asOf);
    if (successors.length > 1) return null;
    if (successors.length === 1) {
      if (seen.has(successors[0].id)) return null;
      candidate = successors[0]; continue;
    }
    const start = operatingStart(candidate, model);
    const end = operatingEnd(candidate);
    if (!start || start > asOf || (["superseded", "retired"].includes(candidate.status) && !end)
      || end && end <= asOf || !authorized(candidate, byId, model)
      || options.contentMatches && !options.contentMatches(candidate)) return null;
    return candidate;
  }
  return null;
}

export function pendingGovernedSuccessor(record, byId, asOf, model, options = {}) {
  if (!pendingStatuses.has(record?.status) && !(record?.status === "active" && date(record.effectiveOn) > asOf)) return null;
  const baseline = governedContentBaseline(record, byId, asOf, model, options);
  return baseline && baseline.id !== record.id ? baseline : null;
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
  const boundaries = new Set([start, end]);
  for (const id of lineage) {
    const candidate = byId.get(id);
    if (!candidate) continue;
    for (const value of [candidate.effectiveOn, candidate.activatedOn, operatingEnd(candidate)]) {
      if (date(value) && value >= start && value <= end) boundaries.add(value);
    }
  }
  return [...boundaries].every((asOf) => governedContentBaseline(record, byId, asOf, model, options));
}

export function governedApprovalContentMatches(loaded, record) {
  const entries = markdownEntries(loaded.model, record);
  if (!entries.length || Object.keys(record.approvedContentRevisions || {}).length !== entries.length) return false;
  return entries.every(({ path }) => {
    try {
      const source = loaded.historicalFiles instanceof Map ? loaded.historicalFiles.get(`data/${path}`)
        : loaded.historicalCommit ? getFileAtRevision(loaded.root, loaded.historicalCommit, `data/${path}`)
          : readFileSync(resolveDataPath(loaded.root, path), "utf8");
      if (typeof source !== "string") return false;
      return revisionsMatch("content", record.approvedContentRevisions?.[path], calculateRevision("content", source));
    } catch (error) { if (error.code === "ENOENT") return false; throw error; }
  });
}
