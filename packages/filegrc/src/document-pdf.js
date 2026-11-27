import { link, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolveWorkspacePath, resolveWorkspaceRoot } from "./paths.js";
import { calculateRevision, revisionDigest, revisionsMatch } from "./revisions.js";
import { loadModel } from "../model/index.js";
import { markdownEntries, resourceDataPath } from "./resource-markdown.js";
import { readResourceContent } from "./resource-mutation.js";
import { getFileAtRevision, getFilesAtRevisions, getRegularDataPathsAtRevision, runGitCommandSync } from "./git.js";
import { hasMarkdownContent, openPlaceholderCount, substantiveMarkdown } from "./content-readiness.js";
import { partiesIndependent, partyPeople } from "./parties.js";
import { parseCalendarDate } from "./recurrence.js";
import { currentCalendarDate } from "./time.js";
import { personWasActiveOn } from "./soc2.js";
import { indexResources, loadWorkspace } from "./workspace.js";
import { embedPdfFont, pdfFonts, pdfUnicode } from "./pdf-font.js";
import { layoutPdf, PDF_PAGE_HEIGHT, PDF_PAGE_WIDTH } from "./pdf-layout.js";
import { createPdfWriter } from "./pdf-writer.js";

const approvedStatuses = new Set(["approved", "active", "superseded", "retired"]);

export function supportsDocumentPdf(model, type) {
  return ["policy", "document", "training"].includes(type)
    && Boolean(model.resources[type]);
}

export async function exportDocumentPdf(input, type, id, options = {}) {
  const root = resolveWorkspaceRoot(input);
  const commit = typeof options.commit === "string" ? options.commit.toLowerCase() : options.commit;
  if (commit !== undefined && !/^[a-f0-9]{40}$/i.test(commit)) {
    throw exportError("Use a full Git commit ID for the PDF revision.", 400);
  }
  if (commit) {
    let resolved;
    try {
      resolved = runGitCommandSync(root, ["rev-parse", "--verify", `${commit}^{commit}`]);
    } catch {
      throw exportError("The selected Git commit was not found.", 404);
    }
    if (resolved !== commit) throw exportError("Use the commit ID itself for the PDF revision.", 400);
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw exportError("Invalid resource ID.", 400);
  const loaded = commit ? readCommittedDocument(root, commit, type, id) : await loadWorkspace(root);
  if (!commit && loaded.diagnostics.some(({ code }) => ["missing-workspace", "missing-model-version", "unsupported-model"].includes(code))) {
    throw exportError("PDF export requires a Workspace record that declares a supported model.", 400);
  }
  const entry = loaded.entries.find(({ record }) => record?.id === id && record.type === type);
  if (!entry) throw exportError(`Record ${type}/${id} was not found in the selected revision.`, 404);
  const { record } = entry;
  if (!supportsDocumentPdf(loaded.model, type)) {
    throw exportError("PDF export requires a governed Policy, Document, or Training record.", 400);
  }

  const slots = markdownEntries(loaded.model, record);
  const slot = options.slot ? slots.find(({ name }) => name === options.slot) : slots.find(({ primary }) => primary) ?? slots[0];
  if (!slot) throw exportError("The selected Markdown slot was not found.", 404);
  const content = commit
    ? readCommittedContent(root, commit, slots, loaded.regularPaths)
    : await readResourceContent(loaded, record);
  const item = content[slot.name];
  const recordRevision = calculateRevision("content", entry.source);
  if ((options.expectedRecordRevision && recordRevision !== options.expectedRecordRevision)
    || (options.expectedContentRevision && item?.revision !== options.expectedContentRevision)) {
    throw exportError("The record or Markdown changed after you opened it. Reload the record to export the current revision.", 409);
  }
  if (!item) throw exportError("The selected Markdown slot has no file in this revision.", 404);
  const fields = loaded.model.resources[type].fields;
  const legacyTraining = type === "training" && Boolean(fields.effectiveContentRevisions);
  const bindings = legacyTraining ? record.effectiveContentRevisions : record.approvedContentRevisions;
  const approvers = legacyTraining ? record.approvedByIds : record.approverIds;
  const bound = (legacyTraining || Boolean(fields.approvedContentRevisions))
    && Object.keys(bindings ?? {}).length === slots.length
    && slots.every(({ name, path }) => content[name] && revisionsMatch("content", bindings[path], content[name].revision));
  let status = "Unapproved content";
  if (bound && approvedStatuses.has(record.status) && fields.status.values.includes(record.status)
    && typeof record.approvedOn === "string" && parseCalendarDate(record.approvedOn)) {
    const asOf = commit ? new Date(runGitCommandSync(root, ["log", "-1", "--format=%cI", commit, "--"])) : new Date();
    if (record.approvedOn <= currentCalendarDate(loaded.workspace?.timezone, asOf)
      && slots.every(({ name }) => {
        const { source } = content[name];
        return (type === "policy" ? hasMarkdownContent(source) : substantiveMarkdown(source))
          && openPlaceholderCount(source) === 0;
      })
      && hasIndependentApproval(record, approvers, commit ? committedApprovalParties(root, commit, loaded.model, loaded.regularPaths) : indexResources(loaded.resources).byId)) {
      status = "Approved content";
    }
  }
  else if (record.status === "draft") status = "Draft";
  else if (["in-review", "proposed"].includes(record.status)) status = "In review";
  if (["superseded", "retired"].includes(record.status)) status += ` | ${record.status === "retired" ? "Retired" : "Superseded"}`;

  const markdownDigest = revisionDigest("content", item.revision);
  const snapshotDigest = revisionDigest("content", calculateRevision("content", JSON.stringify({
    recordRevision,
    status,
    contentRevisions: slots.map(({ name }) => content[name]?.revision ?? null)
  })));
  const template = type === "document" && record.template === true;
  const revisionLabel = commit ? `Commit ${commit}` : `Working copy ${snapshotDigest}`;
  let bytes;
  try {
    bytes = renderDocument({ title: record.title, id, source: item.source, status, template, revisionLabel });
  } catch (error) {
    throw exportError(error.message, 422);
  }
  const filename = `${id}-${slot.name}-${(commit ?? snapshotDigest).slice(0, 12)}.pdf`.replace(/[^a-zA-Z0-9._-]/g, "-");
  return { root, filename, bytes, commit: commit ?? null, markdownDigest, recordRevision, slot: slot.name, status };
}

function readCommittedDocument(root, commit, type, id) {
  const regularPaths = getRegularDataPathsAtRevision(root, commit);
  const workspace = regularPaths.has("data/workspace.json") && parseRecord(getFileAtRevision(root, commit, "data/workspace.json"));
  if (workspace?.type !== "workspace" || !workspace.dataModelVersion) {
    throw exportError("The selected commit does not contain a FileGRC Workspace record.", 404);
  }
  const model = loadModel(String(workspace.dataModelVersion));
  if (!supportsDocumentPdf(model, type)) {
    throw exportError("PDF export requires a governed Policy, Document, or Training record.", 400);
  }
  const path = resourceDataPath(model, { type, id });
  const source = regularPaths.has(`data/${path}`) ? getFileAtRevision(root, commit, `data/${path}`) : null;
  return { model, workspace, regularPaths, entries: [{ record: parseRecord(source), source }] };
}

function readCommittedContent(root, commit, slots, regularPaths) {
  const available = slots.filter(({ path }) => regularPaths.has(`data/${path}`));
  const requests = available.map(({ path }) => ({ revision: commit, relativePath: `data/${path}` }));
  return Object.fromEntries(getFilesAtRevisions(root, requests).map((source, index) => [available[index].name,
    typeof source === "string" ? { source, revision: calculateRevision("content", source) } : null]));
}

function committedApprovalParties(root, commit, model, regularPaths) {
  const types = ["person", "team", "appointment"].filter((type) => model.resources[type]);
  const collections = types.map((type) => `data/${model.resources[type].collection}/`);
  const paths = [...regularPaths].filter((path) => path.endsWith(".json")
    && collections.some((prefix) => path.startsWith(prefix)));
  const sources = getFilesAtRevisions(root, paths.map((relativePath) => ({ revision: commit, relativePath })));
  const parties = sources.map(parseRecord).filter((record, index) => types.includes(record?.type)
    && typeof record.id === "string" && paths[index] === `data/${resourceDataPath(model, record)}`);
  return indexResources(parties).byId;
}

function parseRecord(source) {
  if (typeof source !== "string") return null;
  try { return JSON.parse(source); } catch { return null; }
}

function hasIndependentApproval(record, approverIds, parties) {
  const { ownerIds } = record;
  return Array.isArray(ownerIds) && Array.isArray(approverIds)
    && ownerIds.every((id) => ["person", "team", "appointment"].includes(parties.get(id)?.type))
    && approverIds.every((id) => parties.get(id)?.type === "person")
    && partiesIndependent(ownerIds, approverIds, parties)
    && [...partyPeople(approverIds, parties)].every((id) => personWasActiveOn(parties.get(id), record.approvedOn));
}

export async function writeDocumentPdf(exported) {
  const folder = resolveWorkspacePath(exported.root, ".filegrc/exports");
  await mkdir(folder, { recursive: true, mode: 0o700 });
  if (!/^[a-zA-Z0-9._-]+\.pdf$/.test(exported.filename)) throw new Error("Invalid PDF export filename.");
  const target = resolveWorkspacePath(exported.root, `.filegrc/exports/${exported.filename}`);
  const temporary = await mkdtemp(`${folder}/.pdf-`);
  try {
    await writeFile(`${temporary}/export.pdf`, exported.bytes, { mode: 0o600 });
    try {
      await link(`${temporary}/export.pdf`, target);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const existing = await readFile(resolveWorkspacePath(exported.root, `.filegrc/exports/${exported.filename}`));
      if (!existing.equals(exported.bytes)) throw new Error(`A different PDF already exists at ${target}. Move it before exporting again.`);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  return target;
}

function exportError(message, pdfStatus) {
  return Object.assign(new Error(message), { pdfStatus });
}

function renderDocument(document) {
  const fonts = pdfFonts();
  const pages = layoutPdf(document, fonts);
  const pdf = createPdfWriter();
  const catalog = pdf.add("");
  const pageTree = pdf.add("");
  const usedFaces = new Set(pages.flatMap(({ faces }) => [...faces]));
  const fontReferences = fonts.flatMap((font, index) => usedFaces.has(index)
    ? [`/F${index} ${embedPdfFont(pdf, font)} 0 R`] : []).join(" ");
  const fields = [];
  const pageReferences = pages.map(({ operations, fields: widgets }) => {
    const page = pdf.add("");
    const stream = pdf.stream("", Buffer.from(operations.join("\n")));
    const annotations = widgets.map(({ name, label, rect }) => {
      const [x, y, right, top] = rect.split(" ").map(Number);
      const appearance = pdf.stream(`/Type /XObject /Subtype /Form /BBox [0 0 ${(right - x).toFixed(2)} ${(top - y).toFixed(2)}] /Resources << >>`, Buffer.from("/Tx BMC EMC"));
      const field = pdf.add(`<< /Type /Annot /Subtype /Widget /FT /Tx /T (${name}) /TU <feff${pdfUnicode(label)}> /V () /Rect [${rect}] /P ${page} 0 R /F 4 /DA (/F0 11 Tf 0 g) /AP << /N ${appearance} 0 R >> >>`);
      const reference = `${field} 0 R`;
      fields.push(reference);
      return reference;
    });
    pdf.set(page, `<< /Type /Page /Parent ${pageTree} 0 R /MediaBox [0 0 ${PDF_PAGE_WIDTH} ${PDF_PAGE_HEIGHT}] /Resources << /Font << ${fontReferences} >> >> /Contents ${stream} 0 R /Annots [${annotations.join(" ")}] >>`);
    return `${page} 0 R`;
  });
  pdf.set(pageTree, `<< /Type /Pages /Count ${pages.length} /Kids [${pageReferences.join(" ")}] >>`);
  const form = fields.length ? ` /AcroForm << /Fields [${fields.join(" ")}] /DR << /Font << ${fontReferences} >> >> /DA (/F0 11 Tf 0 g) >>` : "";
  pdf.set(catalog, `<< /Type /Catalog /Pages ${pageTree} 0 R /Lang (en)${form} >>`);
  return pdf.finish(catalog);
}
