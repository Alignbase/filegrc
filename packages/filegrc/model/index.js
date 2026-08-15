import { readFileSync } from "node:fs";

export const ACTIVE_MODEL_VERSION = "4";
export const SUPPORTED_MODEL_VERSIONS = Object.freeze(["2", "3", ACTIVE_MODEL_VERSION]);

export function loadModel(version = ACTIVE_MODEL_VERSION) {
  const requested = String(version);
  if (!SUPPORTED_MODEL_VERSIONS.includes(requested)) {
    const migrationTarget = requested === "1" ? "2" : requested === "2" ? "3" : "4";
    throw new Error(
      `Unsupported data model version "${requested}". This filegrc release supports models v2, v3, and v4. `
      + `Run \`npx filegrc migrate --to-model ${migrationTarget} --preview --json\` from the workspace root.`
    );
  }
  const model = JSON.parse(readFileSync(new URL(`./v${requested}.json`, import.meta.url), "utf8"));
  for (const [type, definition] of Object.entries(model.resources)) {
    for (const [name, field] of Object.entries({ ...model.commonFields, ...definition.fields })) {
      expandRegistryReference(model, field, `${type}.${name}`);
      if (field.relationGroup) {
        const relation = model.relationGroups?.[field.relationGroup];
        if (!Array.isArray(relation) || relation.length === 0) {
          throw new Error(`Model field ${type}.${name} uses unknown relation group "${field.relationGroup}".`);
        }
        field.relation = [...relation];
      }
    }
  }
  for (const [objectType, schema] of Object.entries(model.objectTypes || {})) {
    for (const [name, field] of Object.entries(schema.properties || {})) {
      expandRegistryReference(model, field, `${objectType}.${name}`);
    }
  }
  return model;
}

function expandRegistryReference(model, field, path) {
  if (!field.registry) return;
  const registry = model[field.registry];
  if (!registry || Array.isArray(registry) || typeof registry !== "object") {
    throw new Error(`Model field ${path} uses unknown registry "${field.registry}".`);
  }
  const values = Object.keys(registry);
  if (!values.length) throw new Error(`Model registry "${field.registry}" cannot be empty.`);
  field.values = values;
}

export function getResourceDefinition(model, type) {
  const definition = model.resources[type];
  if (!definition) throw new Error(`Unknown resource type "${type}".`);
  return definition;
}
