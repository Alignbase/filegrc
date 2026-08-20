import { applyDocumentActivationBatch, contentRevision } from "./files.js";
import { serializeWorkspaceMutation } from "./mutation.js";
import { modelSupports } from "../model/index.js";
import { assessAuditDocumentActivations } from "./audit-preparation.js";
import { assessProgramReadiness } from "./program-readiness.js";
import { personWasActiveOn } from "./soc2.js";
import { currentCalendarDate } from "./time.js";
import { loadWorkspace } from "./workspace.js";

export async function scaffoldDocumentActivation(input = process.cwd(), options = {}) {
  const loaded = await loadWorkspace(input);
  requireDocumentLifecycle(loaded);
  const candidates = await activationCandidates(loaded, options);
  const revisionById = new Map(loaded.entries.map((entry) => [entry.record.id, contentRevision(entry.source)]));
  const today = currentCalendarDate(loaded.workspace.timezone);
  return {
    documentIds: candidates.map(({ documentId }) => documentId),
    ...(options.auditId ? { auditId: options.auditId, workflowScope: "engagement" } : { workflowScope: "program" }),
    activatedByIds: [],
    activatedOn: today,
    effectiveOn: today,
    expectedRevisions: Object.fromEntries(candidates.map(({ documentId }) => [documentId, revisionById.get(documentId)])),
    confirmed: false
  };
}

export async function planDocumentActivation(input = process.cwd(), options = {}) {
  const loaded = await loadWorkspace(input);
  requireDocumentLifecycle(loaded);
  const documentIds = [...new Set((options.documentIds || []).map(String))];
  if (!documentIds.length) throw new Error("Document activation needs at least one approved governed Document.");
  const activatedByIds = [...new Set((options.activatedByIds || []).map(String))];
  if (!activatedByIds.length) throw new Error("Document activation needs the Person who performed the activation.");
  const activatedOn = String(options.activatedOn || "").trim();
  const effectiveOn = String(options.effectiveOn || "").trim();
  if (!isCalendarDate(activatedOn)) throw new Error("Document activation needs the actual activation date in YYYY-MM-DD format.");
  if (!isCalendarDate(effectiveOn)) throw new Error("Document activation needs a real effective date in YYYY-MM-DD format.");
  const today = currentCalendarDate(loaded.workspace.timezone);
  if (activatedOn !== today) {
    throw new Error(`The activation date records today's lifecycle event and must be ${today}. Keep a future date in proposedEffectiveOn until activation occurs.`);
  }
  if (effectiveOn < activatedOn) {
    throw new Error("The effective date cannot be before the separate activation date; do not backdate adoption.");
  }
  const expectedRevisions = options.expectedRevisions || {};
  if (Array.isArray(expectedRevisions) || !expectedRevisions || typeof expectedRevisions !== "object") {
    throw new Error("Document activation expected revisions must be keyed by Document ID.");
  }
  const workflowScope = options.auditId ? "engagement" : "program";
  const candidates = await activationCandidates(loaded, options);
  const assessmentById = new Map(candidates.map((item) => [item.documentId, item]));
  const entryById = new Map(loaded.entries.map((entry) => [entry.record.id, entry]));
  const invalidActivatorIds = activatedByIds.filter((id) => {
    const person = entryById.get(id)?.record;
    return !personWasActiveOn(person, activatedOn);
  });
  if (invalidActivatorIds.length) {
    throw new Error(`Document activation needs active People as activators: ${invalidActivatorIds.join(", ")}.`);
  }
  const update = documentIds.map((documentId) => {
    const entry = entryById.get(documentId);
    if (!entry || entry.record.type !== "document") throw new Error(`Document "${documentId}" was not found.`);
    if (entry.record.status !== "approved") {
      throw new Error(`Document "${documentId}" must be independently approved before its separate ${workflowScope === "engagement" ? "Step 5" : "Step 3"} activation.`);
    }
    if (entry.record.workflowScope !== workflowScope) {
      throw new Error(`Document "${documentId}" belongs to the ${entry.record.workflowScope} workflow, not ${workflowScope}.`);
    }
    const assessment = assessmentById.get(documentId);
    if (assessment?.state !== "ready-to-activate") {
      const missing = assessment?.missingImplementationControlIds || [];
      throw new Error(
        missing.length
          ? `Document "${documentId}" cannot be activated until linked Controls are implemented: ${missing.join(", ")}.`
          : `Document "${documentId}" is not ready for ${workflowScope === "engagement" ? "Step 5" : "Step 3"} activation.`
      );
    }
    if (!/^[a-f0-9]{64}$/.test(expectedRevisions[documentId] || "")) {
      throw new Error(`Document activation needs the current record revision for "${documentId}". Regenerate the activation review and try again.`);
    }
    const record = {
      ...entry.record,
      status: "active",
      activationBasis: "recorded",
      activatedByIds,
      activatedOn,
      effectiveOn,
      activatedContentRevisions: structuredClone(entry.record.approvedContentRevisions)
    };
    delete record.proposedEffectiveOn;
    return record;
  });
  return {
    operation: "document-activation",
    workflowScope,
    ...(options.auditId ? { auditId: options.auditId } : {}),
    documentIds,
    activatedByIds,
    activatedOn,
    effectiveOn,
    changes: {
      update,
      expectedRevisions: Object.fromEntries(documentIds.map((documentId) => [documentId, expectedRevisions[documentId]])),
      validateWholeWorkspace: true
    }
  };
}

async function activationCandidates(loaded, options) {
  if (options.auditId) {
    return (await assessAuditDocumentActivations(loaded, {
      auditId: options.auditId,
      asOf: currentCalendarDate(loaded.workspace.timezone)
    })).filter(({ state }) => state === "ready-to-activate");
  }
  const readiness = await assessProgramReadiness(loaded, { programId: options.programId });
  return readiness.documentActivations.filter(({ state }) => state === "ready-to-activate");
}

export async function activateDocuments(input = process.cwd(), options = {}) {
  if (options.confirmed !== true) throw new Error("Review the governed Document activation and confirm the write.");
  return serializeWorkspaceMutation(input, async (root) => {
    const plan = await planDocumentActivation(root, options);
    const result = await applyDocumentActivationBatch(root, plan.changes);
    return { ...plan, result };
  });
}

function requireDocumentLifecycle(loaded) {
  if (!modelSupports(loaded.model, "governed-document-activation")) {
    throw new Error("Separate governed Document approval and activation requires a model v5 workspace.");
  }
}

function isCalendarDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}
