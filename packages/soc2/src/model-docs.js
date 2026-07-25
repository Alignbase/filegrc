export function generateModelDocumentation(model) {
  const lines = [
    "# GRC Data Model",
    "",
    "<!-- Generated from packages/soc2/model/v1.json. Do not edit by hand. -->",
    "",
    `Model version: \`${model.modelVersion}\``,
    "",
    model.description,
    "",
    "Each structured resource is one UTF-8 JSON file. Long-form work is Markdown under `data/content/`. Git supplies file authors, timestamps, diffs, commit messages, and revisions, so records do not duplicate those fields.",
    "",
    "## Common fields",
    "",
    "| Field | Type | Required | Meaning |",
    "| --- | --- | --- | --- |"
  ];
  for (const [name, field] of Object.entries(model.commonFields)) {
    lines.push(`| \`${name}\` | ${fieldType(field)} | ${field.required ? "Yes" : "No"} | ${escapeCell(field.label ?? "")} |`);
  }
  lines.push("", "## Resource groups", "");

  for (const group of model.groups) {
    const resources = Object.entries(model.resources).filter(([, resource]) => resource.group === group.id);
    if (!resources.length) continue;
    lines.push(`### ${group.title}`, "");
    for (const [type, resource] of resources) {
      lines.push(`#### \`${type}\``, "", resource.description, "");
      const recordPath = (resource.recordPath ?? "{id}.json").replaceAll("{id}", "<id>");
      lines.push(`Path: \`${resource.singleton ? `data/${resource.singleton}` : `data/${resource.collection}/${recordPath}`}\``, "");
      lines.push("| Field | Type | Required | Notes |", "| --- | --- | --- | --- |");
      const required = new Set(resource.required ?? []);
      for (const [name, field] of Object.entries(resource.fields ?? {})) {
        const notes = [
          field.label,
          field.values ? `Values: ${field.values.map((item) => `\`${item}\``).join(", ")}` : "",
          field.relation ? `References: ${field.relation.map((item) => `\`${item}\``).join(", ")}` : "",
          field.requiredWhen ? `Required when ${Object.entries(field.requiredWhen).map(([key, value]) => `\`${key}\` is \`${value}\``).join(" and ")}` : "",
          field.content ? "References long-form content under `data/`." : ""
        ].filter(Boolean).join(" ");
        lines.push(`| \`${name}\` | ${fieldType(field)} | ${required.has(name) ? "Yes" : field.requiredWhen ? "Conditional" : "No"} | ${escapeCell(notes)} |`);
      }
      if (resource.oneOf) {
        lines.push("", `At least one of ${resource.oneOf.flat().map((name) => `\`${name}\``).join(", ")} is required.`);
      }
      lines.push("");
    }
  }
  lines.push(
    "## Compatibility",
    "",
    "The model version is independent from the package version. The engine reads supported older model registries without changing consumer data. A migration must be explicit and documented.",
    ""
  );
  return lines.join("\n");
}

function fieldType(field) {
  if (field.type === "array") return `array of ${field.items ?? "values"}`;
  return field.type;
}

function escapeCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}
