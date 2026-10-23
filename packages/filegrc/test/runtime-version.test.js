import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCli } from "../src/cli.js";
import { createResource } from "../src/files.js";
import { createFilegrcServer } from "../src/server.js";
import { makeWorkspace } from "./helpers.js";

const currentVersion = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version;
const incompatibleVersion = "99.0.0";

test("CLI, server, and direct writes reject an installed engine that differs from the lockfile", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-version-drift-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeWorkspace(root);
  await writeFile(join(root, "package-lock.json"), `${JSON.stringify({
    name: "version-drift-test",
    lockfileVersion: 3,
    packages: {
      "": { dependencies: { filegrc: "^99.0.0" } },
      "node_modules/filegrc": { version: "99.0.0" }
    }
  }, null, 2)}\n`);

  const expected = /Installed filegrc .* cannot use package-lock\.json \(99\.0\.0\).*npm ci/;
  await assert.rejects(runCli(["validate", "--root", root]), expected);
  for (const command of ["validate", "build", "serve"]) {
    await assert.rejects(runCli([command, root]), expected);
    await assert.rejects(runCli([command, root, "--root", process.cwd()]), expected);
  }
  assert.throws(() => createFilegrcServer(root), expected);
  await assert.rejects(createResource(root, { id: "person-new", type: "person", title: "New person" }), expected);
});

test("package-managed workspaces reject missing and incomplete lockfiles", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-lockfile-required-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeWorkspace(root);
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    name: "lockfile-required-test",
    private: true,
    dependencies: { filegrc: "^0.16.0" }
  }, null, 2)}\n`);
  await assert.rejects(runCli(["validate", "--root", root]), /package-lock\.json is missing/);
  assert.throws(() => createFilegrcServer(root), /package-lock\.json is missing/);
  await assert.rejects(createResource(root, { id: "person-new", type: "person", title: "New person" }), /package-lock\.json is missing/);
  await writeFile(join(root, "package-lock.json"), `${JSON.stringify({
    name: "lockfile-required-test",
    lockfileVersion: 3,
    packages: { "": { dependencies: { filegrc: "^0.16.0" } } }
  }, null, 2)}\n`);
  await assert.rejects(runCli(["validate", "--root", root]), /no filegrc version/);
  assert.throws(() => createFilegrcServer(root), /no filegrc version/);
  await assert.rejects(createResource(root, { id: "person-new", type: "person", title: "New person" }), /no filegrc version/);
});

import { readFile, cp, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assessRuntimeCompatibility, assessWorkspaceRuntimeCompatibility, assertWorkspaceEngineVersion, runtimeCompatibilityLine } from "../src/runtime-version.js";
import { createObligationEvent } from "../src/obligations.js";
import { previewWorkflowMutation } from "../src/workflow.js";
import { validateWorkspace } from "../src/validate.js";
import { loadWorkspace } from "../src/workspace.js";
import { updateResource, deleteResource, applyResourceBatch } from "../src/files.js";

test("stable runtime compatibility lines use minor before 1.0 and major thereafter", () => {
  for (const [runtime, repository, compatible] of [
    ["0.17.0", "0.17.2", true], ["0.17.3", "0.17.0", true],
    ["0.17.3", "0.18.0", false], ["0.17.3", "0.16.9", false],
    ["1.0.0", "1.99.9", true], ["1.9.0", "1.0.0", true], ["1.0.0", "2.0.0", false],
    ["0.17.0+build.1", "0.17.9", true],
    ["0.19.0", "0.18.16", true], ["0.18.16", "0.19.0", false],
    ["0.19.0", "0.19.2", true], ["0.19.0", "0.20.0", false]
  ]) assert.equal(assessRuntimeCompatibility(runtime, repository).compatible, compatible);
  for (const version of ["0.17.2-beta.1", "v0.17.2", "0.17", "00.17.2", "0.17.2 ", "^0.17.2", 17, "0.17.9007199254740992"]) {
    assert.equal(runtimeCompatibilityLine(version), null);
    assert.equal(assessRuntimeCompatibility("0.17.0", version).reason, "invalid-repository-version");
  }
  assert.equal(assessRuntimeCompatibility("0.17.0-beta", "0.17.0").reason, "invalid-runtime-version");
  assert.equal(assessRuntimeCompatibility("0.17.0", "0.17.2", { dataModelVersion: "14" }).reason, "unsupported-workspace-model");
  assert.equal(assessRuntimeCompatibility("0.17.0", "0.17.2", { requiredApiContractVersion: 2 }).reason, "unsupported-api-contract");
});

async function lockWorkspace(root, version) {
  await writeFile(join(root, "package.json"), JSON.stringify({ private: true, dependencies: { filegrc: `^${version}` } }));
  await writeFile(join(root, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/filegrc": { version } } }));
}

async function eventWorkspace(root) {
  await makeWorkspace(root);
  await createResource(root, { id: "obligation-onboarding", type: "obligation", title: "Register device", status: "active",
    activityType: "asset-registration", recurrence: { mode: "event", eventType: "person-started" },
    window: { precision: "date", startsAfter: 0, dueAfter: 2 }, ownerIds: ["person-owner"] });
}

test("both patch directions preview and save events and tasks without changing version files", async (context) => {
  const base = await mkdtemp(join(tmpdir(), "filegrc-patch-directions-"));
  context.after(() => rm(base, { recursive: true, force: true }));
  // Load the same policy in independently installed runtime versions. This
  // exercises the real mutation guard, not an injected version comparison.
  for (const [runtimeVersion, repositoryVersion] of [["0.17.0", "0.17.2"], ["0.17.4", "0.17.0"]]) {
    const packageRoot = join(base, runtimeVersion, "engine");
    await cp(fileURLToPath(new URL("..", import.meta.url)), packageRoot, { recursive: true, filter: (path) => !path.includes("/test") });
    const manifestPath = join(packageRoot, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    await writeFile(manifestPath, JSON.stringify({ ...manifest, version: runtimeVersion }));
    const api = await import(pathToFileURL(join(packageRoot, "src/index.js")));
    const root = join(base, runtimeVersion, "workspace");
    await mkdir(root, { recursive: true });
    await eventWorkspace(root);
    await lockWorkspace(root, repositoryVersion);
    const paths = ["package.json", "package-lock.json", "data/workspace.json"];
    const before = await Promise.all(paths.map(path => readFile(join(root, path), "utf8")));
    const options = { operation: "trigger-event", eventType: "person-started", occurredOn: "2026-07-01", subjectResourceIds: ["person-owner"], title: "Start engineer" };
    const compatibility = api.assessWorkspaceRuntimeCompatibility(root);
    assert.equal(compatibility.compatible, true);
    assert.equal(compatibility.installedVersion, runtimeVersion);
    assert.equal(compatibility.repositoryVersion, repositoryVersion);
    const preview = await api.previewWorkflowMutation(root, options);
    assert.equal((await loadWorkspace(root)).resources.some(r => r.type === "obligation-event"), false);
    const created = await api.createObligationEvent(root, options);
    assert.equal(created.actions.length, 1);
    assert.equal(created.actions[0].sourceResourceId, created.event.id);
    assert.equal(created.actions[0].completionWindow.dueOn, "2026-07-03");
    assert.equal((await api.validateWorkspace(root)).ok, true);
    assert.ok(preview);
    await api.createResource(root, { id: "person-patch", type: "person", title: "Patch worker", status: "active", affiliation: "internal", jobTitle: "Engineer" });
    await api.deleteResource(root, "person", "person-patch");
    assert.deepEqual(await Promise.all(paths.map(path => readFile(join(root, path), "utf8"))), before);
  }
});

test("compatibility failures reach evaluations, previews, and guarded mutations", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-incompatible-runtime-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await eventWorkspace(root);
  for (const version of [incompatibleVersion, `${currentVersion}-beta`, "garbage"]) {
    await lockWorkspace(root, version);
    const result = assessWorkspaceRuntimeCompatibility(root);
    assert.equal(result.compatible, false);
    assert.equal(result.repositoryVersion, version);
    assert.equal((await validateWorkspace(root)).ok, false);
    for (const operation of [
      () => previewWorkflowMutation(root, { operation: "trigger-event" }),
      () => createObligationEvent(root, {}),
      () => updateResource(root, "person", "person-owner", {}),
      () => deleteResource(root, "person", "person-owner"),
      () => applyResourceBatch(root, [])
    ]) await assert.rejects(async () => operation(), error => error.code === "FILEGRC_VERSION_DRIFT" && error.compatibility.reason === result.reason);
  }
  await lockWorkspace(root, currentVersion);
  const workspacePath = join(root, "data/workspace.json");
  const workspace = JSON.parse(await readFile(workspacePath));
  await writeFile(workspacePath, JSON.stringify({ ...workspace, dataModelVersion: "14" }));
  assert.equal(assessWorkspaceRuntimeCompatibility(root).reason, "unsupported-workspace-model");
  assert.throws(() => assertWorkspaceEngineVersion(root), /Workspace model 14 is unsupported/);
});

test("linked dependencies resolve their target version and cannot fall back around a broken link", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-linked-runtime-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeWorkspace(root);
  await lockWorkspace(root, "0.17.2");
  const lock = { packages: { "node_modules/filegrc": { link: true, resolved: "../engine", version: "0.17.2" }, "../engine": { version: "0.17.0" } } };
  await writeFile(join(root, "package-lock.json"), JSON.stringify(lock));
  assert.equal(assessWorkspaceRuntimeCompatibility(root).repositoryVersion, "0.17.0");
  delete lock.packages["../engine"];
  await writeFile(join(root, "package-lock.json"), JSON.stringify(lock));
  assert.equal(assessWorkspaceRuntimeCompatibility(root).reason, "missing-repository-version");
  await writeFile(join(root, "package-lock.json"), "null");
  assert.equal(assessWorkspaceRuntimeCompatibility(root).reason, "invalid-lockfile");
});

test("malformed model declarations and explicit invalid API contracts fail hosted preflight", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-invalid-model-declaration-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeWorkspace(root);
  for (const workspace of [{}, { dataModelVersion: null }, [], { dataModelVersion: 12 }]) {
    await writeFile(join(root, "data/workspace.json"), JSON.stringify(workspace));
    assert.equal(assessWorkspaceRuntimeCompatibility(root).reason, "invalid-workspace-model");
    assert.throws(() => assertWorkspaceEngineVersion(root), /must declare a supported string dataModelVersion/);
  }
  for (const requiredApiContractVersion of [null, 0, "1", {}, 2]) {
    assert.equal(assessRuntimeCompatibility("0.17.0", "0.17.2", { requiredApiContractVersion }).reason, "unsupported-api-contract");
  }
});

import { initializeGitWorkspace } from "./helpers.js";

test("previews use current version files after an uncommitted dependency repair", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-preview-version-repair-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await eventWorkspace(root);
  await lockWorkspace(root, "0.16.0");
  await initializeGitWorkspace(root);
  await lockWorkspace(root, currentVersion);
  const before = await readFile(join(root, "package-lock.json"), "utf8");
  await previewWorkflowMutation(root, { operation: "trigger-event", eventType: "person-started", occurredOn: "2026-07-01", subjectResourceIds: ["person-owner"] });
  assert.equal(await readFile(join(root, "package-lock.json"), "utf8"), before);
  assert.equal((await loadWorkspace(root)).resources.some(record => record.type === "obligation-event"), false);
});

import { captureCli } from "./helpers.js";

test("diagnostic CLI and server reads preserve model recovery while mutations reject", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-model-recovery-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeWorkspace(root);
  await lockWorkspace(root, currentVersion);
  await writeFile(join(root, "data/workspace.json"), "{");
  const server = createFilegrcServer(root);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise(resolve => server.close(resolve)));
  const address = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${address}/api/state/bootstrap`);
  assert.equal(response.status, 200);
  for (const suffix of ["", "?history=only"]) {
    assert.equal((await fetch(`${address}/api/resource/person/person-owner${suffix}`)).status, 200);
  }
  const validation = await captureCli(runCli, ["validate", root, "--json"]);
  assert.equal(validation.exitCode, 1);
  assert.equal(JSON.parse(validation.stdout).ok, false);
  assert.ok(JSON.parse(validation.stdout).diagnostics.some(({ code }) => code === "invalid-json"));
  const build = await captureCli(runCli, ["build", root]);
  assert.equal(build.exitCode, 0);
  await assert.rejects(createResource(root, { id: "person-recovery", type: "person", title: "Recovery person" }), /Cannot read data\/workspace.json/);
  await lockWorkspace(root, incompatibleVersion);
  assert.throws(() => createFilegrcServer(root), /unsupported-compatibility-line/);
  await assert.rejects(captureCli(runCli, ["validate", root, "--json"]), /unsupported-compatibility-line/);
});
