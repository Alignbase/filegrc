import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { modelSupports } from "../model/index.js";
import { createObligationEvent } from "./obligations.js";
import { getDataRecordHistoryIndex, getFileAtRevision, runGitCommandSync } from "./git.js";
import { markdownEntries } from "./resource-markdown.js";
import { loadWorkspace } from "./workspace.js";
import { serializeWorkspaceMutation } from "./mutation.js";

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

export async function planReconciliation(input = process.cwd()) {
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
  const baseRevision = gitRevision(loaded.root);
  const currentByPath = new Map(loaded.entries.map((entry) => [
    `data/${entry.relativePath}`,
    entry
  ]));
  const workingChanges = pairWorkingRecordRenames(
    loaded.root,
    gitChangedEntries(loaded.root),
    currentByPath
  );
  const changedPaths = [...new Set(workingChanges.flatMap(({ beforePath, afterPath }) => (
    [beforePath, afterPath].filter(Boolean)
  )))].sort();
  if (!baseRevision) {
    return {
      contractVersion: 1,
      gitRevision: null,
      changedPaths,
      candidates: [],
      message: "Commit the initial workspace before reconciling later direct-file transitions."
    };
  }
  const reconciliationHistory = reconciliationCommits(loaded.root);
  const historicalRecords = reconciliationHistory.length
    ? recordsAtRevision(loaded.root, `${reconciliationHistory[0]}^`)
    : new Map();
  const historyIndex = getDataRecordHistoryIndex(loaded.root);
  const currentMarkdownOwners = new Map();
  for (const entry of loaded.entries) {
    for (const markdown of markdownEntries(loaded.model, entry.record)) currentMarkdownOwners.set(`data/${markdown.path}`, entry);
  }
  const candidates = [];
  const examined = new Set();

  for (const commit of reconciliationHistory) {
    const markdownOwnersBefore = historicalMarkdownOwners(loaded.model, historicalRecords);
    for (const change of committedChangedEntries(loaded.root, commit)) {
      if (change.beforePath?.endsWith(".json") && !change.afterPath) {
        const removed = readRevisionRecord(loaded.root, `${commit}^`, change.beforePath);
        if (removed?.id) historicalRecords.delete(removed.id);
      }
    }
    for (const [id, item] of historyIndex.recordsByCommit.get(commit) || []) historicalRecords.set(id, item);
    const markdownOwners = historicalMarkdownOwners(loaded.model, historicalRecords);
    const commitChanges = pairCommittedRecordRenames(loaded.root, commit, committedChangedEntries(loaded.root, commit));
    const commitPaths = [...new Set(commitChanges.flatMap(({ beforePath, afterPath }) => (
      [beforePath, afterPath].filter(Boolean)
    )))];
    const commitExamined = new Set();
    for (const change of commitChanges) {
      const path = change.afterPath || change.beforePath;
      const currentEntry = currentByPath.get(path) || markdownOwners.get(path) || markdownOwnersBefore.get(path);
      const previousRecordPath = change.beforePath?.endsWith(".json")
        ? change.beforePath
        : currentEntry ? `data/${currentEntry.relativePath}` : null;
      const currentRecordPath = change.afterPath?.endsWith(".json")
        ? change.afterPath
        : currentEntry ? `data/${currentEntry.relativePath}` : null;
      const recordPath = currentRecordPath || previousRecordPath;
      const previous = readRevisionRecord(loaded.root, `${commit}^`, previousRecordPath);
      const current = readRevisionRecord(loaded.root, commit, currentRecordPath);
      const record = current || previous;
      if (!record || commitExamined.has(`${record.type}:${record.id}`)) continue;
      commitExamined.add(`${record.type}:${record.id}`);
      const changedMarkdownPaths = commitPaths.filter((changed) => (
        markdownOwners.get(changed)?.record.id === record.id
        || markdownOwnersBefore.get(changed)?.record.id === record.id
      ));
      const markdownChanged = changedMarkdownPaths.length > 0;
      const currentSource = [
        readRevisionSource(loaded.root, commit, currentRecordPath),
        ...changedMarkdownPaths.map((changed) => readRevisionSource(loaded.root, commit, changed))
      ].join("\n");
      const beforeSource = [
        readRevisionSource(loaded.root, `${commit}^`, previousRecordPath),
        ...changedMarkdownPaths.map((changed) => readRevisionSource(loaded.root, `${commit}^`, changed))
      ].join("\n");
      for (const transition of TRANSITIONS[record.type] || []) {
        if (!transition.applies(previous, current, { markdownChanged })) continue;
        if (committedEventHandled(loaded.root, commit, commitPaths, transition.eventType, record.id, historicalRecords)) continue;
        const fingerprint = transitionFingerprint({
          baseRevision: commit,
          eventType: transition.eventType,
          subjectId: record.id,
          path: recordPath,
          beforeSource,
          currentSource,
          markdownChanged
        });
        const eventId = `obligation-event-git-${fingerprint.slice(0, 16)}`;
        if (loaded.resources.some((item) => (
          item.type === "obligation-event"
          && (item.id === eventId || item.transitionFingerprint === fingerprint)
        ))) continue;
        candidates.push(reconciliationCandidate(
          loaded,
          transition,
          record,
          path,
          fingerprint,
          eventId,
          { committedRevision: commit }
        ));
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
    const previous = readHeadRecord(loaded.root, previousRecordPath);
    const current = currentRecordPath ? currentByPath.get(currentRecordPath)?.record || currentEntry?.record || null : null;
    const record = current || previous;
    if (!record || examined.has(`${record.type}:${record.id}`)) continue;
    examined.add(`${record.type}:${record.id}`);
    const changedMarkdownPaths = changedPaths.filter((changed) => (
      currentMarkdownOwners.get(changed)?.record.id === record.id
    ));
    const markdownChanged = changedMarkdownPaths.length > 0;
    const currentMarkdown = await Promise.all(changedMarkdownPaths.map(async (changed) => {
      try {
        return await readFile(join(loaded.root, changed), "utf8");
      } catch {
        return "";
      }
    }));
    const previousMarkdown = changedMarkdownPaths.map((changed) => readHeadSource(loaded.root, changed));
    const currentSource = [currentEntry?.source || "", ...currentMarkdown].join("\n");
    const beforeSource = [previous ? JSON.stringify(previous) : "", ...previousMarkdown].join("\n");
    for (const transition of TRANSITIONS[record.type] || []) {
      if (!transition.applies(previous, current, { markdownChanged })) continue;
      const fingerprint = transitionFingerprint({
        baseRevision,
        eventType: transition.eventType,
        subjectId: record.id,
        path: currentRecordPath || previousRecordPath,
        beforeSource,
        currentSource,
        markdownChanged
      });
      const eventId = `obligation-event-git-${fingerprint.slice(0, 16)}`;
      if (loaded.resources.some((item) => (
        item.type === "obligation-event"
        && (
          item.id === eventId
          || item.transitionFingerprint === fingerprint
        )
      ))) continue;
      candidates.push(reconciliationCandidate(loaded, transition, record, path, fingerprint, eventId));
    }
  }
  return {
    contractVersion: 1,
    gitRevision: gitRevision(loaded.root),
    changedPaths,
    candidates: candidates.sort((a, b) => a.id.localeCompare(b.id))
  };
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

function reconciliationCommits(root) {
  const commits = lines(runGit(root, ["log", "--reverse", "--format=%H", "--", "data"]));
  const baseline = commits.findIndex((commit) => {
    const workspace = readRevisionRecord(root, commit, "data/workspace.json");
    return Number(workspace?.dataModelVersion) >= 3;
  });
  return baseline < 0 ? [] : commits.slice(baseline + 1);
}

function committedChangedEntries(root, commit) {
  return parseNameStatus(runGit(root, [
    "diff-tree",
    "--root",
    "--no-commit-id",
    "--name-status",
    "-M",
    "-r",
    commit,
    "--",
    "data"
  ])).filter(({ beforePath, afterPath }) => (
    beforePath?.startsWith("data/") || afterPath?.startsWith("data/")
  ));
}

function pairCommittedRecordRenames(root, commit, changes) {
  const deleted = changes.filter(({ beforePath, afterPath }) => beforePath?.endsWith(".json") && !afterPath);
  const added = changes.filter(({ beforePath, afterPath }) => !beforePath && afterPath?.endsWith(".json"));
  const paired = new Set();
  const replacements = [];
  for (const removed of deleted) {
    const previous = readRevisionRecord(root, `${commit}^`, removed.beforePath);
    if (!previous?.type || !previous?.id) continue;
    const addition = added.find((candidate) => {
      if (paired.has(candidate)) return false;
      const current = readRevisionRecord(root, commit, candidate.afterPath);
      return current?.type === previous.type && current?.id === previous.id;
    });
    if (!addition) continue;
    paired.add(removed);
    paired.add(addition);
    replacements.push({ beforePath: removed.beforePath, afterPath: addition.afterPath });
  }
  return [...changes.filter((change) => !paired.has(change)), ...replacements];
}

function committedEventHandled(root, commit, commitPaths, eventType, subjectId, historicalRecords) {
  const requiredObligationIds = applicableEventObligationIds(
    [...historicalRecords.values()].map(({ record }) => record),
    eventType
  );
  return commitPaths.some((path) => {
    if (!path.endsWith(".json")) return false;
    const record = readRevisionRecord(root, commit, path);
    const previous = readRevisionRecord(root, `${commit}^`, path);
    return !previous
      && record?.type === "obligation-event"
      && record.eventType === eventType
      && (record.subjectResourceIds || []).includes(subjectId)
      && requiredObligationIds.every((id) => (record.obligationIds || []).includes(id));
  });
}

function applicableEventObligationIds(records, eventType) {
  const byId = new Map(records.map((record) => [record.id, record]));
  return records.filter((record) => {
    if (record.type !== "obligation" || record.status !== "active") return false;
    const rule = byId.get(record.activeRuleId);
    const schedule = rule?.type === "obligation-rule" && rule.status === "active" ? rule : record;
    return schedule.recurrence?.mode === "event" && schedule.recurrence.eventType === eventType;
  }).map(({ id }) => id);
}

function readRevisionRecord(root, revision, path) {
  if (!path) return null;
  try {
    return JSON.parse(readRevisionSource(root, revision, path));
  } catch {
    return null;
  }
}

function readRevisionSource(root, revision, path) {
  if (!path) return "";
  try {
    const commit = runGit(root, ["rev-parse", `${revision}^{commit}`]);
    return commit ? getFileAtRevision(root, commit, path) || "" : "";
  } catch {
    return "";
  }
}

export async function applyReconciliation(input = process.cwd(), options = {}) {
  if (options.confirmed !== true) {
    throw new Error("Reconciliation creates compliance records. Preview the candidate and confirm the write.");
  }
  return serializeWorkspaceMutation(input, async (root) => {
    const plan = await planReconciliation(root);
    const candidate = plan.candidates.find(({ id, transitionFingerprint }) => (
      id === options.candidateId || transitionFingerprint === options.transitionFingerprint
    ));
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

function gitChangedEntries(root) {
  const tracked = parseNameStatus(runGit(root, ["diff", "--name-status", "-M", "HEAD", "--", "data"]));
  const untracked = lines(runGit(root, ["ls-files", "--others", "--exclude-standard", "--", "data"]))
    .map((path) => ({ beforePath: null, afterPath: path }));
  return [...tracked, ...untracked]
    .filter(({ beforePath, afterPath }) => beforePath?.startsWith("data/") || afterPath?.startsWith("data/"));
}

function pairWorkingRecordRenames(root, changes, currentByPath) {
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
      const record = readHeadRecord(root, change.beforePath);
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

function readHeadRecord(root, path) {
  if (!path) return null;
  try {
    return JSON.parse(readHeadSource(root, path));
  } catch {
    return null;
  }
}

function readHeadSource(root, path) {
  try {
    const commit = gitRevision(root);
    return commit ? getFileAtRevision(root, commit, path) || "" : "";
  } catch {
    return "";
  }
}

function gitRevision(root) {
  return runGit(root, ["rev-parse", "HEAD"]) || null;
}

function runGit(root, args) {
  try {
    return runGitCommandSync(root, args);
  } catch {
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

function historicalMarkdownOwners(model, recordsById) {
  const owners = new Map();
  for (const { record, path } of recordsById.values()) {
    const entry = { record, relativePath: path.replace(/^data\//, "") };
    for (const markdown of markdownEntries(model, record)) owners.set(`data/${markdown.path}`, entry);
  }
  return owners;
}

function recordsAtRevision(root, revision) {
  const records = new Map();
  for (const path of lines(runGit(root, ["ls-tree", "-r", "--name-only", revision, "--", "data"]))) {
    if (!path.endsWith(".json")) continue;
    const record = readRevisionRecord(root, revision, path);
    if (record?.id) records.set(record.id, { record, path });
  }
  return records;
}
