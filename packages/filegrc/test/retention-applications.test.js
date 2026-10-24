import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { makeRetentionApplicationWorkspace } from "./fixtures/retention-applications.js";
import { commitWorkspaceFiles, writeJson, captureCli } from "./helpers.js";
import { scaffoldRetentionApplication, saveRetentionApplication, retentionApplicationIssues, retentionApplicationScopeRevision } from "../src/retention-applications.js";
import { assessCollectionReview } from "../src/collection-review.js";
import { assessRetentionReadiness, resourceReviewRevisionsSync, retentionReviewResourceIds } from "../src/retention.js";
import { loadWorkspace } from "../src/workspace.js";
import { validateWorkspace } from "../src/validate.js";
import { createResource, updateResource } from "../src/files.js";
import { setGitSubprocessObserverForTests } from "../src/git.js";
import { runCli } from "../src/cli.js";

async function fixture(context) {
  const root = await mkdtemp(join(tmpdir(), "filegrc-retention-application-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeRetentionApplicationWorkspace(root);
  let loaded = await loadWorkspace(root);
  const vendor = loaded.resources.find(({ id }) => id === "vendor-example");
  await writeJson(join(root, "data/vendors/vendor-additional.json"), { ...vendor, id: "vendor-additional", title: "Additional working-record service", informationTypeIds: ["information-type-example"] });
  await commitWorkspaceFiles(root, "Catalog additional service");
  return root;
}
async function decision(root) {
  const payload = await scaffoldRetentionApplication(root, "retention-schedule-item-example");
  Object.assign(payload.record, { scopeResourceIds: ["vendor-additional"], informationTypeIds: ["information-type-example"], reviewedById: "person-example", authorityAppointmentId: "appointment-example", purpose: "Working business records. Required authoritative history remains in its approved source system.", rationale: "Same data category, purpose, cutoff, period and holds, with no conflicting duty.", disposalImplementation: "Owner deletes expired working records through the service and checks holds before deletion." });
  Object.keys(payload.record.confirmations).forEach((key) => payload.record.confirmations[key] = true);
  payload.record.reviewedScopeRevisions = Object.fromEntries(payload.scopeCandidates.map(({ id, revision }) => [id, revision]));
  return payload;
}

test("owner applies an exact approved rule through CLI without changing independent approval", async (context) => {
  const root = await fixture(context);
  const before = await loadWorkspace(root);
  const reviewEntry = before.entries.find(({ record }) => record.type === "collection-review" && record.resourceType === "retention-schedule-item");
  const approved = await readFile(reviewEntry.path, "utf8");
  assert.equal(assessCollectionReview(before, "retention-schedule-item").complete, false);
  const payload = await decision(root);
  const payloadPath = join(root, "application.json");
  await writeJson(payloadPath, payload);
  const preview = await captureCli(runCli, ["apply-retention-rule", payload.record.ruleId, payloadPath, "--preview", "--json", "--root", root]);
  assert.equal(preview.result.preservesIndependentApproval, true);
  assert.ok(preview.result.workflowDelta.findings.removed.length > 0, "preview projects resolved applicability work without changing source records");
  assert.ok(preview.result.record.reviewedScopeRevisions["vendor-additional"]);
  await captureCli(runCli, ["apply-retention-rule", payload.record.ruleId, payloadPath, "--yes", "--json", "--root", root]);
  const after = await loadWorkspace(root);
  assert.equal(assessCollectionReview(after, "retention-schedule-item").complete, true);
  assert.equal(await readFile(reviewEntry.path, "utf8"), approved);
  const checks = await assessRetentionReadiness(after, after.resources.find(({ type }) => type === "program"), { scheduleApproved: true });
  assert.equal(checks.find(({ id }) => id.startsWith("retention-application-")).status, "complete");
  assert.equal(checks.find(({ id }) => id.startsWith("retention-use-")).status, "complete");
  assert.equal((await validateWorkspace(root)).ok, true, JSON.stringify((await validateWorkspace(root)).diagnostics));
});

test("same duration cannot bypass changed cutoff, categories, purpose confirmations or authority", async (context) => {
  const root = await fixture(context);
  const original = await decision(root);
  for (const edit of [
    (record) => record.confirmations.purposeMatches = false,
    (record) => record.confirmations.dispositionFeasible = false,
    (record) => record.confirmations.noConflictingDuties = false,
    (record) => record.reviewedById = "person-independent-approver-example",
    (record) => record.informationTypeIds = ["information-type-unapproved"],
    (record) => record.approvalCommit = "a".repeat(40),
    (record) => record.ruleRevision = "same-duration-does-not-prove-same-rule"
  ]) {
    const payload = structuredClone(original); edit(payload.record);
    await assert.rejects(saveRetentionApplication(root, payload, { preview: true }), /approval|approved|review|authority|purpose|Information Types|actual/i);
  }
  let loaded = await loadWorkspace(root);
  const rule = loaded.entries.find(({ record }) => record.id === original.record.ruleId);
  await writeJson(rule.path, { ...rule.record, cutoff: { basis: "event", event: "Service retirement" } });
  await assert.rejects(saveRetentionApplication(root, original, { preview: true }), /rule|governing source|approval/i);
  assert.equal(assessCollectionReview(await loadWorkspace(root), "retention-schedule-item").complete, false);
});

test("service-data changes stale applications; unrelated vendor metadata does not", async (context) => {
  const root = await fixture(context);
  await saveRetentionApplication(root, await decision(root));
  await commitWorkspaceFiles(root, "Apply existing rule to service");
  let loaded = await loadWorkspace(root);
  const entry = loaded.entries.find(({ record }) => record.id === "vendor-additional");
  await writeJson(entry.path, { ...entry.record, title: "Renamed supplier", website: "https://example.test" });
  loaded = await loadWorkspace(root);
  let application = loaded.resources.find(({ type }) => type === "retention-application");
  assert.deepEqual(retentionApplicationIssues(loaded, application), []);
  await writeJson(entry.path, { ...entry.record, informationTypeIds: [] });
  loaded = await loadWorkspace(root);
  assert.ok(retentionApplicationIssues(loaded, application).some(({ message }) => /changed after the owner review/.test(message)));
  const checks = await assessRetentionReadiness(loaded, loaded.resources.find(({ type }) => type === "program"));
  assert.equal(checks.find(({ id }) => id.startsWith("retention-application-")).status, "action");
  assert.equal((await validateWorkspace(root)).ok, true, JSON.stringify((await validateWorkspace(root)).diagnostics));
  const applicationEntry = loaded.entries.find(({ record }) => record.type === "retention-application");
  await assert.rejects(updateResource(root, application.type, application.id, { ...application, rationale: "Rewritten" }, { expectedRevision: applicationEntry.revision }), /Preserve|immutable/i);
  await writeJson(applicationEntry.path, { ...application, rationale: "Hand-edited historical decision" });
  assert.ok((await validateWorkspace(root)).diagnostics.some(({ code }) => code === "invalid-retention-application"));
});


test("previous program-wide service uses need a fresh owner decision after material service changes", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-retention-existing-use-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeRetentionApplicationWorkspace(root, { programWide: true });
  let loaded = await loadWorkspace(root);
  assert.equal(assessCollectionReview(loaded, "retention-schedule-item").complete, true);
  assert.equal((await validateWorkspace(root)).ok, true, "unchanged legacy inventory bindings remain valid after adoption");
  const vendor = loaded.entries.find(({ record }) => record.id === "vendor-example");
  await writeJson(vendor.path, { ...vendor.record, description: "An authoritative statutory archive requiring permanent preservation." });
  loaded = await loadWorkspace(root);
  assert.equal(assessCollectionReview(loaded, "retention-schedule-item").complete, false);
  const checks = await assessRetentionReadiness(loaded, loaded.resources.find(({ type }) => type === "program"), { scheduleApproved: false });
  const use = checks.find(({ id }) => id.startsWith("retention-use-"));
  assert.equal(use.status, "action");
  assert.ok(use.affectedResourceIds.includes(vendor.record.id));
});

test("refreshing owner bindings cannot reuse independent approval after governing category changes", async (context) => {
  const root = await fixture(context);
  let loaded = await loadWorkspace(root);
  const information = loaded.entries.find(({ record }) => record.type === "information-type");
  await writeJson(information.path, { ...information.record, description: "Statutory records requiring permanent preservation." });
  loaded = await loadWorkspace(root);
  const rule = loaded.entries.find(({ record }) => record.type === "retention-schedule-item");
  await writeJson(rule.path, { ...rule.record, reviewedSourceRevisions: Object.fromEntries(resourceReviewRevisionsSync(loaded, retentionReviewResourceIds(rule.record, loaded))) });
  await commitWorkspaceFiles(root, "Change category and review owner bindings");
  await assert.rejects(scaffoldRetentionApplication(root, rule.record.id), /Material rule changes need independent review/);
  assert.equal(assessCollectionReview(await loadWorkspace(root), "retention-schedule-item").complete, false);
});

test("adopting new application records requires a compatible consumer pin even through generic CRUD", async (context) => {
  const root = await fixture(context);
  const payload = await decision(root);
  const preview = await saveRetentionApplication(root, payload, { preview: true });
  await writeJson(join(root, "package.json"), { private: true, dependencies: { filegrc: "^0.19.1" } });
  await writeJson(join(root, "package-lock.json"), { lockfileVersion: 3, packages: { "": { dependencies: { filegrc: "^0.19.1" } }, "node_modules/filegrc": { version: "0.19.1" } } });
  await assert.rejects(saveRetentionApplication(root, payload), /Upgrade.*0\.19\.2/);
  await assert.rejects(createResource(root, preview.record), /Upgrade.*0\.19\.2/);
  assert.equal((await loadWorkspace(root)).resources.some(({ type }) => type === "retention-application"), false);
});

test("save never silently rebinds a service changed after preview", async (context) => {
  const root = await fixture(context);
  const preview = await saveRetentionApplication(root, await decision(root), { preview: true });
  const loaded = await loadWorkspace(root);
  const vendor = loaded.entries.find(({ record }) => record.id === "vendor-additional");
  await writeJson(vendor.path, { ...vendor.record, description: "Different record purpose under review." });
  await assert.rejects(saveRetentionApplication(root, preview), /changed since the applicability preview/);
});

test("substantive rule notes and Markdown remain bound to independent approval", async (context) => {
  const root = await fixture(context);
  let loaded = await loadWorkspace(root);
  const rule = loaded.entries.find(({ record }) => record.type === "retention-schedule-item");
  await writeJson(rule.path, { ...rule.record, notes: "Retain indefinitely during litigation; legal clearance is required for disposal." });
  assert.equal(assessCollectionReview(await loadWorkspace(root), "retention-schedule-item").complete, false);
  await assert.rejects(scaffoldRetentionApplication(root, rule.record.id), /Material rule changes/);
  await writeJson(rule.path, rule.record);
  await writeFile(rule.path.replace(/\.json$/, ".md"), "# Retention conditions\n\nRetain indefinitely pending legal clearance.\n");
  assert.equal(assessCollectionReview(await loadWorkspace(root), "retention-schedule-item").complete, false);
  await assert.rejects(scaffoldRetentionApplication(root, rule.record.id), /Material rule changes/);
});

test("changing a component provider or provider agreement invalidates disposal-fit review", async (context) => {
  const root = await fixture(context);
  let loaded = await loadWorkspace(root);
  const component = loaded.resources.find(({ id }) => id === "component-example");
  const vendor = loaded.resources.find(({ id }) => id === "vendor-example");
  await writeJson(join(root, "data/components/component-additional.json"), { ...component, id: "component-additional", vendorId: vendor.id });
  await writeJson(join(root, "data/vendors/vendor-replacement.json"), { ...vendor, id: "vendor-replacement", description: "Provider with different preservation duties." });
  await commitWorkspaceFiles(root, "Catalog service provider scope");
  const payload = await decision(root);
  payload.record.scopeResourceIds = ["component-additional"];
  payload.record.reviewedScopeRevisions = {};
  const preview = await saveRetentionApplication(root, payload, { preview: true });
  await saveRetentionApplication(root, preview);
  await commitWorkspaceFiles(root, "Review component rule applicability");
  loaded = await loadWorkspace(root);
  const app = loaded.resources.find(({ type }) => type === "retention-application");
  const entry = loaded.entries.find(({ record }) => record.id === "component-additional");
  await writeJson(entry.path, { ...entry.record, vendorId: "vendor-replacement" });
  assert.ok(retentionApplicationIssues(await loadWorkspace(root), app).some(({ message }) => /changed after the owner review/.test(message)));
  await writeJson(entry.path, entry.record);
  const provider = loaded.entries.find(({ record }) => record.id === vendor.id);
  await writeJson(provider.path, { ...provider.record, description: "Provider now requires ten-year preservation." });
  assert.ok(retentionApplicationIssues(await loadWorkspace(root), app).some(({ message }) => /changed after the owner review/.test(message)));
  await writeJson(provider.path, provider.record);
  await writeFile(provider.path.replace(/\.json$/, ".md"), "# Contract duties\n\nPreserve the authoritative statutory archive permanently.\n");
  assert.ok(retentionApplicationIssues(await loadWorkspace(root), app).some(({ message }) => /changed after the owner review/.test(message)));
});

test("service Markdown duties invalidate owner applicability", async (context) => {
  const root = await fixture(context);
  const preview = await saveRetentionApplication(root, await decision(root), { preview: true });
  await saveRetentionApplication(root, preview);
  await commitWorkspaceFiles(root, "Apply approved rule");
  let loaded = await loadWorkspace(root);
  const app = loaded.resources.find(({ type }) => type === "retention-application");
  const vendor = loaded.entries.find(({ record }) => record.id === "vendor-additional");
  await writeFile(vendor.path.replace(/\.json$/, ".md"), "# Preservation duties\n\nThe authoritative statutory archive must be retained permanently.\n");
  assert.ok(retentionApplicationIssues(await loadWorkspace(root), app).some(({ message }) => /changed after the owner review/.test(message)));
});

test("retiring an application records dated owner work and cannot rewrite or revive it", async (context) => {
  const root = await fixture(context);
  await saveRetentionApplication(root, await decision(root));
  await commitWorkspaceFiles(root, "Apply approved rule");
  let loaded = await loadWorkspace(root);
  let entry = loaded.entries.find(({ record }) => record.type === "retention-application");
  const vendor = loaded.entries.find(({ record }) => record.id === "vendor-additional");
  await writeJson(vendor.path, { ...vendor.record, informationTypeIds: [] });
  const retired = { ...entry.record, status: "retired", statusTransition: { changedByIds: ["person-example"], changedOn: entry.record.reviewedOn, reason: "The service no longer processes the covered working records." } };
  await updateResource(root, retired.type, retired.id, retired);
  await commitWorkspaceFiles(root, "Retire obsolete applicability decision");
  loaded = await loadWorkspace(root);
  assert.deepEqual(retentionApplicationIssues(loaded, loaded.resources.find(({ id }) => id === retired.id)), []);
  await assert.rejects(updateResource(root, retired.type, retired.id, entry.record), /Preserve/);
  await writeJson(entry.path, entry.record);
  assert.ok((await validateWorkspace(root)).diagnostics.some(({ message }) => /cannot be reactivated/.test(message)));
});


test("new service cataloging stays writable while its owner applicability remains due", async (context) => {
  const root = await fixture(context);
  const loaded = await loadWorkspace(root);
  const vendor = loaded.resources.find(({ id }) => id === "vendor-example");
  await createResource(root, { ...vendor, id: "vendor-needs-application", title: "Service awaiting applicability", informationTypeIds: ["information-type-example"] });
  const result = await validateWorkspace(root);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.ok(result.diagnostics.some(({ code, severity }) => code === "uncovered-retention-information-use" && severity === "warning"));
  assert.equal(assessCollectionReview(await loadWorkspace(root), "retention-schedule-item").complete, false);
});


test("changed System boundary exclusions require a fresh owner applicability decision", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-retention-boundary-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeRetentionApplicationWorkspace(root, { programWide: true });
  let loaded = await loadWorkspace(root);
  const system = loaded.entries.find(({ record }) => record.id === "system-example");
  await writeJson(system.path, { ...system.record, exclusions: "The permanent statutory archive is now inside this service boundary." });
  loaded = await loadWorkspace(root);
  assert.equal(assessCollectionReview(loaded, "retention-schedule-item").complete, false);
  const checks = await assessRetentionReadiness(loaded, loaded.resources.find(({ type }) => type === "program"));
  assert.ok(checks.find(({ id }) => id.startsWith("retention-use-")).affectedResourceIds.includes(system.record.id));
});

test("validation reuses one bounded calculation snapshot for many owner mappings", async (context) => {
  const root = await fixture(context);
  const preview = await saveRetentionApplication(root, await decision(root), { preview: true });
  await mkdir(join(root, "data/retention-applications"), { recursive: true });
  for (let index = 0; index < 12; index++) await writeJson(join(root, "data/retention-applications", `${preview.record.id}-${index}.json`), { ...preview.record, id: `${preview.record.id}-${index}`, title: `Reviewed service application ${index + 1}` });
  const calls = [];
  const restoreObserver = setGitSubprocessObserverForTests(({ args }) => calls.push(args.join(" ")));
  let result;
  try { result = await validateWorkspace(root); } finally { restoreObserver(); }
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  // Every use shares the original approval calculation. Runtime/approval checks
  // must not spawn a fresh history traversal for every application/use pair.
  const manyCalls = calls.length;
  for (let index = 1; index < 12; index++) await rm(join(root, "data/retention-applications", `${preview.record.id}-${index}.json`));
  const oneCalls = [];
  const restoreOneObserver = setGitSubprocessObserverForTests(({ args }) => oneCalls.push(args.join(" ")));
  try { assert.equal((await validateWorkspace(root)).ok, true); } finally { restoreOneObserver(); }
  assert.ok(manyCalls <= oneCalls.length * 4 + 30, `12 applications used ${manyCalls} Git calls vs ${oneCalls.length} for one application`);
  await commitWorkspaceFiles(root, "Record the reviewed service applicability");
  const loaded = await loadWorkspace(root);
  const entry = loaded.entries.find(({ record }) => record.id === "vendor-additional");
  await writeJson(entry.path, { ...entry.record, description: "New purpose requires another applicability decision." });
  const next = await validateWorkspace(root);
  assert.equal(next.ok, true, JSON.stringify(next.diagnostics));
  assert.ok(next.diagnostics.some(({ code }) => code === "uncovered-retention-information-use"), "a new validation sees changed facts rather than a prior invocation's cache");
});


test("malformed applicability scope produces diagnostics instead of aborting validation", async (context) => {
  const root = await fixture(context);
  const preview = await saveRetentionApplication(root, await decision(root), { preview: true });
  const loaded = await loadWorkspace(root);
  assert.doesNotThrow(() => retentionApplicationIssues(loaded, { ...preview.record, scopeResourceIds: ["vendor-missing"], reviewedScopeRevisions: { "vendor-missing": "unknown" } }));
  await assert.rejects(saveRetentionApplication(root, { record: { type: "retention-application", scopeResourceIds: "not-an-array" } }), { code: "FILEGRC_RETENTION_APPLICATION" });
});


test("malformed retirement actors produce diagnostics instead of aborting validation", async (context) => {
  const root = await fixture(context);
  const preview = await saveRetentionApplication(root, await decision(root), { preview: true });
  await saveRetentionApplication(root, preview);
  await commitWorkspaceFiles(root, "Apply approved rule");
  const loaded = await loadWorkspace(root);
  const entry = loaded.entries.find(({ record }) => record.type === "retention-application");
  await writeJson(entry.path, { ...entry.record, status: "retired", statusTransition: { changedByIds: "person-example", changedOn: entry.record.reviewedOn, reason: "Service retired." } });
  const result = await validateWorkspace(root);
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some(({ message }) => /Retirement needs/.test(message)));
});


test("generic creation and direct-file validation reject uncaptured applicability bindings", async (context) => {
  const root = await fixture(context);
  const preview = await saveRetentionApplication(root, await decision(root), { preview: true });
  const forged = { ...preview.record, reviewedScopeRevisions: Object.fromEntries(preview.record.scopeResourceIds.map((id) => [id, "forged"])) };
  await assert.rejects(createResource(root, forged), /changed after the owner review/);
  await writeJson(join(root, "data/retention-applications", forged.id + ".json"), forged);
  const result = await validateWorkspace(root);
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some(({ message }) => /changed after the owner review/.test(message)));
});
