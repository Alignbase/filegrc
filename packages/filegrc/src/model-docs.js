import { buildAgentProgramPath, RESOURCE_INSTRUCTIONS } from "./program-path.js";

export function generateModelDocumentation(model) {
  const programPath = buildAgentProgramPath(model);
  const lines = [
    "# GRC Data Model",
    "",
    `<!-- Generated from packages/filegrc/model/v${model.modelVersion}.json. Do not edit by hand. -->`,
    "",
    `Model version: \`${model.modelVersion}\``,
    "",
    model.description,
    "",
    "Each structured resource is one UTF-8 JSON file. Long-form work is an implicit Markdown companion beside that JSON file. Git supplies file authors, timestamps, diffs, commit messages, and revisions, so records do not duplicate those fields or file paths.",
    "",
    "## Program path",
    "",
    "The renderer, CLI, generated agent instructions, and this reference use the same five-step lifecycle:",
    "",
    ...programPath.flatMap((stage) => [
      `### Step ${stage.number}. ${stage.title}`,
      "",
      stage.summary,
      "",
      ...stage.pages.map((page) => `- **${page.title}** (\`${page.type || `utility:${page.utility}`}\`): ${page.instructions}`),
      "",
      ...(stage.operatingRecords?.length ? [
        "Operating record guides:",
        "",
        ...stage.operatingRecords.map((page) => `- **${page.title}** (\`${page.type}\`): ${page.instructions}`),
        ""
      ] : []),
      "Headless commands:",
      "",
      ...stage.commands.map((command) => `- \`${command}\``),
      ""
    ]),
    "## Relation groups",
    "",
    "Relationship fields use the named groups below. The registry expands each group to explicit resource types, so no relationship accepts an unrestricted wildcard.",
    "",
    "| Group | Resource types |",
    "| --- | --- |",
    ...Object.entries(model.relationGroups || {}).map(([name, types]) => (
      `| \`${name}\` | ${types.map((type) => `\`${type}\``).join(", ")} |`
    )),
    "",
    "## Relationship constraints",
    "",
    "Relationship constraints prevent cycles and duplicate active authority or access records.",
    "",
    ...((model.relationshipConstraints?.acyclic || []).map((constraint) => (
      `- \`${constraint.resourceType}.${constraint.field}\` must be acyclic.`
    ))),
    ...((model.relationshipConstraints?.unique || []).map((constraint) => (
      `- \`${constraint.resourceType}\` records in ${constraint.statuses.map((status) => `\`${status}\``).join(", ")} must be unique by ${constraint.fields.map((field) => `\`${field}\``).join(", ")}.`
    ))),
    "",
    "## Obligation activities",
    "",
    "The model owns each activity name, allowed recurrence modes and scope types, its default completion record, and every record type that can prove completion.",
    "",
    "| Activity | Title | Recurrence | Scope resource types | Default completion | Accepted completion records |",
    "| --- | --- | --- | --- | --- | --- |",
    ...Object.entries(model.obligationActivities || {}).map(([name, activity]) => (
      `| \`${name}\` | ${escapeCell(activity.title)} | ${activity.recurrenceModes.map((mode) => `\`${mode}\``).join(", ")} | ${activity.scopeResourceTypes.map((type) => `\`${type}\``).join(", ")} | \`${activity.completionType}\` | ${activity.completionResourceTypes.map((type) => `\`${type}\``).join(", ")} |`
    )),
    "",
    "## Policy events",
    "",
    "The model owns each event title and the minimum and maximum count for each subject resource type.",
    "",
    "| Event | Title | Subject rules |",
    "| --- | --- | --- |",
    ...Object.entries(model.policyEvents || {}).map(([name, event]) => (
      `| \`${name}\` | ${escapeCell(event.title)} | ${event.subjectRules.map(({ resourceType, minimum = 0, maximum }) => `\`${resourceType}\` ${minimum}..${Number.isInteger(maximum) ? maximum : "*"}`).join(", ")} |`
    )),
    "",
    "## Nested object schemas",
    "",
    "Named object schemas reject unknown keys unless the schema explicitly allows a typed map or arbitrary JSON. Conditional properties are valid only for the selected discriminator.",
    "",
    ...Object.entries(model.objectTypes || {}).flatMap(([name, schema]) => objectTypeDocumentation(name, schema)),
    "## Common fields",
    "",
    "| Field | Type | Required | Meaning |",
    "| --- | --- | --- | --- |"
  ];
  for (const [name, field] of Object.entries(model.commonFields)) {
    lines.push(`| \`${name}\` | ${fieldType(field)} | ${field.required ? "Yes" : "No"} | ${escapeCell(fieldNotes(field))} |`);
  }
  lines.push(
    "",
    "## Record Markdown",
    "",
    "Resources with no dedicated Markdown use an optional companion with the same basename as the JSON record. The renderer creates and discovers this file from the stable record location, so no path is stored in the record.",
    "",
    `Record Markdown is shown by default for: ${model.recordContent.defaultResourceTypes.map((type) => `\`${type}\``).join(", ")}. Other resources without dedicated Markdown can add it when structured fields are not enough.`,
    "",
    "## Program and audit readiness defaults",
    "",
    "Program Readiness checks management scope, policy adoption, control implementation, and authoritative evidence mapping without requiring an audit record. Audit Readiness starts after a CPA firm is engaged and uses the defaults below to prepare Type 1 and Type 2 fieldwork.",
    "",
    "Management documents:",
    "",
    ...model.auditReadiness.managementDocuments.map((item) => `- **${item.title}** (\`${item.kind}\`): ${item.timing}`),
    "",
    "Standard populations, including zero-event populations:",
    "",
    ...model.auditReadiness.populationTemplates.map((item) => `- **${item.title}** (\`${item.kind}\`): source role \`${item.sourceKind}\`; start with ${item.sourcePrompt}. ${item.timing}`),
    "",
    "Authoritative systems of record:",
    "",
    ...model.evidenceSourceFamilies.map((item) => (
      item.filegrcManaged === true
        ? `- **${item.title}** (${item.sourceKinds.map((kind) => `\`${kind}\``).join(", ")}): ${item.description} FileGRC operating records: ${item.operationRecordTypes.map((type) => `\`${type}\``).join(", ")}. Expected evidence: ${item.evidencePrompt} ${item.timing}`
        : `- **${item.title}** (${item.sourceKinds.map((kind) => `\`${kind}\``).join(", ")}): ${item.description} Expected evidence: ${item.evidencePrompt} ${item.timing}`
    )),
    "",
    "## Resource groups",
    ""
  );

  for (const group of model.groups) {
    const resources = Object.entries(model.resources).filter(([, resource]) => resource.group === group.id);
    if (!resources.length) continue;
    lines.push(`### ${group.title}`, "");
    for (const [type, resource] of resources) {
      lines.push(`#### \`${type}\``, "", resource.description, "");
      lines.push(`Instructions: ${RESOURCE_INSTRUCTIONS[type] || resource.description}`, "");
      lines.push(`Policy basis: ${resource.guidance.policyBasis}`, "");
      lines.push(`Timing: ${resource.guidance.cadence}`, "");
      if (resource.guidance.sourceResourceIds?.length) {
        lines.push(`Default sources: ${resource.guidance.sourceResourceIds.map((id) => `\`${id}\``).join(", ")}`, "");
      }
      if (resource.titleLabel) lines.push(`The UI labels the common \`title\` field as **${resource.titleLabel}**.`, "");
      const recordPath = (resource.recordPath ?? "{id}.json").replaceAll("{id}", "<id>");
      lines.push(`Path: \`${resource.singleton ? `data/${resource.singleton}` : `data/${resource.collection}/${recordPath}`}\``, "");
      const contentMode = recordContentMode(model, type, resource);
      if (contentMode) {
        lines.push(`Record Markdown: ${contentMode === "default" ? "shown by default" : "available when needed"} as an implicit companion file.`, "");
      }
      if (resource.markdown) {
        lines.push("Markdown companions:", "");
        for (const [name, markdown] of Object.entries(resource.markdown)) {
          const suffix = markdown.primary ? ".md" : `-${name}.md`;
          const requirement = markdown.required
            ? "required"
            : markdown.requiredWhen
              ? `required when ${conditionText(markdown.requiredWhen)}`
              : "optional";
          lines.push(`- **${markdown.label}**: \`${suffix}\` beside the JSON record (${requirement}).`);
        }
        lines.push("");
      }
      lines.push("| Field | Type | Required | Notes |", "| --- | --- | --- | --- |");
      const required = new Set(resource.required ?? []);
      for (const [name, field] of Object.entries(resource.fields ?? {})) {
        const requiredLabel = required.has(name) || field.required ? "Yes" : field.requiredWhen ? "Conditional" : "No";
        lines.push(`| \`${name}\` | ${fieldType(field)} | ${requiredLabel} | ${escapeCell(fieldNotes(field))} |`);
      }
      for (const group of resource.oneOf ?? []) {
        const choices = Array.isArray(group) ? group : group.fields || [];
        const condition = Array.isArray(group) ? "" : ` when ${conditionText(group.when)}`;
        lines.push("", `At least one of ${choices.map(choiceLabel).join(", ")} is required${condition}.`);
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}

function conditionText(condition) {
  return Object.entries(condition).map(([name, value]) => (
    Array.isArray(value)
      ? `\`${name}\` is one of ${value.map((item) => `\`${item}\``).join(", ")}`
      : `\`${name}\` is \`${value}\``
  )).join(" and ");
}

function recordContentMode(model, type, resource) {
  if (!model.recordContent?.slot || resource.markdown) return null;
  return model.recordContent.defaultResourceTypes.includes(type) ? "default" : "optional";
}

function choiceLabel(name) {
  if (name.startsWith("$markdown:")) return `**${name.slice("$markdown:".length)} Markdown**`;
  return `\`${name}\``;
}

function fieldType(field) {
  if (field.type === "array") {
    return field.itemObjectType
      ? `array of object (\`${field.itemObjectType}\`)`
      : `array of ${field.items ?? "values"}`;
  }
  if (field.type === "object" && field.objectType) return `object (\`${field.objectType}\`)`;
  return field.format && field.format !== field.type ? `${field.type} (${field.format})` : field.type;
}

function fieldNotes(field) {
  return [
    field.label,
    field.values ? `Values: ${field.values.map((item) => `\`${item}\``).join(", ")}` : "",
    field.registry ? `Values come from the \`${field.registry}\` registry.` : "",
    field.relationGroup ? `Relation group: \`${field.relationGroup}\`.` : "",
    field.relation ? `References: ${field.relation.map((item) => `\`${item}\``).join(", ")}` : "",
    field.minimum !== undefined ? `Minimum: \`${field.minimum}\`.` : "",
    field.maximum !== undefined ? `Maximum: \`${field.maximum}\`.` : "",
    field.managed ? "Managed by filegrc." : "",
    field.disjointFrom ? `Must not overlap \`${field.disjointFrom}\`.` : "",
    field.requiredWhen ? `Required when ${conditionText(field.requiredWhen)}.` : "",
    field.allowedWhen ? `Allowed when ${conditionText(field.allowedWhen)}.` : ""
  ].filter(Boolean).join(" ");
}

function objectTypeDocumentation(name, schema) {
  const lines = [`### \`${name}\``, ""];
  const properties = Object.entries(schema.properties || {});
  if (properties.length) {
    const required = new Set(schema.required || []);
    lines.push("| Property | Type | Required | Notes |", "| --- | --- | --- | --- |");
    for (const [propertyName, property] of properties) {
      const requiredLabel = required.has(propertyName)
        ? "Yes"
        : property.requiredWhen
          ? "Conditional"
          : "No";
      lines.push(`| \`${propertyName}\` | ${fieldType(property)} | ${requiredLabel} | ${escapeCell(fieldNotes(property))} |`);
    }
  } else if (schema.additionalProperties === true) {
    lines.push("Allows arbitrary JSON properties.");
  } else if (schema.additionalProperties) {
    lines.push(`Allows dynamic keys whose values are ${fieldType(schema.additionalProperties)}.`);
  } else {
    lines.push("Does not allow properties.");
  }
  if (schema.keyFormat) lines.push("", `Key format: \`${schema.keyFormat}\`.`);
  lines.push("");
  return lines;
}

function escapeCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}
