import { createHash, randomUUID } from "node:crypto";
import { execFile, fork } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  lstat,
  mkdtemp,
  readFile,
  readlink,
  realpath,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import {
  basename,
  delimiter,
  dirname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const scriptsRoot = dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
const repositoryRoot = dirname(scriptsRoot);
const workerPath = join(scriptsRoot, "test-shard-worker.mjs");
const schedulerVersion = "3";
const userNamespace =
  typeof process.getuid === "function"
    ? String(process.getuid())
    : safeName(process.env.USER || "current-user");
const coordinationRoot = join(tmpdir(), `filegrc-test-${userNamespace}`);
const cacheRoot = join(coordinationRoot, `scheduler-v${schedulerVersion}`);
const machinePoolRoot = join(coordinationRoot, "machine-pool-v3");
const queueRoot = join(machinePoolRoot, "queue");
const resultsRoot = join(cacheRoot, "results");
const timingsRoot = join(cacheRoot, "timings");
const locksRoot = join(cacheRoot, "locks");

export async function discoverTestFiles(testRoot) {
  const entries = await readdir(testRoot, { withFileTypes: true });
  const paths = await Promise.all(
    entries.map(async (entry) => {
      const path = join(testRoot, entry.name);
      if (entry.isDirectory()) return discoverTestFiles(path);
      return entry.isFile() && entry.name.endsWith(".test.js") ? [path] : [];
    }),
  );
  return paths.flat().sort();
}

export async function runTestSuite({
  name,
  cwd,
  files,
  inputPaths,
  toolchainCommands = [],
  cache = !process.env.CI &&
    process.env.FILEGRC_TEST_CACHE !== "0" &&
    !process.argv.includes("--no-cache"),
}) {
  if (!files.length) throw new Error(`${name} did not select any test files.`);
  const requestedConcurrency = Number(
    process.env.FILEGRC_TEST_CONCURRENCY ||
      Math.min(4, Math.max(1, availableParallelism() - 1)),
  );
  if (!Number.isInteger(requestedConcurrency) || requestedConcurrency < 1) {
    throw new Error("FILEGRC_TEST_CONCURRENCY must be a positive integer.");
  }
  const globalConcurrency = Number(
    process.env.FILEGRC_GLOBAL_TEST_CONCURRENCY || 4,
  );
  if (!Number.isInteger(globalConcurrency) || globalConcurrency < 1) {
    throw new Error(
      "FILEGRC_GLOBAL_TEST_CONCURRENCY must be a positive integer.",
    );
  }
  const fileTimeoutMs = Number(
    process.env.FILEGRC_TEST_FILE_TIMEOUT_MS || 15 * 60 * 1_000,
  );
  if (!Number.isFinite(fileTimeoutMs) || fileTimeoutMs < 1) {
    throw new Error("FILEGRC_TEST_FILE_TIMEOUT_MS must be a positive number.");
  }

  await ensurePrivateCoordinationRoot();
  for (const path of [
    cacheRoot,
    resultsRoot,
    timingsRoot,
    locksRoot,
    machinePoolRoot,
    queueRoot,
  ]) {
    await ensurePrivateDirectory(path);
  }
  await pruneResults();
  const key = await contentKey({ name, files, inputPaths, toolchainCommands });
  const resultPath = join(resultsRoot, `${key}.json`);
  if (cache) {
    const cached = await readJson(resultPath);
    if (validCachedResult(cached, { name, key, files })) {
      printCacheHit(name, key, cached);
      return;
    }
  }

  const claim = await claimRun({ key, resultPath, cache, name, files });
  if (claim.cached) {
    printCacheHit(name, key, claim.cached);
    return;
  }

  const runRoot = await mkdtemp(join(cacheRoot, "run-"));
  const startedAt = performance.now();
  let outcome;
  try {
    process.chdir(cwd);
    const estimates = await priorTimings(name);
    const orderedFiles = await orderFiles(files, estimates);
    const workerCount = Math.min(
      requestedConcurrency,
      globalConcurrency,
      files.length,
    );
    const results = [];
    let nextFile = 0;
    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        let supervisor;
        try {
          while (nextFile < orderedFiles.length) {
            const file = orderedFiles[nextFile];
            nextFile += 1;
            const permit = await acquireMachinePermit(
              globalConcurrency,
              name,
              file,
            );
            try {
              supervisor ??= createTestSupervisor({ runRoot });
              const result = await runSupervisorFile({
                supervisor,
                name,
                cwd,
                file,
                timeoutMs: fileTimeoutMs,
              });
              const hadResidualChildren =
                await cleanupSupervisorChildGroups(supervisor);
              results.push(result);
              if (
                result.code !== 0 ||
                !supervisor.alive() ||
                process.platform === "win32" ||
                hadResidualChildren
              ) {
                await closeTestSupervisor(supervisor);
                supervisor = null;
              }
            } finally {
              await permit.release();
            }
            if (supervisor && (await anotherProcessIsWaiting())) {
              await closeTestSupervisor(supervisor);
              supervisor = null;
            }
          }
        } finally {
          if (supervisor) await closeTestSupervisor(supervisor);
        }
      }),
    );
    const timings = results.flatMap((result) => result.timings);
    const failed = results.some((result) => result.code !== 0);
    outcome = {
      ok: !failed,
      name,
      key,
      files: files.length,
      durationMs: Math.round(performance.now() - startedAt),
      timings,
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      completedAt: new Date().toISOString(),
    };
    await saveTimings(name, timings);
    if (!failed && cache) {
      const finalKey = await contentKey({
        name,
        files,
        inputPaths,
        toolchainCommands,
      });
      if (finalKey === key) await writeJsonAtomic(resultPath, outcome);
      else
        console.warn(
          `FileGRC test inputs changed during ${name}; the passing result was not cached.`,
        );
    }
    printSummary(outcome, workerCount, globalConcurrency);
    if (failed) process.exitCode = 1;
  } finally {
    await rm(runRoot, { recursive: true, force: true });
    await claim.release();
  }
}

function createTestSupervisor({ runRoot }) {
  const child = fork(workerPath, [], {
    detached: process.platform !== "win32",
    env: { ...process.env, FILEGRC_TEST_RUN_ROOT: runRoot },
    execArgv: [],
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  child.stdout.pipe(process.stdout, { end: false });
  child.stderr.pipe(process.stderr, { end: false });
  let running = true;
  child.once("exit", () => {
    running = false;
  });
  return { child, processGroups: new Set(), alive: () => running };
}

async function runSupervisorFile({ supervisor, name, cwd, file, timeoutMs }) {
  const { child } = supervisor;
  const token = randomUUID();
  let timer;
  try {
    return await new Promise((resolveResult, rejectResult) => {
      const onMessage = (message) => {
        if (
          message?.type === "filegrc-child-process" &&
          message.token === token &&
          Number.isInteger(message.pid) &&
          message.pid > 1
        ) {
          supervisor.processGroups.add(message.pid);
          return;
        }
        if (
          message?.type === "filegrc-test-result" &&
          message.token === token &&
          message.file === file &&
          [0, 1].includes(message.code) &&
          Array.isArray(message.timings)
        ) {
          cleanup();
          resolveResult(message);
        }
      };
      const onExit = (code) => {
        cleanup();
        rejectResult(
          new Error(`${basename(file)} supervisor exited with code ${code}.`),
        );
      };
      const cleanup = () => {
        child.off("message", onMessage);
        child.off("exit", onExit);
      };
      timer = setTimeout(() => {
        cleanup();
        rejectResult(
          new Error(
            `${basename(file)} exceeded the ${Math.round(timeoutMs / 1_000)} second test-file timeout.`,
          ),
        );
        void terminateSupervisorProcess(supervisor);
      }, timeoutMs);
      timer.unref?.();
      child.on("message", onMessage);
      child.once("exit", onExit);
      child.send(
        { type: "run", token, name, cwd, file, timeoutMs },
        (error) => {
          if (!error) return;
          cleanup();
          rejectResult(error);
        },
      );
    });
  } catch (error) {
    console.error(`✖ ${basename(file)} worker failed: ${error.message}`);
    return {
      code: 1,
      timings: [
        {
          file: relative(repositoryRoot, file).split(sep).join("/"),
          durationMs: null,
          ok: false,
        },
      ],
    };
  } finally {
    clearTimeout(timer);
  }
}

async function closeTestSupervisor(supervisor) {
  const { child } = supervisor;
  await cleanupSupervisorChildGroups(supervisor);
  if (!supervisor.alive()) return;
  const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
  await terminateSupervisorProcess(supervisor);
  await Promise.race([exited.then(() => true), delay(1_000).then(() => false)]);
}

async function terminateSupervisorProcess(supervisor) {
  const { child } = supervisor;
  if (!child?.pid) {
    await cleanupSupervisorChildGroups(supervisor);
    return;
  }
  if (process.platform === "win32") {
    await execFileAsync(
      "taskkill.exe",
      ["/PID", String(child.pid), "/T", "/F"],
      { windowsHide: true },
    ).catch((error) => {
      if (![128, 255].includes(error.code)) throw error;
    });
    return;
  }
  const targets = await descendantProcessTargets(child.pid);
  for (const groupId of supervisor.processGroups) targets.add(-groupId);
  supervisor.processGroups.clear();
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    for (const target of targets) {
      try {
        process.kill(target, signal);
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
    if (signal === "SIGTERM") await delay(100);
  }
  await waitForProcessTargets(targets);
}

async function cleanupSupervisorChildGroups(supervisor) {
  const trackedGroups = [...supervisor.processGroups];
  supervisor.processGroups.clear();
  if (process.platform === "win32") {
    await acknowledgeSupervisorCleanup(supervisor, trackedGroups);
    return false;
  }
  const processes = await processTable();
  const targets = new Set(
    processes
      .filter(
        ({ pid, groupId }) =>
          pid !== supervisor.child.pid && groupId === supervisor.child.pid,
      )
      .map(({ pid }) => pid),
  );
  for (const groupId of trackedGroups) {
    try {
      process.kill(-groupId, 0);
      targets.add(-groupId);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  if (!targets.size) {
    await acknowledgeSupervisorCleanup(supervisor, trackedGroups);
    return false;
  }
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    for (const target of targets) {
      try {
        process.kill(target, signal);
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
    if (signal === "SIGTERM") await delay(100);
  }
  await acknowledgeSupervisorCleanup(supervisor, trackedGroups);
  return true;
}

async function acknowledgeSupervisorCleanup(supervisor, groupIds) {
  if (!groupIds.length || !supervisor.alive()) return;
  const token = randomUUID();
  await new Promise((resolveAck, rejectAck) => {
    const onMessage = (message) => {
      if (
        message?.type !== "filegrc-child-process-cleanup-acknowledged" ||
        message.token !== token
      )
        return;
      cleanup();
      resolveAck();
    };
    const onExit = (code) => {
      cleanup();
      rejectAck(
        new Error(`Test supervisor exited with code ${code} during cleanup.`),
      );
    };
    const cleanup = () => {
      child.off("message", onMessage);
      child.off("exit", onExit);
    };
    const { child } = supervisor;
    child.on("message", onMessage);
    child.once("exit", onExit);
    child.send(
      { type: "child-process-cleanup-complete", token, groupIds },
      (error) => {
        if (!error) return;
        cleanup();
        rejectAck(error);
      },
    );
  });
}

async function waitForProcessTargets(targets) {
  const deadline = Date.now() + 2_000;
  while (targets.size && Date.now() < deadline) {
    for (const target of targets) {
      try {
        process.kill(target, 0);
      } catch (error) {
        if (error.code === "ESRCH") targets.delete(target);
        else throw error;
      }
    }
    if (targets.size) await delay(25);
  }
  if (targets.size) {
    throw new Error("A test-file child process did not exit after cleanup.");
  }
}

async function descendantProcessTargets(rootPid) {
  const processes = await processTable();
  const ownGroup = processes.find(({ pid }) => pid === process.pid)?.groupId;
  const descendants = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of processes) {
      if (descendants.has(entry.parentPid) && !descendants.has(entry.pid)) {
        descendants.add(entry.pid);
        changed = true;
      }
    }
  }
  const groups = new Set(
    processes
      .filter(
        ({ pid, groupId }) => descendants.has(pid) && groupId !== ownGroup,
      )
      .map(({ groupId }) => -groupId),
  );
  for (const pid of descendants) groups.add(pid);
  return groups;
}

async function processTable() {
  const { stdout } = await execFileAsync("ps", ["-axo", "pid=,ppid=,pgid="]);
  return stdout
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter((parts) => parts.length === 3 && parts.every(Number.isInteger))
    .map(([pid, parentPid, groupId]) => ({ pid, parentPid, groupId }));
}

async function anotherProcessIsWaiting() {
  const tickets = await activeTickets();
  return tickets.some(({ pid }) => pid !== process.pid);
}

async function orderFiles(files, estimates) {
  const weighted = await Promise.all(
    files.map(async (file) => ({
      file,
      weight:
        estimates.get(relative(repositoryRoot, file).split(sep).join("/")) ??
        Math.max(1, Math.round((await stat(file)).size / 1_000)),
    })),
  );
  weighted.sort(
    (left, right) =>
      right.weight - left.weight || left.file.localeCompare(right.file),
  );
  return weighted.map(({ file }) => file);
}

async function acquireMachinePermit(limit, suite, file) {
  const token = randomUUID();
  const ticketPath = join(queueRoot, `ticket-${process.pid}-${token}`);
  await mkdir(ticketPath);
  await writeFile(
    join(ticketPath, "owner.json"),
    JSON.stringify({ pid: process.pid, token, suite, startedAt: Date.now() }),
  );
  try {
    while (true) {
      const tickets = await activeTickets();
      const position = tickets.findIndex((ticket) => ticket.token === token);
      if (position >= 0 && position < limit) {
        for (let index = 0; index < limit; index += 1) {
          const permit = await tryAcquirePermitSlot(
            join(machinePoolRoot, `slot-${index}`),
            suite,
            file,
          );
          if (permit) return permit;
        }
      }
      await delay(50 + Math.floor(Math.random() * 50));
    }
  } finally {
    const owner = await readJson(join(ticketPath, "owner.json"));
    if (owner?.token === token)
      await rm(ticketPath, { recursive: true, force: true });
  }
}

async function activeTickets() {
  const entries = await readdir(queueRoot, { withFileTypes: true });
  const tickets = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("ticket-")) continue;
    const ticketPath = join(queueRoot, entry.name);
    const owner = await readJson(join(ticketPath, "owner.json"));
    if (!owner) {
      const details = await stat(ticketPath).catch(() => null);
      if (details && Date.now() - details.mtimeMs > 30_000) {
        await rm(ticketPath, { recursive: true, force: true });
      }
      continue;
    }
    if (
      Date.now() - owner.startedAt > 6 * 60 * 60 * 1_000 ||
      !processExists(owner.pid)
    ) {
      await rm(ticketPath, { recursive: true, force: true });
      continue;
    }
    tickets.push(owner);
  }
  return tickets.sort(
    (left, right) =>
      left.startedAt - right.startedAt || left.token.localeCompare(right.token),
  );
}

async function tryAcquirePermitSlot(slotRoot, suite, file) {
  let permitPath = slotRoot;
  while (true) {
    try {
      await mkdir(permitPath);
      const token = randomUUID();
      await writeFile(
        join(permitPath, "owner.json"),
        JSON.stringify({
          pid: process.pid,
          token,
          suite,
          file: basename(file),
          startedAt: Date.now(),
        }),
      );
      return {
        release: async () => {
          const owner = await readJson(join(permitPath, "owner.json"));
          if (owner?.token === token)
            await rm(permitPath, { recursive: true, force: true });
        },
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const generation = await staleGeneration(permitPath);
    if (!generation) return null;
    permitPath = `${slotRoot}.after-${generation}`;
  }
}

async function contentKey({ name, files, inputPaths, toolchainCommands }) {
  const hash = createHash("sha256");
  hash.update(
    JSON.stringify({
      schedulerVersion,
      name,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      env: cacheEnvironment(),
      toolchain: await toolchainIdentity(toolchainCommands),
      timeBucket: new Date().toISOString().slice(0, 13),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      files: files.map((file) =>
        relative(repositoryRoot, file).split(sep).join("/"),
      ),
    }),
  );
  const paths = [
    ...new Set(
      [...inputPaths, workerPath, fileURLToPath(import.meta.url)].map((path) =>
        resolve(path),
      ),
    ),
  ].sort();
  for (const path of paths) await hashPath(hash, path);
  return hash.digest("hex");
}

function cacheEnvironment() {
  const ignored = new Set(["FILEGRC_TEST_CACHE", "FILEGRC_TEST_RUN_ROOT"]);
  return Object.fromEntries(
    Object.entries(process.env)
      .filter(
        ([key]) =>
          /^(?:FILEGRC_|GIT_|SSH_|TZ$|LANG$|LC_|HOME$|PATH$|NODE_|NPM_|npm_config_|HTTP_PROXY$|HTTPS_PROXY$|NO_PROXY$|SSL_CERT_)/i.test(
            key,
          ) && !ignored.has(key),
      )
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

async function toolchainIdentity(commands) {
  const identities = {};
  for (const command of [...new Set(commands)].sort()) {
    const executable = await resolveExecutable(command);
    const { stdout, stderr } = await execFileAsync(executable, ["--version"], {
      encoding: "utf8",
      timeout: 10_000,
    });
    const details = await stat(executable);
    identities[command] = {
      executable,
      size: details.size,
      mtimeMs: details.mtimeMs,
      version: `${stdout}${stderr}`.trim(),
    };
  }
  return identities;
}

async function resolveExecutable(command) {
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";")
      : [""];
  for (const directory of (process.env.PATH || "").split(delimiter)) {
    for (const extension of extensions) {
      const candidate = join(directory || ".", `${command}${extension}`);
      try {
        await access(candidate, constants.X_OK);
        return realpath(candidate);
      } catch (error) {
        if (!["ENOENT", "EACCES", "ENOTDIR"].includes(error.code)) throw error;
      }
    }
  }
  throw new Error(`Unable to resolve required test tool: ${command}`);
}

async function hashPath(hash, path) {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") {
      hash.update(`missing:${path}\0`);
      return;
    }
    throw error;
  }
  const label = relative(repositoryRoot, path).split(sep).join("/");
  if (metadata.isSymbolicLink()) {
    hash.update(`symlink:${label}\0`);
    hash.update(await readlink(path));
    return;
  }
  if (metadata.isDirectory()) {
    hash.update(`dir:${label}\0`);
    const entries = (await readdir(path, { withFileTypes: true }))
      .filter(
        (entry) =>
          !["node_modules", ".git", ".filegrc", "dist"].includes(entry.name),
      )
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) await hashPath(hash, join(path, entry.name));
    return;
  }
  hash.update(`file:${label}\0`);
  hash.update(await readFile(path));
}

async function claimRun({ key, resultPath, cache, name, files }) {
  if (!cache) return { cached: null, release: async () => {} };
  let lockPath = join(locksRoot, key);
  const waitStartedAt = Date.now();
  while (true) {
    const cached = await readJson(resultPath);
    if (validCachedResult(cached, { name, key, files }))
      return { cached, release: async () => {} };
    try {
      await mkdir(lockPath);
      const token = randomUUID();
      await writeFile(
        join(lockPath, "owner.json"),
        JSON.stringify({
          pid: process.pid,
          token,
          startedAt: Date.now(),
        }),
      );
      return {
        cached: null,
        release: async () => {
          const owner = await readJson(join(lockPath, "owner.json"));
          if (owner?.token === token)
            await rm(lockPath, { recursive: true, force: true });
        },
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const generation = await staleGeneration(lockPath);
    if (generation) {
      lockPath = join(locksRoot, `${key}.after-${generation}`);
      continue;
    }
    if (Date.now() - waitStartedAt > 30 * 60 * 1_000) {
      throw new Error(
        "Timed out waiting for an identical FileGRC test run to finish.",
      );
    }
    await delay(200);
  }
}

async function staleGeneration(path) {
  const owner = await readJson(join(path, "owner.json"));
  if (owner) {
    if (
      Date.now() - owner.startedAt <= 6 * 60 * 60 * 1_000 &&
      processExists(owner.pid)
    )
      return null;
    return safeName(owner.token || `${owner.pid}-${owner.startedAt}`);
  }
  const details = await stat(path).catch(() => null);
  if (!details || Date.now() - details.mtimeMs <= 30_000) return null;
  return `partial-${details.ino}-${Math.round(details.mtimeMs)}`;
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

async function priorTimings(name) {
  const data = await readJson(join(timingsRoot, `${safeName(name)}.json`));
  return new Map(Object.entries(data?.files ?? {}));
}

async function pruneResults() {
  let entries;
  try {
    entries = await readdir(resultsRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1_000;
  await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const path = join(resultsRoot, entry.name);
        const details = await stat(path).catch((error) =>
          error.code === "ENOENT" ? null : Promise.reject(error),
        );
        if (!details) return;
        if (details.mtimeMs < cutoff) await rm(path, { force: true });
      }),
  );
}

async function saveTimings(name, timings) {
  const path = join(timingsRoot, `${safeName(name)}.json`);
  const prior = await readJson(path);
  const files = { ...(prior?.files ?? {}) };
  for (const timing of timings) {
    if (Number.isFinite(timing.durationMs))
      files[timing.file] = timing.durationMs;
  }
  await writeJsonAtomic(path, { updatedAt: new Date().toISOString(), files });
}

function printCacheHit(name, key, result) {
  console.log(
    `✔ ${name}: reused ${result.files} passing test files (${key.slice(0, 12)}, ${formatDuration(result.durationMs)} original run)`,
  );
}

function printSummary(outcome, workers, globalConcurrency) {
  const slowest = [...outcome.timings]
    .filter(({ durationMs }) => Number.isFinite(durationMs))
    .sort((left, right) => right.durationMs - left.durationMs)
    .slice(0, 5)
    .map(
      ({ file, durationMs }) =>
        `${basename(file)} ${formatDuration(durationMs)}`,
    )
    .join(", ");
  console.log(
    `\n${outcome.ok ? "✔" : "✖"} ${outcome.name}: ${outcome.files} files in ${formatDuration(outcome.durationMs)} using ${workers} local workers (machine limit ${globalConcurrency})`,
  );
  if (slowest) console.log(`Slowest files: ${slowest}`);
}

function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds)) return "unknown";
  return milliseconds < 1_000
    ? `${Math.round(milliseconds)}ms`
    : `${(milliseconds / 1_000).toFixed(1)}s`;
}

function safeName(name) {
  return name.replace(/[^a-z0-9.-]+/gi, "-").toLowerCase();
}

function validCachedResult(result, { name, key, files } = {}) {
  return (
    result?.ok === true &&
    result.key === key &&
    (name === undefined || result.name === name) &&
    (files === undefined || result.files === files.length) &&
    result.node === process.version &&
    result.platform === `${process.platform}-${process.arch}`
  );
}

async function ensurePrivateCoordinationRoot() {
  try {
    await mkdir(coordinationRoot, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const details = await lstat(coordinationRoot);
  const expectedUid =
    typeof process.getuid === "function" ? process.getuid() : null;
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error(
      `Refusing unsafe FileGRC test coordination path: ${coordinationRoot}`,
    );
  }
  if (expectedUid !== null && details.uid !== expectedUid) {
    throw new Error(
      `FileGRC test coordination path is not owned by the current user: ${coordinationRoot}`,
    );
  }
  if (expectedUid !== null && (details.mode & 0o077) !== 0) {
    throw new Error(
      `FileGRC test coordination path must not be accessible by other users: ${coordinationRoot}`,
    );
  }
}

async function ensurePrivateDirectory(path) {
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const details = await lstat(path);
  const expectedUid =
    typeof process.getuid === "function" ? process.getuid() : null;
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error(`Refusing unsafe FileGRC test directory: ${path}`);
  }
  if (expectedUid !== null && details.uid !== expectedUid) {
    throw new Error(
      `FileGRC test directory is not owned by the current user: ${path}`,
    );
  }
  if (expectedUid !== null && (details.mode & 0o077) !== 0)
    await chmod(path, 0o700);
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (
      ["ENOENT", "ENOTDIR", "EISDIR"].includes(error.code) ||
      error instanceof SyntaxError
    )
      return null;
    throw error;
  }
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
