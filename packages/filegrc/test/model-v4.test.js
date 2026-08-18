import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { planApplicabilityReview, scaffoldApplicabilityReview } from "../src/batch-review.js";
import { buildAgentGuide } from "../src/agent.js";
import { applyCollectionReview, assessCollectionReview } from "../src/collection-review.js";
import { createResource, updateResource } from "../src/files.js";
import { assessProgramReadiness } from "../src/program-readiness.js";
import { resolveProgram } from "../src/program.js";
import { assessWorkflow } from "../src/workflow.js";
import { loadWorkspace } from "../src/workspace.js";
import { validateWorkspace } from "../src/validate.js";
import { makeComprehensiveWorkspace } from "./fixtures.js";
import { writeJson } from "./helpers.js";

test("treats undetermined Program applicability entries as pending review", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-model-v4-applicability-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "4");
  const loaded = await loadWorkspace(root);
  assert.equal(loaded.model.evidenceSourceFamilies.some(({ title }) => /Systems?$/.test(title)), false);
  assert.equal(loaded.model.evidenceSourceFamilies.some(({ description }) => /Catalog (?:the )?.*systems?\b/i.test(description)), false);
  const program = loaded.resources.find(({ type }) => type === "program");
  const requirement = loaded.resources.find(({ type }) => type === "requirement");
  await updateResource(root, "program", program.id, {
    ...program,
    requirementApplicability: [{ requirementId: requirement.id, decision: "undetermined" }]
  });

  const scaffold = await scaffoldApplicabilityReview(root, { type: "requirement" });
  assert.deepEqual(scaffold.decisions, [{
    id: requirement.id,
    decision: null,
    rationale: null
  }]);
  const preview = await planApplicabilityReview(root, {
    reviewedByIds: ["person-example"],
    reviewedOn: "2026-08-14",
    decisions: [{
      id: requirement.id,
      decision: "applicable",
      rationale: "The criterion applies to the selected Program scope."
    }]
  });
  assert.deepEqual(preview.reviewedIds, [requirement.id]);
  assert.deepEqual(preview.changes.update.map(({ id }) => id), [program.id]);
  const guide = buildAgentGuide(await loadWorkspace(root), "program");
  assert.match(guide.workflow.join("\n"), /review-applicability --type requirement --scaffold/);
  assert.match(guide.completionChecks.join("\n"), /Every selected Requirement has an applicable or not-applicable decision/);

  const current = await loadWorkspace(root);
  const programEntry = current.entries.find(({ record }) => record.id === program.id);
  const decision = programEntry.record.requirementApplicability[0];
  await writeJson(programEntry.path, {
    ...programEntry.record,
    requirementApplicability: [decision, { ...decision, decision: "not-applicable" }]
  });
  const validation = await validateWorkspace(root);
  assert.ok(validation.diagnostics.some(({ code }) => code === "duplicate-program-applicability"));
});

test("uses the selected Program for v4 source coverage findings", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-model-v4-source-coverage-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "4");
  const loaded = await loadWorkspace(root);
  const program = loaded.resources.find(({ type }) => type === "program");
  const control = loaded.resources.find(({ type }) => type === "control");
  const coverage = loaded.resources.find(({ type }) => type === "source-coverage");
  await updateResource(root, "program", program.id, {
    ...program,
    candidateCoverage: { kind: "range", startsOn: "2026-01-01", endsOn: "2026-12-31" }
  });
  await updateResource(root, "control", control.id, { ...control, code: "HR-01" });
  await updateResource(root, "source-coverage", coverage.id, {
    ...coverage,
    status: "active",
    validFrom: "2026-01-01",
    collectionCadence: "Record every workforce change.",
    retention: "Retain through the audit and contractual period.",
    reconciliationMethod: "Compare the exported count with the committed event records."
  });

  const workflow = await assessWorkflow(root, {
    asOf: "2026-08-14",
    evaluatedAt: "2026-08-14T12:00:00Z"
  });
  const sourceCoverage = workflow.findings.find(({ key }) => key === "evidence-source.workforce.coverage");
  assert.equal(sourceCoverage.state, "ready");
  assert.match(sourceCoverage.message, /passed retrieval test/);
});

test("defaults to the one active Program and requires a selection for multiple active Programs", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-model-v4-program-selection-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "4");
  const loaded = await loadWorkspace(root);
  const active = loaded.resources.find(({ type }) => type === "program");
  const planned = { ...active, id: "program-planned", title: "Planned Program", status: "planned" };
  const withPlanned = { ...loaded, resources: [...loaded.resources, planned] };
  assert.equal(resolveProgram(withPlanned).id, active.id);

  const secondActive = { ...planned, id: "program-second", title: "Second Program", status: "active" };
  const withTwoActive = { ...loaded, resources: [...loaded.resources, secondActive] };
  assert.throws(() => resolveProgram(withTwoActive), /More than one active Program/);
  assert.equal(resolveProgram(withTwoActive, secondActive.id).id, secondActive.id);
  await createResource(root, secondActive);
  await assert.rejects(assessWorkflow(root), /More than one active Program/);
  const audit = loaded.resources.find(({ type }) => type === "audit");
  const auditWorkflow = await assessWorkflow(root, { auditId: audit.id });
  assert.equal(auditWorkflow.dataModelVersion, "4");
});

test("model v4 keeps bounded Systems, Components, Vendors, Assets, Controls, and Evidence distinct", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-model-v4-relationships-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "4");

  await createResource(root, {
    id: "system-customer-portal",
    type: "system",
    title: "Customer portal",
    status: "active",
    purpose: "Provide the customer-facing service.",
    servicesProvided: ["Customer portal"],
    boundary: "The application, production platform, and supporting operations.",
    exclusions: [],
    criticality: "high",
    ownerIds: ["appointment-example"]
  });
  const loaded = await loadWorkspace(root);
  const program = loaded.resources.find(({ type }) => type === "program");
  await updateResource(root, "program", program.id, {
    ...program,
    systemIds: [...program.systemIds, "system-customer-portal"]
  });

  await createResource(root, {
    id: "vendor-corporate-card",
    type: "vendor",
    title: "Corporate card provider",
    status: "active",
    category: "financial",
    criticality: "low",
    description: "Supports corporate purchasing outside the selected Program boundary.",
    ownerIds: ["appointment-example"]
  });
  await createResource(root, {
    id: "vendor-platform",
    type: "vendor",
    title: "Platform provider",
    status: "active",
    category: "technology",
    criticality: "high",
    description: "Supplies multiple material Components.",
    ownerIds: ["appointment-example"]
  });
  await createResource(root, {
    id: "component-shared-identity",
    type: "component",
    title: "Shared identity service",
    status: "active",
    componentKind: "external-system",
    description: "Authenticates users for both bounded Systems.",
    ownerIds: ["appointment-example"],
    systemUses: [
      {
        systemId: "system-example",
        roles: ["control-support", "evidence-source"],
        rationale: "Enforces access and produces the authoritative access log for the production application."
      },
      {
        systemId: "system-customer-portal",
        roles: ["service-delivery"],
        rationale: "Provides customer authentication as part of portal delivery."
      }
    ],
    evidenceSourceKinds: ["access-management"],
    evidenceOwnerIds: ["person-example"]
  });
  await createResource(root, {
    id: "component-platform-runtime",
    type: "component",
    title: "Platform runtime",
    status: "active",
    componentKind: "infrastructure",
    description: "Runs the production service.",
    vendorId: "vendor-platform",
    ownerIds: ["appointment-example"],
    systemUses: [{
      systemId: "system-example",
      roles: ["service-delivery", "control-support"],
      rationale: "Runs the service and supports the selected production Controls."
    }]
  });
  await createResource(root, {
    id: "component-platform-logs",
    type: "component",
    title: "Platform audit logs",
    status: "active",
    componentKind: "service",
    description: "Retains authoritative platform audit records.",
    vendorId: "vendor-platform",
    ownerIds: ["appointment-example"],
    systemUses: [{
      systemId: "system-example",
      roles: ["evidence-source"],
      rationale: "Produces the audit records used to evidence production access and changes."
    }],
    evidenceSourceKinds: ["access-management"],
    evidenceOwnerIds: ["person-example"]
  });
  await createResource(root, {
    id: "component-internal-procedure-engine",
    type: "component",
    title: "Internal procedure engine",
    status: "active",
    componentKind: "software",
    description: "Operates a selected Control without an external provider.",
    ownerIds: ["appointment-example"],
    systemUses: [{
      systemId: "system-example",
      roles: ["control-support"],
      rationale: "Runs the workflow used by the selected Control."
    }]
  });

  let current = await loadWorkspace(root);
  const asset = current.resources.find(({ type }) => type === "asset");
  await updateResource(root, "asset", asset.id, { ...asset, componentIds: ["component-platform-runtime"] });
  current = await loadWorkspace(root);
  const evidence = current.resources.find(({ type }) => type === "evidence");
  await updateResource(root, "evidence", evidence.id, {
    ...evidence,
    sourceKind: "component",
    sourceComponentId: "component-platform-logs",
    componentIds: ["component-platform-logs"]
  });
  current = await loadWorkspace(root);
  const control = current.resources.find(({ type }) => type === "control");
  await updateResource(root, "control", control.id, {
    ...control,
    componentIds: ["component-internal-procedure-engine"],
    evidenceSourceComponentIds: ["component-platform-logs"]
  });

  const result = await validateWorkspace(root);
  assert.equal(result.ok, true, result.diagnostics.map(({ message }) => message).join("\n"));
  const records = result.loaded.resources;
  assert.equal(records.find(({ id }) => id === "vendor-corporate-card").type, "vendor");
  assert.equal(records.some(({ type, vendorId }) => type === "component" && vendorId === "vendor-corporate-card"), false);
  assert.equal(records.filter(({ type, vendorId }) => type === "component" && vendorId === "vendor-platform").length, 2);
  assert.equal(records.find(({ id }) => id === "component-internal-procedure-engine").vendorId, undefined);
  assert.deepEqual(records.find(({ id }) => id === asset.id).componentIds, ["component-platform-runtime"]);
  assert.equal(records.find(({ id }) => id === evidence.id).sourceComponentId, "component-platform-logs");
  assert.deepEqual(records.find(({ id }) => id === control.id).componentIds, ["component-internal-procedure-engine"]);
  assert.deepEqual(records.find(({ id }) => id === control.id).evidenceSourceComponentIds, ["component-platform-logs"]);
});

test("v4 Vendor collection revisions track Vendors without Component links", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-model-v4-scope-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "4");
  let loaded = await loadWorkspace(root);
  const program = loaded.resources.find(({ type }) => type === "program");
  assert.equal(loaded.resources.some(({ type, vendorId }) => (
    type === "component" && vendorId === "vendor-example"
  )), false);
  assert.equal(assessCollectionReview(loaded, "vendor", { programId: program.id }).recordCount, 1);
  await applyCollectionReview(root, {
    resourceType: "vendor",
    decision: "complete",
    rationale: "Confirmed every material external provider relationship in the Vendor inventory.",
    reviewedByIds: ["person-example"],
    reviewedOn: "2026-07-01",
    scopeRevision: "example-scope-revision",
    confirmed: true
  });
  loaded = await loadWorkspace(root);
  assert.equal(assessCollectionReview(loaded, "vendor", { programId: program.id }).status, "current");

  await createResource(root, {
    id: "vendor-corporate-card",
    type: "vendor",
    title: "Office supplies provider",
    status: "active",
    category: "office",
    criticality: "low",
    description: "A material commercial relationship that does not supply a Component.",
    ownerIds: ["appointment-example"]
  });
  loaded = await loadWorkspace(root);
  let assessment = assessCollectionReview(loaded, "vendor", { programId: program.id });
  assert.equal(assessment.recordCount, 2);
  assert.equal(assessment.status, "stale");

  await applyCollectionReview(root, {
    resourceType: "vendor",
    decision: "complete",
    rationale: "Confirmed both material external provider relationships.",
    reviewedByIds: ["person-example"],
    reviewedOn: "2026-07-02",
    scopeRevision: "example-scope-revision-2",
    confirmed: true
  });
  loaded = await loadWorkspace(root);
  const vendor = loaded.resources.find(({ id }) => id === "vendor-corporate-card");
  await updateResource(root, "vendor", vendor.id, {
    ...vendor,
    criticality: "medium"
  });
  loaded = await loadWorkspace(root);
  assessment = assessCollectionReview(loaded, "vendor", { programId: program.id });
  assert.equal(assessment.status, "stale");
});
