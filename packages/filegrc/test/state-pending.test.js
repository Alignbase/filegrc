import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { serveWorkspace } from "../src/server.js";
import { runGitCommand, runGitCommandSync, setGitCommandInterceptorForTests, setGitSubprocessObserverForTests, withGitCommandDeadline } from "../src/git.js";
import { initializeGitWorkspace, makeWorkspace } from "./helpers.js";

const asyncHeaders = { prefer: "respond-async" };

async function fixture(context, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "filegrc-state-pending-"));
  await makeWorkspace(root);
  await initializeGitWorkspace(root);
  const running = await serveWorkspace(root, {
    port: 0,
    stateResponseWaitMs: 0,
    ...options
  });
  context.after(async () => {
    await new Promise((resolve) => running.server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const response = await fetch(`${running.url}/api/state/bootstrap`);
  assert.equal(response.status, 200);
  const bootstrap = await response.json();
  return { root, url: running.url, token: bootstrap.stateToken };
}

function sectionPath(section, token) {
  return `/api/state/${section}?token=${encodeURIComponent(token)}`;
}

function resourcePath(token, parameters = "history=false&workflow=true") {
  return `/api/resource/person/person-owner?${parameters}&token=${encodeURIComponent(token)}`;
}

async function assertPending(response, token) {
  assert.equal(response.status, 202);
  assert.equal(response.headers.get("retry-after"), "1");
  const body = await response.json();
  assert.equal(body.stateToken, token);
  assert.equal(body.status, "pending");
  assert.equal(body.state, undefined);
  assert.equal(body.validation, undefined);
  assert.equal(body.record, undefined);
}

async function poll(url) {
  const expiresAt = performance.now() + 15_000;
  while (performance.now() < expiresAt) {
    const response = await fetch(url, { headers: asyncHeaders });
    if (response.status !== 202) return response;
    assert.equal(response.headers.get("retry-after"), "1");
    const pending = await response.json();
    assert.equal(pending.status, "pending");
    await delay(20);
  }
  assert.fail("The same state calculation stayed pending for more than 15 seconds.");
}

test("cold state sections return pending and finish for async and legacy callers", async (context) => {
  const { url, token } = await fixture(context);
  const sections = ["repository", "program", "obligations", "audits", "workflow"];
  const pending = await Promise.all(sections.map((section) => (
    fetch(`${url}${sectionPath(section, token)}`, { headers: asyncHeaders })
  )));
  await Promise.all(pending.map((response) => assertPending(response, token)));

  // A normal caller joins work started by the short async response and still
  // receives the complete state contract in one response.
  const completed = await Promise.all(sections.map(async (section) => {
    const response = await fetch(`${url}${sectionPath(section, token)}`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.stateToken, token);
    assert.equal(body.section, section);
    assert.equal(typeof body.state, "object");
    assert.notEqual(body.state, null);
    return body;
  }));
  assert.equal(completed[0].state.validation.ok, true);
  assert.ok(completed[1].state.programReadiness);
  assert.ok(completed[4].state.workflow);

  const retry = await poll(`${url}${sectionPath("workflow", token)}`);
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), completed[4]);
});

test("concurrent pending resource details and history retain the complete result", async (context) => {
  const { url, token } = await fixture(context);
  const paths = [resourcePath(token), resourcePath(token, "history=only")];
  for (const path of paths) {
    const responses = await Promise.all(Array.from({ length: 3 }, () => (
      fetch(`${url}${path}`, { headers: asyncHeaders })
    )));
    await Promise.all(responses.map((response) => assertPending(response, token)));
    const legacy = await fetch(`${url}${path}`);
    assert.equal(legacy.status, 200);
    const expected = await legacy.json();
    assert.equal(expected.stateToken, token);
    if (path.includes("history=only")) {
      assert.equal(expected.historyLoaded, true);
      assert.ok(expected.history.length > 0);
    } else {
      assert.equal(expected.record.id, "person-owner");
      assert.equal(expected.detailsLoaded, true);
      assert.equal(expected.historyLoaded, false);
      assert.ok(expected.workflow);
    }
    const retries = await Promise.all(Array.from({ length: 3 }, () => poll(`${url}${path}`)));
    for (const response of retries) {
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), expected);
    }
  }
});

test("cold requests without the async preference still wait for actual state", async (context) => {
  const { url, token } = await fixture(context);
  const responses = await Promise.all([
    fetch(`${url}${sectionPath("program", token)}`),
    fetch(`${url}${resourcePath(token)}`)
  ]);
  for (const response of responses) assert.equal(response.status, 200);
  const [program, resource] = await Promise.all(responses.map((response) => response.json()));
  assert.ok(program.state.programReadiness);
  assert.equal(resource.record.id, "person-owner");
  assert.ok(resource.workflow);
});

test("async response budgets do not replace the total calculation deadlines", async (context) => {
  for (const options of [{ stateSectionDeadlineMs: 0 }, { resourceDetailDeadlineMs: 0 }]) {
    const { url, token } = await fixture(context, options);
    const path = options.stateSectionDeadlineMs === 0
      ? sectionPath("repository", token)
      : resourcePath(token);
    const response = await poll(`${url}${path}`);
    assert.equal(response.status, 503);
    const failure = await response.json();
    assert.equal(typeof failure.error, "string");
    assert.equal(failure.state, undefined);
    assert.equal(failure.validation, undefined);
    assert.equal(failure.record, undefined);
  }
});

test("pending state and detail requests reject changed snapshot tokens", async (context) => {
  const { root, url, token } = await fixture(context);
  const paths = [sectionPath("workflow", token), resourcePath(token), resourcePath(token, "history=only")];
  const initial = await Promise.all(paths.map((path) => fetch(`${url}${path}`, { headers: asyncHeaders })));
  await Promise.all(initial.map((response) => assertPending(response, token)));

  const ownerPath = join(root, "data", "people", "person-owner.json");
  const owner = JSON.parse(await readFile(ownerPath, "utf8"));
  await writeFile(ownerPath, `${JSON.stringify({ ...owner, title: "Updated Program Owner" }, null, 2)}\n`);
  for (const path of paths) {
    const response = await poll(`${url}${path}`);
    assert.equal(response.status, 409);
    assert.equal(typeof (await response.json()).error, "string");
  }
});

test("a failed pending Git calculation returns failure and permits a fresh retry", async (context) => {
  const { url, token } = await fixture(context);
  let failRevisionRead = true;
  const restore = setGitCommandInterceptorForTests(({ args, run }) => {
    if (failRevisionRead && args[0] === "rev-parse" && args.includes("--verify")) {
      const error = new Error("State pending fixture revision-read deadline");
      error.code = "FILEGRC_GIT_DEADLINE";
      throw error;
    }
    return run();
  });
  context.after(restore);
  const path = `${url}${sectionPath("repository", token)}`;
  const response = await poll(path);
  assert.equal(response.status, 503);
  const failure = await response.json();
  assert.equal(typeof failure.error, "string");
  assert.equal(failure.state, undefined);
  assert.equal(failure.validation, undefined);

  failRevisionRead = false;
  const recovered = await poll(path);
  assert.equal(recovered.status, 200);
  assert.equal((await recovered.json()).state.validation.ok, true);
});


test("calculation budgets preserve individual history and snapshot Git limits", async (context) => {
  const { url, token } = await fixture(context);
  const commands = [];
  context.after(setGitSubprocessObserverForTests((event) => commands.push(event)));
  const response = await fetch(`${url}${resourcePath(token, "history=only")}`);
  assert.equal(response.status, 200);
  assert.ok(commands.some(({ kind, args }) => kind === "sync" && args[0] === "log"));
  assert.ok(commands.some(({ kind }) => kind === "async"));
  for (const command of commands) {
    const timeout = command.kind === "sync" ? command.options?.timeout : command.timeoutMs;
    if (timeout !== undefined) assert.ok(timeout > 0 && timeout <= 10_000, `${command.args[0]} exceeded the individual command budget: ${timeout}`);
  }
});

test("individual command limits survive nested aggregate budgets and kill hung Git", async (context) => {
  const { root } = await fixture(context);
  const args = ["-c", "alias.filegrc-pause=!sleep 1", "filegrc-pause"];
  const started = performance.now();
  await withGitCommandDeadline(performance.now() + 120_000, async () => {
    await withGitCommandDeadline(performance.now() + 120_000, async () => {
      await assert.rejects(runGitCommand(root, args, { timeoutMs: 120_000 }), (error) => error.kind === "timeout");
      assert.throws(() => runGitCommandSync(root, args, { timeoutMs: 120_000 }), (error) => error.code === "ETIMEDOUT");
    });
  }, { commandTimeoutMs: 30 });
  assert.ok(performance.now() - started < 1_000, "the aggregate deadline replaced the individual timeout");
});
