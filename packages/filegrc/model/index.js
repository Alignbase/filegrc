import { readFileSync } from "node:fs";

export function loadModel(version = "1") {
  const requested = String(version);
  if (requested !== "1") throw new Error(`Unsupported data model version "${requested}". Available version: 1`);
  return JSON.parse(readFileSync(new URL("./v1.json", import.meta.url), "utf8"));
}

export function getResourceDefinition(model, type) {
  const definition = model.resources[type];
  if (!definition) throw new Error(`Unknown resource type "${type}".`);
  return definition;
}
