import { createResource, updateResource } from "./files.js";
import { createResourceId } from "./id.js";
import { loadWorkspace } from "./workspace.js";

const AUDIT_GOALS = new Set(["none", "readiness", "type-1", "type-2"]);
const CRITICALITIES = new Set(["low", "medium", "high", "critical"]);
const INDEPENDENT_APPROVER_ID = "person-independent-approver";
const OVERSIGHT_TEAM_ID = "team-security-risk-oversight";

export async function setupWorkspace(input = process.cwd(), payload = {}) {
  const loaded = await loadWorkspace(input);
  const setup = normalizeSetupPayload(payload);
  validateSetup(loaded, setup);

  let approver = null;
  if (setup.independentApproverName && setup.independentApproverEmail) {
    const existing = loaded.resources.find(({ id }) => id === INDEPENDENT_APPROVER_ID);
    approver = {
      ...(existing || {}),
      schemaVersion: 1,
      id: INDEPENDENT_APPROVER_ID,
      type: "person",
      title: setup.independentApproverName,
      status: "external",
      email: setup.independentApproverEmail,
      role: "External Security and Risk Oversight Reviewer",
      employmentType: "external-reviewer",
      ...(loaded.resources.some(({ id }) => id === OVERSIGHT_TEAM_ID) ? { teamIds: [OVERSIGHT_TEAM_ID] } : {})
    };
    await upsertResource(loaded.root, existing, approver);
  }

  let current = await loadWorkspace(loaded.root);
  let system = findSetupSystem(current.resources, setup);
  const systemId = system?.id || createResourceId("system", setup.serviceName, current.resources.map(({ id }) => id));
  system = {
    ...(system || {}),
    schemaVersion: 1,
    id: systemId,
    type: "system",
    title: setup.serviceName,
    status: setup.draft ? system?.status || "planned" : (system?.status === "planned" ? "active" : system?.status || "active"),
    criticality: setup.criticality,
    ownerIds: [setup.ownerId],
    description: setup.boundary,
    systemKind: system?.systemKind || "service",
    dataClassification: setup.dataClassification,
    internetExposed: setup.internetExposed,
    inScope: true
  };
  await upsertResource(current.root, current.resources.find(({ id }) => id === systemId), system);

  current = await loadWorkspace(current.root);
  const linkedControlIds = [];
  for (const control of current.resources.filter(({ type, status }) => (
    type === "control" && !["not-applicable", "retired"].includes(status)
  ))) {
    if ((control.systemIds || []).includes(systemId)) continue;
    await updateResource(current.root, "control", control.id, {
      ...control,
      systemIds: [...new Set([...(control.systemIds || []), systemId])]
    });
    linkedControlIds.push(control.id);
  }

  current = await loadWorkspace(current.root);
  let audit = null;
  if (setup.auditGoal !== "none") {
    audit = findSetupAudit(current.resources, setup, systemId);
    const kind = auditKindFromGoal(setup.auditGoal);
    const title = `${setup.serviceName} ${auditTitleFromGoal(setup.auditGoal)}`;
    const auditId = audit?.id || createResourceId("audit", title, current.resources.map(({ id }) => id));
    audit = {
      ...(audit || {}),
      schemaVersion: 1,
      id: auditId,
      type: "audit",
      title: audit?.title || title,
      status: audit?.status || "planned",
      auditKind: kind,
      frameworkIds: audit?.frameworkIds || current.resources
        .filter(({ type, status }) => type === "framework" && status === "active")
        .map(({ id }) => id),
      scope: setup.boundary,
      ownerIds: [setup.ownerId],
      systemIds: [...new Set([...(audit?.systemIds || []), systemId])],
      requirementIds: audit?.requirementIds || current.resources
        .filter(({ type, applicability }) => type === "requirement" && applicability === "applicable")
        .map(({ id }) => id),
      controlIds: audit?.controlIds || current.resources
        .filter(({ type, status }) => type === "control" && !["not-applicable", "retired"].includes(status))
        .map(({ id }) => id),
      contactIds: [...new Set([...(audit?.contactIds || []), setup.ownerId])]
    };
    await upsertResource(current.root, current.resources.find(({ id }) => id === auditId), audit);
  }

  current = await loadWorkspace(current.root);
  const renderer = current.resources.find(({ type }) => type === "renderer-settings");
  if (renderer) {
    await updateResource(current.root, renderer.type, renderer.id, {
      ...renderer,
      showOnboarding: setup.draft
    });
  }

  return {
    draft: setup.draft,
    system,
    audit,
    independentApprover: approver,
    linkedControlIds,
    onboardingComplete: !setup.draft
  };
}

export function normalizeSetupPayload(payload = {}) {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    throw new Error("Setup input must be a JSON object.");
  }
  const approver = payload.independentApprover;
  const draft = payload.draft === true;
  return {
    serviceName: cleanText(payload.serviceName, "serviceName"),
    boundary: cleanMultilineText(payload.boundary ?? payload.scope, "boundary"),
    ownerId: cleanText(payload.ownerId ?? payload.owner, "ownerId"),
    criticality: cleanText(payload.criticality, "criticality"),
    dataClassification: cleanText(payload.dataClassification ?? payload.classification, "dataClassification"),
    internetExposed: booleanValue(payload.internetExposed, "internetExposed"),
    independentApproverName: cleanOptionalText(
      payload.independentApproverName ?? approver?.name,
      "independentApproverName"
    ),
    independentApproverEmail: cleanOptionalText(
      payload.independentApproverEmail ?? approver?.email,
      "independentApproverEmail"
    ),
    auditGoal: cleanText(payload.auditGoal ?? "none", "auditGoal"),
    draft,
    systemId: cleanOptionalText(payload.systemId, "systemId"),
    auditId: cleanOptionalText(payload.auditId, "auditId")
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
  if (setup.independentApproverName.length > 200) {
    throw new Error("independentApproverName must be 200 characters or fewer.");
  }
  if (setup.independentApproverEmail.length > 320) {
    throw new Error("independentApproverEmail must be 320 characters or fewer.");
  }
  if (!CRITICALITIES.has(setup.criticality)) {
    throw new Error(`criticality must be one of ${[...CRITICALITIES].join(", ")}.`);
  }
  if (!AUDIT_GOALS.has(setup.auditGoal)) {
    throw new Error(`auditGoal must be one of ${[...AUDIT_GOALS].join(", ")}.`);
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
  if (setup.auditId && !loaded.resources.some(({ id, type }) => id === setup.auditId && type === "audit")) {
    throw new Error(`Audit "${setup.auditId}" was not found.`);
  }
  const classifications = Object.keys(loaded.workspace.classificationDefinitions || {});
  if (classifications.length && !classifications.includes(setup.dataClassification)) {
    throw new Error(`dataClassification must be one of ${classifications.join(", ")}.`);
  }
  const hasApproverName = Boolean(setup.independentApproverName);
  const hasApproverEmail = Boolean(setup.independentApproverEmail);
  if (hasApproverName !== hasApproverEmail) {
    throw new Error("Independent approver name and email must be provided together.");
  }
  if (!setup.draft && !hasApproverName) {
    throw new Error("An independent approver name and email are required to complete setup. Save a draft to appoint the reviewer later.");
  }
  if (hasApproverEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(setup.independentApproverEmail)) {
    throw new Error("Independent approver email must be valid.");
  }
  const policyOwner = loaded.resources.find(({ id, type }) => id === "person-policy-owner" && type === "person");
  const conflictingPeople = [owner, policyOwner].filter(Boolean);
  if (hasApproverName && conflictingPeople.some((person) => (
    person.title?.trim().toLowerCase() === setup.independentApproverName.toLowerCase()
    || person.email?.trim().toLowerCase() === setup.independentApproverEmail.toLowerCase()
  ))) {
    throw new Error("The independent approver must be a different person from the policy owner.");
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

function findSetupAudit(resources, setup, systemId) {
  return (setup.auditId && resources.find(({ type, id }) => type === "audit" && id === setup.auditId))
    || resources.find(({ type, auditKind, systemIds }) => (
      type === "audit"
      && auditKind === auditKindFromGoal(setup.auditGoal)
      && (systemIds || []).includes(systemId)
    ));
}

async function upsertResource(root, existing, record) {
  return existing
    ? updateResource(root, record.type, record.id, record)
    : createResource(root, record);
}

function auditKindFromGoal(goal) {
  return goal === "type-1" ? "soc-2-type-1" : goal === "type-2" ? "soc-2-type-2" : "readiness";
}

function auditTitleFromGoal(goal) {
  return goal === "type-1" ? "SOC 2 Type 1" : goal === "type-2" ? "SOC 2 Type 2" : "SOC 2 readiness assessment";
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
