import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { nativeReviewFixture } from "./fixtures/native-review-occurrence.js";
import { executeCli, initializeGitWorkspace, writeJson } from "./helpers.js";
import { runCli } from "../src/cli.js";
import { contentRevision } from "../src/files.js";
import { completeObligationOccurrence, loadWorkspace, planObligations, scaffoldObligationOccurrence, saveObligationOccurrence, validateWorkspace } from "../src/index.js";
import { assessCompletionForObligation } from "../src/obligations.js";

async function fixture(t, activity) {
  const root = await mkdtemp(join(tmpdir(), "filegrc-native-review-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return nativeReviewFixture(root, activity);
}
const scaffold = (f) => scaffoldObligationOccurrence(f.root, { obligationId: f.obligation.id, windowStart: "2026-07-05", asOf: "2026-07-07" });
const complete = async (f, record = f.review) => completeObligationOccurrence(f.root, { obligationId: f.obligation.id, windowStart: "2026-07-05", record,
  expectedRevision: contentRevision(await readFile(f.obligationEntry.path, "utf8")), now: "2026-07-07T18:00:00Z" });

for (const activity of ["policy-review", "meeting", "oversight-meeting", "risk-assessment", "vendor-review", "access-review"]) {
  test(`${activity} links its native typed population through CLI and reuses unchanged proof`, async (t) => {
    const f = await fixture(t, activity);
    const before = await readFile(f.reviewEntry.path, "utf8");
    const policyBefore = await readFile(join(f.root, "data/policies/policy-example.json"), "utf8");
    const payload = await scaffold(f);
    assert.deepEqual(payload.record.members.map(({ resourceId }) => resourceId).sort(), [...f.obligation.scopeResourceIds].sort());
    assert.ok(payload.record.members.every(({ result, completionResourceIds }) => result === "passed" && completionResourceIds.includes(f.review.id)));
    const path = join(f.root, "completion.json");
    await writeJson(path, { record: f.review, revision: contentRevision(await readFile(f.obligationEntry.path, "utf8")) });
    await executeCli(runCli, process.execPath, [new URL("../bin/filegrc.js", import.meta.url).pathname, "complete", f.obligation.id, path, "--root", f.root, "--json"]);
    const first = await complete(f);
    const second = await complete(f);
    assert.deepEqual(second.linked, first.linked);
    assert.equal(await readFile(f.reviewEntry.path, "utf8"), before);
    assert.equal(await readFile(join(f.root, "data/policies/policy-example.json"), "utf8"), policyBefore);
    const loaded = await loadWorkspace(f.root);
    const item = planObligations(loaded.resources, { root: f.root, model: loaded.model, asOf: "2026-07-07", through: "2026-07-07", includeComplete: true }).calendarItems.find(({ obligationId }) => obligationId === f.obligation.id);
    // Meetings have chairs, rather than an occurrence reviewer, so reconciliation remains explicit.
    if (activity.includes("meeting")) assert.equal(first.linked.status, "open");
    else assert.equal(item.status, "complete");
    assert.deepEqual((await validateWorkspace(f.root)).diagnostics.filter(({ code }) => /occurrence|member|population|policy-review/.test(code)), []);
  });
}

test("Policy review rejects failed, unfinished, unproved, unrelated and ineligible execution without partial writes", async (t) => {
  const f = await fixture(t);
  const loaded = await loadWorkspace(f.root);
  const window = { dueWindowStart: "2026-07-05", dueWindowEnd: "2026-07-21" };
  const variants = [
    { ...f.review, outcome: "failed" },
    { ...f.review, status: "in-progress", outcome: undefined, completedOn: undefined },
    { ...f.review, reviewerIds: [] },
    { ...f.review, evidenceIds: [] },
    { ...f.review, evidenceIds: ["missing-proof"] },
    { ...f.review, scopeResourceIds: ["policy-other"] },
    { ...f.review, completedOn: "2026-07-04" },
    { ...f.review, completedOn: "2027-07-08" },
    { ...f.review, completedOn: "2026-07-22" }
  ];
  for (const [index, record] of variants.entries()) {
    assert.equal(assessCompletionForObligation(record, f.obligation, loaded, { memberIds: f.obligation.scopeResourceIds, window, asOf: "2026-07-07" }).complete, false, String(index));
    // New proof exercises the atomic create-and-link path, not the existing-record mismatch guard.
    await assert.rejects(complete(f, { ...record, id: `policy-review-invalid-${index}` }));
    const current = await loadWorkspace(f.root);
    assert.equal(current.resources.some(({ id }) => id === `policy-review-invalid-${index}`), false);
    assert.equal(current.resources.some(({ type }) => type === "obligation-occurrence"), false);
  }
});

test("completion windows use actual execution rather than coverage and preserve later-period work", async (t) => {
  const f = await fixture(t);
  await writeJson(f.reviewEntry.path, { ...f.review, completedOn: "2026-06-30", coverage: { kind: "as-of", on: "2026-07-07" } });
  assert.ok((await scaffold(f)).record.members.every(({ result }) => result === "pending"));
  await writeJson(f.reviewEntry.path, { ...f.review, coverage: { kind: "as-of", on: "2026-06-30" } });
  assert.ok((await scaffold(f)).record.members.every(({ result }) => result === "passed"));
  const loaded = await loadWorkspace(f.root);
  const later = planObligations(loaded.resources, { model: loaded.model, asOf: "2026-08-01", from: "2026-08-01", through: "2026-08-01", includeComplete: true }).calendarItems.find(({ obligationId }) => obligationId === f.obligation.id);
  assert.equal(later.completedCount, 0);
});

test("finalized Policy review retains its frozen authored population and approval separation", async (t) => {
  const f = await fixture(t);
  await complete(f);
  await initializeGitWorkspace(f.root);
  await writeJson(f.obligationEntry.path, { ...f.obligation, scopeResourceIds: [...f.obligation.scopeResourceIds, "document-later"] });
  const loaded = await loadWorkspace(f.root);
  const doc = loaded.resources.find(({ type }) => type === "document");
  await writeJson(join(f.root, "data/documents/document-later.json"), { ...doc, id: "document-later", status: "draft", approverIds: [], approvedOn: undefined, approvedRevision: undefined, effectiveOn: undefined, activatedOn: undefined, activatedByIds: undefined, activationRevision: undefined, activationBasis: undefined });
  const current = await loadWorkspace(f.root);
  const occurrence = current.resources.find(({ type }) => type === "obligation-occurrence");
  assert.deepEqual(occurrence.members.map(({ resourceId }) => resourceId).sort(), [...f.obligation.scopeResourceIds].sort());
  assert.deepEqual((await validateWorkspace(f.root)).diagnostics.filter(({ code }) => /occurrence|member|population/.test(code)), []);
});

test("native scoped completions reject missing actors, incomplete work and future review or execution", async (t) => {
  for (const activity of ["policy-review", "meeting", "risk-assessment", "vendor-review", "access-review"]) {
    const f = await fixture(t, activity), loaded = await loadWorkspace(f.root);
    const spec = loaded.model.operatingPreparation.completionRecords[f.review.type];
    const variants = [{ ...f.review, status: "planned" }, { ...f.review, evidenceIds: ["missing-proof"] }];
    variants.push({ ...f.review, [spec.executionDateField]: spec.executionDateField === "endedAt" ? "2026-07-08T13:00:00Z" : "2026-07-08" });
    if (spec.reviewDateField) variants.push({ ...f.review, [spec.reviewDateField]: "2026-07-08" });
    if (spec.resultField) variants.push({ ...f.review, [spec.resultField]: activity === "vendor-review" ? "rejected" : "failed" });
    for (const record of variants) assert.equal(assessCompletionForObligation(record, f.obligation, loaded, { memberIds: f.obligation.scopeResourceIds, asOf: "2026-07-07" }).complete, false, activity);
  }
});

test("an unchanged existing Policy review links atomically while altered content and false passing links are rejected", async (t) => {
  const f = await fixture(t), before = await readFile(f.reviewEntry.path, "utf8");
  await assert.rejects(complete(f, { ...f.review, changesRequired: true }), /different content/);
  await writeJson(f.reviewEntry.path, { ...f.review, outcome: "failed" });
  const payload = await scaffold(f);
  assert.ok(payload.record.members.every(({ result }) => result === "failed"));
  const record = { ...payload.record, status: "reconciled", conclusion: "complete", completedCount: 2,
    reviewedByIds: ["person-example"], reconciledAt: "2026-07-07T18:00:00Z",
    members: payload.record.members.map((member) => ({ ...member, result: "passed" })) };
  await assert.rejects(saveObligationOccurrence(f.root, { record }), /completion|passed|outcome/i);
  assert.equal((await loadWorkspace(f.root)).resources.some(({ type }) => type === "obligation-occurrence"), false);
  await writeJson(f.reviewEntry.path, JSON.parse(before));
  await complete(f);
  assert.equal(await readFile(f.reviewEntry.path, "utf8"), before);
});

test("review completed after execution can link the original allowed window and retry unchanged", async (t) => {
  for (const activity of ["risk-assessment", "access-review"]) {
    const f = await fixture(t, activity);
    f.review.approvedOn = "2026-07-08";
    await writeJson(f.reviewEntry.path, f.review);
    const before = await readFile(f.reviewEntry.path, "utf8");
    const options = { obligationId: f.obligation.id, windowStart: "2026-07-05", record: f.review,
      expectedRevision: contentRevision(await readFile(f.obligationEntry.path, "utf8")), now: "2026-07-09T18:00:00Z" };
    const first = await completeObligationOccurrence(f.root, options);
    assert.equal(first.linked.status, "reconciled", activity);
    assert.equal(first.linked.completedCount, f.obligation.scopeResourceIds.length);
    assert.ok(first.linked.members.every(({ result }) => result === "passed"));
    assert.deepEqual((await completeObligationOccurrence(f.root, options)).linked, first.linked);
    assert.equal(await readFile(f.reviewEntry.path, "utf8"), before);
  }
});
