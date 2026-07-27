import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createResource, loadWorkspace, serveWorkspace, setupWorkspace, validateWorkspace } from "../src/index.js";
import { makeWorkspace, writeJson } from "./helpers.js";

const execute = promisify(execFile);
const cliPath = fileURLToPath(new URL("../bin/filegrc.js", import.meta.url));

test("serve help exits without starting a server and documents bind safety", async () => {
  const result = await execute(process.execPath, [cliPath, "serve", "--help"], { timeout: 2_000 });
  assert.match(result.stdout, /Usage:\s+filegrc serve/);
  assert.match(result.stdout, /FILEGRC_PORT/);
  assert.match(result.stdout, /no authentication/);
});

test("setup saves planned scope as a draft and completes through the shared HTTP operation", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-setup-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await writeJson(join(root, "data", "renderer.json"), {
    schemaVersion: 1,
    id: "renderer-settings",
    type: "renderer-settings",
    title: "Renderer settings",
    showOnboarding: true
  });

  const draft = await setupWorkspace(root, {
    serviceName: "Example Service",
    boundary: "The production application and supporting cloud resources.",
    ownerId: "person-owner",
    criticality: "high",
    dataClassification: "Confidential",
    internetExposed: true,
    programGoal: "none",
    draft: true
  });
  assert.equal(draft.draft, true);
  assert.equal(draft.system.status, "planned");
  assert.equal(JSON.parse(await readFile(join(root, "data", "renderer.json"), "utf8")).showOnboarding, true);

  const running = await serveWorkspace(root, { port: 0 });
  context.after(() => new Promise((resolve) => running.server.close(resolve)));
  const response = await fetch(`${running.url}/api/setup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      serviceName: "Example Service",
      boundary: "The production application and supporting cloud resources.",
      ownerId: "person-owner",
      criticality: "high",
      dataClassification: "Confidential",
      internetExposed: true,
      programGoal: "type-2",
      draft: false
    })
  });
  assert.equal(response.status, 200);
  const completed = await response.json();
  assert.equal(completed.onboardingComplete, true);
  assert.equal(completed.system.status, "active");
  assert.equal(completed.workspace.assuranceGoal, "soc-2-type-2");

  const loaded = await loadWorkspace(root);
  assert.equal(loaded.resources.filter(({ type, inScope }) => type === "system" && inScope).length, 1);
  assert.equal(JSON.parse(await readFile(join(root, "data", "renderer.json"), "utf8")).showOnboarding, false);
  assert.equal((await validateWorkspace(root)).ok, true);

  const resumedDraft = await setupWorkspace(root, {
    serviceName: "Example Service",
    boundary: "The production application and supporting cloud resources.",
    ownerId: "person-owner",
    criticality: "high",
    dataClassification: "Confidential",
    internetExposed: true,
    programGoal: "none",
    systemId: completed.system.id,
    draft: true
  });
  assert.equal(resumedDraft.system.status, "active");
});

test("setup accepts all initial scope fields as noninteractive CLI flags", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-setup-cli-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await createResource(root, {
    schemaVersion: 1,
    id: "framework-security",
    type: "framework",
    title: "Security framework",
    status: "active",
    version: "1",
    publisher: "Standards body"
  });
  const result = await execute(process.execPath, [
    cliPath,
    "setup",
    "--root",
    root,
    "--service-name",
    "CLI Service",
    "--boundary",
    "Production service boundary.",
    "--owner",
    "person-owner",
    "--criticality",
    "critical",
    "--classification",
    "Restricted",
    "--internet-exposed",
    "false",
    "--program-goal",
    "readiness",
    "--json"
  ]);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.draft, false);
  assert.equal(parsed.onboardingComplete, true);
  assert.equal(parsed.system.internetExposed, false);
  assert.equal(parsed.system.dataClassification, "Restricted");
  assert.equal(parsed.system.status, "active");
  assert.equal(parsed.workspace.assuranceGoal, "readiness");
  assert.deepEqual(parsed.workspace.systemIds, [parsed.system.id]);
  assert.equal(parsed.audit, undefined);
});

test("setup rejects explicit retired or missing targets", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-setup-targets-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await createResource(root, {
    schemaVersion: 1,
    id: "system-retired-service",
    type: "system",
    title: "Retired service",
    status: "retired",
    criticality: "low",
    ownerIds: ["person-owner"],
    description: "No longer used.",
    systemKind: "service",
    dataClassification: "Internal",
    internetExposed: false,
    inScope: false
  });
  const payload = {
    serviceName: "Example Service",
    boundary: "Production service boundary.",
    ownerId: "person-owner",
    criticality: "high",
    dataClassification: "Confidential",
    internetExposed: true,
    programGoal: "none"
  };

  await assert.rejects(
    setupWorkspace(root, { ...payload, systemId: "system-retired-service" }),
    /cannot be used for initial scope/
  );
  await assert.rejects(
    setupWorkspace(root, { ...payload, systemId: "system-missing" }),
    /System "system-missing" was not found/
  );
});
