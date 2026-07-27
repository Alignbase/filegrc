import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { getGitSummary, getWorkspaceHistories, serveWorkspace } from "../src/index.js";
import { commitAndPushWorkspace, commitWorkspace, hasGitRevision, pullWorkspace, pushWorkspace } from "../src/git.js";
import { makeWorkspace } from "./helpers.js";

const execute = promisify(execFile);

test("scopes Git status and file histories to a workspace nested in a larger repository", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "filegrc-nested-git-"));
  const root = join(parent, "compliance");
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(parent, { recursive: true, force: true })));
  await makeWorkspace(root);
  await writeFile(join(parent, "outside.txt"), "outside\n", "utf8");
  await git(parent, ["init"]);
  await git(parent, ["config", "user.name", "Test User"]);
  await git(parent, ["config", "user.email", "test@example.test"]);
  await git(parent, ["add", "."]);
  await git(parent, ["commit", "-m", "Initialize nested workspace"]);
  assert.equal(hasGitRevision(root, getGitSummary(root).commit), true);
  assert.equal(hasGitRevision(root, "0000000000000000000000000000000000000000"), false);
  assert.equal(hasGitRevision(root, "not-a-commit"), false);

  await writeFile(join(parent, "outside.txt"), "changed outside\n", "utf8");
  assert.equal(getGitSummary(root).clean, true);

  await writeFile(join(root, "data", "people", "person-owner.json"), "{}\n", "utf8");
  await assert.rejects(commitWorkspace(root, "Commit invalid workspace"), /validation error/);
  await writeFile(join(root, "data", "people", "person-owner.json"), `${JSON.stringify({
    schemaVersion: 1,
    id: "person-owner",
    type: "person",
    title: "Program Owner",
    status: "active",
    role: "Reviewer"
  }, null, 2)}\n`, "utf8");
  const summary = getGitSummary(root);
  assert.equal(summary.clean, false);
  assert.equal(summary.changes.length, 1);

  const histories = getWorkspaceHistories(root, ["data/people/person-owner.json"]);
  assert.equal(histories.get("data/people/person-owner.json").length, 1);

  await assert.rejects(commitWorkspace(root, "Invalid\nmessage"), /one line/);
  const committed = await commitWorkspace(root, "Record program owner role");
  assert.equal(committed.subject, "Record program owner role");
  assert.equal(committed.shortCommit.length, 8);
  assert.equal(getGitSummary(root).clean, true);

  await writeFile(join(root, "data", "people", "person-owner.json"), `${JSON.stringify({
    schemaVersion: 1,
    id: "person-owner",
    type: "person",
    title: "Program Owner",
    status: "active",
    role: "Control reviewer"
  }, null, 2)}\n`, "utf8");
  await writeFile(join(root, "data", "people", "person-secondary.json"), `${JSON.stringify({
    schemaVersion: 1,
    id: "person-secondary",
    type: "person",
    title: "Secondary Reviewer",
    status: "active"
  }, null, 2)}\n`, "utf8");
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
      body: JSON.stringify({ message: "Refine program owner role" })
    });
    assert.equal(response.status, 201);
    const commitResult = await response.json();
    assert.equal(commitResult.subject, "Refine program owner role");
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
  await git(root, ["init"]);
  await git(root, ["config", "user.name", "Test User"]);
  await git(root, ["config", "user.email", "test@example.test"]);
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "Initialize workspace"]);
  await git(parent, ["init", "--bare", remote]);
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

function git(cwd, args) {
  return execute("git", args, { cwd });
}
