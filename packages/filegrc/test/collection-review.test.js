import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  applyCollectionReview,
  assessCollectionReview,
  buildAgentGuide,
  loadWorkspace,
  planCollectionReview,
  scaffoldCollectionReview,
  serveWorkspace,
  updateResource
} from "../src/index.js";
import { makeWorkspace } from "./helpers.js";

test("binds a collection confirmation to the exact records and material scope", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-collection-review-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  let loaded = await loadWorkspace(root);
  await updateResource(root, "workspace", loaded.workspace.id, {
    ...loaded.workspace,
    dataModelVersion: "3",
    assuranceGoal: "readiness",
    systemIds: [],
    frameworkIds: [],
    requirementIds: [],
    controlIds: []
  });

  loaded = await loadWorkspace(root);
  const before = assessCollectionReview(loaded, "person");
  assert.equal(before.status, "review-required");
  assert.equal(before.recordCount, 2);
  assert.equal(before.configuration.reviewPoints.length, 2);
  assert.deepEqual(await scaffoldCollectionReview(root, { resourceType: "person" }), {
    resourceType: "person",
    decision: "complete",
    rationale: null,
    reviewedByIds: [],
    reviewedOn: null,
    authoritativeSystemId: null
  });

  const plan = await planCollectionReview(root, {
    resourceType: "person",
    decision: "complete",
    rationale: "Confirmed every current program participant and role reference.",
    reviewedByIds: ["person-approver"],
    reviewedOn: "2026-08-03",
    scopeRevision: "scope-review-1"
  });
  assert.equal(plan.changes.create[0].collectionRevision, before.collectionRevision);

  await applyCollectionReview(root, {
    resourceType: "person",
    decision: "complete",
    rationale: "Confirmed every current program participant and role reference.",
    reviewedByIds: ["person-approver"],
    reviewedOn: "2026-08-03",
    scopeRevision: "scope-review-1",
    confirmed: true
  });

  loaded = await loadWorkspace(root);
  assert.equal(assessCollectionReview(loaded, "person").status, "current");
  const guide = buildAgentGuide(loaded, "person");
  assert.equal(guide.reviewRequirements.collectionReview.status, "current");
  assert.match(guide.reviewRequirements.collectionReview.command, /review-collection person/);
  const review = loaded.resources.find((record) => record.type === "collection-review");
  await assert.rejects(
    updateResource(root, "collection-review", review.id, {
      ...review,
      decision: "not-applicable"
    }),
    /must use one of: complete/
  );

  const owner = loaded.resources.find((record) => record.id === "person-owner");
  await updateResource(root, "person", owner.id, {
    ...owner,
    jobTitle: "Chief Executive and Security Officer"
  });
  loaded = await loadWorkspace(root);
  assert.equal(assessCollectionReview(loaded, "person").status, "stale");

  await applyCollectionReview(root, {
    resourceType: "person",
    decision: "complete",
    rationale: "Reconfirmed participants after the role title changed.",
    reviewedByIds: ["person-approver"],
    reviewedOn: "2026-08-04",
    scopeRevision: "scope-review-2",
    confirmed: true
  });
  loaded = await loadWorkspace(root);
  const workspace = loaded.workspace;
  await updateResource(root, "workspace", workspace.id, {
    ...workspace,
    candidateCoverage: {
      kind: "as-of",
      on: "2026-08-31"
    }
  });
  loaded = await loadWorkspace(root);
  assert.equal(assessCollectionReview(loaded, "person").status, "stale");
});

test("exposes collection confirmation preview and apply through the browser API", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-collection-review-api-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  let loaded = await loadWorkspace(root);
  await updateResource(root, "workspace", loaded.workspace.id, {
    ...loaded.workspace,
    dataModelVersion: "3"
  });

  const running = await serveWorkspace(root, { port: 0, writesAllowed: true });
  context.after(() => new Promise((resolve) => running.server.close(resolve)));
  const payload = {
    resourceType: "person",
    decision: "complete",
    rationale: "Confirmed current people and their program roles.",
    reviewedByIds: ["person-approver"],
    reviewedOn: "2026-08-03"
  };
  const previewResponse = await fetch(`${running.url}/api/collection-review/preview`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  assert.equal(previewResponse.status, 200);
  assert.equal((await previewResponse.json()).resourceType, "person");

  const applyResponse = await fetch(`${running.url}/api/collection-review`, {
    method: "POST",
    headers: { "content-type": "application/json", prefer: "respond-async" },
    body: JSON.stringify({ ...payload, confirmed: true })
  });
  assert.equal(applyResponse.status, 201);
  const applied = await applyResponse.json();
  assert.equal(applied.state, undefined);
  assert.equal(applied.stateRefresh, true);
  assert.equal(applied.assessment.status, "current");
  const refreshed = await fetch(`${running.url}/api/state`).then((response) => response.json());
  assert.equal(refreshed.collectionReviews.person.status, "current");

  const standardResponse = await fetch(`${running.url}/api/collection-review`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...payload,
      rationale: "Confirmed again through the standard API response.",
      expectedRevision: refreshed.collectionReviews.person.reviewRevision,
      confirmed: true
    })
  });
  assert.equal(standardResponse.status, 201);
  assert.equal((await standardResponse.json()).state.collectionReviews.person.status, "current");
});
