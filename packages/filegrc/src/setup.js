import { modelSupports } from "../model/index.js";
import { applyResourceBatch } from "./files.js";
import { createResourceId } from "./id.js";
import { resolveProgram, selectedRequirementIds } from "./program.js";
import { loadWorkspace } from "./workspace.js";

const PROGRAM_GOALS = new Set(["none", "readiness", "type-1", "type-2"]);
const CRITICALITIES = new Set(["low", "medium", "high", "critical"]);

export async function setupWorkspace(input = process.cwd(), payload = {}) {
  const loaded = await loadWorkspace(input);
  const setup = normalizeSetupPayload(payload);
  setup.classificationId = resolveClassificationId(loaded, setup.classificationId);
  validateSetup(loaded, setup);
  const plan = buildSetupRecords(loaded, setup);
  const updates = [
    ...(plan.existingSystem ? [plan.system] : []),
    plan.target,
    ...(plan.component ? [plan.component] : []),
    ...(plan.renderer ? [plan.renderer] : [])
  ];
  const revisionById = new Map(loaded.entries.map((entry) => [entry.record.id, entry.revision]));

  await applyResourceBatch(loaded.root, {
    create: [
      ...(plan.existingSystem ? [] : [plan.system]),
      ...(plan.commitment ? [plan.commitment] : [])
    ],
    update: updates,
    expectedRevisions: Object.fromEntries(updates.map((record) => [record.id, revisionById.get(record.id)])),
    validateWholeWorkspace: true
  });

  return {
    draft: setup.draft,
    system: plan.system,
    workspace: plan.target.type === "workspace" ? plan.target : plan.workspace,
    program: plan.target.type === "program" ? plan.target : null,
    renderer: plan.renderer,
    commitment: plan.commitment,
    linkedControlIds: [],
    onboardingComplete: !setup.draft
  };
}

export async function planWorkspaceSetup(input = process.cwd(), payload = {}) {
  const loaded = await loadWorkspace(input);
  const setup = normalizeSetupPayload(payload);
  setup.classificationId = resolveClassificationId(loaded, setup.classificationId);
  validateSetup(loaded, setup);
  const plan = buildSetupRecords(loaded, setup);
  return {
    schemaVersion: 1,
    preview: true,
    draft: setup.draft,
    changes: {
      system: plan.existingSystem ? "update" : "create",
      [plan.target.type]: "update",
      renderer: plan.renderer ? "update" : "unchanged",
      controls: 0,
      commitment: plan.commitment ? "create" : "unchanged"
    },
    system: setupSystemSummary(plan.system),
    target: setupTargetSummary(plan.target, loaded.model),
    renderer: plan.renderer ? setupRendererSummary(plan.renderer) : null,
    commitment: plan.commitment || null,
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
      [result.program ? "program" : "workspace"]: "updated",
      controls: result.linkedControlIds?.length || 0,
      commitment: result.commitment ? "saved" : "unchanged"
    },
    system: setupSystemSummary(result.system),
    target: setupTargetSummary(result.program || result.workspace, {
      modelVersion: result.workspace?.dataModelVersion || (result.program ? "7" : "3")
    }),
    renderer: result.renderer ? setupRendererSummary(result.renderer) : null,
    commitment: result.commitment || null,
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
    classificationId: cleanText(payload.classificationId, "classificationId"),
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
    ["classificationId", setup.classificationId]
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
  const classifications = modelSupports(loaded.model, "program-scope")
    ? loaded.resources.filter(({ type, status }) => type === "classification" && status === "active").map(({ id }) => id)
    : Object.keys(loaded.workspace.classificationDefinitions || {});
  if (classifications.length && !classifications.includes(setup.classificationId)) {
    throw new Error(`classificationId must be one of ${classifications.join(", ")}.`);
  }
}

function resolveClassificationId(loaded, value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return value;
  const candidates = modelSupports(loaded.model, "program-scope")
    ? loaded.resources
      .filter(({ type, status }) => type === "classification" && status === "active")
      .map(({ id, title }) => ({ id, label: title }))
    : Object.entries(loaded.workspace.classificationDefinitions || {})
      .map(([id, label]) => ({ id, label }));
  const matches = candidates.filter(({ id, label }) => (
    id.toLowerCase() === normalized || String(label || "").trim().toLowerCase() === normalized
  ));
  return matches.length === 1 ? matches[0].id : value;
}

function findSetupSystem(resources, target, setup) {
  const scopedSystemIds = new Set(target.systemIds || []);
  return (setup.systemId && resources.find(({ type, id }) => type === "system" && id === setup.systemId))
    || resources.find(({ type, id, title, status }) => (
      type === "system"
      && scopedSystemIds.has(id)
      && status !== "retired"
      && title.trim().toLowerCase() === setup.serviceName.toLowerCase()
    ));
}

function buildSetupRecords(loaded, setup) {
  const target = resolveProgram(loaded);
  const v4 = modelSupports(loaded.model, "program-scope");
  const existingSystem = findSetupSystem(loaded.resources, target, setup);
  const systemId = existingSystem?.id || createResourceId(
    "system",
    setup.serviceName,
    loaded.resources.map(({ id }) => id)
  );
  const system = {
    ...(existingSystem || {}),
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
    ...(v4 ? {
      purpose: existingSystem?.purpose || setup.boundary,
      servicesProvided: existingSystem?.servicesProvided || [setup.serviceName],
      boundary: setup.boundary,
      exclusions: existingSystem?.exclusions || []
    } : {
      description: setup.boundary,
      systemKind: existingSystem?.systemKind || "service"
    }),
    classificationId: setup.classificationId,
    internetExposed: setup.internetExposed
  };
  const existingWorkspace = loaded.resources.find(({ type }) => type === "workspace");
  if (!existingWorkspace) throw new Error("The workspace settings record was not found.");
  const nextTarget = {
    ...target,
    ...(!setup.draft && v4 ? { status: "active" } : {}),
    assuranceGoal: assuranceGoalFromSetup(setup.programGoal),
    systemIds: [...new Set([...(target.systemIds || []), systemId])]
  };
  const componentEntry = v4
    ? loaded.resources.find(({ id, type }) => id === "component-filegrc-program-repository" && type === "component")
    : null;
  const existingSystemUses = componentEntry?.systemUses || [];
  const component = componentEntry ? {
    ...componentEntry,
    status: setup.draft
      ? componentEntry.status || "planned"
      : componentEntry.status === "planned"
        ? "active"
        : componentEntry.status || "active",
    systemUses: [
      ...existingSystemUses.filter((use) => use.systemId !== systemId),
      {
        systemId,
        roles: ["control-support", "evidence-source", "supporting-operations"],
        rationale: "FileGRC stores the Program records, retained evidence index, and Git revision history used to operate and support this System's Controls."
      }
    ]
  } : null;
  const existingRenderer = loaded.resources.find(({ type }) => type === "renderer-settings");
  const renderer = existingRenderer ? { ...existingRenderer, showOnboarding: setup.draft } : null;
  const existingCommitment = loaded.resources.find((record) => (
    record.type === "commitment"
    && !["superseded", "retired"].includes(record.status)
    && (record.systemIds || []).includes(systemId)
  ));
  const commitment = modelSupports(loaded.model, "guided-workflow") && !existingCommitment
    ? {
        id: createResourceId(
          "commitment",
          `${setup.serviceName} service commitment`,
          loaded.resources.map(({ id }) => id)
        ),
        type: "commitment",
        title: `${setup.serviceName} service commitment`,
        status: "planned",
        commitmentKind: "service",
        statement: "[Complete before activation: State the actual customer promise or approved service requirement.]",
        systemIds: [systemId],
        ownerIds: [setup.ownerId],
        customerFacing: true,
        ...(selectedRequirementIds(nextTarget, loaded.model).length ? { requirementIds: selectedRequirementIds(nextTarget, loaded.model) } : {}),
        ...(nextTarget.controlIds?.length ? { controlIds: [...nextTarget.controlIds] } : {})
      }
    : null;
  return { existingSystem, system, workspace: existingWorkspace, target: nextTarget, component, renderer, commitment };
}

function assuranceGoalFromSetup(goal) {
  if (goal === "type-1") return "soc-2-type-1";
  if (goal === "type-2") return "soc-2-type-2";
  if (goal === "readiness") return "readiness";
  return "none";
}

function setupSystemSummary(system) {
  return { ...system };
}

function setupTargetSummary(workspace, model) {
  return {
    assuranceGoal: workspace.assuranceGoal,
    systemIds: [...(workspace.systemIds || [])],
    scopeCounts: {
      systems: workspace.systemIds?.length || 0,
      frameworks: workspace.frameworkIds?.length || 0,
      requirements: selectedRequirementIds(workspace, model).length,
      controls: workspace.controlIds?.length || 0
    }
  };
}

function setupRendererSummary(renderer) {
  return {
    id: renderer.id,
    type: renderer.type,
    showOnboarding: renderer.showOnboarding
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
