import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fork, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { test } from "node:test";
import { cleanupOwnedProcesses, ownedProcessIds, processOwnerVariable } from "./test-process-cleanup.mjs";

const owner = randomUUID();
test("cleanup skips absent, reused and invalid groups without probing or signalling them", async () => {
  const groups = new Map([[0, owner], [-3, owner], [1, owner], [200, owner], [300, owner]]);
  const reads = [];
  assert.equal(await cleanupOwnedProcesses(groups, {
    table: async () => [{ pid: 300, groupId: 300 }],
    owns: async (pid) => { reads.push(pid); return false; },
    kill: () => assert.fail("unowned process signalled"),
  }), false);
  assert.deepEqual(reads, [300, 300, 300]);
});

test("cleanup rechecks ownership before KILL and preserves genuine permission failures", async () => {
  let owned = true;
  const signals = [];
  await assert.rejects(cleanupOwnedProcesses(new Map([[200, owner]]), {
    table: async () => [{ pid: 201, groupId: 200, started: owned ? "old" : "new" }],
    owns: async () => owned,
    kill: (pid, signal) => { signals.push([pid, signal]); owned = false; },
    delay: async () => {},
  }), /changed identity/);
  assert.deepEqual(signals, [[201, "SIGTERM"]]);
  await assert.rejects(cleanupOwnedProcesses(new Map([[200, owner]]), {
    table: async () => [{ pid: 201, groupId: 200 }], owns: async () => true,
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

async function schedulerFixture(t, body, timeoutMs = 5_000, nested = false) {
  const directory = await mkdtemp(join(tmpdir(), "filegrc-scheduler-cleanup-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const pidPath = join(directory, "survivor.pid");
  const testPath = join(directory, "fixture.test.mjs");
  const survivorCode = `require('node:fs').writeFileSync(${JSON.stringify(pidPath)},String(process.pid));setInterval(()=>{},1000)`;
  const childCode = nested ? `const c=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(survivorCode)}],{detached:true,stdio:'ignore'});c.unref();` : survivorCode;
  await writeFile(testPath, `import {test} from 'node:test';import {spawn} from 'node:child_process';import {existsSync} from 'node:fs';
    test('fixture', async()=>{const c=spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{detached:true,stdio:'ignore',env:{PATH:process.env.PATH}});c.unref();while(!existsSync(${JSON.stringify(pidPath)}))await new Promise(r=>setTimeout(r,10));${body}});`);
  const schedulerUrl = new URL("./test-scheduler.mjs", import.meta.url).href;
  const source = `import {runTestSuite} from ${JSON.stringify(schedulerUrl)};await runTestSuite({name:'cleanup-regression',cwd:${JSON.stringify(directory)},files:[${JSON.stringify(testPath)}],inputPaths:[${JSON.stringify(testPath)}],cache:false});`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", source], { env: { ...process.env, FILEGRC_TEST_CONCURRENCY: "1", FILEGRC_TEST_FILE_TIMEOUT_MS: String(timeoutMs) }, stdio: ["ignore", "pipe", "pipe"] });
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
  const result = await schedulerFixture(t, "await new Promise(()=>{});", 1_000);
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /test-file timeout/);
});

test("worker disconnect cleans nested detached grandchildren across groups", { skip: process.platform === "win32" }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "filegrc-disconnect-cleanup-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const pidPath = join(directory, "child.pid");
  const testPath = join(directory, "fixture.test.mjs");
  await writeFile(testPath, `import {test} from 'node:test';import {spawn} from 'node:child_process';import {existsSync} from 'node:fs';test('fixture',async()=>{const c=spawn(process.execPath,['-e',${JSON.stringify(`const c=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(`require('node:fs').writeFileSync(${JSON.stringify(pidPath)},String(process.pid));setInterval(()=>{},1000)`)}],{detached:true,stdio:'ignore'});c.unref();`)}],{detached:true,stdio:'ignore'});c.unref();while(!existsSync(${JSON.stringify(pidPath)}))await new Promise(r=>setTimeout(r,10));});`);
  const child = fork(new URL("./test-shard-worker.mjs", import.meta.url), [], { detached: true, env: { ...process.env, [processOwnerVariable]: randomUUID() }, stdio: ["ignore", "ignore", "ignore", "ipc"] });
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
  const timedOut = await schedulerFixture(t, "await new Promise(()=>{});", 1_000, true);
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
