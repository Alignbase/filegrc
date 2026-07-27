import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, readdir, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
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
  assert.match(readme, /# Example "Engineering" SOC 2 Program/);
  assert.match(readme, /FileGRC 1\.2\.3/);
  assert.match(readme, /npx filegrc setup --help/);
  assert.match(readme, /finish Step 1 by confirming the people and oversight team, applicable criteria, commitments, material vendors, and in-scope systems/);
  assert.doesNotMatch(readme, /npx create-filegrc/);
  const agents = await readFile(join(target, "AGENTS.md"), "utf8");
  assert.match(agents, /Completing onboarding opens the Step 1 overview/);
  assert.match(agents, /`complementary-control\.relatedControlIds` is the source of truth/);
  assert.equal(result.install, "skipped");
  assert.equal(result.gitMode, "initialized");
  const workspace = JSON.parse(await readFile(join(target, "data", "workspace.json"), "utf8"));
  assert.equal(workspace.dataModelVersion, "1");
  assert.equal(workspace.organizationName, "Example \"Engineering\"");
  assert.equal(workspace.riskMethodology.method, "5x5 likelihood and impact");
  assert.deepEqual(Object.keys(workspace.classificationDefinitions), ["Public", "Internal", "Confidential", "Restricted"]);
  const renderer = JSON.parse(await readFile(join(target, "data", "renderer.json"), "utf8"));
  assert.equal(renderer.showOnboarding, true);
  assert.deepEqual(renderer.completedStagePageIds, []);
  const owner = JSON.parse(await readFile(join(target, "data", "people", "person-policy-owner.json"), "utf8"));
  assert.equal(owner.title, "Example Owner");
  assert.deepEqual(owner.teamIds, ["team-security-risk-oversight"]);
  const independentApprover = JSON.parse(await readFile(join(target, "data", "people", "person-independent-approver.json"), "utf8"));
  assert.equal(independentApprover.status, "active");
  assert.equal(independentApprover.title, "Independent Reviewer");
  assert.notEqual(independentApprover.id, owner.id);
  const oversightTeam = JSON.parse(await readFile(join(target, "data", "teams", "team-security-risk-oversight.json"), "utf8"));
  assert.deepEqual(oversightTeam.memberIds, [owner.id, independentApprover.id]);
  assert.deepEqual(oversightTeam.chairIds, [independentApprover.id]);
  for (const collection of ["policies", "documents"]) {
    const files = (await readdir(join(target, "data", collection))).filter((file) => file.endsWith(".json"));
    for (const file of files) {
      const record = JSON.parse(await readFile(join(target, "data", collection, file), "utf8"));
      if (!record.approverIds?.length) continue;
      assert.equal(record.ownerIds.some((id) => record.approverIds.includes(id)), false, `${record.id} has the same owner and approver`);
    }
  }
  const informationSecurityPolicy = JSON.parse(await readFile(join(target, "data", "policies", "policy-information-security.json"), "utf8"));
  assert.equal("contentPath" in informationSecurityPolicy, false);
  await access(join(target, "data", "policies", "policy-information-security.md"));
  assert.deepEqual(informationSecurityPolicy.relatedDocumentIds, [
    "document-business-continuity-disaster-recovery",
    "document-incident-response-plan",
    "document-data-retention-schedule"
  ]);
  assert.deepEqual(informationSecurityPolicy.approverIds, [independentApprover.id]);
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
  assert.match(incidentResponseContent, /representative security alert from generation through receipt, acknowledgement, escalation, and a fallback route/);
  const retentionSchedule = JSON.parse(await readFile(join(target, "data", "documents", "document-data-retention-schedule.json"), "utf8"));
  assert.deepEqual(retentionSchedule.approverIds, [independentApprover.id]);
  const retentionScheduleContent = await readFile(join(target, "data", "documents", "document-data-retention-schedule.md"), "utf8");
  assert.match(retentionScheduleContent, /Security logs for important systems[\s\S]*At least 12 months/);
  assert.match(retentionScheduleContent, /Important production backups[\s\S]*At least 30 days/);
  const trainingFiles = (await readdir(join(target, "data", "training"))).filter((file) => file.endsWith(".json"));
  assert.equal(trainingFiles.length, 4);
  assert.ok(trainingFiles.includes("training-secure-development.json"));
  assert.ok(trainingFiles.includes("training-privileged-sensitive-roles.json"));
  assert.ok(trainingFiles.includes("training-anti-bribery-high-risk-roles.json"));
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
  const requirementFiles = (await readdir(join(target, "data", "requirements"))).filter((file) => file.endsWith(".json"));
  const controlFiles = (await readdir(join(target, "data", "controls"))).filter((file) => file.endsWith(".json"));
  const obligationFiles = (await readdir(join(target, "data", "obligations"))).filter((file) => file.endsWith(".json"));
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
  assert.equal(obligationFiles.length, 41);
  const programRepository = JSON.parse(await readFile(join(target, "data", "systems", "system-filegrc-program-repository.json"), "utf8"));
  assert.deepEqual(programRepository.evidenceSourceKinds, ["training-acknowledgement", "exception-finding"]);
  assert.equal(programRepository.inScope, false);
  assert.match(await readFile(join(target, "data", "systems", "system-filegrc-program-repository.md"), "utf8"), /system of record for FileGRC governance records/);
  const controls = await Promise.all(controlFiles.map(async (file) => JSON.parse(await readFile(join(target, "data", "controls", file), "utf8"))));
  const obligations = await Promise.all(obligationFiles.map(async (file) => JSON.parse(await readFile(join(target, "data", "obligations", file), "utf8"))));
  assert.equal(controls.every((control) => control.status === "planned"), true);
  assert.equal(
    obligations
      .filter((obligation) => obligation.recurrence.mode === "event")
      .every((obligation) => Number.isInteger(obligation.window?.endOffsetDays) || Number.isInteger(obligation.window?.endOffsetHours)),
    true
  );
  const obligationsById = new Map(obligations.map((obligation) => [obligation.id, obligation]));
  const eventObligationCounts = obligations
    .filter((obligation) => obligation.recurrence.mode === "event")
    .reduce((counts, obligation) => {
      counts[obligation.recurrence.eventType] = (counts[obligation.recurrence.eventType] || 0) + 1;
      return counts;
    }, {});
  assert.equal(eventObligationCounts["person-started"], 5);
  assert.equal(eventObligationCounts["person-role-changed"], 2);
  assert.equal(eventObligationCounts["personal-device-access-planned"], 2);
  assert.equal(eventObligationCounts["vendor-reassessment-needed"], 2);
  assert.equal(eventObligationCounts["system-material-change"], 5);
  assert.deepEqual(obligationsById.get("obligation-worker-start-role-training").scopeResourceIds, [
    "training-secure-development",
    "training-privileged-sensitive-roles",
    "training-anti-bribery-high-risk-roles"
  ]);
  assert.equal(obligationsById.get("obligation-worker-role-change-training").window.endOffsetDays, 30);
  assert.equal(obligationsById.get("obligation-personal-device-approval").window.endOffsetDays, 0);
  assert.equal(obligationsById.get("obligation-personal-device-registration").window.endOffsetDays, 0);
  assert.equal(obligationsById.get("obligation-vendor-material-change-review").window.endOffsetDays, 30);
  assert.equal(obligationsById.get("obligation-vendor-material-change-records").window.endOffsetDays, 30);
  assert.deepEqual(obligationsById.get("obligation-system-change-retention").scopeResourceIds, ["document-data-retention-schedule"]);
  assert.ok(obligationsById.get("obligation-system-change-alert-path").completionResourceTypes.includes("control-test"));
  assert.deepEqual(obligationsById.get("obligation-annual-incident-exercise").controlIds, [
    "control-incident-exercise",
    "control-logging-monitoring"
  ]);
  const coveredRequirements = new Set(controls.flatMap((control) => control.requirementIds));
  const commonCriteriaFiles = requirementFiles.filter((file) => file.startsWith("requirement-soc2-cc"));
  assert.equal(commonCriteriaFiles.length, 33);
  assert.equal(commonCriteriaFiles.every((file) => coveredRequirements.has(file.replace(/\.json$/, ""))), true);
  await access(join(target, "package-lock.json"));
  await access(join(target, "data", "AGENTS.md"));
  await access(join(target, "data", "risk-assessments", "AGENTS.md"));
  await access(join(target, "data", "evidence", "AGENTS.md"));
  await access(join(target, "data", "obligations", "AGENTS.md"));
  await access(join(target, "data", "obligation-events", "AGENTS.md"));
  await access(join(target, "data", "action-items", "AGENTS.md"));
  await access(join(target, "data", "audits", "AGENTS.md"));
  await access(join(target, "data", "audit-populations", "AGENTS.md"));
  await access(join(target, "data", "policies", "AGENTS.md"));
  await access(join(target, "data", "documents", "document-soc2-system-description.md"));
  await access(join(target, "data", "documents", "document-soc2-management-assertion.md"));
  await access(join(target, "data", "documents", "document-soc2-period-completeness.md"));
  await access(join(target, "data", "documents", "document-soc2-management-representation.md"));
  await access(join(target, ".gitignore"));
  await access(join(target, ".git"));
  const gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: target, encoding: "utf8" }).trim();
  assert.equal(await realpath(gitRoot), await realpath(target));
  const validation = await validateWorkspace(target);
  assert.deepEqual(validation.counts, { resources: 142, errors: 0, warnings: 0 });

  await writeFile(
    join(target, "data", "policies", "policy-information-security.json"),
    `${JSON.stringify({ ...informationSecurityPolicy, status: "approved" }, null, 2)}\n`,
    "utf8"
  );
  const prematureApproval = await validateWorkspace(target);
  assert.ok(prematureApproval.diagnostics.some(({ code }) => code === "independent-approver-not-appointed"));
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
  await writeFile(join(target, "keep.txt"), "keep {{company_name}}", "utf8");
  await createFileGRC({
    target,
    yes: true,
    force: true,
    filegrcVersion: "1.2.3",
    install: false
  });
  assert.equal(await readFile(join(target, "keep.txt"), "utf8"), "keep {{company_name}}");
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

test("rejects force mode when a target path traverses a symbolic link", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "create-filegrc-symlink-"));
  const target = join(parent, "target");
  const outside = join(parent, "outside");
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(parent, { recursive: true, force: true })));
  await mkdir(target);
  await mkdir(outside);
  await symlink(outside, join(target, "data"));
  await assert.rejects(createFileGRC({
    target,
    yes: true,
    force: true,
    filegrcVersion: "1.2.3",
    install: false
  }), /symbolic link/);
  assert.deepEqual(await readdir(outside), []);
  await assert.rejects(access(join(target, "README.md")), /ENOENT/);
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

test("reports the resolved version, install result, and existing Git worktree", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "create-filegrc-output-"));
  const target = join(parent, "program");
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(parent, { recursive: true, force: true })));
  execFileSync("git", ["init"], { cwd: parent, stdio: "ignore" });
  const output = execFileSync(process.execPath, [
    fileURLToPath(new URL("../bin/create-filegrc.js", import.meta.url)),
    target,
    "--company-name",
    "Example Company",
    "--policy-owner-name",
    "Example Owner",
    "--security-contact-email",
    "security@example.test",
    "--filegrc-version",
    "1.2.3",
    "--no-install"
  ], { encoding: "utf8" });
  assert.match(output, /FileGRC 1\.2\.3: installation skipped/);
  assert.match(output, /Git: joined existing worktree/);
  assert.equal(await access(join(target, ".git")).then(() => true, () => false), false);
});
