import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { commitWorkspace, getGitSummary, getWorkspaceHistories, serveWorkspace } from "../src/index.js";
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
    assert.equal((await response.json()).subject, "Refine program owner role");
  } finally {
    await new Promise((resolve) => running.server.close(resolve));
  }

  assert.equal(getGitSummary(root).clean, true);
  assert.equal((await git(parent, ["status", "--porcelain=v1", "--", "outside.txt"])).stdout.trim(), "M outside.txt");
  assert.equal(getWorkspaceHistories(root, ["data/people/person-owner.json"]).get("data/people/person-owner.json").length, 3);
});

function git(cwd, args) {
  return execute("git", args, { cwd });
}
