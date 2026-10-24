import { readFileSync } from "node:fs";
import { validateWorkspace } from "./validate.js";
import { join } from "node:path";
import { runtimeCompatibilityLine } from "./runtime-version.js";
import { markdownEntries } from "./resource-markdown.js";
import { applyResourceBatch, INTERNAL_WORKFLOW_CAPABILITIES } from "./files.js";
import { serializeWorkspaceMutation } from "./mutation.js";
import { loadWorkspace } from "./workspace.js";
import { calculateRevision, revisionsMatch } from "./revisions.js";
import { appointmentWasAuthorizedOn } from "./soc2.js";
import { isRfc3339Timestamp, localDateTimeValue } from "./time.js";
import { getDataRecordHistoryIndex, getFileAtRevision, getFileObjectIdAtRevision, getGitSummary, getWorkingFileObjectId, isDataHistoryAncestor, runGitCommandSync } from "./git.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const valueAt = (record, path) => String(path || "").split(".").reduce((value, key) => value?.[key], record);

function hasAmendmentRuntimePin(loaded, commit = null) {
  try {
    const source = commit
      ? runGitCommandSync(loaded.root, ["show", `${commit}:./package-lock.json`], { timeout: 5_000, maxBuffer: 2_000_000 })
      : readFileSync(join(loaded.root, "package-lock.json"), "utf8");
    const engine = JSON.parse(source)?.packages?.["node_modules/filegrc"];
    return !engine?.link && ["0.19.x", "0.20.x"].includes(runtimeCompatibilityLine(engine?.version));
  } catch { return false; }
}

function historicalRecord(loaded, id, commit) {
  const history = getDataRecordHistoryIndex(loaded.root).historiesById.get(id) || [];
  const identity = history.find((item) => isDataHistoryAncestor(loaded, item.commit, commit));
  if (!identity) return null;
  try { return JSON.parse(getFileAtRevision(loaded.root, commit, identity.path)); } catch { return null; }
}

// A later source decision on this field ends the old correction chain, even
// when a subsequent decision happens to restore the original text.
function fieldEpoch(loaded, id, field, commit) {
  const history = [...(getDataRecordHistoryIndex(loaded.root).historiesById.get(id) || [])].reverse();
  let epoch = null;
  let previous;
  for (const item of history) {
    if (!isDataHistoryAncestor(loaded, item.commit, commit)) continue;
    const value = valueAt(historicalRecord(loaded, id, item.commit), field);
    if (epoch === null || value !== previous) epoch = item.commit;
    previous = value;
  }
  return epoch;
}

function firstCommit(loaded, id) {
  return [...(getDataRecordHistoryIndex(loaded.root).historiesById.get(id) || [])].reverse()[0]?.commit || null;
}

// The amendment is a separate decision. Never project it into loaded.resources:
// approval, history, attestations and collection revisions bind the original.
export function nonmaterialAmendmentIssues(loaded, amendment) {
  const issues = [];
  const fail = (message) => issues.push({ severity: "error", code: "invalid-nonmaterial-amendment", resourceId: amendment.id, message });
  if (!hasAmendmentRuntimePin(loaded)) {
    fail("Upgrade and commit the repository dependency and lockfile to the supported FileGRC 0.19 or 0.20 line before adopting nonmaterial amendments. Reading an older repository does not authorize new records under an older pin.");
    return issues;
  }
  const rule = loaded.model.nonmaterialAmendments?.[amendment.category];
  const head = getGitSummary(loaded.root).commit;
  const eventCommit = firstCommit(loaded, amendment.id);
  if (eventCommit && !hasAmendmentRuntimePin(loaded, eventCommit)) {
    fail("The repository must adopt a supported 0.19 or 0.20 dependency and lockfile no later than its first amendment commit.");
    return issues;
  }
  const source = /^[a-f0-9]{40}$/.test(amendment.sourceCommit || "") && head
    && isDataHistoryAncestor(loaded, amendment.sourceCommit, eventCommit || head)
    ? historicalRecord(loaded, amendment.targetResourceId, amendment.sourceCommit) : null;
  if (!source || !rule?.resourceTypes.includes(source.type) || !rule.fieldPaths.includes(amendment.fieldKey)) {
    fail("Choose a supported nonmaterial category and field on an existing committed source record.");
    return issues;
  }
  const at = new Date(amendment.amendedAt);
  if (!isRfc3339Timestamp(amendment.amendedAt) || at > new Date()) {
    fail("Record the actual amendment time, not a future time.");
    return issues;
  }
  if (eventCommit && JSON.stringify(historicalRecord(loaded, amendment.id, eventCommit)) !== JSON.stringify(amendment)) {
    fail("Preserve the committed amendment decision; create a subsequent amendment for corrections.");
  }
  const sourceTimestamp = (getDataRecordHistoryIndex(loaded.root).historiesById.get(source.id) || []).find(({ commit }) => commit === amendment.sourceCommit)?.timestamp;
  if (!sourceTimestamp || new Date(sourceTimestamp) > at) fail("The amendment cannot predate its committed source facts.");
  const sourceAtEvent = eventCommit ? historicalRecord(loaded, source.id, eventCommit) : loaded.resources.find(({ id }) => id === source.id);
  if (JSON.stringify(sourceAtEvent) !== JSON.stringify(source)) fail("The source changed before this amendment decision; use its current committed revision.");
  const timezone = (eventCommit ? historicalRecord(loaded, loaded.workspace.id, eventCommit)?.timezone : loaded.workspace.timezone) || loaded.workspace.timezone;
  const date = localDateTimeValue(at, timezone).slice(0, 10);
  const recordAtEvent = (id) => eventCommit ? historicalRecord(loaded, id, eventCommit) : loaded.resources.find((record) => record.id === id);
  const authority = recordAtEvent(amendment.authorityAppointmentId);
  const person = authority && recordAtEvent(authority.holderId);
  const byId = new Map([[authority?.id, authority], [person?.id, person]]);
  const kind = source.type === "reporting-route-set" ? source.authorityAppointmentKind : "policy-owner";
  if (!authority || authority.type !== "appointment" || authority.appointmentKind !== kind
    || authority.holderId !== amendment.amendedById || !person || !appointmentWasAuthorizedOn(authority, date, byId)
    || !(authority.scopeResourceIds || []).some((id) => [source.id, source.programId, loaded.workspace.id].includes(id))) {
    fail("The decision must be made by the authorized, in-scope owner at the actual amendment time.");
  }
  if (!String(amendment.rationale || "").trim() || !String(amendment.replacementValue || "").trim()
    || amendment.previousValue === amendment.replacementValue) fail("Provide a changed value and a substantive nonmaterial rationale.");
  const prior = amendment.previousAmendmentId ? recordAtEvent(amendment.previousAmendmentId) : null;
  if (amendment.previousAmendmentId && (!prior || prior.type !== "nonmaterial-amendment"
    || prior.targetResourceId !== source.id || prior.fieldKey !== amendment.fieldKey
    || fieldEpoch(loaded, prior.targetResourceId, prior.fieldKey, prior.sourceCommit) !== fieldEpoch(loaded, source.id, amendment.fieldKey, amendment.sourceCommit)
    || new Date(prior.amendedAt) > at
    || !firstCommit(loaded, prior.id))) fail("A prior amendment must be committed and belong to the same source and field.");
  const before = prior ? prior.replacementValue : valueAt(source, amendment.fieldKey);
  if (amendment.previousValue !== before) fail("The previous value must match the exact source or prior amendment.");
  const siblings = loaded.resources.filter((record) => record.type === "nonmaterial-amendment"
    && record.id !== amendment.id && record.targetResourceId === source.id
    && record.fieldKey === amendment.fieldKey
    && fieldEpoch(loaded, record.targetResourceId, record.fieldKey, record.sourceCommit) === fieldEpoch(loaded, source.id, amendment.fieldKey, amendment.sourceCommit)
    && (record.previousAmendmentId || null) === (amendment.previousAmendmentId || null));
  if (siblings.length) fail("Competing amendments are not allowed; continue the committed amendment chain.");
  if (amendment.category === "reporting-email-alias") {
    const lane = source[amendment.fieldKey.split(".")[0]];
    if (source.status !== "approved" || lane?.channelKind !== "email"
      || !EMAIL.test(amendment.previousValue) || !EMAIL.test(amendment.replacementValue)
      || !source.approval?.effectiveAt || new Date(source.approval.effectiveAt) > at) {
      fail("Only an email alias on an effective, approved reporting channel can use this correction.");
    }
    if (rule.requiredConfirmations.some((field) => amendment.confirmations?.[field] !== true)) {
      fail("Confirm unchanged destination, recipients, access, availability and dependencies. Any change needs normal independent review.");
    }
    const evidence = (amendment.evidenceIds || []).map(recordAtEvent);
    if (!evidence.length || evidence.some((item) => !fixedSupport(loaded, item, amendment, date, eventCommit || head))) {
      fail("Link retained fixed evidence for the alias equivalence, available when the owner made this decision. Owner review does not mark Evidence independently verified.");
    }
  }
  if (amendment.withdrawnProposalId) {
    const proposal = recordAtEvent(amendment.withdrawnProposalId);
    if (amendment.category !== "reporting-email-alias" || !proposal || proposal.type !== "reporting-route-set"
      || proposal.status !== "withdrawn" || proposal.withdrawal?.amendmentId !== amendment.id
      || !proposalMatches(source, proposal, amendment)) fail("Only the matching unapproved alias successor can be withdrawn with this amendment.");
  }
  return issues;
}

// Independent verification can be added later without changing the observation
// the owner relied on. Captures, collectors, dates and conclusions stay fixed.
export function amendmentEvidenceObservationMatches(original, current, loaded = null, reliedOnCommit = null) {
  if (!original || !current) return false;
  if (original.status === "collected" && loaded && reliedOnCommit) {
    const history = [...(getDataRecordHistoryIndex(loaded.root).historiesById.get(original.id) || [])].reverse();
    const firstVerified = history.filter(({ commit }) => isDataHistoryAncestor(loaded, reliedOnCommit, commit))
      .map(({ commit }) => historicalRecord(loaded, original.id, commit)).find((record) => record?.status === "verified");
    if (firstVerified && (!amendmentEvidenceObservationMatches(original, firstVerified) || JSON.stringify(firstVerified) !== JSON.stringify(current))) return false;
  }
  const verification = original.status === "collected" && current.status === "verified"
    ? new Set(["status", "verifiedOn", "verifiedAt", "verifierIds"]) : new Set();
  return [...new Set([...Object.keys(original), ...Object.keys(current)])].every((key) => verification.has(key) || JSON.stringify(original[key]) === JSON.stringify(current[key]));
}

function fixedSupport(loaded, evidence, amendment, date, commit) {
  return evidence?.type === "evidence" && ["collected", "verified"].includes(evidence.status)
    && amendmentEvidenceObservationMatches(evidence, loaded.resources.find(({ id }) => id === evidence.id), loaded, commit)
    && evidence.sourceKind === "file" && evidence.collectedOn <= date
    && [evidence.collectedAt, evidence.sourceGeneratedAt, evidence.businessEventAt].filter(Boolean).every((value) => isRfc3339Timestamp(value) && new Date(value) <= new Date(amendment.amendedAt))
    && (evidence.sourceResourceIds || []).some((id) => [amendment.targetResourceId, amendment.withdrawnProposalId].includes(id))
    && markdownEntries(loaded.model, evidence).every(({ path }) => getFileObjectIdAtRevision(loaded.root, commit, `data/${path}`) === getWorkingFileObjectId(loaded.root, `data/${path}`))
    && evidence.filePaths?.length && evidence.filePaths.every((path) => {
      const object = getFileObjectIdAtRevision(loaded.root, commit, `data/${path}`);
      return object && object === getWorkingFileObjectId(loaded.root, `data/${path}`);
    });
}

function proposalMatches(source, proposal, amendment) {
  const expected = structuredClone(source);
  const [lane, field] = amendment.fieldKey.split(".");
  expected[lane][field] = amendment.replacementValue;
  return ["programId", "purposeKey", "purposeLabel", "primaryLane", "alternateLane", "authorityAppointmentKind", "approvalAppointmentKind", "sourceResourceIds"]
    .every((key) => JSON.stringify(expected[key]) === JSON.stringify(proposal[key]))
    && proposal.predecessorId === source.id && !proposal.approval && !proposal.cancellation;
}

export function amendedResourceView(loaded, target, options = {}) {
  const at = new Date(options.at || new Date());
  const value = structuredClone(target);
  const amendments = loaded.resources.filter((record) => record.type === "nonmaterial-amendment"
    && record.targetResourceId === target.id && new Date(record.amendedAt) <= at);
  const applied = [];
  const pending = [...amendments];
  // Apply only valid, committed decisions and only after their predecessor.
  for (let round = 0; round < amendments.length && pending.length; round++) {
    for (let i = pending.length - 1; i >= 0; i--) {
      const amendment = pending[i];
      if (amendment.previousAmendmentId && !applied.includes(amendment.previousAmendmentId)) continue;
      if (!firstCommit(loaded, amendment.id) || nonmaterialAmendmentIssues(loaded, amendment).length) continue;
      if (fieldEpoch(loaded, target.id, amendment.fieldKey, amendment.sourceCommit) !== fieldEpoch(loaded, target.id, amendment.fieldKey, getGitSummary(loaded.root).commit)) continue;
      if (valueAt(value, amendment.fieldKey) !== amendment.previousValue) continue;
      const parts = amendment.fieldKey.split(".");
      if (parts.length === 1) value[parts[0]] = amendment.replacementValue;
      else value[parts[0]][parts[1]] = amendment.replacementValue;
      applied.push(amendment.id);
      pending.splice(i, 1);
    }
  }
  return { record: value, amendmentIds: applied, originalRecord: target };
}

export async function scaffoldNonmaterialAmendment(input, targetId, options = {}) {
  const loaded = input?.resources ? input : await loadWorkspace(input);
  if (!hasAmendmentRuntimePin(loaded)) throw new Error("Upgrade and commit the repository dependency and lockfile to FileGRC 0.19 or 0.20 before adopting nonmaterial amendments.");
  const entry = loaded.entries.find(({ record }) => record.id === targetId);
  if (!entry) throw new Error(`Resource "${targetId}" was not found.`);
  const head = getGitSummary(loaded.root).commit;
  const hasEmailLane = [entry.record.primaryLane, entry.record.alternateLane].some((lane) => lane?.channelKind === "email");
  const category = options.category || (entry.record.type === "reporting-route-set" && hasEmailLane ? "reporting-email-alias" : "label-correction");
  const rule = loaded.model.nonmaterialAmendments?.[category];
  if (!rule?.resourceTypes.includes(entry.record.type)) throw new Error("No nonmaterial amendment rule supports this record and category.");
  const fieldKey = options.fieldKey || (category === "reporting-email-alias"
    ? ["alternateLane.destination", "primaryLane.destination"].find((path) => entry.record[path.split(".")[0]]?.channelKind === "email") : "title");
  if (!rule.fieldPaths.includes(fieldKey)) throw new Error("This field needs normal review.");
  const view = amendedResourceView(loaded, entry.record);
  const prior = view.amendmentIds.map((id) => loaded.resources.find((record) => record.id === id)).filter((record) => record.fieldKey === fieldKey).at(-1);
  return {
    record: {
      id: `nonmaterial-amendment-${targetId}-${Date.now()}`,
      type: "nonmaterial-amendment", title: `${rule.title}: ${entry.record.title}`,
      targetResourceId: targetId, category, sourceCommit: getDataRecordHistoryIndex(loaded.root).historiesById.get(targetId)?.[0]?.commit || head,
      ...(prior ? { previousAmendmentId: prior.id } : {}), fieldKey,
      previousValue: valueAt(view.record, fieldKey), replacementValue: null,
      amendedAt: new Date().toISOString(), amendedById: null, authorityAppointmentId: null, rationale: null,
      ...(category === "reporting-email-alias" ? { evidenceIds: [], confirmations: Object.fromEntries(rule.requiredConfirmations.map((key) => [key, false])) } : {})
    },
    expectedTargetRevision: calculateRevision("content", entry.source),
    instructions: "Preserve the approved source. Fill the actual owner decision and evidence. Preview, then save and commit before relying on the amendment. Material changes need normal review."
  };
}

export async function saveNonmaterialAmendment(input, payload, options = {}) {
  return serializeWorkspaceMutation(input, async (root) => {
    const loaded = await loadWorkspace(root);
    const record = payload.record;
    if (record?.type !== "nonmaterial-amendment") throw new Error("Pass a nonmaterial amendment mutation envelope.");
    const target = loaded.entries.find((entry) => entry.record.id === record.targetResourceId);
    if (!target || !payload.expectedTargetRevision || !revisionsMatch("content", payload.expectedTargetRevision, calculateRevision("content", target.source))) {
      throw new Error("The source record changed; reload the amendment scaffold.");
    }
    if (loaded.resources.some((item) => item.id === record.id)) throw new Error("Preserve existing amendment decisions; create a new amendment instead.");
    const update = [];
    if (record.withdrawnProposalId) {
      const proposal = loaded.entries.find((entry) => entry.record.id === record.withdrawnProposalId);
      if (!proposal || proposal.record.status !== "proposed" || !payload.expectedProposalRevision
        || !revisionsMatch("content", payload.expectedProposalRevision, calculateRevision("content", proposal.source))) {
        throw new Error("Reload the exact unapproved successor before withdrawing it.");
      }
      update.push({ ...proposal.record, status: "withdrawn", withdrawal: { amendmentId: record.id } });
    }
    const simulated = { ...loaded, resources: [...loaded.resources.filter((item) => !update.some(({ id }) => id === item.id)), ...update, record] };
    const issues = nonmaterialAmendmentIssues(simulated, record);
    if (issues.length) throw new Error(issues.map(({ message }) => message).join("\n"));
    if (options.preview) {
      const projectedEntry = (value, entry = null) => {
        const relativePath = entry?.relativePath || `${loaded.model.resources[value.type].collection}/${value.id}.json`;
        return { ...entry, record: value, source: JSON.stringify(value, null, 2) + "\n", relativePath, path: join(loaded.dataRoot, relativePath) };
      };
      const previewState = { ...simulated, entries: [
        ...loaded.entries.map((entry) => {
          const replacement = update.find(({ id }) => id === entry.record.id);
          return replacement ? projectedEntry(replacement, entry) : entry;
        }), projectedEntry(record)
      ] };
      const validation = await validateWorkspace(previewState);
      if (!validation.ok) throw new Error(validation.diagnostics.filter(({ severity }) => severity === "error").map(({ message }) => message).join("\n"));
      return { record, withdrawal: update[0] || null, preview: true, commitRequired: true };
    }
    return { ...await applyResourceBatch(root, {
      create: [record], update,
      expectedRevisions: record.withdrawnProposalId ? { [record.withdrawnProposalId]: payload.expectedProposalRevision } : {},
      validateWholeWorkspace: true,
      workflowCapability: INTERNAL_WORKFLOW_CAPABILITIES.nonmaterialAmendment
    }), record, commitRequired: true };
  });
}
