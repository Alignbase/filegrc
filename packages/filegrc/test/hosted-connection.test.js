import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import { assessHostedAutomation, githubRepository, hostedAutomationRecommendation } from "../src/hosted-automation.js";
import { createFilegrcServer } from "../src/server.js";
import { APP_SCRIPT } from "../src/web.js";
import { makeComprehensiveWorkspace } from "./fixtures.js";
import { assessProgramReadiness } from "../src/program-readiness.js";
import { validateWorkspace } from "../src/validate.js";
import { assessWorkflow } from "../src/workflow.js";

test("GitHub context accepts SSH and HTTPS and rejects unrelated or ambiguous paths", () => {
  for (const url of ["git@github.com:Owner/repo.git", "ssh://git@github.com/Owner/repo.git", "https://github.com/Owner/repo.git", "https://user:secret@github.com/Owner/repo"]) assert.equal(githubRepository(url), "Owner/repo");
  for (const url of ["http://github.com/a/b", "https://elsewhere.com/a/b", "https://github.com/a/b/c", "https://github.com/a/b?x=secret", "https://github.com/a%20b/c", "git@github.com:a/b\nother", "https://github.com/a/b/", "ssh://git@github.com:2222/a/b"]) assert.equal(githubRepository(url), null);
});

test("marker states, offline CLI, shared UI and warnings preserve readiness", async t => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-connection-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  await mkdir(join(root, ".filegrc"), { recursive: true });
  const path = join(root, ".filegrc/hosted-automation.json");
  const before = await assessProgramReadiness(root);
  const beforeWorkflow = await assessWorkflow(root);
  assert.equal((await assessHostedAutomation(root)).configurationStatus, "absent");
  for (const [text, status] of [["{", "invalid"], ["{}", "invalid"], ['{"version":1,"connectionId":" spaced "}', "invalid"], ['{"version":1,"connectionId":"id","url":"x"}', "invalid"], ['{"version":2,"connectionId":"id"}', "unsupported"], ['{"version":2,"futureField":true}', "unsupported"], ['{"version":0,"connectionId":"id"}', "invalid"]]) {
    await writeFile(path, text);
    const result = await assessHostedAutomation(root);
    assert.equal(result.configurationStatus, status);
    assert.equal(result.connectionId, null);
    assert.equal(result.dashboardHref, null);
    assert.equal(result.markerVersion, null);
    assert.equal(result.diagnostics[0].severity, "warning");
    const validation = await validateWorkspace(root);
    assert.ok(validation.diagnostics.some(d => d.path === ".filegrc/hosted-automation.json" && d.severity === "warning"));
    assert.ok(!validation.diagnostics.some(d => d.path === ".filegrc/hosted-automation.json" && d.severity === "error"));
    const readiness = await assessProgramReadiness(root);
    assert.deepEqual(readiness.counts, before.counts);
    assert.equal(readiness.status, before.status);
    assert.equal(readiness.evidenceReady, before.evidenceReady);
    assert.deepEqual((await assessWorkflow(root)).assessments, beforeWorkflow.assessments);
    assert.equal(await readFile(path, "utf8"), text);
  }
  await writeFile(path, JSON.stringify({ version: 1, connectionId: "id_A-9" }));
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init", "--initial-branch=main");
  assert.equal((await assessHostedAutomation(root)).dashboardHref, "https://app.filegrc.com/connections/id_A-9");
  git("remote", "add", "origin", "https://user:secret@github.com/Owner/repo.git");
  const connection = await assessHostedAutomation(root);
  assert.equal(connection.dashboardHref, "https://app.filegrc.com/connections/id_A-9?repository=Owner%2Frepo");
  assert.equal(connection.liveStatus, "unknown");
  const readiness = await assessProgramReadiness(root);
  assert.deepEqual(readiness.hostedAutomationConnection, connection);
  const workflow = await assessWorkflow(root);
  assert.equal(workflow.recommendations[1].href, connection.dashboardHref);
  const cli = new URL("../bin/filegrc.js", import.meta.url).pathname;
  const output = JSON.parse(execFileSync(process.execPath, [cli, "automation", "--root", root, "--json"], { encoding: "utf8" }));
  assert.deepEqual(output, connection);
  assert.deepEqual(JSON.parse(execFileSync(process.execPath, [cli, "automation", "--root", join(root, "data"), "--json"], { encoding: "utf8" })), connection);
  if (process.platform !== "win32") {
    const opener = join(root, process.platform === "darwin" ? "open" : "xdg-open");
    const captured = join(root, "opened-url.txt");
    await writeFile(opener, `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.FILEGRC_TEST_OPEN_CAPTURE, process.argv[2]);\n`);
    await chmod(opener, 0o700);
    const opened = JSON.parse(execFileSync(process.execPath, [cli, "automation", "--root", root, "--json", "--open"], {
      encoding: "utf8", env: { ...process.env, PATH: `${root}:${process.env.PATH}`, FILEGRC_TEST_OPEN_CAPTURE: captured }
    }));
    assert.deepEqual(opened, connection);
    assert.equal(await readFile(captured, "utf8"), connection.dashboardHref);
    await writeFile(path, "{");
    execFileSync(process.execPath, [cli, "automation", "--root", root, "--json", "--open"], {
      env: { ...process.env, PATH: `${root}:${process.env.PATH}`, FILEGRC_TEST_OPEN_CAPTURE: captured }
    });
    assert.equal(await readFile(captured, "utf8"), connection.setupHref);
    await writeFile(path, JSON.stringify({ version: 1, connectionId: "id_A-9" }));
  }
  for (const command of ["guide", "obligations", "program-path", "program-readiness", "workflow"]) {
    const value = JSON.parse(execFileSync(process.execPath, [cli, command, "--root", root, "--json"], { encoding: "utf8" }));
    if (command === "guide") assert.equal(value.hostedAutomationConnection.dashboardHref, connection.dashboardHref);
    else if (["obligations", "workflow"].includes(command)) assert.equal(value.recommendations.find(item => item.stage === "run").href, connection.dashboardHref);
    else assert.equal(value.hostedAutomation.href, connection.dashboardHref);
  }
  const server = createFilegrcServer(root, { allowNonAuthoritativeWrites: true });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/obligations`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).recommendations[0].href, connection.dashboardHref);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  const text = execFileSync(process.execPath, [cli, "automation", "--root", root], { encoding: "utf8" });
  assert.match(text, /Live status: unknown \(not checked\)/);
  assert.doesNotMatch(text, /secret/);
  const source = APP_SCRIPT.slice(APP_SCRIPT.indexOf("function hostedNavigation"), APP_SCRIPT.indexOf("function renderFinishStepThree"));
  const state = { programReadiness: readiness };
  const { render, navigation } = vm.runInNewContext(source + "\n({ render: renderHostedAutomation, navigation: hostedNavigation })", { state, esc: String });
  for (const stage of ["controls", "run"]) assert.equal(render(stage), "");
  assert.equal(navigation(), connection.dashboardHref);
  state.programReadiness.hostedAutomationConnection = { configurationStatus: "absent", dashboardHref: null, setupHref: connection.setupHref };
  assert.equal(navigation(), connection.setupHref);
  assert.ok(APP_SCRIPT.indexOf('>Autopilot <span') > APP_SCRIPT.indexOf('<div class="sidebar-footer">'));
  assert.ok(APP_SCRIPT.indexOf('>Autopilot <span') < APP_SCRIPT.indexOf('<a class="organization-nav '));
  git("remote", "set-url", "origin", "https://unsupported.example/a/b");
  assert.equal((await assessHostedAutomation(root)).dashboardHref, "https://app.filegrc.com/connections/id_A-9");
  git("config", "--add", "remote.origin.url", "git@github.com:other/repo.git");
  assert.equal((await assessHostedAutomation(root)).dashboardHref, "https://app.filegrc.com/connections/id_A-9");
});
