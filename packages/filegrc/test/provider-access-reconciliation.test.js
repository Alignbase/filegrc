import assert from "node:assert/strict";
import test from "node:test";
import { assessProviderAccessReconciliation } from "../src/provider-access-reconciliation.js";

function fixture() {
  const records = [
    { id: "person-owner", type: "person", status: "active" },
    { id: "service-worker", type: "service-account", status: "active", componentIds: ["component-provider"], ownerIds: ["person-owner"] },
    { id: "grant-owner", type: "access-grant", componentId: "component-provider", subjectId: "person-owner", status: "active" },
    { id: "proof-population", type: "evidence", externalReference: { url: "https://evidence.example.com/population" }, sourceComponentId: "component-provider", collectedOn: "2026-07-01", generatedAt: "2026-07-01T10:00:00Z", populationCount: 3 },
    { id: "proof-boundary", type: "evidence", externalReference: { url: "https://evidence.example.com/observation" }, componentIds: ["component-inherited", "component-files"], collectedOn: "2026-07-01" },
    { id: "proof-removal", type: "evidence", generatedAt: "2026-07-01T12:00:00Z", externalReference: { url: "https://evidence.example.com/observation" }, componentIds: ["component-provider"], collectedOn: "2026-07-01" }
  ];
  const byId = new Map(records.map(r => [r.id, r]));
  const row = { componentId: "component-provider", boundary: "direct", populationEvidenceId: "proof-population", accounts: [
    { accountReference: "row-1", disposition: "authorized", subjectId: "person-owner", authorizationKind: "access-grant", accessGrantIds: ["grant-owner"] },
    { accountReference: "row-2", disposition: "authorized", subjectId: "service-worker", authorizationKind: "service-account-inventory" },
    { accountReference: "row-3", disposition: "provider-managed", rationale: "Provider-owned noninteractive service role; reviewed trust boundary in retained export" }
  ] };
  const candidate = { sourceReconciliations: [row], populationCount: 3, grantDecisions: [{ accessGrantId: "grant-owner", decision: "retain" }],
    evidenceIds: ["proof-population", "proof-boundary", "proof-removal"], completedOn: "2026-07-01", approvedOn: "2026-07-02", approvedByIds: ["person-owner"] };
  const context = { componentIds: ["component-provider"], exports: [byId.get("proof-population")], byId, asOf: "2026-07-03",
    valid: () => true, proofValid: () => true, grants: [byId.get("grant-owner")] };
  return { candidate, context, row, byId, assess: () => assessProviderAccessReconciliation(candidate, context) };
}

test("account, grant, and service identity counts reconcile independently", () => {
  const { row, candidate, byId, assess } = fixture();
  assert.deepEqual(assess().issues, []);
  row.accounts.push({ ...row.accounts[0], accountReference: "row-4" });
  byId.get("proof-population").populationCount = candidate.populationCount = 4;
  assert.deepEqual(assess().issues, [], "Multiple accounts can map to the same approved grant");
  row.accounts.pop();
  assert.deepEqual(assess().missingSourceIds, ["component-provider"], "Missing provider row blocks even with valid grant decisions");
});

test("unknown, duplicate and unauthorized accounts cannot pass", () => {
  const { row, assess } = fixture();
  row.accounts[1].disposition = "unresolved";
  assert.ok(assess().issues.includes("unresolved-provider-accounts"));
  row.accounts[1].disposition = "authorized";
  row.accounts[1].subjectId = "missing";
  assert.ok(assess().issues.includes("accountable-provider-identities"));
  row.accounts[1].accountReference = "row-1";
  assert.ok(assess().issues.includes("unique-provider-account-references"));
});

test("provider-managed exclusions are explicit and cannot conceal mapped human access", () => {
  const { row, assess } = fixture();
  row.accounts[2].rationale = "";
  assert.ok(assess().issues.includes("bounded-provider-managed-exclusions"));
  row.accounts[2].rationale = "Provider-managed role";
  row.accounts[2].subjectId = "person-owner";
  assert.ok(assess().issues.includes("bounded-provider-managed-exclusions"));
});

test("existing human accounts can receive an actual current renewed authorization", () => {
  const { row, candidate, context, assess } = fixture();
  context.grants = []; candidate.grantDecisions = [];
  Object.assign(row.accounts[0], { authorizationKind: "review-renewal", accessGrantIds: [], rationale: "Renew continued introduction access based on current business need" });
  assert.deepEqual(assess().issues, []);
  row.accounts[0].rationale = "";
  assert.ok(assess().issues.includes("accountable-provider-identities"));
  row.accounts[0].rationale = "Current business need"; candidate.approvedOn = "2027-01-01";
  assert.ok(assess().issues.includes("accountable-provider-identities"));
});

test("mappings stay with the correct provider and accountable subject", () => {
  const { row, byId, assess } = fixture();
  byId.get("grant-owner").componentId = "component-other";
  assert.ok(assess().issues.includes("account-grant-mappings"));
  byId.get("grant-owner").componentId = "component-provider";
  row.accounts[0].subjectId = "service-worker";
  assert.ok(assess().issues.includes("account-grant-mappings"));
});

test("owned service identities require active inventory, provider boundary and current owners", () => {
  const { byId, assess } = fixture();
  byId.get("service-worker").ownerIds = [];
  assert.ok(assess().issues.includes("accountable-provider-identities"));
  byId.get("service-worker").ownerIds = ["person-owner"];
  byId.get("service-worker").reviewDueOn = "2026-06-30";
  assert.ok(assess().issues.includes("accountable-provider-identities"));
  delete byId.get("service-worker").reviewDueOn;
  byId.get("service-worker").expiresOn = "2026-06-30";
  assert.ok(assess().issues.includes("accountable-provider-identities"), "Expired service inventory cannot authorize current access");
});

test("removed accounts retain actual resolution proof", () => {
  const { row, byId, assess } = fixture();
  row.accounts[2] = { accountReference: "row-3", disposition: "removed", rationale: "Unneeded old integration", resolutionEvidenceIds: ["proof-removal"] };
  assert.deepEqual(assess().issues, []);
  row.accounts[2].resolutionEvidenceIds = ["proof-population"];
  assert.deepEqual(assess().issues, [], "A current population export showing inactive status can itself be the removal proof");
  row.accounts[2].resolutionEvidenceIds = ["proof-removal"];
  byId.get("proof-removal").collectedOn = "2025-01-01";
  assert.ok(assess().issues.includes("resolved-provider-account-removals"), "Historical proof does not resolve the current observed population");
  byId.get("proof-removal").collectedOn = "2026-07-01";
  byId.get("proof-removal").generatedAt = "2025-01-01T12:00:00Z";
  assert.ok(assess().issues.includes("resolved-provider-account-removals"), "Recollecting an old artifact does not prove current removal");
  byId.get("proof-removal").generatedAt = "2026-07-01T09:00:00Z";
  assert.ok(assess().issues.includes("resolved-provider-account-removals"), "Same-day proof must follow the actual population capture timestamp");
  byId.get("proof-removal").generatedAt = "2026-07-01T12:00:00Z";
  row.accounts[2].resolutionEvidenceIds = [];
  assert.ok(assess().issues.includes("resolved-provider-account-removals"));
});

test("inherited identities and no-account-store sources need bounded proof without fabricated zero populations", () => {
  const { candidate, context, assess } = fixture();
  context.componentIds.push("component-inherited", "component-files");
  candidate.sourceReconciliations.push(
    { componentId: "component-inherited", boundary: "inherited", identityComponentId: "component-provider", rationale: "Uses provider identity", boundaryEvidenceIds: ["proof-boundary"] },
    { componentId: "component-files", boundary: "no-account-store", rationale: "Git-managed register; no independent authentication", boundaryEvidenceIds: ["proof-boundary"] });
  assert.deepEqual(assess().missingSourceIds, []);
  assert.deepEqual(assess().issues, []);
  candidate.sourceReconciliations[1].identityComponentId = "component-inherited";
  assert.deepEqual(assess().missingSourceIds, ["component-inherited"]);
  candidate.sourceReconciliations[1].identityComponentId = "component-provider";
  context.proofValid = () => false;
  assert.deepEqual(assess().missingSourceIds, ["component-inherited", "component-files"]);
});

test("no-account-store boundaries cannot hide current grants or reuse another provider's export", () => {
  const { candidate, context, byId, row, assess } = fixture();
  Object.assign(row, { boundary: "no-account-store", rationale: "No accounts", boundaryEvidenceIds: ["proof-removal"] });
  assert.deepEqual(assess().missingSourceIds, ["component-provider"]);
  row.boundary = "direct";
  byId.get("proof-population").sourceComponentId = "component-other";
  assert.deepEqual(assess().missingSourceIds, ["component-provider"]);
  assert.ok(assess().issues.includes("reconciled-account-counts"));
  context.exports = []; candidate.populationCount = 0;
  assert.deepEqual(assess().missingSourceIds, ["component-provider"]);
});


test("service identity owners must be effective on the assessment date", () => {
  const { byId, assess } = fixture();
  byId.get("person-owner").startDate = "2027-01-01";
  assert.ok(assess().issues.includes("accountable-provider-identities"));
  delete byId.get("person-owner").startDate;
  byId.get("person-owner").endDate = "2026-06-30";
  assert.ok(assess().issues.includes("accountable-provider-identities"));
  delete byId.get("person-owner").endDate;
  byId.set("appointment-owner", { id: "appointment-owner", type: "appointment", status: "active", holderId: "person-owner", startsOn: "2026-01-01", endsOn: "2026-06-30" });
  byId.get("service-worker").ownerIds = ["appointment-owner"];
  assert.ok(assess().issues.includes("accountable-provider-identities"));
  byId.get("appointment-owner").endsOn = "2026-12-31";
  assert.deepEqual(assess().issues, []);
});

test("expired grants with recorded removal remain reviewable without a duplicate grant", () => {
  const { candidate, row, byId, context, assess } = fixture();
  Object.assign(byId.get("grant-owner"), { status: "expired", deprovisionedOn: "2026-07-01" });
  context.grants = [];
  row.accounts[0] = { accountReference: "row-1", disposition: "removed", subjectId: "person-owner", accessGrantIds: ["grant-owner"], rationale: "Expired access removed", resolutionEvidenceIds: ["proof-removal"] };
  candidate.grantDecisions[0].decision = "remove";
  assert.deepEqual(assess().issues, []);
});


test("removal chronology uses exact timestamps and workspace calendar dates", () => {
  const { candidate, row, byId, context, assess } = fixture();
  context.timezone = "America/Chicago"; context.asOf = "2026-07-01";
  candidate.approvedOn = "2026-07-01";
  byId.get("proof-population").generatedAt = "2026-07-02T01:00:00Z";
  byId.get("proof-removal").generatedAt = "2026-07-02T02:00:00Z";
  row.accounts[2] = { accountReference: "row-3", disposition: "removed", rationale: "Current readback shows deactivated status", resolutionEvidenceIds: ["proof-removal"] };
  assert.deepEqual(assess().issues, []);
  byId.get("proof-removal").generatedAt = "2026-07-01T19:00:00-05:00";
  assert.ok(assess().issues.includes("resolved-provider-account-removals"));
});


test("boundary proof cannot claim future observations or collection before its observation", () => {
  const { candidate, context, byId, assess } = fixture();
  context.componentIds.push("component-inherited");
  candidate.sourceReconciliations.push({ componentId: "component-inherited", boundary: "inherited", identityComponentId: "component-provider", rationale: "Provider identity", boundaryEvidenceIds: ["proof-boundary"] });
  byId.get("proof-boundary").generatedAt = "2027-01-01T12:00:00Z";
  assert.deepEqual(assess().missingSourceIds, ["component-inherited"]);
  byId.get("proof-boundary").generatedAt = "2026-07-01T12:00:00Z";
  byId.get("proof-boundary").businessEventAt = "2027-01-01T12:00:00Z";
  assert.deepEqual(assess().missingSourceIds, ["component-inherited"]);
  delete byId.get("proof-boundary").businessEventAt;
  byId.get("proof-boundary").collectedOn = "2026-06-30";
  assert.deepEqual(assess().missingSourceIds, ["component-inherited"]);
  byId.get("proof-boundary").collectedOn = "2026-07-01";
  assert.deepEqual(assess().missingSourceIds, []);
});
