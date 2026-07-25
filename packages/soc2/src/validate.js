import { access } from "node:fs/promises";
import { getResourceDefinition } from "../model/index.js";
import { resolveContentPath, resolveDataPath } from "./paths.js";
import { indexResources, loadWorkspace } from "./workspace.js";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function validateWorkspace(input = process.cwd()) {
  const loaded = typeof input === "object" && input.entries ? input : await loadWorkspace(input);
  const diagnostics = [...loaded.diagnostics];
  const { byId } = indexResources(loaded.resources);
  const seen = new Map();

  for (const entry of loaded.entries) {
    const { record } = entry;
    const displayPath = `data/${entry.relativePath}`;
    if (!record || Array.isArray(record) || typeof record !== "object") {
      diagnostics.push(error("invalid-record", displayPath, "A resource must be a JSON object."));
      continue;
    }
    if (typeof record.id === "string") {
      if (seen.has(record.id)) {
        diagnostics.push(error("duplicate-id", displayPath, `ID "${record.id}" is already used by ${seen.get(record.id)}.`));
      } else {
        seen.set(record.id, displayPath);
      }
    }

    let definition;
    try {
      definition = getResourceDefinition(loaded.model, record.type);
    } catch {
      diagnostics.push(error("unknown-type", displayPath, `Unknown resource type "${record.type ?? ""}".`));
      continue;
    }

    validateLocation(record, definition, entry.relativePath, diagnostics);
    validateRecord(record, definition, loaded.model, displayPath, diagnostics);

    const fields = { ...loaded.model.commonFields, ...definition.fields };
    for (const [fieldName, field] of Object.entries(fields)) {
      const value = record[fieldName];
      if (value === undefined || value === null) continue;
      if (field.content || field.format === "data-path" || field.items === "data-path") {
        const values = Array.isArray(value) ? value : [value];
        for (const item of values) {
          if (typeof item !== "string") continue;
          try {
            await access(field.content ? resolveContentPath(loaded.root, item) : resolveDataPath(loaded.root, item));
          } catch {
            diagnostics.push(error(
              "missing-content",
              displayPath,
              `${fieldName} points to unavailable data path "${item}".`
            ));
          }
        }
      }
      if (field.relation) {
        const ids = Array.isArray(value) ? value : [value];
        for (const id of ids) {
          const target = byId.get(id);
          if (!target) {
            diagnostics.push(error("missing-reference", displayPath, `${fieldName} references unknown ID "${id}".`));
            continue;
          }
          const allowed = field.relation;
          if (!allowed.includes("*") && !allowed.includes(target.type)) {
            diagnostics.push(error(
              "wrong-reference-type",
              displayPath,
              `${fieldName} references ${target.type} "${id}", expected ${allowed.join(" or ")}.`
            ));
          }
        }
      }
    }
  }

  diagnostics.sort((a, b) => `${a.severity}:${a.path}:${a.code}`.localeCompare(`${b.severity}:${b.path}:${b.code}`));
  return {
    ok: !diagnostics.some(({ severity }) => severity === "error"),
    diagnostics,
    counts: {
      resources: loaded.resources.length,
      errors: diagnostics.filter(({ severity }) => severity === "error").length,
      warnings: diagnostics.filter(({ severity }) => severity === "warning").length
    },
    loaded
  };
}

function validateLocation(record, definition, relativePath, diagnostics) {
  if (definition.singleton) {
    if (relativePath !== definition.singleton) {
      diagnostics.push(error("wrong-location", `data/${relativePath}`, `${record.type} belongs at data/${definition.singleton}.`));
    }
    return;
  }
  const recordPath = (definition.recordPath ?? "{id}.json").replaceAll("{id}", record.id);
  const expected = `${definition.collection}/${recordPath}`;
  if (relativePath !== expected) {
    diagnostics.push(error("wrong-location", `data/${relativePath}`, `${record.type} belongs at data/${expected}.`));
  }
}

function validateRecord(record, definition, model, path, diagnostics) {
  const fields = { ...model.commonFields, ...definition.fields };
  const required = new Set([
    ...Object.entries(model.commonFields).filter(([, field]) => field.required).map(([name]) => name),
    ...(definition.required ?? [])
  ]);
  for (const [name, field] of Object.entries(fields)) {
    if (field.requiredWhen && conditionMatches(record, field.requiredWhen)) required.add(name);
  }
  for (const name of required) {
    if (isMissing(record[name])) {
      diagnostics.push(error("missing-field", path, `Required field "${name}" is missing.`));
    }
  }
  if (record.type && record.type !== findDefinitionType(model, definition)) {
    diagnostics.push(error("wrong-type", path, `Resource type "${record.type}" does not match its model definition.`));
  }

  for (const [name, value] of Object.entries(record)) {
    const field = fields[name];
    if (!field) {
      diagnostics.push(warning("unknown-field", path, `Field "${name}" is not defined by model v${model.modelVersion}.`));
      continue;
    }
    validateValue(name, value, field, model, path, diagnostics);
  }

  for (const choices of definition.oneOf ?? []) {
    if (!choices.some((name) => !isMissing(record[name]))) {
      diagnostics.push(error("missing-choice", path, `At least one of ${choices.join(", ")} is required.`));
    }
  }
}

function isMissing(value) {
  return value === undefined
    || value === null
    || (typeof value === "string" && value.trim() === "")
    || (Array.isArray(value) && value.length === 0);
}

function validateValue(name, value, field, model, path, diagnostics) {
  const fail = (message) => diagnostics.push(error("invalid-field", path, `${name}: ${message}`));
  if (field.const !== undefined && value !== field.const) fail(`must equal ${JSON.stringify(field.const)}.`);
  switch (field.type) {
    case "string":
    case "id":
    case "date":
    case "timestamp":
    case "enum":
    case "rating":
    case "outcome":
      if (typeof value !== "string") {
        fail("must be a string.");
        return;
      }
      break;
    case "integer":
      if (!Number.isInteger(value)) fail("must be an integer.");
      return;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) fail("must be a finite number.");
      return;
    case "boolean":
      if (typeof value !== "boolean") fail("must be a boolean.");
      return;
    case "object":
      if (!value || Array.isArray(value) || typeof value !== "object") fail("must be an object.");
      return;
    case "array":
      if (!Array.isArray(value)) {
        fail("must be an array.");
        return;
      }
      for (const item of value) validateArrayItem(name, item, field.items, path, diagnostics);
      return;
    default:
      fail(`uses unsupported model type "${field.type}".`);
      return;
  }

  const enumValues = field.values
    ?? (field.type === "rating" ? model.primitives?.rating : undefined)
    ?? (field.type === "outcome" ? model.primitives?.outcome : undefined);
  if (enumValues && !enumValues.includes(value)) fail(`must be one of ${enumValues.join(", ")}.`);
  if ((field.type === "id" || field.format === "id") && !ID_PATTERN.test(value)) fail("must use lowercase kebab-case.");
  if ((field.type === "date" || field.format === "date") && !isDate(value)) fail("must be an ISO 8601 date (YYYY-MM-DD).");
  if (field.type === "timestamp" && (!TIMESTAMP_PATTERN.test(value) || Number.isNaN(Date.parse(value)))) {
    fail("must be an RFC 3339 timestamp with a timezone.");
  }
  if (field.format === "email" && !EMAIL_PATTERN.test(value)) fail("must be an email address.");
}

function validateArrayItem(name, value, type, path, diagnostics) {
  if (type === "object" && (!value || Array.isArray(value) || typeof value !== "object")) {
    diagnostics.push(error("invalid-field", path, `${name} items must be objects.`));
  } else if ((type === "string" || type === "data-path") && typeof value !== "string") {
    diagnostics.push(error("invalid-field", path, `${name} items must be strings.`));
  } else if (type === "id" && (typeof value !== "string" || !ID_PATTERN.test(value))) {
    diagnostics.push(error("invalid-field", path, `${name} items must be lowercase kebab-case IDs.`));
  }
}

function isDate(value) {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().startsWith(value);
}

function conditionMatches(record, condition) {
  return Object.entries(condition).every(([name, value]) => record[name] === value);
}

function findDefinitionType(model, definition) {
  return Object.entries(model.resources).find(([, item]) => item === definition)?.[0];
}

function error(code, path, message) {
  return { severity: "error", code, path, message };
}

function warning(code, path, message) {
  return { severity: "warning", code, path, message };
}
