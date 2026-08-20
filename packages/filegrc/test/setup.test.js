import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createResource, loadWorkspace, serveWorkspace, setupWorkspace, validateWorkspace } from "../src/index.js";
import { collectTimings } from "../src/timing.js";
import { makeComprehensiveWorkspace } from "./fixtures.js";
import { makeWorkspace, writeJson } from "./helpers.js";

test("model v4 setup preserves Component scope and draft lifecycle", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-setup-v4-component-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "4");
  await createResource(root, {
    id: "system-secondary",
    type: "system",
    title: "Secondary service",
    status: "active",
    purpose: "Provide a separate service.",
    servicesProvided: ["Secondary service"],
    boundary: "The secondary application and its supporting operations.",
    exclusions: [],
    criticality: "medium",
    ownerIds: ["appointment-example"]
  });
  await createResource(root, {
    id: "component-filegrc-program-repository",
    type: "component",
    title: "filegrc Program Repository",
    status: "planned",
    componentKind: "software",
    description: "Stores the Program record and revision history.",
    ownerIds: ["appointment-example"],
    systemUses: [{
      systemId: "system-secondary",
      roles: ["supporting-operations"],
      rationale: "Stores governance records for the secondary service."
    }]
  });
  const setup = {
    serviceName: "Production application",
    boundary: "The production application and supporting operations.",
    ownerId: "person-example",
    criticality: "high",
    classificationId: "classification-example",
    internetExposed: true,
    programGoal: "readiness",
    systemId: "system-example"
  };

  await setupWorkspace(root, { ...setup, draft: true });
  let component = (await loadWorkspace(root)).resources.find(({ id }) => id === "component-filegrc-program-repository");
  assert.equal(component.status, "planned");
  assert.deepEqual(component.systemUses.map(({ systemId }) => systemId).sort(), ["system-example", "system-secondary"]);

  await setupWorkspace(root, { ...setup, draft: false });
  component = (await loadWorkspace(root)).resources.find(({ id }) => id === "component-filegrc-program-repository");
  assert.equal(component.status, "active");
  assert.deepEqual(component.systemUses.map(({ systemId }) => systemId).sort(), ["system-example", "system-secondary"]);
});

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
    if (!stopping && stdout.includes("https://github.com/Alignbase/filegrc")) {
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
    "\n\x1b[38;2;255;184;0m⭐️  → ❤️  https://github.com/Alignbase/filegrc\x1b[0m\n\n"
  );
});

test("serve chooses another port when the preferred port is occupied", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-serve-port-fallback-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);

  const blocker = createServer();
  await new Promise((resolve, reject) => {
    blocker.once("error", reject);
    blocker.listen(0, "127.0.0.1", resolve);
  });
  context.after(() => new Promise((resolve) => blocker.close(resolve)));
  const occupiedPort = blocker.address().port;

  const child = spawn(process.execPath, [cliPath, "serve", root, "--port", String(occupiedPort)], {
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  let stopping = false;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    if (!stopping && stdout.includes("filegrc workspace:")) {
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
  assert.match(stdout, new RegExp(`Port ${occupiedPort} is already in use\\. Using \\d+ instead\\.`));
  const fallbackPort = Number(stdout.match(/Using (\d+) instead\./)?.[1]);
  assert.ok(Number.isInteger(fallbackPort));
  assert.notEqual(fallbackPort, occupiedPort);
  assert.match(stdout, new RegExp(`filegrc workspace: http://127\\.0\\.0\\.1:${fallbackPort}`));
});

test("setup saves planned scope as a draft and completes through the shared HTTP operation", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-setup-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await writeJson(join(root, "data", "renderer.json"), {
    id: "renderer-settings",
    type: "renderer-settings",
    title: "Renderer settings",
    repositoryMode: "manual",
    authoritativeBranch: "main",
    repositoryRemote: "origin",
    showOnboarding: true
  });
  await createResource(root, {
    id: "framework-security",
    type: "framework",
    title: "Security framework",
    status: "active",
    version: "1"
  });
  await createResource(root, {
    id: "requirement-access",
    type: "requirement",
    title: "Access requirement",
    frameworkId: "framework-security",
    reference: "TEST-ACCESS",
    applicability: "applicable"
  });
  await createResource(root, {
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
    operationPattern: "event-driven"
  });
  await createResource(root, {
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
    operationPattern: "scheduled"
  });

  const draft = await setupWorkspace(root, {
    serviceName: "Example Service",
    boundary: "The production application and supporting cloud resources.",
    ownerId: "person-owner",
    criticality: "high",
    classificationId: "confidential",
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
      classificationId: "confidential",
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
  assert.equal(completed.state.resources.length, 9);
  assert.equal(completed.state.workspace.assuranceGoal, "soc-2-type-2");
  assert.equal(completed.state.resources.find(({ record }) => record.id === completed.system.id).record.status, "active");
  assert.equal(completed.state.resources.find(({ record }) => record.type === "renderer-settings").record.showOnboarding, false);

  let loaded = await loadWorkspace(root);
  assert.deepEqual(loaded.workspace.systemIds, [completed.system.id]);
  assert.equal(JSON.parse(await readFile(join(root, "data", "renderer.json"), "utf8")).showOnboarding, false);
  assert.equal(loaded.resources.filter(({ type }) => type === "evidence").length, 0);
  assert.equal(loaded.resources.find(({ id }) => id === "control-access").systemIds, undefined);

  const browserState = await (await fetch(`${running.url}/api/state`)).json();
  const browserControlStage = browserState.programReadiness.stages.find(({ id }) => id === "controls");
  const browserIdentityMap = browserControlStage.items.find(({ familyId }) => familyId === "identity-access");
  assert.ok(browserIdentityMap);
  assert.equal(browserIdentityMap.evidenceForm, "export");
  assert.match(browserIdentityMap.evidencePrompt, /users, roles, privileged access/);
  assert.deepEqual(browserIdentityMap.controlIds, ["control-access"]);
  assert.deepEqual(browserIdentityMap.sourceSystemIds, []);
  assert.equal(browserIdentityMap.status, "action");

  const evidenceMap = JSON.parse((await execute(process.execPath, [
    cliPath,
    "evidence-map",
    "--root",
    root,
    "--json"
  ])).stdout);
  const identityMap = evidenceMap.items.find(({ familyId }) => familyId === "identity-access");
  assert.ok(identityMap);
  assert.equal(identityMap.status, "action");
  assert.match(identityMap.evidencePrompt, /users, roles, privileged access/);
  assert.equal((await loadWorkspace(root)).resources.filter(({ type }) => type === "evidence").length, 0);

  await createResource(root, {
    id: "evidence-existing-review",
    type: "evidence",
    title: "Existing review evidence",
    status: "draft",
    artifactKind: "business-record",
    artifactSubtype: "review",
    sourceKind: "authored-record"
  });
  loaded = await loadWorkspace(root);
  assert.equal(loaded.resources.find(({ id }) => id === "evidence-existing-review").title, "Existing review evidence");
  assert.equal(loaded.resources.filter(({ type }) => type === "evidence").length, 1);
  assert.equal((await validateWorkspace(root)).ok, true);

  const resumedDraft = await setupWorkspace(root, {
    serviceName: "Example Service",
    boundary: "The production application and supporting cloud resources.",
    ownerId: "person-owner",
    criticality: "high",
    classificationId: "confidential",
    internetExposed: true,
    programGoal: "none",
    systemId: completed.system.id,
    draft: true
  });
  assert.equal(resumedDraft.system.status, "active");
});

test("setup applies its records in one validation pass", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-setup-validation-count-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await writeJson(join(root, "data", "renderer.json"), {
    id: "renderer-settings",
    type: "renderer-settings",
    title: "Renderer settings",
    repositoryMode: "manual",
    authoritativeBranch: "main",
    repositoryRemote: "origin",
    showOnboarding: true
  });

  const { result, timings } = await collectTimings(() => setupWorkspace(root, {
    serviceName: "Counted Service",
    boundary: "The production service and supporting infrastructure.",
    ownerId: "person-owner",
    criticality: "high",
    classificationId: "confidential",
    internetExposed: true,
    programGoal: "readiness",
    draft: false
  }));

  assert.equal(result.onboardingComplete, true);
  assert.equal(timings.validation.count, 1);
  assert.equal(timings.writes.count, 3);
});

test("model v3 setup creates one visible service commitment prompt", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-setup-v3-commitment-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const workspace = (await loadWorkspace(root)).workspace;
  await writeJson(join(root, "data", "workspace.json"), {
    ...workspace,
    dataModelVersion: "3"
  });
  const setup = {
    serviceName: "Customer Service",
    boundary: "The customer application and supporting systems.",
    ownerId: "person-owner",
    criticality: "high",
    classificationId: "confidential",
    internetExposed: true,
    programGoal: "type-2",
    draft: false
  };

  const first = await setupWorkspace(root, setup);
  assert.equal(first.commitment.status, "planned");
  assert.deepEqual(first.commitment.systemIds, [first.system.id]);
  assert.match(first.commitment.statement, /\[Complete before activation: State the actual customer promise or approved service requirement\.\]/);
  const second = await setupWorkspace(root, { ...setup, systemId: first.system.id });
  assert.equal(second.commitment, null);
  const commitments = (await loadWorkspace(root)).resources.filter(({ type }) => type === "commitment");
  assert.equal(commitments.length, 1);
  assert.equal((await validateWorkspace(root)).ok, true);
});

test("setup restores every affected file when a later batch write fails", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-setup-rollback-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await mkdir(join(root, "data", "systems"), { recursive: true });
  const rendererPath = join(root, "data", "renderer.json");
  const workspacePath = join(root, "data", "workspace.json");
  await writeJson(rendererPath, {
    id: "renderer-settings",
    type: "renderer-settings",
    title: "Renderer settings",
    repositoryMode: "manual",
    authoritativeBranch: "main",
    repositoryRemote: "origin",
    showOnboarding: true
  });
  const originalWorkspace = await readFile(workspacePath, "utf8");
  const originalRenderer = await readFile(rendererPath, "utf8");
  await chmod(join(root, "data"), 0o555);
  try {
    await assert.rejects(setupWorkspace(root, {
      serviceName: "Rollback Service",
      boundary: "The production service and supporting infrastructure.",
      ownerId: "person-owner",
      criticality: "high",
      classificationId: "confidential",
      internetExposed: true,
      programGoal: "readiness",
      draft: false
    }), /EACCES|EPERM|permission denied/i);
  } finally {
    await chmod(join(root, "data"), 0o755);
  }

  assert.equal(await readFile(workspacePath, "utf8"), originalWorkspace);
  assert.equal(await readFile(rendererPath, "utf8"), originalRenderer);
  await assert.rejects(access(join(root, "data", "systems", "system-rollback-service.json")), /ENOENT/);
});

test("setup accepts all initial scope fields as noninteractive CLI flags", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-setup-cli-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await createResource(root, {
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
  assert.equal(previewResult.system.description, "Production service boundary.");
  assert.deepEqual(previewResult.system.ownerIds, ["person-owner"]);
  assert.equal(previewResult.system.criticality, "critical");
  assert.equal(previewResult.system.classificationId, "restricted");
  assert.equal(previewResult.system.internetExposed, false);
  assert.deepEqual(previewResult.target.systemIds, [previewResult.system.id]);
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
  assert.equal(system.classificationId, "restricted");
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
    id: "system-retired-service",
    type: "system",
    title: "Retired service",
    status: "retired",
    criticality: "low",
    ownerIds: ["person-owner"],
    description: "No longer used.",
    systemKind: "service",
    classificationId: "internal",
    internetExposed: false,
    statusTransition: {
      changedByIds: ["person-owner"],
      changedOn: "2026-08-02",
      reason: "The service was retired before setup."
    }
  });
  const payload = {
    serviceName: "Example Service",
    boundary: "Production service boundary.",
    ownerId: "person-owner",
    criticality: "high",
    classificationId: "confidential",
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
