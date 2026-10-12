import { modelSupports } from "../model/index.js";
import { calculationMemo } from "./calculation-cache.js";
import { resourceIndex } from "./resource-index.js";

export function resolveProgram(loaded, requestedId) {
  if (!modelSupports(loaded.model, "program-scope")) return loaded.workspace;
  const programs = resourceIndex(loaded.resources).ofType("program").filter((record) => record.status !== "retired");
  if (requestedId) {
    const program = programs.find(({ id }) => id === requestedId);
    if (requestedId === "program-unconfigured" && !programs.length) {
      return resolveProgram(loaded);
    }
    if (!program) throw new Error(`Program "${requestedId}" was not found or is retired.`);
    return program;
  }
  const active = programs.filter(({ status }) => status === "active");
  if (active.length === 1) return active[0];
  if (active.length > 1) {
    throw new Error(`More than one active Program is available. Select one of: ${active.map(({ id }) => id).join(", ")}.`);
  }
  if (programs.length === 1) return programs[0];
  if (!programs.length) {
    return {
      id: "program-unconfigured",
      type: "program",
      title: "Program not configured",
      status: "planned",
      assuranceGoal: "none",
      frameworkIds: [],
      requirementApplicability: [],
      systemIds: [],
      controlIds: [],
      policyIds: []
    };
  }
  throw new Error(`More than one planned Program is available. Select one of: ${programs.map(({ id }) => id).join(", ")}.`);
}

export function selectedRequirementIds(program, model) {
  if (modelSupports(model, "program-scope")) {
    return (program.requirementApplicability || [])
      .filter(({ decision }) => decision === "applicable")
      .map(({ requirementId }) => requirementId);
  }
  return program.requirementIds || [];
}

export function programComponents(loaded, program) {
  if (!modelSupports(loaded.model, "program-scope")) return [];
  const systemIds = new Set(program.systemIds || []);
  return resourceIndex(loaded.resources).related("component", "systemUses.systemId", systemIds)
    .filter((record) => record.status !== "retired");
}

// Follow authority/source relationships, not owners, evidence, or completion
// records: those links must not make unrelated work enter a Program.
export function recordProgramRelationships(record, byId) {
  return calculationMemo(byId, "program-relationships", [record], () => recordProgramRelationshipsUncached(record, byId));
}

function recordProgramRelationshipsUncached(record, byId) {
  const result = { programIds: new Set(), controlIds: new Set(), policyIds: new Set(), systemIds: new Set(), scopeResourceIds: new Set() };
  const seen = new Set();
  const pending = [record];
  while (pending.length) {
    const source = pending.pop();
    if (!source || seen.has(source.id)) continue;
    seen.add(source.id);
    for (const [type, field] of [["program", "programIds"], ["control", "controlIds"], ["policy", "policyIds"], ["system", "systemIds"]]) {
      if (source.type === type) result[field].add(source.id);
      for (const id of source[field] || []) result[field].add(id);
      const singular = field.slice(0, -1);
      if (source[singular]) result[field].add(source[singular]);
    }
    for (const id of source.scopeResourceIds || []) result.scopeResourceIds.add(id);
    for (const { systemId } of source.systemUses || []) result.systemIds.add(systemId);
    if (source.programId || source.type === "program") continue;
    for (const id of [source.sourceResourceId, source.auditId, source.obligationId, source.componentId, source.sourceComponentId, ...(source.obligationIds || []), ...(source.auditIds || []), ...(source.componentIds || []), ...(source.sourceResourceIds || []), ...(source.scopeResourceIds || []), ...(source.type === "requirement-mapping" ? source.targetResourceIds || [] : [])].filter(Boolean)) {
      pending.push(byId.get(id));
    }
  }
  return Object.fromEntries(Object.entries(result).map(([field, ids]) => [field, [...ids]]));
}

export function recordBelongsToProgram(record, program, byId, model) {
  if (!program || !modelSupports(model, "program-scope") || program.type !== "program") return true;
  if (!record) return false;
  const relationships = recordProgramRelationships(record, byId);
  // Narrower authority wins: a shared Policy or System cannot pull a Control
  // or an engagement owned by another Program into this queue.
  if (relationships.programIds.length) return relationships.programIds.includes(program.id);
  const selected = calculationMemo(byId, "program-membership-selection", [program], () => ({
    controls: new Set(program.controlIds || []),
    systems: new Set(program.systemIds || []),
    policies: new Set([...(program.policyIds || []),
      ...(program.controlIds || []).flatMap((id) => byId.get(id)?.policyIds || [])])
  }));
  if (relationships.controlIds.length) return relationships.controlIds.some((id) => selected.controls.has(id));
  if (relationships.systemIds.length) return relationships.systemIds.some((id) => selected.systems.has(id));
  if (relationships.policyIds.length) return relationships.policyIds.some((id) => selected.policies.has(id));
  return relationships.scopeResourceIds.length === 0;
}
