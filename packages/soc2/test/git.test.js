import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { getGitSummary, getWorkspaceHistories } from "../src/index.js";
import { makeWorkspace } from "./helpers.js";

const execute = promisify(execFile);

test("scopes Git status and file histories to a workspace nested in a larger repository", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "soc2-nested-git-"));
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
  const summary = getGitSummary(root);
  assert.equal(summary.clean, false);
  assert.equal(summary.changes.length, 1);

  const histories = getWorkspaceHistories(root, ["data/people/person-owner.json"]);
  assert.equal(histories.get("data/people/person-owner.json").length, 1);
});

function git(cwd, args) {
  return execute("git", args, { cwd });
}
