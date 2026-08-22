import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import { loadModel } from "../model/index.js";
import { runCli } from "../src/cli.js";
import { contentRevision } from "../src/files.js";
import { collectionRevision } from "../src/collection-revision.js";
import { planObligations } from "../src/obligations.js";
import { assessProgramAmendmentReadiness, planProgramAmendment } from "../src/program-amendment.js";
import { assessRequirementMappingReadiness } from "../src/requirement-mapping.js";
import { assessRetentionReadiness, nearDuplicateInformationTypes } from "../src/retention.js";
import { validateWorkspace } from "../src/validate.js";
import { loadWorkspace } from "../src/workspace.js";
import { assessWorkflow } from "../src/workflow.js";
import { makeComprehensiveWorkspace } from "./fixtures.js";
import { captureCli, writeJson } from "./helpers.js";

test("detects missing, mismatched, and stale retention decisions without inferring values", async (context) => {
  const root = await mkdtemp(`${tmpdir()}/filegrc-retention-`);
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await mkdir(`${root}/data`, { recursive: true });
  await writeFile(`${root}/data/workspace.json`, '{"dataModelVersion":"8","id":"workspace","type":"workspace","title":"Workspace"}\n');
  const model = loadModel("8");
  const source = '{"id":"commitment-privacy","type":"commitment","title":"Privacy promise"}\n';
  const resources = [
    { id: "workspace", type: "workspace", title: "Workspace", dataModelVersion: "8" },
    { id: "program-main", type: "program", title: "Program", status: "active", systemIds: ["system-app"] },
    { id: "system-app", type: "system", title: "Application", status: "active", informationTypeIds: ["information-type-customer-records"] },
    { id: "component-app", type: "component", title: "Application component", status: "active", systemUses: [{ systemId: "system-app", roles: ["service-delivery"], rationale: "Runs the service." }], informationUses: [{ informationTypeId: "information-type-customer-records", processingOperations: ["store", "delete"] }] },
    { id: "vendor-host", type: "vendor", title: "Hosting provider", status: "active", informationTypeIds: ["information-type-customer-records"] },
    { id: "information-type-customer-records", type: "information-type", title: "Customer records", status: "active", description: "Customer service records." },
    { id: "commitment-privacy", type: "commitment", title: "Privacy promise", status: "active" },
    { id: "retention-customer", type: "retention-schedule-item", title: "Customer retention", status: "active", description: "Customer service records.", informationTypeIds: ["information-type-customer-records"], scopeResourceIds: ["program-main"], scheduleDocumentId: "document-retention", cutoff: { basis: "event", event: "Contract ends" }, retentionPeriod: { basis: "fixed", amount: 1, unit: "year" }, dispositionAction: "delete", dispositionInstructions: "Use the approved deletion procedure.", sourceResourceIds: ["commitment-privacy"], ownerIds: ["person-owner"], approvedByIds: ["person-owner"], approvedOn: "2026-08-22", reviewedSourceRevisions: { "commitment-privacy": "stale" } },
    { id: "source-coverage-logs", type: "source-coverage", title: "Log coverage", status: "active", retentionScheduleItemIds: ["retention-customer"] },
    { id: "document-retention", type: "document", title: "Retention schedule", status: "active", documentKind: "schedule", workflowScope: "program" },
    { id: "person-owner", type: "person", title: "Owner", status: "active" }
  ];
  const loaded = {
    root,
    model,
    workspace: resources[0],
    resources,
    entries: [{ record: resources[6], source }]
  };

  const stale = await assessRetentionReadiness(loaded, resources[1]);
  assert.equal(stale.find(({ id }) => id === "retention-rule-retention-customer").status, "action");
  assert.equal(stale.filter(({ id }) => id.startsWith("retention-use-")).every(({ status }) => status === "action"), true);
  assert.equal(stale.find(({ id }) => id === "retention-source-coverage-source-coverage-logs").status, "action");

  resources[7].scopeResourceIds.push("source-coverage-logs");
  loaded.entries = [resources[1], resources[2], resources[3], resources[4], resources[5], resources[6], resources[8], resources[9]].map((record) => ({
    record,
    source: record.id === "commitment-privacy" ? source : JSON.stringify(record)
  }));
  resources[7].reviewedSourceRevisions = Object.fromEntries(loaded.entries.map((entry) => [
    entry.record.id,
    contentRevision(entry.source)
  ]));
  const current = await assessRetentionReadiness(loaded, resources[1]);
  assert.equal(current.some(({ id }) => id === "retention-rule-retention-customer"), false);
  assert.equal(current.filter(({ id }) => id.startsWith("retention-use-")).every(({ status }) => status === "complete"), true);
  assert.equal(current.find(({ id }) => id === "retention-source-coverage-source-coverage-logs").status, "complete");
  assert.equal(resources[7].retentionPeriod.amount, 1);
  assert.equal(resources[7].dispositionAction, "delete");

  resources[7].reviewedSourceRevisions["commitment-removed"] = "old-review";
  const extraBinding = await assessRetentionReadiness(loaded, resources[1]);
  assert.equal(extraBinding.find(({ id }) => id === "retention-rule-retention-customer").status, "action");
  delete resources[7].reviewedSourceRevisions["commitment-removed"];

  for (const [resourceIndex, change] of [
    [2, { informationTypeIds: [] }],
    [3, { informationUses: [{ informationTypeId: "information-type-customer-records", processingOperations: ["store"] }] }],
    [4, { informationTypeIds: [] }]
  ]) {
    const entry = loaded.entries.find(({ record }) => record.id === resources[resourceIndex].id);
    const originalSource = entry.source;
    entry.source = JSON.stringify({ ...resources[resourceIndex], ...change });
    const changedUse = await assessRetentionReadiness(loaded, resources[1]);
    assert.equal(changedUse.find(({ id }) => id === "retention-rule-retention-customer").status, "action");
    entry.source = originalSource;
  }

  resources[9].documentKind = "plan";
  const wrongDocument = await assessRetentionReadiness(loaded, resources[1]);
  assert.equal(wrongDocument.find(({ id }) => id === "retention-rule-retention-customer").status, "action");
  resources[9].documentKind = "schedule";
  resources[7].retentionPeriod = { basis: "fixed", value: 1, unit: "year" };
  const malformed = await assessRetentionReadiness(loaded, resources[1]);
  assert.equal(malformed.find(({ id }) => id === "retention-rule-retention-customer").status, "action");
});

test("surfaces near-duplicate Information Types for review without merging them", () => {
  const records = [
    { id: "information-type-customer-record", type: "information-type", title: "Customer Record", status: "active" },
    { id: "information-type-customer-records", type: "information-type", title: "Customer Records", status: "active" },
    { id: "information-type-security-logs", type: "information-type", title: "Security logs", status: "active" }
  ];
  assert.deepEqual(nearDuplicateInformationTypes(records), [{
    leftId: "information-type-customer-record",
    rightId: "information-type-customer-records",
    score: 1
  }]);
  assert.equal(records.length, 3);
});

test("Information Type inventory reviews track scoped System, Component, and Vendor uses", async (context) => {
  const root = await mkdtemp(`${tmpdir()}/filegrc-information-use-review-`);
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await mkdir(`${root}/data`, { recursive: true });
  await writeFile(`${root}/data/workspace.json`, '{"id":"workspace","type":"workspace","title":"Workspace","dataModelVersion":"8"}\n');
  const model = loadModel("8");
  const informationType = { id: "information-type-customer", type: "information-type", title: "Customer data", status: "active" };
  const program = { id: "program-main", type: "program", title: "Program", status: "active", systemIds: ["system-app"] };
  const system = { id: "system-app", type: "system", title: "Application", status: "active", informationTypeIds: [] };
  const component = { id: "component-app", type: "component", title: "Application component", status: "active", systemUses: [{ systemId: system.id, roles: ["service-delivery"], rationale: "Runs the service." }], informationUses: [] };
  const vendor = { id: "vendor-host", type: "vendor", title: "Hosting vendor", status: "active", informationTypeIds: [] };
  const resources = [
    { id: "workspace", type: "workspace", title: "Workspace", dataModelVersion: "8" },
    program,
    informationType,
    system,
    component,
    vendor
  ];
  const loaded = { root, model, workspace: resources[0], resources, entries: [] };

  const baseline = collectionRevision(loaded, "information-type", { program });
  system.informationTypeIds = [informationType.id];
  const systemRevision = collectionRevision(loaded, "information-type", { program });
  assert.notEqual(systemRevision, baseline);

  system.informationTypeIds = [];
  component.informationUses = [{ informationTypeId: informationType.id, processingOperations: ["store"] }];
  const componentRevision = collectionRevision(loaded, "information-type", { program });
  assert.notEqual(componentRevision, baseline);

  component.informationUses = [];
  vendor.informationTypeIds = [informationType.id];
  const vendorRevision = collectionRevision(loaded, "information-type", { program });
  assert.notEqual(vendorRevision, baseline);
});

test("marks a Requirement Mapping stale when either reviewed side changes", async (context) => {
  const root = await mkdtemp(`${tmpdir()}/filegrc-mapping-review-`);
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await mkdir(`${root}/data`, { recursive: true });
  await writeFile(`${root}/data/workspace.json`, '{"dataModelVersion":"8","id":"workspace","type":"workspace","title":"Workspace"}\n');
  const model = loadModel("8");
  const source = { id: "commitment-source", type: "commitment", title: "Source promise", status: "active" };
  const target = { id: "requirement-target", type: "requirement", title: "Target requirement", status: "active" };
  const sourceText = JSON.stringify(source);
  const targetText = JSON.stringify(target);
  const mapping = {
    id: "requirement-mapping-example",
    type: "requirement-mapping",
    title: "Promise to control",
    status: "active",
    sourceResourceIds: [source.id],
    targetResourceIds: [target.id],
    relationship: "intersects-with",
    method: "semantic",
    rationale: "The promise and requirement overlap.",
    ownerIds: ["person-owner"],
    reviewedByIds: ["person-reviewer"],
    reviewedOn: "2026-08-22",
    reviewedSourceRevisions: {
      [source.id]: contentRevision(sourceText),
      [target.id]: contentRevision(targetText)
    }
  };
  const loaded = {
    root,
    model,
    workspace: { id: "workspace", type: "workspace", dataModelVersion: "8" },
    resources: [source, target, mapping],
    entries: [
      { record: source, source: sourceText },
      { record: target, source: targetText },
      { record: mapping, source: JSON.stringify(mapping) }
    ]
  };
  assert.equal((await assessRequirementMappingReadiness(loaded))[0].status, "complete");
  mapping.reviewedSourceRevisions["requirement-removed"] = "old-review";
  assert.equal((await assessRequirementMappingReadiness(loaded))[0].status, "action");
  delete mapping.reviewedSourceRevisions["requirement-removed"];
  delete mapping.rationale;
  assert.equal((await assessRequirementMappingReadiness(loaded))[0].status, "action");
  mapping.rationale = "The promise and requirement overlap.";
  loaded.entries[1].source = JSON.stringify({ ...target, description: "Changed" });
  const stale = (await assessRequirementMappingReadiness(loaded))[0];
  assert.equal(stale.status, "action");
  assert.deepEqual(stale.staleResourceIds, [target.id]);
  const amendment = await planProgramAmendment(loaded, { sourceResourceId: target.id });
  assert.deepEqual(amendment.reviewWork.find(({ resourceType }) => resourceType === "requirement-mapping").resourceIds, [mapping.id]);

  target.type = "control";
  const controlBacked = (await assessRequirementMappingReadiness(loaded))[0];
  assert.equal(controlBacked.commands.some((command) => command.includes(`program-amendment ${target.id}`)), false);
});

test("plans a cohesive supplemental-policy amendment and supports custom obligations", async () => {
  const model = loadModel("8");
  const resources = [
    { id: "workspace", type: "workspace", title: "Workspace", dataModelVersion: "8" },
    { id: "person-owner", type: "person", title: "Owner", status: "active" },
    { id: "policy-privacy", type: "policy", title: "Privacy policy", status: "draft" },
    { id: "policy-security", type: "policy", title: "Security policy", status: "draft" },
    { id: "system-customer-data", type: "system", title: "Customer data system", status: "active" },
    { id: "control-deletion", type: "control", title: "Deletion control", status: "planned" },
    { id: "commitment-deletion", type: "commitment", title: "Deletion promise", status: "planned", sourceResourceIds: ["policy-privacy"], systemIds: ["system-customer-data"], controlIds: ["control-deletion"] },
    { id: "commitment-security", type: "commitment", title: "Security promise", status: "planned", sourceResourceIds: ["policy-security"], controlIds: ["control-deletion"] },
    { id: "retention-deletion", type: "retention-schedule-item", title: "Deletion retention", status: "active", sourceResourceIds: ["policy-privacy"], reviewedSourceRevisions: { "policy-privacy": "stale" } },
    { id: "retention-security", type: "retention-schedule-item", title: "Security retention", status: "active", sourceResourceIds: ["policy-security"], reviewedSourceRevisions: { "policy-security": "stale" } },
    { id: "obligation-privacy-request", type: "obligation", title: "Review privacy request", status: "proposed", activityType: "custom", customActivity: { title: "Privacy request review", completionResourceTypes: ["data-request"] }, recurrence: { mode: "event", eventType: "privacy-request-received" }, window: { precision: "date", startsAfter: 0, dueAfter: 30 }, controlIds: ["control-deletion"], ownerIds: ["person-owner"] }
  ];
  const loaded = { model, workspace: resources[0], resources, entries: [] };
  const amendment = await planProgramAmendment(loaded, { sourceResourceId: "policy-privacy" });
  assert.deepEqual(new Set(amendment.byResourceType.commitment), new Set(["commitment-deletion"]));
  assert.deepEqual(new Set(amendment.byResourceType["retention-schedule-item"]), new Set(["retention-deletion"]));
  assert.deepEqual(amendment.byResourceType.system, ["system-customer-data"]);
  assert.deepEqual(amendment.byResourceType.control, ["control-deletion"]);
  assert.deepEqual(amendment.byResourceType.obligation, ["obligation-privacy-request"]);
  assert.equal(amendment.affected.some(({ id }) => ["policy-security", "commitment-security", "retention-security"].includes(id)), false);
  assert.ok(amendment.reviewWork.some(({ resourceType }) => resourceType === "requirement-mapping"));
  assert.ok(amendment.reviewWork.some(({ resourceType }) => resourceType === "retention-schedule-item"));

  const work = planObligations(resources, { model, asOf: "2026-08-22", through: "2026-08-22" });
  const trigger = work.triggers.find(({ eventType }) => eventType === "privacy-request-received");
  assert.deepEqual(trigger.steps[0].completionResourceTypes, ["data-request"]);
  assert.equal(trigger.steps[0].completionType, "data-request");
});

test("program amendments follow primary mappings and Control-sourced dependents", async () => {
  const model = loadModel("8");
  const resources = [
    { id: "workspace", type: "workspace", title: "Workspace", dataModelVersion: "8" },
    { id: "requirement-privacy", type: "requirement", title: "Privacy requirement", status: "active" },
    { id: "control-deletion", type: "control", title: "Deletion control", status: "implemented" },
    { id: "requirement-operation", type: "requirement", title: "Operating requirement", status: "active" },
    { id: "requirement-mapping-privacy", type: "requirement-mapping", title: "Privacy mapping", status: "active", sourceResourceIds: ["requirement-privacy"], targetResourceIds: ["control-deletion"] },
    { id: "requirement-mapping-control", type: "requirement-mapping", title: "Control mapping", status: "active", sourceResourceIds: ["control-deletion"], targetResourceIds: ["requirement-operation"] },
    { id: "retention-control", type: "retention-schedule-item", title: "Control retention", status: "planned", sourceResourceIds: ["control-deletion"] }
  ];
  const amendment = await planProgramAmendment({ model, workspace: resources[0], resources, entries: [] }, { sourceResourceId: "requirement-privacy" });
  assert.deepEqual(amendment.byResourceType.control, ["control-deletion"]);
  assert.deepEqual(amendment.byResourceType.requirement, ["requirement-operation"]);
  assert.deepEqual(new Set(amendment.byResourceType["requirement-mapping"]), new Set(["requirement-mapping-privacy", "requirement-mapping-control"]));
  assert.deepEqual(amendment.byResourceType["retention-schedule-item"], ["retention-control"]);
});

test("program amendments include Controls directly owned by Policies, Requirements, and Documents", async () => {
  const model = loadModel("8");
  const resources = [
    { id: "workspace", type: "workspace", title: "Workspace", dataModelVersion: "8" },
    { id: "policy-privacy", type: "policy", title: "Privacy policy", status: "active" },
    { id: "requirement-privacy", type: "requirement", title: "Privacy requirement", status: "active" },
    { id: "document-privacy", type: "document", title: "Privacy procedure", status: "active", controlIds: ["control-document"] },
    { id: "control-policy", type: "control", title: "Policy control", status: "implemented", policyIds: ["policy-privacy"] },
    { id: "control-requirement", type: "control", title: "Requirement control", status: "implemented", requirementIds: ["requirement-privacy"] },
    { id: "control-document", type: "control", title: "Document control", status: "implemented" },
    { id: "obligation-policy", type: "obligation", title: "Policy duty", status: "active", controlIds: ["control-policy"] },
    { id: "retention-requirement", type: "retention-schedule-item", title: "Requirement retention", status: "planned", sourceResourceIds: ["control-requirement"] },
    { id: "requirement-mapping-document", type: "requirement-mapping", title: "Document mapping", status: "planned", sourceResourceIds: ["control-document"], targetResourceIds: ["requirement-privacy"] }
  ];
  const loaded = { model, workspace: resources[0], resources, entries: [] };

  const policy = await planProgramAmendment(loaded, { sourceResourceId: "policy-privacy" });
  assert.ok(policy.byResourceType.control.includes("control-policy"));
  assert.ok(policy.byResourceType.obligation.includes("obligation-policy"));

  const requirement = await planProgramAmendment(loaded, { sourceResourceId: "requirement-privacy" });
  assert.ok(requirement.byResourceType.control.includes("control-requirement"));
  assert.ok(requirement.byResourceType["retention-schedule-item"].includes("retention-requirement"));

  const document = await planProgramAmendment(loaded, { sourceResourceId: "document-privacy" });
  assert.ok(document.byResourceType.control.includes("control-document"));
  assert.ok(document.byResourceType["requirement-mapping"].includes("requirement-mapping-document"));
});

test("program amendments follow Commitment Requirements and mapped Requirements into Controls", async () => {
  const model = loadModel("8");
  const resources = [
    { id: "workspace", type: "workspace", title: "Workspace", dataModelVersion: "8" },
    { id: "policy-privacy", type: "policy", title: "Privacy policy", status: "active" },
    { id: "commitment-privacy", type: "commitment", title: "Privacy promise", status: "active", sourceResourceIds: ["policy-privacy"], requirementIds: ["requirement-direct"] },
    { id: "requirement-direct", type: "requirement", title: "Direct requirement", status: "active" },
    { id: "control-direct", type: "control", title: "Direct control", status: "implemented", requirementIds: ["requirement-direct"] },
    { id: "obligation-direct", type: "obligation", title: "Direct duty", status: "active", controlIds: ["control-direct"] },
    { id: "requirement-mapping-privacy", type: "requirement-mapping", title: "Privacy mapping", status: "planned", sourceResourceIds: ["commitment-privacy"], targetResourceIds: ["requirement-mapped"] },
    { id: "requirement-mapped", type: "requirement", title: "Mapped requirement", status: "active" },
    { id: "control-mapped", type: "control", title: "Mapped control", status: "implemented", requirementIds: ["requirement-mapped"] },
    { id: "retention-mapped", type: "retention-schedule-item", title: "Mapped retention", status: "planned", sourceResourceIds: ["control-mapped"] }
  ];
  const loaded = { model, workspace: resources[0], resources, entries: [] };

  const policy = await planProgramAmendment(loaded, { sourceResourceId: "policy-privacy" });
  assert.ok(policy.byResourceType.control.includes("control-direct"));
  assert.ok(policy.byResourceType.obligation.includes("obligation-direct"));

  const commitment = await planProgramAmendment(loaded, { sourceResourceId: "commitment-privacy" });
  assert.ok(commitment.byResourceType.requirement.includes("requirement-mapped"));
  assert.ok(commitment.byResourceType.control.includes("control-mapped"));
  assert.ok(commitment.byResourceType["retention-schedule-item"].includes("retention-mapped"));
});

test("retention scaffold commands shell-escape organization-controlled titles", async () => {
  const model = loadModel("8");
  const informationType = { id: "information-type-hostile", type: "information-type", title: "Customer $(touch nope) 'records'", status: "active" };
  const system = { id: "system-app", type: "system", title: "Application", status: "active", informationTypeIds: [informationType.id] };
  const program = { id: "program-main", type: "program", title: "Program", status: "active", systemIds: [system.id] };
  const resources = [{ id: "workspace", type: "workspace", title: "Workspace", dataModelVersion: "8" }, program, system, informationType];
  const items = await assessRetentionReadiness({ model, workspace: resources[0], resources, entries: [] }, program);
  const command = items.find(({ id }) => id.startsWith("retention-use-")).commands.find((item) => item.includes(" scaffold "));
  assert.match(command, /--title 'Retention for Customer \$\(touch nope\) '\\''records'\\'''$/);
});

test("surfaces supplemental Policy and Commitment adaptation work in shared readiness", async () => {
  const model = loadModel("8");
  const policy = { id: "policy-privacy", type: "policy", title: "Privacy policy", status: "draft", programRole: "supporting" };
  const resources = [
    { id: "workspace", type: "workspace", title: "Workspace", dataModelVersion: "8" },
    policy,
    { id: "document-privacy-schedule", type: "document", title: "Privacy schedule", status: "draft", workflowScope: "program", programRole: "supporting" }
  ];
  const loaded = { model, workspace: resources[0], resources, entries: [] };
  const missingCommitment = await assessProgramAmendmentReadiness(loaded);
  assert.equal(missingCommitment.some(({ resourceId, title }) => resourceId === policy.id && title.startsWith("Record commitments")), true);
  assert.equal(missingCommitment.some(({ resourceId, title }) => resourceId === "document-privacy-schedule" && title.startsWith("Record commitments")), true);
  const policyCommitmentAction = missingCommitment.find(({ resourceId, title }) => resourceId === policy.id && title.startsWith("Record commitments"));
  assert.equal(policyCommitmentAction.createResourceType, "commitment");
  assert.deepEqual(policyCommitmentAction.sourceResourceIds, [policy.id]);
  assert.match(policyCommitmentAction.commands[0], /scaffold commitment/);

  resources.push({
    id: "commitment-privacy",
    type: "commitment",
    title: "Privacy promise",
    status: "planned",
    sourceResourceIds: [policy.id]
  });
  const missingMapping = await assessProgramAmendmentReadiness(loaded);
  assert.equal(missingMapping.some(({ resourceId, title }) => resourceId === policy.id && title.startsWith("Map commitments")), true);
  assert.equal(missingMapping.some(({ resourceId, title }) => resourceId === "commitment-privacy" && title.startsWith("Map commitments")), true);
  const policyMappingAction = missingMapping.find(({ resourceId, title }) => resourceId === policy.id && title.startsWith("Map commitments"));
  assert.equal(policyMappingAction.createResourceType, "requirement-mapping");
  assert.deepEqual(policyMappingAction.sourceResourceIds, ["commitment-privacy"]);
});

test("exposes the program amendment plan through the headless CLI", async (context) => {
  const root = await mkdtemp(`${tmpdir()}/filegrc-program-amendment-`);
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "8");
  const result = await captureCli(runCli, ["program-amendment", "policy-example", "--root", root, "--json"]);
  assert.equal(result.result.source.id, "policy-example");
  assert.equal(typeof result.result.source.reviewRevision, "string");
  assert.match(result.stdout, /"principle"/);

  const loaded = await loadWorkspace(root);
  const retention = loaded.resources.find(({ type }) => type === "retention-schedule-item");
  const bindings = await captureCli(runCli, ["review-bindings", retention.id, "--root", root, "--json"]);
  assert.equal(bindings.result.resource.id, retention.id);
  assert.deepEqual(Object.keys(bindings.result.reviewedSourceRevisions).sort(), bindings.result.dependencyIds.sort());
  assert.deepEqual(bindings.result.missingResourceIds, []);
});

test("shared workflow keeps retention action context for browser and CLI consumers", async (context) => {
  const root = await mkdtemp(`${tmpdir()}/filegrc-retention-workflow-context-`);
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "8");
  const loaded = await loadWorkspace(root);
  const componentEntry = loaded.entries.find(({ record }) => record.type === "component" && record.systemUses?.length);
  const informationType = loaded.resources.find(({ type }) => type === "information-type");
  assert.ok(componentEntry && informationType);
  await writeJson(componentEntry.path, {
    ...componentEntry.record,
    informationUses: [{ informationTypeId: informationType.id, processingOperations: ["store"] }]
  });

  const workflow = await assessWorkflow(root);
  const finding = workflow.findings.find(({ code }) => code.includes(`retention-use-${componentEntry.record.id}-${informationType.id}`));
  assert.equal(finding.resourceId, componentEntry.record.id);
  assert.equal(finding.informationTypeId, informationType.id);
});

test("validation requires active retention and mapping reviews to bind their sources", async (context) => {
  const root = await mkdtemp(`${tmpdir()}/filegrc-retention-validation-`);
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "8");
  const loaded = await loadWorkspace(root);
  const retentionEntry = loaded.entries.find(({ record }) => record.type === "retention-schedule-item");
  const policy = loaded.resources.find(({ type }) => type === "policy");
  const approver = loaded.resources.find(({ type }) => type === "person");
  await writeJson(retentionEntry.path, {
    ...retentionEntry.record,
    status: "active",
    sourceResourceIds: [policy.id],
    cutoff: { basis: "event", event: "Coverage ends" },
    retentionPeriod: { basis: "fixed", amount: 1, unit: "year" },
    dispositionAction: "delete",
    dispositionInstructions: "Use the approved deletion procedure.",
    approvedByIds: [approver.id],
    approvedOn: "2026-08-22",
    reviewedSourceRevisions: {}
  });
  const validation = await validateWorkspace(root);
  assert.ok(validation.diagnostics.some(({ code, path }) => (
    code === "stale-retention-review" && path.endsWith(`${retentionEntry.record.id}.json`)
  )));

  await writeJson(retentionEntry.path, {
    ...retentionEntry.record,
    status: "active",
    sourceResourceIds: [policy.id],
    cutoff: { basis: "event", event: "Coverage ends" },
    retentionPeriod: { basis: "fixed", amount: 1, unit: "year" },
    dispositionAction: "delete",
    dispositionInstructions: "Use the approved deletion procedure.",
    approvedByIds: [approver.id],
    approvedOn: "2026-08-22",
    reviewedSourceRevisions: Object.fromEntries([
      retentionEntry.record.scheduleDocumentId,
      ...(retentionEntry.record.informationTypeIds || []),
      ...(retentionEntry.record.scopeResourceIds || []),
      policy.id
    ].map((id) => [id, "non-empty-but-stale"]))
  });
  const staleDigestValidation = await validateWorkspace(root);
  assert.ok(staleDigestValidation.diagnostics.some(({ code, path }) => (
    code === "stale-retention-review" && path.endsWith(`${retentionEntry.record.id}.json`)
  )));

  const mappingEntry = loaded.entries.find(({ record }) => record.type === "requirement-mapping");
  await writeJson(mappingEntry.path, {
    ...mappingEntry.record,
    status: "active",
    reviewedSourceRevisions: Object.fromEntries([
      ...(mappingEntry.record.sourceResourceIds || []),
      ...(mappingEntry.record.targetResourceIds || [])
    ].map((id) => [id, "non-empty-but-stale"]))
  });
  const staleMappingValidation = await validateWorkspace(root);
  assert.ok(staleMappingValidation.diagnostics.some(({ code, path }) => (
    code === "stale-requirement-mapping" && path.endsWith(`${mappingEntry.record.id}.json`)
  )));

  const mappedId = mappingEntry.record.sourceResourceIds[0];
  await writeJson(mappingEntry.path, {
    ...mappingEntry.record,
    sourceResourceIds: [mappedId],
    targetResourceIds: [mappedId]
  });
  const overlapValidation = await validateWorkspace(root);
  assert.ok(overlapValidation.diagnostics.some(({ code, path }) => (
    code === "invalid-requirement-mapping" && path.endsWith(`${mappingEntry.record.id}.json`)
  )));
});
