import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { makeWorkspace } from "./helpers.js";

const cliPath = fileURLToPath(new URL("../bin/filegrc.js", import.meta.url));
const childProcessTimeout = 60_000;

test("serve ends startup output with the GitHub star message", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-serve-output-"));
  context.after(() =>
    import("node:fs/promises").then(({ rm }) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
  await makeWorkspace(root);

  const { stdout, stderr, exit } = await runServerUntil(
    [cliPath, "serve", root, "--port", "0"],
    (output) => output.includes("https://github.com/Alignbase/filegrc"),
  );
  assertSuccessfulStop(exit, stderr);
  assert.equal(
    stdout.slice(stdout.lastIndexOf("\n\x1b[38;2;255;184;0m")),
    "\n\x1b[38;2;255;184;0m⭐️  → ❤️  https://github.com/Alignbase/filegrc\x1b[0m\n\n",
  );
});

test("serve chooses another port when the preferred port is occupied", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-serve-port-fallback-"));
  context.after(() =>
    import("node:fs/promises").then(({ rm }) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
  await makeWorkspace(root);

  const blocker = createServer();
  await new Promise((resolve, reject) => {
    blocker.once("error", reject);
    blocker.listen(0, "127.0.0.1", resolve);
  });
  context.after(() => new Promise((resolve) => blocker.close(resolve)));
  const occupiedPort = blocker.address().port;

  const { stdout, stderr, exit } = await runServerUntil(
    [cliPath, "serve", root, "--port", String(occupiedPort)],
    (output) => output.includes("filegrc workspace:"),
  );
  assertSuccessfulStop(exit, stderr);
  assert.match(
    stdout,
    new RegExp(
      `Port ${occupiedPort} is already in use\\. Using \\d+ instead\\.`,
    ),
  );
  const fallbackPort = Number(stdout.match(/Using (\d+) instead\./)?.[1]);
  assert.ok(Number.isInteger(fallbackPort));
  assert.notEqual(fallbackPort, occupiedPort);
  assert.match(
    stdout,
    new RegExp(`filegrc workspace: http://127\\.0\\.0\\.1:${fallbackPort}`),
  );
});

function runServerUntil(args, ready) {
  const child = spawn(process.execPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let stopping = false;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    if (!stopping && ready(stdout)) {
      stopping = true;
      child.kill("SIGTERM");
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const exit = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(`Timed out waiting for server startup output.\n${stderr}`),
      );
    }, childProcessTimeout);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
  return exit.then((result) => ({ stdout, stderr, exit: result }));
}

function assertSuccessfulStop(exit, stderr) {
  assert.ok(
    exit.code === 0 ||
      (process.platform === "win32" && exit.signal === "SIGTERM"),
    stderr || `Server exited with code ${exit.code} and signal ${exit.signal}.`,
  );
}
