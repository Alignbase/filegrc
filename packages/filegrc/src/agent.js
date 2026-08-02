import { createResourceId } from "./id.js";
import { markdownEntries } from "./resource-markdown.js";
import { RESOURCE_INSTRUCTIONS, resourceProgramContext } from "./program-path.js";

const STARTING_STATUS_ORDER = [
  "draft",
  "planned",
  "open",
  "in-progress",
  "pending",
  "active"
];

export function listResourceTypes(model) {
  return Object.entries(model.resources)
    .map(([type, definition]) => ({
      type,
      title: definition.title,
      pluralTitle: definition.pluralTitle,
      group: definition.group ?? null,
      singleton: definition.singleton ?? null,
      collection: definition.collection ?? null,
      purpose: definition.description
    }))
    .sort((left, right) => `${left.group}:${left.type}`.localeCompare(`${right.group}:${right.type}`));
}

export function buildAgentGuide(loaded, type, options = {}) {
  const definition = loaded.model.resources[type];
  if (!definition) throw new Error(`Unknown resource type "${type}".`);
  const fields = { ...loaded.model.commonFields, ...definition.fields };
  const required = new Set([
    ...Object.entries(loaded.model.commonFields)
      .filter(([, field]) => field.required)
      .map(([name]) => name),
    ...(definition.required ?? [])
  ]);
  const record = {
    type,
    id: options.id || "{id}"
  };
  const markdown = markdownEntries(loaded.model, record).map((slot) => ({
    ...slot,
    path: `data/${slot.path}`,
    recommended: slot.required
      || Boolean(definition.markdown)
      || loaded.model.recordContent.defaultResourceTypes.includes(type)
  }));
  const fieldList = Object.entries(fields).map(([name, field]) => {
    const relation = field.relation
      ? relationContext(loaded.resources, field.relation)
      : null;
    return {
      name,
      label: field.label ?? humanize(name),
      type: field.type,
      required: required.has(name),
      requiredWhen: field.requiredWhen ?? null,
      const: field.const,
      values: allowedValues(loaded.model, field),
      relation,
      disjointFrom: field.disjointFrom ?? null,
      format: field.format ?? null,
      ...(field.legacy ? {
        legacy: true,
        authoritativeFields: field.authoritativeFields ?? []
      } : {})
    };
  });
  const requiredAtCreation = fieldList.filter(({ required: isRequired }) => isRequired);
  const conditionalRequirements = fieldList.filter(({ requiredWhen, required: isRequired }) => requiredWhen && !isRequired);
  const optionalFields = fieldList.filter(({ required, requiredWhen, legacy }) => !required && !requiredWhen && !legacy);
  const legacyFields = fieldList.filter(({ legacy }) => legacy);
  const recommendedMarkdown = markdown.filter(({ recommended }) => recommended);
  const location = definition.singleton
    ? `data/${definition.singleton}`
    : `data/${definition.collection}/${(definition.recordPath ?? "{id}.json").replaceAll("{id}", options.id || "{id}")}`;

  return {
    type,
    title: definition.title,
    pluralTitle: definition.pluralTitle,
    instructions: RESOURCE_INSTRUCTIONS[type] || definition.description,
    use: definition.description,
    purpose: definition.description,
    programStep: resourceProgramContext(type),
    policyBasis: definition.guidance.policyBasis,
    cadence: definition.guidance.cadence,
    policySourceIds: definition.guidance.sourceResourceIds ?? [],
    obligationActivityTypes: definition.guidance.obligationActivityTypes ?? [],
    location,
    singleton: Boolean(definition.singleton),
    requiredAtCreation,
    conditionalRequirements,
    optionalFields,
    legacyFields,
    oneOf: definition.oneOf ?? [],
    markdown,
    workflow: [
      "Inspect existing records and relation candidates before writing.",
      definition.singleton
        ? "Open the existing singleton record, then replace every null value and empty required array with facts from an authoritative source."
        : "Create a scaffold, then replace every null value and empty required array with facts from an authoritative source.",
      recommendedMarkdown.length
        ? "Keep model fields in JSON and use the recommended Markdown companion for the detailed work, decisions, results, exceptions, and follow-up that apply to this record."
        : "Keep the current facts and lifecycle state in JSON. Add optional Record Markdown only when the model fields cannot explain the record clearly.",
      "Run npx filegrc validate, review the full Git diff, and commit the JSON, Markdown, and attachments together with a message that explains why the record changed."
    ],
    completionChecks: [
      "Required and status-dependent fields are complete, and the lifecycle status matches the facts.",
      "Every relationship resolves to the intended existing record.",
      "Dates describe the business event in the workspace time zone, not the file edit time.",
      ...(recommendedMarkdown.length
        ? ["Required or recommended Markdown explains the work, decisions, results, exceptions, and follow-up that apply."]
        : ["The structured fields state the current fact clearly; optional Record Markdown is added only when needed."]),
      ...(legacyFields.length
        ? ["No legacy compatibility field is added or updated; use the listed authoritative fields instead."]
        : []),
      "No secrets or personal data that may need erasure were added to Git."
    ]
  };
}

export function scaffoldResourceMutation(loaded, type, title, options = {}) {
  const definition = loaded.model.resources[type];
  if (!definition) throw new Error(`Unknown resource type "${type}".`);
  if (definition.singleton) {
    throw new Error(`${definition.title} is a singleton at data/${definition.singleton}; update the existing record instead.`);
  }
  const normalizedTitle = String(title ?? "").trim();
  if (!normalizedTitle) throw new Error("A non-empty --title is required.");
  const id = options.id
    ? String(options.id)
    : createResourceId(type, normalizedTitle, loaded.resources.map((record) => record.id));
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw new Error("The scaffold ID must use lowercase kebab-case.");
  }
  if (loaded.resources.some((record) => record.id === id)) {
    throw new Error(`Resource ID "${id}" already exists.`);
  }

  const fields = { ...loaded.model.commonFields, ...definition.fields };
  const required = new Set([
    ...Object.entries(loaded.model.commonFields)
      .filter(([, field]) => field.required)
      .map(([name]) => name),
    ...(definition.required ?? [])
  ]);
  const record = {
    schemaVersion: 1,
    id,
    type,
    title: normalizedTitle
  };
  for (const name of required) {
    if (record[name] !== undefined) continue;
    record[name] = scaffoldValue(name, fields[name]);
  }

  const slots = markdownEntries(loaded.model, record).filter((slot) => (
    slot.required
    || Boolean(definition.markdown)
    || loaded.model.recordContent.defaultResourceTypes.includes(type)
  ));
  const content = Object.fromEntries(slots.map((slot) => [
    slot.name,
    markdownScaffold(normalizedTitle, type, slot)
  ]));
  return {
    record,
    ...(Object.keys(content).length ? { content } : {})
  };
}

export function findResourceReferences(loaded, id) {
  const target = loaded.resources.find((record) => record.id === id);
  if (!target) throw new Error(`Resource "${id}" was not found.`);
  const references = [];
  for (const record of loaded.resources) {
    const definition = loaded.model.resources[record.type];
    if (!definition) continue;
    const fields = { ...loaded.model.commonFields, ...definition.fields };
    for (const [fieldName, field] of Object.entries(fields)) {
      if (!field.relation || field.legacy) continue;
      const values = Array.isArray(record[fieldName]) ? record[fieldName] : [record[fieldName]];
      if (values.includes(id)) {
        references.push({
          type: record.type,
          id: record.id,
          title: record.title,
          field: fieldName
        });
      }
    }
  }
  return {
    resource: {
      type: target.type,
      id: target.id,
      title: target.title
    },
    references: references.sort((left, right) => (
      `${left.type}:${left.id}:${left.field}`.localeCompare(`${right.type}:${right.id}:${right.field}`)
    ))
  };
}

function relationContext(resources, allowedTypes) {
  const wildcard = allowedTypes.includes("*");
  const allCandidates = resources
    .filter((record) => wildcard || allowedTypes.includes(record.type))
    .sort((left, right) => `${left.type}:${left.title}:${left.id}`.localeCompare(`${right.type}:${right.title}:${right.id}`))
    .map((record) => record.id);
  return {
    types: allowedTypes,
    candidateCount: allCandidates.length,
    candidates: wildcard ? [] : allCandidates.slice(0, 25),
    truncated: wildcard ? allCandidates.length > 0 : allCandidates.length > 25
  };
}

function allowedValues(model, field) {
  if (field.values) return field.values;
  if (field.type === "rating") return model.primitives?.rating ?? null;
  if (field.type === "outcome") return model.primitives?.outcome ?? null;
  return null;
}

function scaffoldValue(name, field = {}) {
  if (field.const !== undefined) return field.const;
  if (name === "status" && field.values) {
    return STARTING_STATUS_ORDER.find((value) => field.values.includes(value)) ?? field.values[0] ?? null;
  }
  if (field.type === "array") return [];
  if (field.type === "object") return {};
  if (field.type === "boolean") return false;
  return null;
}

function markdownScaffold(title, type, slot) {
  const heading = slot.label === "Record" ? title : `${title}: ${slot.label}`;
  const sections = slot.name === "agenda"
    ? ["Objectives", "Topics and inputs", "Decisions needed"]
    : slot.name === "minutes"
      ? ["Attendees", "Discussion", "Decisions", "Risks and exceptions", "Action items"]
      : type === "policy"
        ? ["Purpose", "Scope", "Roles and responsibilities", "Requirements", "Exceptions", "Review"]
        : type === "training"
          ? ["Learning objectives", "Material", "Knowledge check", "Completion requirements"]
          : type === "risk-assessment"
            ? ["Scope and methodology", "Inputs reviewed", "Threats and observations", "Risk decisions", "Conclusion and follow-up"]
            : ["Scope and inputs", "Work performed", "Results and decisions", "Evidence", "Exceptions and follow-up"];
  return [
    `# ${heading}`,
    "",
    `<!-- Replace these prompts with the actual ${humanize(type).toLowerCase()} work. Do not record planned work as completed. -->`,
    "",
    ...sections.flatMap((section) => [`## ${section}`, "", ""])
  ].join("\n").trimEnd() + "\n";
}

function humanize(value) {
  return String(value)
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (letter) => letter.toUpperCase());
}
