import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { makeComprehensiveWorkspace } from "./fixtures.js";
import { initializeGitWorkspace, initializeExistingModel12Workspace, commitWorkspaceFiles, writeJson } from "./helpers.js";
import { currentCalendarDate } from "../src/time.js";
import { assessCollectionReview, scaffoldCollectionReview, applyCollectionReview } from "../src/collection-review.js";
import {
  loadWorkspace, createResource, updateResource, deleteResource, validateWorkspace, serveWorkspace,
  scaffoldObligationRuleWithdrawal, previewObligationRuleWithdrawal, withdrawObligationRule,
  scaffoldObligationRuleActivation, buildAgentGuide
} from "../src/index.js";

async function fixture(t, status = "proposed") {
  const root = await mkdtemp(join(tmpdir(), "filegrc-withdrawal-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "13");
  const loaded = await loadWorkspace(root);
  const active = loaded.resources.find(({ type }) => type === "obligation-rule");
  const rule = { ...active, id: "obligation-rule-unused-proposal", title: "Unused schedule proposal", status };
  for (const field of ["effectiveAt", "retiredOn", "supersedesId", "cutoverDecision"]) delete rule[field];
  if (status === "proposed") for (const field of ["approvedByIds", "approvedOn", "timezone"]) delete rule[field];
  await createResource(root, rule);
  const payload = { ...await scaffoldObligationRuleWithdrawal(root, { ruleId: rule.id }),
    withdrawnByIds: [loaded.resources.find(({ type, status }) => type === "person" && status === "active").id],
    withdrawnOn: "2026-07-20", withdrawalReason: "Management selected another reviewed schedule. This proposal never governed work." };
  return { root, rule, active, payload };
}

test("withdraws an unused proposal with actual decision facts and no invented approval", async (t) => {
  const { root, rule, payload } = await fixture(t);
  const before = await loadWorkspace(root);
  const baseline = await validateWorkspace(root);
  const preview = await previewObligationRuleWithdrawal(root, payload);
  assert.equal(preview.record.status, "withdrawn");
  assert.equal(preview.record.approvedOn, undefined);
  assert.equal(preview.record.effectiveAt, undefined);
  assert.equal((await loadWorkspace(root)).resources.find(({ id }) => id === rule.id).status, "proposed");
  await withdrawObligationRule(root, payload);
  const after = await loadWorkspace(root);
  const withdrawn = after.resources.find(({ id }) => id === rule.id);
  assert.equal(withdrawn.withdrawnOn, payload.withdrawnOn);
  assert.deepEqual(after.resources.filter(({ id }) => id !== rule.id), before.resources.filter(({ id }) => id !== rule.id));
  const validated = await validateWorkspace(root);
  assert.deepEqual(validated.diagnostics, baseline.diagnostics);
  await assert.rejects(() => updateResource(root, rule.type, rule.id, { ...withdrawn, status: "proposed" }), /immutable/);
  await assert.rejects(() => deleteResource(root, rule.type, rule.id), /cannot be deleted/);
  await assert.rejects(() => scaffoldObligationRuleActivation(root, { ruleId: rule.id }), /already withdrawn/);
  assert.match(buildAgentGuide(after, "obligation-rule").withdrawal, /withdraw-obligation-rule/);
});

test("withdrawal preserves a prior approval without changing independent schedule oversight", async (t) => {
  const { root, rule, payload } = await fixture(t, "approved");
  const before = await loadWorkspace(root);
  await withdrawObligationRule(root, payload);
  const after = await loadWorkspace(root);
  const withdrawn = after.resources.find(({ id }) => id === rule.id);
  assert.deepEqual(withdrawn.approvedByIds, rule.approvedByIds);
  assert.equal(withdrawn.approvedOn, rule.approvedOn);
  assert.equal(withdrawn.timezone, rule.timezone);
  assert.equal(withdrawn.effectiveAt, undefined);
  assert.deepEqual(after.resources.filter(({ type }) => type === "collection-review"), before.resources.filter(({ type }) => type === "collection-review"));
});

test("withdrawal rejects effective rules, stale edits, invalid dates, unknown actors and blank reasons", async (t) => {
  const { root, rule, active, payload } = await fixture(t);
  await assert.rejects(() => scaffoldObligationRuleWithdrawal(root, { ruleId: active.id }), /never took effect/);
  for (const patch of [{ expectedRevision: "stale" }, { withdrawnOn: "2099-01-01" }, { withdrawnOn: "not-a-date" },
    { withdrawnByIds: [] }, { withdrawnByIds: ["person-missing"] }, { withdrawalReason: " " }]) {
    await assert.rejects(() => previewObligationRuleWithdrawal(root, { ...payload, ...patch }));
  }
  await assert.rejects(() => updateResource(root, rule.type, rule.id, { ...rule, status: "withdrawn",
    withdrawnOn: payload.withdrawnOn, withdrawnByIds: payload.withdrawnByIds, withdrawalReason: payload.withdrawalReason }), /workflow-managed/);
  const loaded = await loadWorkspace(root);
  const path = loaded.entries.find(({ record }) => record.id === active.id).path;
  await writeFile(path, JSON.stringify({ ...active, status: "withdrawn", withdrawnOn: payload.withdrawnOn,
    withdrawnByIds: payload.withdrawnByIds, withdrawalReason: payload.withdrawalReason }));
  const result = await validateWorkspace(root);
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some(({ code }) => code === "effective-obligation-rule-withdrawal"));
});

test("HTTP and CLI use the shared withdrawal scaffold and preview", async (t) => {
  const { root, rule, payload } = await fixture(t);
  const server = await serveWorkspace(root, { port: 0, allowNonAuthoritativeWrites: true });
  t.after(() => new Promise((resolve) => server.server.close(resolve)));
  const endpoint = `http://127.0.0.1:${server.server.address().port}`;
  const post = (path, data) => fetch(endpoint + path, { method: "POST", headers: { "content-type": "application/json", origin: endpoint }, body: JSON.stringify(data) });
  const scaffold = await post("/api/obligation-rule-withdrawals/scaffold", { ruleId: rule.id });
  assert.equal(scaffold.status, 200);
  const apiScaffold = await scaffold.json();
  const cliScaffold = JSON.parse(execFileSync(process.execPath, [join(import.meta.dirname, "../bin/filegrc.js"), "withdraw-obligation-rule", rule.id, "--scaffold", "--root", root], { encoding: "utf8" }));
  assert.deepEqual(apiScaffold, cliScaffold);
  const response = await post("/api/obligation-rule-withdrawals/preview", payload);
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(await response.json(), await previewObligationRuleWithdrawal(root, payload));
  const file = join(root, "withdrawal.json");
  await writeFile(file, JSON.stringify(payload));
  const cliPreview = JSON.parse(execFileSync(process.execPath, [join(import.meta.dirname, "../bin/filegrc.js"), "withdraw-obligation-rule", rule.id, file, "--preview", "--root", root], { encoding: "utf8" }));
  assert.equal(cliPreview.record.status, "withdrawn");
  const sourcePath = join(root, "data/obligation-rules", `${rule.id}.json`);
  assert.equal(JSON.parse(await readFile(sourcePath)).status, "proposed");
  const applied = await post("/api/obligation-rule-withdrawals", payload);
  assert.equal(applied.status, 201, await applied.clone().text());
  assert.equal(JSON.parse(await readFile(sourcePath)).status, "withdrawn");
});

test("committed withdrawal remains immutable under direct source edits", async (t) => {
  const { root, rule, payload } = await fixture(t);
  await withdrawObligationRule(root, payload);
  await initializeGitWorkspace(root);
  const path = join(root, "data/obligation-rules", `${rule.id}.json`);
  const withdrawn = JSON.parse(await readFile(path));
  await writeFile(path, JSON.stringify({ ...withdrawn, withdrawalReason: "Rewritten decision" }));
  const result = await validateWorkspace(root);
  assert.ok(result.diagnostics.some(({ code }) => code === "rewritten-finalized-record"), JSON.stringify(result.diagnostics));
});

test("withdrawing an explicitly excluded successor preserves the exact independent schedule approval", async (t) => {
  const { root, rule, active, payload } = await fixture(t);
  let loaded = await loadWorkspace(root);
  const proposalEntry = loaded.entries.find(({ record }) => record.id === rule.id);
  await writeJson(proposalEntry.path, { ...rule, supersedesId: active.id, cutoverDecision: "new-windows-only" });
  const obligationEntry = loaded.entries.find(({ record }) => record.id === active.obligationId);
  await writeJson(obligationEntry.path, { ...obligationEntry.record, ruleIds: [...obligationEntry.record.ruleIds, rule.id] });
  await initializeExistingModel12Workspace(root);
  loaded = await loadWorkspace(root);
  const program = loaded.resources.find(({ type }) => type === "program");
  const scaffold = await scaffoldCollectionReview(root, { resourceType: "obligation", programId: program.id });
  const reviewedOn = currentCalendarDate(loaded.workspace.timezone);
  await applyCollectionReview(root, { ...scaffold, confirmed: true,
    reviewedByIds: ["person-independent-approver-example"], reviewedOn,
    rationale: "Reviewed the adopted rule and explicitly excluded its unused successor.",
    scheduleDecisions: scaffold.scheduleDecisions.map((decision) => ({ ...decision, disposition: "adopted",
      rationale: "The current rule remains adopted; the proposed successor will not govern work.",
      ...(decision.obligationId === active.obligationId ? { excludedRuleIds: [rule.id] } : {}) })) });
  await commitWorkspaceFiles(root, "Approve the current schedule set and exclude the unused successor");
  const before = await loadWorkspace(root);
  const approval = assessCollectionReview(before, "obligation", { programId: program.id });
  assert.equal(approval.complete, true, JSON.stringify(approval));
  assert.equal(approval.status, "current");
  const beforeReview = before.entries.find(({ record }) => record.id === approval.review.id);
  const activeBefore = before.entries.find(({ record }) => record.id === active.id);
  const obligationBefore = before.entries.find(({ record }) => record.id === active.obligationId);
  await withdrawObligationRule(root, { ...payload,
    ...await scaffoldObligationRuleWithdrawal(root, { ruleId: rule.id }),
    withdrawnByIds: payload.withdrawnByIds, withdrawnOn: reviewedOn, withdrawalReason: payload.withdrawalReason });
  const after = await loadWorkspace(root);
  const assessment = assessCollectionReview(after, "obligation", { programId: program.id });
  assert.equal(assessment.complete, true, JSON.stringify(assessment));
  assert.equal(assessment.status, "current");
  assert.deepEqual(assessment.review, approval.review);
  for (const entry of [beforeReview, activeBefore, obligationBefore]) {
    assert.equal(await readFile(entry.path, "utf8"), entry.source, `${entry.record.id} must remain byte-for-byte unchanged`);
  }
  const changedExcluded = { ...after, resources: after.resources.map((record) => record.id === rule.id
    ? { ...record, rationale: "Changed the reviewed proposal before withdrawing it." } : record) };
  assert.equal(assessCollectionReview(changedExcluded, "obligation", { programId: program.id }).complete, false);
  // A new proposal and any change to the adopted duty still need independent review.
  const newProposal = { ...rule, id: "obligation-rule-another-proposal" };
  const extra = { ...after, resources: [...after.resources, newProposal] };
  assert.equal(assessCollectionReview(extra, "obligation", { programId: program.id }).complete, false);
  const changedDuty = { ...after, resources: after.resources.map((record) => record.id === active.id
    ? { ...record, window: { precision: "date", startsAfter: 0, dueAfter: 4 } } : record) };
  assert.equal(assessCollectionReview(changedDuty, "obligation", { programId: program.id }).complete, false);
  const newAdoption = { ...after, resources: after.resources.map((record) => record.id === active.obligationId
    ? { ...record, activeRuleId: rule.id } : record.id === active.id ? { ...record, status: "retired", retiredOn: reviewedOn }
    : record.id === rule.id ? { ...record, status: "active", approvedByIds: payload.withdrawnByIds,
      approvedOn: reviewedOn, effectiveAt: `${reviewedOn}T00:00:00Z`, timezone: "UTC" } : record) };
  assert.equal(assessCollectionReview(newAdoption, "obligation", { programId: program.id }).complete, false);
});
