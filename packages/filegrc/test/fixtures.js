import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadModel } from "../model/index.js";
import { markdownEntries } from "../src/resource-markdown.js";
import { writeJson } from "./helpers.js";

const TITLES = {
  workspace: "Example Engineering SOC 2 Program",
  "renderer-settings": "Renderer settings",
  person: "Jordan Lee",
  "service-account": "Deployment automation",
  team: "Risk and Security Committee",
  system: "Production application",
  asset: "Customer data store",
  document: "Business Continuity Plan",
  evidence: "Quarterly access review screenshot",
  obligation: "Quarterly access review",
  framework: "SOC 2 Trust Services Criteria",
  requirement: "Logical and physical access controls",
  commitment: "Service availability commitment",
  "complementary-control": "Customer account administration",
  control: "Quarterly access review",
  "control-test": "Q2 access review test",
  finding: "Inactive account removal delay",
  exception: "Temporary administrator access",
  "action-item": "Remove inactive administrator",
  policy: "Information Security Policy",
  "policy-review": "Annual policy review",
  attestation: "Security policy acknowledgement",
  meeting: "Risk and Security Committee Q2 meeting",
  training: "Security Awareness Training",
  risk: "Production service outage",
  "risk-assessment": "Annual information security risk assessment",
  vendor: "Cloud infrastructure provider",
  "vendor-review": "Annual cloud provider review",
  "access-grant": "Production administrator access",
  "access-review": "Q2 production access review",
  vulnerability: "Outdated application dependency",
  "vulnerability-scan": "June production vulnerability scan",
  incident: "Suspicious account sign-in",
  exercise: "Incident response tabletop",
  "backup-test": "Quarterly database restore test",
  "penetration-test": "Annual application penetration test",
  "data-request": "Customer deletion request",
  audit: "2026 SOC 2 Type 2 audit",
  "audit-request": "User access review evidence"
};

const STATUS_OVERRIDES = {
  person: "active",
  "service-account": "active",
  team: "active",
  system: "active",
  asset: "active",
  document: "active",
  evidence: "verified",
  obligation: "active",
  framework: "active",
  commitment: "active",
  "complementary-control": "active",
  control: "implemented",
  "control-test": "complete",
  finding: "open",
  exception: "approved",
  "action-item": "in-progress",
  policy: "active",
  "policy-review": "complete",
  attestation: "completed",
  meeting: "complete",
  training: "active",
  risk: "monitoring",
  "risk-assessment": "complete",
  vendor: "active",
  "vendor-review": "complete",
  "access-grant": "active",
  "access-review": "complete",
  vulnerability: "remediated",
  "vulnerability-scan": "complete",
  incident: "closed",
  exercise: "complete",
  "backup-test": "passed",
  "penetration-test": "complete",
  "data-request": "in-progress",
  audit: "fieldwork",
  "audit-request": "submitted"
};

export async function makeComprehensiveWorkspace(root) {
  const model = loadModel("1");
  const ids = Object.fromEntries(Object.keys(model.resources).map((type) => [type, type === "workspace" ? "workspace" : `${type}-example`]));
  await mkdir(join(root, "data", "content"), { recursive: true });
  const records = [];

  for (const [type, definition] of Object.entries(model.resources)) {
    const record = {
      schemaVersion: 1,
      id: ids[type],
      type,
      title: TITLES[type] ?? humanize(type)
    };
    const fields = { ...model.commonFields, ...definition.fields };
    const required = new Set(definition.required ?? []);
    for (const [name, field] of Object.entries(fields)) {
      if (name === "schemaVersion" || name === "id" || name === "type" || name === "title") continue;
      if (name === "status" && STATUS_OVERRIDES[type]) record[name] = STATUS_OVERRIDES[type];
      else if (required.has(name)) record[name] = sampleValue(name, field, ids, model, type);
    }
    for (const [name, field] of Object.entries(fields)) {
      if (field.requiredWhen && Object.entries(field.requiredWhen).every(([key, value]) => record[key] === value)) {
        record[name] ??= sampleValue(name, field, ids, model, type);
      }
    }
    for (const choices of definition.oneOf ?? []) {
      if (!choices.some((name) => record[name] !== undefined)) {
        const name = choices[0];
        record[name] = sampleValue(name, fields[name], ids, model, type);
      }
    }

    addUsefulOptionalFields(record, fields, ids, model, type);
    await writeRecord(root, definition, record, model);
    records.push(record);
  }
  return { model, records };
}

function sampleValue(name, field, ids, model, type) {
  if (field.relation) {
    const targetType = field.relation.find((candidate) => candidate !== "*") ?? "person";
    const id = ids[targetType] ?? ids.person;
    return field.type === "array" ? [id] : id;
  }
  if (field.format === "data-path") return `${definitionDirectory(type)}/${type}-example.md`;
  if (field.type === "array") {
    if (field.items === "data-path") return [`evidence/${ids.evidence}/access-review.txt`];
    if (field.items === "object") return [{ name: "External participant", role: "Advisor" }];
    return [sampleText(name)];
  }
  if (field.type === "object") {
    if (/rating/i.test(name)) return { likelihood: "possible", impact: "high", score: 12, rating: "high" };
    if (/recurrence|cadence/i.test(name)) return { mode: "calendar", unit: "month", interval: 3, anchorDate: "2026-01-15" };
    return { summary: sampleText(name) };
  }
  if (field.type === "boolean") return name === "privileged";
  if (field.type === "integer" || field.type === "number") return 30;
  if (field.type === "date") return dateFor(name);
  if (field.type === "timestamp") return "2026-06-15T15:30:00Z";
  if (field.type === "rating") return "high";
  if (field.type === "outcome") return "passed";
  if (field.type === "enum") return field.values[0];
  if (field.type === "id") return ids.person;
  if (name === "dataModelVersion") return model.modelVersion;
  if (name === "organizationName") return "Example Engineering";
  if (name === "timezone") return "America/Chicago";
  if (name === "version") return "2026";
  if (name === "email") return "security@example.test";
  if (name === "source") return "Repository workflow";
  if (name === "scope") return "Production application and supporting operations";
  if (name === "statement") return `Example statement for ${humanize(type)}`;
  if (name === "description") return `Example description for ${humanize(type)}`;
  if (name === "requestReference") return "PBC-001";
  if (name === "reference") return "CC6.1";
  if (name === "requesterReference") return "case-opaque-001";
  return sampleText(name);
}

function addUsefulOptionalFields(record, fields, ids, model, type) {
  const set = (name, value) => {
    if (fields[name] && record[name] === undefined) record[name] = value;
  };
  set("tags", ["example", "security"]);
  set("description", `A realistic example ${humanize(type).toLowerCase()} used to exercise the complete workspace.`);
  set("code", "SEC-01");
  set("dueOn", "2026-08-15");
  set("completedOn", "2026-06-30");
  set("reviewedOn", "2026-06-30");
  set("performedOn", "2026-06-30");
  set("periodStart", "2026-01-01");
  set("periodEnd", "2026-06-30");
  set("policyIds", [ids.policy]);
  set("controlIds", [ids.control]);
  set("systemIds", [ids.system]);
  set("evidenceIds", [ids.evidence]);
  set("actionItemIds", [ids["action-item"]]);
  set("riskIds", [ids.risk]);
  set("attendeeIds", [ids.person]);
}

async function writeRecord(root, definition, record, model) {
  const entries = markdownEntries(model, record);
  const shouldWriteRecord = model.recordContent.defaultResourceTypes.includes(record.type);
  for (const entry of entries) {
    if (definition.markdown || shouldWriteRecord) {
      await writeMarkdown(root, entry.path, `${record.title} ${entry.label.toLowerCase()}`);
    }
  }
  if (record.type === "evidence" && record.filePaths) {
    for (const relativePath of record.filePaths) {
      const path = join(root, "data", relativePath);
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, "Example fixed evidence attachment.\n", "utf8");
    }
  }
  const relative = definition.singleton
    ? definition.singleton
    : join(definition.collection, (definition.recordPath ?? "{id}.json").replaceAll("{id}", record.id));
  const path = join(root, "data", relative);
  await mkdir(join(path, ".."), { recursive: true });
  await writeJson(path, record);
}

async function writeMarkdown(root, relativePath, title) {
  const path = join(root, "data", relativePath);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `# ${title}\n\nThis example documents the activity, decisions, results, and follow-up work.\n\n## Review notes\n\n- Scope was confirmed.\n- Evidence was reviewed.\n- Follow-up work is tracked by resource ID.\n`, "utf8");
}

function dateFor(name) {
  if (/due|expires|end/i.test(name)) return "2026-08-15";
  if (/start|received|detected|discovered|scheduled/i.test(name)) return "2026-06-15";
  return "2026-06-30";
}

function sampleText(name) {
  return humanize(name);
}

function definitionDirectory(type) {
  return type === "evidence" ? `evidence/${type}-example` : "attachments";
}

function humanize(value) {
  return String(value).replaceAll("-", " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase());
}
