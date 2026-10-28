import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { loadModel } from "../model/index.js";
import { assessPeriodImpact, currentPeriodImpactRevision, periodImpactReviewCurrent, recordPeriodImpactReview, scaffoldPeriodImpactReview } from "../src/period-impact.js";
import { markdownEntries, resourceDataPath } from "../src/resource-markdown.js";
import { loadWorkspace } from "../src/workspace.js";
import { assessWorkflow } from "../src/workflow.js";
import { validateWorkspace } from "../src/validate.js";
import { planReconciliation } from "../src/reconciliation.js";
import { makeComprehensiveWorkspace } from "./fixtures.js";
import { makeWorkspace } from "./helpers.js";
import { adoptWorkflowRuntime } from "./fixtures/workflow-runtime.js";

const execute = promisify(execFile);
const coverage = { start: "2026-10-01", end: "2026-10-31" };
const asOf = "2026-10-10";

async function impactFixture(context, type = "component", multiSlot = false) {
  const root = await mkdtemp(join(tmpdir(), "filegrc-period-impact-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeWorkspace(root);
  await adoptWorkflowRuntime(root);
  const workspacePath = join(root, "data", "workspace.json");
  const workspace = JSON.parse(await readFile(workspacePath, "utf8"));
  workspace.dataModelVersion = "13";
  delete workspace.classificationDefinitions;
  await writeFile(workspacePath, JSON.stringify(workspace), "utf8");
  const model = structuredClone(loadModel("13"));
  if (multiSlot) model.resources[type].markdown = {
    record: { primary: true, required: false },
    retrievalNotes: { primary: false, required: false }
  };
  const record = { id: `${type}-impact-example`, type, title: "Operating source", status: "active", description: "Source used for current operations.", ownerIds: ["person-owner"] };
  if (type === "component") Object.assign(record, { componentKind: "software", evidenceSourceKinds: ["access-review"], systemUses: [{ systemId: "system-example", roles: ["evidence-source"], rationale: "Produces scoped proof." }] });
  if (type === "system") { delete record.description; Object.assign(record, { purpose: "Provide the company service.", boundary: "Company-managed service.", servicesProvided: ["Application"], criticality: "low" }); }
  const recordPath = join(root, "data", resourceDataPath(model, record));
  await mkdir(dirname(recordPath), { recursive: true });
  const saveRecord = () => writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await saveRecord();
  const slots = markdownEntries(model, record);
  for (const slot of slots) await writeFile(join(root, "data", slot.path), `# ${slot.name}\n\nRetrieve the scoped population with the recorded method.\n`, "utf8");
  const git = async (...args) => (await execute("git", args, { cwd: root })).stdout.trim();
  await git("init", "--initial-branch=main");
  const commit = async (date, message, paths = ["."]) => {
    await git("add", ...paths);
    await execute("git", ["-c", "commit.gpgSign=false", "commit", "--quiet", "-m", message], {
      cwd: root, env: { ...process.env, GIT_AUTHOR_NAME: "Fixture Reviewer", GIT_AUTHOR_EMAIL: "reviewer@example.test", GIT_COMMITTER_NAME: "Fixture Reviewer", GIT_COMMITTER_EMAIL: "reviewer@example.test", GIT_AUTHOR_DATE: `${date}T12:00:00Z`, GIT_COMMITTER_DATE: `${date}T12:00:00Z` }
    });
    return git("rev-parse", "HEAD");
  };
  await commit("2026-09-28", "Record operating baseline");
  const refresh = async () => {
    const loaded = await loadWorkspace(root);
    loaded.model = model;
    const currentRecord = loaded.resources.find(item => item.id === record.id);
    const histories = new Map();
    for (const path of [`data/${resourceDataPath(model, record)}`, ...slots.map(slot => `data/${slot.path}`)]) {
      const output = await git("log", "--format=%H|%cI", "--", path);
      histories.set(path, output ? output.split("\n").map(line => {
        const [commit, timestamp] = line.split("|");
        return { commit, timestamp };
      }) : []);
    }
    return { loaded, record: currentRecord, histories };
  };
  const assess = async () => { const current = await refresh(); return assessPeriodImpact(current.loaded, current.record, current.histories, coverage, asOf); };
  return { root, record, recordPath, slots, saveRecord, commit, refresh, assess };
}

test("first actual in-period structured or companion change requires an exact-revision impact review", async (context) => {
  for (const mode of ["structured", "companion"]) {
    const fixture = await impactFixture(context);
    assert.equal(await fixture.assess(), null);
    if (mode === "structured") {
      fixture.record.description = "The source now uses a changed collection boundary.";
      await fixture.saveRecord();
    } else {
      await writeFile(join(fixture.root, "data", fixture.slots[0].path), "# Revised procedure\n\nExport every included account and reconcile the filter.\n", "utf8");
    }
    await fixture.commit("2026-10-02", `Record ${mode} operating change`);
    const impact = await fixture.assess();
    assert.equal(impact?.state, "ready", mode);
    assert.equal(impact?.substantive, true, mode);
    assert.ok(impact.reviewedRevision, mode);
    assert.doesNotMatch(impact.message, /changed \d+ times|more than once/i);
  }
});

test("title changes and added proof examples never become blockers merely because change counts increase", async (context) => {
  for (const type of ["component", "source-coverage"]) {
    const fixture = await impactFixture(context, type);
    for (let index = 1; index <= 3; index++) {
      fixture.record.title = `Operating source label ${index}`;
      if (type === "source-coverage") fixture.record.readinessTestEvidenceIds = Array.from({ length: index }, (_, item) => `evidence-example-${item + 1}`);
      await fixture.saveRecord();
      await fixture.commit(`2026-10-0${index + 1}`, "Clarify source label and retrieval examples");
    }
    const impact = await fixture.assess();
    assert.ok(!impact || impact.state === "complete", type);
    assert.ok(!impact || impact.substantive === false, type);
  }
});

test("every Markdown slot is revision-bound and substantive edits stale the review", async (context) => {
  const fixture = await impactFixture(context, "component", true);
  const secondary = fixture.slots.find(({ primary }) => !primary);
  await writeFile(join(fixture.root, "data", secondary.path), "# Retrieval notes\n\nInclude all privileged identities.\n", "utf8");
  await fixture.commit("2026-10-02", "Change secondary procedure slot");
  let current = await fixture.refresh();
  let impact = await assessPeriodImpact(current.loaded, current.record, current.histories, coverage, asOf);
  assert.equal(impact?.state, "ready");
  current.record.periodImpactReview = {
    reviewedByIds: ["person-owner"], reviewedOn: "2026-10-03", effectiveOn: "2026-10-02",
    conclusion: "no-material-change", rationale: "The reviewed extraction still covers the intended population.", reviewedRevision: impact.reviewedRevision
  };
  const review = structuredClone(current.record.periodImpactReview);
  impact = await assessPeriodImpact(current.loaded, current.record, current.histories, coverage, asOf);
  assert.equal(impact.state, "complete");
  current.record.title = "Clearer source label";
  current.record.readinessTestEvidenceIds = ["evidence-extra-example"];
  assert.equal((await assessPeriodImpact(current.loaded, current.record, current.histories, coverage, asOf)).state, "complete");
  await writeFile(join(fixture.root, "data", secondary.path), "# Retrieval notes\n\nUse the replacement population filter.\n", "utf8");
  assert.equal((await assessPeriodImpact(current.loaded, current.record, current.histories, coverage, asOf)).state, "ready");
  assert.deepEqual(current.record.periodImpactReview, review);
  await writeFile(join(fixture.root, "data", secondary.path), "# Retrieval notes\n\nInclude all privileged identities.\n", "utf8");
  current.record.description = "A materially different operational boundary.";
  assert.equal((await assessPeriodImpact(current.loaded, current.record, current.histories, coverage, asOf)).state, "ready");
});

test("impact revision ignores formatting and review metadata but binds all substantive structured facts", async (context) => {
  const fixture = await impactFixture(context);
  const { loaded, record } = await fixture.refresh();
  const before = await currentPeriodImpactRevision(loaded, record);
  const path = join(fixture.root, "data", fixture.slots[0].path);
  const source = await readFile(path, "utf8");
  await writeFile(path, `\r\n${source.replaceAll("\n", "  \r\n")}\r\n`, "utf8");
  record.periodImpactReview = { rationale: "Review metadata does not change the reviewed facts." };
  assert.equal(await currentPeriodImpactRevision(loaded, record), before);
  record.ownerIds = ["person-approver"];
  assert.notEqual(await currentPeriodImpactRevision(loaded, record), before);
});

test("saving an impact review rejects stale companion revisions and never supplies policy approval", async (context) => {
  const fixture = await impactFixture(context);
  const payload = await scaffoldPeriodImpactReview(fixture.root, { resourceId: fixture.record.id });
  Object.assign(payload.review, { reviewedByIds: ["person-owner"], reviewedOn: "2026-10-03", effectiveOn: "2026-10-02", conclusion: "no-material-change", rationale: "Reviewed the actual collection change and continuity." });
  await writeFile(join(fixture.root, "data", fixture.slots[0].path), "# Changed after scaffold\n", "utf8");
  const before = await readFile(fixture.recordPath, "utf8");
  await assert.rejects(recordPeriodImpactReview(fixture.root, payload), /changed|Reload/i);
  assert.equal(await readFile(fixture.recordPath, "utf8"), before);
  assert.match(payload.instructions, /does not approve changed governed content/);
});

test("an impact review leaves changed Policy approval and source continuity gaps actionable", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-impact-independent-gates-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "13");
  const loaded = await loadWorkspace(root);
  const policy = loaded.resources.find(({ type }) => type === "policy");
  const program = loaded.resources.find(({ type }) => type === "program");
  const control = loaded.resources.find(({ type }) => type === "control");
  const source = loaded.resources.find(({ type }) => type === "source-coverage");
  const family = loaded.model.evidenceSourceFamilies[0];
  const policySlot = markdownEntries(loaded.model, policy)[0];
  const approvedRevisions = structuredClone(policy.approvedContentRevisions);
  await writeFile(join(root, "data", policySlot.path), "# Changed policy\n\nThis changed policy requires a new independent approval.\n", "utf8");
  source.sourceFamilyId = family.id;
  source.status = "active";
  source.validFrom = "2026-10-05";
  control.code = family.controlCodes[0];
  program.controlIds = [control.id];
  for (const record of [policy, source]) {
    record.periodImpactReview = {
      reviewedByIds: ["person-example"], reviewedOn: "2026-10-06", effectiveOn: "2026-10-05",
      conclusion: "material-change-reviewed", rationale: "Recorded the actual change and current continuity decision.",
      reviewedRevision: await currentPeriodImpactRevision(loaded, record)
    };
  }
  const validation = await validateWorkspace(loaded);
  assert.ok(validation.diagnostics.some(({ code, path }) => code === "approval-content-changed" && path.includes(policy.id)));
  assert.deepEqual(policy.approvedContentRevisions, approvedRevisions);
  const workflow = await assessWorkflow(loaded, {
    asOf, now: "2026-10-10T12:00:00Z", coverage, programId: program.id,
    programReadiness: { stages: [], evidenceReady: false, program: { id: program.id } }, auditPreparations: {},
    validation, obligations: { items: [], triggers: [], counts: {}, through: asOf }, reconciliation: { candidates: [] }, git: {}
  });
  assert.equal(workflow.findings.find(({ code }) => code === `period.coverage.source-coverage.${source.id}`)?.state, "ready");
  assert.ok(workflow.findings.some(({ code, state }) => code.includes("approval-content-changed") && state === "ready"));
});

test("impact review needs the actual resource owner or an existing scoped Policy Owner", async context => {
  const fixture = await impactFixture(context);
  const payload = await scaffoldPeriodImpactReview(fixture.root, { resourceId: fixture.record.id });
  payload.review = { ...payload.review, reviewedByIds: ["person-approver"], reviewedOn: "2026-10-10", effectiveOn: "2026-10-02", conclusion: "no-material-change", rationale: "The source procedure remains available." };
  const before = await readFile(fixture.recordPath, "utf8");
  await assert.rejects(recordPeriodImpactReview(fixture.root, payload), /resource owner or scoped Policy Owner/);
  assert.equal(await readFile(fixture.recordPath, "utf8"), before);
});

test("one current no-material impact decision answers only its exact listed materiality transitions", async context => {
  const fixture = await impactFixture(context, "system");
  fixture.record.boundary += " Clarified existing operations.";
  await fixture.saveRecord();
  await fixture.commit("2026-10-02", "Clarify existing boundary");
  const candidates = plan => plan.candidates.filter(item => item.eventType === "system-material-change");
  assert.equal(candidates(await planReconciliation(fixture.root)).length, 1);
  const payload = await scaffoldPeriodImpactReview(fixture.root, { resourceId: fixture.record.id });
  assert.equal(payload.materialityQuestions.length, 1);
  assert.equal(payload.review.reviewedTransitionKeys.length, 1);
  Object.assign(payload.review, { reviewedByIds: ["person-owner"], reviewedOn: "2026-10-03", effectiveOn: "2026-10-02", conclusion: "no-material-change", rationale: "Reviewed the listed transition against actual unchanged operation and source continuity." });
  await recordPeriodImpactReview(fixture.root, payload);
  assert.equal(candidates(await planReconciliation(fixture.root)).length, 0);
  const raw = await planReconciliation(fixture.root, { includeHandled: true });
  assert.equal(candidates(raw).length, 1, "Git retains the actual transition");
  assert.equal(candidates(raw)[0].periodImpactKey, payload.review.reviewedTransitionKeys[0], "review metadata cannot change the question identity");
  const saved = JSON.parse(await readFile(fixture.recordPath, "utf8"));
  for (const [label, mutate] of [
    ["not a materiality decision", record => { record.periodImpactReview.conclusion = "material-change-reviewed"; }],
    ["no exact transition binding", record => { record.periodImpactReview.reviewedTransitionKeys = []; }],
    ["wrong transition binding", record => { record.periodImpactReview.reviewedTransitionKeys = ["different-transition"]; }],
    ["unauthorized reviewer", record => { record.periodImpactReview.reviewedByIds = ["person-approver"]; }],
    ["later actual change", record => { record.boundary += " New processing boundary."; }]
  ]) {
    const record = structuredClone(saved); mutate(record);
    await writeFile(fixture.recordPath, JSON.stringify(record, null, 2) + "\n");
    assert.ok(candidates(await planReconciliation(fixture.root)).length > 0, label);
  }
  await writeFile(fixture.recordPath, JSON.stringify(saved, null, 2) + "\n");
  assert.equal(candidates(await planReconciliation(fixture.root)).length, 0);
});

test("owner Appointment authority must cover the actual impact-review date", async context => {
  const fixture = await impactFixture(context);
  const { periodImpactReviewersAuthorized } = await import("../src/period-impact.js");
  const { loaded } = await fixture.refresh();
  const appointment = { id:"appointment-future-owner",type:"appointment",title:"Policy Owner",status:"active",appointmentKind:"policy-owner",holderId:"person-owner",scopeResourceIds:[loaded.workspace.id],startsOn:"2026-10-01" };
  loaded.resources.push(appointment);
  const record = {...fixture.record,ownerIds:[appointment.id]};
  assert.equal(periodImpactReviewersAuthorized(loaded,record,{reviewedByIds:["person-owner"],reviewedOn:"2026-09-01"}),false);
  assert.equal(periodImpactReviewersAuthorized(loaded,record,{reviewedByIds:["person-owner"],reviewedOn:"2026-10-10"}),true);
  appointment.endsOn="2026-10-05";
  assert.equal(periodImpactReviewersAuthorized(loaded,record,{reviewedByIds:["person-owner"],reviewedOn:"2026-10-10"}),false);
});

test("semantic lineage survives unrelated commits and recording reviewed work, but not change/revert/repeat", async context => {
  for (const type of ["component", "source-coverage", "system"]) {
    const fixture = await impactFixture(context, type);
    const field = type === "system" ? "boundary" : "description";
    const original = fixture.record[field];
    fixture.record[field] += " Clarified existing operations.";
    await fixture.saveRecord();
    const current = await fixture.refresh();
    fixture.record.periodImpactReview = {
      reviewedByIds: ["person-owner"], reviewedOn: "2026-10-03", effectiveOn: "2026-10-02", conclusion: "no-material-change",
      rationale: "Reviewed the actual unchanged service and continuity.", reviewedRevision: await currentPeriodImpactRevision(current.loaded, current.record)
    };
    await fixture.saveRecord();
    await writeFile(join(fixture.root, "notes.md"), "Unrelated repository notes.\n");
    await fixture.commit("2026-10-03", "Update unrelated notes", ["notes.md"]);
    let refreshed = await fixture.refresh();
    assert.equal(await periodImpactReviewCurrent(refreshed.loaded, refreshed.record, asOf), true, `${type}: unrelated commit`);
    await fixture.commit("2026-10-04", "Record already reviewed working change");
    refreshed = await fixture.refresh();
    assert.equal(await periodImpactReviewCurrent(refreshed.loaded, refreshed.record, asOf), true, `${type}: committing reviewed work`);
    const markdown = join(fixture.root, "data", fixture.slots[0].path);
    await writeFile(markdown, (await readFile(markdown, "utf8")).replaceAll("\n", "  \n"));
    await fixture.commit("2026-10-05", "Normalize procedure whitespace");
    refreshed = await fixture.refresh();
    assert.equal(await periodImpactReviewCurrent(refreshed.loaded, refreshed.record, asOf), true, `${type}: benign whitespace`);
    fixture.record[field] = original;
    await fixture.saveRecord(); await fixture.commit("2026-10-06", "Change operating facts");
    fixture.record[field] += " Clarified existing operations.";
    await fixture.saveRecord(); await fixture.commit("2026-10-07", "Repeat previous operating state");
    refreshed = await fixture.refresh();
    assert.equal(await periodImpactReviewCurrent(refreshed.loaded, refreshed.record, asOf), false, `${type}: repeated state`);
    assert.equal((await fixture.assess()).state, "ready", `${type}: repeated state requires new review`);
  }
});

test("working materiality keys ignore unrelated HEAD movement and survive committing the reviewed transition", async context => {
  const fixture = await impactFixture(context, "system");
  fixture.record.boundary += " Existing boundary clarification."; await fixture.saveRecord();
  const payload = await scaffoldPeriodImpactReview(fixture.root, { resourceId: fixture.record.id });
  Object.assign(payload.review, { reviewedByIds: ["person-owner"], reviewedOn: "2026-10-03", effectiveOn: "2026-10-02", conclusion: "no-material-change", rationale: "Reviewed the exact listed before and after boundary." });
  await recordPeriodImpactReview(fixture.root, payload);
  const questions = async () => (await planReconciliation(fixture.root)).candidates.filter(candidate => candidate.eventType === "system-material-change");
  assert.equal((await questions()).length, 0);
  await writeFile(join(fixture.root, "notes.md"), "Unrelated notes.\n");
  await fixture.commit("2026-10-03", "Change unrelated notes", ["notes.md"]);
  assert.equal((await questions()).length, 0);
  await fixture.commit("2026-10-04", "Commit reviewed transition");
  assert.equal((await questions()).length, 0);
  const reviewed = JSON.parse(await readFile(fixture.recordPath, "utf8"));
  const originalBoundary = "Company-managed service.";
  await writeFile(fixture.recordPath, JSON.stringify({ ...reviewed, boundary: originalBoundary }, null, 2) + "\n");
  await fixture.commit("2026-10-05", "Change service boundary again");
  await writeFile(fixture.recordPath, JSON.stringify(reviewed, null, 2) + "\n");
  await fixture.commit("2026-10-06", "Repeat old boundary");
  const repeated = await questions();
  assert.ok(repeated.some(candidate => !reviewed.periodImpactReview.reviewedTransitionKeys.includes(candidate.periodImpactKey)));
});

test("re-recording a current decision retains its exact answered questions", async context => {
  const fixture = await impactFixture(context, "system");
  fixture.record.boundary += " Existing boundary clarification."; await fixture.saveRecord();
  const fill = payload => Object.assign(payload.review, { reviewedByIds: ["person-owner"], reviewedOn: "2026-10-03", effectiveOn: "2026-10-02", conclusion: "no-material-change", rationale: "Reviewed the unchanged operation and listed transition." });
  const first = await scaffoldPeriodImpactReview(fixture.root, { resourceId: fixture.record.id }); fill(first);
  await recordPeriodImpactReview(fixture.root, first);
  const second = await scaffoldPeriodImpactReview(fixture.root, { resourceId: fixture.record.id }); fill(second);
  assert.deepEqual(second.review.reviewedTransitionKeys, first.review.reviewedTransitionKeys);
  assert.equal(second.materialityQuestions.length, 0, "do not ask the answered question again");
  await recordPeriodImpactReview(fixture.root, second);
  assert.equal((await planReconciliation(fixture.root)).candidates.filter(candidate => candidate.eventType === "system-material-change").length, 0);
});

test("an absent optional companion does not stale reviewed work when committed", async context => {
  const fixture = await impactFixture(context, "system");
  await rm(join(fixture.root, "data", fixture.slots[0].path));
  await fixture.commit("2026-10-01", "Remove empty optional companion");
  fixture.record.boundary += " Existing boundary clarification."; await fixture.saveRecord();
  const payload = await scaffoldPeriodImpactReview(fixture.root, { resourceId: fixture.record.id });
  Object.assign(payload.review, { reviewedByIds: ["person-owner"], reviewedOn: "2026-10-03", effectiveOn: "2026-10-02", conclusion: "no-material-change", rationale: "Reviewed the operation with no optional companion." });
  await recordPeriodImpactReview(fixture.root, payload);
  await fixture.commit("2026-10-04", "Commit reviewed work without companion");
  const current = await fixture.refresh();
  assert.equal(await periodImpactReviewCurrent(current.loaded, current.record, asOf), true);
  assert.equal((await planReconciliation(fixture.root)).candidates.filter(candidate => candidate.eventType === "system-material-change").length, 0);
});

test("a later change retains the historical answer but requires a new current impact decision", async context => {
  const fixture = await impactFixture(context, "system");
  fixture.record.boundary += " First reviewed clarification."; await fixture.saveRecord();
  await fixture.commit("2026-10-02", "Record first boundary clarification");
  const payload = await scaffoldPeriodImpactReview(fixture.root, { resourceId: fixture.record.id });
  Object.assign(payload.review, { reviewedByIds: ["person-owner"], reviewedOn: "2026-10-03", effectiveOn: "2026-10-02", conclusion: "no-material-change", rationale: "Reviewed the first exact transition." });
  await recordPeriodImpactReview(fixture.root, payload);
  await fixture.commit("2026-10-03", "Record first owner decision");
  const record = JSON.parse(await readFile(fixture.recordPath, "utf8"));
  record.boundary += " New processing boundary.";
  await writeFile(fixture.recordPath, JSON.stringify(record, null, 2) + "\n");
  const plan = await planReconciliation(fixture.root);
  const questions = plan.candidates.filter(candidate => candidate.eventType === "system-material-change");
  assert.equal(questions.length, 1);
  assert.ok(!payload.review.reviewedTransitionKeys.includes(questions[0].periodImpactKey));
  const current = await fixture.refresh();
  assert.equal(await periodImpactReviewCurrent(current.loaded, current.record, asOf), false);
  assert.equal((await fixture.assess()).state, "ready");
});

test("ordinary service inventory history does not invent an evidence-source review", async context => {
  const fixture = await impactFixture(context);
  delete fixture.record.evidenceSourceKinds;
  fixture.record.systemUses[0].roles = ["supporting-operations"];
  await fixture.saveRecord(); await fixture.commit("2026-09-29", "Record supporting service role");
  await writeFile(join(fixture.root, "data", fixture.slots[0].path), "# Supplier review context\n\nThe provider remains within the approved business-use boundary.\n");
  await fixture.commit("2026-10-03", "Record current supplier context");
  let impact = await fixture.assess();
  assert.equal(impact.state, "complete"); assert.match(impact.message, /not an authoritative evidence source/);
  for (const source of [
    { id: "control-live-source", type: "control", status: "implemented", evidenceSourceComponentIds: [fixture.record.id] },
    { id: "coverage-live-source", type: "source-coverage", status: "active", componentId: fixture.record.id }
  ]) {
    const current = await fixture.refresh(); current.loaded.resources.push(source);
    impact = await assessPeriodImpact(current.loaded, current.record, current.histories, coverage, asOf);
    assert.equal(impact.state, "ready", source.type);
  }
});

test("a historical owner review cannot answer another resource's copied materiality key", async context => {
  const fixture = await impactFixture(context, "system");
  const other = { ...fixture.record, id: "system-other-owner", title: "Other owned service", ownerIds: ["person-approver"] };
  const otherPath = join(fixture.root, "data/systems", `${other.id}.json`);
  await writeFile(otherPath, JSON.stringify(other, null, 2) + "\n");
  await fixture.commit("2026-09-29", "Record another owner's service");
  fixture.record.boundary += " Actual changed boundary."; await fixture.saveRecord();
  await fixture.commit("2026-10-02", "Change the first service");
  const question = (await planReconciliation(fixture.root)).candidates.find(candidate => candidate.subject.id === fixture.record.id);
  const loaded = await loadWorkspace(fixture.root);
  other.periodImpactReview = { reviewedByIds: ["person-approver"], reviewedOn: "2026-10-03", effectiveOn: "2026-10-02", conclusion: "no-material-change",
    rationale: "The other owner reviewed this other service only.", reviewedRevision: await currentPeriodImpactRevision(loaded, other), reviewedTransitionKeys: [question.periodImpactKey] };
  await writeFile(otherPath, JSON.stringify(other, null, 2) + "\n");
  await fixture.commit("2026-10-03", "Record another service's review");
  const current = await loadWorkspace(fixture.root), reviewedOther = current.resources.find(record => record.id === other.id);
  assert.equal(await periodImpactReviewCurrent(current, reviewedOther, asOf), true);
  assert.ok((await planReconciliation(fixture.root)).candidates.some(candidate => candidate.subject.id === fixture.record.id), "an opaque foreign key conveys no authority over the actual changed resource");
});

test("a historical review cannot pre-authorize an unperformed future transition by copying its key", async context => {
  const fixture = await impactFixture(context, "system");
  const beforeBoundary = fixture.record.boundary;
  fixture.record.boundary += " Planned replacement boundary."; await fixture.saveRecord();
  const future = (await planReconciliation(fixture.root)).candidates.find(candidate => candidate.subject.id === fixture.record.id);
  fixture.record.boundary = beforeBoundary; await fixture.saveRecord();
  const loaded = await loadWorkspace(fixture.root);
  fixture.record.periodImpactReview = { reviewedByIds: ["person-owner"], reviewedOn: "2026-10-01", effectiveOn: "2026-09-28", conclusion: "no-material-change",
    rationale: "Reviewed the still-unchanged current service.", reviewedRevision: await currentPeriodImpactRevision(loaded, fixture.record), reviewedTransitionKeys: [future.periodImpactKey] };
  await fixture.saveRecord(); await fixture.commit("2026-10-01", "Record unchanged service review");
  fixture.record.boundary += " Planned replacement boundary."; await fixture.saveRecord();
  await fixture.commit("2026-10-02", "Actually change the service later");
  const questions = (await planReconciliation(fixture.root)).candidates.filter(candidate => candidate.subject.id === fixture.record.id);
  assert.equal(questions.length, 1);
  assert.equal(questions[0].periodImpactKey, future.periodImpactKey);
});
