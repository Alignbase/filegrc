import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { programAccessFixture } from "./fixtures/program-access-occurrence.js";
import { executeCli, initializeGitWorkspace, writeJson } from "./helpers.js";
import { runCli } from "../src/cli.js";
import { scaffoldObligationOccurrence, saveObligationOccurrence, loadWorkspace, planObligations, validateWorkspace } from "../src/index.js";
import { occurrenceCompletionContext } from "../src/obligation-completion-context.js";
import { reviewHistoryContext } from "../src/historical-workspace.js";
import { assessCompletionForObligation, completionMatchesMember } from "../src/obligations.js";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "filegrc-program-access-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return programAccessFixture(root);
}
const scaffold = (f) => scaffoldObligationOccurrence(f.root, { obligationId: f.obligation.id, windowStart: "2026-07-05", asOf: "2026-07-07" });
const reconcile = (record) => ({ ...record, status: "reconciled", completedCount: 1, conclusion: "complete", reviewedByIds: ["person-example"], reconciledAt: "2026-07-07T18:00:00Z" });

test("native full-program review closes workspace occurrence through CLI without invented linkage", async (t) => {
  const f = await fixture(t);
  const before = await readFile(join(f.root, "data/access-reviews", `${f.review.id}.json`), "utf8");
  const payload = await scaffold(f);
  assert.deepEqual(payload.record.members.map(({ resourceId, result }) => ({ resourceId, result })), [{ resourceId: "workspace", result: "passed" }]);
  assert.equal(f.review.obligationId, undefined);
  const path = join(f.root, "reconciliation.json");
  await writeJson(path, { ...payload, record: reconcile(payload.record) });
  await executeCli(runCli, process.execPath, [new URL("../bin/filegrc.js", import.meta.url).pathname, "reconcile-obligation", f.obligation.id, path, "--root", f.root, "--json"]);
  assert.equal(await readFile(join(f.root, "data/access-reviews", `${f.review.id}.json`), "utf8"), before);
  const loaded = await loadWorkspace(f.root);
  const item = planObligations(loaded.resources, { model: loaded.model, asOf: "2026-07-07", through: "2026-07-07", includeComplete: true }).calendarItems.find(({ obligationId }) => obligationId === f.obligation.id);
  assert.equal(item.status, "complete");
  assert.deepEqual((await validateWorkspace(f.root)).diagnostics.filter(({ code }) => /occurrence|member|population/.test(code)), []);
});

test("unscoped review rejects incomplete provider boundaries, grants, proof, result and dates", async (t) => {
  const f = await fixture(t);
  const variants = [
    { ...f.review, componentIds: ["component-example"] },
    { ...f.review, grantDecisions: [] },
    { ...f.review, evidenceIds: [f.proof.id] },
    { ...f.review, completedOn: "2026-07-04", approvedOn: "2026-07-04", coverage: { kind: "as-of", on: "2026-07-04" } },
    { ...f.review, status: "planned" },
    { ...f.review, outcome: "failed" }
  ];
  for (const review of variants) {
    await f.save(review);
    const loaded = await loadWorkspace(f.root);
    assert.equal(assessCompletionForObligation(review, f.obligation, loaded, { memberIds: ["workspace"], window: { dueWindowStart: "2026-07-05", dueWindowEnd: "2026-07-21" }, asOf: "2026-07-07" }).complete, false);
    const payload = await scaffold(f);
    assert.notEqual(payload.record.members[0].result, "passed");
    const injected = reconcile(payload.record);
    injected.members[0] = { ...injected.members[0], result: "passed", completionResourceIds: [review.id] };
    await assert.rejects(saveObligationOccurrence(f.root, { record: injected }), /completion|population|grant|status|outcome/i);
  }
});

test("explicit scope retains per-member proof and adjacent native types can match unscoped sentinel", async (t) => {
  const f = await fixture(t);
  const loaded = await loadWorkspace(f.root), byId = new Map(loaded.resources.map((r) => [r.id, r]));
  const obligation = { ...f.obligation, scopeResourceIds: ["component-example", f.component.id] };
  assert.equal(completionMatchesMember({ ...f.review, componentIds: ["component-example"] }, "componentIds", f.component.id, loaded.model, byId, obligation), false);
  assert.equal(completionMatchesMember(f.review, "componentIds", "workspace", loaded.model, byId, obligation), false);
  for (const type of ["meeting", "risk-assessment", "exercise", "backup-test", "vulnerability-scan"]) {
    const record = loaded.resources.find((r) => r.type === type);
    assert.equal(completionMatchesMember(record, loaded.model.obligationActivities[type]?.aggregate?.completionMemberField, "workspace", loaded.model, byId, { ...f.obligation, id: "obligation-native" }), true, type);
  }
});


test("committed reconciliations retain their dated population after provider and grant additions", async (t) => {
  const f = await fixture(t);
  const payload = await scaffold(f);
  await saveObligationOccurrence(f.root, { record: reconcile(payload.record) });
  await initializeGitWorkspace(f.root);
  await f.save({ ...f.component, id: "component-added-later", title: "Later provider" });
  const loaded = await loadWorkspace(f.root);
  const grant = loaded.resources.find(({ type }) => type === "access-grant");
  await f.save({ ...grant, id: "access-grant-added-later", provisionedOn: "2026-08-01", approvedOn: "2026-08-01" });
  const current = await loadWorkspace(f.root);
  const item = planObligations(current.resources, { root: f.root, model: current.model, asOf: "2026-08-10", from: "2026-07-05", through: "2026-07-21", includeComplete: true }).calendarItems.find(({ obligationId }) => obligationId === f.obligation.id);
  assert.equal(item.status, "complete");
  assert.deepEqual((await validateWorkspace(f.root)).diagnostics.filter(({ code }) => /occurrence|member|population/.test(code)), []);
  const occurrence = current.resources.find(({ type }) => type === "obligation-occurrence");
  await f.save({ ...occurrence, reconciledAt: "2026-07-08T18:00:00Z" });
  assert.ok((await validateWorkspace(f.root)).diagnostics.some(({ code }) => code === "missing-passing-member-completion"));
});


test("rule-only selected Control links retain all provider boundaries", async (t) => {
  const f = await fixture(t);
  const loaded = await loadWorkspace(f.root);
  const control = loaded.resources.find(({ type }) => type === "control");
  await f.save({ ...control, code: "CUSTOM", componentIds: ["component-control-only"] });
  await f.save({ ...f.component, id: "component-control-only", systemUses: [] });
  await f.save({ ...f.rule, controlIds: [control.id] });
  await f.save({ ...f.obligation, controlIds: [] });
  const current = await loadWorkspace(f.root);
  const obligation = current.resources.find(({ type }) => type === "obligation");
  assert.equal(assessCompletionForObligation(f.review, obligation, current, { asOf: "2026-07-07", memberIds: ["workspace"] }).complete, false);
});

test("superseded committed review keeps its original reconciliation date after grant expiry", async (t) => {
  const f = await fixture(t);
  const loaded = await loadWorkspace(f.root);
  const grant = loaded.resources.find(({ type }) => type === "access-grant");
  await f.save({ ...grant, expiresOn: "2026-07-31" });
  const payload = await scaffold(f);
  const occurrence = reconcile(payload.record);
  await saveObligationOccurrence(f.root, { record: occurrence });
  await initializeGitWorkspace(f.root);
  await f.save({ ...occurrence, status: "superseded" });
  assert.deepEqual((await validateWorkspace(f.root)).diagnostics.filter(({ code }) => /occurrence|member|population/.test(code)), []);
});


test("other active provider schedules contribute selected Control boundaries to program-wide scope", async (t) => {
  const f = await fixture(t);
  const loaded = await loadWorkspace(f.root);
  const control = loaded.resources.find(({ type }) => type === "control");
  await f.save({ ...control, code: "CUSTOM", componentIds: ["component-other-schedule"] });
  await f.save({ ...f.component, id: "component-other-schedule", systemUses: [] });
  await f.save({ ...f.obligation, controlIds: [] });
  await f.save({ ...f.rule, controlIds: [] });
  await f.save({ ...f.obligation, id: "obligation-other", controlIds: [control.id], activeRuleId: "obligation-rule-other" });
  await f.save({ ...f.rule, id: "obligation-rule-other", obligationId: "obligation-other", controlIds: [control.id] });
  const current = await loadWorkspace(f.root);
  const obligation = current.resources.find(({ id }) => id === f.obligation.id);
  assert.equal(assessCompletionForObligation(f.review, obligation, current, { asOf: "2026-07-07", memberIds: ["workspace"] }).complete, false);
});


test("uncommitted or altered reconciliations cannot bypass live provider scope in the planner", async (t) => {
  const f = await fixture(t);
  const payload = await scaffold(f);
  await f.save(reconcile(payload.record));
  await f.save({ ...f.review, componentIds: ["component-example"] });
  const current = await loadWorkspace(f.root);
  for (const root of [undefined, f.root]) {
    const item = planObligations(current.resources, { root, model: current.model, asOf: "2026-07-07", through: "2026-07-07", includeComplete: true }).calendarItems.find(({ obligationId }) => obligationId === f.obligation.id);
    assert.notEqual(item.status, "complete");
  }
});

test("native unscoped work from another System cannot satisfy the selected Program", async (t) => {
  const f = await fixture(t);
  const loaded = await loadWorkspace(f.root);
  const assessment = loaded.resources.find(({ type }) => type === "risk-assessment");
  const obligation = { ...f.obligation, activityType: "risk-assessment" };
  const record = { ...assessment, systemIds: ["system-unrelated"], componentIds: [], completedOn: "2026-07-07", approvedOn: "2026-07-07" };
  const unrelated = { ...loaded.resources.find(({ type }) => type === "system"), id: "system-unrelated" };
  const context = { ...loaded, resources: [...loaded.resources, unrelated] };
  assert.equal(assessCompletionForObligation(record, obligation, context, { asOf: "2026-07-07", memberIds: ["workspace"] }).complete, false);
});


test("workspace fallback retains explicit native linkage without a Program", async (t) => {
  const f = await fixture(t);
  const loaded = await loadWorkspace(f.root);
  const byId = new Map([["workspace", loaded.workspace]]);
  const obligation = { id: "obligation-legacy" };
  assert.equal(completionMatchesMember({ type: "meeting", obligationId: obligation.id }, null, "workspace", loaded.model, byId, obligation), true);
  assert.equal(completionMatchesMember({ type: "meeting", obligationId: "obligation-other" }, null, "workspace", loaded.model, byId, obligation), false);
});

test("finalized provider context falls back to Git traversal when its history index is unavailable", async (t) => {
  const f = await fixture(t);
  const payload = await scaffold(f), occurrence = reconcile(payload.record);
  await saveObligationOccurrence(f.root, { record: occurrence });
  await initializeGitWorkspace(f.root);
  await f.save({ ...f.component, id: "component-later" });
  const loaded = await loadWorkspace(f.root);
  const history = reviewHistoryContext(f.root, loaded.resources);
  history.index = null;
  const context = occurrenceCompletionContext(f.root, occurrence, f.review, loaded.model, loaded.resources, loaded.workspace.timezone);
  assert.ok(context.historicalCommit);
  assert.equal(context.resources.some(({ id }) => id === "component-later"), false);
});


test("historical membership survives later reassignment of provider Components", async (t) => {
  const f = await fixture(t), payload = await scaffold(f);
  await saveObligationOccurrence(f.root, { record: reconcile(payload.record) });
  await initializeGitWorkspace(f.root);
  const loaded = await loadWorkspace(f.root);
  const system = loaded.resources.find(({ type }) => type === "system");
  await f.save({ ...system, id: "system-reassigned" });
  for (const component of loaded.resources.filter(({ type }) => type === "component")) {
    await f.save({ ...component, systemUses: component.systemUses.map((use) => ({ ...use, systemId: "system-reassigned" })) });
  }
  const current = await loadWorkspace(f.root);
  const item = planObligations(current.resources, { root: f.root, model: current.model, asOf: "2026-07-07", through: "2026-07-07", includeComplete: true }).calendarItems.find(({ obligationId }) => obligationId === f.obligation.id);
  assert.equal(item.status, "complete");
  assert.deepEqual((await validateWorkspace(f.root)).diagnostics.filter(({ code }) => /occurrence|member|population/.test(code)), []);
});


test("CLI rejects unsupported reconciliation preview before changing any source record", async (t) => {
  const f = await fixture(t), payload = await scaffold(f);
  const path = join(f.root, "reconciliation.json");
  await writeJson(path, { ...payload, record: reconcile(payload.record) });
  const before = (await loadWorkspace(f.root)).entries.map(({ relativePath, source }) => ({ relativePath, source }));
  await assert.rejects(executeCli(runCli, process.execPath, [new URL("../bin/filegrc.js", import.meta.url).pathname,
    "reconcile-obligation", f.obligation.id, path, "--preview", "--root", f.root, "--json"]), /does not support --preview/);
  const after = (await loadWorkspace(f.root)).entries.map(({ relativePath, source }) => ({ relativePath, source }));
  assert.deepEqual(after, before);
});


test("full-provider completion uses the requested Program when schedules are shared", async (t) => {
  const f = await fixture(t), loaded = await loadWorkspace(f.root);
  const program = loaded.resources.find(({ type }) => type === "program");
  const system = loaded.resources.find(({ type }) => type === "system");
  await f.save({ ...system, id: "system-other-program" });
  await f.save({ ...f.component, id: "component-other-program", systemUses: f.component.systemUses.map((use) => ({ ...use, systemId: "system-other-program" })) });
  await f.save({ ...program, id: "program-other", systemIds: ["system-other-program"] });
  const selected = await scaffoldObligationOccurrence(f.root, { programId: program.id, obligationId: f.obligation.id, windowStart: "2026-07-05", asOf: "2026-07-07" });
  assert.equal(selected.record.members[0].result, "passed");
  const other = await scaffoldObligationOccurrence(f.root, { programId: "program-other", obligationId: f.obligation.id, windowStart: "2026-07-05", asOf: "2026-07-07" });
  assert.notEqual(other.record.members[0].result, "passed");
});
