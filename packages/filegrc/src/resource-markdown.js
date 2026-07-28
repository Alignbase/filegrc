import { basename, dirname, extname, join } from "node:path";
import { getResourceDefinition } from "../model/index.js";

export function resourceDataPath(model, record) {
  const definition = getResourceDefinition(model, record.type);
  if (definition.singleton) return definition.singleton;
  const recordPath = (definition.recordPath ?? "{id}.json").replaceAll("{id}", record.id);
  return join(definition.collection, recordPath).replaceAll("\\", "/");
}

export function markdownSlots(model, type, record = null) {
  const definition = getResourceDefinition(model, type);
  const dedicated = Object.entries(definition.markdown ?? {}).map(([name, slot]) => ({
    name,
    label: slot.label ?? humanize(name),
    primary: Boolean(slot.primary),
    required: Boolean(slot.required || (record && conditionMatches(record, slot.requiredWhen))),
    requiredWhen: slot.requiredWhen ?? null
  }));
  if (dedicated.length) return dedicated;
  return [{
    name: model.recordContent.slot,
    label: model.recordContent.label,
    primary: true,
    required: false
  }];
}

export function markdownDataPath(model, record, slotName) {
  const slot = markdownSlots(model, record.type, record).find(({ name }) => name === slotName);
  if (!slot) throw new Error(`Unknown Markdown slot "${slotName}" for ${record.type}.`);
  const recordPath = resourceDataPath(model, record);
  const extension = extname(recordPath);
  const stem = basename(recordPath, extension);
  const suffix = slot.primary ? "" : `-${kebabCase(slot.name)}`;
  return join(dirname(recordPath), `${stem}${suffix}.md`).replaceAll("\\", "/");
}

export function markdownEntries(model, record) {
  return markdownSlots(model, record.type, record)
    .map((slot) => ({ ...slot, path: markdownDataPath(model, record, slot.name) }))
    .filter(({ path }) => path);
}

function conditionMatches(record, condition) {
  return condition && Object.entries(condition).every(([name, expected]) => (
    Array.isArray(expected) ? expected.includes(record[name]) : record[name] === expected
  ));
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
