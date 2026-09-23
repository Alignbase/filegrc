import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applicabilityReviewIsCurrent, applicabilityScopeRevision } from "../src/applicability-scope.js";
import { collectionReviewRevision, historicalCollectionReviewSnapshot } from "../src/collection-review-integrity.js";
import { collectionRevision, collectionRevisionMatches, legacyCollectionRevision } from "../src/collection-revision.js";
import { scopedCollectionRecords } from "../src/collection-scope.js";
import { contentRevisionBindingsMatch } from "../src/program-lifecycle.js";
import { reportingRouteRevision } from "../src/reporting-route-integrity.js";
import { assessRequirementMappingReadiness } from "../src/requirement-mapping.js";
import { resourceReviewRevisions, retentionReviewResourceIds } from "../src/retention.js";
import { revisionsMatch } from "../src/revisions.js";
import { currentCalendarDate } from "../src/time.js";
import { validateWorkspace } from "../src/validate.js";
import { loadWorkspace } from "../src/workspace.js";
import { makeComprehensiveWorkspace } from "./fixtures.js";

test("reads legacy approval, activation, attestation, and applicability bindings without rewriting records", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-revision-upgrade-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");

  let before = await loadWorkspace(root);
  const programEntry = before.entries.find(({ record }) => record.type === "program");
  const reviewedRequirement = before.resources.find(({ type, id }) => (
    type === "requirement"
    && programEntry.record.requirementApplicability.some(({ requirementId }) => requirementId === id)
  ));
  const currentScopeRevision = applicabilityScopeRevision(
    reviewedRequirement,
    programEntry.record,
    before.resources,
    before.model
  );
  for (const review of programEntry.record.requirementApplicability || []) {
    review.scopeRevision = `scope:${digest(currentScopeRevision)}`;
  }
  await writeFile(programEntry.path, `${JSON.stringify(programEntry.record, null, 2)}\n`);
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: root });
  execFileSync("git", ["config", "user.name", "FileGRC Test"], { cwd: root });
  execFileSync("git", ["config", "user.email", "filegrc@example.test"], { cwd: root });
  execFileSync("git", ["add", "data"], { cwd: root });
  execFileSync("git", ["commit", "-m", "Create legacy revision fixture"], { cwd: root });
  const validation = await validateWorkspace(root);
  assert.equal(validation.ok, true, validation.diagnostics.map(({ message }) => message).join("\n"));
  assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }), "");

  const document = before.resources.find(({ type }) => type === "document");
  assert.ok(Object.values(document.approvedContentRevisions).every((value) => /^[a-f0-9]{64}$/.test(value)));
  assert.equal(contentRevisionBindingsMatch(document.approvedContentRevisions, document.activatedContentRevisions), true);

  const program = before.resources.find(({ type }) => type === "program");
  const requirement = before.resources.find(({ type, id }) => (
    type === "requirement" && program.requirementApplicability.some(({ requirementId }) => requirementId === id)
  ));
  const review = program.requirementApplicability.find(({ requirementId }) => requirementId === requirement.id);
  assert.equal(applicabilityReviewIsCurrent(review, requirement, program, before.resources, before.model), true);
  assert.ok(review.scopeRevision.startsWith("scope:"));
});

test("accepts legacy collection, applicability, collection-review, and reporting-route revisions during upgrade", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-revision-compatibility-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const program = loaded.resources.find(({ type }) => type === "program");
  const collection = collectionRevision(loaded, "person", { program });
  assert.equal(collectionRevisionMatches(loaded, "person", digest(collection), { program, currentRevision: collection }), true);
  assert.equal(digest(collection), legacyCollectionRevision(loaded, "person", { program }));
  assert.equal(digest(collectionRevision(loaded, "control", { program })), legacyCollectionRevision(loaded, "control", { program }));

  const control = loaded.resources.find(({ type }) => type === "control");
  const applicability = applicabilityScopeRevision(control, program, loaded.resources, loaded.model);
  assert.equal(applicabilityReviewIsCurrent(
    { scopeRevision: `scope:${digest(applicability)}` },
    control,
    program,
    loaded.resources,
    loaded.model
  ), true);

  const collectionReview = {
    id: "collection-review-example",
    type: "collection-review",
    title: "Example review",
    resourceType: "person",
    decision: "complete",
    rationale: "Reviewed.",
    reviewedByIds: ["person-example"],
    reviewedOn: "2026-09-23",
    collectionRevision: collection,
    scopeRevision: "0123456789abcdef"
  };
  const reviewRevision = collectionReviewRevision(collectionReview);
  assert.equal(digest(reviewRevision), createHash("sha256").update(JSON.stringify({
    ...collectionReview,
    collectionRevision: digest(collection)
  })).digest("hex"));
  assert.equal(revisionsMatch("collection-review", digest(reviewRevision), reviewRevision), true);
  assert.equal(revisionsMatch(
    "collection-review",
    collectionReviewRevision({ ...collectionReview, collectionRevision: digest(collection) }),
    reviewRevision
  ), true);

  const routeRevision = reportingRouteRevision({
    id: "route-example",
    type: "reporting-route",
    title: "Route",
    purpose: "security-reporting",
    priority: "primary",
    channelKind: "email",
    route: "security@example.test"
  });
  assert.equal(revisionsMatch("reporting-route", digest(routeRevision), routeRevision), true);
});

test("scheme labels do not require a new collection review, but changed facts do", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-revision-stability-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const program = loaded.resources.find(({ type }) => type === "program");
  const document = loaded.resources.find(({ type, approvedContentRevisions }) => (
    type === "document" && Object.keys(approvedContentRevisions || {}).length
  ));
  assert.ok(document, "fixture has a governed document");
  const reviewed = collectionRevision(loaded, "document", { program });
  document.approvedContentRevisions = Object.fromEntries(Object.entries(document.approvedContentRevisions).map(([path, value]) => [
    path,
    `filegrc:content:v1:sha256:${digest(value)}`
  ]));
  assert.equal(collectionRevision(loaded, "document", { program }), reviewed);
  document.title = `${document.title} revised`;
  assert.notEqual(collectionRevision(loaded, "document", { program }), reviewed);
  const exampleDigest = digest(Object.values(document.approvedContentRevisions)[0]);
  document.title = exampleDigest;
  const changedTitleRevision = collectionRevision(loaded, "document", { program });
  document.title = `filegrc:content:v1:sha256:${exampleDigest}`;
  assert.notEqual(collectionRevision(loaded, "document", { program }), changedTitleRevision);
});

test("scheme-only source labels preserve retention and mapping review bindings", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-source-review-stability-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const documentEntry = loaded.entries.find(({ record }) => (
    record.type === "document" && Object.keys(record.approvedContentRevisions || {}).length
  ));
  const target = loaded.resources.find(({ type }) => type === "requirement");
  assert.ok(documentEntry && target);
  const ids = [documentEntry.record.id, target.id];
  const original = await resourceReviewRevisions(loaded, ids);
  const mapping = {
    id: "requirement-mapping-revision-stability",
    type: "requirement-mapping",
    title: "Review binding stability",
    status: "active",
    sourceResourceIds: [documentEntry.record.id],
    targetResourceIds: [target.id],
    relationship: "intersects-with",
    method: "semantic",
    rationale: "Reviewed both source records.",
    ownerIds: ["person-example"],
    reviewedByIds: ["person-independent-approver-example"],
    reviewedOn: "2026-09-23",
    reviewedSourceRevisions: Object.fromEntries([...original].map(([id, revision]) => [id, digest(revision)]))
  };
  loaded.resources.push(mapping);
  documentEntry.record.approvedContentRevisions = Object.fromEntries(Object.entries(documentEntry.record.approvedContentRevisions).map(([path, value]) => [
    path,
    `filegrc:content:v1:sha256:${digest(value)}`
  ]));
  documentEntry.source = `${JSON.stringify(documentEntry.record, null, 2)}\n`;
  const relabeled = await resourceReviewRevisions(loaded, ids);
  assert.deepEqual(relabeled, original);
  assert.equal((await assessRequirementMappingReadiness(loaded)).find(({ id }) => id === `requirement-mapping-${mapping.id}`).status, "complete");
  documentEntry.record.title = `${documentEntry.record.title} updated`;
  documentEntry.source = `${JSON.stringify(documentEntry.record, null, 2)}\n`;
  assert.notEqual((await resourceReviewRevisions(loaded, [documentEntry.record.id])).get(documentEntry.record.id), original.get(documentEntry.record.id));
});

test("committed legacy collection, occurrence, and retention bindings stay readable without another review", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-committed-legacy-revisions-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  let loaded = await loadWorkspace(root);
  const rowEntry = loaded.entries.find(({ record }) => record.type === "retention-schedule-item");
  const sources = retentionReviewResourceIds(rowEntry.record, loaded);
  rowEntry.record.reviewedSourceRevisions = Object.fromEntries(
    [...await resourceReviewRevisions(loaded, sources)].map(([id, revision]) => [id, digest(revision)])
  );
  await writeFile(rowEntry.path, `${JSON.stringify(rowEntry.record, null, 2)}\n`);
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "--initial-branch=main");
  git("config", "user.name", "FileGRC Test");
  git("config", "user.email", "filegrc@example.test");
  git("add", "data");
  git("commit", "-m", "Record legacy source bindings");
  const scopeCommit = git("rev-parse", "HEAD");

  loaded = await loadWorkspace(root);
  const program = loaded.resources.find(({ type }) => type === "program");
  const date = currentCalendarDate(loaded.workspace.timezone);
  const reviewEntry = loaded.entries.find(({ record }) => record.type === "collection-review");
  const review = {
    ...reviewEntry.record,
    status: "active",
    decision: "complete",
    rationale: "Reviewed the scoped people.",
    reviewedByIds: ["person-independent-approver-example"],
    reviewedOn: date,
    coverage: { kind: "as-of", on: date },
    knowledgeCutoffAt: new Date().toISOString(),
    populationResourceIds: scopedCollectionRecords(loaded, "person", program).map(({ id }) => id),
    collectionRevision: digest(collectionRevision(loaded, "person", { program })),
    scopeRevision: scopeCommit
  };
  await writeFile(reviewEntry.path, `${JSON.stringify(review, null, 2)}\n`);
  git("add", "data");
  git("commit", "-m", "Record legacy collection review");
  const reviewCommit = git("rev-parse", "HEAD");

  loaded = await loadWorkspace(root);
  const committedReview = loaded.resources.find(({ id }) => id === review.id);
  const snapshot = historicalCollectionReviewSnapshot(
    root,
    committedReview,
    loaded.model,
    loaded.workspace.timezone,
    "person",
    date,
    null,
    reviewEntry.relativePath,
    reviewCommit
  );
  assert.equal(snapshot?.reviewCommit, reviewCommit);
  const occurrenceBinding = {
    collectionReviewCommit: reviewCommit,
    collectionReviewRevision: digest(collectionReviewRevision(committedReview)),
    collectionRevision: committedReview.collectionRevision,
    scopeRevision: scopeCommit
  };
  assert.equal(revisionsMatch("collection-review", occurrenceBinding.collectionReviewRevision, collectionReviewRevision(committedReview)), true);
  assert.equal(revisionsMatch("collection", occurrenceBinding.collectionRevision, collectionRevision(loaded, "person", { program })), true);

  const row = loaded.resources.find(({ id }) => id === rowEntry.record.id);
  const currentSources = await resourceReviewRevisions(loaded, retentionReviewResourceIds(row, loaded));
  assert.ok(Object.entries(row.reviewedSourceRevisions).every(([id, revision]) => (
    revisionsMatch("content", revision, currentSources.get(id))
  )));
  const validation = await validateWorkspace(root);
  assert.equal(validation.ok, true, validation.diagnostics.map(({ message }) => message).join("\n"));
  assert.equal(git("status", "--porcelain"), "");
});

function digest(value) {
  return String(value).slice(-64);
}
