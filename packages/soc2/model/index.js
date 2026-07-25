import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const modelDirectory = path.dirname(fileURLToPath(import.meta.url));

export function availableModelVersions() {
  return fs
    .readdirSync(modelDirectory)
    .map((name) => /^v(.+)\.json$/.exec(name)?.[1])
    .filter(Boolean)
    .sort();
}

export function loadModel(version = "1") {
  const file = path.join(modelDirectory, `v${version}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(
      `Unsupported data model version "${version}". Available versions: ${availableModelVersions().join(", ")}`,
    );
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function getResourceDefinition(model, type) {
  const definition = model.resources[type];
  if (!definition) throw new Error(`Unknown resource type "${type}".`);
  return definition;
}
