import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { makeSourceCoverageRetentionWorkspace, sourceCoverageRetentionDecision } from "./fixtures/retention-applications.js";
import { commitWorkspaceFiles, writeJson } from "./helpers.js";
import { loadWorkspace } from "../src/workspace.js";
import { retentionApplicationIssues, retentionApplicationScopeRevision, saveRetentionApplication } from "../src/retention-applications.js";
import { assessRetentionReadiness, resolveSourceCoverageRetention, retentionReviewResourceIds, resourceReviewRevisionsSync } from "../src/retention.js";
import { sourceCoverageComplete, sourcePreparationFacts } from "../src/source-coverage.js";
import { assessCollectionReview } from "../src/collection-review.js";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "filegrc-source-retention-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await makeSourceCoverageRetentionWorkspace(root);
  return root;
}
const programOf = (loaded) => loaded.resources.find(({ type }) => type === "program");
const coverageOf = (loaded) => loaded.resources.find(({ id }) => id === "source-coverage-selected-proof");

test("selected proof scaffold, preview, save and commit preserve independent approval and share source readiness", async (t) => {
  const root = await fixture(t);
  let loaded = await loadWorkspace(root);
  const review = loaded.entries.find(({ record }) => record.type === "collection-review" && record.resourceType === "retention-schedule-item");
  const approved = await readFile(review.path, "utf8");
  const before = await resolveSourceCoverageRetention(loaded, coverageOf(loaded), programOf(loaded));
  assert.equal(before.rules.length, 0);
  const beforeFacts = await sourcePreparationFacts(loaded, coverageOf(loaded), programOf(loaded), {
    asOf: "2026-10-24", sourceId: coverageOf(loaded).componentId, controlIds: ["control-example"]
  });
  assert.ok(beforeFacts.evidenceIds.includes("evidence-selected-proof-retrieval"));
  assert.deepEqual(beforeFacts.issues.map(({ field }) => field), ["retentionScheduleItemIds"]);
  const payload = await sourceCoverageRetentionDecision(root);
  assert.ok(payload.scopeCandidates.some(({ id }) => id === "source-coverage-selected-proof"));
  const preview = await saveRetentionApplication(root, payload, { preview: true });
  assert.ok(preview.record.reviewedScopeRevisions["source-coverage-selected-proof"]);
  await saveRetentionApplication(root, preview);
  await commitWorkspaceFiles(root, "Apply approved rule to selected proof");
  loaded = await loadWorkspace(root);
  const coverage = coverageOf(loaded), program = programOf(loaded);
  assert.deepEqual(retentionApplicationIssues(loaded, loaded.resources.find(({ type }) => type === "retention-application")), []);
  assert.equal((await resolveSourceCoverageRetention(loaded, coverage, program)).rules.length, 1);
  assert.equal(await readFile(review.path, "utf8"), approved);
  assert.equal(assessCollectionReview(loaded, "retention-schedule-item").complete, true);
  assert.equal(await sourceCoverageComplete(coverage, loaded, program), true);
  const facts = await sourcePreparationFacts(loaded, coverage, program, { asOf: "2026-10-24", sourceId: coverage.componentId, controlIds: ["control-example"] });
  assert.equal(facts.complete, true, JSON.stringify(facts.issues));
  assert.deepEqual(facts.retentionRuleIds, ["retention-schedule-item-example"]);
  assert.ok(!facts.issues.some(({ field }) => field.startsWith("retention")));
  const checks = await assessRetentionReadiness(loaded, program, { scheduleApproved: true });
  assert.equal(checks.find(({ id }) => id === `retention-source-coverage-${coverage.id}`).status, "complete");
});

test("Source Coverage application rejects old pins, cross Program, unlinked rows, categories and authority", async (t) => {
  const root = await fixture(t);
  const payload = await sourceCoverageRetentionDecision(root);
  for (const edit of [
    (record) => record.programId = "program-other",
    (record) => record.informationTypeIds = ["information-type-other"],
    (record) => record.reviewedById = "person-independent-approver-example",
    (record) => record.confirmations.holdsPreserved = false
  ]) {
    const changed = structuredClone(payload); edit(changed.record);
    await assert.rejects(saveRetentionApplication(root, changed, { preview: true }), /Program|Information Types|review|holds/);
  }
  const loaded = await loadWorkspace(root);
  const entry = loaded.entries.find(({ record }) => record.id === "source-coverage-selected-proof");
  const system = loaded.resources.find(({ id }) => id === "system-example");
  await writeJson(join(root, "data/systems/system-outside.json"), { ...system, id: "system-outside", title: "Outside the selected Program" });
  await writeJson(entry.path, { ...entry.record, scopeResourceIds: ["program-example", "system-outside"] });
  await assert.rejects(saveRetentionApplication(root, payload, { preview: true }), /exact application Program/);
  const component = loaded.resources.find(({ id }) => id === "component-example");
  await writeJson(join(root, "data/components/component-outside.json"), { ...component, id: "component-outside", title: "Outside source", systemUses: component.systemUses.map((use) => ({ ...use, systemId: "system-outside" })) });
  await writeJson(entry.path, { ...entry.record, componentId: "component-outside" });
  await assert.rejects(saveRetentionApplication(root, payload, { preview: true }), /exact application Program/);
  await writeJson(entry.path, { ...entry.record, componentId: undefined });
  await assert.rejects(saveRetentionApplication(root, payload, { preview: true }), /source fields supported by the current model/);
  await writeJson(entry.path, { ...entry.record, coverageKind: "external-system", componentId: undefined, systemId: "system-outside" });
  await assert.rejects(saveRetentionApplication(root, payload, { preview: true }), /source fields supported by the current model/);
  await writeJson(entry.path, { ...entry.record, componentId: "system-example" });
  await assert.rejects(saveRetentionApplication(root, payload, { preview: true }), /exact application Program/);
  await writeJson(entry.path, entry.record);
  await rm(join(root, "data/components/component-outside.json"));
  await rm(join(root, "data/systems/system-outside.json"));
  await writeJson(join(root, "data/programs/program-other.json"), { ...programOf(loaded), id: "program-other", title: "Other Program", status: "planned" });
  await writeJson(entry.path, { ...entry.record, scopeResourceIds: ["program-other"] });
  await assert.rejects(saveRetentionApplication(root, payload, { preview: true }), /exact application Program/);
  await rm(join(root, "data/programs/program-other.json"));
  await writeJson(entry.path, { ...entry.record, retentionScheduleItemIds: [] });
  await assert.rejects(saveRetentionApplication(root, payload, { preview: true }), /explicitly link/);
  await writeJson(entry.path, entry.record);
  for (const version of ["0.19.2", "0.19.3"]) {
    await writeJson(join(root, "package.json"), { dependencies: { filegrc: `^${version}` } });
    await writeJson(join(root, "package-lock.json"), { packages: { "": { dependencies: { filegrc: `^${version}` } }, "node_modules/filegrc": { version } } });
    await assert.rejects(saveRetentionApplication(root, payload, { preview: true }), /Upgrade.*0.20.0/);
  }
  await writeJson(join(root, "package.json"), { dependencies: { filegrc: "^0.20.0" } });
  for (const packages of [
    { "": { dependencies: { filegrc: "^0.19.3" } }, "node_modules/filegrc": { version: "0.20.0" } },
    { "": { dependencies: { filegrc: "^0.20.0" } }, "node_modules/filegrc": { version: "0.19.3" } },
    { "": { dependencies: { filegrc: "^0.20.0" } }, "node_modules/filegrc": { version: "0.20.0", link: true } }
  ]) {
    await writeJson(join(root, "package-lock.json"), { packages });
    await assert.rejects(saveRetentionApplication(root, payload, { preview: true }), /Upgrade.*0.20.0/);
  }
});

test("Source Coverage fingerprint binds retention semantics and ignores owners, labels, rehearsal proof and unrelated additions", async (t) => {
  const root = await fixture(t);
  const preview = await saveRetentionApplication(root, await sourceCoverageRetentionDecision(root), { preview: true });
  await saveRetentionApplication(root, preview);
  await commitWorkspaceFiles(root, "Review selected proof preservation");
  let loaded = await loadWorkspace(root);
  const app = loaded.resources.find(({ type }) => type === "retention-application");
  const entry = loaded.entries.find(({ record }) => record.id === "source-coverage-selected-proof");
  const original = entry.record;
  const signature = retentionApplicationScopeRevision(original, loaded);
  await writeJson(entry.path, { ...original, title: "Renamed collection", ownerIds: [], retrieverIds: [], readinessTestEvidenceIds: ["evidence-example"] });
  loaded = await loadWorkspace(root);
  assert.equal(retentionApplicationScopeRevision(coverageOf(loaded), loaded), signature);
  assert.deepEqual(retentionApplicationIssues(loaded, app), []);
  await writeJson(join(root, "data/source-coverage/source-coverage-unrelated.json"), { ...original, id: "source-coverage-unrelated", title: "Unrelated source collection" });
  loaded = await loadWorkspace(root);
  assert.deepEqual(retentionApplicationIssues(loaded, app), []);
  assert.equal(assessCollectionReview(loaded, "retention-schedule-item").complete, true);
  for (const [key, value] of Object.entries({ sourceFamilyId: "governance", coverageKind: "filegrc", componentId: null, scopeResourceIds: ["system-example"], excludedPopulation: "Different excluded records", collectionCadence: "Annually", reconciliationMethod: "Different report", retrievalMethodKey: "different-method", validFrom: "2026-02-01", validThrough: "2026-10-24", retentionScheduleItemIds: [], retentionNotes: "Permanent duty" })) {
    await writeJson(entry.path, { ...original, [key]: value });
    loaded = await loadWorkspace(root);
    assert.notEqual(retentionApplicationScopeRevision(coverageOf(loaded), loaded), signature, key);
    assert.ok(retentionApplicationIssues(loaded, app).length, key);
    assert.equal((await resolveSourceCoverageRetention(loaded, coverageOf(loaded), programOf(loaded))).rules.length, 0, key);
  }
  await writeJson(entry.path, original);
  const component = loaded.entries.find(({ record }) => record.id === "component-example");
  await writeJson(component.path, { ...component.record, description: "Different retained-data purpose" });
  assert.ok(retentionApplicationIssues(await loadWorkspace(root), app).length);
  await writeJson(component.path, component.record);
  for (const type of ["classification", "vendor"]) {
    const source = loaded.entries.find(({ record }) => record.type === type);
    await writeJson(source.path, { ...source.record, description: "Changed preservation constraints" });
    assert.ok(retentionApplicationIssues(await loadWorkspace(root), app).length, type);
    await writeJson(source.path, source.record);
  }
  await writeFile(entry.path.replace(/\.json$/, ".md"), "# Collection constraints\n\nPreserve permanently during litigation.\n");
  assert.ok(retentionApplicationIssues(await loadWorkspace(root), app).length);
});

test("legacy service fingerprints retain their published byte-for-byte values", () => {
  const hashes = {
    system: "344b0298dcf0b3c298b0c3efefb19e134256779a98dbe5174f8375dd9f981f02",
    component: "e53ef281576ac0d47f6165f5f33dbce87f88c11c3259a6c0942dca83becd0711",
    vendor: "066f776486e8f8cfb35923cbf77df553811dcc7d0a901228c091eab5bfb72cce"
  };
  for (const [type, hash] of Object.entries(hashes)) assert.equal(retentionApplicationScopeRevision({ id: "example", type, status: "active", description: "Business records", informationTypeIds: ["type-b", "type-a"] }), hash);
});

test("Source Coverage applications cannot adopt 0.20 after their first commit", async (t) => {
  const root = await fixture(t);
  const preview = await saveRetentionApplication(root, await sourceCoverageRetentionDecision(root), { preview: true });
  await saveRetentionApplication(root, preview);
  await writeJson(join(root, "package.json"), { dependencies: { filegrc: "^0.19.3" } });
  await writeJson(join(root, "package-lock.json"), { packages: { "": { dependencies: { filegrc: "^0.19.3" } }, "node_modules/filegrc": { version: "0.19.3" } } });
  await commitWorkspaceFiles(root, "Record preservation decision before compatible adoption");
  await writeJson(join(root, "package.json"), { dependencies: { filegrc: "^0.20.0" } });
  await writeJson(join(root, "package-lock.json"), { packages: { "": { dependencies: { filegrc: "^0.20.0" } }, "node_modules/filegrc": { version: "0.20.0" } } });
  const loaded = await loadWorkspace(root);
  assert.ok(retentionApplicationIssues(loaded, loaded.resources.find(({ type }) => type === "retention-application")).some(({ message }) => /first retention application commit/.test(message)));
});

test("a directly scoped retention rule remains a valid Source Coverage path", async (t) => {
  const root = await fixture(t);
  let loaded = await loadWorkspace(root);
  const entry = loaded.entries.find(({ record }) => record.type === "retention-schedule-item");
  const rule = { ...entry.record, scopeResourceIds: [...entry.record.scopeResourceIds, "source-coverage-selected-proof"] };
  rule.reviewedSourceRevisions = Object.fromEntries(resourceReviewRevisionsSync(loaded, retentionReviewResourceIds(rule, loaded), "legacy", false, null, rule));
  await writeJson(entry.path, rule);
  loaded = await loadWorkspace(root);
  const resolved = await resolveSourceCoverageRetention(loaded, coverageOf(loaded), programOf(loaded));
  assert.deepEqual(resolved.rules.map(({ id }) => id), [rule.id]);
  assert.equal(loaded.resources.some(({ type }) => type === "retention-application"), false);
});
