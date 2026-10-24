import { calculationMemo } from "./calculation-cache.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { markdownEntries } from "./resource-markdown.js";
import { resolveDataPath } from "./paths.js";
import { previewWorkflowMutation } from "./workflow.js";
import { loadWorkspace } from "./workspace.js";
import { collectionRevisionMatches } from "./collection-revision.js";
import { reviewHistoricalWorkspace, reviewHistoryContext } from "./historical-workspace.js";
import { resourceReviewRevisionsSync, retentionReviewResourceIds, retentionRuleIsCurrent, retentionSystemUses, retentionUses } from "./retention.js";
import { appointmentWasAuthorizedOn, personWasActiveOn } from "./soc2.js";
import { currentPartyPeople } from "./parties.js";
import { createResource } from "./files.js";
import { getGitSummary, getFileAtRevision, runGitCommandSync, getDataRecordHistoryIndex, isDataHistoryAncestor } from "./git.js";
import { currentCalendarDate } from "./time.js";

const CONFIRMATIONS = ["purposeMatches", "cutoffMatches", "dispositionFeasible", "holdsPreserved", "noConflictingDuties"];
const RULE_FIELDS = ["id", "type", "status", "description", "informationTypeIds", "scopeResourceIds", "scheduleDocumentId", "sourceResourceIds", "sourceSectionHeadings", "cutoff", "retentionPeriod", "dispositionAction", "dispositionInstructions", "notes"];
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
function digest(value) { return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }
function applicationError(message) { return Object.assign(new Error(message), { code: "FILEGRC_RETENTION_APPLICATION" }); }
export function retentionApplicationRuntimeSupported(loaded, commit = null) {
  return calculationMemo(loaded, "retention-application-runtime", [commit], () => {
  try {
    const read = (name) => JSON.parse(commit ? runGitCommandSync(loaded.root, ["show", `${commit}:./${name}`], { timeout: 5000, maxBuffer: 2000000 }) : readFileSync(join(loaded.root, name), "utf8"));
    const manifest = read("package.json"), lock = read("package-lock.json");
    const entry = lock.packages?.["node_modules/filegrc"];
    const requested = /^(?:\^|~)?0\.19\.(0|[1-9]\d*)$/.exec(manifest.dependencies?.filegrc || "");
    const match = /^0\.19\.(0|[1-9]\d*)$/.exec(entry?.version || "");
    return Boolean(requested && Number(requested[1]) >= 2 && lock.packages?.[""]?.dependencies?.filegrc === manifest.dependencies.filegrc && !entry?.link && match && Number(match[1]) >= Number(requested[1]));
  } catch { return false; }
  });
}
function ruleMarkdown(loaded, rule) {
  return markdownEntries(loaded.model, rule).map(({ path }) => {
    try { return { path, source: loaded.historicalFiles ? loaded.historicalFiles.get(`data/${path}`) || null
      : loaded.historicalCommit ? getFileAtRevision(loaded.root, loaded.historicalCommit, `data/${path}`) : readFileSync(resolveDataPath(loaded.root, path), "utf8") }; }
    catch (error) { if (error.code === "ENOENT") return { path, source: null }; throw error; }
  });
}
export function retentionRuleRevision(rule, loaded) {
  return calculationMemo(loaded, "retention-approved-rule-signature", [rule.id], () => {
  const sourceIds = [rule.scheduleDocumentId, ...(rule.sourceResourceIds || []), ...(rule.informationTypeIds || [])].filter(Boolean);
  return digest({ rule: Object.fromEntries(RULE_FIELDS.map((key) => [key, rule[key] ?? null])),
    markdown: ruleMarkdown(loaded, rule), approvedSources: Object.fromEntries(resourceReviewRevisionsSync(loaded, sourceIds, "legacy", false, null, rule)) });
  });
}
export function retentionApplicationScopeRevision(record, loaded = null) {
  if (!record || typeof record !== "object") return null;
  const provider = record.type === "component" && loaded?.resources.find((item) => item.type === "vendor" && item.id === record.vendorId);
  return digest({ id: record.id, type: record.type, status: record.status,
    markdown: loaded ? ruleMarkdown(loaded, record) : [],
    vendorId: record.type === "component" ? record.vendorId || null : null,
    providerDecision: provider ? retentionApplicationScopeRevision(provider, loaded) : null,
    classificationId: record.classificationId || null,
    description: record.description || null, purpose: record.purpose || null, boundary: record.boundary || null, exclusions: record.exclusions || null, servicesProvided: record.servicesProvided || null,
    referencedDecisions: loaded ? Object.fromEntries(resourceReviewRevisionsSync(loaded, [record.agreementDocumentId, record.classificationId].filter(Boolean))) : {},
    informationTypeIds: [...(record.informationTypeIds || [])].sort(),
    informationUses: record.informationUses || [],
    systemUses: retentionSystemUses(record.systemUses),
    // These fields can change the service's legal or operational fit.
    agreementDocumentId: record.agreementDocumentId || null, standardAgreement: record.standardAgreement || null });
}
export function retentionApplicationIssues(loaded, record, { includeStale = true } = {}) {
  const issues = [];
  const fail = (message) => issues.push({ severity: "error", code: "invalid-retention-application", resourceId: record.id, message });
  if (!retentionApplicationRuntimeSupported(loaded)) {
    fail("Upgrade the repository package dependency and lockfile to FileGRC 0.19.2 or newer in the supported 0.19 line before adopting retention applications.");
    return issues;
  }
  if (!Array.isArray(record.scopeResourceIds) || !Array.isArray(record.informationTypeIds)
    || !record.reviewedScopeRevisions || typeof record.reviewedScopeRevisions !== "object" || Array.isArray(record.reviewedScopeRevisions)) {
    fail("Service scope, Information Types and exact applicability bindings are required in the supported record shape.");
    return issues;
  }
  const history = loaded.root ? getDataRecordHistoryIndex(loaded.root).historiesById.get(record.id) || [] : [];
  const firstCommit = [...history].reverse()[0]?.commit;
  if (firstCommit && !retentionApplicationRuntimeSupported(loaded, firstCommit)) fail("The repository must adopt a compatible package dependency and lockfile no later than its first retention application commit.");
  const eventSnapshot = firstCommit ? reviewHistoricalWorkspace(reviewHistoryContext(loaded.root, loaded), firstCommit) : loaded;
  const eventRecord = eventSnapshot?.resources.find(({ id }) => id === record.id);
  if (record.status === "active" && history.some(({ commit }) => reviewHistoricalWorkspace(reviewHistoryContext(loaded.root, loaded), commit)?.resources.find(({ id }) => id === record.id)?.status === "retired")) fail("A retired applicability decision cannot be reactivated. Record a new owner review.");
  const originalDecision = (item) => Object.fromEntries(Object.entries(item || {}).filter(([key]) => !["status", "statusTransition"].includes(key)));
  if (firstCommit && JSON.stringify(originalDecision(eventRecord)) !== JSON.stringify(originalDecision(record))) fail("Preserve the committed applicability decision. Retire it and record a new owner review.");
  const byId = new Map(loaded.resources.map((item) => [item.id, item]));
  const eventById = new Map((eventSnapshot?.resources || loaded.resources).map((item) => [item.id, item]));
  if (record.status === "retired") {
    const transition = record.statusTransition;
    if (!Array.isArray(transition?.changedByIds) || !transition.changedByIds.length || !String(transition.reason || "").trim()
      || !transition.changedOn || transition.changedOn < record.reviewedOn || transition.changedOn > currentCalendarDate(loaded.workspace.timezone || "UTC")
      || transition.changedByIds.some((id) => !loaded.resources.some((item) => item.type === "appointment" && item.appointmentKind === "policy-owner" && item.holderId === id
        && (item.scopeResourceIds || []).some((scope) => [record.programId, loaded.workspace.id, record.ruleId].includes(scope)) && appointmentWasAuthorizedOn(item, transition.changedOn, byId)))) fail("Retirement needs the actual authorized owner, date and reason after the applicability review.");
    const retiredCommit = [...history].reverse().find(({ commit }) => reviewHistoricalWorkspace(reviewHistoryContext(loaded.root, loaded), commit)?.resources.find(({ id }) => id === record.id)?.status === "retired")?.commit;
    const retiredRecord = retiredCommit ? reviewHistoricalWorkspace(reviewHistoryContext(loaded.root, loaded), retiredCommit)?.resources.find(({ id }) => id === record.id) : null;
    if (retiredRecord && JSON.stringify(retiredRecord.statusTransition) !== JSON.stringify(record.statusTransition)) fail("Preserve the committed retirement decision.");
  }
  const rule = byId.get(record.ruleId);
  const approvalSnapshot = loaded.root && /^[a-f0-9]{40}$/.test(record.approvalCommit || "") && isDataHistoryAncestor(loaded, record.approvalCommit, getGitSummary(loaded.root).commit)
    ? reviewHistoricalWorkspace(reviewHistoryContext(loaded.root, loaded), record.approvalCommit) : null;
  const review = approvalSnapshot?.resources.find(({ id }) => id === record.approvalId);
  const historical = loaded.root && /^[a-f0-9]{40}$/.test(review?.scopeRevision || "")
    ? reviewHistoricalWorkspace(reviewHistoryContext(loaded.root, loaded), review.scopeRevision) : null;
  const original = historical?.resources.find(({ id }) => id === rule?.id);
  if (!rule || rule.type !== "retention-schedule-item"
    || review?.type !== "collection-review" || review.resourceType !== "retention-schedule-item" || review.status !== "active"
    || review.decision !== "complete" || review.collectionRevision !== record.approvalRevision
    || !(review.populationResourceIds || []).includes(rule.id) || !original
    || !calculationMemo(historical, "retention-application-independent-approval", [review.collectionRevision, review.scopeRevision], () => collectionRevisionMatches(historical, "retention-schedule-item", review.collectionRevision, { historicalCommit: review.scopeRevision }))
    || retentionRuleRevision(original, historical) !== record.ruleRevision) {
    fail("Choose a rule contained in an exact committed independent schedule approval. An owner application cannot create or replace that approval.");
    return issues;
  }
  const originalOwners = currentPartyPeople([...(review.populationResourceIds || []).flatMap((id) => historical.resources.find((item) => item.id === id)?.ownerIds || []), ...(historical.resources.find(({ id }) => id === original.scheduleDocumentId)?.ownerIds || [])], new Map(historical.resources.map((item) => [item.id, item])));
  if (!review.reviewedByIds?.length || review.reviewedByIds.some((id) => originalOwners.has(id)
    || !personWasActiveOn(historical.resources.find((item) => item.id === id), review.reviewedOn))) fail("The source schedule approval must have an eligible independent reviewer.");
  const program = byId.get(record.programId);
  const appointment = eventById.get(record.authorityAppointmentId);
  if (program?.type !== "program" || !(review.scopeResourceIds || []).includes(program.id)
    || appointment?.type !== "appointment" || appointment.appointmentKind !== "policy-owner"
    || appointment.holderId !== record.reviewedById
    || !appointmentWasAuthorizedOn(appointment, record.reviewedOn, eventById)
    || !(appointment.scopeResourceIds || []).some((id) => [program.id, loaded.workspace.id, rule.id].includes(id))) fail("The actual reviewer must hold active Policy Owner authority for this Program on the review date.");
  if (!record.reviewedOn || record.reviewedOn > currentCalendarDate(loaded.workspace.timezone || "UTC") || record.reviewedOn < review.reviewedOn) fail("Record the actual applicability review date after the independent approval, never a future date.");
  if (!record.informationTypeIds?.length || record.informationTypeIds.some((id) => !(original.informationTypeIds || []).includes(id))) fail("Only Information Types already covered by the approved rule may be applied. A new category requires independent rule review.");
  if (!record.scopeResourceIds?.length || record.scopeResourceIds.some((id) => !["system", "component", "vendor"].includes(byId.get(id)?.type))) fail("Select the actual services or systems receiving this rule.");
  if (CONFIRMATIONS.some((key) => record.confirmations?.[key] !== true)
    || ["purpose", "rationale", "disposalImplementation"].some((key) => !String(record[key] || "").trim())) fail("Review purpose, cutoff, complete disposition, holds and conflicting duties, and explain actual disposal before applying an approved rule. Use normal independent review when any condition does not fit.");
  if (!firstCommit || includeStale && record.status !== "retired") {
    const revisions = resourceReviewRevisionsSync(loaded, retentionReviewResourceIds(rule, loaded));
    if (rule.status !== "active" || retentionRuleRevision(rule, loaded) !== record.ruleRevision || !retentionRuleIsCurrent(rule, revisions, byId, loaded)) fail("The approved rule or a governing source changed. Review the material change independently before relying on this application.");
    if (Object.keys(record.reviewedScopeRevisions || {}).sort().join() !== [...(record.scopeResourceIds || [])].sort().join()
      || record.scopeResourceIds.some((id) => retentionApplicationScopeRevision(byId.get(id), loaded) !== record.reviewedScopeRevisions?.[id])) fail("Service data use, agreement or classification changed after the owner review. Retire and replace this applicability decision or request material rule review.");
  }
  return issues;
}
export function currentRetentionApplications(loaded) {
  return calculationMemo(loaded, "current-retention-applications", [], () => loaded.resources.filter((record) => record.type === "retention-application" && record.status === "active" && !retentionApplicationIssues(loaded, record).length));
}
export function retentionUseWasIndependentlyReviewed(loaded, use, programId) {
  if (!loaded.model.resources["retention-application"]) return true;
  return calculationMemo(loaded, "retention-original-use", [use.resource.id, use.informationTypeId, programId], () => {
    const review = loaded.resources.find((item) => item.type === "collection-review" && item.resourceType === "retention-schedule-item" && item.status === "active" && item.scopeResourceIds?.includes(programId));
    if (!review) return false;
    const historical = loaded.root && /^[a-f0-9]{40}$/.test(review.scopeRevision || "") ? reviewHistoricalWorkspace(reviewHistoryContext(loaded.root, loaded), review.scopeRevision) : null;
    const program = historical?.resources.find(({ id }) => id === programId);
    return Boolean(program && retentionUses(historical, program).some((prior) => prior.resource.id === use.resource.id && prior.informationTypeId === use.informationTypeId
      && retentionApplicationScopeRevision(prior.resource, historical) === retentionApplicationScopeRevision(use.resource, loaded)));
  });
}
export function applicationCoversUse(loaded, use, programId) {
  return currentRetentionApplications(loaded).some((record) => record.programId === programId
    && record.scopeResourceIds.includes(use.resource.id) && record.informationTypeIds.includes(use.informationTypeId));
}
export async function scaffoldRetentionApplication(input, ruleId) {
  const loaded = await loadWorkspace(input);
  if (!loaded.model.resources["retention-application"]) throw applicationError("Apply approved rules requires model v13. Preview and complete the supported model migration first.");
  if (!retentionApplicationRuntimeSupported(loaded)) throw applicationError("Upgrade the repository dependency and lockfile to FileGRC 0.19.2 before applying an approved rule.");
  const rule = loaded.resources.find(({ id }) => id === ruleId);
  if (rule?.type !== "retention-schedule-item" || rule.status !== "active") throw applicationError("Choose an active independently approved retention rule.");
  const review = loaded.resources.find((item) => item.type === "collection-review" && item.resourceType === "retention-schedule-item" && item.status === "active" && item.populationResourceIds?.includes(rule.id));
  if (!review) throw applicationError("Approve this rule independently before applying it to another service.");
  const head = getGitSummary(loaded.root).commit;
  const committed = head ? reviewHistoricalWorkspace(reviewHistoryContext(loaded.root, loaded), head) : null;
  const committedReview = committed?.resources.find(({ id }) => id === review.id);
  const originalWorkspace = review.scopeRevision ? reviewHistoricalWorkspace(reviewHistoryContext(loaded.root, loaded), review.scopeRevision) : null;
  const original = originalWorkspace?.resources.find(({ id }) => id === rule.id);
  if (!original || retentionRuleRevision(original, originalWorkspace) !== retentionRuleRevision(rule, loaded)
    || JSON.stringify(committedReview) !== JSON.stringify(review)) throw applicationError("Commit the exact independent schedule approval before applying its unchanged rule. Material rule changes need independent review.");
  return { record: { type: "retention-application", id: "retention-application-" + rule.id.replace(/^retention-schedule-item-/, "") + "-service", title: "Apply " + rule.title,
    status: "active", ruleId, ruleRevision: retentionRuleRevision(rule, loaded), approvalId: review.id, approvalRevision: review.collectionRevision, approvalCommit: getGitSummary(loaded.root).commit,
    programId: review.scopeResourceIds?.length === 1 ? review.scopeResourceIds[0] : null,
    scopeResourceIds: [], informationTypeIds: [], reviewedScopeRevisions: {}, reviewedById: null, authorityAppointmentId: null,
    reviewedOn: currentCalendarDate(loaded.workspace.timezone || "UTC"), purpose: null, rationale: null, disposalImplementation: null,
    confirmations: Object.fromEntries(CONFIRMATIONS.map((key) => [key, false])) },
    scopeCandidates: loaded.resources.filter((item) => ["system", "component", "vendor"].includes(item.type) && !["retired", "terminated"].includes(item.status)).map((item) => ({ id: item.id, title: item.title, revision: retentionApplicationScopeRevision(item, loaded) })),
    guidance: "Choose actual service scope and existing rule Information Types. Complete every fit confirmation. Keep any proposed new semantic rule in independent review. apply-retention-rule preview computes exact service bindings; it never changes the original approval." };
}
export async function saveRetentionApplication(input, payload, { preview = false } = {}) {
  const loaded = await loadWorkspace(input);
  if (!payload?.record || typeof payload.record !== "object" || Array.isArray(payload.record)
    || payload.record.type !== "retention-application" || !Array.isArray(payload.record.scopeResourceIds)) throw applicationError("A retention application record and service scope array are required.");
  const record = structuredClone(payload.record);
  const supplied = record.reviewedScopeRevisions || {};
  record.reviewedScopeRevisions = Object.fromEntries((record.scopeResourceIds || []).map((id) => {
    const scope = loaded.resources.find((item) => item.id === id);
    if (!scope) throw applicationError("Unknown service scope: " + id);
    return [id, retentionApplicationScopeRevision(scope, loaded)];
  }));
  for (const [id, revision] of Object.entries(record.reviewedScopeRevisions)) {
    if (supplied[id] && supplied[id] !== revision) throw applicationError("The selected service changed since the applicability preview. Reload and review its current facts.");
    if (!preview && !supplied[id]) throw applicationError("Preview the selected service bindings and pass that preview record to --yes.");
  }
  const issues = retentionApplicationIssues(loaded, record);
  if (issues.length) throw applicationError(issues.map(({ message }) => message).join("\n"));
  if (preview) {
    const projected = await previewWorkflowMutation(input, { operation: "create", record, content: payload.content });
    return { operation: "apply-retention-rule", record, issues, preservesIndependentApproval: true, workflowDelta: projected.workflowDelta };
  }
  return createResource(input, record, { content: payload.content });
}
