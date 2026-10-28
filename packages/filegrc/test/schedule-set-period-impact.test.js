import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadModel } from "../model/index.js";
import { makeComprehensiveWorkspace } from "./fixtures.js";
import { adoptWorkflowRuntime } from "./fixtures/workflow-runtime.js";
import { initializeExistingModel12Workspace, commitWorkspaceFiles } from "./helpers.js";
import { loadWorkspace } from "../src/workspace.js";
import { assessCollectionReview, scaffoldCollectionReview, applyCollectionReview } from "../src/collection-review.js";
import { collectionRevision } from "../src/collection-revision.js";
import { scheduleSetInputs } from "../src/schedule-set.js";
import { scaffoldPeriodImpactReview, recordPeriodImpactReview } from "../src/period-impact.js";
import { currentCalendarDate } from "../src/time.js";
import { markdownEntries } from "../src/resource-markdown.js";

const impactTypes = ["appointment", "control", "policy", "source-coverage", "system", "component"];

test("period impact metadata stays outside every covered schedule design input", () => {
  const sources = impactTypes.map((type) => ({ id: `${type}-source`, type, title: `Reviewed ${type}`, periodImpactReview: { rationale: "Owner reviewed the unchanged operating facts." } }));
  const obligation = { id: "obligation-one", type: "obligation", status: "active", controlIds: ["control-source"], scopeResourceIds: sources.map(({ id }) => id) };
  const program = { id: "program-one", type: "program", controlIds: ["control-source"] };
  const loaded = { model: loadModel("13"), resources: [program, obligation, ...sources] };
  for (const source of sources) {
    const input = scheduleSetInputs(loaded, program).find(({ record }) => record.id === source.id);
    assert.ok(input, source.type);
    assert.equal(input.value.periodImpactReview, undefined, source.type);
    assert.deepEqual(input.record.periodImpactReview, { rationale: "Owner reviewed the unchanged operating facts." }, "Source decisions must remain intact");
  }
});

test("owner impact metadata preserves the committed independent schedule approval without neutralizing duty changes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-schedule-impact-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "13");
  await adoptWorkflowRuntime(root);
  await initializeExistingModel12Workspace(root);
  let loaded = await loadWorkspace(root);
  const program = loaded.resources.find(({ type }) => type === "program");
  const scaffold = await scaffoldCollectionReview(root, { resourceType: "obligation", programId: program.id });
  const today = currentCalendarDate(loaded.workspace.timezone);
  await applyCollectionReview(root, { ...scaffold, confirmed: true, reviewedByIds: ["person-independent-approver-example"], reviewedOn: today,
    rationale: "Independently reviewed the current adopted duties and their schedule.",
    scheduleDecisions: scaffold.scheduleDecisions.map((decision) => ({ ...decision, disposition: "adopted", rationale: "Required schedule for the selected Control." })) });
  await commitWorkspaceFiles(root, "Approve the reviewed schedule set");
  const before = await loadWorkspace(root);
  const beforeAssessment = assessCollectionReview(before, "obligation", { programId: program.id });
  assert.equal(beforeAssessment.complete, true);
  const preserved = before.entries.filter(({ record }) => record.id === beforeAssessment.review.id || ["obligation", "obligation-rule"].includes(record.type));
  const beforeRevision = collectionRevision(before, "obligation", { programId: program.id });
  for (const type of ["control", "policy"]) {
    const target = loaded.resources.find((record) => record.type === type);
    const payload = await scaffoldPeriodImpactReview(root, { resourceId: target.id });
    Object.assign(payload.review, { reviewedByIds: ["person-example"], reviewedOn: today, effectiveOn: today,
      conclusion: "no-material-change", rationale: "The owner reviewed the unchanged operating facts and procedure." });
    await recordPeriodImpactReview(root, payload);
    loaded = await loadWorkspace(root);
    const assessment = assessCollectionReview(loaded, "obligation", { programId: program.id });
    assert.equal(assessment.complete, true, `${type}: ${JSON.stringify(assessment)}`);
    assert.equal(assessment.status, "current");
    assert.equal(collectionRevision(loaded, "obligation", { programId: program.id }), beforeRevision);
    assert.deepEqual(assessment.review, beforeAssessment.review);
  }
  for (const entry of preserved) assert.equal(await readFile(entry.path, "utf8"), entry.source, entry.record.id);
  for (const type of ["obligation-rule", "control", "policy"]) {
    const altered = { ...loaded, resources: loaded.resources.map((record) => record.type !== type ? record
      : type === "obligation-rule" ? { ...record, window: { precision: "date", startsAfter: 0, dueAfter: 4 } }
      : type === "control" ? { ...record, description: "The Control now performs a different operating duty." }
      : { ...record, version: "materially-revised" }) };
    assert.equal(assessCollectionReview(altered, "obligation", { programId: program.id }).complete, false, type);
  }
  const policy = loaded.resources.find(({ type }) => type === "policy");
  const policyPath = join(root, "data", markdownEntries(loaded.model, policy)[0].path);
  const originalContent = await readFile(policyPath, "utf8");
  await writeFile(policyPath, `${originalContent}\nManagement requires an additional operating duty.\n`);
  assert.equal(assessCollectionReview(await loadWorkspace(root), "obligation", { programId: program.id }).complete, false);
});
