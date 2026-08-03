import { readFileSync } from "node:fs";

export function loadModel(version = "2") {
  const requested = String(version);
  if (requested !== "2") {
    throw new Error(
      `Unsupported data model version "${requested}". This filegrc release uses model v2. `
      + "Run `npx filegrc migrate --to-model 2 --preview --json` from the workspace root."
    );
  }
  const model = JSON.parse(readFileSync(new URL("./v2.json", import.meta.url), "utf8"));
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
