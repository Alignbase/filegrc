import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { getFileObjectIdAtRevision, getGitSummary, setGitSubprocessObserverForTests, withAssessmentGitCache, withGitCommandAdapterForTests } from "../src/git.js";
import { makeWorkspace } from "./helpers.js";
import { loadWorkspace } from "../src/workspace.js";
import { reviewHistoricalWorkspace, reviewHistoryContext } from "../src/historical-workspace.js";
import { collectionRevision } from "../src/collection-revision.js";
import { withAssessmentCache } from "../src/calculation-cache.js";

test("assessment attachment checks batch tree metadata and observe the next committed revision", async context => {
  const repository = await mkdtemp(join(tmpdir(), "filegrc-assessment-git-"));
  context.after(() => rm(repository, { recursive: true, force: true }));
  const root = join(repository, "nested workspace");
  await makeWorkspace(root);
  const paths = ["data/people/person-owner.json", "data/people/person-approver.json", "data/evidence/quoted name.json"];
  await mkdir(join(root, "data/evidence"));
  await writeFile(join(root, paths[2]), "opaque attachment");
  const git = (...args) => execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trim();
  git("init", "--initial-branch=main");
  git("config", "user.name", "Test User");
  git("config", "user.email", "test@example.test");
  git("add", "."); git("commit", "-m", "Create workspace");
  const first = git("rev-parse", "HEAD");
  const expected = paths.map(path => getFileObjectIdAtRevision(root, first, path));
  const calls = [];
  const restore = setGitSubprocessObserverForTests(event => calls.push(event.args));
  context.after(restore);
  withAssessmentGitCache(() => {
    assert.deepEqual(paths.map(path => getFileObjectIdAtRevision(root, first, path)), expected);
    assert.equal(getFileObjectIdAtRevision(root, first, "data/missing.json"), null);
    assert.equal(getFileObjectIdAtRevision(root, first, "../outside"), null);
    assert.equal(getGitSummary(root).commit, first);
    assert.equal(getGitSummary(root).commit, first);
  });
  assert.equal(calls.filter(args => args[0] === "ls-tree").length, 1);
  assert.equal(calls.filter(args => args[0] === "rev-parse" && args[1]?.includes(":")).length, 0);
  await writeFile(join(root, paths[0]), "changed bytes");
  git("add", "."); git("commit", "-m", "Change workspace");
  const second = git("rev-parse", "HEAD");
  withAssessmentGitCache(() => {
    assert.equal(getGitSummary(root).commit, second);
    assert.notEqual(getFileObjectIdAtRevision(root, second, paths[0]), expected[0]);
    assert.equal(getFileObjectIdAtRevision(root, first, paths[0]), expected[0]);
  });
});

test("historical revisions preserve hashes after bounded snapshots are rematerialized", async context => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-nested-history-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeWorkspace(root);
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "--initial-branch=main"); git("config", "user.name", "Test User"); git("config", "user.email", "test@example.test");
  git("add", "."); git("commit", "-m", "Create workspace");
  const first = git("rev-parse", "HEAD");
  await writeFile(join(root, "data/people/person-extra.json"), JSON.stringify({ id: "person-extra", type: "person", title: "Extra" }));
  git("add", "."); git("commit", "-m", "Add person");
  const second = git("rev-parse", "HEAD");
  const loaded = await loadWorkspace(root);
  await withAssessmentCache(async () => {
    const history = reviewHistoryContext(root, loaded);
    const older = reviewHistoricalWorkspace(history, first);
    const newer = reviewHistoricalWorkspace(history, second);
    const original = collectionRevision(older, "person");
    assert.equal(reviewHistoricalWorkspace(reviewHistoryContext(root, newer), first).historicalCommit, first);
    assert.notEqual(collectionRevision(newer, "person"), original);
    history.workspacesByCommit.clear();
    const rematerialized = reviewHistoricalWorkspace(history, first);
    assert.notEqual(rematerialized, older);
    assert.equal(collectionRevision(rematerialized, "person"), original);
  });
});

for (const mode of ["oversized", "unavailable"]) test(`assessment object reads preserve individual fallback for ${mode} trees`, async context => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-tree-fallback-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeWorkspace(root);
  const topLevel = await realpath(root);
  const revision = "a".repeat(40), object = "b".repeat(40);
  let trees = 0, objects = 0;
  const run = ({ args }) => {
    if (args[0] === "ls-tree") {
      trees++;
      if (mode === "unavailable") throw new Error("Unsupported tree read");
      return "x".repeat(512 * 1024 + 1);
    }
    if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return topLevel;
    if (args[0] === "rev-parse") { objects++; return object; }
    throw new Error("Unexpected command");
  };
  withGitCommandAdapterForTests({ run, runSync: run }, () => withAssessmentGitCache(() => {
    assert.equal(getFileObjectIdAtRevision(root, revision, "data/one.json"), object);
    assert.equal(getFileObjectIdAtRevision(root, revision, "data/two.json"), object);
  }));
  assert.equal(trees, 1);
  assert.equal(objects, 2);
});
