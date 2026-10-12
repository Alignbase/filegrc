import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { activateGovernedContent, activateDocuments, activatePolicies, loadWorkspace, scaffoldGovernedContentActivation, scaffoldDocumentActivation, scaffoldPolicyActivation, validateWorkspace } from "../src/index.js";
import { resourceReviewRevisions, resourceReviewRevisionsSync, resourceReviewRevisionMatches } from "../src/retention.js";
import { collectionRevision, collectionRevisionMatches } from "../src/collection-revision.js";
import { runCli } from "../src/cli.js";
import { captureCli, initializeGitWorkspace, writeJson } from "./helpers.js";
import { makeComprehensiveWorkspace } from "./fixtures.js";
import { makeRetentionActivationWorkspace } from "./fixtures/activation-retention.js";

for (const separate of [false, true]) {
  for (const priorBindings of [false, true]) {
    test(`${separate ? "separate" : "atomic"} activation preserves ${priorBindings ? "prior" : "current"} retention source bindings`, async (context) => {
      const root = await mkdtemp(join(tmpdir(), "filegrc-activation-retention-"));
      context.after(() => rm(root, { recursive: true, force: true }));
      const { ids, rowId } = await makeRetentionActivationWorkspace(root, { priorBindings });
      let loaded = await loadWorkspace(root);
      const rowEntry = loaded.entries.find(({ record }) => record.id === rowId);
      const rowSource = await readFile(rowEntry.path, "utf8");
      const approved = new Map(ids.map((id) => [id, loaded.resources.find((record) => record.id === id).approvedContentRevisions]));
      const original = await resourceReviewRevisions(loaded, ids);
      const before = await validateWorkspace(root);
      assert.equal(before.ok, true, JSON.stringify(before.diagnostics));
      const scaffold = await scaffoldGovernedContentActivation(root);
      assert.equal(scaffold.available, true, scaffold.message);
      const payload = { ...scaffold, activatedByIds: ["person-example"], confirmed: true };
      if (separate) {
        const documents = await scaffoldDocumentActivation(root);
        const documentPayloadPath = join(root, "document-activation.json");
        await writeJson(documentPayloadPath, { ...documents, activatedByIds: payload.activatedByIds });
        await captureCli(runCli, ["activate-documents", documentPayloadPath, "--yes", "--json", "--root", root]);
        const training = await scaffoldGovernedContentActivation(root);
        await activateGovernedContent(root, { ...training, policyIds: [], activatedByIds: payload.activatedByIds, confirmed: true });
        const policies = await scaffoldPolicyActivation(root);
        await activatePolicies(root, { ...policies, confirmed: true });
      } else {
        const payloadPath = join(root, "activation.json");
        await writeJson(payloadPath, payload);
        const preview = await captureCli(runCli, ["activate-content", payloadPath, "--preview", "--json", "--root", root]);
        assert.equal(preview.result.changes.update.length, ids.length);
        await captureCli(runCli, ["activate-content", payloadPath, "--yes", "--json", "--root", root]);
      }
      loaded = await loadWorkspace(root);
      assert.deepEqual(await resourceReviewRevisions(loaded, ids), original);
      assert.equal(await readFile(rowEntry.path, "utf8"), rowSource);
      for (const id of ids) {
        const record = loaded.resources.find((record) => record.id === id);
        assert.equal(record.status, "active");
        assert.deepEqual(record.approvedContentRevisions, approved.get(id));
        if (record.type !== "policy") assert.deepEqual(record.activatedContentRevisions, approved.get(id));
      }
      const after = await validateWorkspace(root);
      assert.equal(after.ok, true, JSON.stringify(after.diagnostics));
      const bindings = await captureCli(runCli, ["review-bindings", rowId, "--json", "--root", root]);
      assert.deepEqual(bindings.result.missingResourceIds, []);
      // Substantive metadata and Markdown still invalidate the source binding.
      const documentEntry = loaded.entries.find(({ record }) => record.type === "document" && ids.includes(record.id));
      await writeJson(documentEntry.path, { ...documentEntry.record, componentIds: [] });
      assert.ok((await validateWorkspace(root)).diagnostics.some(({ code }) => code === "stale-retention-review"));
      await writeJson(documentEntry.path, documentEntry.record);
      const markdownPath = documentEntry.path.replace(/\.json$/, ".md");
      await writeFile(markdownPath, `${await readFile(markdownPath, "utf8")}\nRetain backups for two years.\n`);
      const invalid = await validateWorkspace(root);
      assert.ok(invalid.diagnostics.some(({ code }) => code === "stale-retention-review"));
      assert.equal(invalid.ok, false);
    });
  }
}

for (const separate of [false, true]) {
  test(`${separate ? "separate" : "atomic"} activation validation failure rolls back every file without rewriting retention bindings`, async (context) => {
    const root = await mkdtemp(join(tmpdir(), "filegrc-activation-rollback-"));
    context.after(() => rm(root, { recursive: true, force: true }));
    const { ids, rowId } = await makeRetentionActivationWorkspace(root);
    const scaffold = await (separate ? scaffoldDocumentActivation : scaffoldGovernedContentActivation)(root);
    const loaded = await loadWorkspace(root);
    const rowEntry = loaded.entries.find(({ record }) => record.id === rowId);
    await writeJson(rowEntry.path, { ...rowEntry.record, dispositionInstructions: "" });
    const entries = loaded.entries.filter(({ record }) => ids.includes(record.id) || record.id === rowId);
    const before = await Promise.all(entries.map(({ path }) => readFile(path, "utf8")));
    await assert.rejects((separate ? activateDocuments : activateGovernedContent)(root, { ...scaffold, activatedByIds: ["person-example"], confirmed: true }), /invalid|disposition/i);
    assert.deepEqual(await Promise.all(entries.map(({ path }) => readFile(path, "utf8"))), before);
    assert.ok((await loadWorkspace(root)).resources.filter(({ id }) => ids.includes(id)).every(({ status }) => status === "approved"));
  });
}

test("committed source bindings that included adoption dates remain exact over unchanged governed facts", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-activation-source-history-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  let loaded = await loadWorkspace(root);
  const entries = loaded.entries.filter(({ record }) => ["policy", "document", "training"].includes(record.type));
  const ids = entries.map(({ record }) => record.id);
  const stored = resourceReviewRevisionsSync(loaded, ids, "legacy", false, null, null, false);
  const current = await resourceReviewRevisions(loaded, ids);
  for (const id of ids) assert.notEqual(stored.get(id), current.get(id));
  await initializeGitWorkspace(root);
  for (const entry of entries) await writeJson(entry.path, { ...entry.record, effectiveOn: "2026-10-12" });
  loaded = await loadWorkspace(root);
  assert.deepEqual(await resourceReviewRevisions(loaded, ids), current);
  assert.deepEqual(resourceReviewRevisionsSync(loaded, ids), current);
  for (const id of ids) assert.equal(resourceReviewRevisionMatches(loaded, current, id, stored.get(id)), true);
  for (const entry of entries) {
    const markdownPath = entry.path.replace(/\.json$/, ".md");
    const source = await readFile(markdownPath, "utf8");
    await writeFile(markdownPath, `${source}\nSubstantive new requirement.\n`);
    const changed = await loadWorkspace(root);
    assert.equal(resourceReviewRevisionMatches(changed, await resourceReviewRevisions(changed, ids), entry.record.id, stored.get(entry.record.id)), false);
    await writeFile(markdownPath, source);
  }
  await rm(join(root, ".git"), { recursive: true, force: true });
  loaded = await loadWorkspace(root);
  for (const id of ids) assert.equal(resourceReviewRevisionMatches(loaded, await resourceReviewRevisions(loaded, ids), id, stored.get(id)), false);
});


for (const resourceType of ["retention-schedule-item", "complementary-control"]) {
  test(`${resourceType} preserves published collection bindings across governed-content lifecycle changes`, async (context) => {
    const root = await mkdtemp(join(tmpdir(), "filegrc-activation-collection-history-"));
    context.after(() => rm(root, { recursive: true, force: true }));
    await makeComprehensiveWorkspace(root, "11");
    let loaded = await loadWorkspace(root);
    const document = loaded.entries.find(({ record }) => record.type === "document");
    const policy = loaded.entries.find(({ record }) => record.type === "policy");
    const row = loaded.entries.find(({ record }) => record.type === "retention-schedule-item");
    const complementary = loaded.entries.find(({ record }) => record.type === "complementary-control");
    await writeJson(row.path, { ...row.record, sourceResourceIds: [document.record.id, policy.record.id] });
    await writeJson(complementary.path, { ...complementary.record, sourceDocumentIds: [document.record.id] });
    loaded = await loadWorkspace(root);
    const previous = collectionRevision(loaded, resourceType, { legacyGovernedLifecycleMetadata: true });
    const neutral = collectionRevision(loaded, resourceType);
    assert.notEqual(previous, neutral);
    assert.equal(collectionRevisionMatches(loaded, resourceType, previous), true);
    await initializeGitWorkspace(root);
    for (const entry of [document, policy]) await writeJson(entry.path, { ...entry.record, effectiveOn: "2026-10-12" });
    loaded = await loadWorkspace(root);
    assert.equal(collectionRevision(loaded, resourceType), neutral);
    assert.equal(collectionRevisionMatches(loaded, resourceType, previous), true);
    const currentDocument = loaded.entries.find(({ record }) => record.id === document.record.id);
    await writeJson(document.path, { ...currentDocument.record, version: "2.0" });
    assert.equal(collectionRevisionMatches(await loadWorkspace(root), resourceType, previous), false);
    await writeJson(document.path, currentDocument.record);
    const markdownPath = document.path.replace(/\.json$/, ".md");
    await writeFile(markdownPath, `${await readFile(markdownPath, "utf8")}\nChanged governed requirements.\n`);
    assert.equal(collectionRevisionMatches(await loadWorkspace(root), resourceType, previous), false);
  });
}
