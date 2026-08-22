import { readFile } from "node:fs/promises";
import { contentRevision } from "./files.js";
import { resolveDataPath } from "./paths.js";
import { programComponents } from "./program.js";
import { markdownEntries } from "./resource-markdown.js";

export async function assessRetentionReadiness(loaded, program, options = {}) {
  if (!loaded.model.resources["retention-schedule-item"]) return [];
  const byId = new Map(loaded.resources.map((record) => [record.id, record]));
  const rules = loaded.resources.filter((record) => (
    record.type === "retention-schedule-item" && record.status === "active"
  ));
  const revisions = await resourceReviewRevisions(loaded, rules.flatMap((rule) => retentionReviewResourceIds(rule, loaded)));
  const usableRules = rules.filter((rule) => retentionRuleIsCurrent(rule, revisions, byId, loaded));
  const uses = retentionUses(loaded, program);
  const items = rules.filter((rule) => !usableRules.includes(rule)).map((rule) => readinessItem(
    `retention-rule-${rule.id}`,
    "action",
    `Review ${rule.title}`,
    "This active retention schedule item is incomplete or is not bound to every current source revision. Review it before relying on its period or disposition behavior.",
    rule,
    {
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
  items.push(...uses.map((use) => {
    const matches = usableRules.filter((rule) => ruleCoversUse(rule, use, program));
    return readinessItem(
      `retention-use-${use.resource.id}-${use.informationTypeId}`,
      matches.length ? "complete" : "action",
      `Decide retention for ${byId.get(use.informationTypeId)?.title || use.informationTypeId}`,
      matches.length
        ? `${use.resource.title} is covered by ${matches.map(({ title }) => title).join(", ")}.`
        : `${use.resource.title} uses this Information Type, but no active, current retention schedule item covers both the type and scope. Management must choose the cutoff, period, and disposition.`,
      use.resource,
      {
        informationTypeId: use.informationTypeId,
        retentionScheduleItemIds: matches.map(({ id }) => id),
        commands: [
          "npx filegrc guide retention-schedule-item --json",
          `npx filegrc scaffold retention-schedule-item --title ${shellArgument(`Retention for ${byId.get(use.informationTypeId)?.title || use.informationTypeId}`)}`
        ]
      }
    );
  }));

  for (const coverage of loaded.resources.filter((record) => record.type === "source-coverage" && record.status === "active")) {
    const linked = (coverage.retentionScheduleItemIds || []).map((id) => byId.get(id)).filter(Boolean);
    const matching = linked.filter((rule) => (
      rule.type === "retention-schedule-item"
      && rule.status === "active"
      && usableRules.includes(rule)
      && (rule.scopeResourceIds || []).includes(coverage.id)
    ));
    items.push(readinessItem(
      `retention-source-coverage-${coverage.id}`,
      matching.length ? "complete" : "action",
      `Confirm retained evidence for ${coverage.title}`,
      matching.length
        ? `The source-coverage record references a current schedule item scoped to this population.`
        : `The source-coverage record must reference an active, current schedule item whose scope includes ${coverage.id}. A draft schedule or unrelated rule does not satisfy this check.`,
      coverage,
      {
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

export async function resourceReviewRevisions(loaded, ids) {
  const wanted = new Set(ids);
  const entries = new Map(loaded.entries.map((entry) => [entry.record.id, entry]));
  const revisions = new Map();
  const reviewing = new Set();
  const review = async (id) => {
    if (revisions.has(id)) return revisions.get(id);
    const entry = entries.get(id);
    if (!entry || reviewing.has(id)) return null;
    reviewing.add(id);
    const parts = [entry.source];
    for (const markdown of markdownEntries(loaded.model, entry.record)) {
      try {
        parts.push(await readFile(resolveDataPath(loaded.root, markdown.path), "utf8"));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    for (const sourceId of [...new Set(entry.record.sourceResourceIds || [])].sort()) {
      const revision = await review(sourceId);
      if (revision) parts.push(`${sourceId}:${revision}`);
    }
    reviewing.delete(id);
    const revision = contentRevision(parts.join("\n"));
    revisions.set(id, revision);
    return revision;
  };
  for (const id of wanted) {
    await review(id);
  }
  return new Map([...revisions].filter(([id]) => wanted.has(id)));
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
  if (!(rule.ownerIds || []).length || !(rule.approvedByIds || []).length || !rule.approvedOn) return false;
  if (!rule.reviewedSourceRevisions || typeof rule.reviewedSourceRevisions !== "object") return false;
  if (!retentionCutoffIsComplete(rule.cutoff) || !retentionPeriodIsComplete(rule.retentionPeriod)) return false;
  if (!["delete", "destroy", "erase", "anonymize", "transfer", "retain-permanently"].includes(rule.dispositionAction)) return false;
  if (!String(rule.dispositionInstructions || "").trim()) return false;
  const dependencyIds = retentionReviewResourceIds(rule, loaded);
  if (Object.keys(rule.reviewedSourceRevisions).length !== dependencyIds.length) return false;
  return dependencyIds.every((id) => (
    revisions.get(id) && rule.reviewedSourceRevisions?.[id] === revisions.get(id)
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
