import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import test from "node:test";
import { makeComprehensiveWorkspace } from "./fixtures.js";
import { loadWorkspace } from "../src/workspace.js";
import { resourceDataPath, markdownEntries } from "../src/resource-markdown.js";
import { assessBoundControlPeriodReview } from "../src/control-period-review.js";

const execute = promisify(execFile);
const asOf = "2026-10-28";
async function fixture(context, configure = () => {}) {
  const root = await mkdtemp(join(tmpdir(), "filegrc-bound-control-review-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "13");
  let loaded = await loadWorkspace(root);
  const control = loaded.resources.find(record => record.type === "control");
  const owner = loaded.resources.find(record => record.type === "person" && record.id === control.ownerIds[0]);
  const program = loaded.resources.find(record => record.type === "program");
  const system = loaded.resources.find(record => record.type === "system");
  const source = { id: "component-governance-inputs", type: "component", title: "Governance record repository", status: "active", componentKind: "software", description: "Authoritative governance record inputs.", ownerIds: [owner.id], systemUses: [{ systemId: system.id, roles: ["evidence-source"], rationale: "Produces retained design-review inputs." }], evidenceSourceKinds: ["governance"] };
  const save = async record => {
    const path = join(root, "data", resourceDataPath(loaded.model, record));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(record, null, 2) + "\n");
  };
  await save(source);
  const obligation = { ...loaded.resources.find(record => record.type === "obligation"), id: "obligation-design-review", title: "Annual design review", activityType: "control-design-review", activeRuleId: "obligation-rule-design-review", ruleIds: ["obligation-rule-design-review"] };
  const rule = { ...loaded.resources.find(record => record.type === "obligation-rule"), id: obligation.activeRuleId, obligationId: obligation.id, recurrence: { mode: "calendar", unit: "year", interval: 1, anchorDate: "2026-01-01" } };
  delete rule.window;
  await save(obligation); await save(rule);
  const git = async (...args) => (await execute("git", args, { cwd: root })).stdout.trim();
  await git("init", "--initial-branch=main");
  const commit = async message => {
    await git("add", ".");
    await execute("git", ["-c", "commit.gpgSign=false", "commit", "--quiet", "-m", message], { cwd: root, env: { ...process.env, GIT_AUTHOR_NAME: "Fixture Reviewer", GIT_AUTHOR_EMAIL: "reviewer@example.test", GIT_COMMITTER_NAME: "Fixture Reviewer", GIT_COMMITTER_EMAIL: "reviewer@example.test" } });
    return git("rev-parse", "HEAD");
  };
  await commit("Record baseline design");
  const slot = markdownEntries(loaded.model, control)[0], contentPath = join(root, "data", slot.path);
  const baseline = await readFile(contentPath, "utf8");
  await writeFile(contentPath, baseline + "\nInspect current source scope before retaining the review result.\n");
  const sourceCommit = await commit("Clarify reviewed operating procedure");
  const evidence = { id: "evidence-design-inputs", type: "evidence", title: "Retained design-review inputs", status: "collected", artifactKind: "system-export", sourceKind: "component", sourceComponentId: source.id, sourceDescription: "Fixed current design inputs from the governance repository.", collectedOn: "2026-10-25", collectedAt: "2026-10-25T12:00:00Z", collectorIds: [owner.id], classificationId: "classification-example", systemIds: [system.id], sourceCommit, filePaths: ["evidence/evidence-design-inputs/design-inputs.json"] };
  await mkdir(join(root, "data/evidence/evidence-design-inputs"), { recursive: true });
  await writeFile(join(root, "data", evidence.filePaths[0]), JSON.stringify({ reviewPurpose: "Current Control design and source inputs.", procedure: await readFile(contentPath, "utf8") }));
  const review = { id: "control-activity-design-review", type: "control-activity", title: "Completed design review", status: "complete", profileId: "control-design-review", scopeResourceIds: [system.id], ownerIds: [owner.id], obligationId: obligation.id, controlIds: [control.id], performerIds: [owner.id], completedAt: "2026-10-25T12:10:00Z", method: "Reviewed the scoped current Control design and retained exact source inputs.", result: "passed", reviewerIds: [owner.id], reviewedOn: "2026-10-25", evidenceIds: [evidence.id] };
  const occurrence = { id: "obligation-occurrence-design-review", type: "obligation-occurrence", title: "Reconciled design review", status: "reconciled", programId: program.id, obligationId: obligation.id, ruleId: rule.id, occurrenceKey: "2026-01-01", coverage: { kind: "range", startsOn: "2026-01-01", endsOn: "2026-12-31" }, membershipCutoffAt: "2026-10-25", members: [{ resourceId: system.id, disposition: "expected", result: "passed", completionResourceIds: [review.id] }], expectedCount: 1, completedCount: 1, ownerIds: [owner.id], reviewedByIds: [owner.id], reconciledAt: "2026-10-25T12:20:00Z", conclusion: "complete" };
  configure({ review, evidence, occurrence, source });
  await save(source); await save(evidence); await save(review); await save(occurrence);
  await commit("Retain completed review and frozen occurrence");
  loaded = await loadWorkspace(root);
  const assess = async () => { const current = await loadWorkspace(root); return assessBoundControlPeriodReview(current, current.resources.find(record => record.id === control.id), { asOf }); };
  return { root, control, source, owner, program, system, obligation, rule, evidence, review, occurrence, save, commit, assess, contentPath, reviewedContent: await readFile(contentPath, "utf8") };
}

test("normal scoped owner design review reuses exact fixed inputs without a second impact decision", async context => {
  const f = await fixture(context);
  assert.deepEqual(await f.assess(), { reviewResourceId: f.review.id, evidenceResourceId: f.evidence.id, occurrenceResourceId: f.occurrence.id, sourceRevision: f.evidence.sourceCommit });
  await writeFile(join(f.root, "notes.md"), "Unrelated repository update.\n"); await f.commit("Update unrelated notes");
  assert.equal((await f.assess())?.reviewResourceId, f.review.id);
});

test("changed procedure and change/revert/repeat cannot reuse old design inputs", async context => {
  const f = await fixture(context);
  await writeFile(f.contentPath, f.reviewedContent + "\nUse a different privileged-access population.\n");
  assert.equal(await f.assess(), null, "Same effective date and procedure label cannot hide changed companion procedures.");
  await f.commit("Change the actual procedure");
  await writeFile(f.contentPath, f.reviewedContent); await f.commit("Return to earlier procedure bytes");
  assert.equal(await f.assess(), null, "A later repeated state needs a new actual review.");
});

test("unbound, incomplete, failed, unauthorized or differently scoped reviews remain work", async context => {
  for (const [label, mutate] of [
    ["incomplete", f => { f.review.status = "planned"; }],
    ["failed", f => { f.review.result = "failed"; }],
    ["different scope", f => { f.review.scopeResourceIds = [f.source.id]; }],
    ["not a design review", f => { f.review.profileId = "inventory-review"; }],
    ["no captured source", f => { delete f.evidence.sourceCommit; }],
    ["not repository inputs", f => { f.source.evidenceSourceKinds = ["network-security"]; }],
    ["not retained fixed proof", f => { f.evidence.filePaths = []; }],
    ["rehearsal only", f => { f.evidence.readinessTest = true; }],
    ["failed occurrence", f => { f.occurrence.members[0].result = "failed"; }],
    ["wrong completion", f => { f.occurrence.members[0].completionResourceIds = []; }],
    ["unauthorized actor", f => { f.review.performerIds = ["person-independent-approver-example"]; f.review.reviewerIds = ["person-independent-approver-example"]; }]
  ]) {
    const f = await fixture(context, mutate);
    assert.equal(await f.assess(), null, label);
  }
});

test("fixed input replacement cannot manufacture a bound review", async context => {
  const f = await fixture(context);
  await writeFile(join(f.root, "data", f.evidence.filePaths[0]), '{"different":"input"}');
  assert.equal(await f.assess(), null);
});
