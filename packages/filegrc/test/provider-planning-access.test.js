import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assessProgramAccessReview, providerAccessPopulation } from "../src/provider-access-completion.js";
import { collectionRecordProposals } from "../src/collection-scope.js";
import { assessEvidenceMap } from "../src/program-readiness.js";
import { loadWorkspace } from "../src/workspace.js";
import { makeComprehensiveWorkspace } from "./fixtures.js";

async function setupFixture(context) {
  const root = await mkdtemp(join(tmpdir(), "filegrc-provider-setup-access-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "13");
  const loaded = await loadWorkspace(root);
  const get = type => loaded.resources.find(record => record.type === type);
  const program = get("program"), component = get("component"), vendor = get("vendor"), grant = get("access-grant");
  const review = get("access-review"), proof = get("evidence"), control = get("control"), coverage = get("source-coverage");
  const information = { id: "information-type-future", type: "information-type", title: "Future service data", status: "planned", description: "Data considered for future service use." };
  component.status = "planned";
  component.vendorId = vendor.id;
  component.informationUses = [{ informationTypeId: information.id, processingOperations: ["store"] }];
  vendor.status = "evaluating";
  program.controlIds = [];
  // Keep actual operational reliance out of this setup-account fixture.
  loaded.resources = loaded.resources.filter(record => !["control", "source-coverage", "asset"].includes(record.type));
  loaded.resources.push(information);
  Object.assign(grant, { status: "active", componentId: component.id, businessNeed: "Set up and evaluate the provider account before service adoption.", provisionedOn: "2026-07-01" });
  Object.assign(review, { status: "complete", componentIds: [component.id], completedOn: "2026-07-01", approvedOn: "2026-07-02", populationCount: 1, exceptionCount: 0,
    grantDecisions: [{ accessGrantId: grant.id, decision: "retain" }], evidenceIds: [proof.id],
    sourceReconciliations: [{ componentId: component.id, boundary: "direct", populationEvidenceId: proof.id,
      accounts: [{ accountReference: "setup-account-1", disposition: "authorized", subjectId: grant.subjectId, authorizationKind: "access-grant", accessGrantIds: [grant.id] }] }] });
  Object.assign(proof, { artifactKind: "population-export", sourceKind: "component", sourceComponentId: component.id,
    collectedOn: "2026-07-01", verifiedOn: "2026-07-01", generatedAt: "2026-07-01T10:00:00Z", timezone: "UTC",
    externalReference: { url: "https://evidence.example.test/setup-account-population" }, queryDescription: "All setup accounts and permissions in this provider account.",
    populationCount: 1, completenessValidation: "Reconciled every account class against the provider account total.", accuracyValidation: "Checked identity, authorization and permissions against the account details.",
    coverage: { kind: "as-of", on: "2026-07-01" } });
  delete proof.filePaths;
  const assess = () => assessProgramAccessReview(review, loaded, program, [], "2026-10-13", { historicalAssessment: true });
  const proposal = record => collectionRecordProposals(loaded, record.type, [record], program)[0];
  return { loaded, program, component, vendor, information, grant, review, proof, control, coverage, assess, proposal };
}

test("planned scoped provider accounts can be fully reconciled while service and information proposals remain dormant", async (context) => {
  const { loaded, program, component, vendor, information, grant, assess, proposal } = await setupFixture(context);
  assert.deepEqual(providerAccessPopulation(loaded, program, []).componentIds, [component.id]);
  assert.deepEqual(providerAccessPopulation(loaded, program, []).grants.map(({ id }) => id), [grant.id]);
  const result = assess();
  assert.equal(result.complete, true, JSON.stringify(result.missingFacts));
  for (const record of [component, vendor, information]) {
    assert.equal(proposal(record).operatingStatus, "later", record.type);
    assert.equal(proposal(record).complete, false, record.type);
  }
  assert.equal(component.status, "planned");
  assert.equal(vendor.status, "evaluating");
  assert.equal(information.status, "planned");
});

test("approved unprovisioned setup access stays outside actual provider population and cannot pass as active access", async (context) => {
  const { loaded, program, component, vendor, grant, assess, proposal } = await setupFixture(context);
  grant.status = "approved";
  delete grant.provisionedOn;
  delete grant.provisionedByIds;
  assert.deepEqual(providerAccessPopulation(loaded, program, []).componentIds, []);
  assert.deepEqual(providerAccessPopulation(loaded, program, []).grants, []);
  assert.equal(proposal(component).operatingStatus, "later");
  assert.equal(proposal(vendor).operatingStatus, "later");
  assert.equal(assess().complete, false, "A retained active-account decision cannot claim unprovisioned approved access.");
});

test("setup reconciliation preserves expired, invalid, unknown and unauthorized account blockers", async (context) => {
  const fixture = await setupFixture(context);
  const originalGrant = structuredClone(fixture.grant), originalReview = structuredClone(fixture.review);
  for (const [label, mutate, expected] of [
    ["expired grant", ({ grant }) => { grant.expiresOn = "2026-10-12"; }, "current-authorized-access"],
    ["invalid grant", ({ grant }) => { delete grant.approvedByIds; }, "current-authorized-access"],
    ["unknown subject", ({ grant }) => { grant.subjectId = "person-unknown"; }, "current-authorized-access"],
    ["unknown authorizer", ({ grant }) => { grant.approvedByIds = ["person-unknown"]; }, "current-authorized-access"],
    ["unknown provisioner", ({ grant }) => { grant.provisionedByIds = ["person-unknown"]; }, "current-authorized-access"],
    ["unknown provider account", ({ review }) => { review.sourceReconciliations[0].accounts[0].disposition = "unresolved"; delete review.sourceReconciliations[0].accounts[0].authorizationKind; }, "unresolved-provider-accounts"],
    ["unauthorized account", ({ review }) => { review.sourceReconciliations[0].accounts[0].accessGrantIds = []; }, "accountable-provider-identities"],
    ["future provisioning", ({ grant }) => { grant.provisionedOn = "2026-10-14"; }, "current-authorized-access"],
    ["unapproved grant", ({ grant }) => { delete grant.approvedOn; }, "current-authorized-access"]
  ]) {
    for (const key of Object.keys(fixture.grant)) delete fixture.grant[key];
    for (const key of Object.keys(fixture.review)) delete fixture.review[key];
    Object.assign(fixture.grant, structuredClone(originalGrant));
    Object.assign(fixture.review, structuredClone(originalReview));
    mutate(fixture);
    const result = fixture.assess();
    assert.equal(result.complete, false, label);
    assert.ok(result.missingFacts.includes(expected), `${label}: ${JSON.stringify(result.missingFacts)}`);
    assert.equal(fixture.proposal(fixture.component).operatingStatus, "later", label);
  }
});

test("planned setup-account boundaries stay within the selected Program", async (context) => {
  const { loaded, program, component, grant, assess } = await setupFixture(context);
  const other = { ...structuredClone(component), id: "component-other-program", systemUses: [{ ...component.systemUses[0], systemId: "system-other-program" }] };
  const otherProgram = { ...structuredClone(program), id: "program-other", systemIds: ["system-other-program"] };
  const otherGrant = { ...structuredClone(grant), id: "access-grant-other-program", componentId: other.id };
  loaded.resources.push(other, otherProgram, otherGrant);
  assert.deepEqual(providerAccessPopulation(loaded, program, []).componentIds, [component.id]);
  assert.deepEqual(providerAccessPopulation(loaded, program, []).grants.map(({ id }) => id), [grant.id]);
  assert.equal(assess().complete, true);
  assert.deepEqual(providerAccessPopulation(loaded, otherProgram, []).componentIds, [other.id]);
  component.systemUses = [];
  const result = assess();
  assert.equal(result.complete, false, "An old reviewed row cannot give an unscoped planned provider authority.");
  assert.deepEqual(providerAccessPopulation(loaded, program, []).componentIds, []);
});

test("real implementation and processing dependencies retain ordinary activation and source gates", async (context) => {
  const { loaded, program, component, vendor, information, control, coverage, proposal, assess } = await setupFixture(context);
  assert.equal(assess().complete, true);
  Object.assign(control, { status: "implemented", evidenceSourceComponentIds: [component.id], componentIds: [component.id] });
  program.controlIds = [control.id];
  loaded.resources.push(control);
  assert.equal(proposal(component).operatingStatus, "action");
  assert.equal(proposal(vendor).operatingStatus, "action");
  assert.equal(proposal(information).operatingStatus, "action");
  const map = await assessEvidenceMap(loaded, { asOf: "2026-10-13" });
  assert.equal(map.status, "action", "Reviewing setup accounts cannot activate the planned operational evidence source.");
  assert.ok(map.items.some(item => item.sourceComponentChecks?.some(check => check.sourceComponentId === component.id && check.checks.active === false)));
  loaded.resources = loaded.resources.filter(record => record.id !== control.id);
  program.controlIds = [];
  Object.assign(coverage, { status: "active", componentId: component.id });
  loaded.resources.push(coverage);
  assert.equal(proposal(component).operatingStatus, "action");
  assert.equal(proposal(vendor).operatingStatus, "action");
  assert.equal(component.status, "planned");
});
