import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { loadWorkspace } from "../src/workspace.js";
import { reviewHistoryContext, reviewHistoricalWorkspace } from "../src/historical-workspace.js";
import { calculateRevision } from "../src/revisions.js";
import { markdownEntries } from "../src/resource-markdown.js";
import { loadModel } from "../model/index.js";
import { writeJson, initializeGitWorkspace, commitWorkspaceFiles } from "./helpers.js";
import { governedContentBaseline, governedContentCoversPeriod, governedContentSource,
  governedMarkdownSource, governedApprovalContentMatches, pendingGovernedSuccessor,
  registerGovernedLookup } from "../src/governed-content-baseline.js";

const oldBody = "# Operating procedure\n\nReview access every month and retain the completed review.\n";
const newBody = "# Proposed procedure\n\nReview access every week and retain the completed review.\n";
async function fixture(t, type = "policy") {
  const root = await mkdtemp(join(tmpdir(), "filegrc-same-id-baseline-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const model = loadModel("13");
  const record = { id: `${type}-example`, type, title: "Operating content", status: "active",
    ownerIds: ["person-owner"], approverIds: ["person-reviewer"], approvedOn: "2026-01-01",
    effectiveOn: "2026-01-02", controlIds: ["control-example"],
    ...(type === "document" ? { workflowScope: "program", documentKind: "procedure" } : {}) };
  const path = markdownEntries(model, record)[0].path;
  const bindings = { [path]: calculateRevision("content", oldBody) };
  record.approvedContentRevisions = bindings;
  if (type !== "policy") Object.assign(record, { activationBasis: "recorded", activatedOn: "2026-01-02",
    activatedByIds: ["person-owner"], activatedContentRevisions: bindings });
  const jsonPath = join(root, "data", path.replace(/\.md$/, ".json"));
  await mkdir(join(root, "data", path.split("/")[0]), { recursive: true });
  await mkdir(join(root, "data/people"));
  await writeJson(join(root, "data/workspace.json"), { id: "workspace", type: "workspace", dataModelVersion: "13", timezone: "UTC" });
  for (const id of ["person-owner", "person-reviewer"]) await writeJson(join(root, `data/people/${id}.json`), { id, type: "person", status: "active" });
  await writeJson(jsonPath, record);
  await writeFile(join(root, "data", path), oldBody);
  await initializeGitWorkspace(root);
  const originalCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  async function current(fallback = false) {
    const loaded = await loadWorkspace(root);
    if (fallback) reviewHistoryContext(loaded.root, loaded).index = null;
    const byId = registerGovernedLookup(new Map(loaded.resources.map((item) => [item.id, item])), loaded);
    return { loaded, byId, source: byId.get(record.id) };
  }
  async function change(next, body = newBody, commit = false) {
    await writeJson(jsonPath, next);
    await writeFile(join(root, "data", path), body);
    if (commit) await commitWorkspaceFiles(root, "Record content decision");
  }
  return { root, record, path, current, change, originalCommit,
    approved: { ...record, status: "approved", approvedOn: "2026-06-01",
      approvedContentRevisions: { [path]: calculateRevision("content", newBody) } } };
}

for (const type of ["policy", "document", "training"]) {
  test(`${type} same-ID drafts and new approvals retain exact committed operating content`, async (t) => {
    const f = await fixture(t, type);
    for (const status of ["draft", "in-review", "approved"]) {
      await f.change({ ...f.approved, status }, newBody, status === "approved");
      for (const fallback of [false, true]) {
        const { loaded, byId, source } = await f.current(fallback);
        const baseline = governedContentBaseline(source, byId, "2026-06-15", loaded.model);
        assert.equal(baseline?.approvedOn, "2026-01-01");
        assert.equal(baseline?.id, source.id);
        assert.notEqual(baseline, source);
        assert.equal(governedMarkdownSource(loaded, baseline, f.path), oldBody);
        assert.equal(governedMarkdownSource(loaded, source, f.path), newBody);
        assert.equal(governedApprovalContentMatches(loaded, baseline), true);
        assert.equal(governedContentSource(loaded, baseline).commit, f.originalCommit);
        const pending = pendingGovernedSuccessor(source, byId, "2026-06-15", loaded.model);
        assert.deepEqual(pending, baseline);
        assert.equal(governedContentSource(loaded, pending).commit, governedContentSource(loaded, baseline).commit);
        assert.equal(governedContentCoversPeriod(source, "2026-01-02", "2026-06-15", byId, loaded.model), true);
      }
    }
    const expanded = { ...f.approved, controlIds: ["control-example", "control-new"] };
    await f.change(expanded);
    const { loaded, byId, source } = await f.current();
    const baseline = governedContentBaseline(source, byId, "2026-06-15", loaded.model);
    assert.deepEqual(baseline.controlIds, ["control-example"], "new proposal duties never enter the operating edition");
    assert.equal(pendingGovernedSuccessor(source, byId, "2026-06-15", loaded.model), null,
      "old scope cannot make new proposal obligations informational");
  });

  test(`${type} actual cutover selects its own proof while future activation preserves prior proof`, async (t) => {
    const f = await fixture(t, type);
    const active = { ...f.approved, status: "active", effectiveOn: "2026-07-01",
      ...(type === "policy" ? {} : { activatedOn: "2026-07-01", activatedContentRevisions: f.approved.approvedContentRevisions }) };
    await f.change(active, newBody, true);
    const { loaded, byId, source } = await f.current();
    assert.equal(governedContentBaseline(source, byId, "2026-06-15", loaded.model)?.approvedOn, "2026-01-01");
    assert.equal(governedContentBaseline(source, byId, "2026-07-01", loaded.model), source);
    assert.equal(governedContentCoversPeriod(source, "2026-01-02", "2026-07-15", byId, loaded.model), true);
    if (type !== "policy") {
      await f.change({ ...active, effectiveOn: "2026-06-01" });
      const awaitingActivation = await f.current();
      assert.equal(governedContentBaseline(awaitingActivation.source, awaitingActivation.byId, "2026-06-15", awaitingActivation.loaded.model)?.approvedOn, "2026-01-01",
        "actual activation governs cutover when effective date is earlier");
    }
    await f.change({ ...active, status: "retired", statusTransition: { changedOn: "2026-08-01" } }, newBody, true);
    const retired = await f.current();
    assert.equal(governedContentBaseline(retired.source, retired.byId, "2026-06-15", retired.loaded.model)?.approvedOn, "2026-01-01");
    assert.equal(governedContentBaseline(retired.source, retired.byId, "2026-08-01", retired.loaded.model), null);
    await f.change({ ...active, approvedOn: "2026-07-02" });
    const invalid = await f.current();
    assert.equal(governedContentBaseline(invalid.source, invalid.byId, "2026-07-15", invalid.loaded.model), null);
    await f.change(active, `${newBody}\nUnapproved operating change.\n`);
    const stale = await f.current();
    assert.equal(governedContentBaseline(stale.source, stale.byId, "2026-07-15", stale.loaded.model), null);
  });
}

test("same-ID historical actual cutovers and retirement are barriers, including draft reverts", async (t) => {
  const f = await fixture(t);
  const invalid = { ...f.approved, status: "active", effectiveOn: "2026-03-01", approvedOn: "2026-03-02" };
  await f.change(invalid, newBody, true);
  await f.change({ ...f.approved, status: "draft" }, newBody, true);
  for (const fallback of [false, true]) {
    const { loaded, byId, source } = await f.current(fallback);
    assert.equal(governedContentBaseline(source, byId, "2026-04-01", loaded.model), null);
    assert.equal(governedContentBaseline(source, byId, "2026-02-01", loaded.model)?.approvedOn, "2026-01-01");
  }
  await f.change({ ...f.approved, status: "active", effectiveOn: "2026-05-01", approvedOn: "2026-04-01" }, newBody, true);
  await f.change({ ...f.approved, status: "draft" }, newBody, true);
  let state = await f.current();
  assert.equal(governedContentCoversPeriod(state.source, "2026-01-02", "2026-06-01", state.byId, state.loaded.model), false,
    "a valid later edition does not erase an earlier authorization gap");
  await f.change({ ...f.record, status: "retired", statusTransition: { changedOn: "2026-06-01" } }, oldBody, true);
  await f.change({ ...f.record, status: "draft" }, oldBody, true);
  state = await f.current();
  assert.equal(governedContentBaseline(state.source, state.byId, "2026-06-15", state.loaded.model), null,
    "reverting proposed bytes does not undo actual retirement");
});

test("historical lookup stays within its own commit ancestry with and without the history index", async (t) => {
  const f = await fixture(t);
  await f.change({ ...f.record, status: "draft" }, newBody, true);
  const draftCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: f.root, encoding: "utf8" }).trim();
  await f.change({ ...f.approved, status: "retired", statusTransition: { changedOn: "2026-02-01" } }, newBody, true);
  for (const fallback of [false, true]) {
    const { loaded } = await f.current(fallback);
    const context = reviewHistoryContext(loaded.root, loaded);
    const historical = reviewHistoricalWorkspace(context, draftCommit);
    const byId = registerGovernedLookup(new Map(historical.resources.map((item) => [item.id, item])), historical);
    const baseline = governedContentBaseline(byId.get(f.record.id), byId, "2026-06-15", historical.model);
    assert.equal(baseline?.approvedOn, "2026-01-01", "future retirement cannot leak into an earlier source snapshot");
    assert.equal(governedMarkdownSource(historical, baseline, f.path), oldBody);
  }
});

test("minimal registered contexts and source lookup retain exact historical Markdown", async (t) => {
  const f = await fixture(t);
  await f.change({ ...f.record, status: "draft" });
  const { loaded, source } = await f.current();
  const minimal = { root: loaded.root, resources: loaded.resources, model: loaded.model, workspace: loaded.workspace };
  const byId = registerGovernedLookup(new Map(loaded.resources.map((item) => [item.id, item])), minimal);
  const baseline = governedContentBaseline(source, byId, "2026-06-15", loaded.model);
  assert.equal(governedMarkdownSource(minimal, baseline, f.path), oldBody);
  assert.equal(governedContentSource(minimal, source).entry, null);
  assert.equal(await readFile(join(f.root, "data", f.path), "utf8"), newBody);
});

test("indexed governed lookup materializes only commits changing the target edition", async (t) => {
  const f = await fixture(t);
  for (let index = 0; index < 8; index += 1) {
    await writeJson(join(f.root, "data/unrelated.json"), { id: "unrelated-work", type: "action-item", title: `Operating work ${index}` });
    await commitWorkspaceFiles(f.root, "Record unrelated operating work");
  }
  await f.change({ ...f.record, status: "draft" });
  const { loaded, byId, source } = await f.current();
  const history = reviewHistoryContext(loaded.root, loaded);
  assert.equal(history.index.available, true);
  assert.equal(governedContentCoversPeriod(source, "2026-01-02", "2026-06-15", byId, loaded.model), true);
  assert.equal(history.workspacesByCommit.size, 1,
    "unrelated commits must not materialize full historical record populations");
});

test("pending same-ID retention schedule keeps its exact old rows and retirement cannot restore authority", async (t) => {
  const { makeRetentionApplicationWorkspace } = await import("./fixtures/retention-applications.js");
  const { assessCollectionReview, retentionScheduleIsAuthoritative } = await import("../src/collection-review.js");
  const { operatingRetentionScheduleWorkspace } = await import("../src/retention-schedule-approval.js");
  const { currentCalendarDate } = await import("../src/time.js");
  const root = await mkdtemp(join(tmpdir(), "filegrc-same-id-schedule-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await makeRetentionApplicationWorkspace(root);
  let loaded = await loadWorkspace(root);
  const entry = loaded.entries.find(({ record }) => record.type === "document" && record.documentKind === "schedule");
  const row = loaded.entries.find(({ record }) => record.type === "retention-schedule-item");
  const today = currentCalendarDate(loaded.workspace.timezone);
  const active = { ...entry.record, status: "active", activationBasis: "recorded", effectiveOn: today,
    activatedOn: today, activatedByIds: ["person-example"], activatedContentRevisions: entry.record.approvedContentRevisions };
  await writeJson(entry.path, active);
  await commitWorkspaceFiles(root, "Activate approved schedule");
  const body = await readFile(entry.path.replace(/\.json$/, ".md"), "utf8");
  const proposedBody = `${body}\nA proposed retention decision awaits adoption.\n`;
  await writeFile(entry.path.replace(/\.json$/, ".md"), proposedBody);
  await writeJson(entry.path, { ...active, status: "approved", approvedContentRevisions: {
    [`documents/${active.id}.md`]: calculateRevision("content", proposedBody) } });
  await writeJson(row.path, { ...row.record, retentionPeriod: { basis: "fixed", amount: 9, unit: "year" } });
  await commitWorkspaceFiles(root, "Approve proposed schedule revision");
  for (const fallback of [false, true]) {
    loaded = await loadWorkspace(root);
    if (fallback) reviewHistoryContext(loaded.root, loaded).index = null;
    const projection = operatingRetentionScheduleWorkspace(loaded);
    assert.deepEqual(projection.resources.find(({ id }) => id === row.record.id).retentionPeriod, row.record.retentionPeriod);
    assert.equal(assessCollectionReview(loaded, "retention-schedule-item").complete, false);
    assert.equal(retentionScheduleIsAuthoritative(loaded, loaded.resources.find(({ type }) => type === "program")), true);
  }
  await writeFile(entry.path.replace(/\.json$/, ".md"), body);
  await writeJson(row.path, row.record);
  await writeJson(entry.path, active);
  await commitWorkspaceFiles(root, "Restore the reviewed active schedule");
  await writeJson(row.path, { ...row.record, retentionPeriod: { basis: "fixed", amount: 9, unit: "year" } });
  await commitWorkspaceFiles(root, "Change a row without fresh schedule approval");
  loaded = await loadWorkspace(root);
  assert.equal(retentionScheduleIsAuthoritative(loaded, loaded.resources.find(({ type }) => type === "program")), false);
  await writeJson(entry.path, { ...active, status: "draft" });
  await commitWorkspaceFiles(root, "Draft the next schedule proposal");
  for (const fallback of [false, true]) {
    loaded = await loadWorkspace(root);
    if (fallback) reviewHistoryContext(loaded.root, loaded).index = null;
    const byId = registerGovernedLookup(new Map(loaded.resources.map((item) => [item.id, item])), loaded);
    assert.equal(governedContentBaseline(byId.get(active.id), byId, today, loaded.model), null,
      "all baseline consumers retain the last active edition's missing whole-schedule authorization");
    assert.equal(retentionScheduleIsAuthoritative(loaded, loaded.resources.find(({ type }) => type === "program")), false,
      "a draft cannot restore authority lost by an unreviewed active row change");
  }
  await writeJson(row.path, row.record);
  await writeJson(entry.path, active);
  await commitWorkspaceFiles(root, "Restore the exact reviewed schedule before retirement");
  await writeJson(entry.path, { ...active, status: "retired", statusTransition: { changedOn: today } });
  await commitWorkspaceFiles(root, "Retire operating schedule");
  await writeJson(entry.path, { ...active, status: "approved" });
  await commitWorkspaceFiles(root, "Propose copied schedule content");
  loaded = await loadWorkspace(root);
  assert.equal(retentionScheduleIsAuthoritative(loaded, loaded.resources.find(({ type }) => type === "program")), false,
    "copying the exact former bytes and approval facts cannot reverse an actual retirement");
});

test("a pending retention edition preserves unrelated Program review records", async (t) => {
  const { makeRetentionApplicationWorkspace } = await import("./fixtures/retention-applications.js");
  const { applyCollectionReview, scaffoldCollectionReview, retentionScheduleIsAuthoritative } = await import("../src/collection-review.js");
  const { operatingRetentionScheduleWorkspace } = await import("../src/retention-schedule-approval.js");
  const { currentCalendarDate } = await import("../src/time.js");
  const root = await mkdtemp(join(tmpdir(), "filegrc-retention-program-reviews-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await makeRetentionApplicationWorkspace(root);
  let loaded = await loadWorkspace(root);
  const firstProgram = loaded.resources.find(({ type }) => type === "program");
  const otherProgram = { ...firstProgram, id: "program-other", title: "Second program" };
  await writeJson(join(root, "data/programs/program-other.json"), otherProgram);
  await commitWorkspaceFiles(root, "Add the second program");
  const scaffold = await scaffoldCollectionReview(root, { resourceType: "retention-schedule-item", programId: firstProgram.id });
  await applyCollectionReview(root, { ...scaffold, programId: firstProgram.id, decision: "complete", rationale: "Reviewed the shared schedule for both programs.",
    reviewedByIds: ["person-independent-approver-example"], reviewedOn: currentCalendarDate(loaded.workspace.timezone), confirmed: true });
  loaded = await loadWorkspace(root);
  const entry = loaded.entries.find(({ record }) => record.type === "document" && record.documentKind === "schedule");
  const today = currentCalendarDate(loaded.workspace.timezone);
  const active = { ...entry.record, status: "active", activationBasis: "recorded", effectiveOn: today,
    activatedOn: today, activatedByIds: ["person-example"], activatedContentRevisions: entry.record.approvedContentRevisions };
  await writeJson(entry.path, active);
  await commitWorkspaceFiles(root, "Activate the shared approved schedule");
  loaded = await loadWorkspace(root);
  const sharedReview = loaded.resources.find((item) => item.type === "collection-review" && item.resourceType === "retention-schedule-item");
  const otherReview = { ...sharedReview, id: "review-other-program-history", scopeResourceIds: [otherProgram.id], populationResourceIds: ["retention-rule-other-period"] };
  await writeJson(join(root, "data/collection-reviews/review-other-program-history.json"), otherReview);
  await commitWorkspaceFiles(root, "Retain the second program's separate historical review");
  await writeJson(entry.path, { ...active, status: "draft" });
  await commitWorkspaceFiles(root, "Draft the next shared schedule edition");
  loaded = await loadWorkspace(root);
  const projection = operatingRetentionScheduleWorkspace(loaded);
  assert.deepEqual(projection.resources.find(({ id }) => id === otherReview.id), otherReview,
    "replacing one schedule population must not remove another program's review history");
  assert.deepEqual(projection.entries.find(({ record }) => record.id === otherReview.id).record, otherReview);
  assert.equal(retentionScheduleIsAuthoritative(loaded, firstProgram), true);
  assert.equal(retentionScheduleIsAuthoritative(loaded, otherProgram), true);
  const byId = registerGovernedLookup(new Map(loaded.resources.map((item) => [item.id, item])), loaded);
  assert.equal(governedContentBaseline(byId.get(active.id), byId, today, loaded.model)?.status, "active",
    "the shared baseline requires whole-schedule proof for both owning Programs");
  const otherSchedule = { ...active, id: "document-other-schedule", title: "Second program's proposed independent schedule" };
  const otherBindings = { [`documents/${otherSchedule.id}.md`]: calculateRevision("content", await readFile(entry.path.replace(/\.json$/, ".md"), "utf8")) };
  Object.assign(otherSchedule, { approvedContentRevisions: otherBindings, activatedContentRevisions: otherBindings });
  await writeJson(join(root, `data/documents/${otherSchedule.id}.json`), otherSchedule);
  await writeFile(join(root, `data/documents/${otherSchedule.id}.md`), await readFile(entry.path.replace(/\.json$/, ".md"), "utf8"));
  loaded = await loadWorkspace(root);
  const independent = registerGovernedLookup(new Map(loaded.resources.map((item) => [item.id, item])), loaded);
  assert.equal(governedContentBaseline(independent.get(otherSchedule.id), independent, today, loaded.model), null,
    "a second active schedule cannot borrow the shared schedule's whole-workspace approval while the first awaits review");
});

test("resolved edition provenance never changes interned records in another snapshot", async (t) => {
  const f = await fixture(t);
  await f.change({ ...f.record, status: "draft" }, newBody, true);
  const draftCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: f.root, encoding: "utf8" }).trim();
  await f.change(f.record, newBody, true);
  const invalidCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: f.root, encoding: "utf8" }).trim();
  const { loaded } = await f.current();
  const history = reviewHistoryContext(loaded.root, loaded);
  const original = reviewHistoricalWorkspace(history, f.originalCommit);
  const draft = reviewHistoricalWorkspace(history, draftCommit);
  const invalid = reviewHistoricalWorkspace(history, invalidCommit);
  const originalRecord = original.resources.find(({ id }) => id === f.record.id);
  const invalidRecord = invalid.resources.find(({ id }) => id === f.record.id);
  assert.equal(originalRecord, invalidRecord, "fixture exercises history's JSON interning");
  const byId = registerGovernedLookup(new Map(draft.resources.map((item) => [item.id, item])), draft);
  const edition = governedContentBaseline(byId.get(f.record.id), byId, "2026-06-15", draft.model);
  assert.notEqual(edition, originalRecord);
  assert.equal(governedMarkdownSource(draft, edition, f.path), oldBody);
  assert.equal(governedContentSource(invalid, invalidRecord).loaded, invalid);
  assert.equal(governedMarkdownSource(invalid, invalidRecord, f.path), newBody);
  assert.equal(governedApprovalContentMatches(invalid, invalidRecord), false);
});

test("a starter active parent without whole-schedule proof does not block first approved schedule setup", async (t) => {
  const { makeSourceCoverageRetentionWorkspace } = await import("./fixtures/retention-applications.js");
  const { assessCollectionReview, retentionScheduleIsAuthoritative } = await import("../src/collection-review.js");
  const { governedContentHasOperatingHistory } = await import("../src/governed-content-baseline.js");
  const root = await mkdtemp(join(tmpdir(), "filegrc-first-schedule-approval-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await makeSourceCoverageRetentionWorkspace(root);
  for (const fallback of [false, true]) {
    const loaded = await loadWorkspace(root);
    if (fallback) reviewHistoryContext(loaded.root, loaded).index = null;
    const schedule = loaded.resources.find((record) => record.type === "document" && record.documentKind === "schedule");
    assert.equal(schedule.status, "approved");
    assert.equal(assessCollectionReview(loaded, "retention-schedule-item").complete, true);
    assert.equal(governedContentHasOperatingHistory(loaded, schedule), false,
      "a parent label alone cannot establish prior operation without exact whole-schedule proof");
    assert.equal(retentionScheduleIsAuthoritative(loaded, loaded.resources.find(({ type }) => type === "program")), true,
      "the first valid independent approval remains available for setup and owner rule applications");
  }
});

test("Source Coverage and owner applications retain effective rows through a same-ID proposal", async (t) => {
  const { makeSourceCoverageRetentionWorkspace, sourceCoverageRetentionDecision } = await import("./fixtures/retention-applications.js");
  const { retentionApplicationIssues, scaffoldRetentionApplication, saveRetentionApplication } = await import("../src/retention-applications.js");
  const { assessRetentionReadiness, resolveSourceCoverageRetention, resourceReviewRevisionsSync, retentionReviewResourceIds } = await import("../src/retention.js");
  const { sourceCoverageComplete, sourcePreparationFacts } = await import("../src/source-coverage.js");
  const { retentionScheduleIsAuthoritative, applyCollectionReview, scaffoldCollectionReview } = await import("../src/collection-review.js");
  const { currentCalendarDate } = await import("../src/time.js");
  const { updateResource } = await import("../src/files.js");
  const { readResourceMutation } = await import("../src/resource-mutation.js");
  const { validateWorkspace } = await import("../src/validate.js");
  const root = await mkdtemp(join(tmpdir(), "filegrc-effective-source-retention-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await makeSourceCoverageRetentionWorkspace(root);
  await saveRetentionApplication(root, await saveRetentionApplication(root, await sourceCoverageRetentionDecision(root), { preview: true }));
  await commitWorkspaceFiles(root, "Apply the approved three-year rule to selected proof");
  let loaded = await loadWorkspace(root);
  const entry = loaded.entries.find(({ record }) => record.type === "document" && record.documentKind === "schedule");
  const rowEntry = loaded.entries.find(({ record }) => record.type === "retention-schedule-item");
  const today = currentCalendarDate(loaded.workspace.timezone);
  const active = { ...entry.record, status: "active", activationBasis: "recorded", effectiveOn: today,
    activatedOn: today, activatedByIds: ["person-example"], activatedContentRevisions: entry.record.approvedContentRevisions };
  await writeJson(entry.path, active);
  await commitWorkspaceFiles(root, "Activate the exact independently approved schedule");
  const unchanged = await scaffoldCollectionReview(root, { resourceType: "retention-schedule-item" });
  await applyCollectionReview(root, { ...unchanged, decision: "complete", rationale: "Independently reviewed the unchanged active schedule before proposing its successor edition.",
    reviewedByIds: ["person-independent-approver-example"], reviewedOn: today, confirmed: true });
  await commitWorkspaceFiles(root, "Review the complete unchanged schedule");
  const mutation = await readResourceMutation(root, "retention-schedule-item", rowEntry.record.id);
  await updateResource(root, "retention-schedule-item", rowEntry.record.id, { ...mutation.record, retentionPeriod: { basis: "fixed", amount: 9, unit: "year" } },
    { expectedRevision: mutation.revision, content: { record: "# Proposed row procedure\n\nA proposed new row procedure awaits adoption.\n" }, expectedContentRevisions: mutation.contentRevisions });
  await commitWorkspaceFiles(root, "Propose a nine-year schedule revision");
  loaded = await loadWorkspace(root);
  const program = loaded.resources.find(({ type }) => type === "program");
  const coverage = loaded.resources.find(({ id }) => id === "source-coverage-selected-proof");
  const app = loaded.resources.find(({ type }) => type === "retention-application");
  assert.equal(retentionScheduleIsAuthoritative(loaded, program), true);
  assert.deepEqual(retentionApplicationIssues(loaded, app), []);
  assert.equal((await resolveSourceCoverageRetention(loaded, coverage, program)).rules[0].retentionPeriod.amount, 3);
  assert.equal(await sourceCoverageComplete(coverage, loaded, program), true);
  assert.equal((await sourcePreparationFacts(loaded, coverage, program, { asOf: "2026-10-24", sourceId: coverage.componentId, controlIds: ["control-example"] })).complete, true);
  const readiness = await assessRetentionReadiness(loaded, program, { scheduleApproved: true });
  assert.equal(readiness.find(({ id }) => id === "retention-source-coverage-source-coverage-selected-proof").status, "complete");
  const scaffold = await scaffoldRetentionApplication(root, rowEntry.record.id);
  assert.equal(scaffold.approvedRule.retentionPeriod.amount, 3);
  assert.equal(scaffold.record.ruleRevision, app.ruleRevision);
  const pendingPayload = { ...await sourceCoverageRetentionDecision(root) };
  pendingPayload.record.id = "retention-application-another-current-three-year-decision";
  const preview = await saveRetentionApplication(root, pendingPayload, { preview: true });
  assert.equal(preview.approvedRule.retentionPeriod.amount, 3);
  assert.equal(preview.record.ruleRevision, app.ruleRevision);
  const coverageEntry = loaded.entries.find(({ record }) => record.id === coverage.id);
  await writeJson(coverageEntry.path, { ...coverage, excludedPopulation: "Changed material source population." });
  let changed = await loadWorkspace(root);
  assert.ok(retentionApplicationIssues(changed, app).some(({ message }) => /Service data use/.test(message)));
  assert.equal(await sourceCoverageComplete(changed.resources.find(({ id }) => id === coverage.id), changed, program), false);
  await writeJson(coverageEntry.path, coverage);
  const componentEntry = loaded.entries.find(({ record }) => record.id === coverage.componentId);
  await writeJson(componentEntry.path, { ...componentEntry.record, description: "A materially different business purpose and service data use." });
  changed = await loadWorkspace(root);
  assert.ok(retentionApplicationIssues(changed, app).length > 0, "current inventory facts must never be replaced by old schedule scope facts");
  await writeJson(componentEntry.path, componentEntry.record);
  loaded = await loadWorkspace(root);
  const proposedRow = loaded.resources.find(({ id }) => id === rowEntry.record.id);
  await writeJson(rowEntry.path, { ...proposedRow, reviewedSourceRevisions: Object.fromEntries(resourceReviewRevisionsSync(loaded, retentionReviewResourceIds(proposedRow, loaded), "legacy", false, null, proposedRow)) });
  const review = await scaffoldCollectionReview(root, { resourceType: "retention-schedule-item" });
  await applyCollectionReview(root, { ...review, decision: "complete", rationale: "Reviewed the changed retention period and procedure.", reviewedByIds: ["person-independent-approver-example"], reviewedOn: today, confirmed: true });
  await commitWorkspaceFiles(root, "Approve the proposed nine-year schedule");
  loaded = await loadWorkspace(root);
  const approvedValidation = await validateWorkspace(root);
  assert.equal(approvedValidation.ok, true, JSON.stringify(approvedValidation.diagnostics.filter(({ severity }) => severity === "error")));
  assert.deepEqual(retentionApplicationIssues(loaded, app), [], "independent approval alone does not cut over the operating rule");
  assert.equal((await resolveSourceCoverageRetention(loaded, loaded.resources.find(({ id }) => id === coverage.id), program)).rules[0].retentionPeriod.amount, 3);
  const approved = loaded.resources.find(({ id }) => id === active.id);
  await writeJson(entry.path, { ...approved, status: "active", activationBasis: "recorded", effectiveOn: today, activatedOn: today,
    activatedByIds: ["person-example"], activatedContentRevisions: approved.approvedContentRevisions });
  await commitWorkspaceFiles(root, "Activate the independently approved nine-year schedule");
  loaded = await loadWorkspace(root);
  assert.ok(retentionApplicationIssues(loaded, app).length > 0, "actual changed-rule cutover invalidates the old three-year applicability decision");
  assert.equal((await resolveSourceCoverageRetention(loaded, loaded.resources.find(({ id }) => id === coverage.id), program)).rules.length, 0);
  assert.deepEqual(retentionApplicationIssues(loaded, { ...app, status: "retired", statusTransition: {
    changedOn: today, changedByIds: ["person-example"], reason: "The owner retired the prior decision after changed-rule cutover." } }), [],
  "retiring the stale application preserves its original independent proof and owner decision");
});

test("an unchanged calendar rule retains its anchor, open windows and completion links after same-ID policy activation", async (t) => {
  const { makeComprehensiveWorkspace } = await import("./fixtures.js");
  const { planObligations, obligationScheduleRecurrence, scaffoldObligationOccurrence } = await import("../src/obligations.js");
  const { validateWorkspace } = await import("../src/validate.js");
  const { scaffoldCollectionReview, applyCollectionReview } = await import("../src/collection-review.js");
  const root = await mkdtemp(join(tmpdir(), "filegrc-calendar-content-cutover-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const originalAuthorDate = process.env.GIT_AUTHOR_DATE;
  const originalCommitterDate = process.env.GIT_COMMITTER_DATE;
  t.after(() => {
    if (originalAuthorDate === undefined) delete process.env.GIT_AUTHOR_DATE; else process.env.GIT_AUTHOR_DATE = originalAuthorDate;
    if (originalCommitterDate === undefined) delete process.env.GIT_COMMITTER_DATE; else process.env.GIT_COMMITTER_DATE = originalCommitterDate;
  });
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-07-14T18:00:00Z") });
  const at = (timestamp) => {
    t.mock.timers.setTime(Date.parse(timestamp));
    process.env.GIT_AUTHOR_DATE = timestamp;
    process.env.GIT_COMMITTER_DATE = timestamp;
  };
  at("2026-07-14T18:00:00Z");
  await makeComprehensiveWorkspace(root, "11");
  let loaded = await loadWorkspace(root);
  const obligationEntry = loaded.entries.find(({ record }) => record.type === "obligation");
  const ruleEntry = loaded.entries.find(({ record }) => record.type === "obligation-rule");
  const occurrenceEntry = loaded.entries.find(({ record }) => record.type === "obligation-occurrence");
  const reviewEntry = loaded.entries.find(({ record }) => record.type === "vendor-review");
  const policyEntry = loaded.entries.find(({ record }) => record.type === "policy");
  const obligation = { ...obligationEntry.record, activityType: "vendor-review", scopeResourceIds: [] };
  const rule = { ...ruleEntry.record, recurrence: { mode: "calendar", unit: "month", interval: 1, anchorDate: "2026-06-30" },
    window: { precision: "date", startsAfter: 0, dueAfter: 14 },
    selector: { resourceType: "vendor", membershipMode: "as-of", cutoff: "window-end", statuses: ["active"] } };
  const occurrence = { ...occurrenceEntry.record, occurrenceKey: `program-example:${obligation.id}:2026-06-30`,
    coverage: { kind: "range", startsOn: "2026-06-30", endsOn: "2026-07-14" }, membershipCutoffAt: "2026-07-14",
    members: [{ resourceId: "vendor-example", disposition: "expected", result: "passed", completionResourceIds: [reviewEntry.record.id] }],
    reconciledAt: "2026-07-15T15:30:00Z" };
  await writeJson(obligationEntry.path, obligation);
  await writeJson(ruleEntry.path, rule);
  await rm(occurrenceEntry.path);
  await writeJson(reviewEntry.path, { ...reviewEntry.record, completedOn: "2026-07-10", coverage: { kind: "as-of", on: "2026-07-10" } });
  const componentEntry = loaded.entries.find(({ record }) => record.type === "component");
  await writeJson(componentEntry.path, { ...componentEntry.record, vendorId: "vendor-example" });
  await initializeGitWorkspace(root);
  const populationReview = await scaffoldCollectionReview(root, { resourceType: "vendor", now: "2026-07-14T18:00:00Z" });
  await applyCollectionReview(root, { ...populationReview, decision: "complete", rationale: "Reviewed the generic vendor population at the June cycle cutoff.",
    reviewedByIds: ["person-independent-approver-example"], reviewedOn: "2026-07-14", now: "2026-07-14T18:00:00Z", confirmed: true });
  await commitWorkspaceFiles(root, "Review the exact June vendor population at its cutoff");
  at("2026-07-15T18:00:00Z");
  const cutoffOccurrence = await scaffoldObligationOccurrence(root, { obligationId: obligation.id, windowStart: "2026-06-30", asOf: "2026-07-15" });
  await writeJson(occurrenceEntry.path, { ...cutoffOccurrence.record, ...occurrence });
  await commitWorkspaceFiles(root, "Retain the June vendor review and its exact population proof");
  at("2026-08-01T18:00:00Z");
  await writeJson(join(root, "data/workspace.json"), { ...loaded.workspace, dataModelVersion: "13" });
  await writeJson(join(root, "package.json"), { private: true, dependencies: { filegrc: "^0.21.0" } });
  await writeJson(join(root, "package-lock.json"), { lockfileVersion: 3, packages: { "": { dependencies: { filegrc: "^0.21.0" } }, "node_modules/filegrc": { version: "0.21.0" } } });
  await commitWorkspaceFiles(root, "Adopt the current model without changing the operating rule");
  const unchangedPaths = [obligationEntry.path, ruleEntry.path, occurrenceEntry.path, reviewEntry.path];
  const originalBytes = await Promise.all(unchangedPaths.map((path) => readFile(path, "utf8")));
  const options = { asOf: "2026-10-10", from: "2026-06-30", through: "2026-10-29", includeComplete: true };
  const assess = async () => {
    const current = await loadWorkspace(root);
    const byId = registerGovernedLookup(new Map(current.resources.map((record) => [record.id, record])), current);
    return { schedule: obligationScheduleRecurrence(obligation, rule, byId, current.model, "America/Chicago", new Set(), options.asOf),
      items: planObligations(current.resources, { ...options, loaded: current, root: current.root, model: current.model }).calendarItems
        .filter((item) => item.obligationId === obligation.id)
        .map(({ ruleId, occurrenceId, dueWindowStart, dueWindowEnd, status, completionResourceIds }) => ({ ruleId, occurrenceId, dueWindowStart, dueWindowEnd, status, completionResourceIds }))
        .sort((left, right) => left.dueWindowStart.localeCompare(right.dueWindowStart)) };
  };
  const before = await assess();
  assert.equal(before.schedule.recurrence.anchorDate, "2026-06-30");
  assert.equal(before.schedule.activationDate, "2026-06-30", "a rule effective in January must wait for the first actual June policy operation");
  assert.ok(before.items.some((item) => item.dueWindowStart === "2026-07-30" && item.status === "overdue"));
  assert.ok(before.items.some((item) => item.dueWindowStart === "2026-09-30" && !["complete", "overdue"].includes(item.status)));
  assert.deepEqual(before.items.find((item) => item.occurrenceId === occurrence.id)?.completionResourceIds, [reviewEntry.record.id]);
  const body = `${await readFile(policyEntry.path.replace(/\.json$/, ".md"), "utf8")}\nThe reviewed policy revision takes effect on August 15.\n`;
  const proposed = { ...policyEntry.record, status: "approved", approvedOn: "2026-08-01",
    approvedContentRevisions: { [`policies/${policyEntry.record.id}.md`]: calculateRevision("content", body) } };
  delete proposed.effectiveOn;
  await writeJson(policyEntry.path, proposed);
  await writeFile(policyEntry.path.replace(/\.json$/, ".md"), body);
  await commitWorkspaceFiles(root, "Approve the next policy revision");
  const scheduleReview = await scaffoldCollectionReview(root, { resourceType: "obligation", now: "2026-08-01T18:00:00Z" });
  await applyCollectionReview(root, { ...scheduleReview, decision: "complete", rationale: "Reviewed the unchanged monthly vendor duty against the new policy edition.",
    scheduleDecisions: scheduleReview.scheduleDecisions.map((decision) => ({ ...decision, disposition: "adopted", rationale: "Keep the existing approved monthly rule." })),
    reviewedByIds: ["person-independent-approver-example"], reviewedOn: "2026-08-01", now: "2026-08-01T18:00:00Z", confirmed: true });
  await commitWorkspaceFiles(root, "Approve the exact unchanged operating schedule set");
  assert.deepEqual((await assess()).items, before.items);
  at("2026-08-15T18:00:00Z");
  await writeJson(policyEntry.path, { ...proposed, status: "active", effectiveOn: "2026-08-15" });
  await commitWorkspaceFiles(root, "Activate the approved policy revision");
  const after = await assess();
  const validation = await validateWorkspace(root);
  assert.equal(validation.ok, true, JSON.stringify(validation.diagnostics.filter(({ severity }) => severity === "error")));
  assert.equal(after.schedule.recurrence.anchorDate, before.schedule.recurrence.anchorDate);
  assert.deepEqual(await Promise.all(unchangedPaths.map((path) => readFile(path, "utf8"))), originalBytes,
    "content activation must not modify the rule, its approval and anchor, or the existing proof records");
  assert.deepEqual(after.items, before.items,
    "an unchanged approved rule keeps prior unrecorded open and overdue windows as well as frozen completion links");
  await assert.rejects(scaffoldObligationOccurrence(root, { obligationId: obligation.id, windowStart: "2026-07-30", asOf: options.asOf }),
    /population can no longer be inferred/, "the owed July window exists, but backfilling its population still requires actual temporal proof");
  const retained = await scaffoldObligationOccurrence(root, { obligationId: obligation.id, windowStart: "2026-06-30", asOf: options.asOf, correctFinalized: true });
  assert.deepEqual(retained.record.coverage, occurrence.coverage);
  assert.equal(retained.record.ruleId, rule.id);
  assert.deepEqual(retained.record.members.flatMap((member) => member.completionResourceIds || []), [reviewEntry.record.id]);
  at("2026-09-15T18:00:00Z");
  const successor = { ...rule, id: "obligation-rule-real-cutover", supersedesId: rule.id,
    approvedOn: "2026-09-01", effectiveAt: "2026-09-15T00:00:00-05:00", cutoverDecision: "supersede-open-window",
    recurrence: { ...rule.recurrence, anchorDate: "2026-09-15" } };
  await writeJson(join(root, "data/obligation-rules/obligation-rule-real-cutover.json"), successor);
  await writeJson(obligationEntry.path, { ...obligation, activeRuleId: successor.id, ruleIds: [rule.id, successor.id] });
  loaded = await loadWorkspace(root);
  const nextById = registerGovernedLookup(new Map(loaded.resources.map((record) => [record.id, record])), loaded);
  const amended = obligationScheduleRecurrence(nextById.get(obligation.id), successor, nextById, loaded.model, "America/Chicago", new Set(), options.asOf);
  assert.equal(amended.activationDate, "2026-09-15", "a real new rule still starts at its actual effective cutover");
  assert.equal(amended.recurrence.anchorDate, "2026-09-15");
});

for (const type of ["document", "training"]) {
  test(`a calendar rule waits for first ${type} activation without restarting on later editions`, async (t) => {
    const { makeComprehensiveWorkspace } = await import("./fixtures.js");
    const { planObligations, obligationScheduleRecurrence } = await import("../src/obligations.js");
    const root = await mkdtemp(join(tmpdir(), `filegrc-initial-${type}-activation-`));
    t.after(() => rm(root, { recursive: true, force: true }));
    await makeComprehensiveWorkspace(root, "13");
    let loaded = await loadWorkspace(root);
    const oe = loaded.entries.find(({ record }) => record.type === "obligation");
    const re = loaded.entries.find(({ record }) => record.type === "obligation-rule");
    const entry = loaded.entries.find(({ record }) => record.type === type);
    const obligation = { ...oe.record, activityType: "vendor-review", scopeResourceIds: type === "document" ? [entry.record.id] : [],
      ...(type === "training" ? { templateResourceId: entry.record.id } : {}) };
    const rule = { ...re.record, recurrence: { mode: "calendar", unit: "month", interval: 1, anchorDate: "2026-06-30" },
      window: { precision: "date", startsAfter: 0, dueAfter: 30 },
      selector: { resourceType: "vendor", membershipMode: "as-of", cutoff: "window-end", statuses: ["active"] } };
    const initial = { ...entry.record, effectiveOn: "2026-07-10", activatedOn: "2026-07-10" };
    await writeJson(oe.path, obligation); await writeJson(re.path, rule); await writeJson(entry.path, initial);
    const controlEntry = loaded.entries.find(({ record }) => record.type === "control");
    await writeJson(join(root, "data/controls/control-unrelated.json"), { ...controlEntry.record, id: "control-unrelated", title: "A separate control outside the unchanged obligation" });
    await writeFile(join(root, "data/controls/control-unrelated.md"), await readFile(controlEntry.path.replace(/\.json$/, ".md"), "utf8"));
    for (const item of loaded.entries.filter(({ record }) => record.type === "obligation-occurrence")) await rm(item.path);
    await initializeGitWorkspace(root);
    const inspect = async () => {
      const current = await loadWorkspace(root);
      const byId = registerGovernedLookup(new Map(current.resources.map((record) => [record.id, record])), current);
      return { schedule: obligationScheduleRecurrence(obligation, rule, byId, current.model, "America/Chicago", new Set(), "2026-10-10"),
        windows: planObligations(current.resources, { loaded: current, root: current.root, model: current.model, asOf: "2026-10-10", from: "2026-06-30", through: "2026-10-29", includeComplete: true })
          .calendarItems.map(({ dueWindowStart, dueWindowEnd }) => ({ dueWindowStart, dueWindowEnd })) };
    };
    const before = await inspect();
    assert.equal(before.schedule.activationDate, "2026-07-10");
    assert.equal(before.windows[0].dueWindowStart, "2026-07-10");
    const body = `${await readFile(entry.path.replace(/\.json$/, ".md"), "utf8")}\nA later independently reviewed edition.\n`;
    const bindings = { [markdownEntries(loaded.model, initial)[0].path]: calculateRevision("content", body) };
    await writeFile(entry.path.replace(/\.json$/, ".md"), body);
    await writeJson(entry.path, { ...initial, controlIds: [...new Set([...(initial.controlIds || []), "control-unrelated"])], approvedOn: "2026-08-01", approvedContentRevisions: bindings,
      effectiveOn: "2026-08-15", activatedOn: "2026-08-15", activatedContentRevisions: bindings });
    await commitWorkspaceFiles(root, "Activate the later governed content edition");
    const after = await inspect();
    assert.equal(after.schedule.activationDate, "2026-07-10");
    assert.deepEqual(after.windows, before.windows, "an unrelated added Control must not reset the unchanged rule's existing duty");
  });
}

test("rules starting after current governed activation do not materialize historical workspaces", async (t) => {
  const { obligationScheduleRecurrence } = await import("../src/obligations.js");
  const f = await fixture(t);
  const { loaded, byId } = await f.current();
  const history = reviewHistoryContext(loaded.root, loaded);
  const obligation = { id: "obligation-later-rule", type: "obligation", policyIds: [f.record.id] };
  const rule = { id: "obligation-rule-later", type: "obligation-rule", effectiveAt: "2026-06-01T00:00:00Z", timezone: "UTC",
    recurrence: { mode: "calendar", unit: "month", interval: 1, anchorMode: "activation" } };
  for (let index = 0; index < 5; index += 1) {
    const schedule = obligationScheduleRecurrence(obligation, rule, byId, loaded.model, "UTC", new Set(), "2026-07-01");
    assert.equal(schedule.activationDate, "2026-06-01");
    assert.equal(schedule.recurrence.anchorDate, "2026-06-01");
  }
  assert.equal(history.workspacesByCommit.size, 0);
});

test("unchanged operating dates across metadata commits avoid full origin snapshots for every rule", async (t) => {
  const { governedContentOperatingOrigin } = await import("../src/governed-content-baseline.js");
  const { withAssessmentCache } = await import("../src/calculation-cache.js");
  const f = await fixture(t);
  for (let index = 0; index < 8; index += 1) await f.change({ ...f.record, title: `Reviewed administrative label ${index}` }, oldBody, true);
  for (const fallback of [false, true]) {
    const { loaded, byId, source } = await f.current(fallback);
    const history = reviewHistoryContext(loaded.root, loaded);
    withAssessmentCache(() => {
      for (let index = 0; index < 20; index += 1) {
        assert.equal(governedContentOperatingOrigin(source, byId, "2026-07-01", loaded.model, { scopeKey: `rule-${index}` }), "2026-01-02");
      }
    });
    assert.equal(history.workspacesByCommit.size, 0, "date discovery reads target JSON versions instead of materializing whole program snapshots");
  }
});

test("whole-schedule proof reuses exact source cohorts but preserves cutovers and fresh Markdown checks", async (t) => {
  const { makeRetentionApplicationWorkspace } = await import("./fixtures/retention-applications.js");
  const { retentionScheduleOperatingProofMatches } = await import("../src/retention-schedule-approval.js");
  const { withAssessmentCache } = await import("../src/calculation-cache.js");
  const { currentCalendarDate } = await import("../src/time.js");
  const { addCalendarDays } = await import("../src/recurrence.js");
  const root = await mkdtemp(join(tmpdir(), "filegrc-proof-cohort-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await makeRetentionApplicationWorkspace(root);
  let loaded = await loadWorkspace(root);
  const entry = loaded.entries.find(({ record }) => record.type === "document" && record.documentKind === "schedule");
  const row = loaded.entries.find(({ record }) => record.type === "retention-schedule-item");
  const today = currentCalendarDate(loaded.workspace.timezone);
  const active = { ...entry.record, status: "active", activationBasis: "recorded", effectiveOn: today, activatedOn: today,
    activatedByIds: ["person-example"], activatedContentRevisions: entry.record.approvedContentRevisions };
  await writeJson(entry.path, active);
  await commitWorkspaceFiles(root, "Activate the independently approved schedule");
  const cutover = addCalendarDays(today, 2);
  const next = { ...active, id: "document-future-schedule", supersedesId: active.id, effectiveOn: cutover, activatedOn: cutover };
  const body = await readFile(entry.path.replace(/\.json$/, ".md"), "utf8");
  const bindings = { [`documents/${next.id}.md`]: calculateRevision("content", body) };
  Object.assign(next, { approvedContentRevisions: bindings, activatedContentRevisions: bindings });
  await writeJson(join(root, `data/documents/${next.id}.json`), next);
  await writeFile(join(root, `data/documents/${next.id}.md`), body);
  await writeJson(join(root, "data/retention-schedule-items/retention-future.json"), { ...row.record, id: "retention-future", status: "planned", scheduleDocumentId: next.id });
  loaded = await loadWorkspace(root);
  const parent = loaded.resources.find(({ id }) => id === active.id);
  const program = loaded.resources.find(({ type }) => type === "program");
  const controls = program.controlIds;
  let scopeReads = 0;
  Object.defineProperty(program, "controlIds", { configurable: true, enumerable: true, get() { scopeReads += 1; return controls; } });
  withAssessmentCache(() => {
    assert.equal(retentionScheduleOperatingProofMatches(loaded, parent, today), true);
    const firstReads = scopeReads;
    assert.ok(firstReads > 0);
    assert.equal(retentionScheduleOperatingProofMatches({ ...loaded, entries: [...loaded.entries] }, parent, addCalendarDays(today, 1)), true);
    assert.equal(scopeReads, firstReads, "identical proof and successor exclusions reuse one assessment across wrappers and query dates");
    assert.equal(retentionScheduleOperatingProofMatches(loaded, parent, cutover), false,
      "the changed successor cohort must recheck its missing independent approval");
  });
  await writeFile(entry.path.replace(/\.json$/, ".md"), `${body}\nUnapproved changed retention terms.\n`);
  withAssessmentCache(() => assert.equal(retentionScheduleOperatingProofMatches(loaded, parent, today), false,
    "a new request observes current Markdown rather than retaining the earlier proof result"));
});

test("application ancestry refreshes HEAD per request and respects historical commit boundaries", async (t) => {
  const { makeSourceCoverageRetentionWorkspace, sourceCoverageRetentionDecision } = await import("./fixtures/retention-applications.js");
  const { retentionApplicationIssues, retentionApplicationScopeRevision } = await import("../src/retention-applications.js");
  const { withAssessmentCache } = await import("../src/calculation-cache.js");
  const root = await mkdtemp(join(tmpdir(), "filegrc-application-head-boundary-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await makeSourceCoverageRetentionWorkspace(root);
  const loaded = await loadWorkspace(root);
  const payload = await sourceCoverageRetentionDecision(root);
  payload.record.reviewedScopeRevisions = Object.fromEntries(payload.record.scopeResourceIds.map((id) => [id,
    retentionApplicationScopeRevision(loaded.resources.find((item) => item.id === id), loaded)]));
  const originalCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  withAssessmentCache(() => assert.deepEqual(retentionApplicationIssues(loaded, payload.record), []));
  const coverage = loaded.entries.find(({ record }) => record.id === "source-coverage-selected-proof");
  await writeJson(coverage.path, { ...coverage.record, title: "Administrative label after the approval snapshot" });
  await commitWorkspaceFiles(root, "Update a nonmaterial source label");
  const futureCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const laterApproval = { ...payload.record, approvalCommit: futureCommit };
  const current = await loadWorkspace(root);
  withAssessmentCache(() => assert.deepEqual(retentionApplicationIssues(current, laterApproval), [],
    "a later request receives the new exact HEAD rather than a cross-request Git cache"));
  const historical = reviewHistoricalWorkspace(reviewHistoryContext(loaded.root, loaded), originalCommit);
  withAssessmentCache(() => assert.ok(retentionApplicationIssues(historical, laterApproval).some(({ message }) => /exact committed independent schedule approval/.test(message)),
    "a later approval commit cannot enter an earlier historical assessment through current HEAD"));
});
