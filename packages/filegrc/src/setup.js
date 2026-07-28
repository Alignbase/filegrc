import { createResource, updateResource } from "./files.js";
import { createResourceId } from "./id.js";
import { loadWorkspace } from "./workspace.js";

const PROGRAM_GOALS = new Set(["none", "readiness", "type-1", "type-2"]);
const CRITICALITIES = new Set(["low", "medium", "high", "critical"]);

export async function setupWorkspace(input = process.cwd(), payload = {}) {
  const loaded = await loadWorkspace(input);
  const setup = normalizeSetupPayload(payload);
  validateSetup(loaded, setup);
  const plan = buildSetupRecords(loaded, setup);

  await upsertResource(loaded.root, plan.existingSystem, plan.system);
  await updateResource(loaded.root, "workspace", plan.workspace.id, plan.workspace);
  if (plan.renderer) await updateResource(loaded.root, plan.renderer.type, plan.renderer.id, plan.renderer);

  return {
    draft: setup.draft,
    system: plan.system,
    workspace: plan.workspace,
    linkedControlIds: [],
    evidenceTestDraftIds: [],
    onboardingComplete: !setup.draft
  };
}

export async function planWorkspaceSetup(input = process.cwd(), payload = {}) {
  const loaded = await loadWorkspace(input);
  const setup = normalizeSetupPayload(payload);
  validateSetup(loaded, setup);
  const plan = buildSetupRecords(loaded, setup);
  return {
    schemaVersion: 1,
    preview: true,
    draft: setup.draft,
    changes: {
      system: plan.existingSystem ? "update" : "create",
      workspace: "update",
      renderer: plan.renderer ? "update" : "unchanged",
      controls: 0,
      evidenceDrafts: 0
    },
    system: setupSystemSummary(plan.system),
    target: setupTargetSummary(plan.workspace),
    onboardingComplete: !setup.draft
  };
}

export function summarizeSetupResult(result) {
  return {
    schemaVersion: 1,
    preview: false,
    draft: result.draft,
    changes: {
      system: "saved",
      workspace: "updated",
      controls: result.linkedControlIds?.length || 0,
      evidenceDrafts: result.evidenceTestDraftIds?.length || 0
    },
    system: setupSystemSummary(result.system),
    target: setupTargetSummary(result.workspace),
    onboardingComplete: result.onboardingComplete
  };
}

export function normalizeSetupPayload(payload = {}) {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    throw new Error("Setup input must be a JSON object.");
  }
  const draft = payload.draft === true;
  return {
    serviceName: cleanText(payload.serviceName, "serviceName"),
    boundary: cleanMultilineText(payload.boundary ?? payload.scope, "boundary"),
    ownerId: cleanText(payload.ownerId ?? payload.owner, "ownerId"),
    criticality: cleanText(payload.criticality, "criticality"),
    dataClassification: cleanText(payload.dataClassification ?? payload.classification, "dataClassification"),
    internetExposed: booleanValue(payload.internetExposed, "internetExposed"),
    programGoal: cleanText(payload.programGoal ?? "none", "programGoal"),
    draft,
    systemId: cleanOptionalText(payload.systemId, "systemId")
  };
}

function validateSetup(loaded, setup) {
  for (const [name, value] of [
    ["serviceName", setup.serviceName],
    ["boundary", setup.boundary],
    ["ownerId", setup.ownerId],
    ["criticality", setup.criticality],
    ["dataClassification", setup.dataClassification]
  ]) {
    if (!value) throw new Error(`Setup field "${name}" is required.`);
  }
  if (setup.serviceName.length > 200) throw new Error("serviceName must be 200 characters or fewer.");
  if (setup.boundary.length > 2_000) throw new Error("boundary must be 2,000 characters or fewer.");
  if (!CRITICALITIES.has(setup.criticality)) {
    throw new Error(`criticality must be one of ${[...CRITICALITIES].join(", ")}.`);
  }
  if (!PROGRAM_GOALS.has(setup.programGoal)) {
    throw new Error(`programGoal must be one of ${[...PROGRAM_GOALS].join(", ")}.`);
  }
  const owner = loaded.resources.find(({ id, type }) => id === setup.ownerId && type === "person");
  if (!owner || owner.status !== "active") throw new Error(`Active person "${setup.ownerId}" was not found.`);
  if (setup.systemId) {
    const system = loaded.resources.find(({ id, type }) => id === setup.systemId && type === "system");
    if (!system) throw new Error(`System "${setup.systemId}" was not found.`);
    if (["deprecated", "retired"].includes(system.status)) {
      throw new Error(`System "${setup.systemId}" cannot be used for initial scope because it is ${system.status}.`);
    }
  }
  const classifications = Object.keys(loaded.workspace.classificationDefinitions || {});
  if (classifications.length && !classifications.includes(setup.dataClassification)) {
    throw new Error(`dataClassification must be one of ${classifications.join(", ")}.`);
  }
}

function findSetupSystem(resources, setup) {
  return (setup.systemId && resources.find(({ type, id }) => type === "system" && id === setup.systemId))
    || resources.find(({ type, title, inScope, status }) => (
      type === "system"
      && inScope === true
      && status !== "retired"
      && title.trim().toLowerCase() === setup.serviceName.toLowerCase()
    ));
}

function buildSetupRecords(loaded, setup) {
  const existingSystem = findSetupSystem(loaded.resources, setup);
  const systemId = existingSystem?.id || createResourceId(
    "system",
    setup.serviceName,
    loaded.resources.map(({ id }) => id)
  );
  const system = {
    ...(existingSystem || {}),
    schemaVersion: 1,
    id: systemId,
    type: "system",
    title: setup.serviceName,
    status: setup.draft
      ? existingSystem?.status || "planned"
      : existingSystem?.status === "planned"
        ? "active"
        : existingSystem?.status || "active",
    criticality: setup.criticality,
    ownerIds: [setup.ownerId],
    description: setup.boundary,
    systemKind: existingSystem?.systemKind || "service",
    dataClassification: setup.dataClassification,
    internetExposed: setup.internetExposed,
    inScope: true
  };
  const existingWorkspace = loaded.resources.find(({ type }) => type === "workspace");
  if (!existingWorkspace) throw new Error("The workspace settings record was not found.");
  const workspace = {
    ...existingWorkspace,
    assuranceGoal: assuranceGoalFromSetup(setup.programGoal),
    systemIds: [...new Set([...(existingWorkspace.systemIds || []), systemId])]
  };
  const existingRenderer = loaded.resources.find(({ type }) => type === "renderer-settings");
  const renderer = existingRenderer ? { ...existingRenderer, showOnboarding: setup.draft } : null;
  return { existingSystem, system, workspace, renderer };
}

async function upsertResource(root, existing, record) {
  return existing
    ? updateResource(root, record.type, record.id, record)
    : createResource(root, record);
}

function assuranceGoalFromSetup(goal) {
  if (goal === "type-1") return "soc-2-type-1";
  if (goal === "type-2") return "soc-2-type-2";
  if (goal === "readiness") return "readiness";
  return "none";
}

function setupSystemSummary(system) {
  return {
    id: system.id,
    title: system.title,
    status: system.status,
    inScope: system.inScope
  };
}

function setupTargetSummary(workspace) {
  return {
    assuranceGoal: workspace.assuranceGoal,
    scopeCounts: {
      systems: workspace.systemIds?.length || 0,
      frameworks: workspace.frameworkIds?.length || 0,
      requirements: workspace.requirementIds?.length || 0,
      controls: workspace.controlIds?.length || 0
    }
  };
}

function booleanValue(value, name) {
  if (value === true || value === false) return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`Setup field "${name}" must be true or false.`);
}

function cleanText(value, name) {
  if (value === undefined || value === null) return "";
  const result = String(value).trim();
  if (/[\u0000-\u001f\u007f]/.test(result)) throw new Error(`Setup field "${name}" contains control characters.`);
  return result;
}

function cleanMultilineText(value, name) {
  if (value === undefined || value === null) return "";
  const result = String(value).trim();
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result)) {
    throw new Error(`Setup field "${name}" contains unsupported control characters.`);
  }
  return result;
}

function cleanOptionalText(value, name) {
  return value === undefined || value === null || value === "" ? "" : cleanText(value, name);
}
