import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateWorkspace } from "../../filegrc/src/index.js";
import { createFileGRC } from "../src/index.js";

test("creates a complete generic repository with one dependency", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "create-filegrc-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(parent, { recursive: true, force: true })));
  const target = join(parent, "security-program");
  const result = await createFileGRC({
    target,
    companyName: "  Example \"Engineering\"  ",
    policyOwnerName: "  Example Owner  ",
    securityContactEmail: "security@example.test",
    filegrcVersion: "1.2.3",
    install: false,
    effectiveDate: "2026-07-25"
  });
  assert.equal(result.engineVersion, "1.2.3");
  const packageJson = JSON.parse(await readFile(join(target, "package.json"), "utf8"));
  assert.deepEqual(packageJson.dependencies, { filegrc: "^1.2.3" });
  assert.equal(packageJson.private, true);
  const readme = await readFile(join(target, "README.md"), "utf8");
  assert.equal(readme.includes("{{"), false);
  assert.match(readme, /initializes Git when needed/);
  const workspace = JSON.parse(await readFile(join(target, "data", "workspace.json"), "utf8"));
  assert.equal(workspace.dataModelVersion, "1");
  assert.equal(workspace.organizationName, "Example \"Engineering\"");
  assert.equal(workspace.riskMethodology.method, "5x5 likelihood and impact");
  assert.deepEqual(Object.keys(workspace.classificationDefinitions), ["Public", "Internal", "Confidential", "Restricted"]);
  const renderer = JSON.parse(await readFile(join(target, "data", "renderer.json"), "utf8"));
  assert.equal(renderer.showOnboarding, true);
  const owner = JSON.parse(await readFile(join(target, "data", "people", "person-policy-owner.json"), "utf8"));
  assert.equal(owner.title, "Example Owner");
  assert.deepEqual(owner.teamIds, ["team-security-risk-oversight"]);
  const informationSecurityPolicy = JSON.parse(await readFile(join(target, "data", "policies", "policy-information-security.json"), "utf8"));
  assert.equal("contentPath" in informationSecurityPolicy, false);
  await access(join(target, "data", "policies", "policy-information-security.md"));
  assert.deepEqual(informationSecurityPolicy.relatedDocumentIds, [
    "document-business-continuity-disaster-recovery",
    "document-incident-response-plan"
  ]);
  const informationSecurityContent = await readFile(join(target, "data", "policies", "policy-information-security.md"), "utf8");
  assert.match(informationSecurityContent, /The remediation clock starts when Example "Engineering" confirms the finding/);
  assert.match(informationSecurityContent, /\| Low \| 90 days \|/);
  const dataProtectionContent = await readFile(join(target, "data", "policies", "policy-data-protection-handling.md"), "utf8");
  assert.match(dataProtectionContent, /Confidential and Restricted data must be encrypted in transit[\s\S]*and at rest/);
  const continuityContent = await readFile(join(target, "data", "documents", "document-business-continuity-disaster-recovery.md"), "utf8");
  assert.match(continuityContent, /maximum tolerable downtime/);
  assert.doesNotMatch(continuityContent, /\| Low \| Within 12 hours \|/);
  assert.doesNotMatch(continuityContent, /within four hours/);
  const incidentResponseContent = await readFile(join(target, "data", "documents", "document-incident-response-plan.md"), "utf8");
  assert.match(incidentResponseContent, /A \*\*material incident\*\* is an incident that/);
  assert.match(incidentResponseContent, /The triggering law, contract, policy, or commitment/);
  const employeeHandbook = await readFile(join(target, "data", "policies", "policy-employee-handbook.md"), "utf8");
  assert.match(employeeHandbook, /optional handbook template/);
  assert.match(employeeHandbook, /designated people contact/);
  const employeePolicyAcknowledgement = await readFile(join(target, "data", "documents", "document-employee-policy-acknowledgement.md"), "utf8");
  assert.doesNotMatch(employeePolicyAcknowledgement, /- Employee Handbook/);
  assert.match(employeePolicyAcknowledgement, /Content Git commit:/);
  const handbookAcknowledgement = await readFile(join(target, "data", "documents", "document-employee-handbook-acknowledgement.md"), "utf8");
  assert.match(handbookAcknowledgement, /Handbook Git commit:/);
  await assert.rejects(access(join(target, "data", "content")), /ENOENT/);
  const framework = JSON.parse(await readFile(join(target, "data", "frameworks", "framework-aicpa-trust-services-criteria.json"), "utf8"));
  assert.equal(framework.version, "2017 with revised points of focus (2022)");
  const descriptionFramework = JSON.parse(await readFile(join(target, "data", "frameworks", "framework-aicpa-soc2-description-criteria.json"), "utf8"));
  assert.equal(descriptionFramework.version, "2018 with revised implementation guidance (2022)");
  const requirementFiles = await readdir(join(target, "data", "requirements"));
  const controlFiles = await readdir(join(target, "data", "controls"));
  const obligationFiles = await readdir(join(target, "data", "obligations"));
  assert.equal(requirementFiles.length, 42);
  const requirementRecords = await Promise.all(requirementFiles.map(async (file) => JSON.parse(await readFile(join(target, "data", "requirements", file), "utf8"))));
  assert.ok(requirementRecords.every((record) => typeof record.description === "string" && record.description.length > 20));
  const firstRequirement = JSON.parse(await readFile(join(target, "data", "requirements", "requirement-soc2-cc1-1.json"), "utf8"));
  assert.equal(firstRequirement.title, "CC1.1: Integrity and ethical values");
  assert.match(firstRequirement.description, /integrity and ethical conduct/);
  assert.match(firstRequirement.applicabilityRationale, /Confirm applicability/);
  const eventEvaluationRequirement = JSON.parse(await readFile(join(target, "data", "requirements", "requirement-soc2-cc7-3.json"), "utf8"));
  assert.equal(eventEvaluationRequirement.title, "CC7.3: Security event evaluation");
  assert.match(eventEvaluationRequirement.description, /detected events.*security incidents/);
  const incidentDescriptionCriterion = JSON.parse(await readFile(join(target, "data", "requirements", "requirement-soc2-dc4.json"), "utf8"));
  assert.equal(incidentDescriptionCriterion.title, "DC4: System incidents");
  const changeDescriptionCriterion = JSON.parse(await readFile(join(target, "data", "requirements", "requirement-soc2-dc9.json"), "utf8"));
  assert.equal(changeDescriptionCriterion.title, "DC9: Significant changes");
  assert.equal(controlFiles.length, 29);
  assert.equal(obligationFiles.length, 33);
  const controls = await Promise.all(controlFiles.map(async (file) => JSON.parse(await readFile(join(target, "data", "controls", file), "utf8"))));
  const obligations = await Promise.all(obligationFiles.map(async (file) => JSON.parse(await readFile(join(target, "data", "obligations", file), "utf8"))));
  assert.equal(controls.every((control) => control.status === "planned"), true);
  assert.equal(
    obligations
      .filter((obligation) => obligation.recurrence.mode === "event")
      .every((obligation) => Number.isInteger(obligation.window?.endOffsetDays) || Number.isInteger(obligation.window?.endOffsetHours)),
    true
  );
  const coveredRequirements = new Set(controls.flatMap((control) => control.requirementIds));
  const commonCriteriaFiles = requirementFiles.filter((file) => file.startsWith("requirement-soc2-cc"));
  assert.equal(commonCriteriaFiles.length, 33);
  assert.equal(commonCriteriaFiles.every((file) => coveredRequirements.has(file.replace(/\.json$/, ""))), true);
  await access(join(target, "package-lock.json"));
  await access(join(target, ".gitignore"));
  await access(join(target, ".git"));
  const gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: target, encoding: "utf8" }).trim();
  assert.equal(await realpath(gitRoot), await realpath(target));
  const validation = await validateWorkspace(target);
  assert.deepEqual(validation.counts, { resources: 124, errors: 0, warnings: 0 });
});

test("refuses a non-empty target by default", async (context) => {
  const target = await mkdtemp(join(tmpdir(), "create-filegrc-nonempty-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(target, { recursive: true, force: true })));
  await writeFile(join(target, "keep.txt"), "keep", "utf8");
  await assert.rejects(createFileGRC({
    target,
    yes: true,
    filegrcVersion: "1.2.3",
    install: false
  }), /not empty/);
});

test("adds a workspace to a non-empty target with force without overwriting files", async (context) => {
  const target = await mkdtemp(join(tmpdir(), "create-filegrc-force-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(target, { recursive: true, force: true })));
  await writeFile(join(target, "keep.txt"), "keep", "utf8");
  await createFileGRC({
    target,
    yes: true,
    force: true,
    filegrcVersion: "1.2.3",
    install: false
  });
  assert.equal(await readFile(join(target, "keep.txt"), "utf8"), "keep");
  await access(join(target, "README.md"));
});

test("rejects force mode before writing when a template file would be overwritten", async (context) => {
  const target = await mkdtemp(join(tmpdir(), "create-filegrc-collision-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(target, { recursive: true, force: true })));
  await writeFile(join(target, "README.md"), "keep me", "utf8");
  await assert.rejects(createFileGRC({
    target,
    yes: true,
    force: true,
    filegrcVersion: "1.2.3",
    install: false
  }), /would overwrite: README\.md/);
  assert.equal(await readFile(join(target, "README.md"), "utf8"), "keep me");
  await assert.rejects(access(join(target, "data", "workspace.json")), /ENOENT/);
});

test("rejects force mode when a generated baseline record would be overwritten", async (context) => {
  const target = await mkdtemp(join(tmpdir(), "create-filegrc-baseline-collision-"));
  const controlDirectory = join(target, "data", "controls");
  const controlPath = join(controlDirectory, "control-security-governance.json");
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(target, { recursive: true, force: true })));
  await mkdir(controlDirectory, { recursive: true });
  await writeFile(controlPath, "keep me", "utf8");
  await assert.rejects(createFileGRC({
    target,
    yes: true,
    force: true,
    filegrcVersion: "1.2.3",
    install: false
  }), /control-security-governance\.json/);
  assert.equal(await readFile(controlPath, "utf8"), "keep me");
  await assert.rejects(access(join(target, "data", "workspace.json")), /ENOENT/);
});

test("rejects multiline identity values before writing the target", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "create-filegrc-invalid-input-"));
  const target = join(parent, "security-program");
  const tokenTarget = join(parent, "token-program");
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(parent, { recursive: true, force: true })));
  await assert.rejects(createFileGRC({
    target,
    companyName: "Example Company\nInjected heading",
    policyOwnerName: "Example Owner",
    securityContactEmail: "security@example.test",
    filegrcVersion: "1.2.3",
    install: false
  }), /single line/);
  await assert.rejects(access(target), /ENOENT/);
  await assert.rejects(createFileGRC({
    target: tokenTarget,
    companyName: "{{policy_owner_name}}",
    policyOwnerName: "Example Owner",
    securityContactEmail: "security@example.test",
    filegrcVersion: "1.2.3",
    install: false
  }), /template token syntax/);
  await assert.rejects(access(tokenTarget), /ENOENT/);
});
