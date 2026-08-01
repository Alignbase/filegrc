import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
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
const childProcessTimeout = 60_000;

test("serve help exits without starting a server and documents bind safety", async () => {
  const result = await execute(process.execPath, [cliPath, "serve", "--help"], { timeout: childProcessTimeout });
  assert.match(result.stdout, /Usage:\s+filegrc serve/);
  assert.match(result.stdout, /FILEGRC_PORT/);
  assert.match(result.stdout, /--allow-non-authoritative-writes/);
  assert.match(result.stdout, /never commits or pushes/);
  assert.match(result.stdout, /no authentication/);
});

test("serve ends startup output with the GitHub star message", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-serve-output-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);

  const child = spawn(process.execPath, [cliPath, "serve", root, "--port", "0"], {
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  let stopping = false;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    if (!stopping && stdout.includes("https://github.com/Sunpeak-AI/filegrc")) {
      stopping = true;
      child.kill("SIGTERM");
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const exit = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Timed out waiting for server startup output.\n${stderr}`));
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

  assert.ok(
    exit.code === 0 || (process.platform === "win32" && exit.signal === "SIGTERM"),
    stderr || `Server exited with code ${exit.code} and signal ${exit.signal}.`
  );
  assert.equal(
    stdout.slice(stdout.lastIndexOf("\n\x1b[38;2;255;184;0m")),
    "\n\x1b[38;2;255;184;0m⭐️  → ❤️  https://github.com/Sunpeak-AI/filegrc\x1b[0m\n\n"
  );
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
  await createResource(root, {
    schemaVersion: 1,
    id: "framework-security",
    type: "framework",
    title: "Security framework",
    status: "active",
    version: "1"
  });
  await createResource(root, {
    schemaVersion: 1,
    id: "requirement-access",
    type: "requirement",
    title: "Access requirement",
    frameworkId: "framework-security",
    reference: "TEST-ACCESS",
    applicability: "applicable"
  });
  await createResource(root, {
    schemaVersion: 1,
    id: "control-access",
    type: "control",
    title: "Access control",
    status: "planned",
    statement: "Access is approved and limited.",
    ownerIds: ["person-owner"],
    requirementIds: ["requirement-access"],
    code: "IAM-01",
    activity: "Approve and provision access.",
    operationMode: "manual",
    frequency: "Per event"
  });
  await createResource(root, {
    schemaVersion: 1,
    id: "control-governance",
    type: "control",
    title: "Governance oversight",
    status: "planned",
    statement: "Management reviews the control program.",
    ownerIds: ["person-owner"],
    requirementIds: ["requirement-access"],
    code: "GOV-01",
    activity: "Record oversight reviews and decisions.",
    operationMode: "manual",
    frequency: "Quarterly"
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
  assert.deepEqual(completed.linkedControlIds, []);
  assert.deepEqual(completed.evidenceTestDraftIds, []);

  let loaded = await loadWorkspace(root);
  assert.equal(loaded.resources.filter(({ type, inScope }) => type === "system" && inScope).length, 1);
  assert.equal(JSON.parse(await readFile(join(root, "data", "renderer.json"), "utf8")).showOnboarding, false);
  assert.equal(loaded.resources.filter(({ type }) => type === "evidence").length, 0);
  assert.equal(loaded.resources.find(({ id }) => id === "control-access").systemIds, undefined);

  const evidencePreview = JSON.parse((await execute(process.execPath, [
    cliPath,
    "evidence-test-drafts",
    "--root",
    root,
    "--preview",
    "--json"
  ])).stdout);
  assert.equal(evidencePreview.preview, true);
  assert.equal(evidencePreview.create.length, 1);
  assert.equal((await loadWorkspace(root)).resources.filter(({ type }) => type === "evidence").length, 0);

  const draftResponse = await fetch(`${running.url}/api/evidence-test-drafts`, { method: "POST" });
  assert.equal(draftResponse.status, 201);
  assert.equal((await draftResponse.json()).created.length, 1);
  loaded = await loadWorkspace(root);
  const evidenceDraft = loaded.resources.find(({ type }) => type === "evidence");
  assert.equal(evidenceDraft.status, "draft");
  assert.equal(evidenceDraft.evidenceKind, "test-export");
  assert.equal(evidenceDraft.collectionTestFamilyId, "identity-access");
  assert.deepEqual(evidenceDraft.controlIds, ["control-access"]);
  assert.equal(loaded.resources.some(({ collectionTestFamilyId }) => collectionTestFamilyId === "governance"), false);
  assert.equal((await validateWorkspace(root)).ok, true);

  const repeatedDraftResponse = await fetch(`${running.url}/api/evidence-test-drafts`, { method: "POST" });
  assert.equal(repeatedDraftResponse.status, 201);
  assert.equal((await repeatedDraftResponse.json()).created.length, 0);

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
  const baseArguments = [
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
    "readiness"
  ];
  const preview = await execute(process.execPath, [...baseArguments, "--preview", "--json"]);
  const previewResult = JSON.parse(preview.stdout);
  assert.equal(previewResult.preview, true);
  assert.equal(previewResult.changes.controls, 0);
  assert.equal(previewResult.changes.evidenceDrafts, 0);
  assert.equal(previewResult.system.description, "Production service boundary.");
  assert.deepEqual(previewResult.system.ownerIds, ["person-owner"]);
  assert.equal(previewResult.system.criticality, "critical");
  assert.equal(previewResult.system.dataClassification, "Restricted");
  assert.equal(previewResult.system.internetExposed, false);
  assert.equal(previewResult.system.inScope, true);
  assert.equal(previewResult.target.assuranceGoal, "readiness");
  assert.deepEqual(previewResult.target.systemIds, [previewResult.system.id]);
  assert.equal(previewResult.renderer, null);
  assert.equal((await loadWorkspace(root)).resources.some(({ title }) => title === "CLI Service"), false);

  const result = await execute(process.execPath, [...baseArguments, "--summary", "--json"]);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.draft, false);
  assert.equal(parsed.onboardingComplete, true);
  assert.equal(parsed.preview, false);
  assert.equal(parsed.system.status, "active");
  assert.equal(parsed.target.assuranceGoal, "readiness");
  assert.equal(parsed.target.scopeCounts.frameworks, 0);
  assert.equal(parsed.workspace, undefined);
  const loaded = await loadWorkspace(root);
  const system = loaded.resources.find(({ id }) => id === parsed.system.id);
  assert.equal(system.internetExposed, false);
  assert.equal(system.dataClassification, "Restricted");
  assert.deepEqual(system, previewResult.system);
  assert.equal(loaded.workspace.assuranceGoal, previewResult.target.assuranceGoal);
  assert.deepEqual(loaded.workspace.systemIds, previewResult.target.systemIds);
  assert.deepEqual(
    loaded.resources.find(({ type }) => type === "renderer-settings") || null,
    previewResult.renderer
  );
  assert.equal(loaded.workspace.assuranceGoal, "readiness");
  assert.deepEqual(loaded.workspace.systemIds, [parsed.system.id]);

  const textResult = await execute(process.execPath, baseArguments);
  assert.match(textResult.stdout, /filegrc program-path --next --json/);
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
