import { readFile } from "node:fs/promises";
import {
  getDataRecordHistoryIndex,
  getFileAtRevision,
  getFileObjectIdAtRevision,
  getRecordIdentityHistories,
  getWorkingFileObjectId,
  isGitAncestor
} from "./git.js";
import { resolveDataPath } from "./paths.js";
import { markdownEntries } from "./resource-markdown.js";
import { currentCalendarDate, isRfc3339Timestamp } from "./time.js";

const FINAL_STATUSES = new Map([
  ["collection-review", new Set(["active", "retired"])],
  ["obligation-rule", new Set(["active", "retired"])],
  ["obligation-occurrence", new Set(["reconciled", "superseded"])],
  ["audit-population", new Set(["reconciled", "not-applicable", "superseded"])],
  ["reporting-route", new Set(["active", "retired"])],
  ["attestation", new Set(["completed"])],
  ["obligation-event", new Set(["complete", "canceled"])],
  ["action-item", new Set(["done", "canceled"])]
]);

const PROOF_FIELDS = [
  "completionResourceIds",
  "evidenceIds",
  "sampleEvidenceIds",
  "sourceEvidenceId",
  "sourceResourceIds",
  "exceptionId",
  "exceptionIds",
  "attestationIds"
];

export async function validateWorkflowHistoryIntegrity(loaded, diagnostics) {
  const historical = historicalState(loaded);
  if (!historical.available) {
    if (!loaded.resources.some(isFinalized)) return;
    diagnostics.push({
      severity: "error",
      code: "workflow-history-unavailable",
      path: "data/workspace.json",
      message: "Complete Git history is required to verify finalized workflow records. Restore Git history access, unshallow the repository if needed, and validate again."
    });
    return;
  }
  const { commits, historicalFinalized, revisionRecords, historiesById } = historical;
  const firstFinalized = new Map();
  const currentById = new Map(loaded.resources.map((record) => [record.id, record]));
  for (const [id, historical] of historicalFinalized) {
    const current = currentById.get(id);
    if (!current || !isFinalized(current)) {
      diagnostics.push({
        severity: "error",
        code: current ? "reopened-finalized-record" : "deleted-finalized-record",
        path: historical.path,
        message: `Finalized ${historical.record.type} "${id}" was ${current ? "moved back to a non-final state" : "deleted"}. Restore its finalized state and use its correction or supersession workflow.`
      });
    }
  }
  for (const entry of loaded.entries) {
    if (!isFinalized(entry.record)) continue;
    const versions = finalizedVersions(commits, entry.record.id, revisionRecords, historiesById);
    const historical = versions[0];
    if (!historical) continue;
    firstFinalized.set(entry.record.id, historical);
    if (
      entry.record.type === "collection-review"
      && !validInitialCollectionReview(historical, loaded.workspace.timezone)
      && !legacyCollectionReview(loaded, historical)
    ) {
      diagnostics.push(integrityError(
        entry,
        `Collection Review "${entry.record.id}" must first be committed active on its recorded review date. Create a current review instead of backdating or initially retiring one.`
      ));
      continue;
    }
    const chain = [...versions, { record: entry.record, commit: null }];
    if (chain.some((item, index) => index > 0
      && !permittedFinalizedTransition(chain[index - 1].record, item.record)
      && !legacyCollectionReviewTransition(loaded, chain[index - 1], item))) {
      diagnostics.push(integrityError(entry, `Finalized ${entry.record.type} "${entry.record.id}" differs from its first committed final state. Use its correction or supersession workflow.`));
      continue;
    }
    await compareMarkdownAtRevision(loaded, entry, historical, diagnostics);
  }

  const byId = new Map(loaded.resources.map((record) => [record.id, record]));
  const proofOwners = loaded.resources.filter((record) => (
    (record.type === "obligation-occurrence" && ["reconciled", "superseded"].includes(record.status))
    || (record.type === "audit-population" && ["reconciled", "not-applicable", "superseded"].includes(record.status))
    || (record.type === "attestation" && record.status === "completed")
  ));
  const proofIdsByOwner = new Map(proofOwners.map((owner) => [owner.id, proofIds(owner, byId)]));
  const proofIdentityHistories = getRecordIdentityHistories(
    loaded.root,
    new Set([...proofIdsByOwner.values()].flatMap((ids) => [...ids]))
  );
  for (const owner of proofOwners) {
    const finalized = firstFinalized.get(owner.id);
    if (!finalized) continue;
    if (owner.type === "obligation-occurrence" && owner.collectionReviewCommit && (
      !isGitAncestor(loaded.root, owner.scopeRevision, owner.collectionReviewCommit)
      || !isGitAncestor(loaded.root, owner.collectionReviewCommit, finalized.commit)
    )) {
      const ownerEntry = loaded.entries.find(({ record }) => record.id === owner.id);
      diagnostics.push(integrityError(ownerEntry, `Occurrence "${owner.id}" must bind a Collection Review committed after its scope revision and before the occurrence was finalized.`));
    }
    const protectedIds = proofIdsByOwner.get(owner.id);
    for (const id of protectedIds) {
      const currentEntry = loaded.entries.find(({ record }) => record.id === id);
      const historical = recordAtRevision(loaded, finalized.commit, id, proofIdentityHistories.get(id) || []);
      if (!currentEntry || !historical) {
        const ownerEntry = loaded.entries.find(({ record }) => record.id === owner.id);
        diagnostics.push(integrityError(ownerEntry, `Proof record "${id}" must exist in the commit where ${owner.type} "${owner.id}" was first finalized.`));
        continue;
      }
      if (!sameJson(currentEntry.record, historical.record)) {
        diagnostics.push(integrityError(currentEntry, `Proof record "${id}" differs from the version used when ${owner.type} "${owner.id}" was first finalized. Create corrected proof and a superseding record.`));
        continue;
      }
      await compareMarkdownAtRevision(loaded, currentEntry, { ...historical, commit: finalized.commit }, diagnostics, owner.id);
      await compareEvidenceAttachmentsAtRevision(loaded, currentEntry, finalized.commit, diagnostics, owner.id);
    }
  }
}

function legacyCollectionReviewTransition(loaded, previous, current) {
  if (
    previous.record.type !== "collection-review"
    || current.record.type !== "collection-review"
    || previous.record.status !== "active"
    || current.record.status !== "active"
    || !current.commit
  ) return false;
  try {
    const workspace = JSON.parse(getFileAtRevision(loaded.root, current.commit, "data/workspace.json"));
    return Number(workspace?.dataModelVersion) < 9;
  } catch {
    return false;
  }
}

function historicalState(loaded) {
  const index = getDataRecordHistoryIndex(loaded.root);
  if (!index.available) return { available: false };
  const firstV9 = index.commits.findIndex((commit) => {
    try {
      const workspace = JSON.parse(getFileAtRevision(loaded.root, commit, "data/workspace.json"));
      return Number(workspace?.dataModelVersion) >= 9;
    } catch {
      return false;
    }
  });
  const commits = firstV9 >= 0 ? index.commits.slice(firstV9) : index.commits;
  const revisionRecords = new Map(index.recordsByCommit);
  const historicalFinalized = new Map();
  if (firstV9 >= 0) {
    const baselineCommit = index.commits[firstV9];
    const baseline = new Map(revisionRecords.get(baselineCommit) || []);
    for (const [id, identityHistory] of index.historiesById) {
      const item = recordAtRevision(loaded, baselineCommit, id, identityHistory);
      if (item) {
        const prior = firstV9 > 0
          ? recordAtRevision(loaded, index.commits[firstV9 - 1], id, identityHistory)
          : null;
        baseline.set(id, {
          ...item,
          ...(prior && isFinalized(prior.record) ? { legacyBaseline: true } : {})
        });
      }
    }
    revisionRecords.set(baselineCommit, baseline);
  }
  for (const commit of commits) {
    const records = recordMapAtRevision(loaded, commit, revisionRecords);
    for (const [id, item] of records) {
      if (isFinalized(item.record) && !historicalFinalized.has(id)) historicalFinalized.set(id, { ...item, commit });
    }
  }
  return { available: true, commits, revisionRecords, historicalFinalized, historiesById: index.historiesById };
}

function finalizedVersions(commits, id, cache, historiesById) {
  const history = historiesById.get(id) || [];
  return commits.flatMap((commit) => {
    const historical = recordMapAtRevision(null, commit, cache).get(id) || null;
    const summary = history.find((item) => item.commit === commit);
    return historical && isFinalized(historical.record) ? [{ ...historical, ...summary, commit }] : [];
  });
}

function validInitialCollectionReview(historical, timezone) {
  if (historical.record.status !== "active" || !isRfc3339Timestamp(historical.timestamp)) return false;
  const commitTime = new Date(historical.timestamp);
  if (
    historical.record.reviewedOn !== currentCalendarDate(timezone, commitTime)
    || !isRfc3339Timestamp(historical.record.knowledgeCutoffAt)
  ) return false;
  const cutoffTime = new Date(historical.record.knowledgeCutoffAt);
  const elapsed = commitTime.getTime() - cutoffTime.getTime();
  return elapsed >= 0 && elapsed <= 86_400_000;
}

function legacyCollectionReview(loaded, historical) {
  if (historical.legacyBaseline && historical.record.status === "active" && !historical.record.knowledgeCutoffAt) {
    return true;
  }
  let workspace;
  try {
    workspace = JSON.parse(getFileAtRevision(loaded.root, historical.commit, "data/workspace.json"));
  } catch {
    return false;
  }
  return Number(workspace?.dataModelVersion) < 9
    && historical.record.status === "active"
    && !historical.record.knowledgeCutoffAt;
}

function recordAtRevision(loaded, commit, id, identityHistory) {
  const item = identityHistory.find(({ commit: changedAt }) => isGitAncestor(loaded.root, changedAt, commit));
  if (!item) return null;
  const source = getFileAtRevision(loaded.root, commit, item.path);
  if (!source) return null;
  try {
    const record = JSON.parse(source);
    return record?.id === id ? { record, path: item.path } : null;
  } catch {
    return null;
  }
}

function recordMapAtRevision(_loaded, commit, cache) {
  return cache.get(commit) || new Map();
}

function isFinalized(record) {
  if (record?.type === "action-item" && !record.obligationId) return false;
  return FINAL_STATUSES.get(record?.type)?.has(record.status) || false;
}

function permittedFinalizedTransition(previous, current) {
  if (previous.type !== current.type || previous.id !== current.id) return false;
  let allowed = [];
  if (previous.type === "collection-review" && previous.status === "active" && current.status === "retired") allowed = ["status", "statusTransition"];
  if (previous.type === "obligation-rule" && previous.status === "active" && current.status === "retired") allowed = ["status", "retiredOn"];
  if (previous.type === "obligation-occurrence" && previous.status === "reconciled" && current.status === "superseded") allowed = ["status"];
  if (previous.type === "audit-population" && ["reconciled", "not-applicable"].includes(previous.status) && current.status === "superseded") allowed = ["status"];
  if (previous.type === "reporting-route" && previous.status === "active" && current.status === "retired") allowed = ["status", "endsAt"];
  if (
    previous.type === "action-item"
    && previous.status === "done"
    && current.status === "done"
    && (previous.evidenceIds || []).every((id) => (current.evidenceIds || []).includes(id))
  ) allowed = ["evidenceIds"];
  return [...new Set([...Object.keys(previous), ...Object.keys(current)])].every((key) => (
    allowed.includes(key) || sameJson(previous[key], current[key])
  ));
}

function sameJson(left, right) {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
}

function proofIds(occurrence, byId) {
  const pending = [
    ...(occurrence.evidenceIds || []),
    ...(occurrence.sourceEvidenceId ? [occurrence.sourceEvidenceId] : []),
    ...(occurrence.members || []).flatMap((member) => [
    ...(member.completionResourceIds || []),
    member.exceptionId
    ])
  ].filter(Boolean);
  const ids = new Set();
  while (pending.length) {
    const id = pending.pop();
    if (!id || ids.has(id)) continue;
    ids.add(id);
    const record = byId.get(id);
    if (!record) continue;
    for (const field of PROOF_FIELDS) {
      const value = record[field];
      pending.push(...(Array.isArray(value) ? value : value ? [value] : []));
    }
  }
  return ids;
}

async function compareMarkdownAtRevision(loaded, entry, historical, diagnostics, occurrenceId = null) {
  for (const markdown of markdownEntries(loaded.model, entry.record)) {
    const historicalPath = markdownEntries(loaded.model, historical.record)
      .find(({ slot }) => slot === markdown.slot)?.path;
    const committed = historicalPath
      ? getFileAtRevision(loaded.root, historical.commit, `data/${historicalPath}`)
      : null;
    let current = null;
    try {
      current = await readFile(resolveDataPath(loaded.root, markdown.path), "utf8");
    } catch {
      // Presence is part of the finalized record.
    }
    if (current !== committed) {
      const context = occurrenceId ? ` used by occurrence "${occurrenceId}"` : "";
      diagnostics.push({
        severity: "error",
        code: "rewritten-finalized-content",
        path: `data/${markdown.path}`,
        message: `Finalized Markdown${context} differs from its committed final version. Use the record's correction or supersession workflow.`
      });
    }
  }
}

async function compareEvidenceAttachmentsAtRevision(loaded, entry, commit, diagnostics, occurrenceId) {
  if (entry.record.type !== "evidence") return;
  for (const path of entry.record.filePaths || []) {
    const relativePath = `data/${path}`;
    const committed = getFileObjectIdAtRevision(loaded.root, commit, relativePath);
    const current = getWorkingFileObjectId(loaded.root, relativePath);
    if (committed !== current) {
      diagnostics.push({
        severity: "error",
        code: "rewritten-finalized-attachment",
        path: `data/${path}`,
        message: `Evidence attachment used by occurrence "${occurrenceId}" differs from the bytes committed when the occurrence was first finalized.`
      });
    }
  }
}

function integrityError(entry, message) {
  return {
    severity: "error",
    code: "rewritten-finalized-record",
    path: `data/${entry.relativePath}`,
    message
  };
}
