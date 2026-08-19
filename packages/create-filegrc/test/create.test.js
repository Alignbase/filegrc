import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, readdir, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assessProgramReadiness,
  assessWorkflow,
  loadModel,
  scaffoldCollectionReview,
  validateWorkspace
} from "../../filegrc/src/index.js";
import { createFilegrc } from "../src/index.js";

test("creates a complete generic repository with one dependency", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "create-filegrc-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(parent, { recursive: true, force: true })));
  const target = join(parent, "security-program");
  const result = await createFilegrc({
    target,
    companyName: "  Example \"Engineering\"  ",
    policyOwnerName: "  Example Owner  ",
    policyOwnerJobTitle: "Chief Executive Officer",
    policyOwnerEmail: "owner@example.test",
    securityContactEmail: "security@example.test",
    timezone: "America/Chicago",
    filegrcVersion: "1.2.3",
    install: false,
    effectiveDate: "2026-07-25"
  });
  assert.equal(result.engineVersion, "1.2.3");
  assert.deepEqual(result.resourceCounts, {
    total: 163,
    byType: {
      workspace: 1,
      "renderer-settings": 1,
      person: 1,
      appointment: 2,
      team: 1,
      program: 1,
      classification: 4,
      component: 1,
      policy: 1,
      document: 6,
      training: 1,
      framework: 2,
      "collection-review": 6,
      requirement: 42,
      "source-coverage": 14,
      control: 28,
      obligation: 51
    }
  });
  const packageJson = JSON.parse(await readFile(join(target, "package.json"), "utf8"));
  assert.deepEqual(packageJson.dependencies, { filegrc: "^1.2.3" });
  assert.equal(packageJson.private, true);
  const readme = await readFile(join(target, "README.md"), "utf8");
  assert.equal(readme.includes("{{"), false);
  assert.match(readme, /# Example "Engineering" SOC 2 Program/);
  assert.match(readme, /filegrc 1\.2\.3/);
  assert.match(readme, /npx filegrc setup/);
  assert.match(readme, /npx filegrc program-path --next --json/);
  assert.match(readme, /finish Step 1 by adding the real reviewers and operators, finishing the oversight team/);
  assert.doesNotMatch(readme, /npx create-filegrc/);
  const agents = await readFile(join(target, "AGENTS.md"), "utf8");
  assert.match(agents, /Completing onboarding opens the Step 1 overview/);
  assert.match(agents, /npx filegrc program-path --next --json/);
  assert.match(agents, /adds its full set of Action Items to the Work Queue in a single validated write/);
  assert.match(agents, /`complementary-control\.relatedControlIds` is the source of truth/);
  const dataGuide = await readFile(join(target, "data", "AGENTS.md"), "utf8");
  assert.match(dataGuide, /shared assessments, complete checklist, Work Items, blockers, and recommended next action/);
  assert.equal(result.install, "skipped");
  assert.equal(result.gitMode, "initialized");
  assert.equal(result.gitBranch, "main");
  const workspace = JSON.parse(await readFile(join(target, "data", "workspace.json"), "utf8"));
  assert.equal(workspace.dataModelVersion, "4");
  const generatedJson = (await collectTextFiles(join(target, "data"))).filter((path) => path.endsWith(".json"));
  const generatedRecords = await Promise.all(generatedJson.map(async (path) => (
    JSON.parse(await readFile(path, "utf8"))
  )));
  for (const [index, record] of generatedRecords.entries()) {
    assert.equal(Object.hasOwn(record, "schemaVersion"), false, generatedJson[index]);
  }
  assert.equal(workspace.organizationName, "Example \"Engineering\"");
  assert.equal(workspace.timezone, "America/Chicago");
  const programRecord = JSON.parse(await readFile(join(target, "data", "programs", "program-soc-2.json"), "utf8"));
  assert.equal(programRecord.riskMethodology.method, "5x5 likelihood and impact");
  assert.deepEqual(
    generatedRecords.filter(({ type }) => type === "classification").map(({ id }) => id).sort(),
    ["confidential", "internal", "public", "restricted"]
  );
  const renderer = JSON.parse(await readFile(join(target, "data", "renderer.json"), "utf8"));
  assert.equal(renderer.showOnboarding, true);
  assert.equal(renderer.repositoryMode, "trunk");
  assert.equal(renderer.authoritativeBranch, "main");
  assert.equal(renderer.repositoryRemote, "origin");
  assert.equal(renderer.completedStagePageIds, undefined);
  const owner = JSON.parse(await readFile(join(target, "data", "people", "person-program-lead.json"), "utf8"));
  assert.equal(owner.title, "Example Owner");
  assert.equal(owner.email, "owner@example.test");
  assert.equal(owner.jobTitle, "Chief Executive Officer");
  assert.equal(owner.role, undefined);
  assert.equal(owner.teamIds, undefined);
  const policyOwnerAppointment = JSON.parse(await readFile(
    join(target, "data", "appointments", "appointment-policy-owner.json"),
    "utf8"
  ));
  assert.equal(policyOwnerAppointment.title, "Policy Owner");
  assert.equal(policyOwnerAppointment.holderId, owner.id);
  assert.deepEqual(policyOwnerAppointment.scopeResourceIds, ["workspace"]);
  assert.equal(policyOwnerAppointment.startsOn, "2026-07-25");
  const appointmentFiles = (await readdir(join(target, "data", "appointments")))
    .filter((file) => file.endsWith(".json"));
  const appointmentRecords = await Promise.all(appointmentFiles.map(async (file) => (
    JSON.parse(await readFile(join(target, "data", "appointments", file), "utf8"))
  )));
  assert.equal(appointmentRecords.length, 2);
  assert.deepEqual(
    new Set(appointmentRecords.map(({ appointmentKind }) => appointmentKind)),
    new Set(Object.keys(loadModel(workspace.dataModelVersion).appointmentTemplates))
  );
  assert.equal(appointmentRecords.every(({ scopeResourceIds }) => (
    scopeResourceIds.length === 1 && scopeResourceIds[0] === "workspace"
  )), true);
  assert.equal(appointmentRecords.filter(({ status }) => status === "active").length, 1);
  assert.equal(appointmentRecords.filter(({ status }) => status === "planned").length, 1);
  const model = loadModel(workspace.dataModelVersion);
  assert.deepEqual(
    new Set(generatedRecords
      .filter(({ type }) => type === "source-coverage")
      .map(({ sourceFamilyId }) => sourceFamilyId)),
    new Set(model.evidenceSourceFamilies.map(({ id }) => id))
  );
  assert.deepEqual(
    new Set(generatedRecords
      .filter(({ type, recurrence }) => type === "obligation" && recurrence?.mode === "event")
      .map(({ recurrence }) => recurrence.eventType)),
    new Set(Object.keys(model.policyEvents))
  );
  assert.deepEqual(
    new Set(generatedRecords
      .filter(({ type, template }) => type === "document" && template === true)
      .map(({ documentKind }) => documentKind)
      .filter((kind) => model.auditReadiness.managementDocuments.some((definition) => definition.kind === kind))),
    new Set(model.auditReadiness.managementDocuments.map(({ kind }) => kind))
  );
  const starterActivityTypes = new Set(generatedRecords
    .filter(({ type }) => type === "obligation")
    .map(({ activityType }) => activityType));
  for (const activityType of starterActivityTypes) {
    const activity = model.obligationActivities[activityType];
    assert.ok(activity, `Starter Obligation uses unknown activity ${activityType}`);
    if (activity.completionProfile) {
      assert.ok(
        model.completionProfiles[activity.completionProfile],
        `Starter Obligation activity ${activityType} uses unknown completion profile ${activity.completionProfile}`
      );
    }
  }
  await assert.rejects(
    access(join(target, "data", "people", "person-independent-approver.json")),
    /ENOENT/
  );
  const oversightTeam = JSON.parse(await readFile(join(target, "data", "teams", "team-security-risk-oversight.json"), "utf8"));
  assert.equal(oversightTeam.status, "planned");
  assert.deepEqual(oversightTeam.memberIds, [owner.id]);
  assert.deepEqual(oversightTeam.chairIds, []);
  for (const collection of ["policies", "documents"]) {
    const files = (await readdir(join(target, "data", collection))).filter((file) => file.endsWith(".json"));
    for (const file of files) {
      const record = JSON.parse(await readFile(join(target, "data", collection, file), "utf8"));
      assert.equal("approverIds" in record, false, `${record.id} should wait for a real approver`);
      if (collection === "policies") {
        assert.equal("controlIds" in record, false, `${record.id} derives linked controls from Control policyIds`);
      }
    }
  }
  const informationSecurityPolicy = JSON.parse(await readFile(join(target, "data", "policies", "policy-information-security.json"), "utf8"));
  assert.equal("contentPath" in informationSecurityPolicy, false);
  await access(join(target, "data", "policies", "policy-information-security.md"));
  assert.deepEqual(informationSecurityPolicy.relatedDocumentIds, [
    "document-security-incident-recovery-plan",
    "document-data-retention-schedule"
  ]);
  assert.equal("approverIds" in informationSecurityPolicy, false);
  const informationSecurityContent = await readFile(join(target, "data", "policies", "policy-information-security.md"), "utf8");
  assert.doesNotMatch(informationSecurityContent, /\| Low \| 90 days \|/);
  assert.match(informationSecurityContent, /does not infer technical implementation/);
  assert.match(informationSecurityContent, /risk-appropriate compensating or post-deployment review/);
  assert.match(informationSecurityContent, /selects scanning coverage, penetration-testing applicability, remediation targets, and review cadence/);
  assert.match(informationSecurityContent, /Vendors already in use|Vendor already in use/);
  assert.match(informationSecurityContent, /continuous native malware and application protection/);
  assert.match(informationSecurityContent, /periodic process that verifies configuration, update, and compliance state/);
  assert.match(informationSecurityContent, /retaliation for a good-faith report are prohibited/);
  assert.match(informationSecurityContent, /fraud and misconduct risk/);
  assert.match(informationSecurityContent, /time-bound Exception with risk assessment, compensating Controls/);
  await assert.rejects(access(join(target, "data", "policies", "policy-clear-desk-screen.json")), /ENOENT/);
  await assert.rejects(access(join(target, "data", "policies", "policy-mobile-computing-communications.json")), /ENOENT/);
  for (const removedPolicy of [
    "policy-anti-bribery-corruption",
    "policy-data-protection-handling",
    "policy-employee-handbook",
    "policy-endpoint-remote-work"
  ]) {
    await assert.rejects(access(join(target, "data", "policies", `${removedPolicy}.json`)), /ENOENT/);
  }
  const recoveryContent = await readFile(join(target, "data", "documents", "document-security-incident-recovery-plan.md"), "utf8");
  assert.match(recoveryContent, /maximum tolerable downtime/);
  assert.match(recoveryContent, /\[Complete before activation: Link every important System/);
  assert.match(recoveryContent, /starter proposal for important production data is a daily backup, 30-day retention period, and annual restore validation/);
  assert.match(recoveryContent, /protected alternate location and access method/);
  assert.match(recoveryContent, /does not require pre-arranged counsel, in-house counsel, or a standing legal retainer/);
  assert.match(recoveryContent, /the triggering law, contract, Policy, commitment, or management decision/);
  assert.match(recoveryContent, /representative security alert from generation through receipt, acknowledgement, escalation, and fallback/);
  assert.match(recoveryContent, /\[Complete before activation: Name a usable alternate reporting route/);
  const retentionSchedule = JSON.parse(await readFile(join(target, "data", "documents", "document-data-retention-schedule.json"), "utf8"));
  assert.equal("approverIds" in retentionSchedule, false);
  const retentionScheduleContent = await readFile(join(target, "data", "documents", "document-data-retention-schedule.md"), "utf8");
  assert.match(retentionScheduleContent, /Security logs for important Systems[\s\S]*proposed default before approval: 12 months/);
  assert.match(retentionScheduleContent, /Production backups or alternate recovery copies[\s\S]*proposed default before approval: 30 days/);
  assert.match(retentionScheduleContent, /detects the bracketed prompts as approval blockers/);
  const trainingFiles = (await readdir(join(target, "data", "training"))).filter((file) => file.endsWith(".json"));
  assert.deepEqual(trainingFiles, ["training-security-awareness.json"]);
  const awarenessTrainingContent = await readFile(join(target, "data", "training", "training-security-awareness.md"), "utf8");
  assert.match(awarenessTrainingContent, /## Building and changing systems/);
  assert.match(awarenessTrainingContent, /compensating or post-deployment review/);
  assert.doesNotMatch(awarenessTrainingContent, /no more than 15 minutes/);
  for (const removedDocument of [
    "document-business-continuity-disaster-recovery",
    "document-incident-response-plan",
    "document-employee-policy-acknowledgement",
    "document-contractor-policy-acknowledgement",
    "document-employee-training-acknowledgement",
    "document-contractor-training-acknowledgement",
    "document-employee-handbook-acknowledgement"
  ]) {
    await assert.rejects(access(join(target, "data", "documents", `${removedDocument}.json`)), /ENOENT/);
  }
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
  assert.equal(firstRequirement.applicabilityRationale, undefined);
  assert.ok(programRecord.requirementApplicability.some(({ requirementId, decision }) => requirementId === firstRequirement.id && decision === "undetermined"));
  const eventEvaluationRequirement = JSON.parse(await readFile(join(target, "data", "requirements", "requirement-soc2-cc7-3.json"), "utf8"));
  assert.equal(eventEvaluationRequirement.title, "CC7.3: Security event evaluation");
  assert.match(eventEvaluationRequirement.description, /detected events.*security incidents/);
  const incidentDescriptionCriterion = JSON.parse(await readFile(join(target, "data", "requirements", "requirement-soc2-dc4.json"), "utf8"));
  assert.equal(incidentDescriptionCriterion.title, "DC4: System incidents");
  const changeDescriptionCriterion = JSON.parse(await readFile(join(target, "data", "requirements", "requirement-soc2-dc9.json"), "utf8"));
  assert.equal(changeDescriptionCriterion.title, "DC9: Significant changes");
  assert.equal(controlFiles.length, 28);
  assert.equal(obligationFiles.length, 51);
  assert.equal(obligationFiles.includes("obligation-monthly-malware-scan.json"), false);
  assert.equal(obligationFiles.includes("obligation-monthly-endpoint-protection-verification.json"), true);
  assert.equal(obligationFiles.includes("obligation-quarterly-vulnerability-scan.json"), true);
  assert.equal(obligationFiles.includes("obligation-annual-penetration-test.json"), true);
  const programRepository = JSON.parse(await readFile(join(target, "data", "components", "component-filegrc-program-repository.json"), "utf8"));
  const filegrcSourceFamilyIds = generatedRecords
    .filter(({ type, coverageKind }) => type === "source-coverage" && coverageKind === "filegrc")
    .map(({ sourceFamilyId }) => sourceFamilyId);
  assert.deepEqual(
    new Set(programRepository.evidenceSourceKinds),
    new Set(filegrcSourceFamilyIds)
  );
  assert.equal(
    generatedRecords
      .filter(({ type, sourceFamilyId }) => (
        type === "source-coverage" && filegrcSourceFamilyIds.includes(sourceFamilyId)
      ))
      .every(({ status, collectionCadence, retention, reconciliationMethod, validFrom }) => (
        status === "active"
        && Boolean(collectionCadence)
        && Boolean(retention)
        && Boolean(reconciliationMethod)
        && validFrom === "2026-07-25"
      )),
    true
  );
  assert.equal(Object.hasOwn(programRepository, "inScope"), false);
  assert.equal(programRepository.systemUses.length, 0);
  assert.match(await readFile(join(target, "data", "components", "component-filegrc-program-repository.md"), "utf8"), /authoritative Component for FileGRC governance records/);
  const controls = await Promise.all(controlFiles.map(async (file) => JSON.parse(await readFile(join(target, "data", "controls", file), "utf8"))));
  const obligations = await Promise.all(obligationFiles.map(async (file) => JSON.parse(await readFile(join(target, "data", "obligations", file), "utf8"))));
  assert.equal(controls.every((control) => control.status === "planned"), true);
  assert.equal(
    controls.every((control) => (
      control.policyIds.length === 1 && control.policyIds[0] === "policy-information-security"
    )),
    true
  );
  assert.equal(controls.every((control) => control.ownerIds.includes(policyOwnerAppointment.id)), true);
  const filegrcSourceControlCodes = new Set(model.evidenceSourceFamilies
    .filter(({ id }) => filegrcSourceFamilyIds.includes(id))
    .flatMap(({ controlCodes }) => controlCodes));
  assert.equal(
    controls
      .filter(({ code }) => filegrcSourceControlCodes.has(code))
      .every(({ evidenceSourceComponentIds }) => (
        evidenceSourceComponentIds?.length === 1 && evidenceSourceComponentIds[0] === programRepository.id
      )),
    true
  );
  assert.equal(
    obligations
      .filter((obligation) => obligation.recurrence.mode === "event")
      .every((obligation) => ["date", "timestamp"].includes(obligation.window?.precision) && Number.isInteger(obligation.window?.dueAfter)),
    true
  );
  const obligationsById = new Map(obligations.map((obligation) => [obligation.id, obligation]));
  assert.equal(obligations.every(({ status }) => status === "proposed"), true);
  assert.equal(
    obligations.every((obligation) => (
      obligation.policyIds.length === 1 && obligation.policyIds[0] === "policy-information-security"
    )),
    true
  );
  assert.deepEqual(obligationsById.get("obligation-monthly-endpoint-protection-verification").recurrence, {
    mode: "calendar",
    unit: "month",
    interval: 1,
    anchorDate: "2026-07-25"
  });
  assert.equal(obligationsById.get("obligation-monthly-endpoint-protection-verification").activityType, "endpoint-verification");
  assert.equal(obligationsById.get("obligation-quarterly-vulnerability-scan").recurrence.interval, 3);
  assert.equal(obligationsById.get("obligation-annual-penetration-test").recurrence.unit, "year");
  assert.equal(obligationsById.get("obligation-quarterly-log-review").recurrence.interval, 3);
  assert.equal(obligationsById.get("obligation-annual-backup-restoration-test").recurrence.unit, "year");
  assert.equal(obligationsById.get("obligation-annual-continuity-exercise").recurrence.unit, "year");
  const eventObligationCounts = obligations
    .filter((obligation) => obligation.recurrence.mode === "event")
    .reduce((counts, obligation) => {
      counts[obligation.recurrence.eventType] = (counts[obligation.recurrence.eventType] || 0) + 1;
      return counts;
    }, {});
  assert.equal(eventObligationCounts["person-started"], 4);
  assert.equal(eventObligationCounts["person-role-changed"], 1);
  assert.equal(eventObligationCounts["personal-device-access-planned"], 2);
  assert.equal(eventObligationCounts["vendor-reassessment-needed"], 2);
  assert.equal(eventObligationCounts["system-material-change"], 5);
  assert.equal(obligationsById.has("obligation-worker-start-role-training"), false);
  assert.equal(obligationsById.has("obligation-worker-role-change-training"), false);
  assert.equal(obligationsById.get("obligation-personal-device-approval").window.dueAfter, 0);
  assert.equal(obligationsById.get("obligation-personal-device-registration").window.dueAfter, 0);
  assert.equal(obligationsById.get("obligation-vendor-material-change-review").window.dueAfter, 30);
  assert.equal(obligationsById.get("obligation-vendor-material-change-records").window.dueAfter, 30);
  assert.deepEqual(obligationsById.get("obligation-system-change-retention").scopeResourceIds, ["document-data-retention-schedule"]);
  assert.equal(obligationsById.get("obligation-system-change-alert-path").activityType, "alert-path-test");
  assert.equal(obligationsById.get("obligation-system-change-alert-path").completionResourceTypes, undefined);
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
  assert.deepEqual(validation.counts, { resources: 163, errors: 0, warnings: 3 });
  assert.equal(
    validation.diagnostics.filter(({ code }) => code === "past-proposed-effective-date").length,
    3
  );
  const workflow = await assessWorkflow(target, { asOf: "2026-07-25" });
  const reviewerFinding = workflow.findings.find(({ code }) => (
    code === "governance.appointment.independent-policy-reviewer"
  ));
  assert.equal(reviewerFinding.subject.id, "appointment-independent-policy-reviewer");
  assert.equal(reviewerFinding.stage, "policies");
  assert.equal(
    workflow.findings.some(({ key }) => key === "program.policies.independent-reviewer"),
    false
  );
  assert.equal(
    workflow.findings.some(({ key }) => key === "program.scope.required-appointments"),
    false
  );
  assert.equal(
    workflow.findings.some(({ key }) => key === "record.appointment.appointment-independent-policy-reviewer.finalize"),
    false
  );
  assert.equal(
    workflow.findings.some(({ key }) => (
      key.startsWith("record.source-coverage.") && key.endsWith(".finalize")
    )),
    false
  );
  assert.equal(
    workflow.findings.some(({ key }) => (
      key.startsWith("record.control.") && (
        key.endsWith(".finalize") || key.endsWith(".field.applicabilityReview")
      )
    )),
    false
  );
  for (const requirement of requirementRecords) {
    assert.equal(
      workflow.findings.filter(({ subject }) => (
        subject?.type === "requirement" && subject.id === requirement.id
      )).length,
      0,
      requirement.id
    );
  }
  const programReadiness = await assessProgramReadiness(target, { asOf: "2026-07-25" });
  const recoveryPlanReadiness = programReadiness.stages
    .find(({ id }) => id === "controls")
    .items.find(({ id }) => id === "document-document-security-incident-recovery-plan");
  assert.equal(recoveryPlanReadiness.checks.systemContinuityObjectives, false);
  assert.deepEqual(recoveryPlanReadiness.continuityObjectiveSystemIds, []);
  assert.match(
    programReadiness.stages.find(({ id }) => id === "scope").items.find(({ id }) => id === "criteria").message,
    /42 criteria remain undetermined/
  );
  const complementaryReview = programReadiness.stages
    .find(({ id }) => id === "controls")
    .items.find(({ id }) => id === "collection-review-complementary-control");
  assert.equal(complementaryReview.status, "action");
  assert.equal(
    programReadiness.stages
      .find(({ id }) => id === "scope")
      .items.some(({ id }) => id === complementaryReview.id),
    false
  );
  assert.equal(
    workflow.findings.some(({ key }) => (
      key === "record.collection-review.collection-review-complementary-control.finalize"
    )),
    false
  );
  assert.deepEqual(
    await scaffoldCollectionReview(target, { resourceType: "complementary-control" }),
    {
      resourceType: "complementary-control",
      decision: "zero-population",
      rationale: null,
      reviewedByIds: [],
      reviewedOn: null,
      authoritativeComponentId: null
    }
  );
  const requiredAppointments = programReadiness.stages
    .find(({ id }) => id === "scope")
    .items.find(({ id }) => id === "required-appointments");
  assert.equal(
    requiredAppointments.commands.some((command) => (
      command === "npx filegrc get appointment-independent-policy-reviewer --mutation"
    )),
    true
  );
  assert.equal(
    requiredAppointments.commands.some((command) => /scaffold appointment/.test(command)),
    false
  );
  for (const familyId of filegrcSourceFamilyIds) {
    const sourceFinding = workflow.findings.find(({ key }) => (
      key === `program.controls.source-family-${familyId}`
    ));
    assert.equal(sourceFinding.state, "ready", familyId);
    assert.equal(
      sourceFinding.actions.some(({ command }) => /scaffold system/.test(command)),
      false,
      familyId
    );
    assert.equal(
      workflow.findings.find(({ key }) => key === `evidence-source.${familyId}.coverage`).state,
      "complete",
      familyId
    );
  }

  await writeFile(
    join(target, "data", "policies", "policy-information-security.json"),
    `${JSON.stringify({ ...informationSecurityPolicy, status: "approved" }, null, 2)}\n`,
    "utf8"
  );
  const prematureApproval = await validateWorkspace(target);
  assert.ok(prematureApproval.diagnostics.some(({ code, message }) => (
    code === "missing-field" && message.includes('"approverIds"')
  )));
});

test("creates a twelve-record foundation without selecting a framework", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "create-filegrc-foundation-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(parent, { recursive: true, force: true })));
  const target = join(parent, "program");
  const result = await createFilegrc({
    target,
    yes: true,
    starter: "foundation",
    filegrcVersion: "1.2.3",
    install: false
  });
  assert.equal(result.starter, "foundation");
  assert.deepEqual(result.stages, [
    { id: "foundation", status: "created", records: 12 },
    { id: "soc2-security", status: "skipped", records: 0 }
  ]);
  assert.deepEqual(result.resourceCounts, {
    total: 12,
    byType: {
      workspace: 1,
      "renderer-settings": 1,
      person: 1,
      appointment: 2,
      team: 1,
      program: 1,
      classification: 4,
      component: 1
    }
  });
  const workspace = JSON.parse(await readFile(join(target, "data", "workspace.json"), "utf8"));
  assert.equal(workspace.title, "Example Company GRC Program");
  assert.equal(workspace.frameworkIds, undefined);
  assert.equal(workspace.controlIds, undefined);
  const agents = await readFile(join(target, "AGENTS.md"), "utf8");
  assert.match(agents, /^# filegrc Workspace Instructions/m);
  assert.match(agents, /No framework or assurance program has been selected yet/);
  assert.match(agents, /does not include framework requirements, policies, governed documents/);
  assert.doesNotMatch(agents, /The generated workspace starts with the SOC 2 Security category/);
  assert.equal((await validateWorkspace(target)).ok, true);
  assert.equal(
    (await readdir(join(target, "data", "policies"))).some((name) => name.endsWith(".json")),
    false
  );
});

test("uses the selected program timezone for default starter dates", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "create-filegrc-timezone-date-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(parent, { recursive: true, force: true })));
  const target = join(parent, "program");
  const timezone = "Pacific/Honolulu";
  const expectedDates = new Set([
    localCalendarDate(timezone, new Date())
  ]);
  await createFilegrc({
    target,
    yes: true,
    timezone,
    filegrcVersion: "1.2.3",
    install: false
  });
  expectedDates.add(localCalendarDate(timezone, new Date()));
  const appointment = JSON.parse(await readFile(
    join(target, "data", "appointments", "appointment-policy-owner.json"),
    "utf8"
  ));
  const sourceCoverage = JSON.parse(await readFile(
    join(target, "data", "source-coverage", "source-coverage-training-acknowledgement.json"),
    "utf8"
  ));
  assert.equal(expectedDates.has(appointment.startsOn), true);
  assert.equal(expectedDates.has(sourceCoverage.validFrom), true);
});

test("preserves legal-name punctuation without generating doubled sentence punctuation", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "create-filegrc-punctuation-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(parent, { recursive: true, force: true })));
  const target = join(parent, "program");
  await createFilegrc({
    target,
    companyName: "Example Systems, Inc.",
    policyOwnerName: "Example Owner",
    policyOwnerJobTitle: "Chief Executive Officer",
    policyOwnerEmail: "owner@example.test",
    securityContactEmail: "security@example.test",
    timezone: "America/Chicago",
    filegrcVersion: "1.2.3",
    install: false
  });
  const workspace = JSON.parse(await readFile(join(target, "data", "workspace.json"), "utf8"));
  assert.equal(workspace.organizationName, "Example Systems, Inc.");
  for (const path of await collectTextFiles(target)) {
    assert.doesNotMatch(await readFile(path, "utf8"), /Example Systems, Inc\.\./, path);
  }
});

function localCalendarDate(timezone, date) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date).map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

test("writes an explicit local filegrc package dependency", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "create-filegrc-local-package-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(parent, { recursive: true, force: true })));
  const target = join(parent, "program");
  const localPackage = fileURLToPath(new URL("../../filegrc/", import.meta.url));
  const result = await createFilegrc({
    target,
    yes: true,
    filegrcPackage: localPackage,
    install: false
  });
  const packageJson = JSON.parse(await readFile(join(target, "package.json"), "utf8"));
  assert.equal(result.engineSource, "local");
  assert.equal(result.enginePackage, localPackage.replace(/\/$/, ""));
  assert.equal(packageJson.dependencies.filegrc, `file:${localPackage.replace(/\/$/, "")}`);
});

test("refuses a non-empty target by default", async (context) => {
  const target = await mkdtemp(join(tmpdir(), "create-filegrc-nonempty-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(target, { recursive: true, force: true })));
  await writeFile(join(target, "keep.txt"), "keep", "utf8");
  await assert.rejects(createFilegrc({
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
  await createFilegrc({
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
  await assert.rejects(createFilegrc({
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
  await assert.rejects(createFilegrc({
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
  await assert.rejects(createFilegrc({
    target,
    yes: true,
    force: true,
    filegrcVersion: "1.2.3",
    install: false
  }), /symbolic link/);
  assert.deepEqual(await readdir(outside), []);
  await assert.rejects(access(join(target, "README.md")), /ENOENT/);
});

test("rejects invalid identity, email, and timezone values before writing the target", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "create-filegrc-invalid-input-"));
  const target = join(parent, "security-program");
  const tokenTarget = join(parent, "token-program");
  const ownerEmailTarget = join(parent, "owner-email-program");
  const securityEmailTarget = join(parent, "security-email-program");
  const timezoneTarget = join(parent, "timezone-program");
  const branchTarget = join(parent, "branch-program");
  const remoteTarget = join(parent, "remote-program");
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(parent, { recursive: true, force: true })));
  await assert.rejects(createFilegrc({
    target,
    companyName: "Example Company\nInjected heading",
    policyOwnerName: "Example Owner",
    policyOwnerJobTitle: "Chief Executive Officer",
    securityContactEmail: "security@example.test",
    filegrcVersion: "1.2.3",
    install: false
  }), /single line/);
  await assert.rejects(access(target), /ENOENT/);
  await assert.rejects(createFilegrc({
    target: tokenTarget,
    companyName: "{{policy_owner_name}}",
    policyOwnerName: "Example Owner",
    policyOwnerJobTitle: "Chief Executive Officer",
    securityContactEmail: "security@example.test",
    filegrcVersion: "1.2.3",
    install: false
  }), /template token syntax/);
  await assert.rejects(access(tokenTarget), /ENOENT/);
  await assert.rejects(createFilegrc({
    target: ownerEmailTarget,
    companyName: "Example Company",
    policyOwnerName: "Example Owner",
    policyOwnerJobTitle: "Chief Executive Officer",
    policyOwnerEmail: "not-an-email",
    securityContactEmail: "security@example.test",
    timezone: "UTC",
    filegrcVersion: "1.2.3",
    install: false
  }), /Policy owner email must be a valid email address/);
  await assert.rejects(access(ownerEmailTarget), /ENOENT/);
  await assert.rejects(createFilegrc({
    target: securityEmailTarget,
    companyName: "Example Company",
    policyOwnerName: "Example Owner",
    policyOwnerJobTitle: "Chief Executive Officer",
    policyOwnerEmail: "owner@example.test",
    securityContactEmail: "not-an-email",
    timezone: "UTC",
    filegrcVersion: "1.2.3",
    install: false
  }), /Security contact email must be a valid email address/);
  await assert.rejects(access(securityEmailTarget), /ENOENT/);
  await assert.rejects(createFilegrc({
    target: timezoneTarget,
    companyName: "Example Company",
    policyOwnerName: "Example Owner",
    policyOwnerJobTitle: "Chief Executive Officer",
    policyOwnerEmail: "owner@example.test",
    securityContactEmail: "security@example.test",
    timezone: "Central Time",
    filegrcVersion: "1.2.3",
    install: false
  }), /Program timezone must be a valid IANA time zone/);
  await assert.rejects(access(timezoneTarget), /ENOENT/);
  await assert.rejects(createFilegrc({
    target: branchTarget,
    yes: true,
    filegrcVersion: "1.2.3",
    authoritativeBranch: "release/.hidden",
    install: false
  }), /authoritative branch must be a safe Git name/);
  await assert.rejects(access(branchTarget), /ENOENT/);
  await assert.rejects(createFilegrc({
    target: remoteTarget,
    yes: true,
    filegrcVersion: "1.2.3",
    repositoryRemote: "origin.lock",
    install: false
  }), /repository remote must be a safe Git name/);
  await assert.rejects(access(remoteTarget), /ENOENT/);
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
    "--policy-owner-job-title",
    "Chief Executive Officer",
    "--security-contact-email",
    "security@example.test",
    "--timezone",
    "America/Chicago",
    "--filegrc-version",
    "1.2.3",
    "--no-install"
  ], { encoding: "utf8" });
  assert.match(output, /filegrc 1\.2\.3: installation skipped/);
  assert.match(output, /Use a dedicated private repository for your FileGRC workspace/);
  assert.match(output, /Git: joined existing worktree/);
  assert.match(output, /This FileGRC workspace joined an existing Git repository/);
  assert.match(output, /FileGRC recommends a dedicated private repository because browser saves create/);
  assert.match(output, /Monorepo mode remains supported/);
  assert.match(output, /Timezone: America\/Chicago/);
  assert.match(output, /Program baseline: 163 records, including 42 requirements, 28 controls, and 51 obligations/);
  assert.match(output, /\n  npx filegrc setup\n/);
  assert.match(output, /Immediate human decisions:/);
  assert.match(output, /Select and confirm the assurance goal/);
  assert.match(output, /Appoint an independent reviewer who is separate from the policy owner/);
  assert.equal(
    JSON.parse(await readFile(join(target, "data", "people", "person-program-lead.json"), "utf8")).email,
    "security@example.test"
  );
  assert.equal(await access(join(target, ".git")).then(() => true, () => false), false);
});

test("warns when creation joins a detached Git worktree", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "create-filegrc-detached-"));
  const target = join(parent, "program");
  const manualTarget = join(parent, "manual-program");
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(parent, { recursive: true, force: true })));
  execFileSync("git", ["init"], { cwd: parent, stdio: "ignore" });
  execFileSync("git", [
    "-c",
    "user.name=Example Owner",
    "-c",
    "user.email=owner@example.test",
    "commit",
    "--allow-empty",
    "-m",
    "Initialize worktree"
  ], { cwd: parent, stdio: "ignore" });
  execFileSync("git", ["checkout", "--detach"], { cwd: parent, stdio: "ignore" });
  const output = execFileSync(process.execPath, [
    fileURLToPath(new URL("../bin/create-filegrc.js", import.meta.url)),
    target,
    "--company-name",
    "Example Company",
    "--policy-owner-name",
    "Example Owner",
    "--policy-owner-job-title",
    "Chief Executive Officer",
    "--security-contact-email",
    "security@example.test",
    "--timezone",
    "America/Chicago",
    "--filegrc-version",
    "1.2.3",
    "--no-install"
  ], { encoding: "utf8" });
  assert.match(output, /Git: joined existing worktree/);
  assert.match(output, /browser will open in read-only mode/);
  assert.match(output, /configured authoritative branch/);
  assert.match(output, /File creation and CLI validation still/);

  const manualOutput = execFileSync(process.execPath, [
    fileURLToPath(new URL("../bin/create-filegrc.js", import.meta.url)),
    manualTarget,
    "--company-name",
    "Example Company",
    "--policy-owner-name",
    "Example Owner",
    "--policy-owner-job-title",
    "Chief Executive Officer",
    "--security-contact-email",
    "security@example.test",
    "--timezone",
    "America/Chicago",
    "--filegrc-version",
    "1.2.3",
    "--repository-mode",
    "manual",
    "--no-install"
  ], { encoding: "utf8" });
  assert.match(manualOutput, /Git: joined existing worktree/);
  assert.doesNotMatch(manualOutput, /browser will open in read-only mode/);
});

test("documents legal organization, program lead, reporting address, and timezone options", () => {
  const output = execFileSync(process.execPath, [
    fileURLToPath(new URL("../bin/create-filegrc.js", import.meta.url)),
    "--help"
  ], { encoding: "utf8" });
  assert.match(output, /--company-name <legal-name>\s+Legal organization name/);
  assert.match(output, /--policy-owner-name <name>\s+Initial program lead/);
  assert.match(output, /--policy-owner-job-title <title>\s+Program lead's organization job title/);
  assert.match(output, /--policy-owner-email <email>\s+Policy owner's email address/);
  assert.match(output, /--security-contact-email <email>\s+Security reporting address/);
  assert.match(output, /--timezone <iana-timezone>\s+Program timezone/);
  assert.match(output, /--starter <profile>\s+security \(default\) or foundation/);
  assert.match(output, /--filegrc-package <directory>\s+Install an unpublished local filegrc package/);
  assert.match(output, /--repository-mode <mode>\s+trunk \(default\) or manual/);
  assert.match(output, /--authoritative-branch <name>\s+Browser write branch/);
  assert.match(output, /--repository-remote <name>\s+Browser sync remote/);
  assert.match(output, /--config <json-file\|->\s+Read creation and optional setup values/);
});

test("standalone CLI creation starts on main without a monorepo warning", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "create-filegrc-standalone-output-"));
  const target = join(parent, "program");
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(parent, { recursive: true, force: true })));
  const output = execFileSync(process.execPath, [
    fileURLToPath(new URL("../bin/create-filegrc.js", import.meta.url)),
    target,
    "--company-name",
    "Example Company",
    "--policy-owner-name",
    "Example Owner",
    "--policy-owner-job-title",
    "Chief Executive Officer",
    "--security-contact-email",
    "security@example.test",
    "--timezone",
    "UTC",
    "--filegrc-version",
    "1.2.3",
    "--no-install"
  ], { encoding: "utf8" });
  assert.match(output, /Git: initialized new repository/);
  assert.match(output, /Use a dedicated private repository for your FileGRC workspace/);
  assert.doesNotMatch(output, /joined an existing Git repository/);
  assert.doesNotMatch(output, /Monorepo mode remains supported/);
  assert.equal(execFileSync("git", ["branch", "--show-current"], { cwd: target, encoding: "utf8" }).trim(), "main");
});

test("creates and configures a service from one JSON config", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "create-filegrc-config-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(parent, { recursive: true, force: true })));
  const target = join(parent, "program");
  const configPath = join(parent, "setup.json");
  const localPackage = fileURLToPath(new URL("../../filegrc/", import.meta.url));
  await writeFile(configPath, `${JSON.stringify({
    companyName: "Example Company",
    policyOwnerName: "Example Owner",
    policyOwnerJobTitle: "Chief Executive Officer",
    policyOwnerEmail: "owner@example.test",
    securityContactEmail: "security@example.test",
    timezone: "America/Chicago",
    starter: "security",
    filegrcPackage: localPackage,
    setup: {
      serviceName: "Example Service",
      boundary: "The production service and supporting infrastructure.",
      criticality: "high",
      classificationId: "confidential",
      internetExposed: true,
      programGoal: "type-2"
    }
  }, null, 2)}\n`, "utf8");
  const output = execFileSync(process.execPath, [
    fileURLToPath(new URL("../bin/create-filegrc.js", import.meta.url)),
    target,
    "--config",
    configPath
  ], { encoding: "utf8" });
  assert.match(output, /Stage foundation: created \(12 records\)/);
  assert.match(output, /Stage soc2-security: created \(151 records\)/);
  assert.match(output, /Service setup: system-example-service \(active\), target soc-2-type-2/);
  assert.match(output, /npx filegrc program-path --next --json/);
  assert.match(output, /Confirm the selected assurance goal with management: SOC 2 Type 2/);
  const validation = await validateWorkspace(target);
  assert.deepEqual(validation.counts, { resources: 165, errors: 0, warnings: 0 });
  const workspace = JSON.parse(await readFile(join(target, "data", "workspace.json"), "utf8"));
  assert.equal(workspace.systemIds, undefined);
  const program = JSON.parse(await readFile(join(target, "data", "programs", "program-soc-2.json"), "utf8"));
  assert.deepEqual(program.systemIds, ["system-example-service"]);
  const control = JSON.parse(await readFile(join(target, "data", "controls", "control-security-governance.json"), "utf8"));
  assert.equal(control.systemIds, undefined);
  const commitment = JSON.parse(await readFile(
    join(target, "data", "commitments", "commitment-example-service-service-commitment.json"),
    "utf8"
  ));
  assert.equal(commitment.status, "planned");
  assert.deepEqual(commitment.systemIds, ["system-example-service"]);
  assert.match(commitment.statement, /Replace this starter/);
  const evidenceFiles = (await readdir(join(target, "data", "evidence"))).filter((name) => name.endsWith(".json"));
  assert.deepEqual(evidenceFiles, []);
});

async function collectTextFiles(directory) {
  const result = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) result.push(...await collectTextFiles(path));
    else if (item.isFile() && ["", ".json", ".md", ".txt", ".yml", ".yaml"].includes(item.name.includes(".") ? `.${item.name.split(".").at(-1)}` : "")) {
      result.push(path);
    }
  }
  return result;
}
