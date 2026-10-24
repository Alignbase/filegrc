import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { makeComprehensiveWorkspace } from "./fixtures.js";
import { loadWorkspace, proposeReportingRouteSet, approveReportingRouteSet, scaffoldNonmaterialAmendment, saveNonmaterialAmendment, amendedResourceView, validateWorkspace, updateResource, createResource, deleteResource, serveWorkspace, createAppState } from "../src/index.js";
import { nonmaterialAmendmentIssues } from "../src/nonmaterial-amendments.js";
import { calculateRevision } from "../src/revisions.js";

const git = (root, ...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const write = (root, collection, record) => writeFile(join(root, "data", collection, `${record.id}.json`), JSON.stringify(record, null, 2) + "\n");
let base;
async function fixture(t) {
  if (!base) {
    base = await mkdtemp(join(tmpdir(), "filegrc-amendment-base-"));
    const { records } = await makeComprehensiveWorkspace(base, "13");
    await writeFile(join(base, "package.json"), JSON.stringify({ private: true, dependencies: { filegrc: "0.19.0" } }));
    await writeFile(join(base, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/filegrc": { version: "0.19.0" } } }));
    for (const record of records.filter((r) => ["policy", "document", "training"].includes(r.type) && r.status === "active")) {
      record.status = "approved";
      for (const field of ["activatedOn", "activatedByIds", "activationBasis", "activatedContentRevisions", "effectiveOn"]) delete record[field];
      const collection = { policy: "policies", document: "documents", training: "training" }[record.type];
      await write(base, collection, record);
    }
    const route = records.find(({ type }) => type === "reporting-route-set");
    route.primaryLane.destination = "security@example.test";
    await write(base, "reporting-route-sets", route);
    const attestation = records.find(({ type }) => type === "attestation");
    attestation.status = "pending";
    for (const field of ["completedOn", "attestationMethod", "contentRevisions"]) delete attestation[field];
    await write(base, "attestations", attestation);
    await write(base, "appointments", { id: "appointment-route-reviewer", type: "appointment", title: "Independent route reviewer", status: "active", appointmentKind: "independent-policy-reviewer", holderId: "person-independent-approver-example", scopeResourceIds: [route.id], startsOn: "2020-01-01", responsibilities: "Independently review channel sets." });
    const proof = { ...records.find(({ type }) => type === "evidence"), id: "evidence-alias-proof", title: "Reporting configuration and decision", artifactKind: "business-record", sourceKind: "file", sourceResourceIds: [route.id], collectedOn: "2026-07-01", verifiedOn: "2026-07-01", coverage: { kind: "as-of", on: "2026-07-01" }, filePaths: ["evidence/evidence-alias-proof/configuration.txt"] };
    await mkdir(join(base, "data/evidence/evidence-alias-proof"), { recursive: true });
    await writeFile(join(base, "data", proof.filePaths[0]), "The security and report aliases deliver to the same monitored group. Same recipients, permissions, dependencies and fallback availability.\n");
    delete proof.sourceComponentId;
    await writeFile(join(base, "data/evidence/evidence-alias-proof/evidence.json"), JSON.stringify(proof, null, 2) + "\n");
    git(base, "init", "--initial-branch=main");
    git(base, "config", "user.name", "Test User"); git(base, "config", "user.email", "test@example.test");
    git(base, "add", "."); git(base, "commit", "-m", "Initial source");
    await proposeReportingRouteSet(base, { routeSetId: route.id });
    git(base, "add", "."); git(base, "commit", "-m", "Propose reporting channels");
    const proposalCommit = git(base, "rev-parse", "HEAD");
    // Configuration proof may predate approval. Use actual current decision time.
    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    proof.collectedOn = today; proof.verifiedOn = today; proof.coverage.on = today;
    await writeFile(join(base, "data/evidence/evidence-alias-proof/evidence.json"), JSON.stringify(proof, null, 2) + "\n");
    await approveReportingRouteSet(base, { routeSetId: route.id, proposalCommit, approvalAppointmentId: "appointment-route-reviewer", approvedAt: now, effectiveAt: now, timezone: "UTC", evidenceIds: [proof.id] });
    git(base, "add", "."); git(base, "commit", "-m", "Approve reporting channels");
  }
  const root = await mkdtemp(join(tmpdir(), "filegrc-amendment-test-"));
  await cp(base, root, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function payload(root, target = "reporting-route-set-example", options = {}) {
  const result = await scaffoldNonmaterialAmendment(root, target, options);
  result.record.replacementValue = options.category === "label-correction" || target !== "reporting-route-set-example" ? "Corrected administrative label" : "report@example.test";
  Object.assign(result.record, { amendedById: "person-example", authorityAppointmentId: "appointment-example", rationale: "Owner checked the retained configuration. The aliases reach the same group with unchanged recipients, access, dependencies and behavior." });
  if (result.record.confirmations) {
    for (const key of Object.keys(result.record.confirmations)) result.record.confirmations[key] = true;
    result.record.evidenceIds = ["evidence-alias-proof"];
  }
  return result;
}

test("alias amendment preserves original approval, requires commit, and records the owner separately", async (t) => {
  const root = await fixture(t);
  const originalPath = join(root, "data/reporting-route-sets/reporting-route-set-example.json");
  const original = await readFile(originalPath, "utf8");
  const p = await payload(root);
  await saveNonmaterialAmendment(root, p, { preview: true });
  assert.equal(git(root, "status", "--porcelain"), "");
  await saveNonmaterialAmendment(root, p);
  let loaded = await loadWorkspace(root);
  let route = loaded.resources.find(({ type }) => type === "reporting-route-set");
  assert.deepEqual(amendedResourceView(loaded, route).amendmentIds, []);
  git(root, "add", "."); git(root, "commit", "-m", "Record equivalent alias correction");
  loaded = await loadWorkspace(root); route = loaded.resources.find(({ type }) => type === "reporting-route-set");
  const view = amendedResourceView(loaded, route);
  assert.equal(view.record.primaryLane.destination, "report@example.test");
  assert.equal(view.originalRecord.primaryLane.destination, "security@example.test");
  assert.equal(view.record.approval.approvedById, "person-independent-approver-example");
  assert.deepEqual(view.amendmentIds, [p.record.id]);
  assert.equal((await amendedResourceView(loaded, route, { at: "2020-01-01T00:00:00Z" })).record.primaryLane.destination, "security@example.test");
  assert.equal(await readFile(originalPath, "utf8"), original);
  const result = await validateWorkspace(root);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const state = await createAppState(root);
  assert.equal(state.resources.find(({ record }) => record.id === route.id).nonmaterialView.record.primaryLane.destination, "report@example.test");
  const next = await payload(root); next.record.replacementValue = "security@example.test";
  assert.equal(next.record.previousAmendmentId, p.record.id);
  await saveNonmaterialAmendment(root, next);
});

test("bounded categories reject material fields, changed access, missing proof, wrong authority and stale writes", async (t) => {
  const root = await fixture(t);
  const p = await payload(root);
  for (const field of ["approval.approvedById", "primaryLane.channelKind", "authorityAppointmentKind", "sourceResourceIds", "__proto__.polluted"]) {
    const bad = structuredClone(p); bad.record.fieldKey = field;
    await assert.rejects(() => saveNonmaterialAmendment(root, bad), /supported nonmaterial category and field/);
  }
  for (const mutate of [
    (r) => { r.confirmations.sameAccess = false; },
    (r) => { r.evidenceIds = []; },
    (r) => { r.amendedById = "person-independent-approver-example"; },
    (r) => { r.amendedAt = "2099-01-01T00:00:00Z"; },
    (r) => { r.previousValue = "someone@example.test"; }
  ]) { const bad = structuredClone(p); mutate(bad.record); await assert.rejects(() => saveNonmaterialAmendment(root, bad)); }
  const malformed = structuredClone(p); delete malformed.record.title;
  await assert.rejects(() => saveNonmaterialAmendment(root, malformed, { preview: true }), /title/);
  const stale = structuredClone(p); stale.expectedTargetRevision = "0".repeat(64);
  await assert.rejects(() => saveNonmaterialAmendment(root, stale), /source record changed/);
  await assert.rejects(() => createResource(root, p.record), /amendment scaffold/);
  assert.equal(git(root, "status", "--porcelain"), "");
});

test("a matching proposed successor can be withdrawn atomically without canceling the approved original", async (t) => {
  const root = await fixture(t);
  const loaded = await loadWorkspace(root);
  const original = loaded.resources.find(({ type }) => type === "reporting-route-set");
  const successor = { ...original, id: "reporting-route-set-alias", title: "Equivalent alias proposal", status: "proposed", predecessorId: original.id, primaryLane: { ...original.primaryLane, destination: "report@example.test" } };
  delete successor.proposalCommit; delete successor.approval;
  await write(root, "reporting-route-sets", successor);
  await writeFile(join(root, "data/reporting-route-sets", `${successor.id}.md`), "# Instructions\n\nUse the same monitored inbox through the equivalent alias.\n");
  git(root, "add", "."); git(root, "commit", "-m", "Propose equivalent alias");
  const p = await payload(root); p.record.withdrawnProposalId = successor.id;
  p.expectedProposalRevision = calculateRevision("content", await readFile(join(root, "data/reporting-route-sets", `${successor.id}.json`), "utf8"));
  await saveNonmaterialAmendment(root, p);
  const after = await loadWorkspace(root);
  assert.equal(after.resources.find(({ id }) => id === successor.id).status, "withdrawn");
  assert.equal(after.resources.find(({ id }) => id === original.id).status, "approved");
  git(root, "add", "."); git(root, "commit", "-m", "Withdraw duplicate proposal with owner amendment");
  assert.equal((await validateWorkspace(root)).ok, true);
});

test("administrative labels preserve content bindings; committed decisions and proof are immutable", async (t) => {
  const root = await fixture(t);
  const p = await payload(root, "policy-example");
  const before = await readFile(join(root, "data/policies/policy-example.json"), "utf8");
  await saveNonmaterialAmendment(root, p);
  git(root, "add", "."); git(root, "commit", "-m", "Correct policy display label");
  assert.equal(await readFile(join(root, "data/policies/policy-example.json"), "utf8"), before);
  await assert.rejects(() => updateResource(root, "nonmaterial-amendment", p.record.id, { ...p.record, rationale: "Changed conclusion" }), /immutable owner decisions/);
  await assert.rejects(() => deleteResource(root, "nonmaterial-amendment", p.record.id), /cannot be deleted/);
  await write(root, "nonmaterial-amendments", { ...p.record, replacementValue: "Forged label" });
  let loaded = await loadWorkspace(root);
  assert.equal(nonmaterialAmendmentIssues(loaded, loaded.resources.find(({ id }) => id === p.record.id)).length > 0, true);
  assert.deepEqual(amendedResourceView(loaded, loaded.resources.find(({ id }) => id === "policy-example")).amendmentIds, []);
  assert.equal((await validateWorkspace(root)).ok, false);
});

test("HTTP and CLI expose the same scaffold and preview", async (t) => {
  const root = await fixture(t);
  const server = await serveWorkspace(root, { port: 0, allowNonAuthoritativeWrites: true });
  t.after(() => new Promise((resolve) => server.server.close(resolve)));
  const endpoint = `http://127.0.0.1:${server.server.address().port}`;
  const post = async (path, data) => fetch(endpoint + path, { method: "POST", headers: { "content-type": "application/json", origin: endpoint }, body: JSON.stringify(data) });
  const scaffold = await post("/api/nonmaterial-amendments/scaffold", { targetResourceId: "reporting-route-set-example" });
  assert.equal(scaffold.status, 200);
  assert.equal((await scaffold.json()).record.fieldKey, "primaryLane.destination");
  const response = await post("/api/nonmaterial-amendments/preview", await payload(root));
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).preview, true);
  const cli = execFileSync(process.execPath, [join(import.meta.dirname, "../bin/filegrc.js"), "amend-nonmaterial", "reporting-route-set-example", "--scaffold", "--root", root], { encoding: "utf8" });
  assert.equal(JSON.parse(cli).record.category, "reporting-email-alias");
});

test("subsequent corrections survive ordinary source updates and a new source label", async (t) => {
  const root = await fixture(t);
  const first = await payload(root, "component-example");
  await saveNonmaterialAmendment(root, first);
  git(root, "add", "."); git(root, "commit", "-m", "Correct component label");
  let loaded = await loadWorkspace(root);
  let component = loaded.resources.find(({ id }) => id === "component-example");
  component.description = "Current provider retrieval instructions were clarified.";
  await write(root, "components", component);
  git(root, "add", "."); git(root, "commit", "-m", "Update component description");
  const second = await payload(root, component.id);
  second.record.replacementValue = "Second administrative label";
  assert.equal(second.record.previousAmendmentId, first.record.id);
  assert.notEqual(second.record.sourceCommit, first.record.sourceCommit);
  await saveNonmaterialAmendment(root, second);
  git(root, "add", "."); git(root, "commit", "-m", "Record another label correction");
  loaded = await loadWorkspace(root);
  assert.equal(amendedResourceView(loaded, component).record.title, "Second administrative label");
  component.title = "New governed component name";
  await write(root, "components", component);
  git(root, "add", "."); git(root, "commit", "-m", "Adopt new component name");
  const third = await payload(root, component.id);
  assert.equal(third.record.previousAmendmentId, undefined);
  assert.equal(third.record.previousValue, component.title);
  await saveNonmaterialAmendment(root, third);
  assert.equal((await validateWorkspace(root)).ok, true);
  git(root, "add", "."); git(root, "commit", "-m", "Correct new component label");
  component.title = first.record.previousValue;
  await write(root, "components", component);
  git(root, "add", "."); git(root, "commit", "-m", "Restore an earlier name as a new decision");
  loaded = await loadWorkspace(root);
  assert.equal(amendedResourceView(loaded, component).record.title, component.title);
  const fresh = await payload(root, component.id);
  assert.equal(fresh.record.previousAmendmentId, undefined);
  await saveNonmaterialAmendment(root, fresh);
});

test("later independent evidence verification preserves the owner decision but altered captures do not", async (t) => {
  const root = await fixture(t);
  const proofPath = join(root, "data/evidence/evidence-alias-proof/evidence.json");
  const proof = JSON.parse(await readFile(proofPath, "utf8"));
  proof.status = "collected";
  delete proof.verifiedOn; delete proof.verifierIds;
  // This proof is separate from the original independently approved evidence.
  proof.id = "evidence-owner-alias-observation";
  proof.collectedOn = "2026-07-01";
  proof.filePaths = ["evidence/evidence-owner-alias-observation/configuration.txt"];
  await mkdir(join(root, "data/evidence", proof.id));
  await writeFile(join(root, "data/evidence", proof.id, "evidence.json"), JSON.stringify(proof, null, 2) + "\n");
  await writeFile(join(root, "data", proof.filePaths[0]), "Both aliases reach the same monitored group.\n");
  git(root, "add", "."); git(root, "commit", "-m", "Retain owner configuration observation");
  const p = await payload(root); p.record.evidenceIds = [proof.id];
  await saveNonmaterialAmendment(root, p);
  git(root, "add", "."); git(root, "commit", "-m", "Record owner alias decision");
  proof.status = "verified"; proof.verifierIds = ["person-independent-approver-example"]; proof.verifiedOn = new Date().toISOString().slice(0, 10);
  await updateResource(root, "evidence", proof.id, proof);
  assert.equal((await validateWorkspace(root)).ok, true);
  let loaded = await loadWorkspace(root);
  assert.equal(amendedResourceView(loaded, loaded.resources.find(({ id }) => id === p.record.targetResourceId)).amendmentIds.length, 1);
  git(root, "add", "."); git(root, "commit", "-m", "Independently verify retained observation");
  await assert.rejects(() => updateResource(root, "evidence", proof.id, { ...proof, verifiedOn: "2026-07-02" }), /Proof record/);
  const downgraded = { ...proof, status: "collected" }; delete downgraded.verifierIds; delete downgraded.verifiedOn;
  await assert.rejects(() => updateResource(root, "evidence", proof.id, downgraded), /Proof record/);
  assert.equal((await validateWorkspace(root)).ok, true);
  const narrativePath = join(root, "data/evidence", proof.id, "evidence.md");
  await writeFile(narrativePath, "# Changed observation\n\nThe recipients are different.\n");
  loaded = await loadWorkspace(root);
  assert.equal(amendedResourceView(loaded, loaded.resources.find(({ id }) => id === p.record.targetResourceId)).amendmentIds.length, 0);
  assert.equal((await validateWorkspace(root)).ok, false);
  await rm(narrativePath);
  await writeFile(join(root, "data", proof.filePaths[0]), "Changed recipients.\n");
  assert.equal((await validateWorkspace(root)).ok, false);
  loaded = await loadWorkspace(root);
  assert.equal(amendedResourceView(loaded, loaded.resources.find(({ id }) => id === p.record.targetResourceId)).amendmentIds.length, 0);
});

test("backward reads do not authorize new records under an old repository pin", async (t) => {
  const root = await fixture(t);
  const p = await payload(root);
  await writeFile(join(root, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/filegrc": { resolved: "../linked-engine", link: true }, "../linked-engine": { version: "0.19.0" } } }));
  await assert.rejects(() => saveNonmaterialAmendment(root, p), /Upgrade and commit/);
  await writeFile(join(root, "package.json"), JSON.stringify({ private: true, dependencies: { filegrc: "0.18.16" } }));
  await writeFile(join(root, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/filegrc": { version: "0.18.16" } } }));
  assert.equal((await validateWorkspace(root)).ok, true);
  await assert.rejects(() => scaffoldNonmaterialAmendment(root, p.record.targetResourceId), /Upgrade and commit/);
  await assert.rejects(() => saveNonmaterialAmendment(root, p), /Upgrade and commit/);
  await mkdir(join(root, "data/nonmaterial-amendments"), { recursive: true });
  await write(root, "nonmaterial-amendments", p.record);
  assert.equal((await validateWorkspace(root)).ok, false);
  git(root, "add", "."); git(root, "commit", "-m", "Invalid legacy-pinned amendment fixture");
  await writeFile(join(root, "package.json"), JSON.stringify({ private: true, dependencies: { filegrc: "0.19.0" } }));
  await writeFile(join(root, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/filegrc": { version: "0.19.0" } } }));
  const validation = await validateWorkspace(root);
  assert.equal(validation.ok, false);
  assert.equal(validation.diagnostics.some(({ message }) => message.includes("no later than its first amendment commit")), true);
});

test("reporting sets without email still offer administrative label corrections", async (t) => {
  const root = await fixture(t);
  const loaded = await loadWorkspace(root);
  const route = structuredClone(loaded.resources.find(({ type }) => type === "reporting-route-set"));
  Object.assign(route, { id: "reporting-route-set-web-phone", title: "Web and telephone reporting", status: "draft", purposeKey: "ethics-reporting", primaryLane: { channelKind: "web", destination: "https://example.test/report" }, alternateLane: { channelKind: "phone", destination: "+1 555 0100" } });
  delete route.approval; delete route.proposalCommit;
  await createResource(root, route, { content: { instructions: "# Reporting instructions\n\nUse the reporting form or the telephone fallback to raise a concern.\n" } });
  git(root, "add", "."); git(root, "commit", "-m", "Define web and telephone reporting");
  const scaffold = await scaffoldNonmaterialAmendment(root, route.id);
  assert.equal(scaffold.record.category, "label-correction");
  assert.equal(scaffold.record.fieldKey, "title");
  await assert.rejects(() => scaffoldNonmaterialAmendment(root, route.id, { category: "reporting-email-alias" }), /normal review/);
});

test.after(async () => { if (base) await rm(base, { recursive: true, force: true }); });


test("0.20 adoption preserves committed 0.19 amendments and permits unchanged amendment workflows", async (t) => {
  const root = await fixture(t);
  const p = await payload(root, "policy-example");
  await saveNonmaterialAmendment(root, p);
  git(root, "add", "."); git(root, "commit", "-m", "Record owner label decision");
  const originalPaths = ["data/policies/policy-example.json", `data/nonmaterial-amendments/${p.record.id}.json`];
  const original = await Promise.all(originalPaths.map(path => readFile(join(root, path), "utf8")));
  await writeFile(join(root, "package.json"), JSON.stringify({ private: true, dependencies: { filegrc: "0.20.0" } }));
  await writeFile(join(root, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: { "": { dependencies: { filegrc: "0.20.0" } }, "node_modules/filegrc": { version: "0.20.0" } } }));
  git(root, "add", "."); git(root, "commit", "-m", "Adopt supported runtime");
  const loaded = await loadWorkspace(root);
  assert.deepEqual(nonmaterialAmendmentIssues(loaded, loaded.resources.find(({ id }) => id === p.record.id)), []);
  assert.deepEqual(await Promise.all(originalPaths.map(path => readFile(join(root, path), "utf8"))), original);
  assert.equal((await validateWorkspace(root)).ok, true);
  const next = await payload(root, "policy-example");
  next.record.replacementValue = "Reviewed administrative label";
  await saveNonmaterialAmendment(root, next);
  git(root, "add", "."); git(root, "commit", "-m", "Record subsequent owner label decision");
  assert.equal((await validateWorkspace(root)).ok, true);
});
