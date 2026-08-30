import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { loadModel, modelSupports, SUPPORTED_MODEL_VERSIONS } from "../model/index.js";
import { createObligationEvent, obligationRule } from "./obligations.js";
import { createResource, INTERNAL_WORKFLOW_CAPABILITIES } from "./files.js";
import { getDataRecordHistoryIndex, getFileAtRevision, getFilesAtRevisions, runGitCommandSync } from "./git.js";
import { markdownEntries } from "./resource-markdown.js";
import { loadWorkspace } from "./workspace.js";
import { serializeWorkspaceMutation } from "./mutation.js";
import { currentCalendarDate } from "./time.js";
import { assertHistoricalRecordValid } from "./validate.js";

const TRANSITIONS = {
  person: [
    {
      eventType: "person-started",
      applies: (before, after) => after?.status === "active"
        && after?.affiliation !== "external"
        && before?.status !== "active",
      message: "Confirm whether activating this Person represents a workforce start that needs policy-event work."
    },
    {
      eventType: "person-ended",
      applies: (before, after) => before?.status === "active" && after?.status !== "active",
      message: "Confirm whether this Person status change represents a departure that needs access and asset work."
    },
    {
      eventType: "person-role-changed",
      applies: (before, after) => before && after && before.jobTitle !== after.jobTitle,
      message: "Confirm whether this job-title change represents a role change that needs access and training work."
    }
  ],
  vendor: [
    {
      eventType: "vendor-activated",
      applies: (before, after) => after?.status === "active" && before?.status !== "active",
      message: "Confirm whether activating this Vendor needs onboarding, assurance, and access work."
    },
    {
      eventType: "vendor-terminated",
      applies: (before, after) => before?.status === "active" && ["inactive", "terminated"].includes(after?.status),
      message: "Confirm whether this Vendor status change needs termination, access, and data-return work."
    }
  ],
  system: [{
    eventType: "system-material-change",
    applies: (before, after) => before && after && materialFieldsChanged(before, after, [
      "boundary", "criticality", "classificationId", "internetExposed", "vendorIds", "ownerIds"
    ]),
    message: "Confirm whether this System change is material and needs the configured change workflow."
  }],
  incident: [{
    eventType: "incident-closed",
    applies: (before, after) => before && after && before.status !== "closed" && after.status === "closed",
    message: "Confirm whether closing this Incident needs lessons-learned, disclosure, or remediation work."
  }],
  policy: [{
    eventType: "policy-revised",
    applies: (before, after, context) => Boolean(
      before
      && after
      && ["approved", "active", "superseded", "retired"].includes(before.status)
      && (
      context.markdownChanged
      || materialFieldsChanged(before, after, ["status", "effectiveOn", "ownerIds", "approverIds"])
      )
    ),
    message: "Confirm whether this Policy revision is material and needs reapproval, training, or acknowledgement work."
  }],
  exception: [{
    eventType: "exception-expired",
    applies: (before, after) => before && after && before.status !== "expired" && after.status === "expired",
    message: "Confirm whether this Exception expiry needs compensating-control review or remediation work."
  }],
  "service-account": [
    {
      eventType: "service-account-created",
      applies: (before, after) => after?.status === "active" && before?.status !== "active",
      message: "Confirm whether activating this Service Account needs authorization and review work."
    },
    {
      eventType: "service-account-expired",
      applies: (before, after) => before?.status === "active" && ["expired", "disabled"].includes(after?.status),
      message: "Confirm whether this Service Account status change needs disablement and access-review work."
    }
  ],
  vulnerability: [{
    eventType: "vulnerability-confirmed",
    applies: (before, after) => after?.confirmedOn && before?.confirmedOn !== after.confirmedOn,
    message: "Confirm whether this newly confirmed Vulnerability needs remediation and tracking work."
  }],
  asset: [{
    eventType: "asset-disposed",
    applies: (before, after) => before && after && before.status !== "disposed" && after.status === "disposed",
    message: "Confirm whether this Asset disposal needs sanitization and evidence work."
  }]
};
const MAX_RECONCILIATION_HISTORY_BYTES = 32 * 1024 * 1024;
const MAX_RECONCILIATION_HISTORY_REQUESTS = 20_000;
const MAX_MERGE_IDENTITY_CHECKS = 100_000;
const MAX_RECONCILIATION_MATCH_EVALUATIONS = 100_000;
const MAX_RECONCILIATION_SNAPSHOT_RECORDS = 100_000;
const RECORD_STATE_CHECKPOINT_INTERVAL = 64;
const RECONCILIATION_HISTORY_TYPES = new Set([
  ...Object.keys(TRANSITIONS),
  "action-item",
  "obligation",
  "obligation-event",
  "obligation-rule",
  "reconciliation-dismissal"
]);

function allowsHistoricalTypeTransition(parentModel, currentModel, beforeType, afterType) {
  return parentModel?.modelVersion === "3"
    && currentModel?.modelVersion === "4"
    && beforeType === "system"
    && afterType === "component";
}

export async function planReconciliation(input = process.cwd(), options = {}) {
  const loaded = input?.entries && input?.resources && input?.model
    ? input
    : await loadWorkspace(input);
  if (!modelSupports(loaded.model, "guided-workflow")) {
    return {
      contractVersion: 1,
      gitRevision: gitRevision(loaded.root),
      changedPaths: [],
      candidates: [],
      message: "Direct-file transition reconciliation is available after migrating this workspace to model v3."
    };
  }
  const historyDeadline = performance.now() + 10_000;
  const baseRevision = gitRevision(loaded.root, historyDeadline);
  const currentByPath = new Map(loaded.entries.map((entry) => [
    `data/${entry.relativePath}`,
    entry
  ]));
  const rawWorkingChanges = gitChangedEntries(loaded.root, historyDeadline, baseRevision);
  if (!baseRevision) {
    return {
      contractVersion: 1,
      gitRevision: null,
      changedPaths: [...new Set(rawWorkingChanges.flatMap(({ beforePath, afterPath }) => (
        [beforePath, afterPath].filter(Boolean)
      )))].sort(),
      candidates: [],
      message: "Commit the initial workspace before reconciling later direct-file transitions."
    };
  }
  const historyIndex = getDataRecordHistoryIndex(loaded.root, { deadline: historyDeadline, head: baseRevision });
  if (!historyIndex.available) {
    throw new Error(`Git history is unavailable for reconciliation${historyIndex.error?.message ? `: ${historyIndex.error.message}` : "."}`);
  }
  const workingChanges = pairWorkingRecordRenames(loaded.root, rawWorkingChanges, currentByPath, baseRevision);
  const changedPaths = [...new Set(workingChanges.flatMap(({ beforePath, afterPath }) => (
    [beforePath, afterPath].filter(Boolean)
  )))].sort();
  const historyContext = { ...historyIndex, recordStatesByCommit: new Map() };
  for (const commit of historyIndex.commits) recordStateAtCommit(historyContext, loaded.model, commit);
  validateMergeIdentities(historyContext, loaded.model);
  const { commits: reconciliationHistory } = reconciliationCommits(historyContext, loaded.model);
  const committedRecordIds = new Set(historyIndex.historiesById.keys());
  const currentTransitionIndex = indexTransitionResources(loaded.resources);
  const transitionIndexes = new WeakMap([[loaded.resources, currentTransitionIndex]]);
  let transitionMatchEvaluations = 0;
  const consumeMatchEvaluation = () => {
    transitionMatchEvaluations += 1;
    if (transitionMatchEvaluations > MAX_RECONCILIATION_MATCH_EVALUATIONS) {
      throw new Error(`Git reconciliation history exceeds the ${MAX_RECONCILIATION_MATCH_EVALUATIONS}-match safety limit.`);
    }
  };
  const eventRecordSnapshots = new Map();
  let snapshotRecordsProcessed = 0;
  const recordsForEvent = (event) => {
    if (eventRecordSnapshots.has(event.id)) return eventRecordSnapshots.get(event.id);
    const history = historyIndex.historiesById.get(event.id) || [];
    const firstCommit = history.at(-1)?.commit;
    const records = firstCommit
      ? materializeRecordState(recordStateAtCommit(historyContext, loaded.model, firstCommit)).map(({ record }) => record)
      : loaded.resources;
    snapshotRecordsProcessed += records.length;
    if (snapshotRecordsProcessed > MAX_RECONCILIATION_SNAPSHOT_RECORDS) {
      throw new Error(`Git reconciliation history exceeds the ${MAX_RECONCILIATION_SNAPSHOT_RECORDS}-record snapshot safety limit.`);
    }
    eventRecordSnapshots.set(event.id, records);
    while (eventRecordSnapshots.size > 4) eventRecordSnapshots.delete(eventRecordSnapshots.keys().next().value);
    return records;
  };
  const currentMarkdownOwners = new Map();
  for (const entry of loaded.entries) {
    for (const markdown of markdownEntries(loaded.model, entry.record)) currentMarkdownOwners.set(`data/${markdown.path}`, entry);
  }
  const workingMarkdownPathsByRecordId = new Map();
  for (const changed of changedPaths) {
    const ownerId = currentMarkdownOwners.get(changed)?.record.id;
    if (!ownerId) continue;
    if (!workingMarkdownPathsByRecordId.has(ownerId)) workingMarkdownPathsByRecordId.set(ownerId, []);
    workingMarkdownPathsByRecordId.get(ownerId).push(changed);
  }
  const rawCandidates = [];
  const filteredCandidates = [];
  const examined = new Set();
  const committedContexts = [];
  const historicalRequests = new Map();
  for (const commit of reconciliationHistory) {
    const parents = historyContext.parentsByCommit.get(commit) || [];
    const parent = parents[0] || null;
    const recordsBefore = parent ? recordStateAtCommit(historyContext, loaded.model, parent) : null;
    const recordsAfter = recordStateAtCommit(historyContext, loaded.model, commit);
    const changes = historyContext.changesByCommit.get(commit) || [];
    const commitChanges = pairCommittedRecordRenames(changes, recordsBefore, recordsAfter);
    const commitPaths = [...new Set(commitChanges.flatMap(({ beforePath, afterPath }) => (
      [beforePath, afterPath].filter(Boolean)
    )))];
    const changedMarkdownPathsByRecordId = new Map();
    for (const changed of commitPaths.filter((path) => path.endsWith(".md"))) {
      const owners = new Set([
        markdownOwnerAtPath(recordsAfter, changed)?.record.id,
        markdownOwnerAtPath(recordsBefore, changed)?.record.id
      ].filter(Boolean));
      for (const ownerId of owners) {
        if (!changedMarkdownPathsByRecordId.has(ownerId)) changedMarkdownPathsByRecordId.set(ownerId, []);
        changedMarkdownPathsByRecordId.get(ownerId).push(changed);
      }
    }
    const changeContexts = [];
    const commitExamined = new Set();
    for (const change of commitChanges) {
      const path = change.afterPath || change.beforePath;
      const currentEntry = recordAtPath(recordsAfter, path)
        || markdownOwnerAtPath(recordsAfter, path)
        || markdownOwnerAtPath(recordsBefore, path);
      const previousRecordPath = change.beforePath?.endsWith(".json")
        ? change.beforePath
        : currentEntry ? `data/${currentEntry.relativePath}` : null;
      const currentRecordPath = change.afterPath?.endsWith(".json")
        ? change.afterPath
        : currentEntry ? `data/${currentEntry.relativePath}` : null;
      const recordPath = currentRecordPath || previousRecordPath;
      const previous = recordAtPath(recordsBefore, previousRecordPath)?.record || null;
      const current = recordAtPath(recordsAfter, currentRecordPath)?.record || null;
      const record = current || previous;
      if (!record || commitExamined.has(`${record.type}:${record.id}`)) continue;
      commitExamined.add(`${record.type}:${record.id}`);
      const changedMarkdownPaths = changedMarkdownPathsByRecordId.get(record.id) || [];
      const markdownChanged = changedMarkdownPaths.length > 0;
      const alternateParents = parents.slice(1).map((alternateRevision) => {
        const alternateState = recordStateAtCommit(historyContext, loaded.model, alternateRevision);
        const alternateEntry = recordAtId(alternateState, record.id);
        return {
          revision: alternateRevision,
          recordPath: alternateEntry?.path || null,
          markdownPaths: changedMarkdownPaths
        };
      });
      for (const [revision, sourcePath] of [
        [commit, currentRecordPath],
        [parent, previousRecordPath],
        ...changedMarkdownPaths.flatMap((changed) => [[commit, changed], [parent, changed]]),
        ...alternateParents.flatMap((alternate) => [
          [alternate.revision, alternate.recordPath],
          ...alternate.markdownPaths.map((markdownPath) => [alternate.revision, markdownPath])
        ])
      ]) {
        if (revision && sourcePath) historicalRequests.set(`${revision}\0${sourcePath}`, { revision, relativePath: sourcePath });
      }
      changeContexts.push({
        path,
        record,
        recordPath: currentRecordPath || previousRecordPath,
        previous,
        current,
        currentRecordPath,
        previousRecordPath,
        changedMarkdownPaths,
        markdownChanged,
        alternateParents
      });
    }
    committedContexts.push({ commit, parent, changeContexts });
  }
  const historicalRequestList = [...historicalRequests.values()];
  const historicalSources = getFilesAtRevisions(loaded.root, historicalRequestList, {
    batchSize: 512,
    maxRequests: MAX_RECONCILIATION_HISTORY_REQUESTS,
    maxTotalBytes: MAX_RECONCILIATION_HISTORY_BYTES,
    deadline: historyDeadline
  });
  const sourceByRevisionAndPath = new Map(historicalRequestList.map((request, index) => [
    `${request.revision}\0${request.relativePath}`,
    historicalSources[index] || ""
  ]));

  for (const { commit, parent, changeContexts } of committedContexts) {
    for (const change of changeContexts) {
      const {
        path,
        record,
        recordPath,
        previous,
        current,
        currentRecordPath,
        previousRecordPath,
        changedMarkdownPaths,
        markdownChanged,
        alternateParents
      } = change;
      const currentSource = [
        historicalSource(sourceByRevisionAndPath, commit, currentRecordPath),
        ...changedMarkdownPaths.map((changed) => historicalSource(sourceByRevisionAndPath, commit, changed))
      ].join("\n");
      const beforeSource = [
        historicalSource(sourceByRevisionAndPath, parent, previousRecordPath),
        ...changedMarkdownPaths.map((changed) => historicalSource(sourceByRevisionAndPath, parent, changed))
      ].join("\n");
      const repeatsParentState = alternateParents.some((alternate) => {
        const alternateSource = [
          historicalSource(sourceByRevisionAndPath, alternate.revision, alternate.recordPath),
          ...alternate.markdownPaths.map((markdownPath) => (
            historicalSource(sourceByRevisionAndPath, alternate.revision, markdownPath)
          ))
        ].join("\n");
        return alternateSource === currentSource;
      });
      if (repeatsParentState) continue;
      for (const transition of TRANSITIONS[record.type] || []) {
        if (!transition.applies(previous, current, { markdownChanged })) continue;
        const fingerprintInput = {
          baseRevision: parent || commit,
          eventType: transition.eventType,
          subjectId: record.id,
          path: recordPath,
          beforeSource,
          currentSource,
          markdownChanged
        };
        const fingerprint = transitionFingerprint(fingerprintInput);
        const legacyCommittedFingerprint = transitionFingerprint({ ...fingerprintInput, baseRevision: commit });
        const legacyWorkingFingerprint = transitionFingerprint({
          ...fingerprintInput,
          beforeSource: [previous ? JSON.stringify(previous) : "", ...changedMarkdownPaths.map((changed) => (
            readRevisionSource(loaded.root, `${commit}^`, changed, historyIndex)
          ))].join("\n")
        });
        const eventId = `obligation-event-git-${fingerprint.slice(0, 16)}`;
        const handledFingerprints = [fingerprint, legacyCommittedFingerprint, legacyWorkingFingerprint];
        const handledEventIds = handledFingerprints.map((value) => `obligation-event-git-${value.slice(0, 16)}`);
        const candidate = reconciliationCandidate(
          loaded,
          transition,
          record,
          path,
          fingerprint,
          eventId,
          { committedRevision: commit }
        );
        rawCandidates.push(candidate);
        if (!transitionHandled(loaded.resources, handledEventIds, handledFingerprints, {
          eventType: transition.eventType,
          subjectId: record.id,
          includeDismissed: options.includeDismissed,
          committedRecordIds,
          timezone: loaded.workspace.timezone,
          recordsForEvent,
          currentIndex: currentTransitionIndex,
          consumeMatchEvaluation,
          indexFor: (records) => {
            if (!transitionIndexes.has(records)) transitionIndexes.set(records, indexTransitionResources(records));
            return transitionIndexes.get(records);
          }
        })) filteredCandidates.push(candidate);
      }
    }
  }

  for (const change of workingChanges) {
    const path = change.afterPath || change.beforePath;
    const currentEntry = currentByPath.get(path) || currentMarkdownOwners.get(path);
    const previousRecordPath = change.beforePath?.endsWith(".json")
      ? change.beforePath
      : currentEntry ? `data/${currentEntry.relativePath}` : null;
    const currentRecordPath = change.afterPath?.endsWith(".json")
      ? change.afterPath
      : currentEntry ? `data/${currentEntry.relativePath}` : null;
    const previous = readHeadRecord(loaded.root, previousRecordPath, baseRevision);
    const current = currentRecordPath ? currentByPath.get(currentRecordPath)?.record || currentEntry?.record || null : null;
    const record = current || previous;
    if (!record || examined.has(`${record.type}:${record.id}`)) continue;
    examined.add(`${record.type}:${record.id}`);
    const changedMarkdownPaths = workingMarkdownPathsByRecordId.get(record.id) || [];
    const markdownChanged = changedMarkdownPaths.length > 0;
    const currentMarkdown = await Promise.all(changedMarkdownPaths.map(async (changed) => {
      try {
        return await readFile(join(loaded.root, changed), "utf8");
      } catch {
        return "";
      }
    }));
    const previousMarkdown = changedMarkdownPaths.map((changed) => readHeadSource(loaded.root, changed, baseRevision));
    const currentSource = [currentEntry?.source || "", ...currentMarkdown].join("\n");
    const beforeSource = [readHeadSource(loaded.root, previousRecordPath, baseRevision), ...previousMarkdown].join("\n");
    for (const transition of TRANSITIONS[record.type] || []) {
      if (!transition.applies(previous, current, { markdownChanged })) continue;
      const fingerprintInput = {
        baseRevision,
        eventType: transition.eventType,
        subjectId: record.id,
        path: currentRecordPath || previousRecordPath,
        beforeSource,
        currentSource,
        markdownChanged
      };
      const fingerprint = transitionFingerprint(fingerprintInput);
      const legacyFingerprint = transitionFingerprint({
        ...fingerprintInput,
        beforeSource: [previous ? JSON.stringify(previous) : "", ...previousMarkdown].join("\n")
      });
      const eventId = `obligation-event-git-${fingerprint.slice(0, 16)}`;
      const legacyEventId = `obligation-event-git-${legacyFingerprint.slice(0, 16)}`;
      const candidate = reconciliationCandidate(loaded, transition, record, path, fingerprint, eventId);
      rawCandidates.push(candidate);
      if (!transitionHandled(loaded.resources, [eventId, legacyEventId], [fingerprint, legacyFingerprint], {
        eventType: transition.eventType,
        subjectId: record.id,
        includeDismissed: options.includeDismissed,
        committedRecordIds,
        timezone: loaded.workspace.timezone,
        recordsForEvent,
        currentIndex: currentTransitionIndex,
        consumeMatchEvaluation,
        indexFor: (records) => {
          if (!transitionIndexes.has(records)) transitionIndexes.set(records, indexTransitionResources(records));
          return transitionIndexes.get(records);
        }
      })) filteredCandidates.push(candidate);
    }
  }
  const result = {
    contractVersion: 1,
    gitRevision: baseRevision,
    changedPaths,
    candidates: (options.includeHandled ? rawCandidates : filteredCandidates)
      .sort((a, b) => a.id.localeCompare(b.id))
  };
  if (options.includeHandled) {
    Object.defineProperty(result, "filteredPlan", {
      value: { ...result, candidates: filteredCandidates.sort((a, b) => a.id.localeCompare(b.id)) },
      enumerable: false
    });
  }
  return result;
}

function reconciliationCandidate(loaded, transition, record, path, fingerprint, eventId, extra = {}) {
  const needsTimestamp = eventNeedsTimestamp(loaded, transition.eventType);
  return {
    id: `reconcile-${fingerprint.slice(0, 16)}`,
    eventId,
    transitionFingerprint: fingerprint,
    eventType: transition.eventType,
    subject: { type: record.type, id: record.id, title: record.title },
    sourcePath: path,
    state: "needs-confirmation",
    message: transition.message,
    requiredFacts: [
      transition.eventType === "person-ended" ? "riskLevel" : null,
      needsTimestamp ? "occurredAt" : "occurredOn"
    ].filter(Boolean),
    action: {
      kind: "command",
      command: reconciliationCommand(transition.eventType, record.id, fingerprint, needsTimestamp)
    },
    ...extra
  };
}

function reconciliationCommits(index, model) {
  const commits = index.commits.filter((commit) => {
    const parent = index.parentsByCommit.get(commit)?.[0] || null;
    if (!parent) return false;
    const workspace = recordAtId(recordStateAtCommit(index, model, parent), "workspace")?.record;
    return Number(workspace?.dataModelVersion) >= 3;
  });
  return { commits };
}

function pairCommittedRecordRenames(changes, recordsBefore, recordsAfter) {
  const deleted = changes.filter(({ beforePath, afterPath }) => beforePath?.endsWith(".json") && !afterPath);
  const added = changes.filter(({ beforePath, afterPath }) => !beforePath && afterPath?.endsWith(".json"));
  const paired = new Set();
  const replacements = [];
  for (const removed of deleted) {
    const previous = recordAtPath(recordsBefore, removed.beforePath)?.record;
    if (!previous?.type || !previous?.id) continue;
    const addition = added.find((candidate) => {
      if (paired.has(candidate)) return false;
      const current = recordAtPath(recordsAfter, candidate.afterPath)?.record;
      return current?.type === previous.type && current?.id === previous.id;
    });
    if (!addition) continue;
    paired.add(removed);
    paired.add(addition);
    replacements.push({ beforePath: removed.beforePath, afterPath: addition.afterPath });
  }
  return [...changes.filter((change) => !paired.has(change)), ...replacements];
}

function recordStateAtCommit(index, model, commit) {
  if (index.recordStatesByCommit.has(commit)) return index.recordStatesByCommit.get(commit);
  const lineage = [];
  let cursor = commit;
  while (cursor && !index.recordStatesByCommit.has(cursor)) {
    lineage.push(cursor);
    cursor = index.parentsByCommit.get(cursor)?.[0] || null;
  }
  let state = cursor ? index.recordStatesByCommit.get(cursor) : null;
  for (let position = lineage.length - 1; position >= 0; position -= 1) {
    const changedAt = lineage[position];
    state = extendRecordState(index, model, changedAt, state);
    index.recordStatesByCommit.set(changedAt, state);
  }
  return index.recordStatesByCommit.get(commit);
}

function extendRecordState(index, model, commit, parentState) {
  const changes = index.changesByCommit.get(commit) || [];
  if (!changes.length) return parentState;
  const state = {
    parent: parentState,
    depth: (parentState?.depth || 0) + 1,
    recordsById: new Map(),
    recordsByPath: new Map(),
    markdownOwnersByPath: new Map(),
    identitiesById: new Map(),
    snapshot: null
  };
  const changedRecordsByPath = new Map(
    [...(index.recordsByCommit.get(commit) || new Map()).values()].map((item) => [item.path, item])
  );
  const workspaceChanges = [...changedRecordsByPath.values()].filter(({ path, record }) => (
    path === "data/workspace.json" || record.id === "workspace" || record.type === "workspace"
  ));
  if (workspaceChanges.length > 1) {
    throw new Error(`Git history contains multiple Workspace records at ${commit.slice(0, 12)}.`);
  }
  const workspaceChange = workspaceChanges[0] || null;
  let historicalModel = parentState ? parentState.model : model;
  if (workspaceChange) {
    if (
      workspaceChange.path !== "data/workspace.json"
      || workspaceChange.record.id !== "workspace"
      || workspaceChange.record.type !== "workspace"
    ) {
      throw new Error(`Git history contains an invalid Workspace identity or location at ${commit.slice(0, 12)}.`);
    }
    if (!Object.hasOwn(workspaceChange.record, "dataModelVersion")) {
      throw new Error(`Git history declares an unsupported data model at ${commit.slice(0, 12)}.`);
    }
    const version = workspaceChange.record.dataModelVersion;
    if (typeof version !== "string" || (version !== "1" && !SUPPORTED_MODEL_VERSIONS.includes(version))) {
      throw new Error(`Git history declares an unsupported data model at ${commit.slice(0, 12)}.`);
    }
    if (version === "1") {
      historicalModel = null;
    } else {
      historicalModel = loadModel(version);
      assertHistoricalRecordValid(
        workspaceChange.record,
        historicalModel,
        workspaceChange.path.replace(/^data\//, "")
      );
    }
  }
  state.model = historicalModel;
  const modelTransition = Boolean(
    historicalModel
    && parentState?.model?.modelVersion !== historicalModel.modelVersion
  );
  const removedPaths = new Set(changes.filter(({ beforePath, afterPath }) => (
    beforePath?.endsWith(".json") && beforePath !== afterPath
  )).map(({ beforePath }) => beforePath));
  for (const change of changes) {
    if (!change.beforePath?.endsWith(".json") && !change.afterPath?.endsWith(".json")) continue;
    const previous = recordAtPath(parentState, change.beforePath);
    if (previous) {
      for (const markdown of parentState?.model ? markdownEntries(parentState.model, previous.record) : []) {
        state.markdownOwnersByPath.set(`data/${markdown.path}`, null);
      }
    }
    if (change.beforePath?.endsWith(".json") && change.beforePath !== change.afterPath) {
      state.recordsByPath.set(change.beforePath, null);
      if (previous?.record.id) {
        const replacement = [...changedRecordsByPath.values()].find(({ record }) => record.id === previous.record.id);
        if (!replacement) {
          state.recordsById.set(previous.record.id, null);
          const identity = identityAtId(parentState, previous.record.id);
          if (identity) state.identitiesById.set(previous.record.id, { ...identity, active: false });
        }
      }
    }
    if (change.afterPath?.endsWith(".json")) {
      const current = changedRecordsByPath.get(change.afterPath) || null;
      if (!current || (historicalModel && !historicalModel.resources[current.record.type])) {
        throw new Error(`Git history contains an unsupported data record at ${commit.slice(0, 12)}:${change.afterPath}.`);
      }
      if (historicalModel && RECONCILIATION_HISTORY_TYPES.has(current.record.type)) {
        assertHistoricalRecordValid(current.record, historicalModel, change.afterPath.replace(/^data\//, ""));
      }
      const priorAtIdentity = previous || recordAtId(parentState, current.record.id);
      const allowedTypeTransition = priorAtIdentity && allowsHistoricalTypeTransition(
        parentState?.model,
        historicalModel,
        priorAtIdentity.record.type,
        current.record.type
      );
      if (priorAtIdentity && priorAtIdentity.record.type !== current.record.type) {
        if (!allowedTypeTransition) {
          throw new Error(`Git history changes immutable record type for "${current.record.id}" at ${commit.slice(0, 12)}.`);
        }
        assertHistoricalRecordValid(
          priorAtIdentity.record,
          parentState.model,
          priorAtIdentity.path.replace(/^data\//, "")
        );
        assertHistoricalRecordValid(
          current.record,
          historicalModel,
          change.afterPath.replace(/^data\//, "")
        );
      }
      if (previous && (
        previous.record.id !== current.record.id
        || (previous.record.type !== current.record.type && !allowedTypeTransition)
      )) {
        throw new Error(`Git history changes immutable record identity at ${commit.slice(0, 12)}:${change.afterPath}.`);
      }
      const existing = recordAtId(parentState, current.record.id);
      const priorIdentity = identityAtId(parentState, current.record.id);
      if (priorIdentity && !priorIdentity.active) {
        const sameIdentityRestore = priorIdentity.path === change.afterPath
          && priorIdentity.type === current.record.type;
        if (!sameIdentityRestore) {
          throw new Error(`Git history reuses deleted record ID "${current.record.id}" at ${commit.slice(0, 12)}:${change.afterPath}.`);
        }
      }
      if (existing && existing.path !== change.afterPath && !removedPaths.has(existing.path)) {
        throw new Error(`Git history reuses record ID "${current.record.id}" at ${commit.slice(0, 12)}:${change.afterPath}.`);
      }
      if (existing && existing.record.type !== current.record.type && !allowedTypeTransition) {
        throw new Error(`Git history changes immutable record type for "${current.record.id}" at ${commit.slice(0, 12)}.`);
      }
      state.recordsByPath.set(change.afterPath, current);
      if (current?.record.id) {
        state.recordsById.set(current.record.id, current);
        state.identitiesById.set(current.record.id, priorIdentity
          ? { ...priorIdentity, type: current.record.type, record: current.record, path: change.afterPath, active: true }
          : { type: current.record.type, introducedAt: commit, record: current.record, path: change.afterPath, active: true });
        const entry = { ...current, relativePath: current.path.replace(/^data\//, "") };
        for (const markdown of historicalModel ? markdownEntries(historicalModel, current.record) : []) {
          state.markdownOwnersByPath.set(`data/${markdown.path}`, entry);
        }
      }
    }
  }
  const activeWorkspace = recordAtPath(state, "data/workspace.json");
  if (
    !activeWorkspace
    || activeWorkspace.record.id !== "workspace"
    || activeWorkspace.record.type !== "workspace"
  ) {
    throw new Error(`Git history has no active canonical Workspace at ${commit.slice(0, 12)}.`);
  }
  if (modelTransition) {
    for (const entry of materializeRecordState(state)) {
      if (!RECONCILIATION_HISTORY_TYPES.has(entry.record.type)) continue;
      assertHistoricalRecordValid(entry.record, historicalModel, entry.path.replace(/^data\//, ""));
    }
  }
  if (state.depth % RECORD_STATE_CHECKPOINT_INTERVAL === 0) state.snapshot = snapshotRecordState(state);
  return state;
}

function recordAtPath(state, path) {
  if (!path) return null;
  for (let current = state; current; current = current.parent) {
    if (current.snapshot) {
      const item = current.snapshot.recordsByPath.get(path);
      return item ? { ...item, relativePath: path.replace(/^data\//, "") } : null;
    }
    if (!current.recordsByPath.has(path)) continue;
    const item = current.recordsByPath.get(path);
    return item ? { ...item, relativePath: path.replace(/^data\//, "") } : null;
  }
  return null;
}

function recordAtId(state, id) {
  if (!id) return null;
  for (let current = state; current; current = current.parent) {
    if (current.snapshot) return current.snapshot.recordsById.get(id) || null;
    if (!current.recordsById.has(id)) continue;
    return current.recordsById.get(id);
  }
  return null;
}

function markdownOwnerAtPath(state, path) {
  if (!path) return null;
  for (let current = state; current; current = current.parent) {
    if (current.snapshot) return current.snapshot.markdownOwnersByPath.get(path) || null;
    if (current.markdownOwnersByPath.has(path)) return current.markdownOwnersByPath.get(path);
  }
  return null;
}

function identityAtId(state, id) {
  if (!id) return null;
  for (let current = state; current; current = current.parent) {
    if (current.snapshot) return current.snapshot.identitiesById.get(id) || null;
    if (current.identitiesById.has(id)) return current.identitiesById.get(id);
  }
  return null;
}

function snapshotRecordState(state) {
  const snapshot = {
    recordsById: new Map(),
    recordsByPath: new Map(),
    markdownOwnersByPath: new Map(),
    identitiesById: new Map()
  };
  const seen = Object.fromEntries(Object.keys(snapshot).map((key) => [key, new Set()]));
  for (let current = state; current; current = current.parent) {
    for (const key of Object.keys(snapshot)) {
      const source = current[key];
      if (source) {
        for (const [itemKey, value] of source) {
          if (seen[key].has(itemKey)) continue;
          seen[key].add(itemKey);
          if (value) snapshot[key].set(itemKey, value);
        }
      }
      if (current !== state && current.snapshot) {
        for (const [itemKey, value] of current.snapshot[key]) {
          if (seen[key].has(itemKey)) continue;
          seen[key].add(itemKey);
          if (value) snapshot[key].set(itemKey, value);
        }
      }
    }
    if (current !== state && current.snapshot) break;
  }
  return snapshot;
}

function validateMergeIdentities(index, model) {
  const snapshots = new Map();
  let checks = 0;
  for (const [commit, parents] of index.parentsByCommit) {
    if (parents.length < 2) continue;
    const identities = new Map();
    for (const parent of parents) {
      const state = recordStateAtCommit(index, model, parent);
      let snapshot = snapshots.get(state);
      if (!snapshot) {
        snapshot = state.snapshot || snapshotRecordState(state);
        snapshots.set(state, snapshot);
      }
      checks += snapshot.identitiesById.size;
      if (checks > MAX_MERGE_IDENTITY_CHECKS) {
        throw new Error("Git merge identity history is too large to reconcile safely.");
      }
      for (const [id, identity] of snapshot.identitiesById) {
        const previous = identities.get(id);
        if (previous && (
          previous.type !== identity.type
          || previous.introducedAt !== identity.introducedAt
        )) {
          throw new Error(`Git history reuses record ID "${id}" across merge branches at ${commit.slice(0, 12)}.`);
        }
        identities.set(id, identity);
      }
    }
  }
}

function materializeRecordState(state) {
  const records = new Map();
  const seen = new Set();
  for (let current = state; current; current = current.parent) {
    for (const [id, item] of current.recordsById) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (item) records.set(id, item);
    }
  }
  return [...records.values()];
}

function historicalSource(sources, revision, path) {
  return revision && path ? sources.get(`${revision}\0${path}`) || "" : "";
}

function applicableEventObligationIds(records, eventType, riskLevel, occurredAt) {
  const byId = new Map(records.map((record) => [record.id, record]));
  return records.filter((record) => {
    if (record.type !== "obligation" || record.status !== "active") return false;
    const schedule = obligationRule(record, byId, { now: occurredAt }) || record;
    return schedule.recurrence?.mode === "event"
      && schedule.recurrence.eventType === eventType
      && (!Array.isArray(record.eventRiskLevels) || record.eventRiskLevels.includes(riskLevel));
  }).map(({ id }) => id);
}

function readRevisionRecord(root, revision, path) {
  if (!path) return null;
  try {
    return JSON.parse(readRevisionSource(root, revision, path));
  } catch (error) {
    if (error?.code === "FILEGRC_GIT_DEADLINE") throw error;
    return null;
  }
}

function readRevisionSource(root, revision, path, historyIndex = null) {
  if (!path) return "";
  try {
    const parentMatch = String(revision).match(/^([a-f0-9]{40})\^$/i);
    const commit = parentMatch && historyIndex
      ? historyIndex.parentsByCommit.get(parentMatch[1])?.[0] || null
      : /^[a-f0-9]{40}$/i.test(String(revision)) ? String(revision) : runGit(root, ["rev-parse", `${revision}^{commit}`]);
    return commit ? getFileAtRevision(root, commit, path) || "" : "";
  } catch (error) {
    if (error?.code === "FILEGRC_GIT_DEADLINE") throw error;
    return "";
  }
}

export async function applyReconciliation(input = process.cwd(), options = {}) {
  if (options.confirmed !== true) {
    throw new Error("Reconciliation creates compliance records. Preview the candidate and confirm the write.");
  }
  return serializeWorkspaceMutation(input, async (root) => {
    const plan = await planReconciliation(root);
    const candidate = findCandidate(plan, options);
    if (!candidate) {
      throw new Error("The reconciliation candidate is missing or changed. Run reconcile --preview again.");
    }
    const loaded = await loadWorkspace(root);
    const result = await createObligationEvent(root, {
      allPrograms: true,
      id: candidate.eventId,
      eventType: candidate.eventType,
      subjectResourceIds: [candidate.subject.id],
      occurredOn: options.occurredOn,
      occurredAt: options.occurredAt,
      riskLevel: options.riskLevel,
      title: options.title,
      ...(String(loaded.model.modelVersion) === "3"
        ? { transitionFingerprint: candidate.transitionFingerprint }
        : {})
    });
    return { candidate, ...result };
  });
}

export async function dismissReconciliation(input = process.cwd(), options = {}) {
  if (options.confirmed !== true) {
    throw new Error("Dismissing a reconciliation candidate records a review decision. Preview the candidate and confirm the write.");
  }
  return serializeWorkspaceMutation(input, async (root) => {
    const plan = await planReconciliation(root);
    const candidate = findCandidate(plan, options);
    if (!candidate) {
      throw new Error("The reconciliation candidate is missing or changed. Run reconcile --preview again.");
    }
    const loaded = await loadWorkspace(root);
    if (!loaded.model.resources["reconciliation-dismissal"]) {
      throw new Error("Reconciliation dismissals require data model v10 or newer.");
    }
    const reviewedById = String(options.reviewedById || "").trim();
    const reviewedOn = String(options.reviewedOn || "").trim();
    const rationale = String(options.rationale || "").trim();
    if (!loaded.resources.some((record) => (
      record.type === "person" && record.id === reviewedById && record.status === "active"
    ))) {
      throw new Error("An active Person ID is required as the dismissal reviewer.");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reviewedOn)) {
      throw new Error("The dismissal review date must use YYYY-MM-DD.");
    }
    if (reviewedOn !== currentCalendarDate(loaded.workspace.timezone)) {
      throw new Error("The dismissal review date must be the current date in the workspace timezone.");
    }
    if (!rationale) throw new Error("A rationale is required to dismiss a reconciliation candidate.");
    const record = {
      id: `reconciliation-dismissal-${candidate.transitionFingerprint}`,
      type: "reconciliation-dismissal",
      title: `Dismiss ${candidate.eventType} for ${candidate.subject.title}`,
      transitionFingerprint: candidate.transitionFingerprint,
      eventType: candidate.eventType,
      subjectResourceId: candidate.subject.id,
      reviewedByIds: [reviewedById],
      reviewedOn,
      rationale
    };
    const result = await createResource(root, record, {
      workflowCapability: INTERNAL_WORKFLOW_CAPABILITIES.reconciliationDismissal
    });
    return { candidate, dismissal: result.record, path: result.path };
  });
}

function transitionHandled(resources, eventIds, fingerprints, transition) {
  const currentIndex = transition.currentIndex || indexTransitionResources(resources);
  const matchingEvents = new Set();
  for (const eventId of eventIds) {
    const event = currentIndex.eventsById.get(eventId);
    if (event) matchingEvents.add(event);
  }
  for (const fingerprint of fingerprints) {
    for (const event of currentIndex.eventsByFingerprint.get(fingerprint) || []) {
      transition.consumeMatchEvaluation?.();
      matchingEvents.add(event);
    }
  }
  for (const item of matchingEvents) {
    const records = transition.recordsForEvent?.(item) || resources;
    const historicalIndex = transition.indexFor?.(records) || indexTransitionResources(records);
    const event = historicalIndex.byId.get(item.id) || item;
    if ((eventIds.includes(event.id) || fingerprints.includes(event.transitionFingerprint))
      && obligationEventHandlesTransition(
        event,
        records,
        transition.eventType,
        transition.subjectId,
        resources,
        historicalIndex,
        currentIndex
      )) return true;
  }
  if (transition.includeDismissed) return false;
  const dismissal = currentIndex.byId.get(`reconciliation-dismissal-${fingerprints[0]}`);
  return Boolean(dismissal && reconciliationDismissalMatches(dismissal, {
        transitionFingerprint: fingerprints[0],
        eventType: transition.eventType,
        subject: { id: transition.subjectId }
      }, resources, {
        requireActiveReviewer: !transition.committedRecordIds.has(dismissal.id),
        timezone: transition.timezone,
        peopleById: currentIndex.peopleById
      })
  );
}

function indexTransitionResources(resources) {
  const index = {
    byId: new Map(),
    peopleById: new Map(),
    eventsById: new Map(),
    eventsByFingerprint: new Map(),
    actionsBySourceAndObligation: new Map()
  };
  for (const record of resources) {
    index.byId.set(record.id, record);
    if (record.type === "person") index.peopleById.set(record.id, record);
    if (record.type === "obligation-event") {
      index.eventsById.set(record.id, record);
      if (record.transitionFingerprint) {
        if (!index.eventsByFingerprint.has(record.transitionFingerprint)) index.eventsByFingerprint.set(record.transitionFingerprint, []);
        index.eventsByFingerprint.get(record.transitionFingerprint).push(record);
      }
    }
    if (record.type === "action-item" && record.sourceResourceId && record.obligationId) {
      index.actionsBySourceAndObligation.set(`${record.sourceResourceId}\0${record.obligationId}`, record);
    }
  }
  return index;
}

function obligationEventHandlesTransition(
  event,
  records,
  eventType,
  subjectId,
  currentRecords = records,
  historicalIndex = indexTransitionResources(records),
  currentIndex = indexTransitionResources(currentRecords)
) {
  if (event?.type !== "obligation-event" || event.eventType !== eventType || event.status === "canceled") return false;
  if (!(event.subjectResourceIds || []).includes(subjectId)) return false;
  const currentEvent = currentIndex.byId.get(event.id);
  if (
    currentEvent?.type !== "obligation-event"
    || currentEvent.eventType !== eventType
    || currentEvent.status === "canceled"
    || !(currentEvent.subjectResourceIds || []).includes(subjectId)
    || currentEvent.riskLevel !== event.riskLevel
    || currentEvent.occurredOn !== event.occurredOn
    || currentEvent.occurredAt !== event.occurredAt
  ) return false;
  const occurredAt = event.occurredAt || (event.occurredOn ? `${event.occurredOn}T23:59:59Z` : undefined);
  const requiredObligationIds = applicableEventObligationIds(records, eventType, event.riskLevel, occurredAt);
  if (!requiredObligationIds.length) return false;
  return requiredObligationIds.every((obligationId) => {
    const historicalAction = historicalIndex.actionsBySourceAndObligation.get(`${event.id}\0${obligationId}`);
    const currentAction = historicalAction ? currentIndex.byId.get(historicalAction.id) : null;
    return (event.obligationIds || []).includes(obligationId)
      && (currentEvent.obligationIds || []).includes(obligationId)
      && historicalAction
      && historicalAction.status !== "canceled"
      && currentAction?.type === "action-item"
      && currentAction.sourceResourceId === event.id
      && currentAction.obligationId === obligationId
      && currentAction.status !== "canceled";
  });
}

export function reconciliationDismissalMatches(record, candidate, resources, options = {}) {
  if (record?.type !== "reconciliation-dismissal") return false;
  const reviewers = Array.isArray(record.reviewedByIds) ? record.reviewedByIds : [];
  const reviewer = reviewers.length === 1
    ? options.peopleById?.get(reviewers[0]) || resources.find((item) => (
      item.type === "person" && item.id === reviewers[0]
    ))
    : null;
  return record.id === `reconciliation-dismissal-${candidate.transitionFingerprint}`
    && record.transitionFingerprint === candidate.transitionFingerprint
    && record.eventType === candidate.eventType
    && record.subjectResourceId === candidate.subject.id
    && reviewers.length === 1
    && reviewer
    && (!options.requireActiveReviewer || reviewer.status === "active")
    && /^\d{4}-\d{2}-\d{2}$/.test(record.reviewedOn || "")
    && (!options.requireActiveReviewer
      || record.reviewedOn === currentCalendarDate(options.timezone || "UTC"))
    && typeof record.rationale === "string"
    && Boolean(record.rationale.trim());
}

export async function validateReconciliationDismissals(loaded, diagnostics) {
  const dismissals = loaded.entries.filter(({ record }) => record.type === "reconciliation-dismissal");
  if (!dismissals.length) return;
  const raw = await planReconciliation(loaded, { includeHandled: true });
  const candidateByFingerprint = new Map(raw.candidates.map((candidate) => [
    candidate.transitionFingerprint,
    candidate
  ]));
  const committedRecordIds = new Set(getDataRecordHistoryIndex(loaded.root).historiesById.keys());
  const seen = new Set();
  for (const entry of dismissals) {
    const candidate = candidateByFingerprint.get(entry.record.transitionFingerprint);
    if (
      !candidate
      || seen.has(entry.record.transitionFingerprint)
      || !reconciliationDismissalMatches(entry.record, candidate, loaded.resources, {
        requireActiveReviewer: !committedRecordIds.has(entry.record.id),
        timezone: loaded.workspace.timezone
      })
    ) {
      diagnostics.push({
        severity: "error",
        code: "invalid-reconciliation-dismissal",
        path: `data/${entry.relativePath}`,
        message: `Reconciliation dismissal "${entry.record.id}" must bind one current raw transition candidate to its exact fingerprint, event type, subject, and one active Person reviewer.`
      });
    }
    seen.add(entry.record.transitionFingerprint);
  }
  return raw;
}

function findCandidate(plan, options) {
  return plan.candidates.find(({ id, transitionFingerprint }) => (
    id === options.candidateId
    || transitionFingerprint === options.candidateId
    || transitionFingerprint === options.transitionFingerprint
  ));
}

function gitChangedEntries(root, deadline, baseRevision = "HEAD") {
  const tracked = parseNameStatus(runGit(root, ["diff", "--name-status", "-M", baseRevision, "--", "data"], deadline));
  const untracked = lines(runGit(root, ["ls-files", "--others", "--exclude-standard", "--", "data"], deadline))
    .map((path) => ({ beforePath: null, afterPath: path }));
  return [...tracked, ...untracked]
    .filter(({ beforePath, afterPath }) => beforePath?.startsWith("data/") || afterPath?.startsWith("data/"));
}

function pairWorkingRecordRenames(root, changes, currentByPath, baseRevision = null) {
  const additions = new Map();
  for (const change of changes) {
    if (change.beforePath || !change.afterPath?.endsWith(".json")) continue;
    const record = currentByPath.get(change.afterPath)?.record;
    if (record?.type && record?.id) additions.set(`${record.type}:${record.id}`, change);
  }
  const paired = new Set();
  const result = [];
  for (const change of changes) {
    if (!change.afterPath && change.beforePath?.endsWith(".json")) {
      const record = readHeadRecord(root, change.beforePath, baseRevision);
      const addition = record?.type && record?.id ? additions.get(`${record.type}:${record.id}`) : null;
      if (addition) {
        paired.add(addition);
        result.push({ beforePath: change.beforePath, afterPath: addition.afterPath });
        continue;
      }
    }
    if (!paired.has(change)) result.push(change);
  }
  return result;
}

function parseNameStatus(value) {
  return lines(value).map((line) => {
    const [status, first, second] = line.split("\t");
    if (!status || !first) return null;
    if (status.startsWith("R") || status.startsWith("C")) {
      return { beforePath: first, afterPath: second || null };
    }
    if (status === "A") return { beforePath: null, afterPath: first };
    if (status === "D") return { beforePath: first, afterPath: null };
    return { beforePath: first, afterPath: first };
  }).filter(Boolean);
}

function readHeadRecord(root, path, revision = null) {
  if (!path) return null;
  try {
    return JSON.parse(readHeadSource(root, path, revision));
  } catch (error) {
    if (error?.code === "FILEGRC_GIT_DEADLINE") throw error;
    return null;
  }
}

function readHeadSource(root, path, revision = null) {
  try {
    const commit = revision || gitRevision(root);
    return commit ? getFileAtRevision(root, commit, path) || "" : "";
  } catch (error) {
    if (error?.code === "FILEGRC_GIT_DEADLINE") throw error;
    return "";
  }
}

function gitRevision(root, deadline) {
  return runGit(root, ["rev-parse", "HEAD"], deadline) || null;
}

function runGit(root, args, deadline) {
  try {
    const timeoutMs = deadline ? Math.floor(deadline - performance.now()) : undefined;
    if (deadline && timeoutMs <= 0) throw new Error("Git reconciliation history exceeded its cumulative deadline.");
    return runGitCommandSync(root, args, timeoutMs ? { timeoutMs } : {});
  } catch (error) {
    if (error?.code === "FILEGRC_GIT_DEADLINE") throw error;
    if (deadline && performance.now() >= deadline) {
      const timeoutError = new Error("Git reconciliation history exceeded its cumulative deadline.", { cause: error });
      timeoutError.code = "FILEGRC_HISTORY_DEADLINE";
      throw timeoutError;
    }
    return "";
  }
}

function lines(value) {
  return value ? value.split("\n").map((line) => line.trim()).filter(Boolean) : [];
}

function materialFieldsChanged(before, after, fields) {
  return fields.some((field) => JSON.stringify(before?.[field]) !== JSON.stringify(after?.[field]));
}

function transitionFingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function eventNeedsTimestamp(loaded, eventType) {
  const byId = new Map(loaded.resources.map((record) => [record.id, record]));
  return loaded.resources.some((record) => (
    record.type === "obligation"
    && record.status === "active"
    && (() => {
      const rule = byId.get(record.activeRuleId);
      const schedule = rule?.type === "obligation-rule" && rule.status === "active" ? rule : record;
      return schedule.recurrence?.eventType === eventType && schedule.window?.precision === "timestamp";
    })()
  ));
}

function reconciliationCommand(eventType, subjectId, fingerprint, needsTimestamp = false) {
  const timeFlag = needsTimestamp ? " --occurred-at RFC3339" : " --occurred-on YYYY-MM-DD";
  const riskFlag = eventType === "person-ended" ? " --risk-level normal|high" : "";
  return `npx filegrc reconcile --apply --candidate ${fingerprint}${timeFlag}${riskFlag} --yes`;
}
