import { applyDocumentActivationBatch, applyGovernedContentActivationBatch, contentRevision } from "./files.js";
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
  const candidates = await activationCandidates(loaded, { ...options, documentsOnly: true });
  const revisionById = new Map(loaded.entries.map((entry) => [entry.record.id, contentRevision(entry.source)]));
  const today = currentCalendarDate(loaded.workspace.timezone);
  return {
    available: candidates.length > 0,
    message: candidates.length
      ? `${candidates.length} approved ${candidates.length === 1 ? "Document is" : "Documents are"} ready to activate.`
      : `No ${options.auditId ? "engagement Document" : "program Document"} is ready to activate. Review the current readiness actions first.`,
    nextCommand: candidates.length ? null : options.auditId
      ? `npx filegrc audit-readiness ${options.auditId} --json`
      : "npx filegrc program-path --next --json",
    documentIds: candidates.filter(({ resourceType }) => resourceType === "document").map(({ resourceId }) => resourceId),
    ...(options.auditId ? { auditId: options.auditId, workflowScope: "engagement" } : { workflowScope: "program" }),
    activatedByIds: [],
    activatedOn: today,
    effectiveOn: today,
    expectedRevisions: Object.fromEntries(candidates.map(({ resourceId }) => [resourceId, revisionById.get(resourceId)])),
    confirmed: false
  };
}

export async function planDocumentActivation(input = process.cwd(), options = {}) {
  const loaded = await loadWorkspace(input);
  requireDocumentLifecycle(loaded);
  const resourceIds = [...new Set((options.resourceIds || options.documentIds || []).map(String))];
  if (!resourceIds.length) throw new Error("Governed-content activation needs at least one approved program Document or Training record.");
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
    throw new Error("Governed-content activation expected revisions must be keyed by resource ID.");
  }
  const workflowScope = options.auditId ? "engagement" : "program";
  const governedContentOperation = workflowScope === "program" && options.resourceIds !== undefined;
  const candidates = await activationCandidates(loaded, options);
  const assessmentById = new Map(candidates.map((item) => [item.resourceId, item]));
  const entryById = new Map(loaded.entries.map((entry) => [entry.record.id, entry]));
  const invalidActivatorIds = activatedByIds.filter((id) => {
    const person = entryById.get(id)?.record;
    return !personWasActiveOn(person, activatedOn);
  });
  if (invalidActivatorIds.length) {
    throw new Error(`Document activation needs active People as activators: ${invalidActivatorIds.join(", ")}.`);
  }
  const update = resourceIds.map((resourceId) => {
    const entry = entryById.get(resourceId);
    const allowedTypes = governedContentOperation ? ["document", "training"] : ["document"];
    if (!entry || !allowedTypes.includes(entry.record.type)) throw new Error(`Governed content "${resourceId}" was not found in the ${workflowScope} workflow.`);
    const resourceTitle = loaded.model.resources[entry.record.type].title;
    if (entry.record.status !== "approved") {
      throw new Error(`${resourceTitle} "${resourceId}" must be independently approved before its separate ${workflowScope === "engagement" ? "Step 5" : "Step 3"} activation.`);
    }
    if (entry.record.type === "document" && entry.record.workflowScope !== workflowScope) {
      throw new Error(`Document "${resourceId}" belongs to the ${entry.record.workflowScope} workflow, not ${workflowScope}.`);
    }
    const assessment = assessmentById.get(resourceId);
    if (assessment?.state !== "ready-to-activate") {
      const missing = assessment?.missingImplementationControlIds || [];
      throw new Error(
        missing.length
          ? `${resourceTitle} "${resourceId}" cannot be activated until linked Controls are implemented: ${missing.join(", ")}.`
          : `${resourceTitle} "${resourceId}" is not ready for ${workflowScope === "engagement" ? "Step 5" : "Step 3"} activation.`
      );
    }
    if (!/^[a-f0-9]{64}$/.test(expectedRevisions[resourceId] || "")) {
      throw new Error(`Governed-content activation needs the current record revision for "${resourceId}". Regenerate the activation review and try again.`);
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
    operation: governedContentOperation ? "governed-content-activation" : "document-activation",
    workflowScope,
    ...(options.auditId ? { auditId: options.auditId } : {}),
    resourceIds,
    documentIds: update.filter(({ type }) => type === "document").map(({ id }) => id),
    trainingIds: update.filter(({ type }) => type === "training").map(({ id }) => id),
    activatedByIds,
    activatedOn,
    effectiveOn,
    changes: {
      update,
      expectedRevisions: Object.fromEntries(resourceIds.map((resourceId) => [resourceId, expectedRevisions[resourceId]])),
      validateWholeWorkspace: true
    }
  };
}

async function activationCandidates(loaded, options) {
  if (options.auditId) {
    return (await assessAuditDocumentActivations(loaded, {
      auditId: options.auditId,
      asOf: currentCalendarDate(loaded.workspace.timezone)
    })).filter(({ state }) => state === "ready-to-activate")
      .map((item) => ({ ...item, resourceType: "document", resourceId: item.documentId }));
  }
  const readiness = await assessProgramReadiness(loaded, { programId: options.programId });
  return [
    ...readiness.documentActivations.map((item) => ({ ...item, resourceType: "document", resourceId: item.documentId })),
    ...(!options.documentsOnly ? (readiness.trainingActivations || []).map((item) => ({ ...item, resourceType: "training", resourceId: item.trainingId })) : [])
  ].filter(({ state }) => state === "ready-to-activate");
}

export async function activateDocuments(input = process.cwd(), options = {}) {
  if (options.confirmed !== true) throw new Error("Review the governed Document activation and confirm the write.");
  return serializeWorkspaceMutation(input, async (root) => {
    const plan = await planDocumentActivation(root, options);
    const result = plan.operation === "governed-content-activation"
      ? await applyGovernedContentActivationBatch(root, plan.changes)
      : await applyDocumentActivationBatch(root, plan.changes);
    return { ...plan, result };
  });
}

export async function scaffoldGovernedContentActivation(input = process.cwd(), options = {}) {
  const loaded = await loadWorkspace(input);
  requireDocumentLifecycle(loaded);
  if (!modelSupports(loaded.model, "governed-training-activation")) {
    throw new Error("Unified governed-content activation requires a model v6 or later workspace.");
  }
  const candidates = await activationCandidates(loaded, { ...options, auditId: undefined });
  const revisionById = new Map(loaded.entries.map((entry) => [entry.record.id, contentRevision(entry.source)]));
  const today = currentCalendarDate(loaded.workspace.timezone);
  return {
    available: candidates.length > 0,
    message: candidates.length
      ? `${candidates.length} approved governed-content ${candidates.length === 1 ? "record is" : "records are"} ready to activate.`
      : "No program Document or Training record is ready to activate. Review the current readiness actions first.",
    nextCommand: candidates.length ? null : "npx filegrc program-path --next --json",
    resourceIds: candidates.map(({ resourceId }) => resourceId),
    documentIds: candidates.filter(({ resourceType }) => resourceType === "document").map(({ resourceId }) => resourceId),
    trainingIds: candidates.filter(({ resourceType }) => resourceType === "training").map(({ resourceId }) => resourceId),
    workflowScope: "program",
    activatedByIds: [],
    activatedOn: today,
    effectiveOn: today,
    expectedRevisions: Object.fromEntries(candidates.map(({ resourceId }) => [resourceId, revisionById.get(resourceId)])),
    confirmed: false
  };
}

export const planGovernedContentActivation = planDocumentActivation;
export const activateGovernedContent = activateDocuments;

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
