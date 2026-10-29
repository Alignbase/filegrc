import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fork, spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { test } from "node:test";
import { cleanupOwnedProcesses, discoverLinuxOwners, hasOwner, ownedProcessIds, processOwnerVariable } from "./test-process-cleanup.mjs";

const owner = randomUUID();
test("cleanup skips absent, reused and invalid groups without probing or signalling them", async () => {
  const groups = new Map([[0, owner], [-3, owner], [1, owner], [200, owner], [300, owner]]);
  const reads = [];
  assert.equal(await cleanupOwnedProcesses(groups, {
    table: async () => [{ pid: 300, groupId: 300 }],
    owns: async (pid) => { reads.push(pid); return false; },
    kill: () => assert.fail("unowned process signalled"),
  }), false);
  assert.deepEqual(reads, []);
});

test("cleanup rechecks ownership before KILL and preserves genuine permission failures", async () => {
  let owned = true;
  const signals = [];
  await assert.rejects(cleanupOwnedProcesses(new Map([[200, owner]]), {
    table: async () => [{ pid: 201, groupId: 200, started: owned ? "old" : "new" }],
    discover: async () => new Map([[201, owner]]),
    owns: async () => owned,
    kill: (pid, signal) => { signals.push([pid, signal]); owned = false; },
    delay: async () => {},
  }), /changed identity/);
  assert.deepEqual(signals, [[201, "SIGTERM"]]);
  await assert.rejects(cleanupOwnedProcesses(new Map([[200, owner]]), {
    table: async () => [{ pid: 201, groupId: 200 }], owns: async () => true,
    discover: async () => new Map([[201, owner]]),
    kill: () => { throw Object.assign(new Error("denied"), { code: "EPERM" }); },
  }), { code: "EPERM" });
});

test("surviving detached descendants are cleaned after their leader exits", { skip: process.platform === "win32" }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "filegrc-cleanup-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const pidPath = join(directory, "child.pid");
  const childCode = `require('node:fs').writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));setInterval(()=>{},1000)`;
  const leader = spawn(process.execPath, ["-e", `const c=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'ignore'});c.unref();`], {
    detached: true, stdio: "ignore", env: { ...process.env, [processOwnerVariable]: owner },
  });
  await once(leader, "exit");
  let pid;
  for (let count = 0; count < 100 && !pid; count++) {
    pid = await readFile(pidPath, "utf8").then(Number).catch(() => null);
    if (!pid) await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(pid);
  const groups = new Map([[leader.pid, owner]]);
  t.after(() => cleanupOwnedProcesses(groups));
  assert.ok((await ownedProcessIds(groups)).has(pid));
  assert.equal(await cleanupOwnedProcesses(groups), true);
  assert.equal((await ownedProcessIds(groups)).size, 0);
});

function standaloneEnvironment(overrides = {}) {
  const environment = { ...process.env, ...overrides };
  // These fixtures start the standalone CLI/worker, outside this node:test run.
  delete environment.NODE_TEST_CONTEXT;
  return environment;
}

async function schedulerFixture(t, body, timeoutMs = 5_000, nested = false, customEnv = false) {
  const directory = await mkdtemp(join(tmpdir(), "filegrc-scheduler-cleanup-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const pidPath = join(directory, "survivor.pid");
  const testPath = join(directory, "fixture.test.mjs");
  const survivorCode = `require('node:fs').writeFileSync(${JSON.stringify(pidPath)},String(process.pid));setInterval(()=>{},1000)`;
  const childCode = nested ? `const c=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(survivorCode)}],{detached:true,stdio:'ignore'});c.unref();` : survivorCode;
  await writeFile(testPath, `import {test} from 'node:test';import {spawn} from 'node:child_process';import {existsSync} from 'node:fs';
    test('fixture', async()=>{const c=spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{detached:true,stdio:'ignore',env:${customEnv ? '{PATH:process.env.PATH}' : 'process.env'}});c.unref();while(!existsSync(${JSON.stringify(pidPath)}))await new Promise(r=>setTimeout(r,10));${body}});`);
  const schedulerUrl = new URL("./test-scheduler.mjs", import.meta.url).href;
  const source = `import {runTestSuite} from ${JSON.stringify(schedulerUrl)};await runTestSuite({name:'cleanup-regression',cwd:${JSON.stringify(directory)},files:[${JSON.stringify(testPath)}],inputPaths:[${JSON.stringify(testPath)}],cache:false});`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", source], { env: standaloneEnvironment({ FILEGRC_TEST_CONCURRENCY: "1", FILEGRC_TEST_FILE_TIMEOUT_MS: String(timeoutMs) }), stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => output += chunk);
  child.stderr.on("data", (chunk) => output += chunk);
  const [code] = await once(child, "exit");
  const pid = Number(await readFile(pidPath, "utf8"));
  const { processTable } = await import("./test-process-cleanup.mjs");
  assert.equal((await processTable()).some((entry) => entry.pid === pid), false, output);
  return { code, output };
}

test("scheduler cleans detached children while retaining passing and failing test results", { skip: process.platform === "win32" }, async (t) => {
  const passing = await schedulerFixture(t, "");
  assert.equal(passing.code, 0, passing.output);
  const failing = await schedulerFixture(t, "throw new Error('real fixture failure');");
  assert.equal(failing.code, 1, failing.output);
  assert.match(failing.output, /✖ fixture/);
});

test("scheduler timeout cleans live detached children and remains a failure", { skip: process.platform === "win32" }, async (t) => {
  const result = await schedulerFixture(t, "setInterval(()=>{},1000);await new Promise(()=>{});", 1_000);
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /test-file timeout/);
});

test("worker disconnect cleans nested detached grandchildren across groups", { skip: process.platform === "win32" }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "filegrc-disconnect-cleanup-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const pidPath = join(directory, "child.pid");
  const testPath = join(directory, "fixture.test.mjs");
  await writeFile(testPath, `import {test} from 'node:test';import {spawn} from 'node:child_process';import {existsSync} from 'node:fs';test('fixture',async()=>{const c=spawn(process.execPath,['-e',${JSON.stringify(`const c=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(`require('node:fs').writeFileSync(${JSON.stringify(pidPath)},String(process.pid));setInterval(()=>{},1000)`)}],{detached:true,stdio:'ignore'});c.unref();`)}],{detached:true,stdio:'ignore'});c.unref();while(!existsSync(${JSON.stringify(pidPath)}))await new Promise(r=>setTimeout(r,10));});`);
  const child = fork(new URL("./test-shard-worker.mjs", import.meta.url), [], { detached: true, env: standaloneEnvironment({ [processOwnerVariable]: randomUUID() }), stdio: ["ignore", "ignore", "ignore", "ipc"] });
  t.after(() => { try { child.kill("SIGKILL"); } catch {} });
  const result = new Promise((resolve) => child.on("message", (message) => { if (message.type === "filegrc-test-result") resolve(message); }));
  child.send({ type: "run", token: randomUUID(), file: testPath, cwd: directory });
  assert.equal((await result).code, 0);
  const exited = once(child, "exit");
  child.disconnect();
  await exited;
  const pid = Number(await readFile(pidPath, "utf8"));
  const { processTable } = await import("./test-process-cleanup.mjs");
  assert.equal((await processTable()).some((entry) => entry.pid === pid), false);
});


test("scheduler cleans nested detached grandchildren after success and timeout", { skip: process.platform === "win32" }, async (t) => {
  const passing = await schedulerFixture(t, "", 5_000, true);
  assert.equal(passing.code, 0, passing.output);
  const timedOut = await schedulerFixture(t, "setInterval(()=>{},1000);await new Promise(()=>{});", 1_000, true);
  assert.equal(timedOut.code, 1, timedOut.output);
  assert.match(timedOut.output, /test-file timeout/);
});


test("cleanup retains an unmarked TERM-resistant child after its marked leader exits", { skip: process.platform === "win32" }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "filegrc-unmarked-cleanup-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const detached of [false, true]) {
  const pidPath = join(directory, `child-${detached}.pid`);
  const childCode = `process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(pidPath)},String(process.pid));setInterval(()=>{},1000)`;
  const leader = spawn(process.execPath, ["-e", `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{detached:${detached},stdio:'ignore',env:{PATH:process.env.PATH}});setInterval(()=>{},1000);`], { detached: true, stdio: "ignore", env: { ...process.env, [processOwnerVariable]: owner } });
  const groups = new Map([[leader.pid, owner]]);
  t.after(() => cleanupOwnedProcesses(groups));
  let pid;
  for (let count = 0; count < 100 && !pid; count++) {
    pid = await readFile(pidPath, "utf8").then(Number).catch(() => null);
    if (!pid) await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(pid);
  assert.ok((await ownedProcessIds(groups)).has(pid));
  assert.equal(await cleanupOwnedProcesses(groups), true);
  const { processTable } = await import("./test-process-cleanup.mjs");
  assert.equal((await processTable()).some((entry) => entry.pid === pid), false);
  }
});


test("Linux ownership discovery uses exact NUL-delimited proc environments", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "filegrc-proc-owners-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const anotherOwner = randomUUID();
  for (const [pid, environment] of [["200", `PATH=/bin\0${processOwnerVariable}=${owner}\0`], ["201", `OTHER=${processOwnerVariable}=${owner}\0`], ["202", `${processOwnerVariable}=${anotherOwner}\0`], ["203", `${processOwnerVariable}=${owner}-suffix\0`], ["1", `${processOwnerVariable}=${owner}\0`]]) {
    await mkdir(join(directory, pid));
    await writeFile(join(directory, pid, "environ"), environment);
  }
  await mkdir(join(directory, "204")); // Process disappeared before its env read.
  assert.deepEqual(await discoverLinuxOwners(new Set([owner]), directory), new Map([[200, owner]]));
});


test("unknown inaccessible members of a reused group are never probed as owned", async () => {
  assert.equal(await cleanupOwnedProcesses(new Map([[300, owner]]), {
    table: async () => [{ pid: 300, groupId: 300, uid: 0, started: "unrelated" }],
    discover: async () => new Map(),
    owns: async () => { throw Object.assign(new Error("must not inspect unknown environment"), { code: "EACCES" }); },
    kill: () => assert.fail("unrelated process signalled"),
  }), false);
});


test("shared-isolation worker injects ownership into an explicit detached child environment", {
  skip: process.platform === "win32" || Number(process.versions.node.split(".")[0]) < 22,
}, async (t) => {
  // Node 20 uses a separate test process and cannot run the worker's wrappers.
  const result = await schedulerFixture(t, "", 5_000, false, true);
  assert.equal(result.code, 0, result.output);
});


test("Linux selected process dying before its environment read is not a permission failure", async () => {
  let live = [{ pid: 300, groupId: 300, uid: 1000, started: "original" }];
  let permissionReads = 0;
  const owns = (pid, owner) => hasOwner(pid, owner, {
    platform: "linux",
    readEnvironment: async () => {
      permissionReads++;
      live = []; // The selected process exits or becomes an excluded zombie.
      throw Object.assign(new Error("private environment must never appear"), { code: "EACCES" });
    },
    liveProcesses: async () => live,
  });
  assert.equal(await cleanupOwnedProcesses(new Map([[300, owner]]), {
    table: async () => live,
    discover: async () => new Map([[300, owner]]), owns,
    kill: () => assert.fail("an exited process must not be signalled"),
  }), false);
  assert.ok(permissionReads > 0, "the process must die between selection and its environment read");
});

test("Linux selected live process permission failures remain fatal and sanitized", async () => {
  for (const code of ["EACCES", "EPERM"]) {
    await assert.rejects(hasOwner(300, owner, {
      platform: "linux",
      readEnvironment: async () => { throw Object.assign(new Error("private environment must never appear"), { code }); },
      liveProcesses: async () => [{ pid: 300, groupId: 300, uid: 1000, started: "original" }],
    }), (error) => error.cause?.code === code && !String(error).includes("private environment") && !JSON.stringify(error).includes("private environment"));
  }
});
