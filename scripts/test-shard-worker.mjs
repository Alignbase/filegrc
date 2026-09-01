import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { resolve, relative, sep } from "node:path";
import { run } from "node:test";
import { spec } from "node:test/reporters";
import {
  isMainThread,
  parentPort,
  Worker,
  workerData,
} from "node:worker_threads";

if (isMainThread) {
  let activeWorker = null;
  const detachedGroups = new Set();

  process.once("disconnect", () => {
    if (process.platform === "win32") {
      const cleanup = childProcess.spawn(
        "taskkill.exe",
        ["/PID", String(process.pid), "/T", "/F"],
        { detached: true, stdio: "ignore", windowsHide: true },
      );
      cleanup.unref();
      return;
    }
    for (const groupId of detachedGroups) {
      try {
        process.kill(-groupId, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
    process.kill(-process.pid, "SIGKILL");
  });

  process.on("message", async (message) => {
    if (message?.type === "child-process-cleanup-complete") {
      for (const groupId of message.groupIds || []) {
        detachedGroups.delete(groupId);
      }
      sendResult({
        type: "filegrc-child-process-cleanup-acknowledged",
        token: message.token,
      });
      return;
    }
    if (message?.type === "shutdown") {
      if (activeWorker) await activeWorker.terminate();
      process.exit(0);
    }
    if (message?.type !== "run") return;
    if (activeWorker) {
      sendResult({
        type: "filegrc-test-result",
        token: message.token,
        file: message.file,
        code: 1,
        timings: [],
      });
      return;
    }

    const worker = new Worker(new URL(import.meta.url), {
      env: process.env,
      execArgv: [],
      stderr: true,
      stdout: true,
      workerData: message,
    });
    activeWorker = worker;
    worker.stdout.pipe(process.stdout, { end: false });
    worker.stderr.pipe(process.stderr, { end: false });
    let settled = false;
    const finish = async (result) => {
      if (settled) return;
      settled = true;
      await worker.terminate();
      if (activeWorker === worker) activeWorker = null;
      sendResult({ ...result, token: message.token });
    };
    worker.on("message", (result) => {
      if (result?.type === "filegrc-child-process") {
        detachedGroups.add(result.pid);
        sendResult(result);
        return;
      }
      void finish(result);
    });
    worker.once(
      "error",
      (error) => void finish(failedResult(message, error.message)),
    );
    worker.once("exit", (code) => {
      if (!settled) {
        void finish(failedResult(message, `worker exited with code ${code}`));
      }
    });
  });
} else {
  trackSpawnedProcesses(workerData.token);
  const result = await runFiles([workerData.file], workerData.cwd);
  parentPort.postMessage({
    type: "filegrc-test-result",
    file: workerData.file,
    code: result.failed ? 1 : 0,
    timings: result.timings,
  });
}

function trackSpawnedProcesses(token) {
  for (const method of ["spawn", "fork"]) {
    const original = childProcess[method];
    childProcess[method] = function trackedChildProcess(...args) {
      const child = original.apply(this, args);
      const options = args.at(-1);
      if (
        Number.isInteger(child.pid) &&
        options &&
        typeof options === "object" &&
        options.detached === true
      ) {
        parentPort.postMessage({
          type: "filegrc-child-process",
          token,
          pid: child.pid,
        });
      }
      return child;
    };
  }
  syncBuiltinESMExports();
}

function sendResult(result) {
  if (process.connected) process.send(result);
}

function failedResult(options, detail) {
  process.stderr.write(`✖ ${options.file} ${detail}\n`);
  return {
    type: "filegrc-test-result",
    file: options.file,
    code: 1,
    timings: [],
  };
}

function runFiles(files, cwd) {
  return new Promise((resolveRun, rejectRun) => {
    const startedAt = performance.now();
    const repositoryRoot = resolve(cwd, "../..");
    const byFile = new Map(
      files.map((file) => [file, { durationMs: 0, ok: true }]),
    );
    const stream = run({ files, concurrency: 1, isolation: "none" });
    let failed = false;
    let settled = false;
    const record = (data, ok) => {
      if (!ok) failed = true;
      const eventFile = data.details?.file || data.file;
      if (!eventFile) return;
      const absolute = eventFile.startsWith("file:")
        ? new URL(eventFile).pathname
        : eventFile;
      const entry = byFile.get(absolute);
      if (!entry) return;
      entry.ok &&= ok;
      entry.durationMs += Number(
        data.details?.duration_ms || data.details?.duration || 0,
      );
    };
    stream.on("test:pass", (data) => record(data, true));
    stream.on("test:fail", (data) => record(data, false));
    stream.once("error", (error) => {
      if (settled) return;
      settled = true;
      rejectRun(error);
    });
    stream.compose(spec()).pipe(process.stdout, { end: false });
    const finish = () => {
      if (settled) return;
      settled = true;
      const wallMs = Math.round(performance.now() - startedAt);
      resolveRun({
        failed,
        timings: files.map((file) => ({
          file: relative(repositoryRoot, file).split(sep).join("/"),
          durationMs:
            files.length === 1
              ? wallMs
              : Math.round(
                  byFile.get(file).durationMs +
                    Math.max(0, wallMs / files.length),
                ),
          ok: byFile.get(file).ok,
        })),
      });
    };
    stream.once("test:summary", finish);
    stream.once("end", finish);
  });
}
