import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { modelSupports } from "../model/index.js";
import { createObligationEvent } from "./obligations.js";
import { markdownEntries } from "./resource-markdown.js";
import { loadWorkspace } from "./workspace.js";

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
  const loaded = input?.resources && input?.model && input?.entries
    ? input
    : await loadWorkspace(input);
  const headRevision = gitRevision(loaded.root);
  if (!modelSupports(loaded.model, "guided-workflow")) {
    return {
      contractVersion: 1,
      gitRevision: headRevision,
      changedPaths: [],
      candidates: [],
      message: "Direct-file transition reconciliation is available in model v3 and newer workspaces."
    };
  }
  const changedPaths = gitChangedPaths(loaded.root);
  if (!headRevision) {
    return {
      contractVersion: 1,
      gitRevision: null,
      changedPaths,
      candidates: [],
      message: "Commit the initial workspace before FileGRC checks later direct-file changes for Policy Events."
    };
  }
  const currentByPath = new Map(loaded.entries.map((entry) => [
    `data/${entry.relativePath}`,
    entry
  ]));
  const markdownOwners = new Map();
  for (const entry of loaded.entries) {
    for (const markdown of markdownEntries(loaded.model, entry.record)) {
      markdownOwners.set(`data/${markdown.path}`, entry);
    }
  }
  const candidates = [];
  const examined = new Set();

  for (const path of changedPaths) {
    const currentEntry = currentByPath.get(path) || markdownOwners.get(path);
    const previous = readHeadRecord(loaded.root, path.endsWith(".json")
      ? path
      : currentEntry ? `data/${currentEntry.relativePath}` : null);
    const current = currentEntry?.record || null;
    const record = current || previous;
    if (!record || examined.has(`${record.type}:${record.id}`)) continue;
    examined.add(`${record.type}:${record.id}`);
    const changedMarkdownPaths = changedPaths.filter((changed) => (
      markdownOwners.get(changed)?.record.id === record.id
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
        eventType: transition.eventType,
        subjectId: record.id,
        path: `data/${currentEntry?.relativePath || path.replace(/^data\//, "")}`,
        beforeSource,
        currentSource,
        markdownChanged
      });
      if (loaded.resources.some((item) => (
        item.type === "obligation-event"
        && item.transitionFingerprint === fingerprint
      ))) continue;
      candidates.push({
        id: `reconcile-${fingerprint.slice(0, 16)}`,
        transitionFingerprint: fingerprint,
        eventType: transition.eventType,
        subject: { type: record.type, id: record.id, title: record.title },
        sourcePath: path,
        state: "needs-confirmation",
        message: transition.message,
        requiredFacts: [
          transition.eventType === "person-ended" ? "riskLevel" : null,
          eventNeedsTimestamp(loaded, transition.eventType) ? "occurredAt" : "occurredOn"
        ].filter(Boolean),
        action: {
          kind: "command",
          command: reconciliationCommand(transition.eventType, record.id, fingerprint)
        }
      });
    }
  }
  return {
    contractVersion: 1,
    gitRevision: headRevision,
    changedPaths,
    candidates: candidates.sort((a, b) => a.id.localeCompare(b.id))
  };
}

export async function applyReconciliation(input = process.cwd(), options = {}) {
  if (options.confirmed !== true) {
    throw new Error("Reconciliation creates compliance records. Preview the candidate and confirm the write.");
  }
  const plan = await planReconciliation(input);
  const candidate = plan.candidates.find(({ id, transitionFingerprint }) => (
    id === options.candidateId || transitionFingerprint === options.transitionFingerprint
  ));
  if (!candidate) {
    throw new Error("The reconciliation candidate is missing or changed. Run reconcile --preview again.");
  }
  const result = await createObligationEvent(input, {
    eventType: candidate.eventType,
    subjectResourceIds: [candidate.subject.id],
    occurredOn: options.occurredOn,
    occurredAt: options.occurredAt,
    riskLevel: options.riskLevel,
    title: options.title,
    transitionFingerprint: candidate.transitionFingerprint
  });
  return { candidate, ...result };
}

function gitChangedPaths(root) {
  const tracked = runGit(root, ["diff", "--name-only", "HEAD", "--", "data"]);
  const untracked = runGit(root, ["ls-files", "--others", "--exclude-standard", "--", "data"]);
  return [...new Set([...lines(tracked), ...lines(untracked)])]
    .filter((path) => path.startsWith("data/"))
    .sort();
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
    return execFileSync("git", ["show", `HEAD:${path}`], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000
    });
  } catch {
    return "";
  }
}

function gitRevision(root) {
  return runGit(root, ["rev-parse", "HEAD"]) || null;
}

function runGit(root, args) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000
    }).trim();
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
  return loaded.resources.some((record) => (
    record.type === "obligation"
    && record.status === "active"
    && record.recurrence?.eventType === eventType
    && record.window?.precision === "timestamp"
  ));
}

function reconciliationCommand(eventType, subjectId, fingerprint) {
  const timeFlag = " --occurred-on YYYY-MM-DD";
  const riskFlag = eventType === "person-ended" ? " --risk-level normal|high" : "";
  return `npx filegrc reconcile --apply --candidate ${fingerprint}${timeFlag}${riskFlag} --yes`;
}
