import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { threadId } from "node:worker_threads";
import { loadModel } from "../model/index.js";
import { markdownEntries } from "../src/resource-markdown.js";
import { cloneFixture, writeJson } from "./helpers.js";

const comprehensiveFixtures = new Map();
let fixtureRootPromise;

const TITLES = {
  workspace: "Example Engineering SOC 2 Program",
  program: "Example SOC 2 Program",
  "renderer-settings": "Renderer settings",
  person: "Jordan Lee",
  appointment: "Chief Information Security Officer",
  "service-account": "Deployment automation",
  team: "Risk and Security Committee",
  system: "Production application",
  component: "Production platform",
  classification: "Confidential",
  "information-type": "Customer records",
  asset: "Customer data store",
  document: "Business Continuity Plan",
  evidence: "Quarterly access review screenshot",
  obligation: "Quarterly access review",
  framework: "SOC 2 Trust Services Criteria",
  "collection-review": "Program participants review",
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
  "audit-request": "User access review evidence",
};

const STATUS_OVERRIDES = {
  person: "active",
  appointment: "active",
  "service-account": "active",
  team: "active",
  program: "active",
  system: "active",
  component: "active",
  classification: "active",
  "information-type": "active",
  asset: "active",
  document: "active",
  evidence: "verified",
  obligation: "active",
  framework: "active",
  "collection-review": "planned",
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
  "backup-test": "complete",
  "penetration-test": "complete",
  "data-request": "in-progress",
  audit: "fieldwork",
  "audit-request": "submitted",
};

export async function makeComprehensiveWorkspace(root, version) {
  const key = version == null ? "active" : String(version);
  let fixturePromise = comprehensiveFixtures.get(key);
  if (!fixturePromise) {
    fixturePromise = buildComprehensiveFixture(version, key);
    comprehensiveFixtures.set(key, fixturePromise);
  }
  const fixture = await fixturePromise;
  await cloneFixture(fixture.root, root);
  return {
    model: fixture.model,
    records: structuredClone(fixture.records),
  };
}

async function buildComprehensiveFixture(version, key) {
  const base = await fixtureRoot();
  const root = join(base, `comprehensive-${key}`);
  await mkdir(root, { recursive: true });
  const result = await buildComprehensiveWorkspace(root, version);
  return { root, ...result };
}

async function fixtureRoot() {
  fixtureRootPromise ??= process.env.FILEGRC_TEST_RUN_ROOT
    ? mkdir(
        join(
          process.env.FILEGRC_TEST_RUN_ROOT,
          `fixtures-${process.pid}-${threadId}`,
        ),
        { recursive: true },
      ).then(() =>
        join(
          process.env.FILEGRC_TEST_RUN_ROOT,
          `fixtures-${process.pid}-${threadId}`,
        ),
      )
    : mkdtemp(join(tmpdir(), "filegrc-test-fixtures-")).then((root) => {
        process.once("exit", () =>
          rmSync(root, { recursive: true, force: true }),
        );
        return root;
      });
  return fixtureRootPromise;
}

async function buildComprehensiveWorkspace(root, version) {
  const model = loadModel(version);
  const ids = Object.fromEntries(
    Object.keys(model.resources).map((type) => [
      type,
      type === "workspace" ? "workspace" : `${type}-example`,
    ]),
  );
  ids.independentApprover = "person-independent-approver-example";
  await mkdir(join(root, "data", "content"), { recursive: true });
  const records = [];

  for (const [type, definition] of Object.entries(model.resources)) {
    if (type === "reconciliation-dismissal") continue;
    const record = {
      id: ids[type],
      type,
      title: TITLES[type] ?? humanize(type),
    };
    const fields = { ...model.commonFields, ...definition.fields };
    const required = new Set(definition.required ?? []);
    for (const [name, field] of Object.entries(fields)) {
      if (name === "id" || name === "type" || name === "title") continue;
      if (name === "status" && STATUS_OVERRIDES[type])
        record[name] = STATUS_OVERRIDES[type];
      else if (required.has(name))
        record[name] = sampleValue(name, field, ids, model, type);
    }
    if (
      ["document", "training"].includes(type) &&
      record.status === "active" &&
      fields.activationBasis
    ) {
      record.activationBasis = "recorded";
    }
    for (const [name, field] of Object.entries(fields)) {
      if (
        field.requiredWhen &&
        Object.entries(field.requiredWhen).every(([key, value]) =>
          Array.isArray(value)
            ? value.includes(record[key])
            : record[key] === value,
        )
      ) {
        record[name] ??= sampleValue(name, field, ids, model, type);
      }
    }
    for (const group of definition.oneOf ?? []) {
      const choices = Array.isArray(group) ? group : group.fields || [];
      const active =
        Array.isArray(group) ||
        Object.entries(group.when || {}).every(([key, value]) =>
          Array.isArray(value)
            ? value.includes(record[key])
            : record[key] === value,
        );
      if (!active) continue;
      if (!choices.some((name) => record[name] !== undefined)) {
        const name = choices[0];
        record[name] = sampleValue(name, fields[name], ids, model, type);
      }
    }

    addUsefulOptionalFields(record, fields, ids, model, type);
    if (type === "requirement-mapping")
      record.targetResourceIds = [ids.control];
    if (
      type === "obligation" &&
      model.obligationActivities[record.activityType]?.recurrenceModes
        ?.length === 1 &&
      model.obligationActivities[record.activityType].recurrenceModes[0] ===
        "event"
    ) {
      record.recurrence = { mode: "event", eventType: "person-role-changed" };
      record.window = { precision: "date", startsAfter: 0, dueAfter: 3 };
    }
    if (Number(model.modelVersion) >= 9)
      configureRuleBasedObligationFixture(record, ids);
    await writeRecord(root, definition, record, model);
    records.push(record);
  }
  const independentApprover = {
    id: ids.independentApprover,
    type: "person",
    title: "Independent Approver",
    status: "active",
    affiliation: "external",
    email: "approver@example.test",
  };
  await writeRecord(root, model.resources.person, independentApprover, model);
  records.push(independentApprover);
  const recordsById = new Map(records.map((record) => [record.id, record]));
  for (const attestation of records.filter(
    (record) =>
      record.type === "attestation" &&
      record.status === "completed" &&
      record.attestationMethod === "git-approval",
  )) {
    attestation.contentRevisions = await subjectContentRevisions(
      root,
      model,
      recordsById,
      attestation.subjectResourceIds,
    );
    await writeRecord(root, model.resources.attestation, attestation, model);
  }
  return { model, records };
}

function configureRuleBasedObligationFixture(record, ids) {
  if (record.type === "access-grant") {
    record.status = "active";
    record.requestedOn = "2026-06-15";
    record.approvedOn = "2026-06-15";
    record.provisionedOn = "2026-06-15";
    return;
  }
  if (record.type === "obligation") {
    record.activityType = "access-provisioning";
    delete record.customActivity;
    record.scheduleMode = "rule";
    record.ruleIds = [ids["obligation-rule"]];
    record.activeRuleId = ids["obligation-rule"];
    delete record.recurrence;
    delete record.window;
    delete record.startsOn;
    delete record.endsOn;
    delete record.completionResourceIds;
    return;
  }
  if (record.type === "obligation-rule") {
    record.status = "active";
    record.obligationId = ids.obligation;
    record.recurrence = { mode: "event", eventType: "person-role-changed" };
    record.window = { precision: "date", startsAfter: 0, dueAfter: 3 };
    record.rationale =
      "Management approved this event window for access changes.";
    record.approvedByIds = [ids.independentApprover];
    record.approvedOn = "2026-01-15";
    record.effectiveAt = "2026-01-15T15:30:00Z";
    record.timezone = "America/Chicago";
    return;
  }
  if (record.type === "obligation-occurrence") {
    record.status = "reconciled";
    record.obligationId = ids.obligation;
    record.ruleId = ids["obligation-rule"];
    record.occurrenceKey = "person-role-changed:person-example:2026-06-15";
    record.coverage = { kind: "as-of", on: "2026-06-15" };
    record.membershipCutoffAt = "2026-06-15";
    record.members = [
      {
        resourceId: ids.person,
        disposition: "expected",
        result: "passed",
        completionResourceIds: [ids["access-grant"]],
      },
    ];
    record.expectedCount = 1;
    record.completedCount = 1;
    record.conclusion = "complete";
    record.reviewedByIds = [ids.independentApprover];
    record.reconciledAt = "2026-06-16T15:30:00Z";
  }
}

function sampleValue(name, field, ids, model, type) {
  if (field.relation) {
    if (name === "approverIds" || name === "reviewerIds")
      return [ids.independentApprover];
    const targetType =
      field.relation.find((candidate) => candidate !== "*") ?? "person";
    const id = ids[targetType] ?? ids.person;
    return field.type === "array" ? [id] : id;
  }
  if (field.format === "data-path")
    return `${definitionDirectory(type)}/${type}-example.md`;
  if (field.format === "git-name")
    return name === "repositoryRemote" ? "origin" : "main";
  if (field.type === "array") {
    if (field.items === "data-path")
      return [`evidence/${ids.evidence}/access-review.txt`];
    if (field.items === "object" && field.itemObjectType) {
      return [sampleObject(field.itemObjectType, ids, model, type)];
    }
    if (field.items === "object")
      return [{ name: "External participant", role: "Advisor" }];
    return [sampleText(name)];
  }
  if (field.type === "object") {
    if (field.objectType)
      return sampleObject(field.objectType, ids, model, type);
    if (/rating/i.test(name))
      return {
        likelihood: "possible",
        impact: "high",
        score: 12,
        rating: "high",
      };
    if (/recurrence|cadence/i.test(name))
      return {
        mode: "calendar",
        unit: "month",
        interval: 3,
        anchorDate: "2026-01-15",
      };
    return { summary: sampleText(name) };
  }
  if (field.type === "boolean") return name === "privileged";
  if (field.type === "integer" || field.type === "number") return 30;
  if (field.type === "date") return dateFor(name);
  if (field.type === "timestamp") return "2026-06-15T15:30:00Z";
  if (field.type === "rating") return "high";
  if (field.type === "outcome") return "passed";
  if (field.type === "enum")
    return field.values?.[0] ?? Object.keys(model[field.registry] || {})[0];
  if (field.type === "id") return ids.person;
  if (name === "dataModelVersion") return model.modelVersion;
  if (name === "classificationId") return "example";
  if (name === "organizationName") return "Example Engineering";
  if (name === "timezone") return "America/Chicago";
  if (name === "version") return "2026";
  if (name === "appointmentKind") return "policy-owner";
  if (name === "authorityAppointmentKind") return "policy-owner";
  if (name === "approvalAppointmentKind") return "independent-policy-reviewer";
  if (name === "purposeKey") return "security-reporting";
  if (name === "email") return "security@example.test";
  if (name === "source") return "Repository workflow";
  if (name === "scope")
    return "Production application and supporting operations";
  if (name === "statement") return `Example statement for ${humanize(type)}`;
  if (name === "description")
    return `Example description for ${humanize(type)}`;
  if (name === "requestReference") return "PBC-001";
  if (name === "reference") return "CC6.1";
  if (name === "requesterReference") return "case-opaque-001";
  return sampleText(name);
}

function sampleObject(objectType, ids, model, type) {
  const schema = model.objectTypes[objectType];
  if (objectType === "custom-obligation-activity") {
    return {
      title: "Custom evidence review",
      completionResourceTypes: ["evidence"],
    };
  }
  if (objectType === "recurrence") {
    return {
      mode: "calendar",
      unit: "month",
      interval: 3,
      anchorDate: "2026-01-15",
    };
  }
  if (objectType === "string-map") return { example: "Example value" };
  if (objectType === "integer-map") return { example: 1 };
  if (objectType === "json-map") return { example: "Example value" };
  if (objectType === "extensions")
    return { "example.test": { customField: "Example value" } };
  if (objectType === "content-revisions") return {};
  if (objectType === "coverage-period") {
    return { kind: "range", startsOn: "2026-01-01", endsOn: "2026-06-30" };
  }
  const value = {};
  for (const name of schema.required || []) {
    value[name] = sampleValue(name, schema.properties[name], ids, model, type);
  }
  for (const [name, property] of Object.entries(schema.properties || {})) {
    if (
      property.requiredWhen &&
      Object.entries(property.requiredWhen).every(([field, expected]) =>
        Array.isArray(expected)
          ? expected.includes(value[field])
          : value[field] === expected,
      )
    ) {
      value[name] ??= sampleValue(name, property, ids, model, type);
    }
  }
  return value;
}

function addUsefulOptionalFields(record, fields, ids, model, type) {
  const set = (name, value) => {
    if (fields[name] && record[name] === undefined) record[name] = value;
  };
  set("tags", ["example", "security"]);
  set(
    "description",
    `A realistic example ${humanize(type).toLowerCase()} used to exercise the complete workspace.`,
  );
  if (type === "workspace")
    set("classificationDefinitions", { example: "Example classification" });
  if (type === "person") set("jobTitle", "Chief Executive Officer");
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
  set("componentIds", [ids.component]);
  set("evidenceIds", [ids.evidence]);
  set("riskIds", [ids.risk]);
  set("attendeeIds", [ids.person]);
  if (type === "document") set("approverIds", [ids.independentApprover]);
  if (type === "program") {
    set("systemIds", [ids.system]);
    set("frameworkIds", [ids.framework]);
    set("controlIds", [ids.control]);
    set("ownerIds", [ids.appointment]);
    set("requirementApplicability", [
      {
        requirementId: ids.requirement,
        decision: "applicable",
        rationale: "The criterion applies to the example Program scope.",
        reviewedByIds: [ids.person],
        reviewedOn: "2026-06-30",
        scopeRevision: "example-scope-revision",
      },
    ]);
  }
  if (type === "component") {
    record.systemUses = [
      {
        systemId: ids.system,
        roles: ["service-delivery", "control-support", "evidence-source"],
        rationale:
          "The Component delivers the example System, supports its Control, and produces authoritative Evidence.",
      },
    ];
    set("evidenceSourceKinds", [
      model.evidenceSourceFamilies[0].sourceKinds[0],
    ]);
    set("evidenceOwnerIds", [ids.person]);
  }
}

async function writeRecord(root, definition, record, model) {
  const entries = markdownEntries(model, record);
  const shouldWriteRecord = model.recordContent.defaultResourceTypes.includes(
    record.type,
  );
  for (const entry of entries) {
    if (definition.markdown || shouldWriteRecord) {
      await writeMarkdown(
        root,
        entry.path,
        `${record.title} ${entry.label.toLowerCase()}`,
      );
    }
  }
  const approvalRevisionField = definition.fields.approvedContentRevisions
    ? "approvedContentRevisions"
    : record.type === "training" && definition.fields.effectiveContentRevisions
      ? "effectiveContentRevisions"
      : null;
  if (approvalBound(record) && approvalRevisionField) {
    record[approvalRevisionField] = {};
    for (const entry of entries) {
      try {
        const source = await readFile(join(root, "data", entry.path), "utf8");
        record[approvalRevisionField][entry.path] = createHash("sha256")
          .update(source)
          .digest("hex");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    if (
      ["document", "training"].includes(record.type) &&
      definition.fields.activatedContentRevisions &&
      record.status === "active"
    ) {
      record.activatedContentRevisions = structuredClone(
        record.approvedContentRevisions,
      );
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
    : join(
        definition.collection,
        (definition.recordPath ?? "{id}.json").replaceAll("{id}", record.id),
      );
  const path = join(root, "data", relative);
  await mkdir(join(path, ".."), { recursive: true });
  await writeJson(path, record);
}

async function subjectContentRevisions(
  root,
  model,
  recordsById,
  subjectResourceIds,
) {
  const revisions = {};
  for (const id of subjectResourceIds || []) {
    const subject = recordsById.get(id);
    if (!subject) continue;
    for (const entry of markdownEntries(model, subject)) {
      try {
        const source = await readFile(join(root, "data", entry.path), "utf8");
        revisions[entry.path] = createHash("sha256")
          .update(source)
          .digest("hex");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }
  return revisions;
}

function approvalBound(record) {
  if (record.type === "policy")
    return ["approved", "active", "superseded", "retired"].includes(
      record.status,
    );
  if (record.type === "document")
    return ["approved", "active", "superseded", "retired"].includes(
      record.status,
    );
  if (record.type === "training")
    return ["approved", "active", "superseded", "retired"].includes(
      record.status,
    );
  return false;
}

async function writeMarkdown(root, relativePath, title) {
  const path = join(root, "data", relativePath);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(
    path,
    `# ${title}\n\nThis example documents the activity, decisions, results, and follow-up work.\n\n## Review notes\n\n- Scope was confirmed.\n- Evidence was reviewed.\n- Follow-up work is tracked by resource ID.\n`,
    "utf8",
  );
}

function dateFor(name) {
  if (/due|expires|end/i.test(name)) return "2026-08-15";
  if (/start|received|detected|discovered|scheduled/i.test(name))
    return "2026-06-15";
  return "2026-06-30";
}

function sampleText(name) {
  return humanize(name);
}

function definitionDirectory(type) {
  return type === "evidence" ? `evidence/${type}-example` : "attachments";
}

function humanize(value) {
  return String(value)
    .replaceAll("-", " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (letter) => letter.toUpperCase());
}
