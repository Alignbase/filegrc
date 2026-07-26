import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateWorkspace } from "../../soc2/src/index.js";
import { createSoc2 } from "../src/index.js";

test("creates a complete generic repository with one dependency", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "create-soc2-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(parent, { recursive: true, force: true })));
  const target = join(parent, "security-program");
  const result = await createSoc2({
    target,
    companyName: "  Example \"Engineering\"  ",
    policyOwnerName: "  Example Owner  ",
    securityContactEmail: "security@example.test",
    soc2Version: "1.2.3",
    install: false,
    effectiveDate: "2026-07-25"
  });
  assert.equal(result.engineVersion, "1.2.3");
  const packageJson = JSON.parse(await readFile(join(target, "package.json"), "utf8"));
  assert.deepEqual(packageJson.dependencies, { soc2: "^1.2.3" });
  assert.equal(packageJson.private, true);
  assert.equal((await readFile(join(target, "README.md"), "utf8")).includes("{{"), false);
  const workspace = JSON.parse(await readFile(join(target, "data", "workspace.json"), "utf8"));
  assert.equal(workspace.organizationName, "Example \"Engineering\"");
  assert.equal(workspace.riskMethodology.method, "5x5 likelihood and impact");
  assert.deepEqual(Object.keys(workspace.classificationDefinitions), ["Public", "Internal", "Confidential", "Restricted"]);
  const owner = JSON.parse(await readFile(join(target, "data", "people", "person-policy-owner.json"), "utf8"));
  assert.equal(owner.title, "Example Owner");
  assert.deepEqual(owner.teamIds, ["team-security-risk-oversight"]);
  const framework = JSON.parse(await readFile(join(target, "data", "frameworks", "framework-aicpa-trust-services-criteria.json"), "utf8"));
  assert.equal(framework.version, "2017 with revised points of focus (2022)");
  const descriptionFramework = JSON.parse(await readFile(join(target, "data", "frameworks", "framework-aicpa-soc2-description-criteria.json"), "utf8"));
  assert.equal(descriptionFramework.version, "2018 with revised implementation guidance (2022)");
  const requirementFiles = await readdir(join(target, "data", "requirements"));
  const controlFiles = await readdir(join(target, "data", "controls"));
  const obligationFiles = await readdir(join(target, "data", "obligations"));
  assert.equal(requirementFiles.length, 42);
  assert.equal(controlFiles.length, 29);
  assert.equal(obligationFiles.length, 18);
  const controls = await Promise.all(controlFiles.map(async (file) => JSON.parse(await readFile(join(target, "data", "controls", file), "utf8"))));
  assert.equal(controls.every((control) => control.status === "planned"), true);
  const coveredRequirements = new Set(controls.flatMap((control) => control.requirementIds));
  const commonCriteriaFiles = requirementFiles.filter((file) => file.startsWith("requirement-soc2-cc"));
  assert.equal(commonCriteriaFiles.length, 33);
  assert.equal(commonCriteriaFiles.every((file) => coveredRequirements.has(file.replace(/\.json$/, ""))), true);
  await access(join(target, "package-lock.json"));
  await access(join(target, ".gitignore"));
  await access(join(target, ".git"));
  const validation = await validateWorkspace(target);
  assert.deepEqual(validation.counts, { resources: 107, errors: 0, warnings: 0 });
});

test("refuses a non-empty target by default", async (context) => {
  const target = await mkdtemp(join(tmpdir(), "create-soc2-nonempty-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(target, { recursive: true, force: true })));
  await writeFile(join(target, "keep.txt"), "keep", "utf8");
  await assert.rejects(createSoc2({
    target,
    yes: true,
    soc2Version: "1.2.3",
    install: false
  }), /not empty/);
});

test("adds a workspace to a non-empty target with force without overwriting files", async (context) => {
  const target = await mkdtemp(join(tmpdir(), "create-soc2-force-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(target, { recursive: true, force: true })));
  await writeFile(join(target, "keep.txt"), "keep", "utf8");
  await createSoc2({
    target,
    yes: true,
    force: true,
    soc2Version: "1.2.3",
    install: false
  });
  assert.equal(await readFile(join(target, "keep.txt"), "utf8"), "keep");
  await access(join(target, "README.md"));
});

test("rejects force mode before writing when a template file would be overwritten", async (context) => {
  const target = await mkdtemp(join(tmpdir(), "create-soc2-collision-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(target, { recursive: true, force: true })));
  await writeFile(join(target, "README.md"), "keep me", "utf8");
  await assert.rejects(createSoc2({
    target,
    yes: true,
    force: true,
    soc2Version: "1.2.3",
    install: false
  }), /would overwrite: README\.md/);
  assert.equal(await readFile(join(target, "README.md"), "utf8"), "keep me");
  await assert.rejects(access(join(target, "data", "workspace.json")), /ENOENT/);
});

test("rejects force mode when a generated baseline record would be overwritten", async (context) => {
  const target = await mkdtemp(join(tmpdir(), "create-soc2-baseline-collision-"));
  const controlDirectory = join(target, "data", "controls");
  const controlPath = join(controlDirectory, "control-security-governance.json");
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(target, { recursive: true, force: true })));
  await mkdir(controlDirectory, { recursive: true });
  await writeFile(controlPath, "keep me", "utf8");
  await assert.rejects(createSoc2({
    target,
    yes: true,
    force: true,
    soc2Version: "1.2.3",
    install: false
  }), /control-security-governance\.json/);
  assert.equal(await readFile(controlPath, "utf8"), "keep me");
  await assert.rejects(access(join(target, "data", "workspace.json")), /ENOENT/);
});

test("rejects multiline identity values before writing the target", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "create-soc2-invalid-input-"));
  const target = join(parent, "security-program");
  const tokenTarget = join(parent, "token-program");
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(parent, { recursive: true, force: true })));
  await assert.rejects(createSoc2({
    target,
    companyName: "Example Company\nInjected heading",
    policyOwnerName: "Example Owner",
    securityContactEmail: "security@example.test",
    soc2Version: "1.2.3",
    install: false
  }), /single line/);
  await assert.rejects(access(target), /ENOENT/);
  await assert.rejects(createSoc2({
    target: tokenTarget,
    companyName: "{{policy_owner_name}}",
    policyOwnerName: "Example Owner",
    securityContactEmail: "security@example.test",
    soc2Version: "1.2.3",
    install: false
  }), /template token syntax/);
  await assert.rejects(access(tokenTarget), /ENOENT/);
});
