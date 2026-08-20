import { modelSupports } from "../model/index.js";

export function resolveProgram(loaded, requestedId) {
  if (!modelSupports(loaded.model, "program-scope")) return loaded.workspace;
  const programs = loaded.resources.filter((record) => record.type === "program" && record.status !== "retired");
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
  return loaded.resources.filter((record) => (
    record.type === "component"
    && record.status !== "retired"
    && (record.systemUses || []).some(({ systemId }) => systemIds.has(systemId))
  ));
}
