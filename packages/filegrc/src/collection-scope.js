import { programComponents } from "./program.js";

export function scopedCollectionRecords(loaded, resourceType, program) {
  if (String(loaded.model.modelVersion) !== "4") {
    return loaded.resources.filter((record) => record.type === resourceType);
  }
  if (resourceType === "vendor") {
    return loaded.resources.filter((record) => record.type === "vendor");
  }
  const scopedProgram = program || {};
  const components = programComponents(loaded, scopedProgram);
  const componentIds = new Set(components.map(({ id }) => id));
  const selected = {
    system: new Set(scopedProgram.systemIds || []),
    component: componentIds,
    framework: new Set(scopedProgram.frameworkIds || []),
    asset: new Set(loaded.resources.filter((record) => (
      record.type === "asset" && (record.componentIds || []).some((id) => componentIds.has(id))
    )).map(({ id }) => id))
  }[resourceType];
  return loaded.resources.filter((record) => (
    record.type === resourceType && (!selected || selected.has(record.id))
  ));
}
