import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { makeComprehensiveWorkspace } from "./fixtures.js";
import { executeCli, writeJson } from "./helpers.js";
import { runCli } from "../src/cli.js";
import { contentRevision } from "../src/files.js";
import { completeObligationOccurrence, scaffoldObligationOccurrence, scaffoldObligationCompletion,
  planObligations, loadWorkspace, validateWorkspace, serveWorkspace } from "../src/index.js";

async function fixture(context) {
  const root = await mkdtemp(join(tmpdir(), "filegrc-completion-reconciliation-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "13");
  const loaded = await loadWorkspace(root);
  const obligationEntry = loaded.entries.find(({ record }) => record.type === "obligation");
  const ruleEntry = loaded.entries.find(({ record }) => record.type === "obligation-rule");
  const obligation = { ...obligationEntry.record, activityType: "endpoint-verification" };
  const rule = { ...ruleEntry.record, recurrence: { mode: "calendar", unit: "month", interval: 1, anchorDate: "2026-01-01" },
    window: { precision: "date", startsAfter: 0, dueAfter: 20 }, effectiveAt: "2026-07-05T00:00:00-05:00" };
  delete rule.selector;
  await writeJson(obligationEntry.path, obligation);
  await writeJson(ruleEntry.path, rule);
  for (const entry of loaded.entries.filter(({ record }) => record.type === "obligation-occurrence")) await rm(entry.path);
  const record = { ...loaded.resources.find(({ type }) => type === "control-activity"),
    id: "control-activity-endpoint-june", status: "complete", obligationId: obligation.id,
    scopeResourceIds: ["system-example"], performerIds: ["person-example"],
    reviewerIds: ["person-example"], completedAt: "2026-07-07T15:30:00Z", reviewedOn: "2026-07-07",
    method: "Inspect the retained endpoint settings and reconcile the fixed device inventory.", result: "passed" };
  const evidenceEntry = loaded.entries.find(({ record }) => record.type === "evidence");
  await writeJson(evidenceEntry.path, { ...evidenceEntry.record, collectedOn: "2026-07-07", verifiedOn: "2026-07-07" });
  const revision = contentRevision(await readFile(obligationEntry.path, "utf8"));
  return { root, obligation, rule, record, revision, ruleEntry, obligationEntry };
}

test("later-day completion atomically reconciles a fixed initial cutover window and retries safely", async (context) => {
  const f = await fixture(context);
  const scaffold = await scaffoldObligationCompletion(f.root, { obligationId: f.obligation.id,
    windowStart: "2026-07-05", completedOn: "2026-07-07" });
  assert.equal(scaffold.scaffold.dueWindowStart, "2026-07-05");
  const result = await completeObligationOccurrence(f.root, { obligationId: f.obligation.id,
    expectedRevision: f.revision, record: f.record });
  assert.equal(result.linked.status, "reconciled");
  assert.equal(result.created.completedAt, f.record.completedAt);
  assert.deepEqual(result.linked.reviewedByIds, ["person-example"]);
  assert.equal(result.linked.coverage.startsOn, "2026-07-05");
  assert.equal(result.linked.completedCount, 1);
  const retry = await completeObligationOccurrence(f.root, { obligationId: f.obligation.id,
    expectedRevision: f.revision, record: f.record });
  assert.deepEqual(retry, result);
  const loaded = await loadWorkspace(f.root);
  assert.equal(loaded.resources.filter(({ id }) => id === f.record.id).length, 1);
  const item = planObligations(loaded.resources, { model: loaded.model, asOf: "2026-07-07",
    through: "2026-07-07", includeComplete: true }).calendarItems.find(({ obligationId }) => obligationId === f.obligation.id);
  assert.equal(item.status, "complete");
  const validation = await validateWorkspace(f.root);
  assert.deepEqual(validation.diagnostics.filter(({ code }) => /occurrence|member|population/.test(code)), []);
});

test("completion rejects stale writes and invalid proof without creating either record", async (context) => {
  const f = await fixture(context);
  await assert.rejects(completeObligationOccurrence(f.root, { obligationId: f.obligation.id,
    expectedRevision: "stale", record: f.record }), /changed/);
  await assert.rejects(completeObligationOccurrence(f.root, { obligationId: f.obligation.id,
    expectedRevision: f.revision, record: { ...f.record, result: "failed" } }), /model-required/);
  const loaded = await loadWorkspace(f.root);
  assert.equal(loaded.resources.some(({ id }) => id === f.record.id), false);
  assert.equal(loaded.resources.some(({ type }) => type === "obligation-occurrence"), false);
});

test("dynamic populations still require committed cutoff proof after the cutoff", async (context) => {
  const f = await fixture(context);
  await writeJson(f.ruleEntry.path, { ...f.rule, selector: { resourceType: "asset", membershipMode: "as-of", cutoff: "window-start", statuses: ["active"] } });
  await assert.rejects(scaffoldObligationOccurrence(f.root, { obligationId: f.obligation.id,
    windowStart: "2026-07-05", asOf: "2026-07-07" }), /population can no longer be inferred/);
  await assert.rejects(completeObligationOccurrence(f.root, { obligationId: f.obligation.id,
    expectedRevision: f.revision, record: f.record }), /population can no longer be inferred/);
  assert.equal((await loadWorkspace(f.root)).resources.some(({ id }) => id === f.record.id), false);
});

test("CLI and browser completion use the same fixed-population reconciliation", async (context) => {
  const cli = await fixture(context);
  const browser = await fixture(context);
  const payload = join(cli.root, "completion.json");
  await writeFile(payload, JSON.stringify({ record: cli.record, revision: cli.revision }));
  const output = await executeCli(runCli, process.execPath, [new URL("../bin/filegrc.js", import.meta.url).pathname, "complete", cli.obligation.id, payload, "--root", cli.root, "--json"]);
  const cliResult = JSON.parse(output.stdout);
  const served = await serveWorkspace(browser.root, { port: 0, allowNonAuthoritativeWrites: true });
  context.after(() => new Promise((resolve, reject) => served.server.close((error) => error ? reject(error) : resolve())));
  const response = await fetch(`${served.url}/api/obligation-completions`, { method: "POST",
    headers: { "content-type": "application/json", origin: served.url },
    body: JSON.stringify({ obligationId: browser.obligation.id, record: browser.record, revision: browser.revision }) });
  const browserResult = await response.json();
  assert.equal(response.status, 201, JSON.stringify(browserResult));
  assert.equal(cliResult.linked.status, browserResult.linked.status);
  assert.deepEqual(cliResult.linked.members, browserResult.linked.members);
  assert.deepEqual(cliResult.created, browserResult.created);
});

test("completion binds the scaffolded rule and occurrence and rolls back invalid Markdown", async (context) => {
  const f = await fixture(context);
  const scaffold = await scaffoldObligationCompletion(f.root, { obligationId: f.obligation.id,
    windowStart: "2026-07-05", completedOn: "2026-07-07" });
  await writeJson(f.ruleEntry.path, { ...f.rule, title: "Changed adopted rule" });
  await assert.rejects(completeObligationOccurrence(f.root, { obligationId: f.obligation.id,
    expectedRevision: f.revision, completionContext: scaffold.completionContext, record: f.record }), /governing rule changed/);
  await writeJson(f.ruleEntry.path, f.rule);
  await assert.rejects(completeObligationOccurrence(f.root, { obligationId: f.obligation.id,
    expectedRevision: f.revision, record: f.record, content: { unknownSlot: "Invalid" } }), /Markdown/);
  const loaded = await loadWorkspace(f.root);
  assert.equal(loaded.resources.some(({ id }) => id === f.record.id), false);
  assert.equal(loaded.resources.some(({ type }) => type === "obligation-occurrence"), false);
});

test("same-day fixed-population completion and identical content retries preserve actual proof", async (context) => {
  const f = await fixture(context);
  const record = { ...f.record, completedAt: "2026-07-05T15:30:00Z", reviewedOn: "2026-07-05" };
  const loaded = await loadWorkspace(f.root);
  const evidence = loaded.entries.find(({ record }) => record.type === "evidence");
  await writeJson(evidence.path, { ...evidence.record, collectedOn: "2026-07-05", verifiedOn: "2026-07-05" });
  const scaffold = await scaffoldObligationCompletion(f.root, { obligationId: f.obligation.id,
    windowStart: "2026-07-05", completedOn: "2026-07-05" });
  const options = { obligationId: f.obligation.id, expectedRevision: f.revision,
    completionContext: scaffold.completionContext, record, content: { record: "Actual endpoint inspection.\n" } };
  const result = await completeObligationOccurrence(f.root, options);
  assert.equal(result.linked.status, "reconciled");
  assert.deepEqual(await completeObligationOccurrence(f.root, options), result);
  await assert.rejects(completeObligationOccurrence(f.root, { ...options, content: { record: "Changed account" } }), /different content/);
});

test("later governing policy activation clips the initial completion window", async (context) => {
  const f = await fixture(context);
  const loaded = await loadWorkspace(f.root);
  const policy = loaded.entries.find(({ record }) => record.id === f.obligation.policyIds[0]);
  await writeJson(policy.path, { ...policy.record, effectiveOn: "2026-07-10" });
  const record = { ...f.record, completedAt: "2026-07-12T15:30:00Z", reviewedOn: "2026-07-12" };
  const result = await completeObligationOccurrence(f.root, { obligationId: f.obligation.id,
    expectedRevision: f.revision, record });
  assert.equal(result.linked.coverage.startsOn, "2026-07-10");
  const validation = await validateWorkspace(f.root);
  assert.equal(validation.diagnostics.some(({ code }) => code === "invalid-obligation-occurrence-schedule-binding"), false);
});

test("finalized proof stays valid after evidence expires later", async (context) => {
  const f = await fixture(context);
  await completeObligationOccurrence(f.root, { obligationId: f.obligation.id,
    expectedRevision: f.revision, record: f.record, now: "2026-07-08T15:30:00Z" });
  const loaded = await loadWorkspace(f.root);
  const evidence = loaded.entries.find(({ record }) => record.type === "evidence");
  await writeJson(evidence.path, { ...evidence.record, expiresOn: "2026-08-01" });
  const validation = await validateWorkspace(f.root);
  assert.equal(validation.diagnostics.some(({ code }) => code === "missing-passing-member-completion"), false);
  const current = await loadWorkspace(f.root);
  const item = planObligations(current.resources, { model: current.model, asOf: "2026-10-14",
    from: "2026-07-05", through: "2026-07-05", includeComplete: true }).calendarItems[0];
  assert.equal(item.status, "complete");
});

test("separate fixed-member completions do not invent a whole-population review", async (context) => {
  const f = await fixture(context);
  await writeJson(f.obligationEntry.path, { ...f.obligation, scopeResourceIds: ["system-example", "asset-example"] });
  const revision = contentRevision(await readFile(f.obligationEntry.path, "utf8"));
  const first = await completeObligationOccurrence(f.root, { obligationId: f.obligation.id,
    expectedRevision: revision, record: f.record });
  assert.equal(first.linked.status, "open");
  const second = await completeObligationOccurrence(f.root, { obligationId: f.obligation.id,
    expectedRevision: revision, record: { ...f.record, id: "control-activity-second-member", scopeResourceIds: ["asset-example"] } });
  assert.equal(second.linked.completedCount, 2);
  assert.equal(second.linked.status, "open");
  assert.equal(second.linked.reviewedByIds, undefined);
  assert.equal(second.linked.reconciledAt, undefined);
});
