import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { makeRetentionApplicationWorkspace } from "./fixtures/retention-applications.js";
import { commitWorkspaceFiles, writeJson } from "./helpers.js";
import { loadWorkspace } from "../src/workspace.js";
import { reviewHistoryContext } from "../src/historical-workspace.js";
import { currentCalendarDate } from "../src/time.js";
import { calculateRevision } from "../src/revisions.js";
import { assessCollectionReview, retentionScheduleIsAuthoritative } from "../src/collection-review.js";
import { resourceReviewRevisionsSync, retentionReviewResourceIds } from "../src/retention.js";
import { collectionRevision } from "../src/collection-revision.js";
import { operatingRetentionScheduleWorkspace } from "../src/retention-schedule-approval.js";

async function fixture(context) {
  const root = await mkdtemp(join(tmpdir(), "filegrc-retention-baseline-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeRetentionApplicationWorkspace(root);
  let loaded = await loadWorkspace(root);
  const schedule = loaded.entries.find(({ record }) => record.type === "document" && record.documentKind === "schedule");
  const today = currentCalendarDate(loaded.workspace.timezone);
  await writeJson(schedule.path, { ...schedule.record, status: "active", activationBasis: "recorded", activatedOn: today,
    effectiveOn: today, activatedByIds: ["person-example"], activatedContentRevisions: schedule.record.approvedContentRevisions });
  await commitWorkspaceFiles(root, "Activate reviewed retention schedule");
  loaded = await loadWorkspace(root);
  assert.equal(retentionScheduleIsAuthoritative(loaded, loaded.resources.find(({ type }) => type === "program")), true);
  return { root, loaded, today };
}

test("pending schedule and row successors preserve the exact operating schedule authority", async (context) => {
  const { root, loaded, today } = await fixture(context);
  const schedule = loaded.entries.find(({ record }) => record.type === "document" && record.documentKind === "schedule");
  const row = loaded.entries.find(({ record }) => record.type === "retention-schedule-item");
  const successorPath = join(root, "data/documents/document-retention-successor.json");
  const proposed = { ...schedule.record, id: "document-retention-successor", title: "Next retention schedule", status: "draft", supersedesId: schedule.record.id };
  await writeJson(successorPath, proposed);
  const rowPath = join(dirname(row.path), "retention-proposal.json");
  await writeJson(rowPath, { ...row.record, id: "retention-proposal", status: "planned", scheduleDocumentId: proposed.id });
  for (const status of ["draft", "approved"]) {
    await writeJson(successorPath, { ...proposed, status });
    const current = await loadWorkspace(root);
    const program = current.resources.find(({ type }) => type === "program");
    assert.equal(assessCollectionReview(current, "retention-schedule-item").complete, false, "successor review work stays visible");
    assert.equal(retentionScheduleIsAuthoritative(current, program), true);
    const operational = operatingRetentionScheduleWorkspace(current);
    assert.deepEqual(operational.resources.filter(({ type }) => type === "retention-schedule-item").map(({ id }) => id), [row.record.id]);
  }
  await writeJson(row.path, { ...row.record, retentionPeriod: { basis: "fixed", amount: 9, unit: "year" } });
  let current = await loadWorkspace(root);
  assert.equal(retentionScheduleIsAuthoritative(current, current.resources.find(({ type }) => type === "program")), false, "actual changed active row must retain its approval gap");
  await writeJson(row.path, { ...row.record, scheduleDocumentId: proposed.id });
  current = await loadWorkspace(root);
  assert.equal(retentionScheduleIsAuthoritative(current, current.resources.find(({ type }) => type === "program")), false, "changing an active row's schedule link cannot reuse its prior approval");
  await writeJson(row.path, row.record);
  await writeFile(schedule.path.replace(/\.json$/, ".md"), "# Unapproved retention change\n\nDelete all retained proof after one day without checking holds.\n");
  current = await loadWorkspace(root);
  assert.equal(retentionScheduleIsAuthoritative(current, current.resources.find(({ type }) => type === "program")), false, "stale active schedule content cannot support the proposal");
});

test("retention source review uses the proven same-ID operating revision until actual cutover", async (context) => {
  const { root, loaded, today } = await fixture(context);
  const source = loaded.entries.find(({ record }) => record.type === "policy");
  const before = resourceReviewRevisionsSync(loaded, [source.record.id]).get(source.record.id);
  const markdownPath = source.path.replace(/\.json$/, ".md");
  const body = `${await readFile(markdownPath, "utf8")}\nA proposed new retention duty requires management review before adoption.\n`;
  await writeFile(markdownPath, body);
  const approved = { ...source.record, status: "approved", approvedOn: today,
    approvedContentRevisions: { [`policies/${source.record.id}.md`]: calculateRevision("content", body) } };
  await writeJson(source.path, approved);
  await commitWorkspaceFiles(root, "Approve proposed policy revision");
  let current = await loadWorkspace(root);
  assert.equal(resourceReviewRevisionsSync(current, [source.record.id]).get(source.record.id), before);
  const fallback = await loadWorkspace(root);
  const history = reviewHistoryContext(root, fallback);
  history.index = null;
  history.statesByCommit.clear(); history.workspacesByCommit.clear();
  assert.equal(resourceReviewRevisionsSync(fallback, [source.record.id]).get(source.record.id), before,
    "history index fallback reads the committed operating Markdown, not the current proposal");
  await writeJson(source.path, { ...approved, status: "active", effectiveOn: today });
  current = await loadWorkspace(root);
  const adoptedRevision = resourceReviewRevisionsSync(current, [source.record.id]).get(source.record.id);
  assert.notEqual(adoptedRevision, before);
  await commitWorkspaceFiles(root, "Activate reviewed policy revision");
  await writeJson(source.path, { ...approved, status: "retired", effectiveOn: today,
    statusTransition: { changedOn: today, changedByIds: ["person-example"], reason: "Policy was withdrawn." } });
  await commitWorkspaceFiles(root, "Retire policy revision");
  const laterBody = `${body}\nA later proposed replacement needs its own operational cutover.\n`;
  await writeFile(markdownPath, laterBody);
  await writeJson(source.path, { ...approved, approvedContentRevisions: { [`policies/${source.record.id}.md`]: calculateRevision("content", laterBody) } });
  current = await loadWorkspace(root);
  assert.notEqual(resourceReviewRevisionsSync(current, [source.record.id]).get(source.record.id), adoptedRevision, "a retired baseline cannot be restored by a later approval");
});

test("actual schedule cutover needs its own exact row approval and selects only the effective schedule", async (context) => {
  const { root, loaded, today } = await fixture(context);
  const schedule = loaded.entries.find(({ record }) => record.type === "document" && record.documentKind === "schedule");
  const row = loaded.entries.find(({ record }) => record.type === "retention-schedule-item");
  const review = loaded.entries.find(({ record }) => record.type === "collection-review" && record.resourceType === "retention-schedule-item" && record.status === "active");
  const next = { ...schedule.record, id: "document-retention-next", supersedesId: schedule.record.id };
  const body = await readFile(schedule.path.replace(/\.json$/, ".md"), "utf8");
  const bindings = { [`documents/${next.id}.md`]: calculateRevision("content", body) };
  next.approvedContentRevisions = bindings;
  next.activatedContentRevisions = bindings;
  await writeJson(join(dirname(schedule.path), `${next.id}.json`), next);
  await writeFile(join(dirname(schedule.path), `${next.id}.md`), body);
  await writeJson(schedule.path, { ...schedule.record, status: "superseded", statusTransition: { changedOn: today, changedByIds: ["person-example"], reason: "Successor took effect." } });
  await writeJson(row.path, { ...row.record, status: "retired" });
  const nextRow = { ...row.record, id: "retention-schedule-item-next", scheduleDocumentId: next.id };
  const nextRowPath = join(dirname(row.path), `${nextRow.id}.json`);
  await writeJson(nextRowPath, nextRow);
  let current = await loadWorkspace(root);
  nextRow.reviewedSourceRevisions = Object.fromEntries(resourceReviewRevisionsSync(current, retentionReviewResourceIds(nextRow, current), "legacy", false, null, nextRow));
  await writeJson(nextRowPath, nextRow);
  current = await loadWorkspace(root);
  const program = current.resources.find(({ type }) => type === "program");
  assert.equal(retentionScheduleIsAuthoritative(current, program), false, "activation alone cannot approve new retention rows");
  await writeJson(review.path, { ...review.record, status: "retired" });
  current = await loadWorkspace(root);
  const approved = { ...review.record, id: "collection-review-retention-next", supersedesId: review.record.id,
    populationResourceIds: [nextRow.id], collectionRevision: collectionRevision(current, "retention-schedule-item", { programId: program.id }) };
  await writeJson(join(dirname(review.path), `${approved.id}.json`), approved);
  current = await loadWorkspace(root);
  const projected = operatingRetentionScheduleWorkspace(current);
  assert.deepEqual(projected.resources.filter((record) => record.type === "document" && record.documentKind === "schedule").map(({ id }) => id), [next.id]);
  const assessment = assessCollectionReview(projected, "retention-schedule-item");
  assert.equal(assessment.complete, true, assessment.message);
  assert.equal(retentionScheduleIsAuthoritative(current, program), true);
});
