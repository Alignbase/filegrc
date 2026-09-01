import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const testRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(testRoot, "..", "..", "..");
const schedulerUrl = pathToFileURL(
  join(repositoryRoot, "scripts", "test-scheduler.mjs"),
).href;
const fixturesUrl = pathToFileURL(join(testRoot, "fixtures.js")).href;

test("refuses a symlinked result directory without deleting its target", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-scheduler-security-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const temporaryRoot = join(root, "tmp");
  const outsideRoot = join(root, "outside");
  const userNamespace =
    typeof process.getuid === "function"
      ? String(process.getuid())
      : process.env.USER;
  const cacheRoot = join(
    temporaryRoot,
    `filegrc-test-${userNamespace}`,
    "scheduler-v3",
  );
  const protectedFile = join(outsideRoot, "keep.json");
  const testFile = join(root, "sample.test.js");
  await mkdir(cacheRoot, { recursive: true, mode: 0o700 });
  await mkdir(outsideRoot);
  await writeFile(protectedFile, "keep\n");
  await writeFile(
    testFile,
    "import test from 'node:test'; test('sample', () => {});\n",
  );
  await symlink(outsideRoot, join(cacheRoot, "results"), "dir");

  const script = `
    import { runTestSuite } from ${JSON.stringify(schedulerUrl)};
    await runTestSuite({
      name: "scheduler security test",
      cwd: ${JSON.stringify(root)},
      files: [${JSON.stringify(testFile)}],
      inputPaths: [${JSON.stringify(testFile)}]
    });
  `;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", script],
    {
      encoding: "utf8",
      env: { ...process.env, TMPDIR: temporaryRoot },
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /Refusing unsafe FileGRC test directory/,
  );
  await access(protectedFile);
});

test("invalidates cached results when an input changes", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-scheduler-cache-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const temporaryRoot = join(root, "tmp");
  const inputFile = join(root, "input.js");
  const markerFile = join(root, "runs.txt");
  const testFile = join(root, "cache.test.js");
  await mkdir(temporaryRoot);
  await writeFile(inputFile, "export const value = 1;\n");
  await writeFile(
    testFile,
    `
    import { appendFile } from "node:fs/promises";
    import test from "node:test";
    test("cache run", async () => appendFile(${JSON.stringify(markerFile)}, "run\\n"));
  `,
  );
  const options = {
    root,
    temporaryRoot,
    files: [testFile],
    inputPaths: [testFile, inputFile],
  };

  const first = runSchedulerSync({
    ...options,
    name: "cache invalidation test",
  });
  assert.equal(first.status, 0, first.stderr);
  const second = runSchedulerSync({
    ...options,
    name: "cache invalidation test",
  });
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /reused 1 passing test files/);
  assert.equal(await readFile(markerFile, "utf8"), "run\n");

  const configured = runSchedulerSync({
    ...options,
    name: "cache invalidation test",
    environment: { FILEGRC_TEST_CONCURRENCY: "1" },
  });
  assert.equal(configured.status, 0, configured.stderr);
  assert.doesNotMatch(configured.stdout, /reused 1 passing test files/);
  assert.equal(await readFile(markerFile, "utf8"), "run\nrun\n");

  await writeFile(inputFile, "export const value = 2;\n");
  const third = runSchedulerSync({
    ...options,
    name: "cache invalidation test",
  });
  assert.equal(third.status, 0, third.stderr);
  assert.doesNotMatch(third.stdout, /reused 1 passing test files/);
  assert.equal(await readFile(markerFile, "utf8"), "run\nrun\nrun\n");
});

test("waiting suites receive a permit before a running suite reacquires one", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-scheduler-fairness-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const temporaryRoot = join(root, "tmp");
  const markerFile = join(root, "order.txt");
  const gateFile = join(root, "release-a1");
  await mkdir(temporaryRoot);
  const firstFile = join(root, "a-first.test.js");
  const secondFile = join(root, "a-second.test.js");
  const waitingFile = join(root, "b-waiting.test.js");
  await writeFile(firstFile, gatedMarkerTest(markerFile, gateFile));
  await writeFile(secondFile, markerTest(markerFile, "A2"));
  await writeFile(waitingFile, markerTest(markerFile, "B"));

  const firstSuite = runScheduler({
    root,
    temporaryRoot,
    name: "fairness suite A",
    files: [firstFile, secondFile],
    inputPaths: [firstFile, secondFile],
    cache: false,
  });
  await waitForText(markerFile, "A1\n");
  const waitingSuite = runScheduler({
    root,
    temporaryRoot,
    name: "fairness suite B",
    files: [waitingFile],
    inputPaths: [waitingFile],
    cache: false,
  });
  try {
    await waitForSuiteTicket(temporaryRoot, "fairness suite B");
  } finally {
    await writeFile(gateFile, "release\n");
  }
  const [firstResult, waitingResult] = await Promise.all([
    firstSuite,
    waitingSuite,
  ]);

  assert.equal(firstResult.code, 0, firstResult.stderr);
  assert.equal(waitingResult.code, 0, waitingResult.stderr);
  assert.equal(await readFile(markerFile, "utf8"), "A1\nB\nA2\n");
});

test("rejects an invalid timeout before a test file starts", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-scheduler-timeout-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const temporaryRoot = join(root, "tmp");
  const markerFile = join(root, "started.txt");
  const testFile = join(root, "timeout.test.js");
  await mkdir(temporaryRoot);
  await writeFile(testFile, markerTest(markerFile, "started"));

  const result = runSchedulerSync({
    root,
    temporaryRoot,
    name: "invalid timeout test",
    files: [testFile],
    inputPaths: [testFile],
    cache: false,
    environment: { FILEGRC_TEST_FILE_TIMEOUT_MS: "invalid" },
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /FILEGRC_TEST_FILE_TIMEOUT_MS must be a positive number/,
  );
  await assert.rejects(access(markerFile), { code: "ENOENT" });
});

test("kills a timed-out test file's execFile child process", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-scheduler-orphan-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const temporaryRoot = join(root, "tmp");
  const pidFile = join(root, "child.pid");
  const testFile = join(root, "orphan.test.js");
  await mkdir(temporaryRoot);
  await writeFile(
    testFile,
    `
    import { execFile } from "node:child_process";
    import test from "node:test";
    test("hang", async () => {
      execFile(process.execPath, ["--eval", ${JSON.stringify(`require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`)}]);
      await new Promise(() => {});
    });
  `,
  );

  const result = runSchedulerSync({
    root,
    temporaryRoot,
    name: "orphan cleanup test",
    files: [testFile],
    inputPaths: [testFile],
    cache: false,
    environment: { FILEGRC_TEST_FILE_TIMEOUT_MS: "500" },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exceeded the 1 second test-file timeout/);
  const childPid = Number(await readFile(pidFile, "utf8"));
  await waitForProcessExit(childPid);
});

test("kills a synchronous child when its test file times out", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-scheduler-sync-child-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const temporaryRoot = join(root, "tmp");
  const pidFile = join(root, "child.pid");
  const testFile = join(root, "sync-child.test.js");
  await mkdir(temporaryRoot);
  await writeFile(
    testFile,
    `
    import { spawnSync } from "node:child_process";
    import test from "node:test";
    test("hang", () => {
      spawnSync(process.execPath, ["--eval", ${JSON.stringify(`require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`)}], { stdio: "ignore" });
    });
  `,
  );

  const result = runSchedulerSync({
    root,
    temporaryRoot,
    name: "synchronous child cleanup test",
    files: [testFile],
    inputPaths: [testFile],
    cache: false,
    environment: { FILEGRC_TEST_FILE_TIMEOUT_MS: "500" },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exceeded the 1 second test-file timeout/);
  const childPid = Number(await readFile(pidFile, "utf8"));
  await waitForProcessExit(childPid);
});

test(
  "kills a detached child's surviving process-group descendants after success",
  { skip: process.platform === "win32" },
  async (context) => {
    const root = await mkdtemp(join(tmpdir(), "filegrc-scheduler-descendant-"));
    context.after(() => rm(root, { recursive: true, force: true }));
    const temporaryRoot = join(root, "tmp");
    const pidFile = join(root, "grandchild.pid");
    const testFile = join(root, "descendant.test.js");
    const probeFile = join(root, "descendant-probe.test.js");
    await mkdir(temporaryRoot);
    const parentScript = `
      const { spawn } = require("node:child_process");
      const { writeFileSync } = require("node:fs");
      const child = spawn(process.execPath, ["--eval", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
      writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));
      child.unref();
    `;
    await writeFile(
      testFile,
      `
      import { spawn } from "node:child_process";
      import test from "node:test";
      // ${"x".repeat(4_000)}
      test("spawn descendant", async () => {
        const parent = spawn(process.execPath, ["--eval", ${JSON.stringify(parentScript)}], {
          detached: process.platform !== "win32",
          stdio: "ignore"
        });
        await new Promise((resolve, reject) => {
          parent.once("error", reject);
          parent.once("exit", (code) => code === 0 ? resolve() : reject(new Error("parent failed")));
        });
      });
    `,
    );
    await writeFile(
      probeFile,
      `
      import assert from "node:assert/strict";
      import { readFileSync } from "node:fs";
      import test from "node:test";
      test("the prior file's descendant is gone", () => {
        const pid = Number(readFileSync(${JSON.stringify(pidFile)}, "utf8"));
        assert.throws(
          () => process.kill(pid, 0),
          (error) => error?.code === "ESRCH"
        );
      });
    `,
    );

    const result = runSchedulerSync({
      root,
      temporaryRoot,
      name: "descendant cleanup test",
      files: [testFile, probeFile],
      inputPaths: [testFile, probeFile],
      cache: false,
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const grandchildPid = Number(await readFile(pidFile, "utf8"));
    await waitForProcessExit(grandchildPid);
  },
);

test(
  "reaps an ordinary child before reusing a supervisor",
  { skip: process.platform === "win32" },
  async (context) => {
    const root = await mkdtemp(join(tmpdir(), "filegrc-scheduler-reuse-"));
    context.after(() => rm(root, { recursive: true, force: true }));
    const temporaryRoot = join(root, "tmp");
    const pidFile = join(root, "child.pid");
    const firstFile = join(root, "first.test.js");
    const probeFile = join(root, "probe.test.js");
    await mkdir(temporaryRoot);
    await writeFile(
      firstFile,
      `
      import { spawn } from "node:child_process";
      import { access } from "node:fs/promises";
      import test from "node:test";
      // ${"x".repeat(4_000)}
      test("leave a child", async () => {
        const child = spawn(process.execPath, ["--eval", ${JSON.stringify(`require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`)}], { stdio: "ignore" });
        child.unref();
        while (!(await access(${JSON.stringify(pidFile)}).then(() => true, () => false))) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      });
    `,
    );
    await writeFile(
      probeFile,
      `
      import assert from "node:assert/strict";
      import { readFileSync } from "node:fs";
      import test from "node:test";
      test("the prior child is gone", () => {
        const pid = Number(readFileSync(${JSON.stringify(pidFile)}, "utf8"));
        assert.throws(() => process.kill(pid, 0), (error) => error?.code === "ESRCH");
      });
    `,
    );

    const result = runSchedulerSync({
      root,
      temporaryRoot,
      name: "ordinary child reuse cleanup test",
      files: [firstFile, probeFile],
      inputPaths: [firstFile, probeFile],
      cache: false,
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  },
);

test(
  "a supervisor kills its test tree when the scheduler disappears",
  { skip: process.platform === "win32" },
  async (context) => {
    const root = await mkdtemp(
      join(tmpdir(), "filegrc-scheduler-parent-loss-"),
    );
    context.after(() => rm(root, { recursive: true, force: true }));
    const temporaryRoot = join(root, "tmp");
    const pidFile = join(root, "processes.json");
    const testFile = join(root, "parent-loss.test.js");
    await mkdir(temporaryRoot);
    await writeFile(
      testFile,
      `
      import { spawn } from "node:child_process";
      import { writeFileSync } from "node:fs";
      import test from "node:test";
      test("hang", async () => {
        const child = spawn(process.execPath, ["--eval", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
        writeFileSync(${JSON.stringify(pidFile)}, JSON.stringify({ supervisor: process.pid, child: child.pid }));
        await new Promise(() => {});
      });
    `,
    );
    const running = runSchedulerProcess({
      root,
      temporaryRoot,
      name: "scheduler parent loss test",
      files: [testFile],
      inputPaths: [testFile],
      cache: false,
    });
    await waitForText(pidFile, "supervisor");
    const pids = JSON.parse(await readFile(pidFile, "utf8"));
    context.after(() => {
      for (const pid of Object.values(pids)) {
        try {
          process.kill(pid, "SIGKILL");
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
      }
    });

    running.child.kill("SIGKILL");
    await running.result;
    await Promise.all([
      waitForProcessExit(pids.supervisor),
      waitForProcessExit(pids.child),
    ]);
  },
);

test("direct fixture use removes its fallback fixture root on exit", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-fixture-cleanup-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const temporaryRoot = join(root, "tmp");
  const target = join(root, "workspace");
  await mkdir(temporaryRoot);
  const script = `
    import { readdir } from "node:fs/promises";
    import { join } from "node:path";
    import { makeComprehensiveWorkspace } from ${JSON.stringify(fixturesUrl)};
    await makeComprehensiveWorkspace(${JSON.stringify(target)});
    const name = (await readdir(${JSON.stringify(temporaryRoot)})).find((entry) => entry.startsWith("filegrc-test-fixtures-"));
    console.log(join(${JSON.stringify(temporaryRoot)}, name));
  `;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", script],
    {
      encoding: "utf8",
      env: { ...process.env, FILEGRC_TEST_RUN_ROOT: "", TMPDIR: temporaryRoot },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const fallbackRoot = result.stdout.trim().split("\n").at(-1);
  await assert.rejects(access(fallbackRoot), { code: "ENOENT" });
});

function markerTest(markerFile, label, delayMs = 0, padding = "") {
  return `
    import { appendFile } from "node:fs/promises";
    import test from "node:test";
    ${padding ? `// ${padding}` : ""}
    test(${JSON.stringify(label)}, async () => {
      await appendFile(${JSON.stringify(markerFile)}, ${JSON.stringify(`${label}\n`)});
      await new Promise((resolve) => setTimeout(resolve, ${delayMs}));
    });
  `;
}

function gatedMarkerTest(markerFile, gateFile) {
  return `
    import { access, appendFile } from "node:fs/promises";
    import test from "node:test";
    // ${"x".repeat(2_000)}
    test("A1", async () => {
      await appendFile(${JSON.stringify(markerFile)}, "A1\\n");
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        if (await access(${JSON.stringify(gateFile)}).then(() => true, () => false)) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error("Timed out waiting for the fairness test gate.");
    });
  `;
}

function schedulerScript({ root, name, files, inputPaths, cache = true }) {
  return `
    import { runTestSuite } from ${JSON.stringify(schedulerUrl)};
    await runTestSuite({
      name: ${JSON.stringify(name)},
      cwd: ${JSON.stringify(root)},
      files: ${JSON.stringify(files)},
      inputPaths: ${JSON.stringify(inputPaths)},
      cache: ${cache}
    });
  `;
}

function schedulerEnvironment(temporaryRoot, overrides = {}) {
  return {
    ...process.env,
    CI: "",
    FILEGRC_GLOBAL_TEST_CONCURRENCY: "1",
    FILEGRC_TEST_CONCURRENCY: "4",
    TMPDIR: temporaryRoot,
    ...overrides,
  };
}

function runSchedulerSync(options) {
  return spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", schedulerScript(options)],
    {
      encoding: "utf8",
      env: schedulerEnvironment(options.temporaryRoot, options.environment),
    },
  );
}

function runScheduler(options) {
  return runSchedulerProcess(options).result;
}

function runSchedulerProcess(options) {
  const child = spawn(
    process.execPath,
    ["--input-type=module", "--eval", schedulerScript(options)],
    {
      env: schedulerEnvironment(options.temporaryRoot, options.environment),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk) => {
    stderr += chunk;
  });
  const result = new Promise((resolveChild, rejectChild) => {
    child.once("error", rejectChild);
    child.once("exit", (code) => resolveChild({ code, stdout, stderr }));
  });
  return { child, result };
}

async function waitForText(path, expected) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const value = await readFile(path, "utf8").catch(() => "");
    if (value.includes(expected)) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }
  throw new Error(`Timed out waiting for ${expected.trim()}.`);
}

async function waitForSuiteTicket(temporaryRoot, suite) {
  const userNamespace =
    typeof process.getuid === "function"
      ? String(process.getuid())
      : process.env.USER;
  const queuePath = join(
    temporaryRoot,
    `filegrc-test-${userNamespace}`,
    "machine-pool-v3",
    "queue",
  );
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const entries = await readdir(queuePath).catch(() => []);
    for (const entry of entries) {
      const owner = await readFile(
        join(queuePath, entry, "owner.json"),
        "utf8",
      ).then(JSON.parse, () => null);
      if (owner?.suite === suite) return;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }
  throw new Error(`Timed out waiting for ${suite} to enter the permit queue.`);
}

async function waitForProcessExit(pid) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") return;
      throw error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
  }
  throw new Error(`Timed out waiting for child process ${pid} to exit.`);
}
