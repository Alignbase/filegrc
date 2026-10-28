import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadModel } from "../model/index.js";
import { collectionRecordProposals } from "../src/collection-scope.js";
import { assessCollectionReview, collectionRevision } from "../src/collection-review.js";
import { assessProgramReadiness, collectionReviewReadinessItem } from "../src/program-readiness.js";
import { loadWorkspace } from "../src/workspace.js";
import { assessWorkflow } from "../src/workflow.js";
import { makeComprehensiveWorkspace } from "./fixtures.js";

function proposal(record, sources = []) {
  const program = { id: "program-example", type: "program", status: "active", controlIds: ["control-example"] };
  const loaded = { model: loadModel(), resources: [program, record, ...sources] };
  return collectionRecordProposals(loaded, record.type, [record], program)[0];
}

test("dormant inventory proposals retain incomplete setup state without becoming live operating work", () => {
  for (const [type, status] of [["component", "planned"], ["vendor", "evaluating"], ["information-type", "planned"], ["complementary-control", "planned"]]) {
    const record = { id: `${type}-future`, title: "Future capability", type, status };
    const result = proposal(record);
    assert.equal(result.complete, false, type);
    assert.equal(result.operatingStatus, "later", type);
    assert.equal(result.operatingDependencyIds, undefined, type);
    const setup = collectionReviewReadinessItem({
      resourceType: type, recordCount: 1, complete: false,
      configuration: { title: "Inventory", decisions: ["complete"] },
      recordProposals: [result], incompleteRecordProposals: [result]
    });
    assert.equal(setup.status, "action", type);
    assert.equal(setup.resourceId, record.id, type);
  }
});

test("live and pre-use dependencies keep proposed Components and evaluating Vendors actionable", () => {
  const component = { id: "component-future", title: "Future source", type: "component", status: "planned", vendorId: "vendor-future" };
  const vendor = { id: "vendor-future", title: "Potential provider", type: "vendor", status: "evaluating" };
  for (const source of [
    { id: "control-example", type: "control", status: "implemented", evidenceSourceComponentIds: [component.id] },
    { id: "control-example", type: "control", status: "implemented", componentIds: [component.id] },
    { id: "asset-example", type: "asset", status: "active", componentIds: [component.id] },
    { id: "coverage-example", type: "source-coverage", status: "active", componentId: component.id }
  ]) {
    const result = proposal(component, [source]);
    assert.equal(result.operatingStatus, "action", source.type);
    assert.deepEqual(result.operatingDependencyIds, [source.id], source.type);
    const provider = proposal(vendor, [component, source]);
    assert.equal(provider.operatingStatus, "action", source.type);
    assert.deepEqual(provider.operatingDependencyIds, [component.id], source.type);
  }
  for (const status of ["active", "deprecated"]) {
    assert.equal(proposal(vendor, [{ ...component, status }]).operatingStatus, "action", status);
  }
  for (const source of [
    { id: "control-example", type: "control", status: "planned", componentIds: [component.id] },
    { id: "control-unselected", type: "control", status: "implemented", componentIds: [component.id] },
    { id: "access-example", type: "access-grant", status: "requested", componentId: component.id },
    { id: "access-example", type: "access-grant", status: "approved", componentId: component.id },
    { id: "access-example", type: "access-grant", status: "active", componentId: component.id },
    { id: "access-example", type: "access-grant", status: "revoked", componentId: component.id },
    { id: "coverage-example", type: "source-coverage", status: "retired", componentId: component.id },
    { id: "coverage-example", type: "source-coverage", status: "planned", componentId: component.id }
  ]) {
    assert.equal(proposal(component, [source]).operatingStatus, "later", `${source.type}/${source.status}`);
    assert.equal(proposal(vendor, [component, source]).operatingStatus, "later", `${source.type}/${source.status}`);
  }
});

test("potential information uses do not imply processing, while live uses remain actionable", () => {
  const information = { id: "information-type-future", title: "Future data", type: "information-type", status: "planned" };
  for (const source of [
    { id: "system-example", type: "system", informationTypeIds: [information.id] },
    { id: "vendor-example", type: "vendor", informationTypeIds: [information.id] },
    { id: "component-example", type: "component", informationUses: [{ informationTypeId: information.id }] }
  ]) {
    assert.equal(proposal(information, [{ ...source, status: "planned" }]).operatingStatus, "later", source.type);
    assert.equal(proposal(information, [{ ...source, status: "active" }]).operatingStatus, "action", source.type);
    assert.equal(proposal(information, [{ ...source, status: "deprecated" }]).operatingStatus, "action", source.type);
    assert.equal(proposal(information, [{ ...source, status: "retired" }]).operatingStatus, "later", source.type);
  }
});

test("live reliance on a planned Component propagates to its information processing and complementary duties", () => {
  const information = { id: "information-type-future", title: "Future data", type: "information-type", status: "planned" };
  const component = { id: "component-future", title: "Future processor", type: "component", status: "planned", informationUses: [{ informationTypeId: information.id, processingOperations: ["store"] }] };
  const complementary = { id: "complementary-control-future", title: "Future duty", type: "complementary-control", status: "planned", componentIds: [component.id] };
  for (const source of [
    { id: "control-example", type: "control", status: "implemented", componentIds: [component.id] },
    { id: "control-example", type: "control", status: "implemented", evidenceSourceComponentIds: [component.id] },
    { id: "asset-example", type: "asset", status: "active", componentIds: [component.id] },
    { id: "coverage-example", type: "source-coverage", status: "active", componentId: component.id }
  ]) {
    for (const record of [information, complementary]) {
      const result = proposal(record, [component, source]);
      assert.equal(result.operatingStatus, "action", `${record.type}/${source.type}`);
      assert.deepEqual(result.operatingDependencyIds, [component.id]);
      assert.equal(result.complete, false);
    }
  }
  for (const record of [information, complementary]) {
    const result = proposal(record, [{ ...component, status: "deprecated" }]);
    assert.equal(result.operatingStatus, "action", record.type);
    assert.deepEqual(result.operatingDependencyIds, [component.id]);
  }
});

test("ended sources and proposal links cannot supply their own proof of live operation", () => {
  const information = { id: "information-type-future", title: "Future data", type: "information-type", status: "planned" };
  const component = { id: "component-future", title: "Future processor", type: "component", status: "planned", vendorId: "vendor-future", informationUses: [{ informationTypeId: information.id, processingOperations: ["store"] }] };
  const vendor = { id: "vendor-future", title: "Potential provider", type: "vendor", status: "evaluating", informationTypeIds: [information.id] };
  const complementary = { id: "complementary-control-future", title: "Future duty", type: "complementary-control", status: "planned", componentIds: [component.id], relatedControlIds: ["control-example"] };
  for (const source of [
    { id: "access-example", type: "access-grant", status: "requested", componentId: component.id },
    { id: "access-example", type: "access-grant", status: "approved", componentId: component.id },
    { id: "access-example", type: "access-grant", status: "active", componentId: component.id },
    { id: "access-example", type: "access-grant", status: "revoked", componentId: component.id },
    { id: "access-example", type: "access-grant", status: "expired", componentId: component.id },
    { id: "control-example", type: "control", status: "planned", componentIds: [component.id] },
    { id: "control-example", type: "control", status: "retired", componentIds: [component.id] },
    { id: "coverage-example", type: "source-coverage", status: "retired", componentId: component.id },
    { id: "asset-example", type: "asset", status: "retired", componentIds: [component.id] },
    { id: "asset-example", type: "asset", status: "disposed", componentIds: [component.id] }
  ]) {
    for (const record of [information, complementary]) {
      assert.equal(proposal(record, [component, vendor, source]).operatingStatus, "later", `${record.type}/${source.type}/${source.status}`);
    }
  }
  const activeAccess = { id: "access-example", type: "access-grant", status: "active", componentId: component.id };
  for (const record of [information, complementary]) {
    assert.equal(proposal(record, [{ ...component, status: "retired" }, activeAccess]).operatingStatus, "later", record.type);
  }
  for (const source of [
    { id: "system-former", type: "system", status: "retired", informationTypeIds: [information.id] },
    { id: "vendor-former", type: "vendor", status: "terminated", informationTypeIds: [information.id] }
  ]) assert.equal(proposal(information, [source]).operatingStatus, "later", source.type);
  // These proposal relationships form a connected dependency graph, but none
  // is a live access grant, implementation or processing assertion.
  for (const record of [information, vendor, complementary]) {
    assert.equal(proposal(record, [component, ...[information, vendor, complementary].filter(item => item.id !== record.id)]).operatingStatus, "later", record.type);
  }
});

test("live incomplete inventory and real complementary dependencies remain operating actions", () => {
  for (const status of ["active", "deprecated"]) {
    assert.equal(proposal({ id: "component-example", type: "component", title: "Incomplete source", status }).operatingStatus, "action");
  }
  const complementary = { id: "complementary-control-future", type: "complementary-control", title: "Future responsibility", status: "planned", relatedControlIds: ["control-example"] };
  assert.equal(proposal(complementary, [{ id: "control-example", type: "control", status: "implemented" }]).operatingStatus, "action");
  assert.equal(proposal(complementary, [{ id: "control-example", type: "control", status: "planned" }]).operatingStatus, "later");
  for (const [type, status] of [["component", "retired"], ["vendor", "terminated"], ["information-type", "superseded"], ["complementary-control", "retired"]]) {
    assert.equal(proposal({ id: `${type}-former`, type, status }), undefined, `${type}/${status}`);
  }
});

test("shared program readiness schedules dormant proposals after setup and keeps genuine dependencies actionable", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-operating-proposals-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const program = loaded.resources.find(({ type }) => type === "program");
  const component = { id: "component-future", type: "component", title: "Future capability", status: "planned" };
  const vendor = { id: "vendor-future", type: "vendor", title: "Potential provider", status: "evaluating" };
  loaded.resources.push(component, vendor);
  for (const resourceType of ["component", "vendor"]) {
    const assessment = assessCollectionReview(loaded, resourceType, { programId: program.id });
    const review = {
      id: `collection-review-${resourceType}-example`, type: "collection-review", title: "Inventory review", status: "active",
      resourceType, scopeResourceIds: [program.id], decision: "complete", reviewedByIds: ["person-example"],
      reviewedOn: "2026-09-12", coverage: { kind: "as-of", on: "2026-09-12" }, knowledgeCutoffAt: "2026-09-12T12:00:00Z",
      populationResourceIds: assessment.records.map(({ id }) => id), collectionRevision: collectionRevision(loaded, resourceType, { programId: program.id })
    };
    loaded.resources = loaded.resources.filter((record) => !(record.type === "collection-review" && record.resourceType === resourceType));
    loaded.entries = loaded.entries.filter(({ record }) => !(record.type === "collection-review" && record.resourceType === resourceType));
    loaded.resources.push(review);
    loaded.entries.push({ record: review, source: JSON.stringify(review) });
    assert.equal(assessCollectionReview(loaded, resourceType, { programId: program.id }).complete, true);
  }
  let readiness = await assessProgramReadiness(loaded, { asOf: "2026-09-12" });
  for (const record of [component, vendor]) {
    const item = readiness.stages.at(-1).items.find(({ resourceId }) => resourceId === record.id);
    assert.equal(item?.status, "later", record.type);
    assert.doesNotMatch(item.message, /retire|activate/i);
    assert.ok(!readiness.nextAction || readiness.nextAction.resourceId !== record.id);
  }
  const workflow = await assessWorkflow(loaded, { programReadiness: readiness, auditPreparations: {}, asOf: "2026-09-12" });
  for (const record of [component, vendor]) {
    const finding = workflow.findings.find(({ key }) => key.endsWith(`operating-${record.type}-${record.id}`));
    assert.equal(finding?.state, "scheduled", record.type);
    assert.equal(finding?.severity, "info", record.type);
  }
  component.vendorId = vendor.id;
  loaded.resources.push({ id: "access-future-example", type: "access-grant", status: "active", componentId: component.id });
  readiness = await assessProgramReadiness(loaded, { asOf: "2026-09-12" });
  for (const record of [component, vendor]) {
    const item = readiness.stages.at(-1).items.find(({ resourceId }) => resourceId === record.id);
    assert.equal(item?.status, "later", record.type);
    assert.match(item.message, /setup accounts separately/);
  }
  loaded.resources.push({ id: "coverage-future-example", type: "source-coverage", status: "active", componentId: component.id });
  readiness = await assessProgramReadiness(loaded, { asOf: "2026-09-12" });
  for (const record of [component, vendor]) {
    const item = readiness.stages.at(-1).items.find(({ resourceId }) => resourceId === record.id);
    assert.equal(item?.status, "action", record.type);
    assert.match(item.message, /actual use/);
  }
});
