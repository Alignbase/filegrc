import {
  applyResourceBatch,
  contentRevision,
  createResource,
  INTERNAL_WORKFLOW_CAPABILITIES,
  updateResource
} from "./files.js";
import { modelSupports } from "../model/index.js";
import { currentCalendarDate } from "./time.js";
import { loadWorkspace } from "./workspace.js";

export async function scaffoldAuditPopulationCorrection(input, options = {}) {
  const loaded = await loadWorkspace(input);
  if (!modelSupports(loaded.model, "rolled-up-obligations")) {
    throw new Error("Audit population correction requires data model v9.");
  }
  const entry = loaded.entries.find(({ record }) => (
    record.type === "audit-population" && record.id === options.populationId
  ));
  if (!entry) throw new Error(`Audit population "${options.populationId || ""}" was not found.`);
  if (!["reconciled", "not-applicable"].includes(entry.record.status)) {
    throw new Error(`Audit population "${entry.record.id}" must be finalized before it can be corrected.`);
  }
  const correctionDate = options.asOf || currentCalendarDate(loaded.workspace.timezone);
  const affectedControlTests = loaded.resources
    .filter((record) => record.type === "control-test" && record.populationId === entry.record.id)
    .map(({ id, title, status, controlId }) => ({ id, title, status, controlId }));
  const record = {
    ...entry.record,
    id: `${entry.record.id}-correction-${correctionDate}`,
    title: `${entry.record.title} correction`,
    status: "planned",
    supersedesId: entry.record.id
  };
  delete record.reconciledByIds;
  delete record.reconciledOn;
  delete record.conclusion;
  return {
    operation: "supersede",
    record,
    revision: contentRevision(entry.source),
    affectedControlTests,
    instructions: affectedControlTests.length
      ? "Correct the population facts and link the fixed replacement export. Saving preserves the original and marks tests based on it as stale until replacement tests use this correction."
      : "Correct the population facts, link the fixed replacement export, and record a new reconciliation. Saving preserves the original as superseded."
  };
}

export async function saveAuditPopulation(input, options = {}) {
  const record = options.record;
  if (record?.type !== "audit-population") throw new Error("An Audit population record is required.");
  const loaded = await loadWorkspace(input);
  const existing = loaded.entries.find(({ record: current }) => current.id === record.id);
  if (record.supersedesId) {
    requireMutationRevision(options.expectedRevision, `Audit population "${record.supersedesId}"`);
    if (existing) throw new Error(`Superseding Audit population "${record.id}" already exists.`);
    const predecessor = loaded.entries.find(({ record: current }) => (
      current.type === "audit-population" && current.id === record.supersedesId
    ));
    if (!predecessor) throw new Error(`Superseded Audit population "${record.supersedesId}" was not found.`);
    if (!["reconciled", "not-applicable"].includes(predecessor.record.status)) {
      throw new Error(`Audit population "${predecessor.record.id}" must be finalized before it can be superseded.`);
    }
    if (
      predecessor.record.auditId !== record.auditId
      || predecessor.record.populationKind !== record.populationKind
    ) {
      throw new Error("A correction must keep the same Audit and population kind as its predecessor.");
    }
    return applyResourceBatch(input, {
      workflowCapability: INTERNAL_WORKFLOW_CAPABILITIES.auditPopulationSupersession,
      create: [record],
      update: [{ ...predecessor.record, status: "superseded" }],
      contentUpdates: { [record.id]: options.content || {} },
      expectedRevisions: { [predecessor.record.id]: options.expectedRevision }
    });
  }
  if (existing) requireMutationRevision(options.expectedRevision, `Audit population "${record.id}"`);
  return existing
    ? updateResource(input, "audit-population", record.id, record, { expectedRevision: options.expectedRevision, content: options.content })
    : createResource(input, record, { content: options.content });
}

function requireMutationRevision(revision, target) {
  if (typeof revision !== "string" || revision.length === 0) {
    throw new Error(`A revision is required when changing ${target}. Reload the resource and try again.`);
  }
}
