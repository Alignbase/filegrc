import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, readdir, readlink, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { getGitSummary, getWorkspaceHistories } from "./git.js";
import { planObligations } from "./obligations.js";
import { isWithin, resolveDataPath, resolveWorkspacePath } from "./paths.js";
import { parseCalendarDate } from "./recurrence.js";
import { validateWorkspace } from "./validate.js";

export async function prepareEvidencePacket(input, options = {}) {
  const start = requireDate(options.start, "packet start date");
  const end = requireDate(options.end, "packet end date");
  if (end < start) throw new Error("The packet end date must not be before its start date.");
  const validation = await validateWorkspace(input);
  if (!validation.ok) throw new Error(`The workspace has ${validation.counts.errors} validation ${validation.counts.errors === 1 ? "error" : "errors"}. Fix them before generating evidence.`);
  const { loaded } = validation;
  const records = loaded.resources;
  const byId = new Map(records.map((record) => [record.id, record]));
  const entriesById = new Map(loaded.entries.map((entry) => [entry.record.id, entry]));
  const audit = options.auditId ? byId.get(options.auditId) : null;
  if (options.auditId && audit?.type !== "audit") throw new Error(`Audit "${options.auditId}" was not found.`);
  const datedRecords = loaded.entries
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
  const obligations = plan.calendarItems.filter((item) => item.dueWindowStart <= end && item.overdueOn > start);
  const eventRuns = plan.eventRuns.filter((run) => (
    (run.occurredOn >= start && run.occurredOn <= end)
    || datedEvidenceSourceIds.has(run.id)
    || run.actions.some((action) => (
      (action.completedOn && action.completedOn >= start && action.completedOn <= end)
      || datedEvidenceSourceIds.has(action.actionItemId)
      || [...action.completionResourceIds, ...action.evidenceIds].some((id) => datedRecordIds.has(id))
      || (action.dueWindowStart <= end && (!action.overdueOn || action.overdueOn > start))
    ))
  ));
  const selectedIds = new Set(datedRecords.map((record) => record.id));
  if (audit) {
    selectedIds.add(audit.id);
    addIds(selectedIds, [
      ...(audit.systemIds || []),
      ...(audit.requirementIds || []),
      ...(audit.controlIds || []),
      ...(audit.controlTestIds || []),
      ...(audit.evidenceIds || []),
      ...(audit.findingIds || []),
      audit.systemDescriptionDocumentId,
      audit.managementAssertionDocumentId,
      audit.managementResponseDocumentId,
      audit.reportEvidenceId,
      ...(audit.supplementalDocumentIds || [])
    ]);
    for (const request of records.filter((record) => record.type === "audit-request" && record.auditId === audit.id)) {
      selectedIds.add(request.id);
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
    const direct = selectedIds.has(evidence.id)
      || (evidence.sourceResourceIds || []).some((id) => selectedIds.has(id))
      || overlapsEvidencePeriod(evidence, start, end);
    if (direct) evidenceIds.add(evidence.id);
  }
  for (const id of [...selectedIds]) addIds(evidenceIds, byId.get(id)?.evidenceIds);
  addIds(selectedIds, evidenceIds);
  expandEvidenceWorkflowContext(selectedIds, byId);
  for (const id of selectedIds) if (byId.get(id)?.type === "evidence") evidenceIds.add(id);

  const controlIds = new Set();
  for (const id of selectedIds) {
    const record = byId.get(id);
    addIds(controlIds, record?.controlIds);
    if (record?.type === "control") controlIds.add(record.id);
    if (record?.obligationId) addIds(controlIds, byId.get(record.obligationId)?.controlIds);
  }
  if (audit) addIds(controlIds, audit.controlIds);
  addIds(selectedIds, controlIds);

  const policyIds = new Set(records.filter((record) => record.type === "policy" && ["approved", "active"].includes(record.status)).map((record) => record.id));
  for (const id of selectedIds) addIds(policyIds, policyIdsFor(byId.get(id), byId));
  for (const controlId of controlIds) addIds(policyIds, byId.get(controlId)?.policyIds);
  addIds(selectedIds, policyIds);

  const requirementIds = new Set();
  for (const controlId of controlIds) addIds(requirementIds, byId.get(controlId)?.requirementIds);
  if (audit) addIds(requirementIds, audit.requirementIds);
  addIds(selectedIds, requirementIds);

  const evidence = [...evidenceIds].map((id) => evidenceSummary(byId.get(id))).filter(Boolean).sort(byTitle);
  const selectedPaths = [...selectedIds]
    .map((id) => entriesById.get(id))
    .filter(Boolean)
    .map((entry) => `data/${entry.relativePath}`);
  const historyRevision = getGitSummary(loaded.root);
  const histories = getWorkspaceHistories(loaded.root, selectedPaths, 50);
  const packetRecords = [...selectedIds]
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((record) => {
      const path = `data/${entriesById.get(record.id)?.relativePath || ""}`;
      return {
        id: record.id,
        type: record.type,
        title: record.title,
        path,
        dates: packetRecord(record, loaded.model, start, end, loaded.workspace.timezone)?.dates || [],
        policyIds: policyIdsFor(record, byId),
        evidenceIds: record.evidenceIds || [],
        history: histories.get(path) || []
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
  const gaps = packetGaps({ obligations, eventRuns, evidence, git, end });
  const generatedAt = options.generatedAt || new Date().toISOString();
  return {
    schemaVersion: 1,
    generatedAt,
    period: { start, end },
    audit: audit ? { id: audit.id, title: audit.title, kind: audit.auditKind } : null,
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
    summary: {
      datedRecords: datedRecords.length,
      records: packetRecords.length,
      policies: policyIds.size,
      controls: controlIds.size,
      obligationOccurrences: obligations.length,
      eventRuns: eventRuns.length,
      evidence: evidence.length,
      gaps: gaps.length
    },
    datedRecords: datedRecords.sort((a, b) => a.primaryDate.localeCompare(b.primaryDate) || byTitle(a, b)),
    policies: [...policyIds].map((id) => recordSummary(byId.get(id))).filter(Boolean).sort(byTitle),
    controls: [...controlIds].map((id) => recordSummary(byId.get(id))).filter(Boolean).sort(byTitle),
    obligations,
    eventRuns,
    evidence,
    gaps,
    records: packetRecords
  };
}

function expandEvidenceWorkflowContext(selectedIds, byId) {
  const queue = [...selectedIds];
  const enqueue = (ids = []) => {
    for (const id of ids) {
      if (!id || selectedIds.has(id)) continue;
      selectedIds.add(id);
      queue.push(id);
    }
  };
  for (let index = 0; index < queue.length; index += 1) {
    const record = byId.get(queue[index]);
    if (record?.type === "evidence") enqueue(record.sourceResourceIds);
    if (record?.type === "action-item") {
      enqueue([
        record.sourceResourceId,
        record.obligationId,
        ...(record.completionResourceIds || []),
        ...(record.evidenceIds || [])
      ]);
    }
    if (record?.type === "obligation-event") enqueue([...(record.obligationIds || []), ...(record.actionItemIds || [])]);
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
    for (const item of packet.records) {
      const entry = entriesById.get(item.id);
      if (!entry) continue;
      await writePacketFile(output, join("records", item.type, `${item.id}.json`), entry.source, files);
      const definition = validation.loaded.model.resources[item.type];
      const fields = { ...validation.loaded.model.commonFields, ...definition?.fields };
      for (const [name, field] of Object.entries(fields)) {
        if (!field.content || typeof entry.record[name] !== "string") continue;
        await copyPacketFile(
          resolveDataPath(validation.loaded.root, entry.record[name]),
          output,
          join("content", entry.record[name].replace(/^content\//, "")),
          files
        );
      }
    }
    for (const item of packet.evidence) {
      const record = byId.get(item.id);
      for (const path of record?.filePaths || []) {
        await copyPacketFile(resolveDataPath(validation.loaded.root, path), output, join("attachments", path), files);
      }
    }
    await assertPacketSourceState(packet, validation.loaded);
    return { output, files };
  } catch (error) {
    if (outputCreated) await rm(output, { recursive: true, force: true });
    error.message = `Evidence packet generation failed in ${outputOption}. ${error.message}`;
    throw error;
  }
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
      throw new Error("The workspace source changed while the evidence packet was being prepared. Try again.");
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

function packetGaps({ obligations, eventRuns, evidence, git, end }) {
  const gaps = [];
  if (!git.commit) gaps.push(gap("error", "uncommitted-workspace", "The workspace has no Git revision to bind this packet to."));
  else if (!git.clean) gaps.push(gap("error", "dirty-workspace", "Commit or discard workspace changes before treating this packet as audit evidence."));
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
    if (!item.sourceCommit) gaps.push(gap("warning", "unbound-evidence", `${item.title} does not name the source Git revision.`, item.id));
    if (item.status !== "verified") gaps.push(gap("warning", "unverified-evidence", `${item.title} is ${item.status}, not verified.`, item.id));
  }
  return gaps;
}

function evidenceSummary(record) {
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
    sourceCommit: record.sourceCommit,
    sourceResourceIds: record.sourceResourceIds || [],
    filePaths: record.filePaths || [],
    externalReference: record.externalReference || null
  };
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
  const lines = [
    `# Evidence packet: ${packet.period.start} through ${packet.period.end}`,
    "",
    `Workspace: ${packet.workspace.organizationName}`,
    `Revision: ${packet.revision.commit || "uncommitted"}`,
    `Generated: ${packet.generatedAt}`,
    "",
    "## Review status",
    "",
    packet.gaps.length ? `${packet.gaps.length} gaps or warnings require review.` : "No packet gaps were detected.",
    "",
    "## Coverage",
    "",
    `- ${packet.summary.datedRecords} dated records`,
    `- ${packet.summary.obligationOccurrences} recurring obligation occurrences`,
    `- ${packet.summary.eventRuns} event runs`,
    `- ${packet.summary.evidence} evidence records`,
    `- ${packet.summary.policies} policies`,
    `- ${packet.summary.controls} controls`,
    "",
    "Open `index.html` for the auditor-oriented index. Raw source records, governed Markdown, and fixed attachments are included in their respective directories.",
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
    : "<p>No packet gaps were detected.</p>";
  const obligations = packet.obligations.length
    ? `<table><thead><tr><th>Obligation</th><th>Allowed window</th><th>Status</th></tr></thead><tbody>${packet.obligations.map((item) => `<tr><td>${escapeHtml(item.title)}</td><td>${item.dueWindowStart} through ${item.dueWindowEnd}<br><small>Overdue ${item.overdueOn}</small></td><td>${escapeHtml(item.status)}</td></tr>`).join("")}</tbody></table>`
    : "<p>No recurring occurrences intersect this period.</p>";
  const evidence = packet.evidence.length
    ? `<ul>${packet.evidence.map((item) => `<li><a href="records/evidence/${encodeURIComponent(item.id)}.json">${escapeHtml(item.title)}</a><small>${escapeHtml(item.status)} · ${escapeHtml(item.evidenceKind)}</small>${item.filePaths.map((path) => `<a class="attachment" href="attachments/${path.split("/").map(encodeURIComponent).join("/")}">${escapeHtml(basename(path))}</a>`).join("")}</li>`).join("")}</ul>`
    : "<p>No evidence records were selected.</p>";
  const eventRuns = packet.eventRuns.length
    ? packet.eventRuns.map((run) => `<article><h3><a href="records/obligation-event/${encodeURIComponent(run.id)}.json">${escapeHtml(run.title)}</a></h3><p>${escapeHtml(run.occurredAt || run.occurredOn)} · ${escapeHtml(run.status)} · ${run.completeCount} of ${run.actions.length} complete</p><table><thead><tr><th>Required action</th><th>Policy cutoff</th><th>Status</th></tr></thead><tbody>${run.actions.map((action) => `<tr><td><a href="records/action-item/${encodeURIComponent(action.actionItemId)}.json">${escapeHtml(action.title)}</a></td><td>${escapeHtml(action.dueWindowEndAt || action.dueWindowEnd)}</td><td>${escapeHtml(action.status)}</td></tr>`).join("")}</tbody></table></article>`).join("")
    : "<p>No event workflows intersect this period.</p>";
  const recordsById = new Map(packet.records.map((record) => [record.id, record]));
  const datedRecords = packet.datedRecords.length
    ? `<table><thead><tr><th>Date</th><th>Operating record</th><th>Latest committed change</th></tr></thead><tbody>${packet.datedRecords.map((item) => {
      const history = recordsById.get(item.id)?.history?.[0];
      const source = history
        ? `${history.timestamp} · ${history.author} · ${history.subject}`
        : "No committed file history";
      return `<tr><td>${escapeHtml(item.primaryDate)}</td><td><a href="records/${encodeURIComponent(item.type)}/${encodeURIComponent(item.id)}.json">${escapeHtml(item.title)}</a><br><small>${escapeHtml(item.type)}</small></td><td>${escapeHtml(source)}</td></tr>`;
    }).join("")}</tbody></table>`
    : "<p>No dated operating records matched this period.</p>";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Evidence packet</title><style>
body{font:14px/1.5 system-ui,sans-serif;color:#161825;max-width:1120px;margin:auto;padding:40px;background:#f7f8fc}header,section{background:#fff;border:1px solid #dfe3ef;border-radius:10px;padding:24px;margin:14px 0}h1,h2{margin-top:0}h1{font-size:26px}h2{font-size:17px}ul{padding-left:20px}li{margin:8px 0}small{display:block;color:#656c7e}.attachment{margin-right:10px;font-size:12px}.error{color:#8a2f28}.warning{color:#76500d}table{width:100%;border-collapse:collapse}th,td{padding:9px;border:1px solid #dfe3ef;text-align:left;vertical-align:top}code{overflow-wrap:anywhere}
</style></head><body><header><p>SOC 2 evidence packet</p><h1>${escapeHtml(packet.period.start)} through ${escapeHtml(packet.period.end)}</h1><p>${escapeHtml(packet.workspace.organizationName)} · revision <code>${escapeHtml(packet.revision.commit || "uncommitted")}</code></p></header>${section("Review status", gaps)}${section("Recurring obligation coverage", obligations)}${section("Event workflow coverage", eventRuns)}${section("Policies", links(packet.policies))}${section("Controls", links(packet.controls))}${section("Dated operating records", datedRecords)}${section("Evidence", evidence)}</body></html>`;
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

function addIds(target, values = []) {
  for (const value of values) if (value) target.add(value);
}

function requireDate(value, label) {
  if (!parseCalendarDate(value)) throw new Error(`A valid ${label} is required.`);
  return value;
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
