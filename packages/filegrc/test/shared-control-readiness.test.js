import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { makeComprehensiveWorkspace } from "./fixtures.js";
import { writeJson, executeCli } from "./helpers.js";
import { loadWorkspace } from "../src/workspace.js";
import { applicabilityScopeRevision } from "../src/applicability-scope.js";
import { assessProgramReadiness } from "../src/program-readiness.js";
import { assessCollectionReviews } from "../src/collection-review.js";
import { assessWorkflow, workflowForResource } from "../src/workflow.js";
import { createAppStateSection } from "../src/state.js";
import { runCli } from "../src/cli.js";
import { fileURLToPath } from "node:url";

async function fixture(context, count = 28) {
  const root = await mkdtemp(join(tmpdir(), "filegrc-shared-controls-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "12");
  const initial = await loadWorkspace(root);
  const programEntry = initial.entries.find(({ record }) => record.type === "program");
  const entry = initial.entries.find(({ record }) => record.type === "control");
  const markdown = await readFile(entry.path.replace(/\.json$/, ".md"), "utf8");
  const controls = Array.from({ length: count }, (_, index) => ({
    ...structuredClone(entry.record),
    id: index ? `control-shared-${index}` : entry.record.id,
    title: `Shared prerequisite Control ${index + 1}`,
    procedureRevision: "a".repeat(40), procedureEffectiveOn: "2026-01-01"
  }));
  programEntry.record.controlIds = controls.map(({ id }) => id);
  for (const control of controls) {
    control.applicabilityReview = { decision: "applicable", rationale: "Selected service requirement.", reviewedByIds: ["person-independent-approver-example"], reviewedOn: "2026-01-01", scopeRevision: applicabilityScopeRevision(control, programEntry.record, initial.resources, initial.model) };
    await writeJson(join(root, "data", "controls", `${control.id}.json`), control);
    await writeFile(join(root, "data", "controls", `${control.id}.md`), markdown);
  }
  await writeJson(programEntry.path, programEntry.record);
  return { root, loaded: await loadWorkspace(root), controls };
}
const controlItems = (readiness) => readiness.stages.find(({ id }) => id === "controls").items.filter(({ id }) => id.startsWith("control-"));
const scheduleItem = (readiness) => readiness.stages.find(({ id }) => id === "controls").items.find(({ id }) => id === "collection-review-obligation");
async function focusedWorkflow(loaded, readiness) {
  const controls = controlItems(readiness);
  const groups = readiness.stages.find(({ id }) => id === "controls").items.filter(({ dependentResources }) => dependentResources?.length);
  return assessWorkflow(loaded, { programId: readiness.program.id, programReadiness: { ...readiness, stages: [{ id: "controls", items: [...groups, ...controls] }], firstAction: groups.find(({ status }) => status === "action") }, validation: { ok: true, diagnostics: [] }, auditPreparations: {} });
}

test("28 shared-only Control blockers produce one approval action and keep every gate", async (context) => {
  const { loaded } = await fixture(context);
  const readiness = await assessProgramReadiness(loaded);
  const group = scheduleItem(readiness);
  assert.equal(group.title, "Approve the Program schedule set");
  assert.equal(group.dependentResources.length, 28);
  assert.ok(group.commands.every((command) => command.includes("--program program-example")));
  for (const item of controlItems(readiness)) {
    assert.equal(item.checks.scheduleSetReviewed, false);
    assert.equal(item.launchChecks.scheduleSetReviewed, false);
    assert.equal(item.status, "blocked");
    assert.equal(item.implementationState, "implemented-awaiting-prerequisites");
    assert.equal(item.progressUnits[0].status, "complete");
  }
  assert.equal(readiness.canStartCandidatePeriod, false);
  const workflow = await focusedWorkflow(loaded, readiness);
  const findings = workflow.findings.filter(({ dependentResources, subject }) => dependentResources?.some(({ type }) => type === "control") || subject?.type === "control");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].state, "ready");
  assert.equal(workflow.recommended.key, findings[0].key);
  assert.equal(workflowForResource(workflow, "control", controlItems(readiness)[0].resourceId).related.findings[0].key, findings[0].key);
});

test("individual gaps stay separate from their shared schedule prerequisite", async (context) => {
  const { loaded } = await fixture(context, 3);
  const records = loaded.resources.filter(({ type }) => type === "control");
  records[0].procedureRevision = null;
  records[1].ownerIds = [];
  const readiness = await assessProgramReadiness(loaded);
  assert.deepEqual(controlItems(readiness).map(({ status }) => status), ["action", "action", "blocked"]);
  const workflow = await focusedWorkflow(loaded, readiness);
  const own = workflow.findings.filter(({ subject }) => subject?.type === "control");
  assert.equal(own.length, 2, own.map(({ key }) => key).join(", "));
  assert.ok(own.every(({ dependencies }) => dependencies.some(({ id }) => id === "collection-review-obligation")));
  assert.equal(workflow.findings.filter(({ dependentResources }) => dependentResources?.length).length, 1);
});

test("schedule groups are Program-scoped and approval clears only that Program's dependencies", async (context) => {
  const { loaded } = await fixture(context, 2);
  const first = loaded.resources.find(({ type }) => type === "program");
  const second = { ...structuredClone(first), id: "program-second", controlIds: [first.controlIds[1]] };
  first.controlIds = [first.controlIds[0]];
  loaded.resources.push(second);
  const secondControl = loaded.resources.find(({ id }) => id === second.controlIds[0]);
  secondControl.applicabilityReview.scopeRevision = applicabilityScopeRevision(secondControl, second, loaded.resources, loaded.model);
  const approvedReviews = assessCollectionReviews(loaded, { programId: first.id }).map((review) => review.resourceType === "obligation" ? { ...review, complete: true, status: "current" } : review);
  const one = await assessProgramReadiness(loaded, { programId: first.id, collectionReviews: approvedReviews });
  const two = await assessProgramReadiness(loaded, { programId: second.id });
  assert.equal(controlItems(one)[0].status, "complete");
  assert.equal(controlItems(one)[0].checks.scheduleSetReviewed, true);
  assert.deepEqual(controlItems(one)[0].sharedPrerequisiteIds, []);
  assert.equal(controlItems(two)[0].status, "blocked");
  assert.equal(scheduleItem(two).dependentResources[0].id, second.controlIds[0]);
  assert.ok(scheduleItem(two).commands.every((command) => command.includes("--program program-second")));
  const beforeOne = await assessProgramReadiness(loaded, { programId: first.id });
  const f1 = (await focusedWorkflow(loaded, beforeOne)).findings.find(({ dependentResources }) => dependentResources?.length);
  const f2 = (await focusedWorkflow(loaded, two)).findings.find(({ dependentResources }) => dependentResources?.length);
  assert.notEqual(f1.key, f2.key);
});

test("shared evidence-source setup is one task while unmapped Controls keep their own gap", async (context) => {
  const { loaded } = await fixture(context, 3);
  const source = loaded.resources.find(({ type }) => type === "component");
  const originalKinds = [...source.evidenceSourceKinds];
  source.evidenceOwnerIds = [];
  const controls = loaded.resources.filter(({ type }) => type === "control");
  controls[2].evidenceSourceComponentIds = [];
  const readiness = await assessProgramReadiness(loaded);
  const groups = readiness.stages.find(({ id }) => id === "controls").items.filter(({ id }) => id.startsWith("source-readiness-"));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].dependentResources.length, 2);
  assert.deepEqual(controlItems(readiness).map(({ status }) => status), ["blocked", "blocked", "action"]);
  const workflow = await focusedWorkflow(loaded, readiness);
  assert.equal(workflow.findings.filter(({ subject }) => subject?.type === "control").length, 1);
  assert.equal(workflow.findings.filter(({ dependentResources }) => dependentResources?.length).length, 2);
  source.evidenceSourceKinds = [];
  source.evidenceOwnerIds = ["person-example"];
  const missingRole = await assessProgramReadiness(loaded);
  assert.equal(missingRole.stages.find(({ id }) => id === "controls").items.filter(({ id }) => id.startsWith("source-readiness-")).length, 1);
  assert.equal(controlItems(missingRole)[0].status, "blocked");
  source.evidenceSourceKinds = originalKinds;
  source.evidenceOwnerIds = ["person-example"];
  const cleared = await assessProgramReadiness(loaded, { collectionReviews: assessCollectionReviews(loaded).map((review) => review.resourceType === "obligation" ? { ...review, complete: true } : review) });
  assert.deepEqual(controlItems(cleared).map(({ status }) => status), ["complete", "complete", "action"]);
});

test("CLI and browser state expose identical grouped readiness", async (context) => {
  const { root, loaded } = await fixture(context);
  const browser = await createAppStateSection(loaded, "program");
  const cli = fileURLToPath(new URL("../bin/filegrc.js", import.meta.url));
  const output = await executeCli(runCli, process.execPath, [cli, "program-readiness", "--json", "--root", root]);
  const { generatedAt: a, ...fromCli } = JSON.parse(output.stdout);
  const { generatedAt: b, ...fromBrowser } = browser.programReadiness;
  assert.ok(a && b);
  assert.deepEqual(fromCli, fromBrowser);
});

test("mixed evidence families group the mapped source even when other mappings are missing", async (context) => {
  const { loaded } = await fixture(context, 2);
  const program = loaded.resources.find(({ type }) => type === "program");
  const controls = loaded.resources.filter(({ type }) => type === "control");
  const source = loaded.resources.find(({ type }) => type === "component");
  source.evidenceSourceKinds = [loaded.model.evidenceSourceFamilies.find(({ id }) => id === "workforce").sourceKinds[0]];
  source.evidenceOwnerIds = [];
  for (const [index, control] of controls.entries()) {
    control.code = ["HR-01", "IAM-03"][index];
    control.applicabilityReview.scopeRevision = applicabilityScopeRevision(control, program, loaded.resources, loaded.model);
  }
  const readiness = await assessProgramReadiness(loaded);
  const groups = readiness.stages.find(({ id }) => id === "controls").items.filter(({ id }) => id.startsWith("source-readiness-"));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].dependentResources.length, 2);
  for (const item of controlItems(readiness)) {
    assert.equal(item.status, "action");
    assert.equal(item.individualChecks.evidenceSourceReady, false);
    assert.ok(item.sharedPrerequisiteIds.includes(groups[0].id));
    assert.doesNotMatch(item.nextSteps.join(" "), /Workforce source/);
  }
});

test("legacy models retain actionable source-family gates", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-shared-legacy-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "3");
  const loaded = await loadWorkspace(root);
  const source = loaded.resources.find(({ type }) => type === "system");
  source.evidenceOwnerIds = [];
  const readiness = await assessProgramReadiness(loaded);
  const sourceItem = readiness.stages.find(({ id }) => id === "controls").items.find(({ id }) => id.startsWith("source-family-"));
  assert.equal(sourceItem.status, "action");
  assert.equal(sourceItem.rollupOnly, false);
  const workflow = await assessWorkflow(loaded, { programReadiness: readiness });
  assert.ok(workflow.findings.some(({ key, state }) => key.endsWith(sourceItem.id) && state === "ready"));
});
