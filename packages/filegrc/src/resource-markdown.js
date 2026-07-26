import { basename, dirname, extname, join } from "node:path";
import { getResourceDefinition } from "../model/index.js";

export function resourceDataPath(model, record) {
  const definition = getResourceDefinition(model, record.type);
  if (definition.singleton) return definition.singleton;
  const recordPath = (definition.recordPath ?? "{id}.json").replaceAll("{id}", record.id);
  return join(definition.collection, recordPath).replaceAll("\\", "/");
}

export function markdownSlots(model, type) {
  const definition = getResourceDefinition(model, type);
  if (model.markdownStorage === "companion") {
    const dedicated = Object.entries(definition.markdown ?? {}).map(([name, slot]) => ({
      name,
      label: slot.label ?? humanize(name),
      primary: Boolean(slot.primary),
      required: Boolean(slot.required),
      legacyField: null
    }));
    if (dedicated.length) return dedicated;
    return [{
      name: model.recordContent.slot,
      label: model.recordContent.label,
      primary: true,
      required: false,
      legacyField: null
    }];
  }

  const fields = { ...model.commonFields, ...definition.fields };
  const required = new Set(definition.required ?? []);
  return Object.entries(fields)
    .filter(([, field]) => field.content)
    .map(([name, field]) => ({
      name,
      label: field.label ?? (name === model.recordContent?.field ? model.recordContent.label : humanize(name.replace(/Path$/, ""))),
      primary: name === "contentPath",
      required: required.has(name) || Boolean(field.required),
      legacyField: name
    }));
}

export function markdownDataPath(model, record, slotName) {
  const slot = markdownSlots(model, record.type).find(({ name }) => name === slotName);
  if (!slot) throw new Error(`Unknown Markdown slot "${slotName}" for ${record.type}.`);
  if (model.markdownStorage !== "companion") {
    const path = record[slot.legacyField];
    return typeof path === "string" && path ? path : null;
  }

  const recordPath = resourceDataPath(model, record);
  const extension = extname(recordPath);
  const stem = basename(recordPath, extension);
  const suffix = slot.primary ? "" : `-${kebabCase(slot.name)}`;
  return join(dirname(recordPath), `${stem}${suffix}.md`).replaceAll("\\", "/");
}

export function markdownEntries(model, record) {
  return markdownSlots(model, record.type)
    .map((slot) => ({ ...slot, path: markdownDataPath(model, record, slot.name) }))
    .filter(({ path }) => path);
}

export function isMarkdownChoice(value) {
  return typeof value === "string" && value.startsWith("$markdown:");
}

function kebabCase(value) {
  return String(value)
    .replace(/Path$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function humanize(value) {
  return String(value)
    .replace(/Path$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (letter) => letter.toUpperCase());
}
