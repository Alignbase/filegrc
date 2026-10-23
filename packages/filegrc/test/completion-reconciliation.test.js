import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { makeComprehensiveWorkspace } from "./fixtures.js";
import { executeCli, initializeGitWorkspace, writeJson } from "./helpers.js";
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
  const scaffold = await scaffoldObligationCompletion(f.root, { obligationId: f.obligation.id,
    windowStart: "2026-07-05", completedOn: "2026-07-07" });
  const options = { obligationId: f.obligation.id, expectedRevision: revision,
    completionContext: scaffold.completionContext, record: f.record };
  const first = await completeObligationOccurrence(f.root, options);
  assert.equal(first.linked.status, "open");
  assert.deepEqual(await completeObligationOccurrence(f.root, options), first);
  const second = await completeObligationOccurrence(f.root, { obligationId: f.obligation.id,
    expectedRevision: revision, record: { ...f.record, id: "control-activity-second-member", scopeResourceIds: ["asset-example"] } });
  assert.equal(second.linked.completedCount, 2);
  assert.equal(second.linked.status, "open");
  assert.equal(second.linked.reviewedByIds, undefined);
  assert.equal(second.linked.reconciledAt, undefined);
});


test("a completion outside the fixed population creates no orphan proof record", async (context) => {
  const f = await fixture(context);
  await writeJson(f.obligationEntry.path, { ...f.obligation, scopeResourceIds: ["asset-example"] });
  const revision = contentRevision(await readFile(f.obligationEntry.path, "utf8"));
  await assert.rejects(completeObligationOccurrence(f.root, { obligationId: f.obligation.id,
    expectedRevision: revision, record: { ...f.record, evidenceIds: [] } }), /does not cover any member/);
  const loaded = await loadWorkspace(f.root);
  assert.equal(loaded.resources.some(({ id }) => id === f.record.id), false);
  assert.equal(loaded.resources.some(({ type }) => type === "obligation-occurrence"), false);
});

test("dynamic membership stays open and identical retries preserve its pending reconciliation", async (context) => {
  const f = await fixture(context);
  const loaded = await loadWorkspace(f.root);
  const { currentCalendarDate } = await import("../src/time.js");
  const now = new Date();
  const date = currentCalendarDate(loaded.workspace.timezone, now);
  await writeJson(f.ruleEntry.path, { ...f.rule,
    recurrence: { mode: "calendar", unit: "month", interval: 1, anchorMode: "activation" },
    window: { precision: "date", startsAfter: 0, dueAfter: 5 }, effectiveAt: now.toISOString(),
    selector: { resourceType: "asset", membershipMode: "as-of", cutoff: "window-end", statuses: ["active"] }
  });
  const scaffold = await scaffoldObligationCompletion(f.root, { obligationId: f.obligation.id,
    windowStart: date, completedOn: date });
  const record = { ...f.record, scopeResourceIds: ["asset-example"], completedAt: now.toISOString(), reviewedOn: date };
  const options = { obligationId: f.obligation.id, expectedRevision: f.revision,
    completionContext: scaffold.completionContext, record };
  const result = await completeObligationOccurrence(f.root, options);
  assert.equal(result.linked.status, "open");
  assert.equal(result.linked.completedCount, 1);
  assert.equal(result.linked.reviewedByIds, undefined);
  assert.deepEqual(await completeObligationOccurrence(f.root, options), result);
});


test("frozen original windows survive later governed-content cutover dates", async (context) => {
  const f = await fixture(context);
  await writeJson(f.ruleEntry.path, { ...f.rule, effectiveAt: "2026-07-01T00:00:00-05:00" });
  const result = await completeObligationOccurrence(f.root, { obligationId: f.obligation.id,
    expectedRevision: f.revision, record: f.record });
  assert.equal(result.linked.coverage.startsOn, "2026-07-01");
  const loaded = await loadWorkspace(f.root);
  const policy = loaded.entries.find(({ record }) => record.id === f.obligation.policyIds[0]);
  await writeJson(policy.path, { ...policy.record, effectiveOn: "2026-07-05" });
  const validation = await validateWorkspace(f.root);
  assert.equal(validation.diagnostics.some(({ code }) => code === "invalid-obligation-occurrence-schedule-binding"), false);
  const current = await loadWorkspace(f.root);
  const items = planObligations(current.resources, { model: current.model, asOf: "2026-07-07",
    through: "2026-07-07", includeComplete: true }).calendarItems;
  assert.equal(items.length, 1);
  assert.equal(items[0].dueWindowStart, "2026-07-01");
});

test("committed partial windows survive later content activation without duplicating their cycle", async (context) => {
  const f = await fixture(context);
  const result = await completeObligationOccurrence(f.root, { obligationId: f.obligation.id,
    expectedRevision: f.revision, record: f.record });
  assert.equal(result.linked.coverage.startsOn, "2026-07-05");
  await initializeGitWorkspace(f.root, "Retain the frozen initial partial window");
  const loaded = await loadWorkspace(f.root);
  const policy = loaded.entries.find(({ record }) => record.id === f.obligation.policyIds[0]);
  await writeJson(policy.path, { ...policy.record, effectiveOn: "2026-07-10" });
  const validation = await validateWorkspace(f.root);
  assert.equal(validation.diagnostics.some(({ code }) => code === "invalid-obligation-occurrence-schedule-binding"), false);
  const current = await loadWorkspace(f.root);
  const items = planObligations(current.resources, { model: current.model, asOf: "2026-07-12",
    through: "2026-07-12", includeComplete: true }).calendarItems;
  assert.equal(items.length, 1);
  assert.equal(items[0].dueWindowStart, "2026-07-05");
});

test("closed committed partial windows survive later content cutovers without accepting edited dates", async (context) => {
  const f = await fixture(context);
  const result = await completeObligationOccurrence(f.root, { obligationId: f.obligation.id,
    expectedRevision: f.revision, record: f.record });
  assert.deepEqual(result.linked.coverage, { kind: "range", startsOn: "2026-07-05", endsOn: "2026-07-21" });
  const loaded = await loadWorkspace(f.root);
  const policy = loaded.entries.find(({ record }) => record.id === f.obligation.policyIds[0]);
  await writeJson(policy.path, { ...policy.record, effectiveOn: "2026-08-10" });
  let validation = await validateWorkspace(f.root);
  assert.ok(validation.diagnostics.some(({ code }) => code === "invalid-obligation-occurrence-schedule-binding"), "Uncommitted dates cannot establish a historical window");
  await writeJson(policy.path, policy.record);
  await initializeGitWorkspace(f.root, "Retain the completed initial partial window");
  await writeJson(policy.path, { ...policy.record, effectiveOn: "2026-08-10" });
  validation = await validateWorkspace(f.root);
  assert.equal(validation.diagnostics.some(({ code }) => code === "invalid-obligation-occurrence-schedule-binding"), false);
  const current = await loadWorkspace(f.root);
  const occurrence = current.entries.find(({ record }) => record.id === result.linked.id);
  assert.deepEqual(occurrence.record, result.linked, "Activation preserves all frozen occurrence facts");
  await writeJson(occurrence.path, { ...occurrence.record, coverage: { ...occurrence.record.coverage, startsOn: "2026-07-06" } });
  validation = await validateWorkspace(f.root);
  assert.ok(validation.diagnostics.some(({ code }) => code === "invalid-obligation-occurrence-schedule-binding"), "An edited historical start remains invalid");
});

test("CLI and browser retain the selected Program when multiple Programs are active", async (context) => {
  const cli = await fixture(context);
  const browser = await fixture(context);
  for (const f of [cli, browser]) {
    const loaded = await loadWorkspace(f.root);
    const primary = loaded.resources.find(({ type }) => type === "program");
    await writeJson(join(f.root, "data", loaded.model.resources.program.collection, "program-other.json"), {
      ...primary, id: "program-other", title: "Other SOC 2 Program"
    });
  }
  const payload = join(cli.root, "completion.json");
  await writeFile(payload, JSON.stringify({ record: cli.record, revision: cli.revision }));
  const output = await executeCli(runCli, process.execPath, [new URL("../bin/filegrc.js", import.meta.url).pathname,
    "complete", cli.obligation.id, payload, "--root", cli.root, "--program", "program-example", "--json"]);
  const cliResult = JSON.parse(output.stdout);
  assert.equal(cliResult.linked.programId, "program-example");
  const served = await serveWorkspace(browser.root, { port: 0, allowNonAuthoritativeWrites: true });
  context.after(() => new Promise((resolve, reject) => served.server.close((error) => error ? reject(error) : resolve())));
  const response = await fetch(`${served.url}/api/obligation-completions?programId=program-example`, { method: "POST",
    headers: { "content-type": "application/json", origin: served.url },
    body: JSON.stringify({ obligationId: browser.obligation.id, record: browser.record, revision: browser.revision }) });
  const browserResult = await response.json();
  assert.equal(response.status, 201, JSON.stringify(browserResult));
  assert.equal(browserResult.linked.programId, cliResult.linked.programId);
  assert.deepEqual(browserResult.linked.members, cliResult.linked.members);
});

test("completion preserves exclusions and the authoritative expected-member count", async (context) => {
  const f = await fixture(context);
  await writeJson(f.obligationEntry.path, { ...f.obligation, scopeResourceIds: ["system-example", "asset-example"] });
  const revision = contentRevision(await readFile(f.obligationEntry.path, "utf8"));
  const first = await completeObligationOccurrence(f.root, { obligationId: f.obligation.id,
    expectedRevision: revision, record: f.record });
  const loaded = await loadWorkspace(f.root);
  const occurrence = loaded.entries.find(({ record }) => record.id === first.linked.id);
  await writeJson(occurrence.path, { ...occurrence.record,
    expectedCount: 1,
    members: occurrence.record.members.map((member) => member.resourceId === "asset-example"
      ? { ...member, disposition: "not-applicable", rationale: "The documented review excludes this asset from the operating check." }
      : member)
  });
  const result = await completeObligationOccurrence(f.root, { obligationId: f.obligation.id,
    expectedRevision: revision, record: { ...f.record, id: "control-activity-confirmation", completedAt: "2026-07-08T15:30:00Z", reviewedOn: "2026-07-08" } });
  assert.equal(result.linked.status, "open");
  assert.equal(result.linked.expectedCount, 1);
  assert.equal(result.linked.completedCount, 1);
  assert.equal(result.linked.members.find(({ resourceId }) => resourceId === "asset-example").disposition, "not-applicable");
  assert.equal(result.linked.reviewedByIds, undefined);
});

test("CLI reconciliation consumes create, update, and supersession scaffolds with revision protection", async (context) => {
  const f = await fixture(context);
  const proof = join(f.root, "data", "control-activities", `${f.record.id}.json`);
  await writeJson(proof, f.record);
  const args = [new URL("../bin/filegrc.js", import.meta.url).pathname];
  const cli = async (...command) => executeCli(runCli, process.execPath, [...args, ...command, "--root", f.root, "--json"]);
  const payload = join(f.root, "reconciliation.json");
  const scaffold = JSON.parse((await cli("reconcile-obligation", f.obligation.id, "--scaffold", "--window-start", "2026-07-05", "--as-of", "2026-07-07")).stdout);
  assert.equal(scaffold.operation, "create");
  assert.equal(scaffold.revision, null);
  await writeJson(payload, scaffold);
  await cli("reconcile-obligation", f.obligation.id, payload);
  const update = JSON.parse((await cli("reconcile-obligation", f.obligation.id, "--scaffold", "--window-start", "2026-07-05")).stdout);
  assert.equal(update.operation, "update");
  assert.equal(typeof update.revision, "string");
  await writeJson(payload, { ...update, revision: null });
  await assert.rejects(cli("reconcile-obligation", f.obligation.id, payload), /revision.*required/);
  await writeJson(payload, { ...update, revision: "stale" });
  await assert.rejects(cli("reconcile-obligation", f.obligation.id, payload), /changed/);
  update.record = { ...update.record, status: "reconciled", conclusion: "complete", reviewedByIds: ["person-example"], reconciledAt: "2026-07-07T16:30:00Z" };
  await writeJson(payload, update);
  await cli("reconcile-obligation", f.obligation.id, payload);
  const correction = JSON.parse((await cli("reconcile-obligation", f.obligation.id, "--scaffold", "--window-start", "2026-07-05", "--correct-finalized")).stdout);
  assert.equal(correction.operation, "supersede");
  await writeJson(payload, { ...correction, revision: null });
  await assert.rejects(cli("reconcile-obligation", f.obligation.id, payload), /revision.*required/);
  await writeJson(payload, { ...correction, revision: "stale" });
  await assert.rejects(cli("reconcile-obligation", f.obligation.id, payload), /changed/);
  await writeJson(payload, correction);
  await cli("reconcile-obligation", f.obligation.id, payload);
});
