import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createAppState, createResources, getBrowserRepositoryState, getGitSummary, getRepositorySnapshot, getWorkspaceHistories, prefetchBrowserRemote, runBrowserMutation, serveWorkspace, updateResource } from "../src/index.js";
import {
  BROWSER_VALIDATION,
  commitAndPushWorkspace,
  commitWorkspace,
  getChangedDataPathsSinceRevision,
  getFileAtRevision,
  getFilesAtRevisions,
  getFileHistory,
  GitOperationError,
  hasGitRevision,
  pullWorkspace,
  pushWorkspace,
  runGitCommand,
  sanitizeGitErrorMessage,
  setGitCommandInterceptorForTests
} from "../src/git.js";
import { collectTimings } from "../src/timing.js";
import { makeComprehensiveWorkspace } from "./fixtures.js";
import { makeWorkspace, writeJson } from "./helpers.js";

const execute = promisify(execFile);

test("scopes Git status and file histories to a workspace nested in a larger repository", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "filegrc-nested-git-"));
  const root = join(parent, "compliance");
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(parent, { recursive: true, force: true })));
  await makeWorkspace(root);
  await writeFile(join(parent, "outside.txt"), "outside\n", "utf8");
  await writeFile(join(root, "rename-me.txt"), "rename boundary test\n", "utf8");
  assert.deepEqual(
    getWorkspaceHistories(root, ["data/people/person-owner.json"])
      .get("data/people/person-owner.json"),
    []
  );
  assert.throws(
    () => getWorkspaceHistories(root, ["data/people/person-owner.json"], 12, { strict: true }),
    /Git history is unavailable/
  );
  await git(parent, ["init"]);
  await git(parent, ["config", "user.name", "Test User"]);
  await git(parent, ["config", "user.email", "test@example.test"]);
  await git(parent, ["add", "."]);
  await git(parent, ["commit", "-m", "Initialize nested workspace"]);
  const initialCommit = getGitSummary(root).commit;
  assert.equal(hasGitRevision(root, initialCommit), true);
  assert.equal(JSON.parse(getFileAtRevision(root, initialCommit, "data/people/person-owner.json")).title, "Program Owner");
  const historicalFiles = getFilesAtRevisions(root, [
    { revision: initialCommit, relativePath: "data/people/person-owner.json" },
    { revision: initialCommit, relativePath: "data/people/missing.json" },
    { revision: initialCommit, relativePath: "data/workspace.json" }
  ]);
  assert.equal(JSON.parse(historicalFiles[0]).title, "Program Owner");
  assert.equal(historicalFiles[1], null);
  assert.equal(JSON.parse(historicalFiles[2]).id, "workspace");
  assert.throws(
    () => getFilesAtRevisions(root, [{ revision: initialCommit, relativePath: "data/people/person-owner.json\nHEAD:package.json" }]),
    /require a Git commit and a data\/ path/
  );
  assert.equal(hasGitRevision(root, "0000000000000000000000000000000000000000"), false);
  assert.equal(hasGitRevision(root, "not-a-commit"), false);
  assert.equal(getFileHistory(root, "data/../outside.txt"), null);
  assert.equal(getFileHistory(root, "/data/people/person-owner.json"), null);
  assert.throws(
    () => getFileAtRevision(root, initialCommit, "data/../outside.txt"),
    /Git commit and a data\/ path/
  );
  assert.throws(
    () => getFileAtRevision(root, initialCommit, "data\\people\\person-owner.json"),
    /Git commit and a data\/ path/
  );

  await git(parent, ["mv", "compliance/rename-me.txt", "renamed-outside.txt"]);
  assert.equal((await getRepositorySnapshot(root, { fresh: true })).clean, false);
  await git(parent, ["mv", "renamed-outside.txt", "compliance/rename-me.txt"]);
  assert.equal((await getRepositorySnapshot(root, { fresh: true })).clean, true);

  await writeFile(join(parent, "outside.txt"), "changed outside\n", "utf8");
  assert.equal(getGitSummary(root).clean, true);

  await writeFile(join(root, "data", "people", "person-owner.json"), "{}\n", "utf8");
  await assert.rejects(commitWorkspace(root, "Commit invalid workspace"), /validation error/);
  await writeFile(join(root, "data", "people", "person-owner.json"), `${JSON.stringify({
    id: "person-owner",
    type: "person",
    affiliation: "internal",
    title: "Program Owner",
    status: "active",
    department: "Security"
  }, null, 2)}\n`, "utf8");
  const summary = getGitSummary(root);
  assert.equal(summary.clean, false);
  assert.equal(summary.changes.length, 1);

  const histories = getWorkspaceHistories(root, ["data/people/person-owner.json"]);
  assert.equal(histories.get("data/people/person-owner.json").length, 1);
  assert.equal(
    getWorkspaceHistories(root, ["data/people/person-owner.json"], 12, { strict: true })
      .get("data/people/person-owner.json").length,
    1
  );

  await assert.rejects(commitWorkspace(root, "Invalid\nmessage"), /one line/);
  const committed = await commitWorkspace(root, "Record program owner department");
  assert.equal(committed.subject, "Record program owner department");
  assert.equal(committed.shortCommit.length, 8);
  assert.equal(getGitSummary(root).clean, true);

  await writeFile(join(root, "data", "people", "person-owner.json"), `${JSON.stringify({
    id: "person-owner",
    type: "person",
    affiliation: "internal",
    title: "Program Owner",
    status: "active",
    department: "Controls"
  }, null, 2)}\n`, "utf8");
  await writeFile(join(root, "data", "people", "person-secondary.json"), `${JSON.stringify({
    id: "person-secondary",
    type: "person",
    affiliation: "internal",
    title: "Secondary Reviewer",
    status: "active"
  }, null, 2)}\n`, "utf8");
  assert.deepEqual(getChangedDataPathsSinceRevision(root, initialCommit).sort(), [
    "data/people/person-owner.json",
    "data/people/person-secondary.json"
  ]);
  assert.equal(getChangedDataPathsSinceRevision(root, "not-a-revision"), null);
  const running = await serveWorkspace(root, { port: 0 });
  try {
    const invalidResponse = await fetch(`${running.url}/api/commit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Invalid\nmessage" })
    });
    assert.equal(invalidResponse.status, 400);
    const response = await fetch(`${running.url}/api/commit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Refine program owner department" })
    });
    assert.equal(response.status, 201);
    const commitResult = await response.json();
    assert.equal(commitResult.subject, "Refine program owner department");
    assert.equal(commitResult.pushed, false);
    assert.equal(commitResult.pushSkipped, true);
    assert.equal(commitResult.pushError, undefined);
    const pullResponse = await fetch(`${running.url}/api/git/pull`, { method: "POST" });
    assert.equal(pullResponse.status, 409);
    assert.match((await pullResponse.json()).error, /upstream branch/);
    const pushResponse = await fetch(`${running.url}/api/git/push`, { method: "POST" });
    assert.equal(pushResponse.status, 409);
    assert.match((await pushResponse.json()).error, /no Git remote/);
  } finally {
    await new Promise((resolve) => running.server.close(resolve));
  }

  assert.equal(getGitSummary(root).clean, true);
  assert.equal((await git(parent, ["status", "--porcelain=v1", "--", "outside.txt"])).stdout.trim(), "M outside.txt");
  assert.equal(getWorkspaceHistories(root, ["data/people/person-owner.json"]).get("data/people/person-owner.json").length, 3);
});

test("pushes branches and pulls remote changes with rebase", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "filegrc-git-sync-"));
  const root = join(parent, "workspace");
  const remote = join(parent, "remote.git");
  const peer = join(parent, "peer");
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(parent, { recursive: true, force: true })));

  await makeWorkspace(root);
  await git(root, ["init", "--initial-branch=main"]);
  await git(root, ["config", "user.name", "Test User"]);
  await git(root, ["config", "user.email", "test@example.test"]);
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "Initialize workspace"]);
  await git(parent, ["init", "--bare", "--initial-branch=main", remote]);
  await git(root, ["remote", "add", "origin", remote]);

  const firstPush = await pushWorkspace(root);
  assert.equal(firstPush.upstream, `origin/${firstPush.branch}`);
  assert.deepEqual(getGitSummary(root).remotes, ["origin"]);

  await git(parent, ["clone", remote, peer]);
  await git(peer, ["config", "user.name", "Peer User"]);
  await git(peer, ["config", "user.email", "peer@example.test"]);

  await writeFile(join(root, "browser-note.txt"), "browser commit\n", "utf8");
  const browserCommit = await commitAndPushWorkspace(root, "Commit through browser workflow");
  assert.equal(browserCommit.pushed, true);
  assert.equal(browserCommit.pushSkipped, false);
  assert.equal(browserCommit.upstream, firstPush.upstream);
  await git(peer, ["pull", "--rebase"]);
  assert.equal(await readFile(join(peer, "browser-note.txt"), "utf8"), "browser commit\n");

  await writeFile(join(peer, "remote-note.txt"), "remote one\n", "utf8");
  await git(peer, ["add", "."]);
  await git(peer, ["commit", "-m", "Add remote note"]);
  await git(peer, ["push"]);

  const firstPull = await pullWorkspace(root);
  assert.equal(firstPull.updated, true);
  assert.equal(await readFile(join(root, "remote-note.txt"), "utf8"), "remote one\n");

  await writeFile(join(root, "local-note.txt"), "local\n", "utf8");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "Add local note"]);
  await writeFile(join(peer, "remote-note-two.txt"), "remote two\n", "utf8");
  await git(peer, ["add", "."]);
  await git(peer, ["commit", "-m", "Add second remote note"]);
  await git(peer, ["push"]);

  await pullWorkspace(root);
  const parents = (await git(root, ["show", "-s", "--format=%P", "HEAD"])).stdout.trim().split(/\s+/);
  assert.equal(parents.length, 1);
  await pushWorkspace(root);

  await git(peer, ["pull", "--rebase"]);
  await writeFile(join(root, "conflict.txt"), "local version\n", "utf8");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "Add local conflict version"]);
  await writeFile(join(peer, "conflict.txt"), "remote version\n", "utf8");
  await git(peer, ["add", "."]);
  await git(peer, ["commit", "-m", "Add remote conflict version"]);
  await git(peer, ["push"]);
  await assert.rejects(pullWorkspace(root), /Git could not pull with rebase/);
  assert.equal((await git(root, ["status", "--porcelain=v1"])).stdout.trim(), "");

  await writeFile(join(root, "dirty-note.txt"), "dirty\n", "utf8");
  await assert.rejects(pullWorkspace(root), /Commit or discard workspace changes/);
  await assert.rejects(pushWorkspace(root), /Commit or discard workspace changes/);
});

test("blocks browser commits while HEAD is detached", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-detached-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await git(root, ["init"]);
  await git(root, ["config", "user.name", "Test User"]);
  await git(root, ["config", "user.email", "test@example.test"]);
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "Initialize workspace"]);
  await git(root, ["checkout", "--detach"]);
  await writeFile(join(root, "draft.txt"), "draft\n", "utf8");

  const summary = getGitSummary(root);
  assert.equal(summary.available, true);
  assert.equal(summary.branch, null);
  await assert.rejects(commitWorkspace(root, "Commit from detached head"), /Check out a branch/);
});

test("trunk-mode browser mutations fast-forward, reject stale revisions, commit, and push", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-trunk-write-");
  const peer = join(fixture.parent, "peer");
  await git(fixture.parent, ["clone", fixture.remote, peer]);
  await configureGit(peer, "Peer User", "peer@example.test");

  let running = await serveWorkspace(fixture.root, { port: 0 });
  context.after(() => running.server.listening ? new Promise((resolve) => running.server.close(resolve)) : undefined);
  const initialState = await fetchJson(`${running.url}/api/state`);
  assert.equal(initialState.repository.status, "synced");
  assert.equal(initialState.repository.authoritativeBranch, "main");
  const owner = initialState.resources.find(({ record }) => record.id === "person-owner");
  const updated = { ...owner.record, department: "Controls" };
  const response = await fetch(`${running.url}/api/resource/person/person-owner`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ record: updated, revision: owner.revision })
  });
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.ok(["syncing", "synced"].includes(saved.synchronization.status));
  assert.ok(["syncing", "synced"].includes(saved.state.repository.status));
  await waitForRepository(running.url);
  assert.equal((await git(fixture.root, ["log", "-1", "--format=%s"])).stdout.trim(), "Update person: Program Owner");
  assert.match(
    (await git(fixture.remote, ["show", "main:data/people/person-owner.json"])).stdout,
    /Controls/
  );

  const staleState = await fetchJson(`${running.url}/api/state`);
  const staleOwner = staleState.resources.find(({ record }) => record.id === "person-owner");
  await git(peer, ["pull", "--ff-only"]);
  await writeJson(join(peer, "data", "people", "person-owner.json"), {
    ...staleOwner.record,
    department: "Remote review"
  });
  await git(peer, ["add", "."]);
  await git(peer, ["commit", "-m", "Update owner remotely"]);
  await git(peer, ["push"]);
  await git(fixture.root, ["fetch", "origin"]);
  const behindState = await fetchJson(`${running.url}/api/state`);
  assert.equal(behindState.repository.behind, 1);
  assert.equal(behindState.repository.writesAllowed, true);
  assert.equal(behindState.readOnly, false);

  const staleResponse = await fetch(`${running.url}/api/resource/person/person-owner`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      record: { ...staleOwner.record, department: "Stale local edit" },
      revision: staleOwner.revision
    })
  });
  assert.equal(staleResponse.status, 409);
  assert.match((await staleResponse.json()).error, /changed after you opened/i);
  assert.equal(
    JSON.parse(await readFile(join(fixture.root, "data", "people", "person-owner.json"), "utf8")).department,
    "Remote review"
  );
  assert.equal((await git(fixture.root, ["rev-list", "--count", "HEAD"])).stdout.trim(), "3");
});

test("trunk-mode browser saves return after the local commit while push continues in the background", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-trunk-background-push-");
  const push = pauseGitCommand(context, ({ args }) => args[0] === "push");
  const running = await serveWorkspace(fixture.root, { port: 0, backgroundPushDelayMs: 100 });
  context.after(() => running.server.listening ? new Promise((resolve) => running.server.close(resolve)) : undefined);
  const initial = await fetchJson(`${running.url}/api/state`);
  const owner = initial.resources.find(({ record }) => record.id === "person-owner");

  const response = await fetch(`${running.url}/api/resource/person/person-owner`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      record: { ...owner.record, department: "Background sync" },
      revision: owner.revision
    })
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.synchronization.status, "syncing");
  assert.equal(result.state.repository.status, "syncing");
  assert.equal(result.state.readOnly, true);
  assert.match(await readFile(join(fixture.root, "data", "people", "person-owner.json"), "utf8"), /Background sync/);
  assert.doesNotMatch(
    (await git(fixture.remote, ["show", "main:data/people/person-owner.json"])).stdout,
    /Background sync/
  );
  await push.started;

  const statusStarted = Date.now();
  const pending = await fetchJson(`${running.url}/api/git/sync-status`);
  assert.equal(pending.repository.status, "syncing");
  assert.ok(Date.now() - statusStarted < 1_500, "sync status should remain responsive while Git push is running");

  push.release();
  const synchronized = await waitForRepository(running.url, "synced");
  assert.equal(synchronized.ahead, 0);
  assert.match(
    (await git(fixture.remote, ["show", "main:data/people/person-owner.json"])).stdout,
    /Background sync/
  );
});

test("remote commits that arrive before a background push are never overwritten", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-trunk-background-race-");
  const peer = join(fixture.parent, "peer");
  await git(fixture.parent, ["clone", fixture.remote, peer]);
  await configureGit(peer, "Peer User", "peer@example.test");
  const push = pauseGitCommand(context, ({ args }) => args[0] === "push");
  const running = await serveWorkspace(fixture.root, { port: 0, backgroundPushDelayMs: 100 });
  context.after(() => running.server.listening ? new Promise((resolve) => running.server.close(resolve)) : undefined);
  const initial = await fetchJson(`${running.url}/api/state`);
  const owner = initial.resources.find(({ record }) => record.id === "person-owner");

  const response = await fetch(`${running.url}/api/resource/person/person-owner`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      record: { ...owner.record, department: "Pending local sync" },
      revision: owner.revision
    })
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).synchronization.status, "syncing");
  await push.started;

  await writeFile(join(peer, "remote-note.txt"), "remote change during background sync\n", "utf8");
  await git(peer, ["add", "."]);
  await git(peer, ["commit", "-m", "Commit while FileGRC is syncing"]);
  await git(peer, ["push"]);

  push.release();
  const failed = await waitForRepository(running.url, "not-synced");
  assert.match(failed.backgroundSyncError, /Git could not push/);
  assert.match((await git(fixture.remote, ["show", "main:remote-note.txt"])).stdout, /remote change during background sync/);
  assert.doesNotMatch(
    (await git(fixture.remote, ["show", "main:data/people/person-owner.json"])).stdout,
    /Pending local sync/
  );
  const retry = await fetch(`${running.url}/api/git/retry-sync`, { method: "POST" });
  assert.equal(retry.status, 409);
  assert.match((await retry.json()).error, /diverged/);
});

test("a trunk browser record save validates once and reuses that proof for current state", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-trunk-validation-count-");
  const initialState = await createAppState(fixture.root);
  const owner = initialState.resources.find(({ record }) => record.id === "person-owner");

  const { result, timings } = await collectTimings(async () => {
    const mutation = await runBrowserMutation(fixture.root, {
      message: "Update owner once"
    }, () => updateResource(fixture.root, "person", owner.record.id, {
      ...owner.record,
      department: "Validation count"
    }, {
      expectedRevision: owner.revision
    }));
    const state = await createAppState(fixture.root, {
      includeDetails: false,
      validationProof: mutation[BROWSER_VALIDATION]
    });
    return { mutation, state };
  });

  assert.equal(timings.validation.count, 1);
  assert.equal(result.state.resources.find(({ record }) => record.id === owner.record.id).record.department, "Validation count");
  assert.equal(result.mutation.synchronization.status, "syncing");
  assert.equal((await waitForRepository(fixture.root)).status, "synced");
});

test("a recent browser prefetch removes remote network work from confirmation", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-trunk-prefetch-");
  const initialState = await createAppState(fixture.root);
  const owner = initialState.resources.find(({ record }) => record.id === "person-owner");
  const prefetched = await prefetchBrowserRemote(fixture.root);

  const { result, timings } = await collectTimings(() => runBrowserMutation(fixture.root, {
    message: "Update owner after prefetch",
    prefetchToken: prefetched.token,
    includeValidationProof: false
  }, () => updateResource(fixture.root, "person", owner.record.id, {
    ...owner.record,
    department: "Prefetched"
  }, {
    expectedRevision: owner.revision
  })));

  assert.equal(timings.fetch, undefined);
  assert.equal(timings["fetch-reused"].count, 1);
  assert.equal(result.synchronization.status, "syncing");
  assert.equal(result[BROWSER_VALIDATION], undefined);
  assert.equal((await waitForRepository(fixture.root)).status, "synced");
});

test("prefetch coalescing keeps development override results separate", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-trunk-prefetch-options-");
  const [notNeeded, checked] = await Promise.all([
    prefetchBrowserRemote(fixture.root, { allowNonAuthoritativeWrites: true }),
    prefetchBrowserRemote(fixture.root)
  ]);
  assert.equal(notNeeded.status, "not-needed");
  assert.equal(checked.status, "checked");
  assert.ok(checked.token);
});

test("an invalid browser prefetch token cannot skip the remote fetch", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-trunk-invalid-prefetch-");
  const initialState = await createAppState(fixture.root);
  const owner = initialState.resources.find(({ record }) => record.id === "person-owner");
  await prefetchBrowserRemote(fixture.root);

  const { result, timings } = await collectTimings(() => runBrowserMutation(fixture.root, {
    message: "Update owner with invalid prefetch",
    prefetchToken: "invalid-token",
    includeValidationProof: false
  }, () => updateResource(fixture.root, "person", owner.record.id, {
    ...owner.record,
    department: "Invalid prefetch token"
  }, {
    expectedRevision: owner.revision
  })));

  assert.equal(timings.fetch.count, 1);
  assert.equal(timings["fetch-reused"], undefined);
  assert.equal(result.synchronization.status, "syncing");
  assert.equal((await waitForRepository(fixture.root)).status, "synced");
});

test("model v4 People confirmation reuses prefetch, commits locally, and synchronizes", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-trunk-people-review-", "4");
  const running = await serveWorkspace(fixture.root, { port: 0, backgroundPushDelayMs: 100 });
  context.after(() => running.server.listening ? new Promise((resolve) => running.server.close(resolve)) : undefined);
  const initial = await fetchJson(`${running.url}/api/state`);
  assert.equal(String(initial.model.modelVersion), "4");
  assert.ok(initial.git.invocationCount <= 5, `expected at most 5 Git launches, received ${initial.git.invocationCount}`);
  const payload = {
    resourceType: "person",
    decision: "complete",
    rationale: "Confirmed the current people and their program roles.",
    reviewedByIds: [initial.resources.find(({ record }) => record.type === "person" && record.status === "active").record.id],
    reviewedOn: "2026-08-15",
    scopeRevision: initial.git.commit,
    expectedRevision: initial.collectionReviews.person.reviewRevision || undefined
  };
  const preview = await fetch(`${running.url}/api/collection-review/preview`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  assert.equal(preview.status, 200);

  const [prefetchA, prefetchB] = await Promise.all([
    fetchJsonResponse(`${running.url}/api/git/prefetch`, { method: "POST" }),
    fetchJsonResponse(`${running.url}/api/git/prefetch`, { method: "POST" })
  ]);
  assert.equal(prefetchA.token, prefetchB.token);
  const confirmed = await fetch(`${running.url}/api/collection-review`, {
    method: "POST",
    headers: { "content-type": "application/json", prefer: "respond-async" },
    body: JSON.stringify({ ...payload, confirmed: true, prefetchToken: prefetchA.token })
  });
  assert.equal(confirmed.status, 201);
  const result = await confirmed.json();
  assert.equal(result.assessment.status, "current");
  assert.ok(["syncing", "synced"].includes(result.synchronization.status));
  assert.equal((await git(fixture.root, ["log", "-1", "--format=%s"])).stdout.trim(), "Confirm Program participants");
  await waitForRepository(running.url);
  assert.match((await git(fixture.remote, ["grep", "-n", "Confirmed the current people", "main", "--", "data"])).stdout, /Confirmed the current people/);
});

test("concurrent browser state requests share one bounded repository inspection", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-trunk-state-coalescing-");
  const running = await serveWorkspace(fixture.root, { port: 0 });
  context.after(() => running.server.listening ? new Promise((resolve) => running.server.close(resolve)) : undefined);
  const started = performance.now();
  const states = await Promise.all(Array.from({ length: 8 }, () => fetchJson(`${running.url}/api/state`)));
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 1_000, `expected concurrent state requests under 1 second, received ${elapsed.toFixed(1)} ms`);
  assert.ok(states.every(({ git }) => git.invocationCount <= 5));
  assert.equal(new Set(states.map(({ generatedAt }) => generatedAt)).size, 1);
});

test("a hung fetch times out without holding the mutation queue or poisoning later requests", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-trunk-git-timeout-");
  let failFirstFetch;
  let markFetchStarted;
  const fetchStarted = new Promise((resolve) => { markFetchStarted = resolve; });
  const restoreInterceptor = setGitCommandInterceptorForTests(({ cwd, args, options, run }) => {
    if (args[0] === "fetch" && !failFirstFetch) {
      markFetchStarted();
      return new Promise((resolve, reject) => {
        failFirstFetch = () => reject(new GitOperationError(
          "timeout",
          options.operation,
          "The test operation exceeded its deadline and the process group was terminated."
        ));
      });
    }
    return run(cwd, args, options);
  });
  context.after(restoreInterceptor);
  const running = await serveWorkspace(fixture.root, { port: 0 });
  context.after(() => running.server.listening ? new Promise((resolve) => running.server.close(resolve)) : undefined);

  const prefetchPromise = fetch(`${running.url}/api/git/prefetch`, { method: "POST" });
  await fetchStarted;
  const state = await fetchJson(`${running.url}/api/state`);
  assert.equal(state.repository.status, "synced");
  failFirstFetch();
  const failedPrefetch = await prefetchPromise;
  assert.equal(failedPrefetch.status, 409);
  assert.match((await failedPrefetch.json()).error, /timed out while trying to fetch origin/i);

  const current = await fetchJson(`${running.url}/api/state`);
  const owner = current.resources.find(({ record }) => record.id === "person-owner");
  const saved = await fetch(`${running.url}/api/resource/person/person-owner`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      record: { ...owner.record, department: "Recovered after timeout" },
      revision: owner.revision
    })
  });
  assert.equal(saved.status, 200);
  assert.match(await readFile(join(fixture.root, "data", "people", "person-owner.json"), "utf8"), /Recovered after timeout/);
});

test("async Git errors distinguish missing executables and sanitize command failures", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-git-errors-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeWorkspace(root);
  await writeTrunkSettings(root);
  let failure = new GitOperationError("missing-executable", "locate the repository");
  const restoreInterceptor = setGitCommandInterceptorForTests(() => Promise.reject(failure));
  context.after(restoreInterceptor);
  const missingSnapshot = await getRepositorySnapshot(root, { fresh: true });
  assert.equal(missingSnapshot.error.kind, "missing-executable");
  assert.match(missingSnapshot.message, /^Git is unavailable\. Install Git/);
  const missingRepository = await getBrowserRepositoryState(root, { repositorySnapshot: missingSnapshot });
  assert.equal(missingRepository.status, "git-setup-required");
  assert.match(missingRepository.message, /^Git is unavailable\. Install Git/);

  failure = new GitOperationError(
    "command-failure",
    "inspect the test repository",
    "fatal: https://user:password@example.test/repo?access_token=secret"
  );
  await assert.rejects(
    runGitCommand(root, ["status"], { operation: "inspect the test repository" }),
    (error) => {
      assert.equal(error.kind, "command-failure");
      assert.match(error.message, /Git could not inspect the test repository/);
      assert.doesNotMatch(error.message, /password|secret/);
      assert.match(error.message, /\[redacted\]/);
      return true;
    }
  );
});

test("the evidence map is read-only in trunk mode", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-trunk-evidence-map-");
  await createResources(fixture.root, [
    {
      id: "framework-security",
      type: "framework",
      title: "Security criteria",
      status: "active",
      version: "1"
    },
    {
      id: "requirement-access",
      type: "requirement",
      title: "Access requirement",
      frameworkId: "framework-security",
      reference: "TEST-ACCESS",
      applicability: "applicable"
    },
    {
      id: "control-access",
      type: "control",
      title: "Access control",
      status: "planned",
      statement: "Access is approved and limited.",
      ownerIds: ["person-owner"],
      requirementIds: ["requirement-access"],
      code: "IAM-01",
      activity: "Approve and provision access.",
      operationMode: "manual",
      operationPattern: "event-driven"
    }
  ]);
  await git(fixture.root, ["add", "."]);
  await git(fixture.root, ["commit", "-m", "Add access control"]);
  await git(fixture.root, ["push"]);

  const committed = (await git(fixture.root, ["rev-parse", "HEAD"])).stdout.trim();
  const running = await serveWorkspace(fixture.root, { port: 0 });
  context.after(() => running.server.listening ? new Promise((resolve) => running.server.close(resolve)) : undefined);
  const response = await fetch(`${running.url}/api/state`);
  assert.equal(response.status, 200);
  const state = await response.json();
  const evidence = state.programReadiness.stages
    .find(({ id }) => id === "controls")
    .items.filter(({ id }) => id.startsWith("source-family-"));
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].id, "source-family-identity-access");
  assert.equal(evidence[0].status, "action");
  assert.equal(state.resources.some(({ record }) => record.type === "evidence"), false);
  assert.equal((await git(fixture.root, ["rev-parse", "HEAD"])).stdout.trim(), committed);
  assert.equal((await git(fixture.root, ["status", "--porcelain"])).stdout, "");
});

test("trunk mode makes detached and non-authoritative checkouts read-only unless the development override is active", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-trunk-readonly-");
  await git(fixture.root, ["switch", "-c", "feature/task"]);
  let running = await serveWorkspace(fixture.root, { port: 0 });
  let state = await fetchJson(`${running.url}/api/state`);
  assert.equal(state.readOnly, true);
  assert.equal(state.repository.status, "read-only-checkout");
  assert.match(state.repository.message, /not the authoritative FileGRC branch/);
  await new Promise((resolve) => running.server.close(resolve));

  running = await serveWorkspace(fixture.root, { port: 0, allowNonAuthoritativeWrites: true });
  state = await fetchJson(`${running.url}/api/state`);
  assert.equal(state.readOnly, false);
  assert.equal(state.repository.developmentOverride, true);
  const owner = state.resources.find(({ record }) => record.id === "person-owner");
  const beforeCommit = (await git(fixture.root, ["rev-parse", "HEAD"])).stdout.trim();
  const response = await fetch(`${running.url}/api/resource/person/person-owner`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ record: { ...owner.record, department: "Local task edit" }, revision: owner.revision })
  });
  assert.equal(response.status, 200);
  assert.equal((await git(fixture.root, ["rev-parse", "HEAD"])).stdout.trim(), beforeCommit);
  assert.match((await git(fixture.root, ["status", "--porcelain", "--", "."])).stdout, /person-owner\.json/);
  await new Promise((resolve) => running.server.close(resolve));
  await git(fixture.root, ["restore", "--", "."]);

  await git(fixture.root, ["switch", "main"]);
  await git(fixture.root, ["checkout", "--detach"]);
  running = await serveWorkspace(fixture.root, { port: 0 });
  state = await fetchJson(`${running.url}/api/state`);
  assert.equal(state.readOnly, true);
  assert.equal(state.repository.status, "read-only-checkout");
  await new Promise((resolve) => running.server.close(resolve));
});

test("trunk mode blocks missing Git setup and unrelated monorepo changes", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "filegrc-trunk-monorepo-"));
  const repositoryRoot = join(parent, "repository");
  const root = join(repositoryRoot, "compliance");
  const remote = join(parent, "remote.git");
  context.after(() => import("node:fs/promises").then(({ rm: remove }) => remove(parent, { recursive: true, force: true })));
  await makeWorkspace(root);
  await writeTrunkSettings(root);
  await git(repositoryRoot, ["init", "--initial-branch=main"]);
  await configureGit(repositoryRoot);
  await writeFile(join(repositoryRoot, "application.txt"), "application\n", "utf8");
  await git(repositoryRoot, ["add", "."]);
  await git(repositoryRoot, ["commit", "-m", "Initialize monorepo"]);

  let running = await serveWorkspace(root, { port: 0 });
  context.after(() => running.server.listening ? new Promise((resolve) => running.server.close(resolve)) : undefined);
  let state = await fetchJson(`${running.url}/api/state`);
  assert.equal(state.repository.status, "git-setup-required");
  assert.match(state.repository.message, /remote "origin" does not exist/);
  await new Promise((resolve) => running.server.close(resolve));

  await git(parent, ["init", "--bare", "--initial-branch=main", remote]);
  await git(repositoryRoot, ["remote", "add", "origin", remote]);
  running = await serveWorkspace(root, { port: 0 });
  state = await fetchJson(`${running.url}/api/state`);
  assert.equal(state.repository.status, "git-setup-required");
  assert.match(state.repository.message, /must track origin\/main/);
  await new Promise((resolve) => running.server.close(resolve));
  await git(repositoryRoot, ["push", "-u", "origin", "main"]);
  await writeFile(join(repositoryRoot, "application.txt"), "unrelated change\n", "utf8");
  await git(repositoryRoot, ["add", "application.txt"]);
  running = await serveWorkspace(root, { port: 0 });
  state = await fetchJson(`${running.url}/api/state`);
  const owner = state.resources.find(({ record }) => record.id === "person-owner");
  const response = await fetch(`${running.url}/api/resource/person/person-owner`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ record: { ...owner.record, department: "Blocked edit" }, revision: owner.revision })
  });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /worktree has uncommitted changes/i);
  assert.equal((await git(repositoryRoot, ["status", "--porcelain", "--", "application.txt"])).stdout.trim(), "M  application.txt");
  assert.equal((await git(remote, ["show", "main:application.txt"])).stdout, "application\n");
  assert.equal(
    JSON.parse(await readFile(join(root, "data", "people", "person-owner.json"), "utf8")).department,
    undefined
  );
  await new Promise((resolve) => running.server.close(resolve));
});

test("trunk mode rejects unsafe configured Git names before synchronization", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-trunk-unsafe-config-");
  await writeJson(join(fixture.root, "data", "renderer.json"), {
    id: "renderer-settings",
    type: "renderer-settings",
    title: "Renderer settings",
    showOnboarding: false,
    repositoryMode: "trunk",
    authoritativeBranch: "release/.hidden",
    repositoryRemote: "origin",
    completedStagePageIds: []
  });
  await git(fixture.root, ["add", "."]);
  await git(fixture.root, ["commit", "-m", "Set unsafe repository branch"]);
  await git(fixture.root, ["push"]);
  const running = await serveWorkspace(fixture.root, { port: 0 });
  context.after(() => new Promise((resolve) => running.server.close(resolve)));
  const state = await fetchJson(`${running.url}/api/state`);
  assert.equal(state.readOnly, true);
  assert.equal(state.repository.status, "git-setup-required");
  assert.match(state.repository.message, /not a safe Git branch name/);
  const owner = state.resources.find(({ record }) => record.id === "person-owner");
  const response = await fetch(`${running.url}/api/resource/person/person-owner`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      record: { ...owner.record, department: "Blocked unsafe configuration" },
      revision: owner.revision
    })
  });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /not a safe Git branch name/);

  await writeJson(join(fixture.root, "data", "renderer.json"), {
    id: "renderer-settings",
    type: "renderer-settings",
    title: "Renderer settings",
    showOnboarding: false,
    repositoryMode: "trunk",
    authoritativeBranch: "main",
    repositoryRemote: "origin.lock",
    completedStagePageIds: []
  });
  await git(fixture.root, ["add", "."]);
  await git(fixture.root, ["commit", "-m", "Set unsafe repository remote"]);
  await git(fixture.root, ["push", "origin", "main"]);
  const remoteState = await fetchJson(`${running.url}/api/state`);
  assert.equal(remoteState.repository.status, "git-setup-required");
  assert.match(remoteState.repository.message, /not a safe Git remote name/);
  const remoteOwner = remoteState.resources.find(({ record }) => record.id === "person-owner");
  const remoteResponse = await fetch(`${running.url}/api/resource/person/person-owner`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      record: { ...remoteOwner.record, department: "Blocked unsafe remote" },
      revision: remoteOwner.revision
    })
  });
  assert.equal(remoteResponse.status, 409);
  assert.match((await remoteResponse.json()).error, /not a safe Git remote name/);
});

test("failed trunk pushes remain visible and retry only FileGRC commits", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-trunk-retry-");
  const unavailableRemote = `${fixture.remote}.unavailable`;
  const push = pauseGitCommand(context, ({ args }) => args[0] === "push");
  let running = await serveWorkspace(fixture.root, { port: 0, backgroundPushDelayMs: 100 });
  context.after(() => running.server.listening ? new Promise((resolve) => running.server.close(resolve)) : undefined);
  const response = await fetch(`${running.url}/api/setup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      serviceName: "Pending Push Service",
      boundary: "The production service and supporting infrastructure.",
      ownerId: "person-owner",
      criticality: "high",
      classificationId: "confidential",
      internetExposed: true,
      programGoal: "readiness",
      draft: false
    })
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.synchronization.status, "syncing");
  assert.equal(result.synchronization.pushError, null);
  assert.equal(result.state.repository.status, "syncing");
  assert.equal(result.state.resources.find(({ record }) => record.id === result.system.id).record.status, "active");
  await push.started;
  await rename(fixture.remote, unavailableRemote);
  push.release();
  const failed = await waitForRepository(running.url, "not-synced");
  assert.equal(failed.ahead, 1);
  assert.match(failed.backgroundSyncError, /local FileGRC commit was retained/);
  await new Promise((resolve) => running.server.close(resolve));
  running = await serveWorkspace(fixture.root, { port: 0 });
  const pending = await fetchJson(`${running.url}/api/state`);
  assert.equal(pending.repository.status, "not-synced");
  assert.equal(pending.repository.ahead, 1);
  assert.equal(pending.repository.retrySafe, true);

  await rename(unavailableRemote, fixture.remote);
  const retry = await fetch(`${running.url}/api/git/retry-sync`, { method: "POST" });
  assert.equal(retry.status, 200);
  const retryResult = await retry.json();
  assert.equal(retryResult.state.repository.status, "synced");
  assert.equal(retryResult.state.repository.ahead, 0);
  const synchronized = await fetchJson(`${running.url}/api/state`);
  assert.equal(synchronized.repository.status, "synced");
  assert.equal(synchronized.repository.ahead, 0);
});

test("Git errors redact credentials before reaching browser responses", () => {
  const message = sanitizeGitErrorMessage(
    "rejected https://writer:private-token@example.test/repository?token=query-secret Authorization: Bearer header-secret"
  );
  assert.match(message, /https:\/\/\[redacted\]@example\.test\/repository\?token=\[redacted\]/);
  assert.match(message, /Authorization: \[redacted\]/);
  assert.doesNotMatch(message, /private-token|query-secret|header-secret/);
  assert.equal(sanitizeGitErrorMessage("x".repeat(9_000)).length, 8_001);
});

test("trunk transactions roll back invalid FileGRC writes without creating a commit", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-trunk-rollback-");
  const ownerPath = join(fixture.root, "data", "people", "person-owner.json");
  const beforeSource = await readFile(ownerPath, "utf8");
  const beforeCommit = (await git(fixture.root, ["rev-parse", "HEAD"])).stdout.trim();
  await assert.rejects(runBrowserMutation(fixture.root, {
    message: "Write invalid owner"
  }, async () => {
    await writeFile(ownerPath, "{}\n", "utf8");
    return { changed: true };
  }), /browser change was rolled back/);
  assert.equal(await readFile(ownerPath, "utf8"), beforeSource);
  assert.equal((await git(fixture.root, ["rev-parse", "HEAD"])).stdout.trim(), beforeCommit);
  assert.equal((await git(fixture.root, ["status", "--porcelain"])).stdout.trim(), "");
});

test("two trunk-mode servers cannot overwrite a concurrent browser save", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-trunk-concurrent-");
  const peer = join(fixture.parent, "peer");
  await git(fixture.parent, ["clone", fixture.remote, peer]);
  await configureGit(peer, "Peer User", "peer@example.test");
  const first = await serveWorkspace(fixture.root, { port: 0 });
  const second = await serveWorkspace(peer, { port: 0 });
  context.after(() => Promise.all([
    new Promise((resolve) => first.server.close(resolve)),
    new Promise((resolve) => second.server.close(resolve))
  ]));
  const firstState = await fetchJson(`${first.url}/api/state`);
  const secondState = await fetchJson(`${second.url}/api/state`);
  const firstOwner = firstState.resources.find(({ record }) => record.id === "person-owner");
  const secondOwner = secondState.resources.find(({ record }) => record.id === "person-owner");

  const firstResponse = await fetch(`${first.url}/api/resource/person/person-owner`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      record: { ...firstOwner.record, department: "First server edit" },
      revision: firstOwner.revision
    })
  });
  assert.equal(firstResponse.status, 200);
  await waitForRepository(first.url);
  const secondResponse = await fetch(`${second.url}/api/resource/person/person-owner`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      record: { ...secondOwner.record, department: "Second server stale edit" },
      revision: secondOwner.revision
    })
  });
  assert.equal(secondResponse.status, 409);
  assert.match((await secondResponse.json()).error, /changed after you opened/i);
  assert.equal(
    JSON.parse(await readFile(join(peer, "data", "people", "person-owner.json"), "utf8")).department,
    "First server edit"
  );
});

test("trunk-mode onboarding writes and synchronizes its related files in one commit", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-trunk-onboarding-");
  const rendererPath = join(fixture.root, "data", "renderer.json");
  const renderer = JSON.parse(await readFile(rendererPath, "utf8"));
  await writeJson(rendererPath, { ...renderer, showOnboarding: true });
  await git(fixture.root, ["add", "."]);
  await git(fixture.root, ["commit", "-m", "Enable onboarding"]);
  await git(fixture.root, ["push"]);
  const running = await serveWorkspace(fixture.root, { port: 0 });
  context.after(() => new Promise((resolve) => running.server.close(resolve)));
  const before = Number((await git(fixture.root, ["rev-list", "--count", "HEAD"])).stdout.trim());
  const response = await fetch(`${running.url}/api/setup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      serviceName: "Example Service",
      boundary: "The production service and supporting infrastructure.",
      ownerId: "person-owner",
      criticality: "high",
      classificationId: "confidential",
      internetExposed: true,
      programGoal: "readiness",
      draft: false
    })
  });
  assert.equal(response.status, 200);
  assert.ok(["syncing", "synced"].includes((await response.json()).synchronization.status));
  await waitForRepository(running.url);
  assert.equal(Number((await git(fixture.root, ["rev-list", "--count", "HEAD"])).stdout.trim()), before + 1);
  assert.equal((await git(fixture.root, ["log", "-1", "--format=%s"])).stdout.trim(), "Complete onboarding for Test Organization");
  const names = (await git(fixture.root, ["show", "--format=", "--name-only", "HEAD"])).stdout.trim().split("\n").sort();
  assert.deepEqual(names, [
    "data/renderer.json",
    "data/systems/system-example-service.json",
    "data/workspace.json"
  ]);
});

test("invalid final onboarding state rolls back every file and creates no commit", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-trunk-onboarding-invalid-");
  const workspacePath = join(fixture.root, "data", "workspace.json");
  const invalidWorkspace = JSON.parse(await readFile(workspacePath, "utf8"));
  delete invalidWorkspace.organizationName;
  await writeJson(workspacePath, invalidWorkspace);
  await git(fixture.root, ["add", "."]);
  await git(fixture.root, ["commit", "-m", "Create invalid benchmark state"]);
  await git(fixture.root, ["push"]);
  const originalWorkspace = await readFile(workspacePath, "utf8");
  const before = (await git(fixture.root, ["rev-parse", "HEAD"])).stdout.trim();
  const running = await serveWorkspace(fixture.root, { port: 0 });
  context.after(() => new Promise((resolve) => running.server.close(resolve)));

  const response = await fetch(`${running.url}/api/setup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      serviceName: "Invalid Final State",
      boundary: "The production service and supporting infrastructure.",
      ownerId: "person-owner",
      criticality: "high",
      classificationId: "confidential",
      internetExposed: true,
      programGoal: "readiness",
      draft: false
    })
  });

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /validation error/i);
  assert.equal((await git(fixture.root, ["rev-parse", "HEAD"])).stdout.trim(), before);
  assert.equal(await readFile(workspacePath, "utf8"), originalWorkspace);
  await assert.rejects(access(join(fixture.root, "data", "systems", "system-invalid-final-state.json")), /ENOENT/);
  assert.equal((await git(fixture.root, ["status", "--porcelain=v1"])).stdout.trim(), "");
});

test("retry sync refuses diverged history and commits that include files outside a nested FileGRC workspace", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "filegrc-trunk-retry-safety-"));
  const repositoryRoot = join(parent, "repository");
  const root = join(repositoryRoot, "compliance");
  const remote = join(parent, "remote.git");
  const peer = join(parent, "peer");
  context.after(() => import("node:fs/promises").then(({ rm: remove }) => remove(parent, { recursive: true, force: true })));
  await makeWorkspace(root);
  await writeTrunkSettings(root);
  await git(repositoryRoot, ["init", "--initial-branch=main"]);
  await configureGit(repositoryRoot);
  await writeFile(join(repositoryRoot, "application.txt"), "initial\n", "utf8");
  await git(repositoryRoot, ["add", "."]);
  await git(repositoryRoot, ["commit", "-m", "Initialize monorepo"]);
  await git(parent, ["init", "--bare", "--initial-branch=main", remote]);
  await git(repositoryRoot, ["remote", "add", "origin", remote]);
  await git(repositoryRoot, ["push", "-u", "origin", "main"]);
  await git(parent, ["clone", remote, peer]);
  await configureGit(peer, "Peer User", "peer@example.test");

  await writeFile(join(repositoryRoot, "application.txt"), "local application commit\n", "utf8");
  await git(repositoryRoot, ["add", "application.txt"]);
  await git(repositoryRoot, ["commit", "-m", "Change application"]);
  let running = await serveWorkspace(root, { port: 0 });
  context.after(() => running.server.listening ? new Promise((resolve) => running.server.close(resolve)) : undefined);
  let retry = await fetch(`${running.url}/api/git/retry-sync`, { method: "POST" });
  assert.equal(retry.status, 409);
  assert.match((await retry.json()).error, /outside this FileGRC workspace/);
  await new Promise((resolve) => running.server.close(resolve));

  await git(repositoryRoot, ["reset", "--soft", "HEAD~1"]);
  await git(repositoryRoot, ["restore", "--staged", "--worktree", "--source=HEAD", "--", "application.txt"]);
  await writeJson(join(root, "data", "people", "person-owner.json"), {
    id: "person-owner",
    type: "person",
    affiliation: "internal",
    title: "Program Owner",
    status: "active",
    email: "security@example.com",
    department: "Local FileGRC commit"
  });
  await git(repositoryRoot, ["add", "compliance"]);
  await git(repositoryRoot, ["commit", "-m", "Local FileGRC commit"]);
  await writeFile(join(peer, "remote.txt"), "remote\n", "utf8");
  await git(peer, ["add", "."]);
  await git(peer, ["commit", "-m", "Remote commit"]);
  await git(peer, ["push"]);
  running = await serveWorkspace(root, { port: 0 });
  retry = await fetch(`${running.url}/api/git/retry-sync`, { method: "POST" });
  assert.equal(retry.status, 409);
  assert.match((await retry.json()).error, /diverged/);
  const parents = (await git(repositoryRoot, ["show", "-s", "--format=%P", "HEAD"])).stdout.trim().split(/\s+/);
  assert.equal(parents.length, 1);
  await new Promise((resolve) => running.server.close(resolve));
});

async function makeTrunkGitFixture(context, prefix, modelVersion = "2") {
  const parent = await mkdtemp(join(tmpdir(), prefix));
  const root = join(parent, "workspace");
  const remote = join(parent, "remote.git");
  context.after(() => import("node:fs/promises").then(({ rm: remove }) => remove(parent, { recursive: true, force: true })));
  if (modelVersion === "4") {
    await makeComprehensiveWorkspace(root, "4");
    const loaded = await import("../src/workspace.js").then(({ loadWorkspace }) => loadWorkspace(root));
    const rendererEntry = loaded.entries.find(({ record }) => record.type === "renderer-settings");
    await writeJson(rendererEntry.path, {
      ...rendererEntry.record,
      id: "renderer-settings",
      repositoryMode: "trunk",
      authoritativeBranch: "main",
      repositoryRemote: "origin"
    });
  } else {
    await makeWorkspace(root);
    await writeTrunkSettings(root);
  }
  await git(root, ["init", "--initial-branch=main"]);
  await configureGit(root);
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "Initialize workspace"]);
  await git(parent, ["init", "--bare", "--initial-branch=main", remote]);
  await git(root, ["remote", "add", "origin", remote]);
  await git(root, ["push", "-u", "origin", "main"]);
  return { parent, root, remote };
}

async function writeTrunkSettings(root) {
  await writeJson(join(root, "data", "renderer.json"), {
    id: "renderer-settings",
    type: "renderer-settings",
    title: "Renderer settings",
    showOnboarding: false,
    repositoryMode: "trunk",
    authoritativeBranch: "main",
    repositoryRemote: "origin",
    completedStagePageIds: []
  });
}

async function configureGit(cwd, name = "Test User", email = "test@example.test") {
  await git(cwd, ["config", "user.name", name]);
  await git(cwd, ["config", "user.email", email]);
}

async function fetchJson(url) {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  return response.json();
}

async function fetchJsonResponse(url, options) {
  const response = await fetch(url, options);
  assert.equal(response.status, 200);
  return response.json();
}

async function waitForRepository(input, expectedStatus = "synced", timeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const repository = input.startsWith?.("http")
      ? (await fetchJson(`${input}/api/git/sync-status`)).repository
      : await getBrowserRepositoryState(input);
    if (repository.status === expectedStatus) return repository;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const repository = input.startsWith?.("http")
    ? (await fetchJson(`${input}/api/git/sync-status`)).repository
    : await getBrowserRepositoryState(input);
  assert.fail(`Expected repository status ${expectedStatus}, received ${repository.status}.`);
}

function pauseGitCommand(context, predicate) {
  let release;
  let markStarted;
  let paused = false;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const blocked = new Promise((resolve) => { release = resolve; });
  const restore = setGitCommandInterceptorForTests(async ({ cwd, args, options, run }) => {
    if (!paused && predicate({ cwd, args, options })) {
      paused = true;
      markStarted();
      await blocked;
    }
    return run();
  });
  context.after(() => {
    release();
    restore();
  });
  return { started, release };
}

function git(cwd, args) {
  return execute("git", args, { cwd });
}
