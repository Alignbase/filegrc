import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adoptWorkflowRuntime } from "./fixtures/workflow-runtime.js";
import { makeWorkspace, initializeGitWorkspace, commitWorkspaceFiles, writeJson } from "./helpers.js";
import { loadWorkspace } from "../src/workspace.js";
import { updateResource, createResource, applyResourceBatch, updateContent } from "../src/files.js";
import { validateWorkspace } from "../src/validate.js";
import { scaffoldPeriodImpactReview, currentPeriodImpactRevision, periodImpactReviewCurrent } from "../src/period-impact.js";
import { workflowSourceRuntimeAdopted } from "../src/workflow-source-runtime.js";
import { reviewHistoryContext, reviewHistoricalWorkspace } from "../src/historical-workspace.js";
import { getGitSummary } from "../src/git.js";
import { assessWorkflow } from "../src/workflow.js";
import { markdownEntries } from "../src/resource-markdown.js";

async function fixture(context, version = "0.21.5") {
  const root = await mkdtemp(join(tmpdir(), "filegrc-source-adoption-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeWorkspace(root); await adoptWorkflowRuntime(root, version);
  const workspacePath = join(root, "data/workspace.json"), workspace = JSON.parse(await readFile(workspacePath, "utf8"));
  workspace.dataModelVersion = "13"; delete workspace.classificationDefinitions; await writeJson(workspacePath, workspace);
  const record = { id: "system-example", type: "system", title: "Company service", status: "active", purpose: "Provide the company application.", boundary: "Company-managed service.", servicesProvided: ["Application"], criticality: "low", ownerIds: ["person-owner"] };
  await mkdir(join(root, "data/systems")); const path = join(root, "data/systems/system-example.json"); await writeJson(path, record);
  return { root, record, path };
}

test("new source forms require a consistent declared and locked minimum reader", async context => {
  const { root } = await fixture(context);
  for (const [version, expected] of [["0.21.5", false], ["0.21.6", true], ["0.21.7", true], ["0.20.9", false]]) {
    await adoptWorkflowRuntime(root, version);
    assert.equal(workflowSourceRuntimeAdopted(await loadWorkspace(root)), expected, version);
  }
  await adoptWorkflowRuntime(root);
  const lockPath = join(root, "package-lock.json"), validLock = JSON.parse(await readFile(lockPath, "utf8"));
  for (const [label, mutate] of [
    ["old locked reader", lock => { lock.packages["node_modules/filegrc"].version = "0.21.5"; }],
    ["outside caret range", lock => { lock.packages["node_modules/filegrc"].version = "0.22.0"; }],
    ["mismatched declaration", lock => { lock.packages[""].dependencies.filegrc = "^0.21.5"; }],
    ["unresolved link", lock => { lock.packages["node_modules/filegrc"].link = true; }],
    ["prerelease", lock => { lock.packages["node_modules/filegrc"].version = "0.21.6-beta.1"; }]
  ]) {
    const lock = structuredClone(validLock); mutate(lock); await writeJson(lockPath, lock);
    assert.equal(workflowSourceRuntimeAdopted(await loadWorkspace(root)), false, label);
  }
  for (const [declared, locked, expected] of [["0.21.6", "0.21.7", false], ["~0.21.6", "0.22.0", false], ["~0.21.6", "0.21.7", true], ["^0.21.6", "0.21.7", true]]) {
    await writeJson(join(root, "package.json"), { dependencies: { filegrc: declared } });
    await writeJson(lockPath, { packages: { "": { dependencies: { filegrc: declared } }, "node_modules/filegrc": { version: locked } } });
    assert.equal(workflowSourceRuntimeAdopted(await loadWorkspace(root)), expected, `${declared}/${locked}`);
  }
});

test("ordinary older workspaces remain valid while actions and generic source writes reject unsupported shapes", async context => {
  const { root, record, path } = await fixture(context);
  assert.equal((await validateWorkspace(root)).diagnostics.some(item => item.code === "source-runtime-adoption-required"), false);
  await assert.rejects(scaffoldPeriodImpactReview(root, { resourceId: record.id }), /Adopt FileGRC 0\.21\.6/);
  const loaded = await loadWorkspace(root), before = await readFile(path, "utf8");
  const changed = { ...record, periodImpactReview: { reviewedByIds: ["person-owner"], reviewedOn: "2026-10-28", effectiveOn: "2026-10-28", conclusion: "no-material-change", rationale: "Actual owner review.", reviewedRevision: await currentPeriodImpactRevision(loaded, record), reviewedTransitionKeys: [] } };
  await assert.rejects(updateResource(root, record.type, record.id, changed), /Adopt FileGRC 0\.21\.6/);
  assert.equal(await readFile(path, "utf8"), before);
  await writeJson(path, changed);
  assert.ok((await validateWorkspace(root)).diagnostics.some(item => item.code === "source-runtime-adoption-required" && item.severity === "error"));
});

test("truthful forward reader repair restores current work without rewriting historical format failures", async context => {
  const { root, record, path } = await fixture(context);
  await initializeGitWorkspace(root);
  const originalCommit = getGitSummary(root).commit;
  const loaded = await loadWorkspace(root);
  const changed = { ...record, periodImpactReview: { reviewedByIds: ["person-owner"], reviewedOn: "2026-10-28", effectiveOn: "2026-10-28", conclusion: "no-material-change", rationale: "Actual unchanged owner review facts.", reviewedRevision: await currentPeriodImpactRevision(loaded, record), reviewedTransitionKeys: [] } };
  await writeJson(path, changed); await commitWorkspaceFiles(root, "Record decision before correcting reader dependency");
  const badCommit = getGitSummary(root).commit;
  assert.ok((await validateWorkspace(root)).diagnostics.some(item => item.code === "source-runtime-adoption-required"));
  await adoptWorkflowRuntime(root); await commitWorkspaceFiles(root, "Correct the current reader dependency");
  const current = await loadWorkspace(root), actual = current.resources.find(item => item.id === record.id);
  assert.deepEqual(actual.periodImpactReview, changed.periodImpactReview, "business decision dates and facts do not need rewriting");
  const result = await validateWorkspace(current);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.ok(result.diagnostics.some(item => item.code === "historical-source-runtime-adoption" && item.severity === "warning"));
  assert.equal(await periodImpactReviewCurrent(current, actual), true);
  const historical = reviewHistoricalWorkspace(reviewHistoryContext(root, current), badCommit);
  assert.equal(await periodImpactReviewCurrent(historical, historical.byId.get(record.id)), false);
  assert.ok((await validateWorkspace({ ...historical, diagnostics: [] })).diagnostics.some(item => item.code === "source-runtime-adoption-required"));
  const beforeFeature = reviewHistoricalWorkspace(reviewHistoryContext(root, current), originalCommit);
  assert.equal((await validateWorkspace({ ...beforeFeature, diagnostics: [] })).diagnostics.some(item => item.code === "source-runtime-adoption-required"), false, "future source shapes cannot invalidate an earlier ordinary snapshot");
  const workflow = await assessWorkflow(current, { validation: result, programReadiness: { stages: [], evidenceReady: false }, auditPreparations: {}, obligations: { items: [], triggers: [], counts: {} }, reconciliation: { candidates: [] }, git: {} });
  const contextFinding = workflow.findings.find(item => item.code.includes("historical-source-runtime-adoption"));
  assert.equal(contextFinding.state, "complete"); assert.deepEqual(contextFinding.actions, []);
});

test("an existing manual violation cannot authorize more unsupported generic mutations", async context => {
  const { root, record, path } = await fixture(context);
  let loaded = await loadWorkspace(root);
  const review = { reviewedByIds: ["person-owner"], reviewedOn: "2026-10-28", effectiveOn: "2026-10-28", conclusion: "no-material-change", rationale: "Actual owner review.", reviewedRevision: await currentPeriodImpactRevision(loaded, record), reviewedTransitionKeys: [] };
  await writeJson(path, { ...record, periodImpactReview: review });
  const other = { ...record, id: "system-other", title: "Other service" };
  await createResource(root, other);
  loaded = await loadWorkspace(root);
  const entry = loaded.entries.find(item => item.record.id === other.id), original = await readFile(entry.path, "utf8");
  const next = { ...other, periodImpactReview: { ...review, reviewedRevision: await currentPeriodImpactRevision(loaded, other) } };
  await assert.rejects(updateResource(root, other.type, other.id, next), /Adopt FileGRC 0\.21\.6/);
  await assert.rejects(applyResourceBatch(root, { update: [next] }), /Adopt FileGRC 0\.21\.6/);
  await assert.rejects(createResource(root, { ...next, id: "system-third" }), /Adopt FileGRC 0\.21\.6/);
  const markdown = markdownEntries(loaded.model, record)[0].path;
  await assert.rejects(updateContent(root, markdown, "# New procedure\n"), /Adopt FileGRC 0\.21\.6/);
  assert.equal(await readFile(entry.path, "utf8"), original);
  assert.equal((await loadWorkspace(root)).resources.some(item => item.id === "system-third"), false);
});

test("malformed typed review actors produce diagnostics rather than an uncaught validation failure", async context => {
  const { root, record, path } = await fixture(context, "0.21.6");
  const loaded = await loadWorkspace(root);
  await writeJson(path, { ...record, periodImpactReview: { reviewedByIds: "owner", reviewedOn: "2026-10-28", effectiveOn: "2026-10-28", conclusion: "no-material-change", rationale: "Malformed input.", reviewedRevision: await currentPeriodImpactRevision(loaded, record) } });
  const result = await validateWorkspace(root);
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some(item => item.code === "invalid-period-impact-reviewer"));
});
