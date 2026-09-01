import assert from "node:assert/strict";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assessWorkflow, getGitSummary } from "../src/index.js";
import {
  getFileBufferAtRevision,
  isGitAncestor,
  runGitCommand,
  setGitSubprocessObserverForTests,
  withGitCommandAdapterForTests,
} from "../src/git.js";
import { makeWorkspace } from "./helpers.js";

test("domain Git summaries can use an injected repository adapter", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-git-adapter-"));
  context.after(() =>
    import("node:fs/promises").then(({ rm }) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
  await makeWorkspace(root);
  const commit = "a".repeat(40);
  const calls = [];
  const output = (args) => {
    calls.push(args.join(" "));
    const command = args.join(" ");
    if (command === "rev-parse --show-toplevel") return root;
    if (command === "ls-files -z --cached --others --exclude-standard -- .")
      return "";
    if (command === "status --porcelain=v1 -- .") return "";
    if (command === "rev-parse HEAD") return commit;
    if (command === "symbolic-ref --short HEAD") return "main";
    if (command.includes("@{upstream}")) return "";
    if (command === "remote") return "";
    if (command.startsWith("log -1"))
      return `${commit}\u001f2026-08-31T12:00:00Z\u001fTest User\u001fCreate workspace`;
    throw new Error(`Unexpected Git command: ${command}`);
  };

  const summary = await withGitCommandAdapterForTests(
    {
      run: ({ args }) => output(args),
      runSync: ({ args }) => output(args),
    },
    () => getGitSummary(root),
  );

  assert.equal(summary.available, true, JSON.stringify(calls));
  assert.equal(summary.commit, commit);
  assert.equal(summary.branch, "main");
  assert.equal(summary.clean, true);
  assert.equal(summary.lastCommit.subject, "Create workspace");
  assert.ok(calls.length >= 6);
});

test("workflow domain tests can model unavailable history without Git subprocesses", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-workflow-git-adapter-"));
  context.after(() =>
    import("node:fs/promises").then(({ rm }) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
  await makeWorkspace(root);
  let calls = 0;
  const unavailable = () => {
    calls += 1;
    const error = new Error(
      "Git is intentionally unavailable in this domain test.",
    );
    error.code = "ENOENT";
    throw error;
  };

  const workflow = await withGitCommandAdapterForTests(
    {
      run: unavailable,
      runSync: unavailable,
    },
    () =>
      assessWorkflow(root, {
        asOf: "2026-08-31",
        evaluatedAt: "2026-08-31T12:00:00Z",
      }),
  );

  assert.ok(calls > 0);
  assert.equal(workflow.assessments.periodHealth.status, "not-started");
  assert.equal(
    workflow.findings.some(({ key }) => key === "program.scope.program-goal"),
    true,
  );
});

test("Git adapters preserve checkout mutation guards", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-git-adapter-guard-"));
  context.after(() =>
    import("node:fs/promises").then(({ rm }) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
  await makeWorkspace(root);
  const commit = "a".repeat(40);
  let mutationCalls = 0;
  const adapter = {
    run: () => {
      mutationCalls += 1;
      return "";
    },
    runSync: ({ args }) => {
      const command = args.join(" ");
      if (command === "symbolic-ref --quiet HEAD") return "refs/heads/main";
      if (command === "rev-parse HEAD") return commit;
      throw new Error(`Unexpected guard command: ${command}`);
    },
  };

  assert.throws(
    () =>
      withGitCommandAdapterForTests(adapter, () =>
        runGitCommand(root, ["commit"], {
          expectedCheckout: {
            expectedRef: "refs/heads/main",
            expectedCommit: "b".repeat(40),
          },
        }),
      ),
    /checked-out Git branch or commit changed/,
  );
  assert.equal(mutationCalls, 0);

  await withGitCommandAdapterForTests(adapter, () =>
    runGitCommand(root, ["commit"], {
      expectedCheckout: {
        expectedRef: "refs/heads/main",
        expectedCommit: commit,
      },
    }),
  );
  assert.equal(mutationCalls, 1);
});

test("Git adapters cover raw and historical commands without subprocesses", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-git-adapter-history-"));
  context.after(() =>
    import("node:fs/promises").then(({ rm }) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
  await makeWorkspace(root);
  const workspaceRoot = await realpath(root);
  const commit = "a".repeat(40);
  let subprocesses = 0;
  const restoreObserver = setGitSubprocessObserverForTests(() => {
    subprocesses += 1;
  });
  context.after(restoreObserver);
  const calls = [];
  const adapter = {
    run: () => "",
    runSync: ({ args }) => {
      const command = args.join(" ");
      calls.push(command);
      if (command === `merge-base --is-ancestor ${commit} ${commit}`) return "";
      if (command === "rev-parse --show-toplevel") return workspaceRoot;
      if (command === `show ${commit}:data/example.json`)
        return Buffer.from("historical bytes");
      throw new Error(`Unexpected adapted Git command: ${command}`);
    },
  };

  const result = withGitCommandAdapterForTests(adapter, () => ({
    ancestor: isGitAncestor(root, commit, commit),
    content: getFileBufferAtRevision(root, commit, "data/example.json"),
  }));

  assert.equal(result.ancestor, true);
  assert.equal(
    result.content?.toString("utf8"),
    "historical bytes",
    JSON.stringify(calls),
  );
  assert.equal(subprocesses, 0);
});
