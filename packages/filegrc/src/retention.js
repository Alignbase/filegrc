import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { contentRevision } from "./files.js";
import { resolveDataPath } from "./paths.js";
import { programComponents } from "./program.js";
import { markdownEntries } from "./resource-markdown.js";
import { modelSupports } from "../model/index.js";
import { canonicalCalculatedRevisionJson, revisionDigest, revisionsMatch } from "./revisions.js";
import { getFileAtRevision } from "./git.js";
import { reviewHistoricalWorkspace, reviewHistoryCommits, reviewHistoryContext } from "./historical-workspace.js";

export async function assessRetentionReadiness(loaded, program, options = {}) {
  if (!loaded.model.resources["retention-schedule-item"]) return [];
  const byId = new Map(loaded.resources.map((record) => [record.id, record]));
  const rules = loaded.resources.filter((record) => (
    record.type === "retention-schedule-item"
    && !["retired", "superseded"].includes(record.status)
  ));
  const activeRules = rules.filter(({ status }) => status === "active");
  const revisions = await resourceReviewRevisions(loaded, activeRules.flatMap((rule) => retentionReviewResourceIds(rule, loaded)));
  const usableRules = activeRules.filter((rule) => retentionRuleIsCurrent(rule, revisions, byId, loaded));
  const proposedRules = rules.filter(retentionRuleHasCoverageProposal);
  const uses = retentionUses(loaded, program);
  const items = rules.map((rule) => readinessItem(
    `retention-rule-${rule.id}`,
    usableRules.includes(rule) ? "complete" : "action",
    usableRules.includes(rule) ? `${rule.title} proposal is ready` : `Finish ${rule.title}`,
    usableRules.includes(rule)
      ? "The owner completed this row and bound it to its current source revisions. It will become part of the authoritative schedule only when the complete schedule is approved."
      : rule.status === "planned"
        ? "Finish the type, scope, cutoff, period, disposition, sources, and owner review for this proposed row before requesting schedule approval."
        : "This row is incomplete or is not bound to every current source revision. Review it before requesting schedule approval.",
    rule,
    {
      coverageState: usableRules.includes(rule) ? "proposed" : "incomplete",
      sourceResourceIds: retentionReviewResourceIds(rule, loaded),
      commands: [
        `npx filegrc get ${rule.id} --mutation`,
        `npx filegrc review-bindings ${rule.id} --json`,
        ...(rule.sourceResourceIds || [])
          .filter((id) => ["policy", "document", "framework", "requirement", "commitment"].includes(byId.get(id)?.type))
          .map((id) => `npx filegrc program-amendment ${id} --json`)
      ]
    }
  ));
  const usesByInformationType = new Map();
  for (const use of uses) {
    const grouped = usesByInformationType.get(use.informationTypeId) || [];
    grouped.push(use);
    usesByInformationType.set(use.informationTypeId, grouped);
  }
  items.push(...[...usesByInformationType].map(([informationTypeId, informationTypeUses]) => {
    const absentUses = informationTypeUses.filter((use) => (
      !proposedRules.some((rule) => ruleCoversUse(rule, use, program))
    ));
    const pendingUses = informationTypeUses.filter((use) => (
      !usableRules.some((rule) => ruleCoversUse(rule, use, program))
    ));
    const approvalPending = !options.scheduleApproved;
    const matches = usableRules.filter((rule) => (
      informationTypeUses.some((use) => ruleCoversUse(rule, use, program))
    ));
    const informationTypeTitle = byId.get(informationTypeId)?.title || informationTypeId;
    const affectedTitles = absentUses.map(({ resource }) => resource.title);
    const affectedSummary = affectedTitles.length > 3
      ? `${affectedTitles.slice(0, 3).join(", ")}, and ${affectedTitles.length - 3} more`
      : affectedTitles.join(", ");
    return readinessItem(
      `retention-use-${informationTypeId}`,
      absentUses.length ? "action" : pendingUses.length || approvalPending ? "info" : "complete",
      `Decide retention for ${informationTypeTitle}`,
      absentUses.length
        ? `${affectedTitles.length} in-scope ${affectedTitles.length === 1 ? "resource uses" : "resources use"} this Information Type without an active, current retention decision, including ${affectedSummary}. Management must choose the cutoff, period, disposition, and whether one program-wide rule or separate scoped rules apply.`
        : pendingUses.length
          ? `Proposed rows cover every in-scope type-and-scope pair. Finish the row review, then approve the complete schedule once instead of approving these coverage checks separately.`
          : approvalPending
            ? "Completed row proposals cover every in-scope type-and-scope pair. Approve the complete schedule once; these derived checks are not separate approval work."
          : `The approved schedule covers all ${informationTypeUses.length} in-scope ${informationTypeUses.length === 1 ? "use" : "uses"}.`,
      { type: "retention-schedule-item" },
      {
        progressUnit: false,
        coverageState: absentUses.length ? "absent" : pendingUses.length || approvalPending ? "proposed" : "approved",
        informationTypeId,
        affectedResourceIds: absentUses.map(({ resource }) => resource.id),
        retentionScopeResourceIds: absentUses.length === informationTypeUses.length
          ? [program.id]
          : absentUses.map(({ resource }) => resource.id),
        retentionScheduleItemIds: matches.map(({ id }) => id),
        commands: [
          "npx filegrc guide retention-schedule-item --json",
          `npx filegrc scaffold retention-schedule-item --title ${shellArgument(`Retention for ${informationTypeTitle}`)}`
        ]
      }
    );
  }));

  for (const coverage of loaded.resources.filter((record) => record.type === "source-coverage" && record.status === "active")) {
    const linked = (coverage.retentionScheduleItemIds || []).map((id) => byId.get(id)).filter(Boolean);
    const proposed = linked.filter((rule) => (
      rule.type === "retention-schedule-item"
      && proposedRules.includes(rule)
      && (rule.scopeResourceIds || []).includes(coverage.id)
    ));
    const matching = linked.filter((rule) => (
      rule.type === "retention-schedule-item"
      && rule.status === "active"
      && usableRules.includes(rule)
      && (rule.scopeResourceIds || []).includes(coverage.id)
    ));
    items.push(readinessItem(
      `retention-source-coverage-${coverage.id}`,
      matching.length && options.scheduleApproved ? "complete" : proposed.length ? "info" : "action",
      `Confirm retained evidence for ${coverage.title}`,
      matching.length && options.scheduleApproved
        ? `The source-coverage record references a current schedule item scoped to this population.`
        : proposed.length
          ? "A proposed schedule row covers this evidence source. Finish that row and approve the complete schedule before relying on it."
          : `No proposed schedule row covers ${coverage.id}. Add the genuine type-and-scope decision before schedule approval.`,
      coverage,
      {
        progressUnit: false,
        coverageState: matching.length && options.scheduleApproved ? "approved" : proposed.length ? "proposed" : "absent",
        retentionScheduleItemIds: matching.map(({ id }) => id),
        commands: [
          `npx filegrc get ${coverage.id} --mutation`,
          "npx filegrc list retention-schedule-item --workflow --json"
        ]
      }
    ));
  }

  const duplicates = nearDuplicateInformationTypes(loaded.resources);
  if (duplicates.length) {
    items.push(readinessItem(
      "retention-information-type-duplicates",
      options.informationTypesReviewed ? "complete" : "action",
      "Review similar Information Types",
      options.informationTypesReviewed
        ? `${duplicates.length} similar pair${duplicates.length === 1 ? " was" : "s were"} included in the current Information Type inventory review. FileGRC did not merge records or rewrite relationships.`
        : `${duplicates.length} similar pair${duplicates.length === 1 ? " needs" : "s need"} management review. FileGRC will not merge records or rewrite relationships automatically.`,
      { type: "information-type" },
      {
        progressUnit: false,
        candidates: duplicates,
        commands: [
          "npx filegrc list information-type --workflow --json",
          "npx filegrc review-collection information-type --scaffold"
        ]
      }
    ));
  }
  return items;
}

export async function resourceReviewRevision(loaded, resourceId) {
  return (await resourceReviewRevisions(loaded, [resourceId])).get(resourceId) || null;
}

export async function resourceReviewRevisions(loaded, ids, scopeHashInput = "legacy", reviewer = null) {
  const wanted = new Set(ids);
  const entries = new Map(loaded.entries.map((entry) => [entry.record.id, entry]));
  const revisions = new Map();
  const reviewing = new Set();
  const review = async (id, heading = null) => {
    const key = `${id}\0${heading || ""}`;
    if (revisions.has(key)) return revisions.get(key);
    const entry = effectiveReviewEntry(loaded, entries.get(id));
    if (!entry || reviewing.has(key)) return null;
    reviewing.add(key);
    const decisionHeading = heading || retentionPolicyHeading(loaded, entry, reviewer);
    const parts = [reviewSource(loaded, entry, scopeHashInput, false, decisionHeading, reviewer)];
    let matchedSection = !decisionHeading;
    for (const markdown of reviewMarkdownEntries(loaded, entry, false)) {
      try {
        const source = entry.reviewCommit
          ? entry.reviewFiles?.get(`data/${markdown.path}`)
            ?? getFileAtRevision(loaded.root, entry.reviewCommit, `data/${markdown.path}`)
          : await readFile(resolveDataPath(loaded.root, markdown.path), "utf8");
        if (source !== null) {
          const section = reviewedMarkdownSection(source, decisionHeading);
          if (section !== null) { parts.push(section); matchedSection = true; }
        }
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    if (!matchedSection) { reviewing.delete(key); return null; }
    let missingDependency = false;
    for (const sourceId of [...new Set(entry.record.sourceResourceIds || [])].sort()) {
      const revision = await review(sourceId, sourceHeading(entry.record, sourceId));
      if (revision) parts.push(`${sourceId}:${revisionDigest("content", revision) || revision}`);
      else missingDependency = true;
    }
    reviewing.delete(key);
    if (missingDependency) return null;
    const revision = contentRevision(parts.join("\n"));
    revisions.set(key, revision);
    return revision;
  };
  const selected = new Map();
  for (const id of wanted) {
    selected.set(id, await review(id, sourceHeading(reviewer, id)));
  }
  return new Map([...selected].filter(([, revision]) => revision));
}

export function resourceReviewRevisionsSync(loaded, ids, scopeHashInput = "legacy", legacySource = false, historicalCommit = null, reviewer = null) {
  const wanted = new Set(ids);
  const entries = new Map(loaded.entries.map((entry) => [entry.record.id, entry]));
  const revisions = new Map();
  const reviewing = new Set();
  const review = (id, heading = null) => {
    const key = `${id}\0${heading || ""}`;
    if (revisions.has(key)) return revisions.get(key);
    const entry = historicalCommit ? entries.get(id) : effectiveReviewEntry(loaded, entries.get(id));
    if (!entry || reviewing.has(key)) return null;
    reviewing.add(key);
    const decisionHeading = legacySource ? heading : heading || retentionPolicyHeading(loaded, entry, reviewer);
    const parts = [reviewSource(loaded, entry, scopeHashInput, legacySource, decisionHeading, reviewer)];
    let matchedSection = !decisionHeading;
    for (const markdown of reviewMarkdownEntries(loaded, entry, legacySource)) {
      try {
        const source = (historicalCommit || entry.reviewCommit)
          ? loaded.historicalFiles?.get(`data/${markdown.path}`)
            ?? entry.reviewFiles?.get(`data/${markdown.path}`)
            ?? getFileAtRevision(loaded.root, historicalCommit || entry.reviewCommit, `data/${markdown.path}`)
          : readFileSync(resolveDataPath(loaded.root, markdown.path), "utf8");
        if (source !== null) {
          const section = legacySource ? source : reviewedMarkdownSection(source, decisionHeading);
          if (section !== null) { parts.push(section); matchedSection = true; }
        }
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    if (!matchedSection) { reviewing.delete(key); return null; }
    let missingDependency = false;
    for (const sourceId of [...new Set(entry.record.sourceResourceIds || [])].sort()) {
      const revision = review(sourceId, sourceHeading(entry.record, sourceId));
      if (revision) parts.push(`${sourceId}:${revisionDigest("content", revision) || revision}`);
      else missingDependency = true;
    }
    reviewing.delete(key);
    if (missingDependency) return null;
    const revision = contentRevision(parts.join("\n"));
    revisions.set(key, revision);
    return revision;
  };
  const selected = new Map();
  for (const id of wanted) selected.set(id, review(id, sourceHeading(reviewer, id)));
  return new Map([...selected].filter(([, revision]) => revision));
}

export function resourceReviewRevisionMatches(loaded, revisions, id, stored, reviewer = null) {
  const current = (sourceHeading(reviewer, id) || reviewer?.type === "retention-schedule-item")
    ? resourceReviewRevisionsSync(loaded, [id], "legacy", false, null, reviewer).get(id)
    : revisions.get(id);
  if (!current || !revisionDigest("content", stored)) return false;
  if (revisionsMatch("content", stored, current)) return true;
  if (!sourceHeading(reviewer, id)) {
    const legacy = resourceReviewRevisionsSync(loaded, [id], "legacy", true).get(id);
    if (revisionsMatch("content", stored, legacy)) return true;
    // Version 0.16.0 used a bare digest as the hash input for scopeRevision.
    // Read that binding without changing the legacy scope: basis restored here.
    const compatible = resourceReviewRevisionsSync(loaded, [id], "digest", true).get(id);
    if (revisionsMatch("content", stored, compatible)) return true;
  }
  return historicallyEquivalentReviewSource(loaded, id, stored, current, reviewer);
}

// Recompute the old byte-sensitive binding at each committed state. The
// semantic source graph must still equal today's graph, including linked
// records and Markdown, before the old approval is treated as current.
function historicallyEquivalentReviewSource(loaded, id, stored, current, reviewer = null) {
  if (!loaded.root) return false;
  const context = reviewHistoryContext(loaded.root, loaded);
  const { index } = context;
  const relevantPaths = index?.available ? new Set(["data/workspace.json"]) : null;
  const graphIds = new Set();
  const visit = (resourceId) => {
    if (graphIds.has(resourceId)) return;
    graphIds.add(resourceId);
    const entry = loaded.entries.find(({ record }) => record.id === resourceId);
    if (!entry) return;
    for (const path of (index.historiesById.get(resourceId) || []).map(({ path }) => path)) relevantPaths.add(path);
    for (const markdown of markdownEntries(loaded.model, entry.record)) relevantPaths.add(`data/${markdown.path}`);
    for (const sourceId of entry.record.sourceResourceIds || []) visit(sourceId);
  };
  if (relevantPaths) visit(id);
  for (const commit of [...reviewHistoryCommits(context)].reverse()) {
    const changed = index?.available ? index.fileChangesByCommit.get(commit) : null;
    if (relevantPaths && ![...changed.keys()].some((path) => relevantPaths.has(path) || path.endsWith(".md"))) continue;
    const snapshot = reviewHistoricalWorkspace(context, commit);
    if (!snapshot?.entries.some(({ record }) => record.id === id)) continue;
    const semantic = resourceReviewRevisionsSync(snapshot, [id], "legacy", false, commit, reviewer).get(id);
    if (!revisionsMatch("content", semantic, current)) continue;
    // A row may narrow a source to its retention facts or a named Markdown
    // section. Accept its old binding only when those facts still match the
    // committed source that supplied the binding.
    const original = resourceReviewRevisionsSync(snapshot, [id], "legacy", false, commit).get(id);
    if (revisionsMatch("content", stored, original)) return true;
    for (const scopeHashInput of ["legacy", "digest"]) {
      const legacy = resourceReviewRevisionsSync(snapshot, [id], scopeHashInput, true, commit).get(id);
      if (revisionsMatch("content", stored, legacy)) return true;
    }
  }
  return false;
}

export function retentionUses(loaded, program) {
  const systemIds = new Set(program.systemIds || []);
  const componentIds = new Set(programComponents(loaded, program).map(({ id }) => id));
  const vendorIds = new Set(program.vendorIds || loaded.resources
    .filter((record) => record.type === "vendor" && record.status !== "retired")
    .map(({ id }) => id));
  const uses = [];
  for (const record of loaded.resources) {
    if (record.type === "system" && systemIds.has(record.id)) {
      for (const informationTypeId of record.informationTypeIds || []) uses.push({ resource: record, informationTypeId });
    }
    if (record.type === "component" && componentIds.has(record.id)) {
      for (const use of record.informationUses || []) uses.push({ resource: record, informationTypeId: use.informationTypeId });
    }
    if (record.type === "vendor" && vendorIds.has(record.id)) {
      for (const informationTypeId of record.informationTypeIds || []) uses.push({ resource: record, informationTypeId });
    }
  }
  return [...new Map(uses.map((use) => [`${use.resource.id}:${use.informationTypeId}`, use])).values()];
}

function reviewSource(loaded, entry, scopeHashInput = "legacy", legacySource = false, heading = null, reviewer = null) {
  if (heading && !legacySource) {
    const governingFields = entry.record.type === "policy"
      ? ["policyKind", "effectiveOn", "supersedesId", "parentPolicyId", "relatedPolicyIds", "relatedDocumentIds", "requirementIds", "audience", "acknowledgementRequired", "programRole", "reportingRouteRequirements"]
      : ["documentKind", "workflowScope", "effectiveOn", "supersedesId", "systemIds", "controlIds", "relatedDocumentIds", "audience", "acknowledgementRequired", "trainingIds", "classificationId", "programRole", "componentIds", "reportingRouteRequirements"];
    return JSON.stringify({
      id: entry.record.id,
      type: entry.record.type,
      governingStatus: ["approved", "active"].includes(entry.record.status)
        ? "approved" : entry.record.status || null,
      ...Object.fromEntries(["extensions", "externalIds", ...governingFields].filter((field) => entry.record[field] !== undefined)
        .map((field) => [field, entry.record[field]]))
    });
  }
  if (
    modelSupports(loaded.model, "retention-schedule-approval")
    && entry.record.type === "document"
    && entry.record.documentKind === "schedule"
    && entry.record.workflowScope === "program"
  ) {
    const approved = structuredClone(entry.record);
    for (const field of [
      "status",
      "approverIds",
      "approvedOn",
      "approvedContentRevisions",
      "activationBasis",
      "activatedByIds",
      "activatedOn",
      "activatedContentRevisions",
      "effectiveOn",
      "proposedEffectiveOn"
    ]) delete approved[field];
    return JSON.stringify(approved);
  }
  return legacySource
    ? canonicalCalculatedRevisionJson(entry.source, scopeHashInput)
    : canonicalCalculatedRevisionJson(JSON.stringify(substantiveReviewSource(
      JSON.parse(entry.source), modelSupports(loaded.model, "retention-schedule-approval"), reviewer
    )), scopeHashInput);
}

function reviewMarkdownEntries(loaded, entry, legacySource) {
  // Control Markdown records the implementation procedure. Retention and
  // mapping decisions depend on the structured Control design instead.
  if (!legacySource && modelSupports(loaded.model, "retention-schedule-approval")
    && entry.record.type === "control") return [];
  return markdownEntries(loaded.model, entry.record);
}

const approvedReviewEntries = new WeakMap();

function effectiveReviewEntry(loaded, entry) {
  if (!entry || !loaded.root || !["policy", "document", "training"].includes(entry.record.type)) return entry;
  if (!["draft", "in-review", "approved", "active"].includes(entry.record.status)) return entry;
  if (approvedReviewContentMatches(loaded, entry)) return entry;
  if (["approved", "active"].includes(entry.record.status)) return entry;
  let cache = approvedReviewEntries.get(loaded.resources);
  if (!cache) {
    cache = new Map();
    approvedReviewEntries.set(loaded.resources, cache);
  }
  if (cache.has(entry.record.id)) return cache.get(entry.record.id) || entry;
  const context = reviewHistoryContext(loaded.root, loaded);
  for (const commit of [...reviewHistoryCommits(context)].reverse()) {
    const snapshot = reviewHistoricalWorkspace(context, commit);
    const historical = snapshot?.entries.find(({ record }) => record.id === entry.record.id);
    if (!historical || !approvedReviewContentMatches(snapshot, historical, commit)) continue;
    const approved = { ...historical, reviewCommit: commit, reviewFiles: snapshot.historicalFiles };
    cache.set(entry.record.id, approved);
    return approved;
  }
  cache.set(entry.record.id, null);
  return entry;
}

function approvedReviewContentMatches(loaded, entry, commit = null) {
  if (!["approved", "active"].includes(entry.record.status)) return false;
  const bindings = entry.record.approvedContentRevisions || entry.record.effectiveContentRevisions;
  if (!bindings) return true;
  for (const markdown of reviewMarkdownEntries(loaded, entry, false)) {
    const source = commit
      ? loaded.historicalFiles?.get(`data/${markdown.path}`)
        ?? getFileAtRevision(loaded.root, commit, `data/${markdown.path}`)
      : (() => {
        try { return readFileSync(resolveDataPath(loaded.root, markdown.path), "utf8"); }
        catch (error) { if (error.code === "ENOENT") return null; throw error; }
      })();
    if (!source || !revisionsMatch("content", bindings[markdown.path], contentRevision(source))) return false;
  }
  return true;
}

export function reviewedMarkdownSection(source, heading) {
  if (!heading) return source;
  const lines = source.split("\n");
  const wanted = heading.trim().replace(/^#{1,6}\s+/, "").toLowerCase();
  const headings = [];
  const fencedLines = new Set();
  let fence = null;
  for (const [index, line] of lines.entries()) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      fencedLines.add(index);
      if (marker?.[0] === fence[0] && marker.length >= fence.length
        && /^\s*$/.test(line.slice(line.indexOf(marker) + marker.length))) fence = null;
      continue;
    }
    if (marker) { fence = marker; fencedLines.add(index); continue; }
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) headings.push({ index, level: match[1].length, title: match[2].trim().toLowerCase() });
  }
  const matches = headings.filter(({ title }) => title === wanted);
  if (matches.length !== 1) return null;
  const selected = matches[0];
  const ancestors = [];
  for (const candidate of headings.filter(({ index }) => index < selected.index)) {
    while (ancestors.length && ancestors.at(-1).level >= candidate.level) ancestors.pop();
    ancestors.push(candidate);
  }
  const next = headings.find(({ index, level }) => index > selected.index && level <= selected.level);
  const context = ancestors.map(({ index }) => {
    const following = headings.find((candidate) => candidate.index > index);
    return lines.slice(index, following?.index).filter((_, offset) => !fencedLines.has(index + offset)).join("\n").trim();
  });
  return [...context, lines.slice(selected.index, next?.index).join("\n").trim()].join("\n\n");
}

function sourceHeading(record, sourceId) {
  const headings = record?.sourceSectionHeadings;
  return headings && Object.hasOwn(headings, sourceId) && typeof headings[sourceId] === "string"
    ? headings[sourceId] : null;
}

function retentionPolicyHeading(loaded, entry, reviewer) {
  if (reviewer?.type !== "retention-schedule-item" || entry.record.type !== "policy") return null;
  // Older rows often bind a whole Policy. A single retention section gives
  // that decision a narrower basis while an explicit heading still wins.
  const headings = new Set();
  for (const markdown of markdownEntries(loaded.model, entry.record)) {
    let source;
    try {
      source = loaded.historicalFiles?.get(`data/${markdown.path}`)
        ?? (entry.reviewCommit
          ? entry.reviewFiles?.get(`data/${markdown.path}`)
            ?? getFileAtRevision(loaded.root, entry.reviewCommit, `data/${markdown.path}`)
          : readFileSync(resolveDataPath(loaded.root, markdown.path), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    for (const line of (source || "").split("\n")) {
      const heading = /^#{2,6}\s+(.+?)\s*#*\s*$/.exec(line)?.[1];
      if (heading && /\b(retention|disposal|deletion|destruction|archiving)\b/i.test(heading)
        && reviewedMarkdownSection(source, heading) !== null) headings.add(heading);
    }
  }
  return headings.size === 1 ? [...headings][0] : null;
}

const reviewDecisionFields = {
  control: ["statement", "requirementIds", "code", "activity", "controlType", "operationMode", "operationPattern", "systemIds", "policyIds", "componentIds", "evidenceSourceComponentIds"],
  commitment: ["commitmentKind", "statement", "systemIds", "sourceResourceIds", "sourceSectionHeadings", "requirementIds", "controlIds", "customerFacing", "effectiveOn", "reportingRouteRequirements"],
  "complementary-control": ["responsibleParty", "statement", "systemIds", "vendorId", "requirementIds", "commitmentIds", "relatedControlIds", "sourceDocumentIds", "componentIds"],
  "source-coverage": ["sourceFamilyId", "coverageKind", "scopeResourceIds", "excludedPopulation", "collectionCadence", "reconciliationMethod", "validFrom", "validThrough", "componentId", "retentionScheduleItemIds"],
  system: ["purpose", "servicesProvided", "boundary", "exclusions", "criticality", "informationTypeIds", "classificationId", "internetExposed", "continuityObjectives"],
  component: ["componentKind", "description", "criticality", "environment", "vendorId", "systemUses", "informationUses", "evidenceSourceKinds", "internetExposed", "classificationId", "continuityObjectives"],
  vendor: ["category", "criticality", "description", "standardAgreement", "agreementDocumentId", "startDate", "endDate", "informationTypeIds", "classificationId"],
  "information-type": ["classificationId", "description"],
  framework: ["version", "publisher", "description", "sourceReference", "effectiveOn"],
  requirement: ["frameworkId", "reference", "description", "parentRequirementId"],
  policy: ["policyNumber", "policyKind", "version", "effectiveOn", "supersedesId", "parentPolicyId", "relatedPolicyIds", "relatedDocumentIds", "requirementIds", "audience", "acknowledgementRequired", "programRole", "reportingRouteRequirements"],
  document: ["documentKind", "workflowScope", "template", "version", "effectiveOn", "supersedesId", "systemIds", "controlIds", "relatedDocumentIds", "audience", "acknowledgementRequired", "trainingIds", "classificationId", "programRole", "componentIds", "reportingRouteRequirements"]
};

function substantiveReviewSource(record, currentModel, reviewer = null) {
  if (currentModel && reviewDecisionFields[record.type]) {
    const fields = ["id", "type", "title", "extensions", "externalIds", ...reviewDecisionFields[record.type]];
    const decision = Object.fromEntries(fields.filter((field) => record[field] !== undefined)
      .map((field) => [field, record[field]]));
    if (record.type === "control") {
      decision.unavailable = ["not-applicable", "retired", "superseded"].includes(record.status);
    } else if (["policy", "document"].includes(record.type)) {
      decision.governingStatus = ["approved", "active"].includes(record.status) ? "approved" : record.status || null;
    } else {
      decision.status = record.status || null;
    }
    if (record.type === "component" && reviewer?.type === "retention-schedule-item") {
      decision.systemUses = retentionSystemUses(decision.systemUses);
      delete decision.evidenceSourceKinds;
    }
    if (["control", "commitment", "complementary-control"].includes(record.type)) {
      decision.nonApplicableDecision = ["not-applicable", "externally-managed", "zero-population"]
        .includes(record.applicabilityReview?.decision) ? record.applicabilityReview.decision : null;
    }
    return decision;
  }
  const source = record.type === "program" ? {
    id: record.id,
    type: record.type,
    status: record.status,
    assuranceGoal: record.assuranceGoal,
    systemIds: [...(record.systemIds || [])].sort(),
    extensions: record.extensions,
    requirementApplicability: (record.requirementApplicability || [])
      .map(({ requirementId, decision }) => ({ requirementId, decision }))
      .sort((left, right) => left.requirementId.localeCompare(right.requirementId))
  } : { ...record };
  if (source.applicabilityReview) {
    source.applicabilityReview = { decision: source.applicabilityReview.decision };
  }
  if (["policy", "document", "training"].includes(source.type)) {
    for (const field of [
      "approverIds", "approvedOn", "activationBasis", "activatedByIds",
      "activatedOn", "activatedContentRevisions", "statusTransition"
    ]) delete source[field];
    if (["approved", "active"].includes(source.status)) source.status = "approved";
  }
  return source;
}

export function retentionSystemUses(uses) {
  return uses?.map((use) => ({
    ...use,
    roles: use.roles?.filter((role) => role !== "evidence-source")
  }));
}

export function nearDuplicateInformationTypes(records) {
  const types = records.filter((record) => record.type === "information-type" && !["retired", "superseded"].includes(record.status));
  const pairs = [];
  for (let leftIndex = 0; leftIndex < types.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < types.length; rightIndex += 1) {
      const left = types[leftIndex];
      const right = types[rightIndex];
      const score = similarity(normalize(left.title), normalize(right.title));
      if (score >= 0.8) pairs.push({ leftId: left.id, rightId: right.id, score });
    }
  }
  return pairs;
}

function ruleCoversUse(rule, use, program) {
  if (!(rule.informationTypeIds || []).includes(use.informationTypeId)) return false;
  const scope = new Set(rule.scopeResourceIds || []);
  return scope.has(use.resource.id) || scope.has(program.id);
}

function retentionRuleHasCoverageProposal(rule) {
  return Boolean(
    (rule.informationTypeIds || []).length
    && (rule.scopeResourceIds || []).length
    && rule.scheduleDocumentId
  );
}

export function retentionReviewResourceIds(rule, loaded) {
  const programUseIds = [];
  if (loaded) {
    const byId = new Map(loaded.resources.map((record) => [record.id, record]));
    const informationTypeIds = new Set(rule.informationTypeIds || []);
    for (const scopeId of rule.scopeResourceIds || []) {
      const program = byId.get(scopeId);
      if (program?.type !== "program") continue;
      for (const use of retentionUses(loaded, program)) {
        if (informationTypeIds.has(use.informationTypeId)) programUseIds.push(use.resource.id);
      }
    }
  }
  return [...new Set([
    rule.scheduleDocumentId,
    ...(rule.sourceResourceIds || []),
    ...(rule.informationTypeIds || []),
    ...(rule.scopeResourceIds || []),
    ...programUseIds
  ].filter(Boolean))];
}

export function retentionRuleIsCurrent(rule, revisions, byId = new Map(), loaded) {
  if (!String(rule.description || "").trim()) return false;
  if (!(rule.informationTypeIds || []).length || !(rule.scopeResourceIds || []).length || !rule.scheduleDocumentId) return false;
  const schedule = byId.get(rule.scheduleDocumentId);
  if (schedule?.type !== "document" || schedule.documentKind !== "schedule" || schedule.workflowScope !== "program" || ["superseded", "retired"].includes(schedule.status)) return false;
  if (!(rule.ownerIds || []).length) return false;
  if (!rule.reviewedSourceRevisions || typeof rule.reviewedSourceRevisions !== "object") return false;
  if (!retentionCutoffIsComplete(rule.cutoff) || !retentionPeriodIsComplete(rule.retentionPeriod)) return false;
  if (!["delete", "destroy", "erase", "anonymize", "transfer", "retain-permanently"].includes(rule.dispositionAction)) return false;
  if (!String(rule.dispositionInstructions || "").trim()) return false;
  const dependencyIds = retentionReviewResourceIds(rule, loaded);
  if (Object.keys(rule.reviewedSourceRevisions).length !== dependencyIds.length) return false;
  return dependencyIds.every((id) => (
    resourceReviewRevisionMatches(loaded, revisions, id, rule.reviewedSourceRevisions?.[id], rule)
  ));
}

function shellArgument(value) {
  const text = String(value);
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(text)
    ? text
    : `'${text.replaceAll("'", "'\\''")}'`;
}

function retentionCutoffIsComplete(cutoff) {
  if (!cutoff || !["creation", "receipt", "calendar-year-end", "fiscal-year-end", "event"].includes(cutoff.basis)) return false;
  return cutoff.basis !== "event" || Boolean(String(cutoff.event || "").trim());
}

function retentionPeriodIsComplete(period) {
  if (!period || !["fixed", "until-event", "permanent"].includes(period.basis)) return false;
  if (period.basis === "fixed") {
    return Number.isInteger(period.amount) && period.amount >= 1 && ["day", "month", "year"].includes(period.unit);
  }
  return period.basis !== "until-event" || Boolean(String(period.event || "").trim());
}

function normalize(value) {
  return new Set(String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean).map((word) => (
    word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word
  )));
}

function similarity(left, right) {
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter((word) => right.has(word)).length;
  return Number((intersection / new Set([...left, ...right]).size).toFixed(2));
}

function readinessItem(id, status, title, message, resource = {}, details = {}) {
  return {
    id,
    status,
    title,
    message,
    ...(resource.type ? { resourceType: resource.type } : {}),
    ...(resource.id ? { resourceId: resource.id } : {}),
    ...details
  };
}
