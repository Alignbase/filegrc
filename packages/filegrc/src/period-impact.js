import { readFile } from "node:fs/promises";
import { reviewHistoryContext, reviewHistoricalWorkspace } from "./historical-workspace.js";
import { readResourceMutation } from "./resource-mutation.js";
import { loadWorkspace } from "./workspace.js";
import { markdownEntries, resourceDataPath } from "./resource-markdown.js";
import { resolveDataPath } from "./paths.js";
import { getFileAtRevision, getFilesAtRevisions, runGitCommandSync } from "./git.js";
import { calculateRevision, revisionsMatch } from "./revisions.js";
import { contentRevision, updateResource } from "./files.js";
import { serializeWorkspaceMutation } from "./mutation.js";
import { currentCalendarDate } from "./time.js";
import { recordBelongsToProgram } from "./program.js";
import { appointmentWasAuthorizedOn, personWasActiveOn } from "./soc2.js";
import { parseCalendarDate } from "./recurrence.js";

export const PERIOD_IMPACT_TYPES = new Set(["appointment", "control", "policy", "source-coverage", "system", "component"]);

// Labels and added rehearsal Evidence links do not change a source or procedure.
// All other structured facts and all substantive companion text are bound.
function facts(record) {
  const { periodImpactReview, title, readinessTestEvidenceIds, ...result } = record;
  return result;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  return value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
}
function text(value) { return String(value ?? "").replaceAll("\r\n", "\n").split("\n").map(line => line.trimEnd()).join("\n").trim(); }
export function periodImpactStateRevision(record, content) {
  return calculateRevision("content", JSON.stringify(canonical({ record: facts(record), content: Object.fromEntries(Object.entries(content).map(([name, source]) => [name, text(source)])) })));
}
const revision = periodImpactStateRevision;
export function periodImpactReviewersAuthorized(loaded, record, review) {
  const byId = new Map(loaded.resources.map(item => [item.id, item]));
  if (!Array.isArray(review.reviewedByIds) || !review.reviewedByIds.length || review.reviewedByIds.some(id => !personWasActiveOn(byId.get(id), review.reviewedOn))) return false;
  const owners = new Set(), seen = new Set();
  const addOwners = ids => {
    for (const id of ids || []) {
      if (seen.has(id)) continue;
      seen.add(id);
      const party = byId.get(id);
      if (personWasActiveOn(party, review.reviewedOn)) owners.add(id);
      else if (appointmentWasAuthorizedOn(party, review.reviewedOn, byId)) owners.add(party.holderId);
      else if (party?.type === "team" && party.status === "active") addOwners([...(party.memberIds || []), ...(party.chairIds || [])]);
    }
  };
  addOwners(record.ownerIds);
  const scopes = new Set([record.id, loaded.workspace.id, ...loaded.resources.filter(item => item.type === "program" && recordBelongsToProgram(record, item, byId, loaded.model)).map(item => item.id)]);
  for (const appointment of loaded.resources) {
    if (appointment.appointmentKind === "policy-owner" && appointmentWasAuthorizedOn(appointment, review.reviewedOn, byId) && appointment.scopeResourceIds?.some(id => scopes.has(id))) owners.add(appointment.holderId);
  }
  return review.reviewedByIds.some(id => owners.has(id));
}
async function currentStateRevision(loaded, record) {
  const content = {};
  for (const item of markdownEntries(loaded.model, record)) {
    if (loaded.historicalCommit) {
      content[item.name] = loaded.historicalFiles?.get(`data/${item.path}`) ?? getFileAtRevision(loaded.root, loaded.historicalCommit, `data/${item.path}`) ?? "";
      continue;
    }
    try { content[item.name] = await readFile(resolveDataPath(loaded.root, item.path), "utf8"); }
    catch (error) { if (error.code !== "ENOENT") throw error; content[item.name] = ""; }
  }
  return revision(record, content);
}

// Hash ordered meaningful states, not repository commit counts or global HEAD.
// Appending a working change and later committing it yields the same chain;
// a real change/revert/repeat adds states even when the final bytes match.
export function periodImpactHistoryRevision(loaded, record, throughRevision) {
  const context = reviewHistoryContext(loaded.root, loaded), index = context.index;
  const head = throughRevision || loaded.historicalCommit || index?.head;
  if (!head) {
    return { chain: null, state: null };
  }
  if (!index?.available) throw new Error("Complete Git history is required for an impact review.");
  context.periodImpactChains ||= new Map();
  const cacheKey = `${record.id}\0${head}`;
  if (context.periodImpactChains.has(cacheKey)) return context.periodImpactChains.get(cacheKey);
  const jsonPath = `data/${resourceDataPath(loaded.model, record)}`;
  const slots = markdownEntries(loaded.model, record).map(item => ({ name: item.name, path: `data/${item.path}` }));
  const paths = new Set([jsonPath, ...slots.map(item => item.path)]), commits = [];
  const seen = new Set();
  for (let cursor = head; cursor; cursor = index.parentsByCommit.get(cursor)?.[0]) {
    if (seen.has(cursor) || !index.parentsByCommit.has(cursor)) throw new Error("Complete first-parent Git history is required for an impact review.");
    seen.add(cursor);
    if ([...(index.fileChangesByCommit.get(cursor)?.keys() || [])].some(path => paths.has(path))) commits.push(cursor);
  }
  commits.reverse();
  const requests = commits.flatMap(commit => [...paths].map(relativePath => ({ revision: commit, relativePath })));
  const sources = getFilesAtRevisions(loaded.root, requests);
  let chain = null, state = null, position = 0;
  for (const commit of commits) {
    const source = sources[position++], content = {};
    for (const slot of slots) content[slot.name] = sources[position++] ?? "";
    const next = source ? revision(JSON.parse(source), content) : null;
    if (next !== state) { chain = calculateRevision("content", JSON.stringify([chain, next])); state = next; }
  }
  const result = { chain, state };
  context.periodImpactChains.set(cacheKey, result);
  return result;
}

export async function currentPeriodImpactRevision(loaded, record) {
  const current = await currentStateRevision(loaded, record);
  const historical = periodImpactHistoryRevision(loaded, record);
  const chain = current === historical.state ? historical.chain : calculateRevision("content", JSON.stringify([historical.chain, current]));
  return calculateRevision("content", JSON.stringify({ chain, current }));
}

export async function periodImpactReviewCurrent(loaded, record, asOf = currentCalendarDate(loaded.workspace.timezone || "UTC")) {
  const review = record?.periodImpactReview;
  if (!review || !loaded.model.resources[record.type]?.fields.periodImpactReview
    || !validDate(review.reviewedOn) || !validDate(review.effectiveOn)
    || review.reviewedOn > asOf || review.effectiveOn > review.reviewedOn
    || !periodImpactReviewersAuthorized(loaded, record, review)
    || typeof review.rationale !== "string" || !review.rationale.trim()
    || !["no-material-change", "material-change-reviewed"].includes(review.conclusion)
    || review.reviewedTransitionKeys !== undefined && (!Array.isArray(review.reviewedTransitionKeys) || review.reviewedTransitionKeys.some(key => typeof key !== "string"))
    || review.policyEventIds !== undefined && !Array.isArray(review.policyEventIds)) return false;
  if (review.policyEventIds?.some(id => {
    const event = loaded.resources.find(item => item.id === id);
    return event?.type !== "obligation-event" || event.status !== "complete" || !event.subjectResourceIds?.includes(record.id);
  })) return false;
  return revisionsMatch("content", review.reviewedRevision, await currentPeriodImpactRevision(loaded, record));
}
function historicalRevision(loaded, record, commit) {
  const source = getFileAtRevision(loaded.root, commit, `data/${resourceDataPath(loaded.model, record)}`);
  if (!source) return null;
  const historical = JSON.parse(source), content = {};
  for (const item of markdownEntries(loaded.model, historical)) {
    const source = getFileAtRevision(loaded.root, commit, `data/${item.path}`);
    content[item.name] = source ?? "";
  }
  return revision(historical, content);
}

function inventoryOperatingRevision(record, omitDataUse = false) {
  const operating = { ...record, systemUses: (record.systemUses || []).map(({ systemId, roles }) => ({ systemId, roles })) };
  return calculateRevision("content", JSON.stringify(canonical(Object.fromEntries([
    "status", "componentKind", "criticality", "ownerIds", "vendorId", "systemUses", "informationUses", "classificationId", "internetExposed", "continuityObjectives"
  ].filter(field => operating[field] !== undefined && (!omitDataUse || !["informationUses", "classificationId"].includes(field))).map(field => [field, operating[field]])))));
}

function historicalInventoryRevision(loaded, record, commit) {
  const source = getFileAtRevision(loaded.root, commit, `data/${resourceDataPath(loaded.model, record)}`);
  return source ? inventoryOperatingRevision(JSON.parse(source)) : null;
}

async function boundInventoryDataReview(loaded, record) {
  const applications = loaded.resources.filter(item => item.type === "retention-application" && item.status === "active" && item.scopeResourceIds?.includes(record.id));
  if (!applications.length) return null;
  const { retentionApplicationIssues } = await import("./retention-applications.js");
  const context = reviewHistoryContext(loaded.root, loaded);
  for (const application of applications) {
    if (retentionApplicationIssues(loaded, application).length) continue;
    const firstCommit = context.index?.historiesById.get(application.id)?.at(-1)?.commit;
    const snapshot = firstCommit && reviewHistoricalWorkspace(context, firstCommit);
    const captured = snapshot?.resources.find(item => item.id === record.id);
    if (captured && await currentPeriodImpactRevision(snapshot, captured) === await currentPeriodImpactRevision(loaded, record)) return application;
  }
  return null;
}

export async function assessPeriodImpact(loaded, record, histories, coverage, asOf) {
  if (!PERIOD_IMPACT_TYPES.has(record.type) || ["planned", "draft", "retired", "superseded"].includes(record.status)) return null;
  const supportingInventory = record.type === "component" && !(record.evidenceSourceKinds || []).length
    && !(record.systemUses || []).some(use => use.roles?.includes("evidence-source"))
    && !(record.systemUses || []).some(use => use.roles?.includes("service-delivery"))
    && !loaded.resources.some(source => source.type === "control" && source.status === "implemented" && source.evidenceSourceComponentIds?.includes(record.id)
      || source.type === "source-coverage" && source.status === "active" && source.componentId === record.id);
  const historyRevision = supportingInventory ? historicalInventoryRevision : historicalRevision;
  const timezone = loaded.workspace.timezone || "UTC";
  const paths = [`data/${resourceDataPath(loaded.model, record)}`, ...markdownEntries(loaded.model, record).map(({ path }) => `data/${path}`)];
  const commits = [...new Map(paths.flatMap(path => histories.get(path) || []).map(item => [item.commit, item])).values()];
  const inside = commits.filter(({ timestamp }) => timestamp && currentCalendarDate(timezone, new Date(timestamp)) >= coverage.start && currentCalendarDate(timezone, new Date(timestamp)) <= [coverage.end, asOf].sort()[0]);
  const historyContext = reviewHistoryContext(loaded.root, loaded);
  const changes = [];
  let onlyReviewedDataUse = supportingInventory;
  for (const item of inside) {
    const after = historyRevision(loaded, record, item.commit);
    const parents = historyContext.index?.parentsByCommit.get(item.commit) || runGitCommandSync(loaded.root, ["rev-list", "--parents", "-n", "1", item.commit]).trim().split(" ").slice(1);
    const before = parents[0] ? historyRevision(loaded, record, parents[0]) : null;
    if (before && after !== before) {
      changes.push(item.commit);
      if (supportingInventory) {
        const read = commit => JSON.parse(getFileAtRevision(loaded.root, commit, `data/${resourceDataPath(loaded.model, record)}`));
        if (inventoryOperatingRevision(read(parents[0]), true) !== inventoryOperatingRevision(read(item.commit), true)) onlyReviewedDataUse = false;
      }
    }
  }
  const currentState = supportingInventory ? inventoryOperatingRevision(record) : await currentStateRevision(loaded, record);
  const latest = commits.sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
  const uncommitted = latest && historyRevision(loaded, record, latest.commit) !== currentState;
  if (supportingInventory && uncommitted) {
    const prior = JSON.parse(getFileAtRevision(loaded.root, latest.commit, `data/${resourceDataPath(loaded.model, record)}`));
    if (inventoryOperatingRevision(prior, true) !== inventoryOperatingRevision(record, true)) onlyReviewedDataUse = false;
  }
  if (supportingInventory && !changes.length && !uncommitted) return inside.length
    ? { state: "complete", substantive: false, message: "This supporting service inventory is not an authoritative evidence source. Its supplier, access and retention checks remain separate; ordinary narrative maintenance creates no additional source-impact review. Typed scope, processing, exposure and delivery changes remain subject to normal checks." }
    : null;
  if (!changes.length && !uncommitted) return inside.length > 1 ? { state: "complete", substantive: false, message: "Committed revisions retain the same operating facts and procedure. Git keeps their history; no separate impact review is needed." } : null;
  if (onlyReviewedDataUse) {
    const application = await boundInventoryDataReview(loaded, record);
    if (application) return { state: "complete", substantive: true, message: `The current owner retention applicability review (${application.id}) covers these exact data-use and classification facts and their source history. Other supplier, access, scope, exposure and risk checks remain separate.` };
  }
  if (!loaded.model.resources[record.type]?.fields.periodImpactReview) return { state: "complete", substantive: true, message: "Operating history changed. Preserve its review and dated evidence through the workspace’s normal workflows; this older model does not support revision-bound impact metadata." };
  const current = await currentPeriodImpactRevision(loaded, record);
  if (record.type === "control") {
    const { assessBoundControlPeriodReview } = await import("./control-period-review.js");
    const accepted = await assessBoundControlPeriodReview(loaded, record, { asOf, currentRevision: current });
    if (accepted) return { state: "complete", substantive: true, reviewedRevision: current, message: `The completed Control design review (${accepted.reviewResourceId}) and its retained source snapshot cover the current procedure, implementation and meaningful history. No duplicate impact review is needed; later substantive changes and normal operating duties remain separate.` };
  }
  const reviewed = await periodImpactReviewCurrent(loaded, record, asOf);
  return { state: reviewed ? "complete" : "ready", substantive: true, reviewedRevision: current,
    message: reviewed
      ? "The owner’s dated impact review covers the current operating facts and companion content. Existing approval, effective-date, source-continuity and Policy Event checks still apply."
      : "Operating facts or companion procedures changed during the period. Record the actual effective date, owner review and continuity conclusion against this revision. Reuse prior review facts; do not repeat tests or invent approval. Material changes retain their normal approval and Policy Event duties." };
}
function validDate(value) { try { parseCalendarDate(value); return Boolean(value); } catch { return false; } }

export async function scaffoldPeriodImpactReview(input, { resourceId } = {}) {
  const loaded = await loadWorkspace(input);
  const entry = loaded.entries.find(item => item.record.id === resourceId);
  if (!entry || !PERIOD_IMPACT_TYPES.has(entry.record.type) || !loaded.model.resources[entry.record.type].fields.periodImpactReview) throw new Error("Select a resource supporting period impact review.");
  const { planReconciliation } = await import("./reconciliation.js");
  const plan = await planReconciliation(loaded, { includeHandled: true });
  const materialityQuestions = plan.filteredPlan.candidates.filter(candidate => candidate.subject.id === resourceId && candidate.periodImpactKey).map(candidate => ({ title: candidate.subject.title, message: candidate.message, eventType: candidate.eventType, periodImpactKey: candidate.periodImpactKey }));
  const retainedKeys = await periodImpactReviewCurrent(loaded, entry.record)
    ? plan.candidates.filter(candidate => candidate.subject.id === resourceId && entry.record.periodImpactReview.reviewedTransitionKeys?.includes(candidate.periodImpactKey)).map(candidate => candidate.periodImpactKey)
    : [];
  return { resourceId, expectedRevision: contentRevision(entry.source), materialityQuestions, review: { reviewedByIds: [], reviewedOn: null, effectiveOn: null, conclusion: null, rationale: null, reviewedRevision: await currentPeriodImpactRevision(loaded, entry.record), reviewedTransitionKeys: [...new Set([...retainedKeys, ...materialityQuestions.map(({ periodImpactKey }) => periodImpactKey)])].sort() }, instructions: "Review the listed materiality questions and record the actual owner review and effective business date. A no-material-change conclusion answers only these exact transitions. This does not approve changed governed content, repair a coverage gap, verify Evidence or complete a required Policy Event." };
}
export async function previewPeriodImpactReview(input, payload) {
  const loaded = await loadWorkspace(input), scaffold = await scaffoldPeriodImpactReview(loaded.root, payload);
  if (!revisionsMatch("content", payload.expectedRevision, scaffold.expectedRevision) || !revisionsMatch("content", payload.review?.reviewedRevision, scaffold.review.reviewedRevision)) throw new Error("The record or its companion content changed. Reload the impact-review scaffold.");
  if (JSON.stringify([...(payload.review?.reviewedTransitionKeys || [])].sort()) !== JSON.stringify(scaffold.review.reviewedTransitionKeys)) throw new Error("The materiality questions changed. Reload and review the current transitions.");
  const entry = loaded.entries.find(item => item.record.id === payload.resourceId), review = payload.review;
  const asOf = currentCalendarDate(loaded.workspace.timezone || "UTC");
  if (!review || !validDate(review.reviewedOn) || !validDate(review.effectiveOn) || review.reviewedOn > asOf || review.effectiveOn > review.reviewedOn || !review.reviewedByIds?.length || new Set(review.reviewedByIds).size !== review.reviewedByIds.length || review.reviewedByIds.some(id => !personWasActiveOn(loaded.resources.find(item => item.id === id), review.reviewedOn)) || !review.rationale?.trim() || !["no-material-change", "material-change-reviewed"].includes(review.conclusion) || !periodImpactReviewersAuthorized(loaded, entry.record, review)) throw new Error("Supply actual active reviewers including the current resource owner or scoped Policy Owner, valid effective/review dates, conclusion and rationale.");
  for (const id of review.policyEventIds || []) {
    const event = loaded.resources.find(item => item.id === id);
    if (event?.type !== "obligation-event" || event.status !== "complete" || !event.subjectResourceIds?.includes(entry.record.id)) throw new Error("Link only completed Policy Events for this reviewed resource. Required event work must actually be finished.");
  }
  const mutation = await readResourceMutation(loaded, entry.record.type, entry.record.id);
  return { resourceId: entry.record.id, record: { ...entry.record, periodImpactReview: review }, materialityQuestions: scaffold.materialityQuestions, expectedRevision: scaffold.expectedRevision, content: mutation.content, contentRevisions: mutation.contentRevisions };
}
export async function recordPeriodImpactReview(input, payload) {
  return serializeWorkspaceMutation(input, async root => {
    const preview = await previewPeriodImpactReview(root, payload);
    return updateResource(root, preview.record.type, preview.record.id, preview.record, { expectedRevision: preview.expectedRevision, content: preview.content, expectedContentRevisions: preview.contentRevisions, requireExpectedContentRevisions: true });
  });
}
