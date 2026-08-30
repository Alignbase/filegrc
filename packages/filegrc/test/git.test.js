import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createAppState, createResources, getBrowserRepositoryState, getGitSummary, getRepositorySnapshot, getWorkspaceHistories, prefetchBrowserRemote, retryBrowserSync, runBrowserMutation, serveWorkspace, updateResource } from "../src/index.js";
import {
  BROWSER_VALIDATION,
  commitAndPushWorkspace,
  commitWorkspace,
  getChangedDataPathsSinceRevision,
  getDataFilesAtRevision,
  getDataRecordHistoryIndex,
  getFileAtRevision,
  getFileObjectIdAtRevision,
  getFilePathAtRevision,
  getFilesAtRevisions,
  getFileHistory,
  getFileHistoryWithPaths,
  getWorkingFileObjectId,
  GitOperationError,
  hasGitRevision,
  isDataHistoryAncestor,
  pullWorkspace,
  pushWorkspace,
  runGitCommand,
  sanitizeGitErrorMessage,
  setHistoricalBatchInterceptorForTests,
  setGitCommandInterceptorForTests
} from "../src/git.js";
import { reconcileMutationSynchronization } from "../src/server.js";
import { collectTimings } from "../src/timing.js";
import { makeComprehensiveWorkspace } from "./fixtures.js";
import { makeWorkspace, writeJson } from "./helpers.js";

const execute = promisify(execFile);

test("tracks each historical Markdown path across Git renames", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-content-history-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeWorkspace(root);
  await git(root, ["init"]);
  await git(root, ["config", "user.name", "Test User"]);
  await git(root, ["config", "user.email", "test@example.test"]);
  await writeFile(join(root, "data", "original.md"), "original\n", "utf8");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "Add original content"]);
  const originalCommit = (await git(root, ["rev-parse", "HEAD"])).stdout.trim();
  await git(root, ["mv", "data/original.md", "data/renamed.md"]);
  await git(root, ["commit", "-m", "Rename content"]);

  const history = getFileHistoryWithPaths(root, "data/renamed.md", Number.MAX_SAFE_INTEGER);
  assert.deepEqual(history.map(({ path }) => path), ["data/renamed.md", "data/original.md"]);
  assert.equal(getFilePathAtRevision(root, "data/renamed.md", originalCommit), "data/original.md");
});

test("uses Git committer time for file-history recording time", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-committer-time-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeWorkspace(root);
  await git(root, ["init"]);
  await git(root, ["config", "user.name", "Test User"]);
  await git(root, ["config", "user.email", "test@example.test"]);
  await git(root, ["add", "."]);
  await execute("git", ["commit", "-m", "Record workspace"], {
    cwd: root,
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: "2001-01-01T00:00:00Z",
      GIT_COMMITTER_DATE: "2026-08-28T12:00:00Z"
    }
  });

  const history = getFileHistory(root, "data/people/person-owner.json");
  assert.equal(history[0].timestamp, "2026-08-28T12:00:00Z");
  const pathHistory = getFileHistoryWithPaths(root, "data/people/person-owner.json");
  assert.equal(pathHistory[0].timestamp, "2026-08-28T12:00:00Z");
});

test("ignores Git replacement refs when reading authoritative history", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-replace-ref-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeWorkspace(root);
  await git(root, ["init", "--initial-branch=main"]);
  await git(root, ["config", "user.name", "Test User"]);
  await git(root, ["config", "user.email", "test@example.test"]);
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "Record authoritative workspace"]);
  const authoritativeCommit = (await git(root, ["rev-parse", "HEAD"])).stdout.trim();
  const ownerPath = join(root, "data", "people", "person-owner.json");
  const owner = JSON.parse(await readFile(ownerPath, "utf8"));
  await writeJson(ownerPath, { ...owner, title: "Replacement-ref title" });
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "Create replacement object"]);
  const replacementCommit = (await git(root, ["rev-parse", "HEAD"])).stdout.trim();
  await git(root, ["replace", authoritativeCommit, replacementCommit]);

  assert.equal(
    JSON.parse(getFileAtRevision(root, authoritativeCommit, "data/people/person-owner.json")).title,
    owner.title
  );
  assert.equal(getDataRecordHistoryIndex(root).commits.includes(authoritativeCommit), true);
  const cachedDataFiles = getDataFilesAtRevision(root, authoritativeCommit);
  assert.ok(cachedDataFiles.includes("data/workspace.json"));
  assert.ok(cachedDataFiles.every((path) => path.endsWith(".json")));
});

test("ignores legacy Git grafts when reading authoritative history", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-graft-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeWorkspace(root);
  await git(root, ["init", "--initial-branch=main"]);
  await git(root, ["config", "user.name", "Test User"]);
  await git(root, ["config", "user.email", "test@example.test"]);
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "Record authoritative workspace"]);
  const head = (await git(root, ["rev-parse", "HEAD"])).stdout.trim();
  const tree = (await git(root, ["rev-parse", "HEAD^{tree}"])).stdout.trim();
  const unrelated = (await git(root, ["commit-tree", tree, "-m", "Unrelated history"])).stdout.trim();
  await writeFile(join(root, ".git", "info", "grafts"), `${head} ${unrelated}\n`, "utf8");

  const index = getDataRecordHistoryIndex(root);
  assert.deepEqual(index.commits, [head]);
  assert.equal(isDataHistoryAncestor(root, unrelated, head), false);
});

test("ignores inherited Git repository redirection", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-real-repository-"));
  const alternate = await mkdtemp(join(tmpdir(), "filegrc-redirected-repository-"));
  context.after(() => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(alternate, { recursive: true, force: true })
  ]));
  for (const workspace of [root, alternate]) {
    await makeWorkspace(workspace);
    await git(workspace, ["init", "--initial-branch=main"]);
    await git(workspace, ["config", "user.name", "Test User"]);
    await git(workspace, ["config", "user.email", "test@example.test"]);
    await git(workspace, ["add", "."]);
    await git(workspace, ["commit", "-m", workspace === root ? "Real history" : "Redirected history"]);
  }
  const realCommit = (await git(root, ["rev-parse", "HEAD"])).stdout.trim();
  const alternateGitDirectory = (await git(alternate, ["rev-parse", "--absolute-git-dir"])).stdout.trim();
  const priorGitDirectory = process.env.GIT_DIR;
  const priorGitWorkTree = process.env.GIT_WORK_TREE;
  const priorLowerGitDirectory = process.env.git_dir;
  const priorMixedGitWorkTree = process.env.Git_Work_Tree;
  try {
    process.env.GIT_DIR = alternateGitDirectory;
    process.env.GIT_WORK_TREE = alternate;
    process.env.git_dir = alternateGitDirectory;
    process.env.Git_Work_Tree = alternate;
    assert.equal(getGitSummary(root).commit, realCommit);
    assert.deepEqual(getDataRecordHistoryIndex(root).commits, [realCommit]);
  } finally {
    if (priorGitDirectory === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = priorGitDirectory;
    if (priorGitWorkTree === undefined) delete process.env.GIT_WORK_TREE;
    else process.env.GIT_WORK_TREE = priorGitWorkTree;
    if (priorLowerGitDirectory === undefined) delete process.env.git_dir;
    else process.env.git_dir = priorLowerGitDirectory;
    if (priorMixedGitWorkTree === undefined) delete process.env.Git_Work_Tree;
    else process.env.Git_Work_Tree = priorMixedGitWorkTree;
  }
});

test("managed commits disable executable Git automation and reject content filters", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-safe-git-config-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeWorkspace(root);
  await git(root, ["init", "--initial-branch=main"]);
  await git(root, ["config", "user.name", "Test User"]);
  await git(root, ["config", "user.email", "test@example.test"]);
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "Initial workspace"]);

  const hooks = join(root, "configured-hooks");
  const fsmonitorMarker = join(root, "fsmonitor-ran");
  const hookMarker = join(root, "pre-commit-ran");
  const fsmonitor = join(root, "configured-fsmonitor");
  await mkdir(hooks, { recursive: true });
  await writeFile(fsmonitor, `#!/bin/sh\ntouch '${fsmonitorMarker}'\n`, "utf8");
  await writeFile(join(hooks, "pre-commit"), `#!/bin/sh\ntouch '${hookMarker}'\nexit 1\n`, "utf8");
  await chmod(fsmonitor, 0o755);
  await chmod(join(hooks, "pre-commit"), 0o755);
  await git(root, ["config", "core.fsmonitor", fsmonitor]);
  await git(root, ["config", "core.hooksPath", hooks]);

  assert.equal(getGitSummary(root).available, true);
  await assert.rejects(access(fsmonitorMarker));
  const ownerPath = join(root, "data", "people", "person-owner.json");
  const owner = JSON.parse(await readFile(ownerPath, "utf8"));
  await writeJson(ownerPath, { ...owner, department: "Security" });
  await commitWorkspace(root, "Commit without repository automation");
  await assert.rejects(access(hookMarker));

  const filterMarker = join(root, "filter-ran");
  await git(root, ["config", "filter.untrusted.clean", `sh -c "touch '${filterMarker}'; cat"`]);
  await writeFile(join(root, ".gitattributes"), "data/people/person-owner.json filter=untrusted\n", "utf8");
  await writeJson(ownerPath, { ...owner, department: "Controls" });
  await assert.rejects(
    commitWorkspace(root, "Do not apply content filters"),
    /will not commit.*content filter/i
  );
  await assert.rejects(access(filterMarker));
});

test("managed commits reject symlinks without storing their target bytes", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-symlink-object-leak-"));
  const secret = join(root, "..", `filegrc-secret-${Date.now()}.txt`);
  context.after(() => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(secret, { force: true })
  ]));
  await makeWorkspace(root);
  await git(root, ["init", "--initial-branch=main"]);
  await configureGit(root);
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "Initial workspace"]);
  await writeFile(secret, "sensitive bytes that must not enter Git\n", "utf8");
  const secretObject = (await git(root, ["hash-object", "--no-filters", secret])).stdout.trim();
  await assert.rejects(git(root, ["cat-file", "-e", secretObject]));
  await symlink(secret, join(root, "leaked-secret.txt"));

  await assert.rejects(commitWorkspace(root, "Do not store symlink targets"), /will not commit symbolic link/);
  await assert.rejects(git(root, ["cat-file", "-e", secretObject]));
});

test("managed commits reject ancestor symlinks without storing outside bytes", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-ancestor-symlink-leak-"));
  const outside = await mkdtemp(join(tmpdir(), "filegrc-outside-data-"));
  context.after(() => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(outside, { recursive: true, force: true })
  ]));
  await makeWorkspace(root);
  await git(root, ["init", "--initial-branch=main"]);
  await configureGit(root);
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "Initial workspace"]);
  const people = join(root, "data", "people");
  const outsideOwner = join(outside, "person-owner.json");
  await writeFile(outsideOwner, "sensitive bytes behind an ancestor symlink\n", "utf8");
  const secretObject = (await git(root, ["hash-object", "--no-filters", outsideOwner])).stdout.trim();
  await assert.rejects(git(root, ["cat-file", "-e", secretObject]));
  await rm(people, { recursive: true });
  await symlink(outside, people);

  await assert.rejects(commitWorkspace(root, "Do not follow ancestor symlinks"), /workspace entry.*changed while its bytes|will not commit/i);
  await assert.rejects(git(root, ["cat-file", "-e", secretObject]));
});

test("managed commits reject skip-worktree and assume-unchanged index entries", async (context) => {
  for (const scenario of ["skip-worktree", "assume-unchanged"]) {
    const root = await mkdtemp(join(tmpdir(), `filegrc-hidden-index-${scenario}-`));
    context.after(() => rm(root, { recursive: true, force: true }));
    await makeWorkspace(root);
    await writeFile(join(root, "hidden-note.txt"), "original\n", "utf8");
    await git(root, ["init", "--initial-branch=main"]);
    await configureGit(root);
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "Initial workspace"]);
    await git(root, ["update-index", `--${scenario}`, "hidden-note.txt"]);
    if (scenario === "skip-worktree") await rm(join(root, "hidden-note.txt"));
    else await writeFile(join(root, "hidden-note.txt"), "hidden edit\n", "utf8");
    const ownerPath = join(root, "data", "people", "person-owner.json");
    const owner = JSON.parse(await readFile(ownerPath, "utf8"));
    await writeJson(ownerPath, { ...owner, department: scenario });

    await assert.rejects(
      commitWorkspace(root, "Do not omit hidden index changes"),
      /skip-worktree or assume-unchanged/
    );
  }
});

test("managed commits reject authoritative files ignored by repository and user exclude rules", async (context) => {
  for (const ignoreKind of ["gitignore", "info-exclude", "configured-excludes"]) {
    const root = await mkdtemp(join(tmpdir(), `filegrc-ignored-data-${ignoreKind}-`));
    context.after(() => rm(root, { recursive: true, force: true }));
    await makeWorkspace(root);
    await git(root, ["init", "--initial-branch=main"]);
    await git(root, ["config", "user.name", "Test User"]);
    await git(root, ["config", "user.email", "test@example.test"]);
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "Initial workspace"]);
    const rule = "data/people/person-ignored.json\n";
    if (ignoreKind === "gitignore") {
      await writeFile(join(root, ".gitignore"), rule, "utf8");
    } else if (ignoreKind === "info-exclude") {
      await writeFile(join(root, ".git", "info", "exclude"), rule, "utf8");
    } else {
      const excludes = join(root, "configured-excludes");
      await writeFile(excludes, rule, "utf8");
      await git(root, ["config", "core.excludesFile", excludes]);
    }
    const ownerPath = join(root, "data", "people", "person-owner.json");
    const owner = JSON.parse(await readFile(ownerPath, "utf8"));
    await writeJson(join(root, "data", "people", "person-ignored.json"), {
      ...owner,
      id: "person-ignored",
      title: "Ignored Person"
    });
    await writeJson(ownerPath, { ...owner, department: "Security" });
    await assert.rejects(commitWorkspace(root, "Do not omit ignored data"), /authoritative data files are ignored/);
  }
});

test("indexes data history when commit metadata contains record separators", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-control-byte-history-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeWorkspace(root);
  await git(root, ["init"]);
  await git(root, ["config", "user.name", "Test User"]);
  await git(root, ["config", "user.email", "test@example.test"]);
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", `Initial records\x1econtrolled suffix`]);

  const index = getDataRecordHistoryIndex(root);
  assert.equal(index.available, true);
  assert.equal(index.commits.length, 1);
  assert.equal(index.historiesById.get("person-owner")?.length, 1);
  assert.match(index.historiesById.get("person-owner")[0].subject, /controlled suffix/);
  const pathHistory = getFileHistoryWithPaths(root, "data/people/person-owner.json");
  assert.equal(pathHistory.length, 1);
  assert.equal(pathHistory[0].path, "data/people/person-owner.json");
  assert.match(pathHistory[0].subject, /controlled suffix/);
});

test("rejects a shallow repository as an incomplete data history", async (context) => {
  const source = await mkdtemp(join(tmpdir(), "filegrc-shallow-source-"));
  const root = await mkdtemp(join(tmpdir(), "filegrc-shallow-clone-"));
  context.after(() => Promise.all([
    rm(source, { recursive: true, force: true }),
    rm(root, { recursive: true, force: true })
  ]));
  await makeWorkspace(source);
  await git(source, ["init"]);
  await git(source, ["config", "user.name", "Test User"]);
  await git(source, ["config", "user.email", "test@example.test"]);
  await git(source, ["add", "."]);
  await git(source, ["commit", "-m", "Initial records"]);
  const ownerPath = join(source, "data", "people", "person-owner.json");
  const owner = JSON.parse(await readFile(ownerPath, "utf8"));
  await writeFile(ownerPath, `${JSON.stringify({ ...owner, title: "Changed owner" }, null, 2)}\n`, "utf8");
  await git(source, ["add", "."]);
  await git(source, ["commit", "-m", "Change owner"]);
  await rm(root, { recursive: true, force: true });
  await execute("git", ["clone", "--depth=1", `file://${source}`, root]);

  const index = getDataRecordHistoryIndex(root);
  assert.equal(index.head?.length, 40);
  assert.equal(index.available, false);
  assert.match(index.error.message, /shallow/);
});

test("compares historical attachments larger than the command output limit by Git object ID", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-large-attachment-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeWorkspace(root);
  await git(root, ["init"]);
  await git(root, ["config", "user.name", "Test User"]);
  await git(root, ["config", "user.email", "test@example.test"]);
  const path = join(root, "data", "large-evidence.bin");
  await writeFile(path, Buffer.alloc(20_000_001, 0x61));
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "Add large evidence"]);
  const revision = getGitSummary(root).commit;

  assert.equal(
    getFileObjectIdAtRevision(root, revision, "data/large-evidence.bin"),
    getWorkingFileObjectId(root, "data/large-evidence.bin")
  );
  await writeFile(path, Buffer.alloc(20_000_001, 0x62));
  assert.notEqual(
    getFileObjectIdAtRevision(root, revision, "data/large-evidence.bin"),
    getWorkingFileObjectId(root, "data/large-evidence.bin")
  );
});

test("keeps a queued synchronization result when repository state came from an overlapping snapshot", () => {
  const synchronization = {
    status: "syncing",
    commit: "a".repeat(40),
    shortCommit: "aaaaaaaa",
    synchronizedAt: null,
    pushError: null
  };
  assert.equal(reconcileMutationSynchronization(synchronization, {
    status: "not-synced",
    backgroundSynchronization: null,
    backgroundSyncError: null,
    lastSuccessfulSynchronization: "2026-08-20T00:00:00.000Z"
  }), synchronization);
  assert.deepEqual(reconcileMutationSynchronization(synchronization, {
    status: "not-synced",
    backgroundSynchronization: { status: "failed", error: "push failed" },
    backgroundSyncError: "push failed",
    lastSuccessfulSynchronization: null
  }), {
    ...synchronization,
    status: "not-synced",
    pushError: "push failed"
  });
});

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
    () => getFilesAtRevisions(root, [
      { revision: initialCommit, relativePath: "data/people/person-owner.json" }
    ], { maxTotalBytes: 1 }),
    /1 byte safety limit/
  );
  assert.throws(
    () => getFilesAtRevisions(root, [
      { revision: initialCommit, relativePath: "data/people/person-owner.json" },
      { revision: initialCommit, relativePath: "data/workspace.json" }
    ], { maxRequests: 1 }),
    /1-request safety limit/
  );
  assert.throws(
    () => getFilesAtRevisions(root, [
      { revision: initialCommit, relativePath: "data/workspace.json" }
    ], { deadline: performance.now() - 1 }),
    /cumulative deadline/
  );
  await writeFile(join(root, "data", "batch-failure.md"), "batch failure fixture\n", "utf8");
  await git(parent, ["add", "compliance/data/batch-failure.md"]);
  await git(parent, ["commit", "-m", "Add batch failure fixture"]);
  const batchCommit = getGitSummary(root).commit;
  let batchCalls = 0;
  const restoreHistoricalBatch = setHistoricalBatchInterceptorForTests(() => {
    batchCalls += 1;
    throw new Error("forced batch failure");
  });
  try {
    assert.throws(
      () => getFilesAtRevisions(root, [
        { revision: batchCommit, relativePath: "data/batch-failure.md" }
      ]),
      /could not read the historical file batch safely/
    );
  } finally {
    restoreHistoricalBatch();
  }
  assert.equal(batchCalls, 1);
  await rm(join(root, "data", "batch-failure.md"));
  await git(parent, ["add", "compliance/data/batch-failure.md"]);
  await git(parent, ["commit", "-m", "Remove batch failure fixture"]);
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
  await git(parent, ["add", "outside.txt"]);

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
  assert.equal((await git(parent, ["show", "HEAD:outside.txt"])).stdout, "outside\n");
  assert.equal((await git(parent, ["diff", "--cached", "--name-only"])).stdout.trim(), "outside.txt");

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
  assert.equal((await git(parent, ["status", "--porcelain=v1", "--", "outside.txt"])).stdout.trim(), "M  outside.txt");
  assert.equal(getWorkspaceHistories(root, ["data/people/person-owner.json"]).get("data/people/person-owner.json").length, 3);
});

test("pushes exact commits and leaves incoming branch integration to Git", async (context) => {
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

  await assert.rejects(pullWorkspace(root), /fetched incoming commits but did not integrate them/);
  await git(root, ["merge", "--ff-only", "origin/main"]);
  assert.equal(await readFile(join(root, "remote-note.txt"), "utf8"), "remote one\n");

  await writeFile(join(root, "local-note.txt"), "local\n", "utf8");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "Add local note"]);
  await writeFile(join(peer, "remote-note-two.txt"), "remote two\n", "utf8");
  await git(peer, ["add", "."]);
  await git(peer, ["commit", "-m", "Add second remote note"]);
  await git(peer, ["push"]);

  await assert.rejects(pullWorkspace(root), /fetched incoming commits but did not integrate them/);
  await git(root, ["rebase", "origin/main"]);
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
  await assert.rejects(pullWorkspace(root), /fetched incoming commits but did not integrate them/);
  assert.equal((await git(root, ["status", "--porcelain=v1"])).stdout.trim(), "");

  await writeFile(join(root, "dirty-note.txt"), "dirty\n", "utf8");
  await assert.rejects(pullWorkspace(root), /Commit or discard workspace changes/);
  await assert.rejects(pushWorkspace(root), /Commit or discard workspace changes/);
});

test("manual push uses only the captured push URL", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "filegrc-exclusive-push-url-"));
  const root = join(parent, "workspace");
  const primary = join(parent, "primary.git");
  const extra = join(parent, "extra.git");
  context.after(() => rm(parent, { recursive: true, force: true }));
  await makeWorkspace(root);
  await git(root, ["init", "--initial-branch=main"]);
  await configureGit(root);
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "Initialize workspace"]);
  await git(parent, ["init", "--bare", "--initial-branch=main", primary]);
  await git(parent, ["init", "--bare", "--initial-branch=main", extra]);
  await git(root, ["remote", "add", "origin", primary]);
  await git(root, ["config", "--add", "remote.origin.pushurl", primary]);
  await git(root, ["config", "--add", "remote.origin.pushurl", extra]);
  await git(root, ["config", "push.followTags", "true"]);
  await git(root, ["config", "push.pushOption", "must-not-be-sent"]);
  await git(root, ["tag", "-a", "must-stay-local", "-m", "Local annotated tag"]);

  const pushed = await pushWorkspace(root);
  assert.equal((await git(primary, ["rev-parse", "main"])).stdout.trim(), pushed.commit);
  await assert.rejects(git(extra, ["rev-parse", "main"]));
  await assert.rejects(git(primary, ["rev-parse", "refs/tags/must-stay-local"]));
});

test("managed fetch ignores configured refspecs for unrelated local refs", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-exact-fetch-refspec-");
  const peer = join(fixture.parent, "peer");
  await git(fixture.parent, ["clone", fixture.remote, peer]);
  await configureGit(peer, "Peer User", "peer@example.test");
  const unrelatedBefore = (await git(fixture.root, ["rev-parse", "HEAD"])).stdout.trim();
  await git(fixture.root, ["branch", "unrelated", unrelatedBefore]);
  await git(fixture.root, ["tag", "local-only-tag", unrelatedBefore]);
  await git(fixture.root, ["config", "fetch.pruneTags", "true"]);
  await git(fixture.root, ["config", "--add", "remote.origin.fetch", "+refs/heads/main:refs/heads/unrelated"]);
  await writeFile(join(peer, "remote-note.txt"), "remote exact fetch\n", "utf8");
  await git(peer, ["add", "."]);
  await git(peer, ["commit", "-m", "Advance remote main"]);
  await git(peer, ["push"]);

  await prefetchBrowserRemote(fixture.root);
  assert.equal((await git(fixture.root, ["rev-parse", "unrelated"])).stdout.trim(), unrelatedBefore);
  assert.notEqual((await git(fixture.root, ["rev-parse", "origin/main"])).stdout.trim(), unrelatedBefore);
  assert.equal((await git(fixture.root, ["rev-parse", "local-only-tag"])).stdout.trim(), unrelatedBefore);

  await git(fixture.root, ["config", "fetch.bundleURI", join(fixture.parent, "untrusted.bundle")]);
  await assert.rejects(prefetchBrowserRemote(fixture.root), /repository-local executable transport/);
});

test("exact push lease rejects a deleted remote branch", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "filegrc-push-lease-"));
  const root = join(parent, "workspace");
  const remote = join(parent, "remote.git");
  context.after(() => rm(parent, { recursive: true, force: true }));
  await makeWorkspace(root);
  await git(root, ["init", "--initial-branch=main"]);
  await configureGit(root);
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "Initialize workspace"]);
  await git(parent, ["init", "--bare", "--initial-branch=main", remote]);
  await git(root, ["remote", "add", "origin", remote]);
  await git(root, ["push", "--set-upstream", "origin", "main"]);
  await writeFile(join(root, "lease-note.txt"), "local exact push\n", "utf8");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "Add lease note"]);
  const push = pauseGitCommand(context, ({ args }) => args.includes("push"));
  const operation = pushWorkspace(root);

  await push.started;
  await git(remote, ["update-ref", "-d", "refs/heads/main"]);
  push.release();
  await assert.rejects(operation, /Git could not push/i);
  await assert.rejects(git(remote, ["rev-parse", "main"]));
});

test("commit-and-push never recaptures a switched branch", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "filegrc-commit-push-checkout-race-"));
  const root = join(parent, "workspace");
  const remote = join(parent, "remote.git");
  context.after(() => rm(parent, { recursive: true, force: true }));
  await makeWorkspace(root);
  await git(root, ["init", "--initial-branch=main"]);
  await configureGit(root);
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "Initialize workspace"]);
  await git(parent, ["init", "--bare", "--initial-branch=main", remote]);
  await git(root, ["remote", "add", "origin", remote]);
  await writeFile(join(root, "manual-note.txt"), "validated manual change\n", "utf8");
  const push = pauseGitCommand(context, ({ args }) => args.includes("push"));
  const operation = commitAndPushWorkspace(root, "Commit exact manual change");

  await push.started;
  const committedMain = (await git(root, ["rev-parse", "main"])).stdout.trim();
  await git(root, ["switch", "-c", "switched-before-push"]);
  push.release();
  const result = await operation;

  assert.equal(result.commit, committedMain);
  assert.equal(result.pushed, false);
  assert.match(result.pushError, /checked-out Git branch or commit changed/);
  await assert.rejects(git(remote, ["rev-parse", "main"]));
  await assert.rejects(git(remote, ["rev-parse", "switched-before-push"]));
});

test("managed pull fetches incoming commits without changing the checked-out branch", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "filegrc-pull-checkout-race-"));
  const root = join(parent, "workspace");
  const remote = join(parent, "remote.git");
  const peer = join(parent, "peer");
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(parent, { recursive: true, force: true })));
  await makeWorkspace(root);
  await git(root, ["init", "--initial-branch=main"]);
  await configureGit(root);
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "Initialize workspace"]);
  await git(parent, ["init", "--bare", "--initial-branch=main", remote]);
  await git(root, ["remote", "add", "origin", remote]);
  await git(root, ["push", "--set-upstream", "origin", "main"]);
  await git(parent, ["clone", remote, peer]);
  await configureGit(peer, "Peer User", "peer@example.test");
  await writeFile(join(peer, "remote-note.txt"), "remote change\n", "utf8");
  await git(peer, ["add", "."]);
  await git(peer, ["commit", "-m", "Add remote change"]);
  await git(peer, ["push"]);

  const before = (await git(root, ["rev-parse", "HEAD"])).stdout.trim();
  await assert.rejects(pullWorkspace(root), /fetched incoming commits but did not integrate them/);
  assert.equal((await git(root, ["rev-parse", "main"])).stdout.trim(), before);
  await assert.rejects(access(join(root, "remote-note.txt")), /ENOENT/);
});

test("managed pull never aborts an existing Git operation", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-pull-existing-rebase-");
  const gitDirectory = (await git(fixture.root, ["rev-parse", "--absolute-git-dir"])).stdout.trim();
  const rebaseDirectory = join(gitDirectory, "rebase-merge");
  await mkdir(rebaseDirectory);
  await writeFile(join(rebaseDirectory, "head-name"), "refs/heads/main\n", "utf8");

  await assert.rejects(pullWorkspace(fixture.root), /Git rebase is already in progress/);
  await access(rebaseDirectory);

  const ownerPath = join(fixture.root, "data", "people", "person-owner.json");
  const owner = JSON.parse(await readFile(ownerPath, "utf8"));
  await writeJson(ownerPath, { ...owner, department: "Pending operation" });
  const before = (await git(fixture.root, ["rev-parse", "HEAD"])).stdout.trim();
  await assert.rejects(commitWorkspace(fixture.root, "Do not interrupt the rebase"), /Git rebase is already in progress/);
  assert.equal((await git(fixture.root, ["rev-parse", "HEAD"])).stdout.trim(), before);
  await access(rebaseDirectory);

  await rm(rebaseDirectory, { recursive: true });
  const sentinels = [
    ["MERGE_HEAD", "merge", false],
    ["rebase-apply", "rebase", true],
    ["CHERRY_PICK_HEAD", "cherry-pick", false],
    ["REVERT_HEAD", "revert", false],
    ["sequencer", "sequencer", true],
    ["BISECT_START", "bisect", false]
  ];
  for (const [path, operation, directory] of sentinels) {
    const sentinel = join(gitDirectory, path);
    if (directory) await mkdir(sentinel);
    else await writeFile(sentinel, `${before}\n`, "utf8");
    await assert.rejects(commitWorkspace(fixture.root, `Do not interrupt ${operation}`), new RegExp(`Git ${operation} is already in progress`));
    await access(sentinel);
    await rm(sentinel, { recursive: true });
  }
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

test("trunk-mode browser mutations require Git to integrate incoming commits", async (context) => {
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
  assert.equal(behindState.repository.writesAllowed, false);
  assert.equal(behindState.readOnly, true);

  const staleResponse = await fetch(`${running.url}/api/resource/person/person-owner`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      record: { ...staleOwner.record, department: "Stale local edit" },
      revision: staleOwner.revision
    })
  });
  assert.equal(staleResponse.status, 409);
  assert.match((await staleResponse.json()).error, /Fast-forward it with Git/i);
  assert.equal(
    JSON.parse(await readFile(join(fixture.root, "data", "people", "person-owner.json"), "utf8")).department,
    "Controls"
  );
  assert.equal((await git(fixture.root, ["rev-list", "--count", "HEAD"])).stdout.trim(), "2");
});

test("trunk-mode browser saves return after the local commit while push continues in the background", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-trunk-background-push-");
  const push = pauseGitCommand(context, ({ args }) => args.includes("push"));
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
  const push = pauseGitCommand(context, ({ args }) => args.includes("push"));
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

test("a private-index browser commit preserves validated bytes after a later edit", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-trunk-post-validation-race-");
  const initialState = await createAppState(fixture.root);
  const owner = initialState.resources.find(({ record }) => record.id === "person-owner");
  const ownerPath = join(fixture.root, "data", "people", "person-owner.json");
  const stage = pauseGitCommand(context, ({ args, options }) => args[0] === "read-tree" && options.gitIndexFile);
  const mutation = runBrowserMutation(fixture.root, {
    message: "Commit validated bytes from a private index"
  }, () => updateResource(fixture.root, "person", owner.record.id, {
    ...owner.record,
    department: "Validated change"
  }, {
    expectedRevision: owner.revision
  }));

  await stage.started;
  await writeJson(ownerPath, { ...owner.record, department: "Concurrent unvalidated change" });
  stage.release();
  await mutation;
  const committedOwner = JSON.parse((await git(fixture.root, ["show", "HEAD:data/people/person-owner.json"])).stdout);
  assert.equal(committedOwner.department, "Validated change");
  assert.equal(JSON.parse(await readFile(ownerPath, "utf8")).department, "Concurrent unvalidated change");
});

test("an exact-tree browser commit cannot reread a later worktree edit", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-trunk-commit-race-");
  const initialState = await createAppState(fixture.root);
  const owner = initialState.resources.find(({ record }) => record.id === "person-owner");
  const ownerPath = join(fixture.root, "data", "people", "person-owner.json");
  const commit = pauseGitCommand(context, ({ args }) => args[0] === "commit-tree");
  const mutation = runBrowserMutation(fixture.root, {
    message: "Commit the exact validated tree"
  }, () => updateResource(fixture.root, "person", owner.record.id, {
    ...owner.record,
    department: "Validated tree"
  }, {
    expectedRevision: owner.revision
  }));

  await commit.started;
  await writeJson(ownerPath, { ...owner.record, department: "Later worktree edit" });
  commit.release();
  await mutation;
  const committedOwner = JSON.parse((await git(fixture.root, ["show", "HEAD:data/people/person-owner.json"])).stdout);
  assert.equal(committedOwner.department, "Validated tree");
  assert.equal(JSON.parse(await readFile(ownerPath, "utf8")).department, "Later worktree edit");
});

test("a manual commit stops if a Git operation begins during commit construction", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-manual-commit-operation-race-");
  const ownerPath = join(fixture.root, "data", "people", "person-owner.json");
  const owner = JSON.parse(await readFile(ownerPath, "utf8"));
  await writeJson(ownerPath, { ...owner, department: "Pending manual commit" });
  const before = (await git(fixture.root, ["rev-parse", "HEAD"])).stdout.trim();
  const gitDirectory = (await git(fixture.root, ["rev-parse", "--absolute-git-dir"])).stdout.trim();
  const commit = pauseGitCommand(context, ({ args }) => args[0] === "commit-tree");
  const operation = commitWorkspace(fixture.root, "Do not cross operation state");

  await commit.started;
  const mergeHead = join(gitDirectory, "MERGE_HEAD");
  await writeFile(mergeHead, `${before}\n`, "utf8");
  commit.release();

  await assert.rejects(operation, /Git merge is already in progress/);
  assert.equal((await git(fixture.root, ["rev-parse", "HEAD"])).stdout.trim(), before);
  await access(mergeHead);
});

test("a trunk commit stops if a Git operation begins during commit construction", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-trunk-commit-operation-race-");
  const initialState = await createAppState(fixture.root);
  const owner = initialState.resources.find(({ record }) => record.id === "person-owner");
  const gitDirectory = (await git(fixture.root, ["rev-parse", "--absolute-git-dir"])).stdout.trim();
  const commit = pauseGitCommand(context, ({ args }) => args[0] === "commit-tree");
  const operation = runBrowserMutation(fixture.root, {
    message: "Do not cross trunk operation state"
  }, () => updateResource(fixture.root, "person", owner.record.id, {
    ...owner.record,
    department: "Pending trunk commit"
  }, { expectedRevision: owner.revision }));

  await commit.started;
  const rebaseDirectory = join(gitDirectory, "rebase-apply");
  await mkdir(rebaseDirectory);
  commit.release();

  await assert.rejects(operation, /Git rebase is already in progress/);
  assert.equal((await git(fixture.root, ["rev-parse", "main"])).stdout.trim(), initialState.repository.currentCommit);
  await access(rebaseDirectory);
});

test("a trunk commit rechecks Git operation state at the branch update boundary", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-trunk-update-ref-operation-race-");
  const initialState = await createAppState(fixture.root);
  const owner = initialState.resources.find(({ record }) => record.id === "person-owner");
  const gitDirectory = (await git(fixture.root, ["rev-parse", "--absolute-git-dir"])).stdout.trim();
  const updateRef = pauseGitCommand(context, ({ args }) => (
    args[0] === "update-ref" && args.includes("refs/heads/main")
  ));
  const operation = runBrowserMutation(fixture.root, {
    message: "Recheck operation at update-ref"
  }, () => updateResource(fixture.root, "person", owner.record.id, {
    ...owner.record,
    department: "Must remain uncommitted"
  }, { expectedRevision: owner.revision }));

  await updateRef.started;
  const mergeHead = join(gitDirectory, "MERGE_HEAD");
  await writeFile(mergeHead, `${initialState.repository.currentCommit}\n`, "utf8");
  updateRef.release();

  await assert.rejects(operation, /Git merge is already in progress/);
  assert.equal((await git(fixture.root, ["rev-parse", "main"])).stdout.trim(), initialState.repository.currentCommit);
  await access(mergeHead);
});

test("shared-index reconciliation never removes a foreign index lock", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-foreign-index-lock-");
  const initialState = await createAppState(fixture.root);
  const owner = initialState.resources.find(({ record }) => record.id === "person-owner");
  const gitDirectory = (await git(fixture.root, ["rev-parse", "--absolute-git-dir"])).stdout.trim();
  const updateRef = pauseGitCommand(context, ({ args }) => (
    args[0] === "update-ref" && args.includes("refs/heads/main")
  ));
  const operation = runBrowserMutation(fixture.root, {
    message: "Preserve a foreign index lock"
  }, () => updateResource(fixture.root, "person", owner.record.id, {
    ...owner.record,
    department: "Committed with foreign lock"
  }, { expectedRevision: owner.revision }));

  await updateRef.started;
  const lock = join(gitDirectory, "index.lock");
  await writeFile(lock, "owned by another Git process\n", "utf8");
  updateRef.release();
  const result = await operation;

  assert.equal(result.synchronization.status, "not-synced");
  assert.equal(await readFile(lock, "utf8"), "owned by another Git process\n");
});

test("shared-index reconciliation requires HEAD to remain at the created commit", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-index-head-race-");
  const initialState = await createAppState(fixture.root);
  const owner = initialState.resources.find(({ record }) => record.id === "person-owner");
  const gitDirectory = (await git(fixture.root, ["rev-parse", "--absolute-git-dir"])).stdout.trim();
  const indexPath = join(gitDirectory, "index");
  const initialIndex = await readFile(indexPath);
  const tree = (await git(fixture.root, ["rev-parse", `${initialState.repository.currentCommit}^{tree}`])).stdout.trim();
  const alternate = (await git(fixture.root, ["commit-tree", tree, "-p", initialState.repository.currentCommit, "-m", "Concurrent branch advance"])).stdout.trim();
  let createdCommit;
  const restore = setGitCommandInterceptorForTests(async ({ cwd, args, run }) => {
    const result = await run();
    if (!createdCommit && args[0] === "update-ref" && args.includes("refs/heads/main")) {
      createdCommit = args[4];
      await git(cwd, ["update-ref", "refs/heads/main", alternate, createdCommit]);
    }
    return result;
  });
  context.after(restore);

  const result = await runBrowserMutation(fixture.root, {
    message: "Do not reconcile under a newer HEAD"
  }, () => updateResource(fixture.root, "person", owner.record.id, {
    ...owner.record,
    department: "Created older commit"
  }, { expectedRevision: owner.revision }));

  assert.equal(result.synchronization.status, "not-synced");
  assert.equal(result.synchronization.commit, createdCommit);
  assert.equal((await git(fixture.root, ["rev-parse", "main"])).stdout.trim(), alternate);
  assert.deepEqual(await readFile(indexPath), initialIndex);
});

test("a finalizing background push blocks a newer browser mutation", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-background-finalize-race-");
  const initialState = await createAppState(fixture.root);
  const owner = initialState.resources.find(({ record }) => record.id === "person-owner");
  const push = pauseGitCommand(context, ({ args }) => args.includes("push"));
  const first = await runBrowserMutation(fixture.root, {
    message: "First background commit",
    backgroundPushDelayMs: 100
  }, () => updateResource(fixture.root, "person", owner.record.id, {
    ...owner.record,
    department: "First background commit"
  }, { expectedRevision: owner.revision }));

  await push.started;
  const second = runBrowserMutation(fixture.root, {
    message: "Must wait for first finalization"
  }, () => {
    throw new Error("The second mutation task must not run.");
  });
  let timeout;
  try {
    await assert.rejects(Promise.race([
      second,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Second mutation precondition timed out.")), 3_000);
      })
    ]), /background push is still finalizing/);
  } finally {
    clearTimeout(timeout);
    push.release();
  }
  const synced = await waitForRepository(fixture.root, "synced");
  assert.equal(synced.currentCommit, first.synchronization.commit);
});

test("a private-index browser commit ignores concurrent shared-index staging", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-trunk-shared-index-race-");
  const initialState = await createAppState(fixture.root);
  const owner = initialState.resources.find(({ record }) => record.id === "person-owner");
  const writeTree = pauseGitCommand(context, ({ args, options }) => args[0] === "write-tree" && options.gitIndexFile);
  const mutation = runBrowserMutation(fixture.root, {
    message: "Ignore concurrent shared-index staging"
  }, () => updateResource(fixture.root, "person", owner.record.id, {
    ...owner.record,
    department: "Private index"
  }, {
    expectedRevision: owner.revision
  }));

  await writeTree.started;
  await writeFile(join(fixture.root, "injected.txt"), "unvalidated staged content\n", "utf8");
  await git(fixture.root, ["add", "injected.txt"]);
  writeTree.release();
  const result = await mutation;
  assert.equal(result.synchronization.status, "not-synced");
  assert.equal(result.synchronization.commit, (await git(fixture.root, ["rev-parse", "main"])).stdout.trim());
  assert.match(result.synchronization.pushError, /shared Git index changed or could not be reconciled/);
  await assert.rejects(git(fixture.root, ["cat-file", "-e", "HEAD:injected.txt"]));
  assert.equal((await git(fixture.root, ["status", "--porcelain=v1", "--", "injected.txt"])).stdout.trim(), "A  injected.txt");
  const committedOwner = JSON.parse((await git(fixture.root, ["show", "HEAD:data/people/person-owner.json"])).stdout);
  assert.equal(committedOwner.department, "Private index");
});

test("a trunk browser mutation never integrates incoming commits", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-trunk-fast-forward-checkout-race-");
  const peer = join(fixture.parent, "peer");
  await git(fixture.parent, ["clone", fixture.remote, peer]);
  await configureGit(peer, "Peer User", "peer@example.test");
  await writeFile(join(peer, "remote-note.txt"), "remote fast-forward change\n", "utf8");
  await git(peer, ["add", "."]);
  await git(peer, ["commit", "-m", "Add remote fast-forward change"]);
  await git(peer, ["push"]);
  const initialState = await createAppState(fixture.root);
  const owner = initialState.resources.find(({ record }) => record.id === "person-owner");
  const before = initialState.repository.currentCommit;
  await assert.rejects(runBrowserMutation(fixture.root, {
    message: "Do not mutate a switched branch"
  }, () => updateResource(fixture.root, "person", owner.record.id, {
    ...owner.record,
    department: "Must not be saved"
  }, { expectedRevision: owner.revision })), /Fast-forward it with Git/);
  assert.equal((await git(fixture.root, ["rev-parse", "main"])).stdout.trim(), before);
  await assert.rejects(access(join(fixture.root, "remote-note.txt")), /ENOENT/);
});

test("a background push will not use a branch switched at the same commit", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-trunk-push-checkout-race-");
  const initialState = await createAppState(fixture.root);
  const owner = initialState.resources.find(({ record }) => record.id === "person-owner");
  const remoteBefore = (await git(fixture.remote, ["rev-parse", "main"])).stdout.trim();
  const push = pauseGitCommand(context, ({ args }) => args.includes("push"));
  const mutation = await runBrowserMutation(fixture.root, {
    message: "Bind push to the authoritative checkout",
    backgroundPushDelayMs: 100
  }, () => updateResource(fixture.root, "person", owner.record.id, {
    ...owner.record,
    department: "Local commit only"
  }, { expectedRevision: owner.revision }));

  await push.started;
  await git(fixture.root, ["switch", "-c", "same-tip-push-race"]);
  push.release();
  const started = Date.now();
  let repository;
  do {
    repository = await getBrowserRepositoryState(fixture.root);
    if (repository.backgroundSynchronization?.status === "failed") break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  } while (Date.now() - started < 2_000);

  assert.equal(repository.backgroundSynchronization?.status, "failed");
  assert.match(repository.backgroundSynchronization.error, /checked-out Git branch or commit changed/);
  assert.equal((await git(fixture.remote, ["rev-parse", "main"])).stdout.trim(), remoteBefore);
  assert.equal((await git(fixture.root, ["rev-parse", "main"])).stdout.trim(), mutation.synchronization.commit);
});

test("a browser commit stays bound to the authoritative checkout", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-trunk-checkout-race-");
  const initialState = await createAppState(fixture.root);
  const owner = initialState.resources.find(({ record }) => record.id === "person-owner");
  const ownerPath = join(fixture.root, "data", "people", "person-owner.json");
  const prefetched = await prefetchBrowserRemote(fixture.root);
  let statusChecks = 0;
  const status = pauseGitCommand(context, ({ args }) => (
    args[0] === "status"
    && args.includes("--untracked-files=all")
    && ++statusChecks === 2
  ));
  const mutation = runBrowserMutation(fixture.root, {
    message: "Stay on the authoritative branch",
    prefetchToken: prefetched.token
  }, () => updateResource(fixture.root, "person", owner.record.id, {
    ...owner.record,
    department: `Checkout race ${Date.now()}`
  }, { expectedRevision: owner.revision }));

  await status.started;
  await git(fixture.root, ["switch", "-c", "concurrent-checkout"]);
  status.release();
  await assert.rejects(mutation, /checked-out Git branch or commit changed/);
  assert.equal((await git(fixture.root, ["rev-parse", "main"])).stdout.trim(), initialState.repository.currentCommit);
  const rejectedObject = (await git(fixture.root, ["hash-object", "--no-filters", ownerPath])).stdout.trim();
  await assert.rejects(git(fixture.root, ["cat-file", "-e", rejectedObject]));
});

test("a browser commit binds the validated executable mode", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-trunk-mode-race-");
  const initialState = await createAppState(fixture.root);
  const owner = initialState.resources.find(({ record }) => record.id === "person-owner");
  const ownerPath = join(fixture.root, "data", "people", "person-owner.json");
  const stage = pauseGitCommand(context, ({ args, options }) => args[0] === "read-tree" && options.gitIndexFile);
  const mutation = runBrowserMutation(fixture.root, {
    message: "Preserve the validated mode"
  }, () => updateResource(fixture.root, "person", owner.record.id, {
    ...owner.record,
    department: "Validated mode"
  }, {
    expectedRevision: owner.revision
  }));

  await stage.started;
  await chmod(ownerPath, 0o755);
  stage.release();
  await mutation;
  assert.match((await git(fixture.root, ["ls-tree", "HEAD", "--", "data/people/person-owner.json"])).stdout, /^100644 /);
});

test("a browser commit rejects a same-bytes symlink swap", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-trunk-symlink-race-");
  const notePath = join(fixture.root, "note.txt");
  await writeFile(join(fixture.root, "target.txt"), "target contents\n", "utf8");
  await writeFile(notePath, "target.txt", "utf8");
  await git(fixture.root, ["add", "."]);
  await git(fixture.root, ["commit", "-m", "Add regular note"]);
  await git(fixture.root, ["push"]);
  const initialState = await createAppState(fixture.root);
  const owner = initialState.resources.find(({ record }) => record.id === "person-owner");
  const stage = pauseGitCommand(context, ({ args, options }) => args[0] === "read-tree" && options.gitIndexFile);
  const mutation = runBrowserMutation(fixture.root, {
    message: "Preserve the validated regular file"
  }, () => updateResource(fixture.root, "person", owner.record.id, {
    ...owner.record,
    department: "Validated symlink state"
  }, {
    expectedRevision: owner.revision
  }));

  await stage.started;
  await rm(notePath);
  await symlink("target.txt", notePath);
  stage.release();
  await mutation;
  assert.match((await git(fixture.root, ["ls-tree", "HEAD", "--", "note.txt"])).stdout, /^100644 /);
  assert.equal((await git(fixture.root, ["show", "HEAD:note.txt"])).stdout, "target.txt");
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

test("automatic remote checks reject executable transport configuration", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-trunk-ext-transport-");
  const marker = join(fixture.parent, "ext-transport-ran");
  await git(fixture.root, ["config", "protocol.ext.allow", "always"]);
  await git(fixture.root, ["remote", "set-url", "origin", `ext::touch ${marker}`]);

  await assert.rejects(
    prefetchBrowserRemote(fixture.root),
    /repository-local executable transport/
  );
  await assert.rejects(access(marker));
  await git(fixture.root, ["config", "--unset", "protocol.ext.allow"]);
  await assert.rejects(
    prefetchBrowserRemote(fixture.root),
    /URL scheme is not allowed/
  );
  await assert.rejects(access(marker));
});

test("automatic SSH remote checks reject local commands and URL rewrites", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-trunk-ssh-command-");
  const marker = join(fixture.parent, "ssh-command-ran");
  const command = join(fixture.parent, "configured-ssh-command");
  await writeFile(command, `#!/bin/sh\ntouch '${marker}'\nexit 1\n`, "utf8");
  await chmod(command, 0o755);
  await git(fixture.root, ["remote", "set-url", "origin", "ssh://example.invalid/repository"]);
  await git(fixture.root, ["config", "core.sshCommand", command]);

  await assert.rejects(
    prefetchBrowserRemote(fixture.root),
    /repository-local executable transport/
  );
  await assert.rejects(access(marker));
  await git(fixture.root, ["config", "--unset", "core.sshCommand"]);
  await git(fixture.root, ["config", "url.ssh://example.invalid/.insteadOf", "ssh://example.invalid/"]);
  await assert.rejects(
    prefetchBrowserRemote(fixture.root),
    /repository-local executable transport/
  );
  await assert.rejects(access(marker));
});

test("manual SSH synchronization neutralizes inherited askpass programs", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-manual-ssh-askpass-");
  const commands = join(fixture.parent, "commands");
  const marker = join(fixture.parent, "askpass-ran");
  const askpass = join(fixture.parent, "askpass");
  await mkdir(commands);
  await writeFile(askpass, `#!/bin/sh\ntouch '${marker}'\nexit 1\n`, "utf8");
  await writeFile(join(commands, "ssh"), "#!/bin/sh\n[ -z \"$SSH_ASKPASS\" ] || \"$SSH_ASKPASS\"\nexit 1\n", "utf8");
  await chmod(askpass, 0o755);
  await chmod(join(commands, "ssh"), 0o755);
  await git(fixture.root, ["remote", "set-url", "origin", "ssh://example.invalid/repository"]);
  const priorPath = process.env.PATH;
  const priorAskpass = process.env.SSH_ASKPASS;
  const priorAskpassRequire = process.env.SSH_ASKPASS_REQUIRE;
  try {
    process.env.PATH = `${commands}:${priorPath}`;
    process.env.SSH_ASKPASS = askpass;
    process.env.SSH_ASKPASS_REQUIRE = "force";
    await assert.rejects(pullWorkspace(fixture.root), /Git could not fetch origin before checking incoming commits/);
    await assert.rejects(access(marker));
  } finally {
    process.env.PATH = priorPath;
    if (priorAskpass === undefined) delete process.env.SSH_ASKPASS;
    else process.env.SSH_ASKPASS = priorAskpass;
    if (priorAskpassRequire === undefined) delete process.env.SSH_ASKPASS_REQUIRE;
    else process.env.SSH_ASKPASS_REQUIRE = priorAskpassRequire;
  }
});

test("automatic remote checks reject alternate-ref commands and local HTTP overrides", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-trunk-unsafe-http-");
  const marker = join(fixture.parent, "alternate-refs-ran");
  await git(fixture.root, ["config", "core.alternateRefsCommand", `sh -c "touch '${marker}'"`]);
  await assert.rejects(
    prefetchBrowserRemote(fixture.root),
    /repository-local executable transport, filter, merge, HTTP/
  );
  await assert.rejects(access(marker));
  await git(fixture.root, ["config", "--unset", "core.alternateRefsCommand"]);

  for (const [key, value] of [["http.sslVerify", "false"], ["http.proxy", "http://127.0.0.1:9"]]) {
    await git(fixture.root, ["config", key, value]);
    await assert.rejects(
      prefetchBrowserRemote(fixture.root),
      /repository-local executable transport, filter, merge, HTTP/
    );
    await git(fixture.root, ["config", "--unset", key]);
  }
  await git(fixture.root, ["config", "core.sparseCheckout", "true"]);
  await assert.rejects(
    prefetchBrowserRemote(fixture.root),
    /repository-local executable transport, filter, merge, HTTP/
  );
});

test("automatic remote checks reject unsafe worktree-scoped configuration", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-trunk-worktree-config-");
  const marker = join(fixture.parent, "worktree-ssh-ran");
  const command = join(fixture.parent, "worktree-ssh-command");
  await writeFile(command, `#!/bin/sh\ntouch '${marker}'\nexit 1\n`, "utf8");
  await chmod(command, 0o755);
  await git(fixture.root, ["config", "extensions.worktreeConfig", "yes"]);
  await git(fixture.root, ["config", "--worktree", "core.sshCommand", command]);

  await assert.rejects(
    prefetchBrowserRemote(fixture.root),
    /repository-local executable transport, filter, merge, HTTP/
  );
  await assert.rejects(access(marker));
});

test("managed synchronization rejects a redirected Git worktree", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-trunk-redirected-worktree-");
  const redirected = join(fixture.parent, "redirected");
  await mkdir(redirected);
  await writeFile(join(redirected, "sentinel.txt"), "unchanged\n", "utf8");
  await git(fixture.root, ["config", "core.worktree", redirected]);

  await assert.rejects(
    prefetchBrowserRemote(fixture.root),
    /redirects the Git worktree outside this workspace|not in a valid Git repository/
  );
  assert.equal(await readFile(join(redirected, "sentinel.txt"), "utf8"), "unchanged\n");
});

test("managed synchronization rejects incoming content filter attributes before checkout", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-trunk-incoming-filter-");
  const peer = join(fixture.parent, "peer");
  const initialState = await createAppState(fixture.root);
  await git(fixture.parent, ["clone", fixture.remote, peer]);
  await configureGit(peer);
  await writeFile(join(peer, ".gitattributes"), "incoming-filter.txt filter=untrusted\n", "utf8");
  await writeFile(join(peer, "incoming-filter.txt"), "remote contents\n", "utf8");
  await git(peer, ["add", "."]);
  await git(peer, ["commit", "-m", "Add filtered remote file"]);
  await git(peer, ["push"]);

  await assert.rejects(
    pullWorkspace(fixture.root),
    /will not check out incoming commit.*content filter/i
  );
  assert.equal((await git(fixture.root, ["rev-parse", "HEAD"])).stdout.trim(), initialState.repository.currentCommit);
  await assert.rejects(access(join(fixture.root, "incoming-filter.txt")));
});

test("managed synchronization rejects incoming symlinks and gitlinks before checkout", async (context) => {
  for (const kind of ["symlink", "gitlink"]) {
    const fixture = await makeTrunkGitFixture(context, `filegrc-trunk-incoming-${kind}-`);
    const peer = join(fixture.parent, "peer");
    await git(fixture.parent, ["clone", fixture.remote, peer]);
    await configureGit(peer);
    if (kind === "symlink") {
      await symlink("data/workspace.json", join(peer, "incoming-entry"));
      await git(peer, ["add", "incoming-entry"]);
    } else {
      const commit = (await git(peer, ["rev-parse", "HEAD"])).stdout.trim();
      await git(peer, ["update-index", "--add", "--cacheinfo", `160000,${commit},incoming-entry`]);
    }
    await git(peer, ["commit", "-m", `Add incoming ${kind}`]);
    await git(peer, ["push"]);

    await assert.rejects(
      pullWorkspace(fixture.root),
      /workspace tree contains a non-regular entry/
    );
    await assert.rejects(access(join(fixture.root, "incoming-entry")));
  }
});

test("managed pull rejects an incoming custom merge driver before rebasing", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-pull-incoming-merge-");
  const peer = join(fixture.parent, "peer");
  const isolatedHome = join(fixture.parent, "isolated-home");
  const marker = join(fixture.parent, "merge-driver-ran");
  const previousHome = process.env.HOME;
  await mkdir(isolatedHome);
  process.env.HOME = isolatedHome;
  context.after(() => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  });
  await git(fixture.root, ["config", "--global", "merge.untrusted.driver", `sh -c "touch '${marker}'; cat '%A'"`]);

  await writeFile(join(fixture.root, "local-note.txt"), "local change\n", "utf8");
  await git(fixture.root, ["add", "local-note.txt"]);
  await git(fixture.root, ["commit", "-m", "Add local change"]);
  const localCommit = (await git(fixture.root, ["rev-parse", "HEAD"])).stdout.trim();
  await git(fixture.parent, ["clone", fixture.remote, peer]);
  await configureGit(peer);
  await writeFile(join(peer, ".gitattributes"), "data/people/person-owner.json merge=untrusted\n", "utf8");
  await git(peer, ["add", ".gitattributes"]);
  await git(peer, ["commit", "-m", "Add custom merge attribute"]);
  await git(peer, ["push"]);

  await assert.rejects(pullWorkspace(fixture.root), /will not check out incoming commit.*merge driver/i);
  await assert.rejects(access(marker));
  assert.equal((await git(fixture.root, ["rev-parse", "HEAD"])).stdout.trim(), localCommit);
});

test("managed pull never replays local files across incoming attributes", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-pull-combined-filter-");
  const peer = join(fixture.parent, "peer");
  const isolatedHome = join(fixture.parent, "isolated-home");
  const marker = join(fixture.parent, "combined-filter-ran");
  const previousHome = process.env.HOME;
  await mkdir(isolatedHome);
  process.env.HOME = isolatedHome;
  context.after(() => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  });
  await git(fixture.root, ["config", "--global", "filter.untrusted.smudge", `sh -c "touch '${marker}'; cat"`]);
  await writeFile(join(fixture.root, "local-only.txt"), "local replayed contents\n", "utf8");
  await git(fixture.root, ["add", "local-only.txt"]);
  await git(fixture.root, ["commit", "-m", "Add local-only file"]);
  const localCommit = (await git(fixture.root, ["rev-parse", "HEAD"])).stdout.trim();
  await git(fixture.parent, ["clone", fixture.remote, peer]);
  await configureGit(peer);
  await writeFile(join(peer, ".gitattributes"), "local-only.txt filter=untrusted\n", "utf8");
  await git(peer, ["add", ".gitattributes"]);
  await git(peer, ["commit", "-m", "Add attribute for local-only file"]);
  await git(peer, ["push"]);

  await assert.rejects(pullWorkspace(fixture.root), /fetched incoming commits but did not integrate them/i);
  await assert.rejects(access(marker));
  assert.equal((await git(fixture.root, ["rev-parse", "HEAD"])).stdout.trim(), localCommit);
});

test("managed pull rejects transient sibling changes in incoming nested-workspace commits", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "filegrc-pull-transient-sibling-"));
  const repositoryRoot = join(parent, "repository");
  const root = join(repositoryRoot, "compliance");
  const remote = join(parent, "remote.git");
  const peer = join(parent, "peer");
  context.after(() => rm(parent, { recursive: true, force: true }));
  await makeWorkspace(root);
  await writeFile(join(repositoryRoot, "application.txt"), "stable application\n", "utf8");
  await git(repositoryRoot, ["init", "--initial-branch=main"]);
  await configureGit(repositoryRoot);
  await git(repositoryRoot, ["add", "."]);
  await git(repositoryRoot, ["commit", "-m", "Initialize nested workspace"]);
  await git(parent, ["init", "--bare", "--initial-branch=main", remote]);
  await git(repositoryRoot, ["remote", "add", "origin", remote]);
  await git(repositoryRoot, ["push", "-u", "origin", "main"]);
  const localCommit = (await git(repositoryRoot, ["rev-parse", "HEAD"])).stdout.trim();
  await git(parent, ["clone", remote, peer]);
  await configureGit(peer);
  await writeFile(join(peer, "transient-sibling.txt"), "transient\n", "utf8");
  await git(peer, ["add", "transient-sibling.txt"]);
  await git(peer, ["commit", "-m", "Add transient sibling"]);
  await rm(join(peer, "transient-sibling.txt"));
  await git(peer, ["add", "transient-sibling.txt"]);
  await git(peer, ["commit", "-m", "Remove transient sibling"]);
  await writeFile(join(peer, "compliance", "remote-note.txt"), "incoming workspace change\n", "utf8");
  await git(peer, ["add", "."]);
  await git(peer, ["commit", "-m", "Change nested workspace"]);
  await git(peer, ["push"]);

  await assert.rejects(pullWorkspace(root), /commit.*outside this nested workspace/i);
  assert.equal((await git(repositoryRoot, ["rev-parse", "HEAD"])).stdout.trim(), localCommit);
  await assert.rejects(access(join(repositoryRoot, "transient-sibling.txt")));
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
  assert.equal((await waitForRepository(fixture.root)).status, "synced");
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

test("trunk mode never integrates sibling changes from incoming commits", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "filegrc-trunk-incoming-sibling-"));
  const repositoryRoot = join(parent, "repository");
  const root = join(repositoryRoot, "compliance");
  const remote = join(parent, "remote.git");
  const peer = join(parent, "peer");
  context.after(() => rm(parent, { recursive: true, force: true }));
  await makeWorkspace(root);
  await writeTrunkSettings(root);
  await writeFile(join(repositoryRoot, "application.txt"), "original application\n", "utf8");
  await git(repositoryRoot, ["init", "--initial-branch=main"]);
  await configureGit(repositoryRoot);
  await git(repositoryRoot, ["add", "."]);
  await git(repositoryRoot, ["commit", "-m", "Initialize nested workspace"]);
  await git(parent, ["init", "--bare", "--initial-branch=main", remote]);
  await git(repositoryRoot, ["remote", "add", "origin", remote]);
  await git(repositoryRoot, ["push", "-u", "origin", "main"]);
  const initialState = await createAppState(root);
  const owner = initialState.resources.find(({ record }) => record.id === "person-owner");
  await git(parent, ["clone", remote, peer]);
  await configureGit(peer);
  await writeFile(join(peer, "application.txt"), "incoming sibling change\n", "utf8");
  await git(peer, ["add", "application.txt"]);
  await git(peer, ["commit", "-m", "Change sibling application"]);
  await git(peer, ["push"]);

  await assert.rejects(
    runBrowserMutation(root, { message: "Do not fast-forward sibling files" }, () => updateResource(
      root,
      "person",
      owner.record.id,
      { ...owner.record, department: "Nested workspace" },
      { expectedRevision: owner.revision }
    )),
    /Fast-forward it with Git/
  );
  assert.equal(await readFile(join(repositoryRoot, "application.txt"), "utf8"), "original application\n");
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
  const push = pauseGitCommand(context, ({ args }) => args.includes("push"));
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

test("a remote-success tracking race cannot be retried as an unconfirmed push", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-trunk-tracking-race-");
  const initialState = await createAppState(fixture.root);
  const owner = initialState.resources.find(({ record }) => record.id === "person-owner");
  const tracking = pauseGitCommand(context, ({ args }) => (
    args[0] === "update-ref" && args.includes("refs/remotes/origin/main")
  ));
  const mutation = await runBrowserMutation(fixture.root, {
    message: "Preserve remote push outcome",
    backgroundPushDelayMs: 100
  }, () => updateResource(fixture.root, "person", owner.record.id, {
    ...owner.record,
    department: "Remote accepted"
  }, { expectedRevision: owner.revision }));

  await tracking.started;
  assert.equal((await git(fixture.remote, ["rev-parse", "main"])).stdout.trim(), mutation.synchronization.commit);
  const tree = (await git(fixture.root, ["rev-parse", `${initialState.repository.currentCommit}^{tree}`])).stdout.trim();
  const alternate = (await git(fixture.root, ["commit-tree", tree, "-p", initialState.repository.currentCommit, "-m", "Concurrent tracking state"])).stdout.trim();
  await git(fixture.root, ["update-ref", "refs/remotes/origin/main", alternate]);
  tracking.release();

  const failed = await waitForRepository(fixture.root, "not-synced");
  assert.equal(failed.backgroundSynchronization.remotePushed, true);
  assert.equal(failed.retrySafe, false);
  assert.match(failed.backgroundSyncError, /remote accepted the exact FileGRC commit/i);
  assert.equal((await git(fixture.remote, ["rev-parse", "main"])).stdout.trim(), mutation.synchronization.commit);
});

test("retry sync preserves remote success when tracking reconciliation races", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-retry-tracking-race-");
  const ownerPath = join(fixture.root, "data", "people", "person-owner.json");
  const owner = JSON.parse(await readFile(ownerPath, "utf8"));
  await writeJson(ownerPath, { ...owner, department: "Retry exact commit" });
  await git(fixture.root, ["add", "data/people/person-owner.json"]);
  await git(fixture.root, ["commit", "-m", "Create FileGRC-only pending commit"]);
  const localCommit = (await git(fixture.root, ["rev-parse", "HEAD"])).stdout.trim();
  const upstreamCommit = (await git(fixture.root, ["rev-parse", "origin/main"])).stdout.trim();
  const tracking = pauseGitCommand(context, ({ args }) => (
    args[0] === "update-ref" && args.includes("refs/remotes/origin/main")
  ));
  const retry = retryBrowserSync(fixture.root);

  await tracking.started;
  assert.equal((await git(fixture.remote, ["rev-parse", "main"])).stdout.trim(), localCommit);
  const tree = (await git(fixture.root, ["rev-parse", `${upstreamCommit}^{tree}`])).stdout.trim();
  const alternate = (await git(fixture.root, ["commit-tree", tree, "-p", upstreamCommit, "-m", "Concurrent retry tracking state"])).stdout.trim();
  await git(fixture.root, ["update-ref", "refs/remotes/origin/main", alternate]);
  tracking.release();

  await assert.rejects(retry, /remote-tracking branch needs reconciliation/);
  const state = await getBrowserRepositoryState(fixture.root);
  assert.equal(state.backgroundSynchronization.remotePushed, true);
  assert.equal(state.retrySafe, false);
  assert.equal((await git(fixture.remote, ["rev-parse", "main"])).stdout.trim(), localCommit);
});

test("Git errors redact credentials before reaching browser responses", () => {
  const message = sanitizeGitErrorMessage(
    "rejected https://writer:private-token@example.test/repository?token=query-secret&X-Amz-Signature=aws-secret&X-Goog-Credential=google-secret&client_secret=client-value&api_key=api-value&sig=azure-secret&CoDe=oauth-secret#fragment-secret Authorization: Bearer header-secret"
  );
  assert.match(message, /https:\/\/\[redacted\]@example\.test\/repository\?token=\[redacted\]&X-Amz-Signature=\[redacted\]&X-Goog-Credential=\[redacted\]&client_secret=\[redacted\]&api_key=\[redacted\]&sig=\[redacted\]&CoDe=\[redacted\]#\[redacted\]/);
  assert.match(message, /Authorization: \[redacted\]/);
  assert.doesNotMatch(message, /private-token|query-secret|aws-secret|google-secret|client-value|api-value|azure-secret|oauth-secret|fragment-secret|header-secret/);
  assert.equal(sanitizeGitErrorMessage("x".repeat(9_000)).length, 8_001);
});

test("trunk transactions preserve invalid FileGRC writes without creating Git objects or commits", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-trunk-rollback-");
  const ownerPath = join(fixture.root, "data", "people", "person-owner.json");
  const beforeCommit = (await git(fixture.root, ["rev-parse", "HEAD"])).stdout.trim();
  const invalidSource = `{"leakedSecret":"rejected-${Date.now()}"}\n`;
  await assert.rejects(runBrowserMutation(fixture.root, {
    message: "Write invalid owner"
  }, async () => {
    await writeFile(ownerPath, invalidSource, "utf8");
    return { changed: true };
  }), /preserved every current file/);
  assert.equal(await readFile(ownerPath, "utf8"), invalidSource);
  assert.equal((await git(fixture.root, ["rev-parse", "HEAD"])).stdout.trim(), beforeCommit);
  assert.match((await git(fixture.root, ["status", "--porcelain"])).stdout, /person-owner\.json/);
  const rejectedObject = (await git(fixture.root, ["hash-object", "--no-filters", ownerPath])).stdout.trim();
  await assert.rejects(git(fixture.root, ["cat-file", "-e", rejectedObject]));
});

test("a missing Git identity rejects a browser edit before storing its blob", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-trunk-missing-identity-object-");
  const initialState = await createAppState(fixture.root);
  const owner = initialState.resources.find(({ record }) => record.id === "person-owner");
  const ownerPath = join(fixture.root, "data", "people", "person-owner.json");
  await git(fixture.root, ["config", "user.name", ""]);
  await git(fixture.root, ["config", "user.email", ""]);

  await assert.rejects(
    runBrowserMutation(fixture.root, { message: "Reject missing identity" }, () => updateResource(
      fixture.root,
      "person",
      owner.record.id,
      { ...owner.record, department: `Rejected identity ${Date.now()}` },
      { expectedRevision: owner.revision }
    )),
    /Configure valid git user\.name and git user\.email/
  );
  const rejectedObject = (await git(fixture.root, ["hash-object", "--no-filters", ownerPath])).stdout.trim();
  await assert.rejects(git(fixture.root, ["cat-file", "-e", rejectedObject]));
});

test("trunk rollback preserves tracked and untracked files changed during validation", async (context) => {
  const fixture = await makeTrunkGitFixture(context, "filegrc-trunk-concurrent-rollback-");
  const initialState = await createAppState(fixture.root);
  const owner = initialState.resources.find(({ record }) => record.id === "person-owner");
  const workspacePath = join(fixture.root, "data", "workspace.json");
  const workspace = JSON.parse(await readFile(workspacePath, "utf8"));
  const concurrentPath = join(fixture.root, "concurrent-note.txt");
  let concurrentDone;
  const concurrentWrite = new Promise((resolve, reject) => { concurrentDone = { resolve, reject }; });

  const mutation = runBrowserMutation(fixture.root, { message: "Preserve concurrent validation edits" }, async () => {
    const result = await updateResource(fixture.root, "person", owner.record.id, {
      ...owner.record,
      department: "Browser mutation"
    }, { expectedRevision: owner.revision });
    setImmediate(async () => {
      try {
        await writeJson(workspacePath, { ...workspace, title: "Concurrent workspace edit" });
        await writeFile(concurrentPath, "concurrent untracked edit\n", "utf8");
        concurrentDone.resolve();
      } catch (error) {
        concurrentDone.reject(error);
      }
    });
    return result;
  });

  await assert.rejects(mutation, /preserved every current file/i);
  await concurrentWrite;
  assert.equal(JSON.parse(await readFile(workspacePath, "utf8")).title, "Concurrent workspace edit");
  assert.equal(await readFile(concurrentPath, "utf8"), "concurrent untracked edit\n");
  assert.equal(JSON.parse(await readFile(join(fixture.root, "data", "people", "person-owner.json"), "utf8")).department, "Browser mutation");
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
  assert.match((await secondResponse.json()).error, /Fast-forward it with Git/i);
  assert.equal(
    JSON.parse(await readFile(join(peer, "data", "people", "person-owner.json"), "utf8")).department,
    undefined
  );
  assert.match(
    (await git(fixture.remote, ["show", "main:data/people/person-owner.json"])).stdout,
    /First server edit/
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

test("invalid final onboarding state preserves the failed edit and creates no commit", async (context) => {
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
  assert.notEqual(await readFile(workspacePath, "utf8"), originalWorkspace);
  await access(join(fixture.root, "data", "systems", "system-invalid-final-state.json"));
  assert.match((await git(fixture.root, ["status", "--porcelain=v1"])).stdout, /data\/workspace\.json/);
  assert.match((await git(fixture.root, ["status", "--porcelain=v1"])).stdout, /\?\? data\/systems\//);
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
