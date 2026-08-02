import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, readdir, readlink, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { assessAuditPreparation } from "./audit-preparation.js";
import { getFileAtRevision, getGitSummary, getWorkspaceHistories, hasGitRevision } from "./git.js";
import { planObligations } from "./obligations.js";
import { isWithin, resolveDataPath, resolveWorkspacePath } from "./paths.js";
import { parseCalendarDate } from "./recurrence.js";
import { markdownEntries } from "./resource-markdown.js";
import { serializeWorkspaceMutation } from "./mutation.js";
import { validateWorkspace } from "./validate.js";

const NON_EVIDENCE_RECORD_TYPES = new Set([
  "appointment",
  "audit",
  "audit-population",
  "audit-request",
  "commitment",
  "complementary-control",
  "control",
  "control-test",
  "document",
  "evidence",
  "framework",
  "obligation",
  "organization",
  "person",
  "policy",
  "renderer-settings",
  "requirement",
  "system",
  "team",
  "training",
  "vendor",
  "workspace"
]);

export async function prepareEvidencePacket(input, options = {}) {
  const validation = await validateWorkspace(input);
  if (!validation.ok) throw new Error(`The workspace has ${validation.counts.errors} validation ${validation.counts.errors === 1 ? "error" : "errors"}. Fix them before generating evidence.`);
  const { loaded } = validation;
  const records = loaded.resources;
  const byId = new Map(records.map((record) => [record.id, record]));
  const entriesById = new Map(loaded.entries.map((entry) => [entry.record.id, entry]));
  const audit = options.auditId ? byId.get(options.auditId) : null;
  if (options.auditId && audit?.type !== "audit") throw new Error(`Audit "${options.auditId}" was not found.`);
  const { start, end, basis } = resolvePacketPeriod(options, audit);
  const typeOne = audit?.auditKind === "soc-2-type-1";
  const datedRecords = loaded.entries
    .filter((entry) => !audit || recordRelevantToAudit(entry.record, audit, byId))
    .map((entry) => packetRecord(entry.record, loaded.model, start, end, loaded.workspace.timezone))
    .filter(Boolean);
  const datedRecordIds = new Set(datedRecords.map(({ id }) => id));
  const datedEvidenceSourceIds = new Set(
    [...datedRecordIds].flatMap((id) => (
      byId.get(id)?.type === "evidence" ? byId.get(id).sourceResourceIds || [] : []
    ))
  );
  const plan = planObligations(records, {
    asOf: end,
    from: start,
    through: end,
    includeComplete: true
  });
  const obligations = (typeOne ? [] : plan.calendarItems).filter((item) => (
    item.dueWindowStart <= end
    && item.overdueOn > start
    && (!audit || recordRelevantToAudit(byId.get(item.obligationId), audit, byId))
  ));
  const eventRuns = (typeOne ? [] : plan.eventRuns).filter((run) => (
    (!audit || run.actions.some((action) => recordRelevantToAudit(byId.get(action.obligationId), audit, byId)))
    && (
      (run.occurredOn >= start && run.occurredOn <= end)
      || datedEvidenceSourceIds.has(run.id)
      || run.actions.some((action) => (
        (action.completedOn && action.completedOn >= start && action.completedOn <= end)
        || datedEvidenceSourceIds.has(action.actionItemId)
        || [...action.completionResourceIds, ...action.evidenceIds].some((id) => datedRecordIds.has(id))
        || (action.dueWindowStart <= end && (!action.overdueOn || action.overdueOn > start))
      ))
    )
  ));
  const selectedIds = new Set(datedRecords.map((record) => record.id));
  if (audit) {
    selectedIds.add(audit.id);
    addIds(selectedIds, [
      ...(audit.frameworkIds || []),
      ...(audit.systemIds || []),
      ...(audit.requirementIds || []),
      ...(audit.controlIds || []),
      ...(audit.controlTestIds || []),
      ...(audit.evidenceIds || []),
      ...(audit.contactIds || []),
      ...(audit.complementaryControlIds || []),
      ...(audit.subserviceVendorIds || []),
      audit.systemDescriptionDocumentId,
      audit.managementAssertionDocumentId,
      audit.managementRepresentationDocumentId,
      audit.periodCompletenessDocumentId,
      audit.managementResponseDocumentId,
      audit.reportEvidenceId,
      ...(audit.supplementalDocumentIds || [])
    ]);
    for (const request of records.filter((record) => record.type === "audit-request" && record.auditId === audit.id)) {
      selectedIds.add(request.id);
    }
    for (const record of records.filter((candidate) => ["finding", "action-item"].includes(candidate.type))) {
      if (recordRelevantToAudit(record, audit, byId)) selectedIds.add(record.id);
    }
  }
  for (const item of obligations) {
    selectedIds.add(item.obligationId);
    addIds(selectedIds, item.completionResourceIds);
    addIds(selectedIds, item.evidenceIds);
  }
  for (const run of eventRuns) {
    selectedIds.add(run.id);
    addIds(selectedIds, run.actionItemIds);
    for (const action of run.actions) {
      selectedIds.add(action.obligationId);
      addIds(selectedIds, action.completionResourceIds);
      addIds(selectedIds, action.evidenceIds);
    }
  }

  const evidenceIds = new Set();
  for (const evidence of records.filter((record) => record.type === "evidence")) {
    if (audit && !recordRelevantToAudit(evidence, audit, byId)) continue;
    const direct = selectedIds.has(evidence.id)
      || (evidence.sourceResourceIds || []).some((id) => selectedIds.has(id))
      || overlapsEvidencePeriod(evidence, start, end);
    if (direct) evidenceIds.add(evidence.id);
  }
  for (const id of [...selectedIds]) {
    const record = byId.get(id);
    addIds(evidenceIds, record?.evidenceIds);
    addIds(evidenceIds, record?.sampleEvidenceIds);
    if (record?.sourceEvidenceId) evidenceIds.add(record.sourceEvidenceId);
    if (record?.populationId) selectedIds.add(record.populationId);
  }
  addIds(selectedIds, evidenceIds);
  expandEvidenceWorkflowContext(selectedIds, byId);
  for (const id of selectedIds) if (byId.get(id)?.type === "evidence") evidenceIds.add(id);

  const controlIds = new Set(audit?.controlIds || records
    .filter((record) => record.type === "control" && !["not-applicable", "retired"].includes(record.status))
    .map(({ id }) => id));
  if (!audit) {
    for (const id of selectedIds) {
      const record = byId.get(id);
      addIds(controlIds, record?.controlIds);
      if (record?.type === "control") controlIds.add(record.id);
      if (record?.obligationId) addIds(controlIds, byId.get(record.obligationId)?.controlIds);
    }
  }
  addIds(selectedIds, controlIds);
  for (const controlId of controlIds) {
    const control = byId.get(controlId);
    addIds(selectedIds, control?.systemIds);
    addIds(selectedIds, control?.commitmentIds);
    addIds(selectedIds, control?.riskIds);
  }
  for (const complementaryControl of records.filter((record) => record.type === "complementary-control")) {
    if ((complementaryControl.relatedControlIds || []).some((id) => controlIds.has(id))) {
      selectedIds.add(complementaryControl.id);
    }
  }
  for (const systemId of audit?.systemIds || []) {
    const system = byId.get(systemId);
    addIds(selectedIds, system?.commitmentIds);
    addIds(selectedIds, system?.subserviceVendorIds);
  }

  const policyIds = new Set(audit
    ? []
    : records.filter((record) => record.type === "policy" && ["approved", "active"].includes(record.status)).map((record) => record.id));
  for (const id of selectedIds) addIds(policyIds, policyIdsFor(byId.get(id), byId));
  for (const controlId of controlIds) addIds(policyIds, byId.get(controlId)?.policyIds);
  expandSupersededPolicyIds(policyIds, byId);
  addIds(selectedIds, policyIds);

  const requirementIds = new Set();
  for (const controlId of controlIds) addIds(requirementIds, byId.get(controlId)?.requirementIds);
  if (audit) addIds(requirementIds, audit.requirementIds);
  addIds(selectedIds, requirementIds);

  const sourceRevisionValidity = new Map();
  const revisionIsValid = (revision) => {
    if (!sourceRevisionValidity.has(revision)) sourceRevisionValidity.set(revision, hasGitRevision(loaded.root, revision));
    return sourceRevisionValidity.get(revision);
  };
  const evidence = [...evidenceIds].map((id) => evidenceSummary(byId.get(id), byId, revisionIsValid)).filter(Boolean).sort(byTitle);
  const sourceSystemIds = new Set([
    ...(audit?.systemIds || []),
    ...evidence.map((item) => item.sourceSystemId).filter(Boolean)
  ]);
  const sourceSystems = [...sourceSystemIds]
    .map((id) => sourceSystemSummary(byId.get(id), evidence, audit))
    .filter(Boolean)
    .sort(byTitle);
  const selectedEntries = [...selectedIds].map((id) => entriesById.get(id)).filter(Boolean);
  const selectedPaths = selectedEntries.flatMap((entry) => [
    `data/${entry.relativePath}`,
    ...markdownEntries(loaded.model, entry.record).map((markdown) => `data/${markdown.path}`)
  ]);
  const historyRevision = getGitSummary(loaded.root);
  const histories = getWorkspaceHistories(loaded.root, selectedPaths, Number.MAX_SAFE_INTEGER);
  const packetRecords = [...selectedIds]
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((record) => {
      const path = `data/${entriesById.get(record.id)?.relativePath || ""}`;
      const contentPaths = markdownEntries(loaded.model, record).map((markdown) => `data/${markdown.path}`);
      return {
        id: record.id,
        type: record.type,
        title: record.title,
        path,
        dates: packetRecord(record, loaded.model, start, end, loaded.workspace.timezone)?.dates || [],
        policyIds: policyIdsFor(record, byId),
        evidenceIds: record.evidenceIds || [],
        history: histories.get(path) || [],
        contentPaths: contentPaths.map((contentPath) => ({
          path: contentPath,
          history: histories.get(contentPath) || []
        }))
      };
    })
    .sort((a, b) => a.type.localeCompare(b.type) || a.title.localeCompare(b.title));
  await assertLoadedEntriesCurrent(loaded);
  const dataDigest = await dataTreeDigest(loaded.root);
  await assertLoadedEntriesCurrent(loaded);
  const git = getGitSummary(loaded.root);
  if (historyRevision.commit !== git.commit || historyRevision.branch !== git.branch) {
    throw new Error("The Git revision changed while the evidence packet was being prepared. Try again.");
  }
  const controlCoverage = buildControlCoverage({
    audit,
    byId,
    controlIds,
    evidenceIds,
    model: loaded.model,
    records,
    start,
    end,
    timezone: loaded.workspace.timezone
  });
  const filegrcRecords = datedRecords.filter((record) => (
    !NON_EVIDENCE_RECORD_TYPES.has(record.type)
    && controlIdsForRecord(byId.get(record.id), byId).size
  ));
  const populations = (typeOne ? [] : records)
    .filter((record) => record.type === "audit-population" && (!audit || record.auditId === audit.id))
    .map((record) => populationSummary(record, byId))
    .sort(byTitle);
  const generatedAt = options.generatedAt || new Date().toISOString();
  const managementPreparation = await assessAuditPreparation(loaded, {
    auditId: audit?.id,
    generatedAt,
    selectDefault: false
  });
  const gaps = packetGaps({
    audit,
    byId,
    obligations,
    eventRuns,
    evidence,
    git,
    start,
    end,
    controlCoverage,
    requirementIds,
    records,
    populations,
    model: loaded.model,
    managementPreparation
  });
  const errorCount = gaps.filter(({ severity }) => severity === "error").length;
  const warningCount = gaps.filter(({ severity }) => severity === "warning").length;
  return {
    schemaVersion: 1,
    generatedAt,
    period: { start, end, basis },
    readiness: {
      status: errorCount ? "draft" : warningCount ? "review-required" : "delivery-ready",
      errors: errorCount,
      warnings: warningCount
    },
    audit: audit ? {
      id: audit.id,
      title: audit.title,
      kind: audit.auditKind,
      status: audit.status,
      scope: audit.scope,
      periodStart: audit.periodStart,
      periodEnd: audit.periodEnd,
      typeOneAsOf: audit.typeOneAsOf,
      systemIds: audit.systemIds || [],
      requirementIds: audit.requirementIds || [],
      controlIds: audit.controlIds || [],
      subserviceMethod: audit.subserviceMethod || null
    } : null,
    workspace: {
      title: loaded.workspace.title,
      organizationName: loaded.workspace.organizationName,
      timezone: loaded.workspace.timezone
    },
    revision: {
      commit: git.commit,
      shortCommit: git.shortCommit,
      branch: git.branch,
      clean: git.clean,
      dataDigest
    },
    handling: {
      classifications: [...new Set(evidence.map(({ classification }) => classification).filter(Boolean))].sort(),
      containsExternalReferences: evidence.some(({ externalReference }) => Boolean(externalReference)),
      encrypted: false
    },
    summary: {
      datedRecords: datedRecords.length,
      filegrcRecords: filegrcRecords.length,
      records: packetRecords.length,
      policies: policyIds.size,
      controls: controlIds.size,
      requirements: requirementIds.size,
      systems: audit?.systemIds?.length || 0,
      sourceSystems: sourceSystems.length,
      obligationOccurrences: obligations.length,
      eventRuns: eventRuns.length,
      evidence: evidence.length,
      populations: populations.length,
      gaps: gaps.length,
      errors: errorCount,
      warnings: warningCount
    },
    datedRecords: datedRecords.sort((a, b) => a.primaryDate.localeCompare(b.primaryDate) || byTitle(a, b)),
    filegrcRecords: filegrcRecords.sort((a, b) => a.primaryDate.localeCompare(b.primaryDate) || byTitle(a, b)),
    policies: [...policyIds].map((id) => recordSummary(byId.get(id))).filter(Boolean).sort(byTitle),
    controls: [...controlIds].map((id) => recordSummary(byId.get(id))).filter(Boolean).sort(byTitle),
    obligations,
    eventRuns,
    evidence,
    sourceSystems,
    populations,
    managementPreparation,
    controlCoverage,
    gaps,
    records: packetRecords
  };
}

function expandSupersededPolicyIds(policyIds, byId) {
  const queue = [...policyIds];
  for (let index = 0; index < queue.length; index += 1) {
    const supersedesId = byId.get(queue[index])?.supersedesId;
    if (!supersedesId || policyIds.has(supersedesId)) continue;
    policyIds.add(supersedesId);
    queue.push(supersedesId);
  }
}

function recordRelevantToAudit(record, audit, byId, seen = new Set()) {
  if (!record || seen.has(record.id)) return false;
  seen.add(record.id);
  if (record.id === audit.id || record.auditId === audit.id || (record.auditIds || []).includes(audit.id)) return true;
  if (record.auditId && record.auditId !== audit.id) return false;
  if ((record.auditIds || []).length) return false;
  const selectedIds = new Set([
    ...(audit.frameworkIds || []),
    ...(audit.systemIds || []),
    ...(audit.requirementIds || []),
    ...(audit.controlIds || []),
    ...(audit.controlTestIds || []),
    ...(audit.evidenceIds || []),
    ...(audit.contactIds || []),
    ...(audit.complementaryControlIds || []),
    ...(audit.subserviceVendorIds || []),
    audit.systemDescriptionDocumentId,
    audit.managementAssertionDocumentId,
    audit.managementRepresentationDocumentId,
    audit.periodCompletenessDocumentId,
    audit.managementResponseDocumentId,
    audit.reportEvidenceId,
    ...(audit.supplementalDocumentIds || [])
  ].filter(Boolean));
  if (selectedIds.has(record.id)) return true;
  const auditSystems = new Set(audit.systemIds || []);
  const recordSystems = new Set([...(record.systemIds || []), record.systemId, record.sourceSystemId].filter(Boolean));
  if (recordSystems.size && [...recordSystems].some((id) => auditSystems.has(id))) return true;
  const auditControls = new Set(audit.controlIds || []);
  const recordControls = controlIdsForRecord(record, byId);
  if (recordControls.size && [...recordControls].some((id) => auditControls.has(id))) return true;
  const auditRequirements = new Set(audit.requirementIds || []);
  if ((record.requirementIds || []).some((id) => auditRequirements.has(id))) return true;
  const auditControlRecords = [...auditControls].map((id) => byId.get(id)).filter(Boolean);
  const policyIds = new Set(auditControlRecords.flatMap((control) => control.policyIds || []));
  const commitmentIds = new Set(auditControlRecords.flatMap((control) => control.commitmentIds || []));
  const riskIds = new Set(auditControlRecords.flatMap((control) => control.riskIds || []));
  if ((record.type === "policy" && policyIds.has(record.id)) || (record.policyIds || []).some((id) => policyIds.has(id))) return true;
  if ((record.type === "commitment" && commitmentIds.has(record.id)) || (record.commitmentIds || []).some((id) => commitmentIds.has(id))) return true;
  if ((record.type === "risk" && riskIds.has(record.id)) || (record.riskIds || []).some((id) => riskIds.has(id))) return true;
  for (const sourceId of [...(record.sourceResourceIds || []), record.sourceResourceId].filter(Boolean)) {
    if (recordRelevantToAudit(byId.get(sourceId), audit, byId, seen)) return true;
  }
  return false;
}

function expandEvidenceWorkflowContext(selectedIds, byId) {
  const queue = [...selectedIds];
  const childrenBySource = new Map();
  for (const record of byId.values()) {
    if (!["finding", "action-item"].includes(record.type) || !record.sourceResourceId) continue;
    if (!childrenBySource.has(record.sourceResourceId)) childrenBySource.set(record.sourceResourceId, []);
    childrenBySource.get(record.sourceResourceId).push(record.id);
  }
  const enqueue = (ids = []) => {
    for (const id of ids) {
      if (!id || selectedIds.has(id)) continue;
      selectedIds.add(id);
      queue.push(id);
    }
  };
  for (let index = 0; index < queue.length; index += 1) {
    const record = byId.get(queue[index]);
    enqueue(childrenBySource.get(record?.id));
    if (record?.type === "evidence") enqueue([...(record.sourceResourceIds || []), record.sourceSystemId]);
    if (record?.type === "audit-population") enqueue([record.sourceEvidenceId, ...(record.controlIds || [])]);
    if (record?.type === "control-test") enqueue([record.populationId, ...(record.sampleEvidenceIds || [])]);
    if (record?.type === "action-item") {
      enqueue([
        record.sourceResourceId,
        record.obligationId,
        ...(record.completionResourceIds || []),
        ...(record.evidenceIds || [])
      ]);
    }
    if (record?.type === "obligation-event") enqueue(record.obligationIds || []);
  }
}

export async function writeEvidencePacket(input, packet, options = {}) {
  const baseName = `${packet.period.start}-to-${packet.period.end}-${packet.revision.shortCommit || "uncommitted"}`;
  let outputOption = options.output || `.filegrc/evidence-packets/${baseName}`;
  requireDerivedOutputPath(outputOption);
  let output = resolveWorkspacePath(input, outputOption);
  const validation = await validateWorkspace(input);
  if (!validation.ok) throw new Error(`The workspace has ${validation.counts.errors} validation ${validation.counts.errors === 1 ? "error" : "errors"}. Fix them before writing evidence.`);
  await assertPacketSourceState(packet, validation.loaded);
  const entriesById = new Map(validation.loaded.entries.map((entry) => [entry.record.id, entry]));
  const byId = new Map(validation.loaded.resources.map((record) => [record.id, record]));
  const files = [];
  let outputCreated = false;
  try {
    await mkdir(dirname(output), { recursive: true });
    if (options.output) {
      await mkdir(output);
      outputCreated = true;
    } else {
      let suffix = 2;
      while (true) {
        try {
          await mkdir(output);
          outputCreated = true;
          break;
        } catch (error) {
          if (error.code !== "EEXIST") throw error;
          outputOption = `.filegrc/evidence-packets/${baseName}-${suffix++}`;
          output = resolveWorkspacePath(input, outputOption);
        }
      }
    }
    await writePacketFile(output, "manifest.json", `${JSON.stringify(packet, null, 2)}\n`, files);
    await writePacketFile(output, "README.md", packetMarkdown(packet), files);
    await writePacketFile(output, "index.html", packetHtml(packet), files);
    await writePacketFile(output, "control-matrix.csv", controlMatrixCsv(packet), files);
    await writePacketFile(output, "evidence-index.csv", evidenceIndexCsv(packet), files);
    await writePacketFile(output, "source-system-index.csv", sourceSystemIndexCsv(packet), files);
    await writePacketFile(output, "external-evidence-index.csv", externalEvidenceIndexCsv(packet), files);
    await writePacketFile(output, "population-index.csv", populationIndexCsv(packet), files);
    await writePacketFile(output, "HANDLING.md", packetHandlingMarkdown(packet), files);
    for (const item of packet.records) {
      const entry = entriesById.get(item.id);
      if (!entry) continue;
      await writePacketFile(output, join("records", item.type, `${item.id}.json`), entry.source, files);
      for (const markdown of markdownEntries(validation.loaded.model, entry.record)) {
        try {
          await copyPacketFile(
            resolveDataPath(validation.loaded.root, markdown.path),
            output,
            join("content", markdown.path.replace(/^content\//, "")),
            files
          );
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
    }
    for (const item of packet.evidence) {
      const record = byId.get(item.id);
      for (const path of record?.filePaths || []) {
        await copyPacketFile(resolveDataPath(validation.loaded.root, path), output, join("attachments", path), files);
      }
    }
    const historyIndex = [];
    for (const item of packet.records) {
      await exportCommittedVersions(validation.loaded.root, output, item, item.path, item.history, historyIndex, files);
      for (const content of item.contentPaths || []) {
        await exportCommittedVersions(validation.loaded.root, output, item, content.path, content.history, historyIndex, files);
      }
    }
    await writePacketFile(output, "history/index.json", `${JSON.stringify(historyIndex, null, 2)}\n`, files);
    await assertPacketSourceState(packet, validation.loaded);
    await writeChecksums(output, files);
    files.push("SHA256SUMS");
    return { output, files };
  } catch (error) {
    if (outputCreated) await rm(output, { recursive: true, force: true });
    error.message = `Evidence packet generation failed in ${outputOption}. ${error.message}`;
    throw error;
  }
}

export function generateEvidencePacket(input, options = {}) {
  return serializeWorkspaceMutation(input, async (root) => {
    const packet = await prepareEvidencePacket(root, options);
    const written = await writeEvidencePacket(root, packet, { output: options.output });
    return { packet, ...written };
  });
}

async function exportCommittedVersions(root, output, item, sourcePath, history, historyIndex, files) {
  for (const revision of history || []) {
    const source = getFileAtRevision(root, revision.commit, sourcePath);
    if (source === null) continue;
    const exportedPath = join("history", item.type, item.id, revision.commit, basename(sourcePath));
    await writePacketFile(output, exportedPath, source, files);
    historyIndex.push({
      resourceId: item.id,
      resourceType: item.type,
      sourcePath,
      exportedPath: exportedPath.split("\\").join("/"),
      ...revision
    });
  }
}

async function writeChecksums(output, files) {
  const lines = [];
  for (const relativePath of [...files].sort()) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(resolvePacketOutputPath(output, relativePath))) hash.update(chunk);
    lines.push(`${hash.digest("hex")}  ${relativePath}`);
  }
  await writeFile(resolvePacketOutputPath(output, "SHA256SUMS"), `${lines.join("\n")}\n`, { encoding: "utf8", flag: "wx" });
}

function controlMatrixCsv(packet) {
  return csv([
    ["Control ID", "Code", "Control", "Control Statement", "Operating Activity", "Status", "Effective On", "Frequency", "Operation Mode", "System IDs", "Requirement IDs", "Policy IDs", "Risk IDs", "filegrc Evidence IDs", "External Evidence IDs", "Control Test IDs", "Test Outcomes", "Population IDs", "Population Counts", "Sample Sizes", "Exception Counts", "Population Evidence IDs", "Sample Evidence IDs"],
    ...packet.controlCoverage.map((control) => [
      control.id,
      control.code,
      control.title,
      control.statement,
      control.activity,
      control.status,
      control.effectiveOn,
      control.frequency,
      control.operationMode,
      control.systemIds.join("\n"),
      control.requirementIds.join("\n"),
      control.policyIds.join("\n"),
      control.riskIds.join("\n"),
      control.operatingRecordIds.join("\n"),
      control.evidenceIds.join("\n"),
      control.tests.map(({ id }) => id).join("\n"),
      control.tests.map(({ outcome }) => outcome || "").join("\n"),
      control.tests.map(({ populationId }) => populationId || "").join("\n"),
      control.tests.map(({ populationCount }) => populationCount ?? "").join("\n"),
      control.tests.map(({ sampleSize }) => sampleSize ?? "").join("\n"),
      control.tests.map(({ exceptionCount }) => exceptionCount ?? "").join("\n"),
      control.tests.map(({ populationEvidenceId }) => populationEvidenceId || "").join("\n"),
      control.tests.flatMap(({ sampleEvidenceIds }) => sampleEvidenceIds).join("\n")
    ])
  ]);
}

function packetHandlingMarkdown(packet) {
  return [
    "# Packet Handling",
    "",
    `Evidence classifications: ${packet.handling.classifications.join(", ") || "none recorded"}`,
    `External references present: ${packet.handling.containsExternalReferences ? "yes" : "no"}`,
    "Encrypted by filegrc: no",
    "",
    "Review every included record and attachment for secrets, unnecessary personal data, customer data, and material outside the audit scope before transfer.",
    "",
    "Review `external-evidence-index.csv` before delivery. It identifies references that filegrc did not copy. Reconcile those items to the auditor portal or other approved system so the engagement team can confirm it received the same evidence indexed here.",
    "",
    "Transfer this directory through the auditor's approved encrypted channel. Do not email an unencrypted packet. Give access only to the engagement team and retain or remove exported copies under the organization's evidence-retention rules.",
    "",
    "After transfer, enter the packet directory and run `shasum -a 256 -c SHA256SUMS` or `sha256sum -c SHA256SUMS`. filegrc does not sign or encrypt the packet because those operations require organization-controlled keys and transfer-system choices.",
    ""
  ].join("\n");
}

function evidenceIndexCsv(packet) {
  return csv([
    ["Evidence ID", "Evidence", "Status", "Kind", "Source", "Source System ID", "Source System", "Collected On", "Collector IDs", "Verified On", "Verifier IDs", "Period Start", "Period End", "Generated At", "Timezone", "Query or Report Parameters", "Population Count", "Completeness Validation", "Accuracy Validation", "Control IDs", "Source Resource IDs", "Source Commit", "File Paths", "External Reference"],
    ...packet.evidence.map((item) => [
      item.id,
      item.title,
      item.status,
      item.evidenceKind,
      item.source,
      item.sourceSystemId,
      item.sourceSystem,
      item.collectedOn,
      item.collectorIds.join("\n"),
      item.verifiedOn,
      item.verifierIds.join("\n"),
      item.periodStart,
      item.periodEnd,
      item.generatedAt,
      item.timezone,
      item.queryDescription,
      item.populationCount,
      item.completenessValidation,
      item.accuracyValidation,
      item.controlIds.join("\n"),
      item.sourceResourceIds.join("\n"),
      item.sourceCommit,
      item.filePaths.join("\n"),
      item.externalReference ? JSON.stringify(item.externalReference) : ""
    ])
  ]);
}

function sourceSystemIndexCsv(packet) {
  return csv([
    ["System ID", "System", "Status", "Evidence Source Roles", "Evidence Access Owner IDs", "Vendor ID", "In Audit Scope", "Evidence IDs"],
    ...packet.sourceSystems.map((item) => [
      item.id,
      item.title,
      item.status,
      item.evidenceSourceKinds.join("\n"),
      item.evidenceOwnerIds.join("\n"),
      item.vendorId,
      item.inAuditScope ? "yes" : "no",
      item.evidenceIds.join("\n")
    ])
  ]);
}

function externalEvidenceIndexCsv(packet) {
  return csv([
    ["Evidence ID", "Evidence", "Source System ID", "Source System", "Control IDs", "External Reference", "Fixed Attachment Included", "Delivery Note"],
    ...packet.evidence
      .filter((item) => item.externalReference)
      .map((item) => [
        item.id,
        item.title,
        item.sourceSystemId,
        item.sourceSystem,
        item.controlIds.join("\n"),
        JSON.stringify(item.externalReference),
        item.filePaths.length ? "yes" : "no",
        item.filePaths.length
          ? "A fixed attachment is included; confirm it matches the external source."
          : "Deliver through the auditor-approved external system and reconcile receipt to this reference."
      ])
  ]);
}

function populationIndexCsv(packet) {
  return csv([
    ["Population ID", "Population", "Kind", "Status", "Period Start", "Period End", "Source System ID", "Source System", "Authoritative Source", "Query or Report Parameters", "Timezone", "Generated At", "Record Count", "Completeness Validation", "Accuracy Validation", "Reconciled By", "Reconciled On", "Conclusion", "Control IDs", "Evidence ID", "Not Applicable Reason"],
    ...packet.populations.map((item) => [
      item.id,
      item.title,
      item.populationKind,
      item.status,
      item.periodStart,
      item.periodEnd,
      item.sourceSystemId,
      item.sourceSystem,
      item.source,
      item.queryDescription,
      item.timezone,
      item.generatedAt,
      item.populationCount,
      item.completenessValidation,
      item.accuracyValidation,
      item.reconciledByIds.join("\n"),
      item.reconciledOn,
      item.conclusion,
      item.controlIds.join("\n"),
      item.sourceEvidenceId,
      item.notApplicableReason
    ])
  ]);
}

function csv(rows) {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function csvCell(value) {
  const source = String(value ?? "");
  const safe = /^[\t\r ]*[=+\-@]/.test(source) ? `'${source}` : source;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function requireDerivedOutputPath(value) {
  const segments = typeof value === "string" ? value.split("/") : [];
  if (
    segments.length < 2
    || segments[0] !== ".filegrc"
    || segments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("\\") || segment.includes("\0"))
  ) {
    throw new Error("Evidence packet output must be a directory under .filegrc/.");
  }
}

async function assertPacketSourceState(packet, loaded) {
  await assertLoadedEntriesCurrent(loaded);
  const dataDigest = await dataTreeDigest(loaded.root);
  const git = getGitSummary(loaded.root);
  if (
    packet.revision?.dataDigest !== dataDigest
    || packet.revision?.commit !== git.commit
    || packet.revision?.branch !== git.branch
  ) {
    throw new Error("The workspace source changed after this packet was prepared. Prepare the packet again.");
  }
}

async function assertLoadedEntriesCurrent(loaded) {
  for (const entry of loaded.entries) {
    const source = await readFile(resolveDataPath(loaded.root, entry.relativePath), "utf8");
    if (source !== entry.source) {
      throw new Error(`The workspace source changed while the evidence packet was being prepared: ${entry.relativePath}. Try again.`);
    }
  }
}

async function dataTreeDigest(root) {
  const hash = createHash("sha256");
  updateDigestField(hash, "filegrc-data-tree-v1");
  const visit = async (directory, prefix = "") => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        updateDigestField(hash, "directory");
        updateDigestField(hash, relativePath);
        await visit(path, relativePath);
      } else if (entry.isFile()) {
        const fileHash = createHash("sha256");
        for await (const chunk of createReadStream(path)) fileHash.update(chunk);
        updateDigestField(hash, "file");
        updateDigestField(hash, relativePath);
        updateDigestField(hash, fileHash.digest("hex"));
      } else if (entry.isSymbolicLink()) {
        updateDigestField(hash, "symlink");
        updateDigestField(hash, relativePath);
        updateDigestField(hash, await readlink(path));
      } else {
        updateDigestField(hash, "other");
        updateDigestField(hash, relativePath);
      }
    }
  };
  await visit(resolveDataPath(root, "."));
  return `sha256:${hash.digest("hex")}`;
}

function updateDigestField(hash, value) {
  const bytes = Buffer.from(String(value));
  hash.update(`${bytes.length}:`);
  hash.update(bytes);
}

function packetRecord(record, model, start, end, timezone) {
  const definition = model.resources[record.type];
  if (!definition) return null;
  const fields = { ...model.commonFields, ...definition.fields };
  const dates = [];
  for (const [name, field] of Object.entries(fields)) {
    const value = record[name];
    if (field.type === "date" && parseCalendarDate(value) && value >= start && value <= end) {
      dates.push({ field: name, value });
    }
    if (field.type === "timestamp" && typeof value === "string") {
      const date = timestampDate(value, timezone);
      if (date && date >= start && date <= end) dates.push({ field: name, value, date });
    }
  }
  const overlaps = parseCalendarDate(record.periodStart)
    && parseCalendarDate(record.periodEnd)
    && record.periodStart <= end
    && record.periodEnd >= start;
  if (!dates.length && !overlaps) return null;
  dates.sort((a, b) => (a.date || a.value).localeCompare(b.date || b.value) || a.field.localeCompare(b.field));
  return {
    id: record.id,
    type: record.type,
    title: record.title,
    primaryDate: dates[0]?.date || dates[0]?.value || record.periodStart,
    dates,
    ...(overlaps ? { period: { start: record.periodStart, end: record.periodEnd } } : {})
  };
}

function timestampDate(value, timezone) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(parsed);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return parsed.toISOString().slice(0, 10);
  }
}

function buildControlCoverage({ audit, byId, controlIds, evidenceIds, model, records, start, end, timezone }) {
  const evidenceByControl = new Map([...controlIds].map((id) => [id, new Set()]));
  for (const evidenceId of evidenceIds) {
    const evidenceRecord = byId.get(evidenceId);
    const linkedControlIds = controlIdsForRecord(evidenceRecord, byId);
    for (const record of records) {
      if ((record.evidenceIds || []).includes(evidenceId)) addIds(linkedControlIds, controlIdsForRecord(record, byId));
    }
    for (const controlId of linkedControlIds) evidenceByControl.get(controlId)?.add(evidenceId);
  }
  return [...controlIds].map((controlId) => {
    const control = byId.get(controlId);
    const tests = records
      .filter((record) => record.type === "control-test" && record.controlId === controlId)
      .filter((record) => (
        record.auditId === audit?.id
        || (!record.auditId && record.periodStart && record.periodEnd && record.periodStart <= end && record.periodEnd >= start)
        || (!record.auditId && record.asOfDate >= start && record.asOfDate <= end)
      ));
    const operatingRecords = records.filter((record) => (
      !NON_EVIDENCE_RECORD_TYPES.has(record.type)
      && controlIdsForRecord(record, byId).has(controlId)
      && packetRecord(record, model, start, end, timezone)
    ));
    const linkedEvidenceIds = new Set(evidenceByControl.get(controlId) || []);
    for (const test of tests) {
      addIds(linkedEvidenceIds, test.evidenceIds);
      addIds(linkedEvidenceIds, test.sampleEvidenceIds);
      const population = byId.get(test.populationId);
      if (population?.sourceEvidenceId) linkedEvidenceIds.add(population.sourceEvidenceId);
    }
    return {
      id: controlId,
      code: control?.code || "",
      title: control?.title || controlId,
      statement: control?.statement || "",
      activity: control?.activity || "",
      status: control?.status || "missing",
      effectiveOn: control?.effectiveOn || null,
      frequency: control?.frequency || "",
      operationMode: control?.operationMode || "",
      requirementIds: control?.requirementIds || [],
      policyIds: control?.policyIds || [],
      systemIds: control?.systemIds || [],
      riskIds: control?.riskIds || [],
      evidenceIds: [...linkedEvidenceIds].sort(),
      operatingRecordIds: operatingRecords.map(({ id }) => id).sort(),
      tests: tests.map((test) => ({
        ...testPopulationSummary(test, byId),
        id: test.id,
        status: test.status,
        outcome: test.outcome || null,
        periodStart: test.periodStart || null,
        periodEnd: test.periodEnd || null,
        asOfDate: test.asOfDate || null,
        sampleSize: test.sampleSize ?? null,
        sampleEvidenceIds: test.sampleEvidenceIds || [],
        exceptionCount: test.exceptionCount ?? null
      }))
    };
  }).sort((a, b) => a.code.localeCompare(b.code) || a.title.localeCompare(b.title));
}

function controlIdsForRecord(record, byId, seen = new Set()) {
  const ids = new Set();
  if (!record || seen.has(record.id)) return ids;
  seen.add(record.id);
  if (record.type === "control") ids.add(record.id);
  addIds(ids, record.controlIds);
  if (record.type === "complementary-control") addIds(ids, record.relatedControlIds);
  if (record.controlId) ids.add(record.controlId);
  for (const sourceId of record.sourceResourceIds || []) addIds(ids, controlIdsForRecord(byId.get(sourceId), byId, seen));
  if (record.sourceResourceId) addIds(ids, controlIdsForRecord(byId.get(record.sourceResourceId), byId, seen));
  if (record.obligationId) addIds(ids, byId.get(record.obligationId)?.controlIds);
  return ids;
}

function packetGaps({
  audit,
  byId,
  obligations,
  eventRuns,
  evidence,
  git,
  start,
  end,
  controlCoverage,
  requirementIds,
  records,
  populations,
  model,
  managementPreparation
}) {
  const gaps = [];
  if (!git.commit) gaps.push(gap("error", "uncommitted-workspace", "The workspace has no Git revision to bind this packet to."));
  else if (!git.clean) gaps.push(gap("error", "dirty-workspace", "Commit or discard workspace changes before treating this packet as audit evidence."));

  if (!audit) {
    gaps.push(gap("error", "missing-audit-scope", "Select an audit record before treating this packet as an auditor delivery."));
  } else {
    auditGaps(gaps, audit, byId, records, start, end);
  }
  for (const stage of managementPreparation?.stages || []) {
    for (const item of stage.items.filter((entry) => ["action", "later"].includes(entry.status))) {
      gaps.push(gap(
        "error",
        `management-${stage.id}-${item.id}`,
        item.status === "later" ? `${item.message} Complete this work before delivering the packet.` : item.message,
        item.resourceId || audit?.id
      ));
    }
  }

  for (const coverage of controlCoverage) {
    const control = byId.get(coverage.id);
    if (coverage.status !== "implemented") {
      gaps.push(gap("error", "control-not-implemented", `${coverage.code || coverage.title} is ${coverage.status}, not implemented.`, coverage.id));
    }
    if (coverage.status === "implemented" && (!coverage.effectiveOn || coverage.effectiveOn > start)) {
      gaps.push(gap("error", "control-not-effective-for-period", `${coverage.code || coverage.title} does not have an effective date on or before ${start}.`, coverage.id));
    }
    if (!(coverage.systemIds || []).length && audit?.systemIds?.length) {
      gaps.push(gap("error", "control-missing-system-scope", `${coverage.code || coverage.title} is not linked to an in-scope system.`, coverage.id));
    } else if (audit?.systemIds?.length && !coverage.systemIds.some((id) => audit.systemIds.includes(id))) {
      gaps.push(gap("error", "control-outside-audit-system-scope", `${coverage.code || coverage.title} is not linked to a system selected by the audit.`, coverage.id));
    }
    if (!(coverage.policyIds || []).length) {
      gaps.push(gap("error", "control-missing-policy", `${coverage.code || coverage.title} is not linked to a policy.`, coverage.id));
    } else {
      for (const policyId of coverage.policyIds) {
        const policy = byId.get(policyId);
        if (!policy) continue;
        if (!policyCoversPeriod(policy, start, end, byId)) {
          gaps.push(gap("error", "policy-not-effective-for-period", `${policy.title} does not show approved policy coverage for the full packet period.`, policy.id));
        }
      }
    }
    if (controlNeedsExternalEvidence(control, model) && !coverage.evidenceIds.length) {
      gaps.push(gap("error", "control-missing-external-evidence", `${coverage.code || coverage.title} relies on an external system but has no linked External Evidence in the packet.`, coverage.id));
    } else if (!controlNeedsExternalEvidence(control, model) && !coverage.operatingRecordIds.length) {
      gaps.push(gap("error", "control-missing-filegrc-evidence", `${coverage.code || coverage.title} has no dated filegrc operating record in the packet.`, coverage.id));
    }
    if (audit?.auditKind !== "soc-2-type-1" && coverage.status === "implemented" && !coverage.operatingRecordIds.length && coverage.operationMode !== "automated") {
      gaps.push(gap("warning", "control-missing-operating-record", `${coverage.code || coverage.title} has no dated operating record in the packet period.`, coverage.id));
    }
    for (const test of coverage.tests) {
      const testRecord = byId.get(test.id);
      if (test.status !== "complete") {
        gaps.push(gap("warning", "incomplete-control-test", `${coverage.code || coverage.title} has an audit-period control test that is ${test.status}.`, test.id));
        continue;
      }
      if (!testRecord?.completedOn) {
        gaps.push(gap("error", "control-test-completion-date-missing", `${coverage.code || coverage.title} has a completed test without a completion date.`, test.id));
      }
      if (!(testRecord?.testerIds || []).length && !testRecord?.externalTester) {
        gaps.push(gap("error", "control-test-tester-missing", `${coverage.code || coverage.title} has a completed test without an identified tester.`, test.id));
      }
      if (testRecord?.reviewedOn && testRecord?.completedOn && testRecord.reviewedOn < testRecord.completedOn) {
        gaps.push(gap("error", "control-test-review-sequence-invalid", `${coverage.code || coverage.title} records review before test completion.`, test.id));
      }
      if (Number.isInteger(testRecord?.sampleSize) && testRecord.sampleSize < 0) {
        gaps.push(gap("error", "control-test-sample-size-invalid", `${coverage.code || coverage.title} records a negative sample size.`, test.id));
      }
      if (Number.isInteger(testRecord?.exceptionCount) && testRecord.exceptionCount < 0) {
        gaps.push(gap("error", "control-test-exception-count-invalid", `${coverage.code || coverage.title} records a negative exception count.`, test.id));
      }
      const testFindings = records.filter((record) => record.type === "finding" && record.sourceResourceId === test.id);
      if ((testRecord?.exceptionCount > 0 || ["failed", "passed-with-exceptions"].includes(test.outcome)) && !testFindings.length) {
        gaps.push(gap("error", "control-test-finding-missing", `${coverage.code || coverage.title} records exceptions or failure without a linked finding.`, test.id));
      }
      const samplingTest = Number.isInteger(test.sampleSize) && test.sampleSize > 0;
      if (samplingTest && !test.populationId) {
        gaps.push(gap("warning", "undocumented-test-population", `${coverage.code || coverage.title} does not link the population from which samples were selected.`, test.id));
      } else if (test.populationId && !test.populationEvidenceId) {
        gaps.push(gap("error", "missing-test-population", `${coverage.code || coverage.title} links a population without a fixed population export.`, test.id));
      }
      if (Number.isInteger(test.sampleSize) && test.sampleSize > 0 && !test.sampleEvidenceIds.length) {
        gaps.push(gap("error", "missing-test-samples", `${coverage.code || coverage.title} records a sample of ${test.sampleSize} without item-level sample evidence.`, test.id));
      }
      if (Number.isInteger(test.populationCount) && Number.isInteger(test.sampleSize) && test.sampleSize > test.populationCount) {
        gaps.push(gap("error", "sample-exceeds-population", `${coverage.code || coverage.title} records a sample larger than its population.`, test.id));
      }
    }
    if (control && !(control.requirementIds || []).length) {
      gaps.push(gap("error", "control-missing-requirement", `${coverage.code || coverage.title} is not mapped to an applicable criterion.`, coverage.id));
    }
  }

  for (const requirementId of requirementIds) {
    const requirement = byId.get(requirementId);
    if (!requirement || requirement.applicability !== "applicable" || isDescriptionRequirement(requirement)) continue;
    const mapped = controlCoverage.some((coverage) => coverage.requirementIds.includes(requirementId));
    if (!mapped) gaps.push(gap("error", "requirement-missing-control", `${requirement.reference || requirement.title} has no control in the packet.`, requirementId));
  }

  if (audit) {
    if (audit.auditKind === "soc-2-type-2") populationGaps(gaps, audit, populations, byId, model);
    for (const systemId of audit.systemIds || []) {
      const system = byId.get(systemId);
      if (!system) continue;
      const commitmentIds = new Set(system.commitmentIds || []);
      for (const record of records) {
        if (record.type === "commitment" && (record.systemIds || []).includes(systemId) && record.status === "active") commitmentIds.add(record.id);
      }
      if (!commitmentIds.size) {
        gaps.push(gap("error", "system-missing-commitments", `${system.title} has no active service commitment or system requirement.`, system.id));
      }
    }
    const recentAssessment = records.some((record) => (
      record.type === "risk-assessment"
      && record.status === "complete"
      && record.assessmentDate <= end
      && record.assessmentDate >= shiftYear(end, -1)
      && (!(audit.systemIds || []).length || !(record.systemIds || []).length || record.systemIds.some((id) => audit.systemIds.includes(id)))
    ));
    if (!recentAssessment) {
      gaps.push(gap("error", "missing-risk-assessment", `No completed in-scope risk assessment was found in the year ending ${end}.`, audit.id));
    }
    for (const vendorId of audit.subserviceVendorIds || []) {
      const vendor = byId.get(vendorId);
      if (!vendor) continue;
      if (vendor.status !== "active") {
        gaps.push(gap("error", "inactive-subservice-organization", `${vendor.title} is in audit scope but is ${vendor.status}.`, vendor.id));
      }
      const reviews = records.filter((record) => (
        record.type === "vendor-review"
        && (record.vendorIds || []).includes(vendorId)
        && ["approved", "conditional", "complete"].includes(record.status)
        && record.reviewedOn <= end
        && record.reviewedOn >= shiftYear(end, -1)
      ));
      if (!reviews.length) {
        gaps.push(gap("error", "missing-subservice-review", `${vendor.title} has no completed review in the year ending ${end}.`, vendor.id));
      }
      const vendorEvidence = evidence.filter((item) => (
        item.sourceResourceIds.includes(vendorId)
        || reviews.some((review) => item.sourceResourceIds.includes(review.id) || (review.evidenceIds || []).includes(item.id))
      ));
      if (!vendorEvidence.length) {
        gaps.push(gap("error", "missing-subservice-evidence", `${vendor.title} has no linked assurance evidence, such as its report and applicable bridge coverage.`, vendor.id));
      } else {
        const assuranceReports = vendorEvidence.filter((item) => /soc|assurance|vendor-report/i.test(item.evidenceKind));
        if (!assuranceReports.length) {
          gaps.push(gap("error", "missing-subservice-assurance-report", `${vendor.title} has linked evidence but no item identified as a SOC or other assurance report.`, vendor.id));
        } else if (assuranceReports.every((item) => !item.periodEnd)) {
          gaps.push(gap("error", "subservice-report-period-missing", `${vendor.title}'s assurance evidence does not record the report coverage period.`, vendor.id));
        } else {
          const latestCoverage = assuranceReports.map((item) => item.periodEnd).filter(Boolean).sort().at(-1);
          const bridgeEvidence = vendorEvidence.some((item) => (
            /bridge/i.test(item.evidenceKind)
            && ((item.periodEnd && item.periodEnd >= end) || item.collectedOn >= end)
          ));
          if (latestCoverage && latestCoverage < end && !bridgeEvidence) {
            gaps.push(gap("error", "subservice-bridge-coverage-missing", `${vendor.title}'s assurance report ends ${latestCoverage}, before the engagement date or period ends ${end}, and no bridge coverage is linked.`, vendor.id));
          }
        }
      }
      const complementary = records.some((record) => (
        record.type === "complementary-control"
        && record.responsibleParty === "subservice-organization"
        && record.vendorId === vendorId
        && record.status === "active"
      ));
      if (!complementary) {
        gaps.push(gap("error", "missing-subservice-complementary-controls", `${vendor.title} has no active complementary subservice controls.`, vendor.id));
      }
    }
  }

  for (const item of obligations) {
    if (item.dueWindowEnd <= end && item.status !== "complete") {
      gaps.push(gap("error", "missing-obligation-completion", `${item.title} has no linked completion in ${item.dueWindowStart} through ${item.dueWindowEnd}.`, item.obligationId));
    }
  }
  for (const run of eventRuns) {
    if (run.status === "canceled") continue;
    for (const action of run.actions) {
      if (action.canceledAction) {
        gaps.push(gap(
          "error",
          "canceled-event-action",
          `${run.title}: ${action.title} was canceled. Complete the requirement or cancel the event with a documented reason.`,
          action.actionItemId
        ));
      } else if (action.missingCompletion) {
        gaps.push(gap(
          "error",
          "missing-event-completion",
          `${run.title}: ${action.title} is marked ${action.recordedStatus} but has no linked ${action.expectedCompletionTypes.join(" or ")} completion record.`,
          action.actionItemId
        ));
      } else if (action.dueWindowEnd && action.dueWindowEnd <= end && action.status !== "complete") {
        const cutoff = action.dueWindowEndAt || action.dueWindowEnd;
        gaps.push(gap("error", "incomplete-event-action", `${run.title}: ${action.title} was not completed by ${cutoff}.`, action.actionItemId));
      }
    }
  }
  for (const item of evidence) {
    if (item.evidenceKind === "rendered-record" && !item.sourceCommit) {
      gaps.push(gap("error", "unbound-rendered-evidence", `${item.title} does not name the Git revision that was rendered.`, item.id));
    } else if (item.sourceCommit && !item.sourceCommitValid) {
      gaps.push(gap("error", "invalid-evidence-revision", `${item.title} names a source Git revision that is not available in this repository.`, item.id));
    }
    if (item.status !== "verified") gaps.push(gap("error", "unverified-evidence", `${item.title} is ${item.status}, not verified.`, item.id));
    if (!item.collectorIds.length) gaps.push(gap("error", "evidence-collector-missing", `${item.title} does not identify who collected it.`, item.id));
    if (item.status === "verified" && (!item.verifierIds.length || !item.verifiedOn)) {
      gaps.push(gap("error", "evidence-verification-missing", `${item.title} is marked verified without a verifier and verification date.`, item.id));
    }
    if (item.verifiedOn && item.collectedOn && item.verifiedOn < item.collectedOn) {
      gaps.push(gap("error", "evidence-verification-sequence-invalid", `${item.title} was verified before it was collected.`, item.id));
    }
    const hasManagementPurpose = item.auditIds.includes(audit?.id)
      || item.sourceResourceIds.some((id) => ["audit", "document", "vendor", "vendor-review"].includes(byId.get(id)?.type));
    if (!item.controlIds.length && !hasManagementPurpose) {
      gaps.push(gap("warning", "evidence-missing-control-link", `${item.title} does not resolve to a control or another scoped management purpose.`, item.id));
    }
    if (item.controlIds.length && !evidenceCoversPacketDate(item, audit, start, end)) {
      const dateLabel = audit?.auditKind === "soc-2-type-1" ? `the ${start} as-of date` : `${start} through ${end}`;
      gaps.push(gap("error", "evidence-outside-engagement-date", `${item.title} is linked to a control but does not cover ${dateLabel}.`, item.id));
    }
    if (item.sourceSystemId) {
      const sourceSystem = byId.get(item.sourceSystemId);
      if (!sourceSystem || sourceSystem.type !== "system") {
        gaps.push(gap("error", "evidence-source-system-missing", `${item.title} does not resolve to a cataloged source system.`, item.id));
      } else {
        if (!["active", "deprecated"].includes(sourceSystem.status)) {
          gaps.push(gap("warning", "evidence-source-system-inactive", `${item.title} came from ${sourceSystem.title}, which is ${sourceSystem.status}. Confirm that this was the authoritative source when the evidence was generated.`, item.id));
        }
        if (!(sourceSystem.evidenceSourceKinds || []).length) {
          gaps.push(gap("warning", "evidence-source-role-missing", `${sourceSystem.title} has no evidence source role. Record what authoritative reports or records it supplies and keep extraction instructions in its Record Markdown.`, sourceSystem.id));
        }
      }
    } else if (["population-export", "system-export", "configuration-export"].includes(item.evidenceKind)) {
      gaps.push(gap("error", "evidence-source-system-unrecorded", `${item.title} is a source-system export but does not link the cataloged system of record.`, item.id));
    }
    if (item.externalReference && !item.filePaths.length) {
      gaps.push(gap("warning", "external-only-evidence", `${item.title} relies on an external reference and is not self-contained in the packet.`, item.id));
    }
    if (item.evidenceKind === "rendered-record") {
      const captureComplete = item.capture
        && typeof item.capture.route === "string"
        && item.capture.route.trim()
        && item.capture.filters
        && typeof item.capture.filters === "object"
        && !Array.isArray(item.capture.filters)
        && typeof item.capture.periodStart === "string"
        && typeof item.capture.periodEnd === "string"
        && typeof item.capture.capturedAt === "string"
        && typeof item.capture.method === "string"
        && item.capture.method.trim();
      if (!captureComplete) {
        gaps.push(gap("error", "missing-render-capture-context", `${item.title} does not record its route, filters, period, capture time, and method.`, item.id));
      }
    }
    if (item.evidenceKind === "population-export") {
      for (const [field, label] of [
        ["generatedAt", "generation time"],
        ["timezone", "report timezone"],
        ["queryDescription", "query or report parameters"],
        ["populationCount", "population count"],
        ["completenessValidation", "completeness validation"],
        ["accuracyValidation", "accuracy validation"]
      ]) {
        if (item[field] === undefined || item[field] === null || item[field] === "") {
          gaps.push(gap("error", `population-missing-${field}`, `${item.title} is missing its ${label}.`, item.id));
        }
      }
      if (item.populationCount !== null && (!Number.isInteger(item.populationCount) || item.populationCount < 0)) {
        gaps.push(gap("error", "population-count-invalid", `${item.title} must record a non-negative whole-number population count.`, item.id));
      }
      const generatedOn = timestampDate(item.generatedAt, item.timezone);
      if (generatedOn && generatedOn <= end) {
        gaps.push(gap("error", "population-generated-before-period-end", `${item.title} was generated before the audit period ended, so it cannot prove the complete period population.`, item.id));
      }
    }
  }
  if (!evidence.length) gaps.push(gap("error", "missing-evidence", "The packet contains no evidence records."));

  return deduplicateGaps(gaps);
}

function controlNeedsExternalEvidence(control, model) {
  const families = (model.evidenceSourceFamilies || []).filter((family) => (
    (family.controlCodes || []).includes(control?.code)
  ));
  return !families.length || families.some((family) => family.collectionTestRequired !== false);
}

function auditGaps(gaps, audit, byId, records, start, end) {
  if (!["soc-2-type-1", "soc-2-type-2"].includes(audit.auditKind)) {
    gaps.push(gap("error", "not-soc2-examination", `${audit.title} is ${audit.auditKind}; a delivery packet requires a SOC 2 Type 1 or Type 2 engagement.`, audit.id));
  } else if (audit.auditKind === "soc-2-type-1") {
    if (!audit.typeOneAsOf) {
      gaps.push(gap("error", "audit-as-of-date-missing", `${audit.title} does not define a Type 1 as-of date.`, audit.id));
    } else if (start !== audit.typeOneAsOf || end !== audit.typeOneAsOf) {
      gaps.push(gap("error", "packet-date-mismatch", `Packet date ${start}${end !== start ? ` through ${end}` : ""} does not match the selected Type 1 as-of date ${audit.typeOneAsOf}.`, audit.id));
    }
  } else if (!audit.periodStart || !audit.periodEnd) {
    gaps.push(gap("error", "audit-period-missing", `${audit.title} does not define a Type 2 examination period.`, audit.id));
  } else if (audit.periodStart !== start || audit.periodEnd !== end) {
    gaps.push(gap("error", "packet-period-mismatch", `Packet dates ${start} through ${end} do not match the selected audit period ${audit.periodStart} through ${audit.periodEnd}.`, audit.id));
  }
  if (!(audit.systemIds || []).length) gaps.push(gap("error", "audit-systems-missing", `${audit.title} has no in-scope systems.`, audit.id));
  if (!(audit.requirementIds || []).length) gaps.push(gap("error", "audit-requirements-missing", `${audit.title} has no selected criteria.`, audit.id));
  if (!(audit.controlIds || []).length) gaps.push(gap("error", "audit-controls-missing", `${audit.title} has no selected controls.`, audit.id));
  const selectedRequirements = (audit.requirementIds || []).map((id) => byId.get(id)).filter(Boolean);
  if (!selectedRequirements.some(isDescriptionRequirement)) {
    gaps.push(gap("error", "audit-description-criteria-missing", `${audit.title} does not include the SOC 2 description criteria.`, audit.id));
  }
  for (const requirement of selectedRequirements) {
    if (!(audit.frameworkIds || []).includes(requirement.frameworkId) || requirement.applicability !== "applicable") {
      gaps.push(gap("error", "audit-criteria-scope-conflict", `${requirement.reference || requirement.title} is selected but is not an applicable member of the selected frameworks.`, requirement.id));
    }
  }
  if (!audit.auditor && !audit.auditorVendorId) gaps.push(gap("error", "auditor-missing", `${audit.title} does not identify the independent CPA firm.`, audit.id));
  if (!audit.subserviceMethod) gaps.push(gap("error", "subservice-method-missing", `${audit.title} does not state whether subservice organizations use the carve-out or inclusive method, or are not applicable.`, audit.id));
  if ((audit.subserviceVendorIds || []).length && audit.subserviceMethod === "not-applicable") {
    gaps.push(gap("error", "subservice-scope-conflict", `${audit.title} names subservice organizations but marks their treatment not applicable.`, audit.id));
  }
  const expectedSubserviceVendorIds = new Set((audit.systemIds || []).flatMap((id) => byId.get(id)?.subserviceVendorIds || []));
  for (const vendorId of expectedSubserviceVendorIds) {
    if (!(audit.subserviceVendorIds || []).includes(vendorId)) {
      gaps.push(gap("error", "subservice-organization-omitted", `${byId.get(vendorId)?.title || vendorId} is identified by an in-scope system but omitted from the engagement's subservice organizations.`, vendorId));
    }
  }
  if (audit.subserviceMethod === "inclusive") {
    const subserviceSystemIds = records
      .filter((record) => record.type === "system" && (audit.subserviceVendorIds || []).includes(record.vendorId))
      .map((record) => record.id);
    const includedControls = (audit.controlIds || [])
      .map((id) => byId.get(id))
      .filter((control) => (control?.systemIds || []).some((id) => subserviceSystemIds.includes(id)));
    if (!subserviceSystemIds.length || !includedControls.length) {
      gaps.push(gap("error", "inclusive-subservice-controls-missing", `${audit.title} uses the inclusive method but does not include cataloged subservice systems and their controls.`, audit.id));
    }
  }
  if (!audit.complementaryControlsConclusion) {
    gaps.push(gap("error", "complementary-controls-conclusion-missing", `${audit.title} does not state whether complementary customer or subservice controls apply.`, audit.id));
  } else if (audit.complementaryControlsConclusion === "identified" && !(audit.complementaryControlIds || []).length) {
    gaps.push(gap("error", "complementary-controls-missing", `${audit.title} says complementary controls were identified but does not select them.`, audit.id));
  } else if (audit.complementaryControlsConclusion === "not-applicable") {
    const relevant = records.some((record) => (
      record.type === "complementary-control"
      && record.status === "active"
      && (record.systemIds || []).some((id) => (audit.systemIds || []).includes(id))
    ));
    if (relevant) {
      gaps.push(gap("error", "complementary-controls-scope-conflict", `${audit.title} marks complementary controls not applicable even though active complementary controls are linked to in-scope systems.`, audit.id));
    }
  }
  const requiredDocuments = [
    ["systemDescriptionDocumentId", "management's system description"],
    ["managementAssertionDocumentId", "management's assertion"],
    ["managementRepresentationDocumentId", "management representation letter"]
  ];
  if (audit.auditKind === "soc-2-type-2") {
    requiredDocuments.splice(2, 0, ["periodCompletenessDocumentId", "period completeness statement"]);
  }
  for (const [field, label] of requiredDocuments) {
    const documentId = audit[field];
    if (!documentId) {
      gaps.push(gap("error", `missing-${field}`, `${audit.title} does not link ${label}.`, audit.id));
      continue;
    }
    const document = byId.get(documentId);
    if (!document || document.type !== "document") continue;
    if (document.status !== "active" || !document.approvedOn || !document.effectiveOn) {
      gaps.push(gap("error", `unapproved-${field}`, `${document.title} is not active with approval and effective dates.`, document.id));
    }
  }
  if (audit.status === "complete") {
    const representation = byId.get(audit.managementRepresentationDocumentId);
    if (!(representation?.evidenceIds || []).length) {
      gaps.push(gap("error", "unsigned-management-representation", `${representation?.title || audit.title} does not link the signed representation letter evidence.`, representation?.id || audit.id));
    }
    if (!audit.reportEvidenceId) gaps.push(gap("error", "missing-audit-report", `${audit.title} does not link the final service auditor report.`, audit.id));
    if (!audit.opinion || audit.opinion === "not-issued" || !audit.opinionDate) {
      gaps.push(gap("error", "missing-audit-opinion", `${audit.title} does not record the issued opinion and opinion date.`, audit.id));
    }
    for (const request of records.filter((record) => record.type === "audit-request" && record.auditId === audit.id)) {
      if (!["accepted", "closed"].includes(request.status)) {
        gaps.push(gap("error", "open-final-audit-request", `${request.title} is ${request.status} after the audit was marked complete.`, request.id));
      }
    }
  }
}

function policyCoversPeriod(policy, start, end, byId, seen = new Set()) {
  if (seen.has(policy.id)) return false;
  seen.add(policy.id);
  if (!["approved", "active", "superseded"].includes(policy.status) || !policy.approvedOn || !policy.effectiveOn) return false;
  const predecessor = policy.supersedesId ? byId.get(policy.supersedesId) : null;
  if (policy.effectiveOn > end) {
    return predecessor?.type === "policy" ? policyCoversPeriod(predecessor, start, end, byId, seen) : false;
  }
  if (policy.effectiveOn <= start) return true;
  return predecessor?.type === "policy" ? policyCoversPeriod(predecessor, start, policy.effectiveOn, byId, seen) : false;
}

function isDescriptionRequirement(requirement) {
  return (requirement.tags || []).includes("description-criteria") || /^DC\d+/i.test(requirement.reference || "");
}

function shiftYear(value, offset) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() + offset);
  return date.toISOString().slice(0, 10);
}

function evidenceSummary(record, byId, revisionIsValid) {
  if (!record || record.type !== "evidence") return null;
  return {
    id: record.id,
    title: record.title,
    status: record.status,
    evidenceKind: record.evidenceKind,
    source: record.source,
    collectedOn: record.collectedOn,
    periodStart: record.periodStart,
    periodEnd: record.periodEnd,
    classification: record.classification,
    generatedAt: record.generatedAt || null,
    timezone: record.timezone || null,
    queryDescription: record.queryDescription || null,
    populationCount: record.populationCount ?? null,
    completenessValidation: record.completenessValidation || null,
    accuracyValidation: record.accuracyValidation || null,
    capture: record.capture || null,
    sourceSystemId: record.sourceSystemId || null,
    sourceSystem: byId.get(record.sourceSystemId)?.title || null,
    collectorIds: record.collectorIds || [],
    verifierIds: record.verifierIds || [],
    verifiedOn: record.verifiedOn || null,
    sourceCommit: record.sourceCommit,
    sourceCommitValid: record.sourceCommit ? revisionIsValid(record.sourceCommit) : false,
    auditIds: record.auditIds || [],
    sourceResourceIds: record.sourceResourceIds || [],
    controlIds: [...controlIdsForRecord(record, byId)].sort(),
    filePaths: record.filePaths || [],
    externalReference: record.externalReference || null
  };
}

function populationSummary(record, byId) {
  const evidence = byId.get(record.sourceEvidenceId);
  const sourceSystemId = record.sourceSystemId || evidence?.sourceSystemId || null;
  return {
    id: record.id,
    title: record.title,
    status: record.status,
    auditId: record.auditId,
    populationKind: record.populationKind,
    periodStart: record.periodStart,
    periodEnd: record.periodEnd,
    controlIds: record.controlIds || [],
    sourceSystemId,
    sourceSystem: byId.get(sourceSystemId)?.title || null,
    sourceEvidenceId: record.sourceEvidenceId || null,
    source: evidence?.source || null,
    populationCount: evidence?.populationCount ?? null,
    queryDescription: evidence?.queryDescription || null,
    timezone: evidence?.timezone || null,
    generatedAt: evidence?.generatedAt || null,
    completenessValidation: evidence?.completenessValidation || null,
    accuracyValidation: evidence?.accuracyValidation || null,
    reconciledByIds: record.reconciledByIds || [],
    reconciledOn: record.reconciledOn || null,
    conclusion: record.conclusion || null,
    notApplicableReason: record.notApplicableReason || null
  };
}

function sourceSystemSummary(record, evidence, audit) {
  if (!record || record.type !== "system") return null;
  return {
    id: record.id,
    title: record.title,
    status: record.status,
    evidenceSourceKinds: record.evidenceSourceKinds || [],
    evidenceOwnerIds: record.evidenceOwnerIds || [],
    vendorId: record.vendorId || null,
    inAuditScope: (audit?.systemIds || []).includes(record.id),
    evidenceIds: evidence.filter((item) => item.sourceSystemId === record.id).map((item) => item.id)
  };
}

function testPopulationSummary(test, byId) {
  const population = byId.get(test.populationId);
  const evidence = byId.get(population?.sourceEvidenceId);
  return {
    populationId: test.populationId || null,
    populationCount: evidence?.populationCount ?? null,
    populationEvidenceId: population?.sourceEvidenceId || null
  };
}

function populationGaps(gaps, audit, populations, byId, model) {
  const expected = model.auditReadiness?.populationTemplates || [];
  for (const template of expected) {
    const matching = populations.filter((population) => population.populationKind === template.kind);
    if (!matching.length) {
      gaps.push(gap("error", "missing-audit-population", `${audit.title} is missing the ${template.title} population.`, audit.id));
    } else if (matching.length > 1) {
      gaps.push(gap("error", "duplicate-audit-population", `${audit.title} has more than one ${template.title} population.`, audit.id));
    }
  }
  for (const population of populations) {
    if (population.periodStart !== audit.periodStart || population.periodEnd !== audit.periodEnd) {
      gaps.push(gap("error", "population-period-mismatch", `${population.title} does not match the exact audit period.`, population.id));
    }
    if (population.status === "not-applicable") {
      if (population.controlIds.length) {
        gaps.push(gap("error", "population-not-applicable-with-controls", `${population.title} is marked not applicable but is linked to in-scope controls.`, population.id));
      }
      if (!population.notApplicableReason) {
        gaps.push(gap("error", "population-missing-not-applicable-reason", `${population.title} is marked not applicable without a reason.`, population.id));
      }
      continue;
    }
    if (population.status !== "reconciled") {
      gaps.push(gap("error", "population-not-reconciled", `${population.title} is ${population.status}, not reconciled.`, population.id));
      continue;
    }
    if (!population.reconciledByIds.length || !population.reconciledOn || !["complete", "complete-with-exceptions"].includes(population.conclusion)) {
      gaps.push(gap("error", "population-reconciliation-incomplete", `${population.title} does not record a completed management reconciliation.`, population.id));
    }
    if (population.conclusion === "complete-with-exceptions" && !population.reconciliationSummary) {
      gaps.push(gap("error", "population-exceptions-undocumented", `${population.title} concludes with exceptions but does not describe them in the reconciliation summary.`, population.id));
    }
    const evidence = byId.get(population.sourceEvidenceId);
    if (!evidence || evidence.type !== "evidence" || evidence.evidenceKind !== "population-export") {
      gaps.push(gap("error", "population-export-missing", `${population.title} does not link a population-export evidence record.`, population.id));
      continue;
    }
    if (evidence.periodStart !== audit.periodStart || evidence.periodEnd !== audit.periodEnd) {
      gaps.push(gap("error", "population-evidence-period-mismatch", `${evidence.title} does not cover the exact audit period.`, evidence.id));
    }
    const generatedOn = timestampDate(evidence.generatedAt, evidence.timezone);
    if (population.reconciledOn && generatedOn && population.reconciledOn < generatedOn) {
      gaps.push(gap("error", "population-reconciled-before-generation", `${population.title} was reconciled before its population export was generated.`, population.id));
    }
    if (!population.sourceSystemId) {
      gaps.push(gap("error", "population-source-system-missing", `${population.title} does not identify its authoritative source system.`, population.id));
    } else if (evidence.sourceSystemId !== population.sourceSystemId) {
      gaps.push(gap("error", "population-source-system-mismatch", `${population.title} and ${evidence.title} do not name the same authoritative source system.`, population.id));
    }
    const template = expected.find((item) => item.kind === population.populationKind);
    const sourceSystem = byId.get(population.sourceSystemId);
    if (template?.sourceKind && sourceSystem && !(sourceSystem.evidenceSourceKinds || []).includes(template.sourceKind)) {
      gaps.push(gap("error", "population-source-role-mismatch", `${sourceSystem.title} is not cataloged for the ${displaySourceKind(template.sourceKind)} evidence role required by ${population.title}.`, sourceSystem.id));
    }
  }
}

function evidenceCoversPacketDate(item, audit, start, end) {
  if (audit?.auditKind === "soc-2-type-1") {
    return (item.periodStart && item.periodEnd && item.periodStart <= start && item.periodEnd >= start)
      || item.collectedOn === start;
  }
  return (item.periodStart && item.periodEnd && item.periodStart <= end && item.periodEnd >= start)
    || (item.collectedOn >= start && item.collectedOn <= end);
}

function displaySourceKind(value) {
  return String(value || "").replaceAll("-", " ");
}

function overlapsEvidencePeriod(record, start, end) {
  return record.type === "evidence" && (
    (record.collectedOn >= start && record.collectedOn <= end)
    || (record.periodStart && record.periodEnd && record.periodStart <= end && record.periodEnd >= start)
  );
}

function policyIdsFor(record, byId, seen = new Set()) {
  if (!record || seen.has(record.id)) return [];
  seen.add(record.id);
  const ids = new Set(record.policyIds || []);
  if (record.type === "policy") ids.add(record.id);
  for (const controlId of record.controlIds || []) addIds(ids, byId.get(controlId)?.policyIds);
  if (record.obligationId) addIds(ids, policyIdsFor(byId.get(record.obligationId), byId, seen));
  if (record.sourceResourceId) addIds(ids, policyIdsFor(byId.get(record.sourceResourceId), byId, seen));
  return [...ids];
}

function recordSummary(record) {
  return record ? { id: record.id, type: record.type, title: record.title, status: record.status } : null;
}

function packetMarkdown(packet) {
  const readiness = packet.readiness.status === "delivery-ready"
    ? "filegrc management checks passed. The engagement team still determines whether the evidence is sufficient and appropriate."
    : `${packet.readiness.errors} errors and ${packet.readiness.warnings} warnings require review. This is a draft packet.`;
  const periodLabel = packet.period.basis === "as-of"
    ? `as of ${packet.period.start}`
    : `${packet.period.start} through ${packet.period.end}`;
  const lines = [
    `# Evidence packet: ${periodLabel}`,
    "",
    `Status: ${packet.readiness.status}`,
    `Workspace: ${packet.workspace.organizationName}`,
    `Revision: ${packet.revision.commit || "uncommitted"}`,
    `Generated: ${packet.generatedAt}`,
    `Audit: ${packet.audit?.title || "none selected"}`,
    "",
    "## Review status",
    "",
    readiness,
    "",
    "## Coverage",
    "",
    `- ${packet.summary.filegrcRecords} filegrc Evidence records`,
    `- ${packet.summary.obligationOccurrences} recurring obligation occurrences`,
    `- ${packet.summary.eventRuns} event runs`,
    `- ${packet.summary.evidence} External Evidence records`,
    `- ${packet.summary.populations} reconciled or planned populations`,
    `- ${packet.summary.policies} policies`,
    `- ${packet.summary.controls} controls`,
    `- ${packet.summary.requirements} criteria`,
    `- ${packet.summary.systems} in-scope systems`,
    `- ${packet.summary.sourceSystems} cataloged source systems`,
    "",
    "Open `index.html` for the auditor-oriented index. `control-matrix.csv` cross-references criteria, controls, filegrc Evidence, External Evidence, and tests. `source-system-index.csv` identifies the systems of record used to produce External Evidence. `external-evidence-index.csv` lists material that must be delivered or accessed outside this packet. For Type 2, `population-index.csv` records management's population reconciliation and fixed source exports. filegrc records, governed Markdown, fixed attachments, and committed historical versions are included in their respective directories.",
    "",
    "After transfer, enter the packet directory and run `shasum -a 256 -c SHA256SUMS` or `sha256sum -c SHA256SUMS`. The checksum file covers every other packet file.",
    ""
  ];
  return lines.join("\n");
}

function packetHtml(packet) {
  const section = (title, body) => `<section><h2>${escapeHtml(title)}</h2>${body}</section>`;
  const links = (items) => items.length
    ? `<ul>${items.map((item) => `<li><a href="records/${encodeURIComponent(item.type)}/${encodeURIComponent(item.id)}.json">${escapeHtml(item.title)}</a><small>${escapeHtml(item.type)}</small></li>`).join("")}</ul>`
    : "<p>None.</p>";
  const gaps = packet.gaps.length
    ? `<ul>${packet.gaps.map((item) => `<li class="${item.severity}"><strong>${escapeHtml(item.severity)}</strong> ${escapeHtml(item.message)}</li>`).join("")}</ul>`
    : "<p>filegrc management checks passed. The engagement team still evaluates sufficiency and appropriateness.</p>";
  const engagementDate = packet.period.basis === "as-of"
    ? `As of ${escapeHtml(packet.period.start)}`
    : `${escapeHtml(packet.period.start)} through ${escapeHtml(packet.period.end)}`;
  const engagement = packet.audit
    ? `<dl><dt>Audit</dt><dd>${escapeHtml(packet.audit.title)}</dd><dt>Kind</dt><dd>${escapeHtml(packet.audit.kind)}</dd><dt>Scope</dt><dd>${escapeHtml(packet.audit.scope)}</dd><dt>Audit date or period</dt><dd>${engagementDate}</dd><dt>Subservice method</dt><dd>${escapeHtml(packet.audit.subserviceMethod || "not recorded")}</dd></dl>`
    : "<p>No audit record was selected.</p>";
  const obligations = packet.obligations.length
    ? `<table><thead><tr><th>Obligation</th><th>Allowed window</th><th>Status</th></tr></thead><tbody>${packet.obligations.map((item) => `<tr><td>${escapeHtml(item.title)}</td><td>${item.dueWindowStart} through ${item.dueWindowEnd}<br><small>Overdue ${item.overdueOn}</small></td><td>${escapeHtml(item.status)}</td></tr>`).join("")}</tbody></table>`
    : "<p>No recurring occurrences intersect this period.</p>";
  const evidence = packet.evidence.length
    ? `<table><thead><tr><th>External Evidence</th><th>Source and period</th><th>Controls</th><th>Files</th></tr></thead><tbody>${packet.evidence.map((item) => `<tr><td><a href="records/evidence/${encodeURIComponent(item.id)}.json">${escapeHtml(item.title)}</a><small>${escapeHtml(item.status)} · ${escapeHtml(item.evidenceKind)}</small></td><td>${escapeHtml(item.source)}<small>${escapeHtml(item.periodStart || item.collectedOn)}${item.periodEnd ? ` through ${escapeHtml(item.periodEnd)}` : ""}</small></td><td>${item.controlIds.map(escapeHtml).join("<br>") || "None"}</td><td>${item.filePaths.map((path) => `<a class="attachment" href="attachments/${path.split("/").map(encodeURIComponent).join("/")}">${escapeHtml(basename(path))}</a>`).join("") || "No fixed attachment"}</td></tr>`).join("")}</tbody></table>`
    : "<p>No External Evidence records were selected.</p>";
  const sourceSystems = packet.sourceSystems.length
    ? `<p><a href="source-system-index.csv">Download source system index CSV</a></p><table><thead><tr><th>System of record</th><th>Evidence roles</th><th>Audit relationship</th><th>Evidence</th></tr></thead><tbody>${packet.sourceSystems.map((item) => `<tr><td><a href="records/system/${encodeURIComponent(item.id)}.json">${escapeHtml(item.title)}</a><small>${escapeHtml(item.status)}</small></td><td>${item.evidenceSourceKinds.map(escapeHtml).join("<br>") || "No evidence role recorded"}</td><td>${item.inAuditScope ? "In-scope system" : "Evidence source"}</td><td>${item.evidenceIds.length}</td></tr>`).join("")}</tbody></table><p><a href="external-evidence-index.csv">Download external evidence delivery index CSV</a></p>`
    : "<p>No source systems were cataloged.</p>";
  const populations = packet.populations.length
    ? `<p><a href="population-index.csv">Download population index CSV</a></p><table><thead><tr><th>Population</th><th>Period and source</th><th>Count</th><th>Reconciliation</th></tr></thead><tbody>${packet.populations.map((item) => `<tr><td><a href="records/audit-population/${encodeURIComponent(item.id)}.json">${escapeHtml(item.title)}</a><small>${escapeHtml(item.status)} · ${escapeHtml(item.populationKind)}</small></td><td>${escapeHtml(item.periodStart)} through ${escapeHtml(item.periodEnd)}<small>${escapeHtml(item.source || "No authoritative source recorded")}</small></td><td>${item.populationCount ?? "Not recorded"}</td><td>${escapeHtml(item.conclusion || item.notApplicableReason || "Not complete")}</td></tr>`).join("")}</tbody></table>`
    : "<p>No audit populations were selected.</p>";
  const eventRuns = packet.eventRuns.length
    ? packet.eventRuns.map((run) => `<article><h3><a href="records/obligation-event/${encodeURIComponent(run.id)}.json">${escapeHtml(run.title)}</a></h3><p>${escapeHtml(run.occurredAt || run.occurredOn)} · ${escapeHtml(run.status)} · ${run.completeCount} of ${run.actions.length} complete</p><table><thead><tr><th>Required action</th><th>Policy cutoff</th><th>Status</th></tr></thead><tbody>${run.actions.map((action) => `<tr><td><a href="records/action-item/${encodeURIComponent(action.actionItemId)}.json">${escapeHtml(action.title)}</a></td><td>${escapeHtml(action.dueWindowEndAt || action.dueWindowEnd)}</td><td>${escapeHtml(action.status)}</td></tr>`).join("")}</tbody></table></article>`).join("")
    : "<p>No event workflows intersect this period.</p>";
  const recordsById = new Map(packet.records.map((record) => [record.id, record]));
  const filegrcRecords = packet.filegrcRecords.length
    ? `<table><thead><tr><th>Date</th><th>filegrc record</th><th>Latest committed change</th></tr></thead><tbody>${packet.filegrcRecords.map((item) => {
      const history = recordsById.get(item.id)?.history?.[0];
      const source = history
        ? `${history.timestamp} · ${history.author} · ${history.subject}`
        : "No committed file history";
      return `<tr><td>${escapeHtml(item.primaryDate)}</td><td><a href="records/${encodeURIComponent(item.type)}/${encodeURIComponent(item.id)}.json">${escapeHtml(item.title)}</a><br><small>${escapeHtml(item.type)}</small></td><td>${escapeHtml(source)}</td></tr>`;
    }).join("")}</tbody></table>`
    : "<p>No filegrc Evidence records matched this period.</p>";
  const controlCoverage = packet.controlCoverage.length
    ? `<p><a href="control-matrix.csv">Download control matrix CSV</a></p><table><thead><tr><th>Control</th><th>Status and scope</th><th>Criteria</th><th>filegrc Evidence</th><th>External Evidence</th><th>Tests</th></tr></thead><tbody>${packet.controlCoverage.map((control) => `<tr><td><a href="records/control/${encodeURIComponent(control.id)}.json">${escapeHtml(control.code || control.id)}</a><small>${escapeHtml(control.title)}</small></td><td>${escapeHtml(control.status)}<small>${control.systemIds.map(escapeHtml).join(", ") || "No system scope"}</small></td><td>${control.requirementIds.map(escapeHtml).join("<br>") || "None"}</td><td>${control.operatingRecordIds.length}</td><td>${control.evidenceIds.length}</td><td>${control.tests.length}</td></tr>`).join("")}</tbody></table>`
    : "<p>No controls were selected.</p>";
  const readinessLabel = packet.readiness.status === "delivery-ready" ? "filegrc management checks passed" : "Draft, do not deliver";
  const packetDate = packet.period.basis === "as-of"
    ? `As of ${escapeHtml(packet.period.start)}`
    : `${escapeHtml(packet.period.start)} through ${escapeHtml(packet.period.end)}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Evidence packet</title><style>
body{font:14px/1.5 system-ui,sans-serif;color:#161825;max-width:1120px;margin:auto;padding:40px;background:#f7f8fc}header,section{background:#fff;border:1px solid #dfe3ef;border-radius:10px;padding:24px;margin:14px 0}h1,h2{margin-top:0}h1{font-size:26px}h2{font-size:17px}ul{padding-left:20px}li{margin:8px 0}small{display:block;color:#656c7e}.attachment{margin-right:10px;font-size:12px}.error{color:#8a2f28}.warning{color:#76500d}.readiness{display:inline-block;padding:5px 9px;border-radius:999px;background:#f7e4e2;color:#7a2520;font-weight:700}.readiness.ready{background:#e2f1e8;color:#245d3b}table{width:100%;border-collapse:collapse}th,td{padding:9px;border:1px solid #dfe3ef;text-align:left;vertical-align:top}code{overflow-wrap:anywhere}dl{display:grid;grid-template-columns:max-content 1fr;gap:8px 16px}dt{font-weight:700}dd{margin:0}
</style></head><body><header><p>SOC 2 evidence packet</p><span class="readiness ${packet.readiness.status === "delivery-ready" ? "ready" : ""}">${escapeHtml(readinessLabel)}</span><h1>${packetDate}</h1><p>${escapeHtml(packet.workspace.organizationName)} · revision <code>${escapeHtml(packet.revision.commit || "uncommitted")}</code></p></header>${section("Engagement scope", engagement)}${section("Review status", gaps)}${section("Control coverage", controlCoverage)}${section("Systems of record", sourceSystems)}${packet.period.basis === "period" ? section("Management population reconciliation", populations) : ""}${packet.period.basis === "period" ? section("Recurring obligation coverage", obligations) : ""}${packet.period.basis === "period" ? section("Event workflow coverage", eventRuns) : ""}${section("Policies", links(packet.policies))}${section("filegrc Evidence", filegrcRecords)}${section("External Evidence", evidence)}${section("Integrity and history", "<p>Verify all transferred files with <code>SHA256SUMS</code>. Committed prior versions are under <code>history/</code> with an index that records their source paths and Git metadata.</p>")}</body></html>`;
}

async function writePacketFile(output, relativePath, source, files) {
  const path = resolvePacketOutputPath(output, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, source, { encoding: "utf8", flag: "wx" });
  files.push(relativePath.split("\\").join("/"));
}

async function copyPacketFile(source, output, relativePath, files) {
  const target = resolvePacketOutputPath(output, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
  files.push(relativePath.split("\\").join("/"));
}

function resolvePacketOutputPath(output, relativePath) {
  if (
    typeof relativePath !== "string"
    || !relativePath
    || isAbsolute(relativePath)
    || relativePath.includes("\\")
    || relativePath.includes("\0")
    || /[\r\n]/.test(relativePath)
  ) {
    throw new Error("Evidence packet files must use safe relative paths.");
  }
  const target = resolve(output, relativePath);
  if (!isWithin(output, target)) throw new Error("Evidence packet files must stay inside the packet directory.");
  return target;
}

function gap(severity, code, message, resourceId) {
  return { severity, code, message, ...(resourceId ? { resourceId } : {}) };
}

function deduplicateGaps(gaps) {
  const seen = new Set();
  return gaps.filter((item) => {
    const key = `${item.code}\0${item.resourceId || item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function addIds(target, values = []) {
  for (const value of values) if (value) target.add(value);
}

function requireDate(value, label) {
  if (!parseCalendarDate(value)) throw new Error(`A valid ${label} is required.`);
  return value;
}

function resolvePacketPeriod(options, audit) {
  const typeOne = audit?.auditKind === "soc-2-type-1";
  const start = requireDate(
    options.start || (typeOne ? audit?.typeOneAsOf : audit?.periodStart),
    typeOne ? "Type 1 as-of date" : "packet start date"
  );
  const end = requireDate(
    options.end || (typeOne ? audit?.typeOneAsOf : audit?.periodEnd),
    typeOne ? "Type 1 as-of date" : "packet end date"
  );
  if (end < start) throw new Error("The packet end date must not be before its start date.");
  return { start, end, basis: typeOne ? "as-of" : "period" };
}

function byTitle(a, b) {
  return a.title.localeCompare(b.title);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}
