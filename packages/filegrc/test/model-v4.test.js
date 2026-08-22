import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { planApplicabilityReview, scaffoldApplicabilityReview } from "../src/batch-review.js";
import { buildAgentGuide } from "../src/agent.js";
import { applyCollectionReview, assessCollectionReview } from "../src/collection-review.js";
import { collectionRevision, legacyCollectionRevision } from "../src/collection-revision.js";
import { createResource, updateContent, updateResource } from "../src/files.js";
import { assessAuditPreparation, signedRepresentationDateIssue } from "../src/audit-preparation.js";
import { prepareEvidencePacket } from "../src/evidence-packet.js";
import { assessProgramReadiness } from "../src/program-readiness.js";
import { resolveProgram } from "../src/program.js";
import { markdownEntries } from "../src/resource-markdown.js";
import {
  appointmentWasAuthorizedOn,
  auditorWasEngaged,
  personWasActiveOn,
  recordWasInUseDuringAudit,
  REQUIRED_SOC2_SECURITY_REFERENCES,
  signatoryAppointmentIssue,
  soc2ReportEvidenceIssue,
  subsequentEventsReviewIssue
} from "../src/soc2.js";
import { assessWorkflow } from "../src/workflow.js";
import { loadWorkspace } from "../src/workspace.js";
import { validateWorkspace } from "../src/validate.js";
import { makeComprehensiveWorkspace } from "./fixtures.js";
import { writeJson } from "./helpers.js";

test("treats undetermined Program applicability entries as pending review", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-model-v4-applicability-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "4");
  const loaded = await loadWorkspace(root);
  assert.equal(loaded.model.evidenceSourceFamilies.some(({ title }) => /Systems?$/.test(title)), false);
  assert.equal(loaded.model.evidenceSourceFamilies.some(({ description }) => /Catalog (?:the )?.*systems?\b/i.test(description)), false);
  const program = loaded.resources.find(({ type }) => type === "program");
  const requirement = loaded.resources.find(({ type }) => type === "requirement");
  await updateResource(root, "requirement", requirement.id, {
    ...requirement,
    reference: "CC6.1"
  });
  await updateResource(root, "program", program.id, {
    ...program,
    assuranceGoal: "soc-2-type-2",
    requirementApplicability: [{ requirementId: requirement.id, decision: "undetermined" }]
  });

  const scaffold = await scaffoldApplicabilityReview(root, { type: "requirement" });
  assert.equal(scaffold.decisions.length, 1);
  assert.equal(scaffold.decisions[0].id, requirement.id);
  assert.equal(scaffold.decisions[0].decision, "applicable");
  assert.match(scaffold.decisions[0].rationale, /required Security Common Criteria baseline/);
  assert.deepEqual(scaffold.decisions[0].constraint.allowedDecisions, ["applicable"]);
  const pendingWorkflow = await assessWorkflow(root);
  const criteriaFinding = pendingWorkflow.findings.find(({ key }) => key.endsWith(".period.criteria"));
  assert.ok(criteriaFinding.actions.some(({ command }) => command.includes("review-applicability --scaffold --type requirement")));
  await assert.rejects(planApplicabilityReview(root, {
    reviewedByIds: ["person-example"],
    reviewedOn: "2026-08-14",
    decisions: [{
      id: requirement.id,
      decision: "not-applicable",
      rationale: "Management proposed excluding this criterion."
    }]
  }), /must be applicable because it is required/);
  const preview = await planApplicabilityReview(root, {
    reviewedByIds: ["person-example"],
    reviewedOn: "2026-08-14",
    decisions: [{
      id: requirement.id,
      decision: "applicable",
      rationale: "The criterion applies to the selected Program scope."
    }]
  });
  assert.deepEqual(preview.reviewedIds, [requirement.id]);
  assert.deepEqual(preview.changes.update.map(({ id }) => id), [program.id]);
  const guide = buildAgentGuide(await loadWorkspace(root), "program");
  assert.match(guide.workflow.join("\n"), /review-applicability --type requirement --scaffold/);
  assert.match(guide.completionChecks.join("\n"), /Every selected Requirement has an applicable or not-applicable decision/);

  const current = await loadWorkspace(root);
  const programEntry = current.entries.find(({ record }) => record.id === program.id);
  const decision = programEntry.record.requirementApplicability[0];
  await writeJson(programEntry.path, {
    ...programEntry.record,
    requirementApplicability: [decision, { ...decision, decision: "not-applicable" }]
  });
  const validation = await validateWorkspace(root);
  assert.ok(validation.diagnostics.some(({ code }) => code === "duplicate-program-applicability"));
});

test("requires the actual v4 management-representation signing date", () => {
  const audit = {
    auditKind: "soc-2-type-2",
    coverage: { kind: "range", startsOn: "2026-01-01", endsOn: "2026-06-30" },
    reportDate: "2026-07-15"
  };
  assert.match(signedRepresentationDateIssue({ collectedOn: "2026-07-15" }, audit, "4"), /businessEventAt/);
  assert.match(signedRepresentationDateIssue({ businessEventAt: "2026-06-29T12:00:00Z" }, audit, "4"), /dated 2026-06-29/);
  assert.match(signedRepresentationDateIssue({ businessEventAt: "2026-07-14T12:00:00Z" }, audit, "4"), /report date, 2026-07-15/);
  assert.equal(signedRepresentationDateIssue({ businessEventAt: "2026-07-15T12:00:00Z" }, audit, "4"), null);
  assert.equal(signedRepresentationDateIssue({ collectedOn: "2026-07-15" }, audit, "2"), null);
});

test("binds issued SOC 2 report Evidence to the recorded report and opinion dates", () => {
  const audit = {
    id: "audit-example",
    title: "SOC 2 Type 2 examination",
    reportDate: "2027-01-31",
    opinionDate: "2027-01-31"
  };
  const evidence = {
    id: "evidence-issued-report",
    type: "evidence",
    title: "Issued SOC 2 report",
    status: "verified",
    artifactKind: "third-party-report",
    artifactSubtype: "soc2-report"
  };

  assert.equal(soc2ReportEvidenceIssue({ ...evidence, artifactSubtype: "other" }, audit).code, "invalid-audit-report-evidence");
  assert.equal(soc2ReportEvidenceIssue(evidence, audit).code, "audit-report-date-missing");
  assert.equal(soc2ReportEvidenceIssue({ ...evidence, sourceGeneratedAt: "2027-01-30T12:00:00Z" }, audit).code, "audit-report-date-mismatch");
  assert.equal(soc2ReportEvidenceIssue(
    { ...evidence, sourceGeneratedAt: "2027-01-31T12:00:00Z" },
    { ...audit, opinionDate: "2027-01-30" }
  ).code, "audit-opinion-date-mismatch");
  assert.equal(soc2ReportEvidenceIssue({ ...evidence, sourceGeneratedAt: "2027-01-31T12:00:00Z" }, audit), null);
});

test("requires a complete subsequent-events review through the CPA report date", () => {
  const audit = {
    reportDate: "2027-01-31",
    fieldworkEnd: "2027-01-15",
    coverage: { kind: "range", startsOn: "2026-01-01", endsOn: "2026-12-31" }
  };
  assert.equal(subsequentEventsReviewIssue(audit).code, "subsequent-events-review-missing");
  assert.equal(subsequentEventsReviewIssue({
    ...audit,
    subsequentEventsReview: { reviewedByIds: [], reviewedOn: "2027-01-31", throughOn: "2027-01-31", conclusion: "" }
  }).code, "subsequent-events-review-incomplete");
  assert.equal(subsequentEventsReviewIssue({
    ...audit,
    subsequentEventsReview: { reviewedByIds: ["person-example"], reviewedOn: "2027-01-30", throughOn: "2027-01-30", conclusion: "No material events." }
  }).code, "subsequent-events-period-incomplete");
  assert.equal(subsequentEventsReviewIssue({
    ...audit,
    subsequentEventsReview: { reviewedByIds: ["person-example"], reviewedOn: "2027-01-30", throughOn: "2027-01-31", conclusion: "No material events." }
  }).code, "subsequent-events-review-date-invalid");
  assert.equal(subsequentEventsReviewIssue({
    ...audit,
    subsequentEventsReview: { reviewedByIds: ["person-example"], reviewedOn: "2027-01-31", throughOn: "2027-01-31", conclusion: "No material events." }
  }), null);
});

test("evaluates engagement participants and authority on the relevant historical dates", () => {
  const person = {
    id: "person-signer",
    type: "person",
    status: "inactive",
    startDate: "2025-01-01",
    endDate: "2027-02-01",
    statusTransition: { changedOn: "2027-02-01" }
  };
  const appointment = {
    id: "appointment-signer",
    type: "appointment",
    status: "ended",
    holderId: person.id,
    scopeResourceIds: ["workspace"],
    startsOn: "2026-01-01",
    endsOn: "2027-02-01"
  };
  const byId = new Map([[person.id, person], [appointment.id, appointment]]);
  assert.equal(personWasActiveOn(person, "2027-01-31"), true);
  assert.equal(personWasActiveOn(person, "2027-02-02"), false);
  assert.equal(appointmentWasAuthorizedOn(appointment, "2027-01-31", byId), true);
  assert.equal(appointmentWasAuthorizedOn(appointment, "2027-02-02", byId), false);
  assert.equal(signatoryAppointmentIssue({
    id: "audit-example",
    programId: "program-example",
    reportDate: "2027-01-31",
    signatoryAppointmentIds: [appointment.id]
  }, byId), null);

  const vendor = {
    type: "vendor",
    status: "active",
    startDate: "2026-07-01"
  };
  assert.equal(recordWasInUseDuringAudit(vendor, "2026-01-01", "2026-06-30"), false);
  assert.equal(recordWasInUseDuringAudit(vendor, "2026-07-01", "2026-12-31"), true);
  assert.equal(recordWasInUseDuringAudit({
    ...vendor,
    status: "terminated",
    startDate: "2025-01-01",
    endDate: "2025-12-31"
  }, "2026-01-01", "2026-06-30"), false);
  assert.equal(recordWasInUseDuringAudit({
    ...vendor,
    status: "terminated",
    startDate: "2025-01-01",
    endDate: "2026-07-15"
  }, "2026-01-01", "2026-06-30"), true);
  assert.equal(auditorWasEngaged({
    type: "vendor",
    status: "active",
    startDate: "2026-07-01"
  }, {
    coverage: { kind: "range", startsOn: "2026-01-01", endsOn: "2026-06-30" },
    fieldworkStart: "2026-07-01",
    fieldworkEnd: "2026-07-31"
  }), true);
  assert.equal(auditorWasEngaged({
    type: "vendor",
    status: "active",
    startDate: "2026-07-02"
  }, {
    coverage: { kind: "range", startsOn: "2026-01-01", endsOn: "2026-06-30" },
    fieldworkStart: "2026-07-01",
    fieldworkEnd: "2026-07-31"
  }), false);
});

test("requires every applicable Program criterion to have a selected Control mapping", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-model-v4-control-coverage-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "4");

  const initial = await loadWorkspace(root);
  const initialControl = initial.resources.find(({ type }) => type === "control");
  const initialProgram = initial.resources.find(({ type }) => type === "program");
  await createResource(root, {
    id: "requirement-other",
    type: "requirement",
    title: "Criterion outside the selected Program",
    frameworkId: "framework-example",
    reference: "A1.1"
  });
  await updateResource(root, "program", initialProgram.id, {
    ...initialProgram,
    requirementApplicability: [
      ...initialProgram.requirementApplicability,
      {
        requirementId: "requirement-other",
        decision: "not-applicable",
        rationale: "The optional availability category is not selected for this Program.",
        reviewedByIds: ["person-example"],
        reviewedOn: "2026-06-30",
        scopeRevision: "example-scope-revision"
      }
    ]
  });
  await updateResource(root, "control", initialControl.id, {
    ...initialControl,
    requirementIds: ["requirement-other"]
  });

  const readiness = await assessProgramReadiness(root);
  const criteria = readiness.stages
    .find(({ id }) => id === "scope")
    .items.find(({ id }) => id === "criteria");
  assert.equal(criteria.status, "action");
  assert.deepEqual(criteria.uncoveredRequirementIds, ["requirement-example"]);
  assert.match(criteria.message, /1 selected applicable Trust Services criteria have no selected Control/);

  const loaded = await loadWorkspace(root);
  const control = loaded.resources.find(({ type }) => type === "control");
  await updateResource(root, "control", control.id, {
    ...control,
    requirementIds: ["requirement-example"]
  });
  const covered = await assessProgramReadiness(root);
  const coveredCriteria = covered.stages
    .find(({ id }) => id === "scope")
    .items.find(({ id }) => id === "criteria");
  assert.equal(coveredCriteria.uncoveredRequirementIds.length, 0);
});

test("requires the complete DC1 through DC9 Description Criteria set for a v4 SOC 2 audit", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-model-v4-description-set-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "4");
  const loaded = await loadWorkspace(root);
  const audit = loaded.resources.find(({ type }) => type === "audit");
  const control = loaded.resources.find(({ type }) => type === "control");
  const program = loaded.resources.find(({ type }) => type === "program");
  await createResource(root, {
    id: "requirement-description-only-dc1",
    type: "requirement",
    title: "Description criterion DC1",
    frameworkId: "framework-example",
    reference: "DC1",
    tags: ["description-criteria"]
  });
  await updateResource(root, "program", program.id, {
    ...program,
    requirementApplicability: [
      ...program.requirementApplicability,
      {
        requirementId: "requirement-description-only-dc1",
        decision: "applicable",
        rationale: "The Description Criteria apply to the report.",
        reviewedByIds: ["person-example"],
        reviewedOn: "2026-06-30",
        scopeRevision: "example-scope-revision"
      }
    ]
  });
  await updateResource(root, "control", control.id, {
    ...control,
    requirementIds: ["requirement-example"]
  });
  await updateResource(root, "audit", audit.id, {
    ...audit,
    requirementIds: ["requirement-example", "requirement-description-only-dc1"],
    scopeRevision: "example-scope-revision"
  });

  const readiness = await assessAuditPreparation(root, { auditId: audit.id });
  const criteria = readiness.stages
    .find(({ id }) => id === "period")
    .items.find(({ id }) => id === "criteria");
  assert.equal(criteria.status, "action");
  assert.match(criteria.message, /DC2, DC3, DC4, DC5, DC6, DC7, DC8, DC9/);
  const packet = await prepareEvidencePacket(root, { auditId: audit.id });
  assert.equal(packet.gaps.some(({ code, message }) => (
    code === "audit-description-criteria-incomplete" && /DC2, DC3, DC4, DC5, DC6, DC7, DC8, DC9/.test(message)
  )), true);
});

test("requires the complete CC1.1 through CC9.2 Security Common Criteria set for a v4 SOC 2 audit", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-model-v4-security-set-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "4");
  const loaded = await loadWorkspace(root);
  const audit = loaded.resources.find(({ type }) => type === "audit");
  const control = loaded.resources.find(({ type }) => type === "control");
  const program = loaded.resources.find(({ type }) => type === "program");
  const descriptionRequirementIds = [];
  for (let index = 1; index <= 9; index += 1) {
    const id = `requirement-security-set-dc${index}`;
    descriptionRequirementIds.push(id);
    await createResource(root, {
      id,
      type: "requirement",
      title: `Description criterion DC${index}`,
      frameworkId: "framework-example",
      reference: `DC${index}`,
      tags: ["description-criteria"]
    });
  }
  await updateResource(root, "program", program.id, {
    ...program,
    requirementApplicability: [
      ...program.requirementApplicability,
      ...descriptionRequirementIds.map((requirementId) => ({
        requirementId,
        decision: "applicable",
        rationale: "The Description Criteria apply to the report.",
        reviewedByIds: ["person-example"],
        reviewedOn: "2026-06-30",
        scopeRevision: "example-scope-revision"
      }))
    ]
  });
  await updateResource(root, "control", control.id, {
    ...control,
    requirementIds: ["requirement-example"]
  });
  await updateResource(root, "audit", audit.id, {
    ...audit,
    requirementIds: ["requirement-example", ...descriptionRequirementIds],
    scopeRevision: "example-scope-revision"
  });

  const readiness = await assessAuditPreparation(root, { auditId: audit.id });
  const criteria = readiness.stages
    .find(({ id }) => id === "period")
    .items.find(({ id }) => id === "criteria");
  assert.equal(criteria.status, "action");
  assert.match(criteria.message, /CC1\.1, CC1\.2/);
  assert.match(criteria.message, /CC9\.2/);
  const packet = await prepareEvidencePacket(root, { auditId: audit.id });
  assert.equal(packet.gaps.some(({ code, message }) => (
    code === "audit-security-criteria-incomplete" && /CC1\.1, CC1\.2/.test(message) && /CC9\.2/.test(message)
  )), true);
});

test("requires the Program goal to match the formal SOC 2 engagement type", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-model-v4-audit-goal-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "4");
  const loaded = await loadWorkspace(root);
  const audit = loaded.resources.find(({ type }) => type === "audit");
  const program = loaded.resources.find(({ type }) => type === "program");
  await updateResource(root, "program", program.id, {
    ...program,
    assuranceGoal: "soc-2-type-1"
  });
  await updateResource(root, "audit", audit.id, {
    ...audit,
    auditKind: "soc-2-type-2",
    coverage: { kind: "range", startsOn: "2026-01-01", endsOn: "2026-06-30" }
  });

  const readiness = await assessAuditPreparation(root, { auditId: audit.id });
  const alignment = readiness.stages
    .find(({ id }) => id === "engagement")
    .items.find(({ id }) => id === "program-goal-alignment");
  assert.equal(alignment.status, "action");
  assert.match(alignment.message, /Change the Program goal from SOC 2 Type 1 to SOC 2 Type 2/);
  const packet = await prepareEvidencePacket(root, { auditId: audit.id });
  assert.equal(packet.gaps.some(({ code }) => code === "audit-program-goal-mismatch"), true);
});

test("uses v4 System fields, Program applicability, and explicit subservice conclusions in audit scope", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-model-v4-audit-scope-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "4");
  const loaded = await loadWorkspace(root);
  const audit = loaded.resources.find(({ type }) => type === "audit");
  const control = loaded.resources.find(({ type }) => type === "control");
  const program = loaded.resources.find(({ type }) => type === "program");
  const securityRequirementIds = ["requirement-example"];
  for (const reference of REQUIRED_SOC2_SECURITY_REFERENCES.filter((value) => value !== "CC6.1")) {
    const id = `requirement-security-${reference.toLowerCase().replace(".", "-")}`;
    securityRequirementIds.push(id);
    await createResource(root, {
      id,
      type: "requirement",
      title: `Security criterion ${reference}`,
      frameworkId: "framework-example",
      reference,
      tags: ["security", "common-criteria"]
    });
  }
  const descriptionRequirementIds = [];
  for (let index = 1; index <= 9; index += 1) {
    const id = `requirement-description-dc${index}`;
    descriptionRequirementIds.push(id);
    await createResource(root, {
      id,
      type: "requirement",
      title: `Description criterion DC${index}`,
      frameworkId: "framework-example",
      reference: `DC${index}`
    });
  }
  await createResource(root, {
    id: "requirement-optional-a1-1",
    type: "requirement",
    title: "Optional Availability criterion A1.1",
    frameworkId: "framework-example",
    reference: "A1.1",
    tags: ["security"]
  });
  await updateResource(root, "program", program.id, {
    ...program,
    assuranceGoal: "soc-2-type-2",
    requirementApplicability: [
      ...program.requirementApplicability,
      ...securityRequirementIds.slice(1).map((requirementId) => ({
        requirementId,
        decision: "applicable",
        rationale: "Every Security Common Criterion remains in scope for the SOC 2 Program.",
        reviewedByIds: ["person-example"],
        reviewedOn: "2026-06-30",
        scopeRevision: "example-scope-revision"
      })),
      ...descriptionRequirementIds.map((requirementId, index) => ({
        requirementId,
        decision: index === 1 ? "not-applicable" : "applicable",
        rationale: index === 1
          ? "This deliberately exercises the audit guard against omitting a Description Criterion."
          : "The system description criteria apply to the SOC 2 report.",
        reviewedByIds: ["person-example"],
        reviewedOn: "2026-06-30",
        scopeRevision: "example-scope-revision"
      })),
      {
        requirementId: "requirement-optional-a1-1",
        decision: "not-applicable",
        rationale: "The optional Availability category is not included in this engagement.",
        reviewedByIds: ["person-example"],
        reviewedOn: "2026-06-30",
        scopeRevision: "example-scope-revision"
      }
    ]
  });
  await updateResource(root, "control", control.id, {
    ...control,
    requirementIds: securityRequirementIds
  });
  await updateResource(root, "audit", audit.id, {
    ...audit,
    auditKind: "soc-2-type-2",
    coverage: { kind: "range", startsOn: "2026-01-01", endsOn: "2026-06-30" },
    requirementIds: [
      "requirement-example",
      ...descriptionRequirementIds.filter((id) => id !== "requirement-description-dc2")
    ]
  });

  const before = await assessAuditPreparation(root, { auditId: audit.id });
  const engagementBefore = before.stages.find(({ id }) => id === "engagement");
  assert.equal(engagementBefore.items.find(({ id }) => id === "program-goal-alignment").status, "complete");
  assert.equal(engagementBefore.items.find(({ id }) => id === "engagement-terms").status, "action");
  assert.equal(engagementBefore.items.find(({ id }) => id === "management-acknowledgement").status, "action");
  const scopeBefore = before.stages.find(({ id }) => id === "period");
  assert.equal(scopeBefore.items.find(({ id }) => id === "systems").status, "complete");
  assert.equal(scopeBefore.items.find(({ id }) => id === "scope-revision").status, "action");
  assert.equal(scopeBefore.items.find(({ id }) => id === "criteria").status, "action");
  assert.match(scopeBefore.items.find(({ id }) => id === "criteria").message, /Mark all nine Description Criteria applicable/);
  assert.equal(scopeBefore.items.find(({ id }) => id === "subservices").status, "action");
  const programBefore = await assessProgramReadiness(root);
  const programCriteriaBefore = programBefore.stages
    .find(({ id }) => id === "scope")
    .items.find(({ id }) => id === "criteria");
  assert.equal(programCriteriaBefore.status, "action");
  assert.deepEqual(programCriteriaBefore.invalidMandatoryRequirementIds, ["requirement-description-dc2"]);
  const packetBefore = await prepareEvidencePacket(root, { auditId: audit.id });
  assert.equal(packetBefore.gaps.some(({ code }) => code === "audit-description-criteria-incomplete"), true);
  assert.equal(packetBefore.gaps.some(({ code }) => code === "audit-security-criteria-incomplete"), true);
  assert.equal(packetBefore.gaps.some(({ code }) => code === "audit-scope-revision-missing"), true);

  const current = await loadWorkspace(root);
  const currentAudit = current.resources.find(({ id }) => id === audit.id);
  const currentProgram = current.resources.find(({ id }) => id === program.id);
  const engagementTermsDocument = current.resources.find(({ id }) => id === "document-example");
  await updateResource(root, "audit", audit.id, {
    ...currentAudit,
    engagementTermsDocumentId: engagementTermsDocument.id,
    managementAcknowledgedByIds: ["person-example"],
    managementAcknowledgedOn: "2026-06-30"
  });
  const wrongEngagementDocument = await assessAuditPreparation(root, { auditId: audit.id });
  const wrongEngagementItems = wrongEngagementDocument.stages.find(({ id }) => id === "engagement").items;
  assert.equal(wrongEngagementItems.find(({ id }) => id === "engagement-terms").status, "action");
  assert.equal(wrongEngagementItems.find(({ id }) => id === "management-acknowledgement").status, "action");
  await updateResource(root, "document", engagementTermsDocument.id, {
    ...engagementTermsDocument,
    documentKind: "soc2-engagement-terms",
    approvedOn: "2026-06-14",
    effectiveOn: "2026-06-14"
  });
  const lateAcknowledgement = await assessAuditPreparation(root, { auditId: audit.id });
  assert.equal(
    lateAcknowledgement.stages.find(({ id }) => id === "engagement").items
      .find(({ id }) => id === "management-acknowledgement").status,
    "action"
  );
  await updateResource(root, "program", program.id, {
    ...currentProgram,
    requirementApplicability: currentProgram.requirementApplicability.map((decision) => (
      decision.requirementId === "requirement-description-dc2"
        ? { ...decision, decision: "applicable", rationale: "Every Description Criterion applies to the system description." }
        : decision
    ))
  });
  await updateResource(root, "audit", audit.id, {
    ...currentAudit,
    requirementIds: [...securityRequirementIds, ...descriptionRequirementIds],
    engagementTermsDocumentId: "document-example",
    managementAcknowledgedByIds: ["person-example"],
    managementAcknowledgedOn: "2026-06-14",
    scopeRevision: "pending-review-commit",
    subserviceConclusion: "not-applicable",
    subserviceConclusionRationale: "No Vendor supplies a Component within the selected report boundary."
  });
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.test"], { cwd: root });
  execFileSync("git", ["add", "data"], { cwd: root });
  execFileSync("git", ["commit", "-m", "Review audit scope"], { cwd: root });
  const scopeRevision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const committedScope = (await loadWorkspace(root)).resources.find(({ id }) => id === audit.id);
  await updateResource(root, "audit", audit.id, {
    ...committedScope,
    scopeRevision
  });
  const after = await assessAuditPreparation(root, { auditId: audit.id });
  const engagementAfter = after.stages.find(({ id }) => id === "engagement");
  assert.equal(engagementAfter.items.find(({ id }) => id === "engagement-terms").status, "complete");
  assert.equal(engagementAfter.items.find(({ id }) => id === "management-acknowledgement").status, "complete");
  assert.equal(after.stages
    .find(({ id }) => id === "period")
    .items.find(({ id }) => id === "criteria").status, "complete");
  assert.equal(after.stages
    .find(({ id }) => id === "period")
    .items.find(({ id }) => id === "scope-revision").status, "complete");
  const packetAfter = await prepareEvidencePacket(root, { auditId: audit.id });
  assert.equal(packetAfter.gaps.some(({ code }) => code === "audit-description-criteria-incomplete"), false);
  assert.equal(packetAfter.gaps.some(({ code }) => code === "audit-security-criteria-incomplete"), false);
  assert.equal(packetAfter.gaps.some(({ code }) => code === "audit-scope-revision-missing"), false);
  const subservices = after.stages
    .find(({ id }) => id === "period")
    .items.find(({ id }) => id === "subservices");
  assert.equal(subservices.status, "complete");

  const reviewedAudit = (await loadWorkspace(root)).resources.find(({ id }) => id === audit.id);
  await updateResource(root, "audit", audit.id, {
    ...reviewedAudit,
    scope: "Changed after the recorded management review."
  });
  const staleScope = await assessAuditPreparation(root, { auditId: audit.id });
  const staleScopeRevision = staleScope.stages
    .find(({ id }) => id === "period")
    .items.find(({ id }) => id === "scope-revision");
  assert.equal(staleScopeRevision.status, "action");
  assert.match(staleScopeRevision.message, /differs from the scope stored at scopeRevision/);
  const changedAudit = (await loadWorkspace(root)).resources.find(({ id }) => id === audit.id);
  await updateResource(root, "audit", audit.id, {
    ...changedAudit,
    scope: reviewedAudit.scope
  });

  const beforeLinkedScopeChange = await loadWorkspace(root);
  const reviewedControl = beforeLinkedScopeChange.resources.find(({ id }) => id === control.id);
  await updateResource(root, "control", control.id, {
    ...reviewedControl,
    title: "Changed after the recorded management scope review"
  });
  const staleLinkedScope = await assessAuditPreparation(root, { auditId: audit.id });
  const staleLinkedScopeRevision = staleLinkedScope.stages
    .find(({ id }) => id === "period")
    .items.find(({ id }) => id === "scope-revision");
  assert.equal(staleLinkedScopeRevision.status, "action");
  assert.match(staleLinkedScopeRevision.message, /record within the reviewed engagement scope changed/);
  const changedControl = (await loadWorkspace(root)).resources.find(({ id }) => id === control.id);
  await updateResource(root, "control", control.id, {
    ...changedControl,
    title: reviewedControl.title
  });

  const beforeUnrelatedChange = await loadWorkspace(root);
  const unrelatedRisk = beforeUnrelatedChange.resources.find(({ type }) => type === "risk");
  await updateResource(root, "risk", unrelatedRisk.id, {
    ...unrelatedRisk,
    title: "An operating risk update outside the engagement scope review"
  });
  const unchangedScope = await assessAuditPreparation(root, { auditId: audit.id });
  assert.equal(unchangedScope.stages
    .find(({ id }) => id === "period")
    .items.find(({ id }) => id === "scope-revision").status, "complete");

  const beforeReport = await loadWorkspace(root);
  const auditBeforeReport = beforeReport.resources.find(({ id }) => id === audit.id);
  await updateResource(root, "audit", audit.id, {
    ...auditBeforeReport,
    status: "issued",
    reportDate: "2027-01-31",
    opinion: "unmodified",
    opinionDate: "2027-01-31",
    reportEvidenceId: "evidence-example"
  });
  const wrongReportPacket = await prepareEvidencePacket(root, { auditId: audit.id });
  assert.equal(wrongReportPacket.gaps.some(({ code }) => code === "invalid-audit-report-evidence"), true);
  assert.equal(wrongReportPacket.gaps.some(({ code }) => code === "signatory-authority-missing"), true);

  await createResource(root, {
    id: "person-historical-signer",
    type: "person",
    title: "Historical management signer",
    status: "inactive",
    affiliation: "internal",
    startDate: "2025-01-01",
    endDate: "2027-02-01",
    statusTransition: {
      changedByIds: ["person-example"],
      changedOn: "2027-02-01",
      reason: "The signer left after the report was issued."
    }
  });
  await createResource(root, {
    id: "appointment-historical-signer",
    type: "appointment",
    title: "Management assertion signer",
    status: "ended",
    appointmentKind: "management-assertion-signer",
    holderId: "person-historical-signer",
    scopeResourceIds: ["workspace"],
    startsOn: "2026-01-01",
    endsOn: "2027-02-01",
    responsibilities: "Authorize and sign management's SOC 2 assertion and written representations.",
    statusTransition: {
      changedByIds: ["person-example"],
      changedOn: "2027-02-01",
      reason: "The authority ended when the holder left."
    }
  });
  const withoutSignatory = await loadWorkspace(root);
  const auditWithoutSignatory = withoutSignatory.resources.find(({ id }) => id === audit.id);
  await updateResource(root, "audit", audit.id, {
    ...auditWithoutSignatory,
    signatoryAppointmentIds: ["appointment-historical-signer"]
  });
  const withHistoricalSignatory = await prepareEvidencePacket(root, { auditId: audit.id });
  assert.equal(withHistoricalSignatory.gaps.some(({ code }) => code.startsWith("signatory-authority-")), false);
  const historicalAuthorityPreparation = await assessAuditPreparation(root, { auditId: audit.id });
  assert.equal(historicalAuthorityPreparation.stages
    .find(({ id }) => id === "auditor")
    .items.find(({ id }) => id === "signatory-authority").status, "complete");

  await mkdir(join(root, "data", "evidence", "evidence-issued-soc2-report"), { recursive: true });
  await writeFile(join(root, "data", "evidence", "evidence-issued-soc2-report", "soc2-report.pdf"), "Fixed issued report\n", "utf8");
  await createResource(root, {
    id: "evidence-issued-soc2-report",
    type: "evidence",
    title: "Issued SOC 2 report",
    status: "verified",
    artifactKind: "third-party-report",
    artifactSubtype: "soc2-report",
    sourceKind: "file",
    sourceDescription: "Final report issued by the independent CPA firm",
    sourceGeneratedAt: "2027-01-31T12:00:00Z",
    collectedOn: "2027-01-31",
    classificationId: "classification-example",
    filePaths: ["evidence/evidence-issued-soc2-report/soc2-report.pdf"],
    auditIds: [audit.id],
    collectorIds: ["person-example"],
    verifierIds: ["person-example"],
    verifiedOn: "2027-01-31"
  });
  const withWrongReport = (await loadWorkspace(root)).resources.find(({ id }) => id === audit.id);
  await updateResource(root, "audit", audit.id, {
    ...withWrongReport,
    reportEvidenceId: "evidence-issued-soc2-report"
  });
  const issuedReportPacket = await prepareEvidencePacket(root, { auditId: audit.id });
  assert.equal(issuedReportPacket.gaps.some(({ code }) => code === "invalid-audit-report-evidence"), false);

  const afterReportCheck = await loadWorkspace(root);
  const auditAfterReportCheck = afterReportCheck.resources.find(({ id }) => id === audit.id);
  await updateResource(root, "audit", audit.id, {
    ...auditAfterReportCheck,
    status: "fieldwork"
  });

  const beforeSystemRetirement = await loadWorkspace(root);
  const inScopeSystem = beforeSystemRetirement.resources.find(({ id }) => id === "system-example");
  await updateResource(root, "system", inScopeSystem.id, {
    ...inScopeSystem,
    status: "retired",
    statusTransition: {
      changedByIds: ["person-example"],
      changedOn: "2026-07-01",
      reason: "The system was retired after the examination period ended."
    }
  });
  const afterSystemRetirement = await assessAuditPreparation(root, { auditId: audit.id });
  assert.equal(afterSystemRetirement.stages
    .find(({ id }) => id === "period")
    .items.find(({ id }) => id === "systems").status, "complete");

  const afterNotApplicable = await loadWorkspace(root);
  const notApplicableAudit = afterNotApplicable.resources.find(({ id }) => id === audit.id);
  await createResource(root, {
    id: "system-outside-audit",
    type: "system",
    title: "System outside the audit",
    status: "active",
    purpose: "Exercise a Component relationship outside the selected audit boundary.",
    servicesProvided: ["Out-of-scope service"],
    boundary: "A separate service that is not selected by the audit.",
    criticality: "low",
    ownerIds: ["person-example"]
  });
  await createResource(root, {
    id: "component-outside-audit",
    type: "component",
    title: "Component outside the audit",
    status: "active",
    componentKind: "service",
    description: "A Vendor-supplied Component outside the selected audit boundary.",
    ownerIds: ["person-example"],
    vendorId: "vendor-example",
    systemUses: [{
      systemId: "system-outside-audit",
      roles: ["service-delivery"],
      rationale: "This use is deliberately outside the selected audit boundary."
    }]
  });
  const invalidAudit = {
    ...notApplicableAudit,
    subserviceConclusion: "identified",
    subserviceConclusionRationale: "The production Component is supplied by an external Vendor.",
    subserviceTreatments: [{
      vendorId: "vendor-example",
      componentIds: ["component-outside-audit"],
      method: "carve-out",
      rationale: "The Vendor's Controls are outside the examination boundary."
    }]
  };
  const auditEntry = (await loadWorkspace(root)).entries.find(({ record }) => record.id === audit.id);
  await writeJson(auditEntry.path, invalidAudit);
  const invalidValidation = await validateWorkspace(root);
  assert.equal(invalidValidation.diagnostics.some(({ code }) => code === "subservice-component-outside-audit-scope"), true);
  const invalidTreatment = await assessAuditPreparation(root, { auditId: audit.id });
  const invalidSubservices = invalidTreatment.stages
    .find(({ id }) => id === "period")
    .items.find(({ id }) => id === "subservices");
  assert.equal(invalidSubservices.status, "action");
  assert.match(invalidSubservices.message, /does not identify one Vendor's supplied Components in use/);

  const beforeComponentUpdate = await loadWorkspace(root);
  const outsideComponent = beforeComponentUpdate.resources.find(({ id }) => id === "component-outside-audit");
  await updateResource(root, "component", outsideComponent.id, {
    ...outsideComponent,
    systemUses: [{
      systemId: "system-example",
      roles: ["service-delivery"],
      rationale: "The Component participates in the selected audit System boundary."
    }]
  });
  const validTreatment = await assessAuditPreparation(root, { auditId: audit.id });
  assert.equal(validTreatment.stages
    .find(({ id }) => id === "period")
    .items.find(({ id }) => id === "subservices").status, "complete");

  const beforeSecurityOmission = await loadWorkspace(root);
  const securityOmissionAudit = beforeSecurityOmission.resources.find(({ id }) => id === audit.id);
  const securityOmissionProgram = beforeSecurityOmission.resources.find(({ id }) => id === program.id);
  await updateResource(root, "program", program.id, {
    ...securityOmissionProgram,
    requirementApplicability: securityOmissionProgram.requirementApplicability.map((decision) => (
      decision.requirementId === "requirement-example"
        ? { ...decision, decision: "not-applicable", rationale: "This deliberately exercises the mandatory Security-category guard." }
        : decision
    ))
  });
  await updateResource(root, "audit", audit.id, {
    ...securityOmissionAudit,
    requirementIds: descriptionRequirementIds
  });
  const withoutSecurity = await assessAuditPreparation(root, { auditId: audit.id });
  const criteriaWithoutSecurity = withoutSecurity.stages
    .find(({ id }) => id === "period")
    .items.find(({ id }) => id === "criteria");
  assert.equal(criteriaWithoutSecurity.status, "action");
  assert.match(criteriaWithoutSecurity.message, /Security Common Criterion/);
  const packetWithoutSecurity = await prepareEvidencePacket(root, { auditId: audit.id });
  assert.equal(packetWithoutSecurity.gaps.some(({ code }) => code === "audit-security-criteria-incomplete"), true);

  const beforeAuditorChange = await loadWorkspace(root);
  const auditorVendor = beforeAuditorChange.resources.find(({ id }) => id === "vendor-example");
  await updateResource(root, "vendor", auditorVendor.id, {
    ...auditorVendor,
    startDate: "2027-02-01"
  });
  const withoutEngagedAuditor = await assessAuditPreparation(root, { auditId: audit.id });
  assert.equal(withoutEngagedAuditor.stages
    .find(({ id }) => id === "engagement")
    .items.find(({ id }) => id === "auditor").status, "action");
  const workflowWithoutEngagedAuditor = await assessWorkflow(root, { auditId: audit.id });
  const auditorFinding = workflowWithoutEngagedAuditor.findings
    .find(({ key }) => key.endsWith(".engagement.auditor"));
  assert.deepEqual(auditorFinding.actions, [{
    kind: "command",
    command: `npx filegrc get ${audit.id} --mutation`
  }]);
  const packetWithoutEngagedAuditor = await prepareEvidencePacket(root, { auditId: audit.id });
  assert.equal(packetWithoutEngagedAuditor.gaps.some(({ code }) => code === "auditor-outside-engagement-period"), true);
});

test("uses the selected Program for v4 source coverage findings", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-model-v4-source-coverage-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "4");
  const loaded = await loadWorkspace(root);
  const program = loaded.resources.find(({ type }) => type === "program");
  const control = loaded.resources.find(({ type }) => type === "control");
  const coverage = loaded.resources.find(({ type }) => type === "source-coverage");
  await updateResource(root, "program", program.id, {
    ...program,
    candidateCoverage: { kind: "range", startsOn: "2026-01-01", endsOn: "2026-12-31" }
  });
  await updateResource(root, "control", control.id, { ...control, code: "HR-01" });
  await updateResource(root, "source-coverage", coverage.id, {
    ...coverage,
    status: "active",
    validFrom: "2026-01-01",
    collectionCadence: "Record every workforce change.",
    retention: "Retain through the audit and contractual period.",
    reconciliationMethod: "Compare the exported count with the committed event records."
  });

  const workflow = await assessWorkflow(root, {
    asOf: "2026-08-14",
    evaluatedAt: "2026-08-14T12:00:00Z"
  });
  const sourceCoverage = workflow.findings.find(({ key }) => key === "evidence-source.workforce.coverage");
  assert.equal(sourceCoverage.state, "ready");
  assert.match(sourceCoverage.message, /passed retrieval test/);
});

test("defaults to the one active Program and requires a selection for multiple active Programs", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-model-v4-program-selection-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "4");
  const loaded = await loadWorkspace(root);
  const active = loaded.resources.find(({ type }) => type === "program");
  const planned = { ...active, id: "program-planned", title: "Planned Program", status: "planned" };
  const withPlanned = { ...loaded, resources: [...loaded.resources, planned] };
  assert.equal(resolveProgram(withPlanned).id, active.id);

  const secondActive = { ...planned, id: "program-second", title: "Second Program", status: "active" };
  const withTwoActive = { ...loaded, resources: [...loaded.resources, secondActive] };
  assert.throws(() => resolveProgram(withTwoActive), /More than one active Program/);
  assert.equal(resolveProgram(withTwoActive, secondActive.id).id, secondActive.id);
  await createResource(root, secondActive);
  await assert.rejects(assessWorkflow(root), /More than one active Program/);
  const audit = loaded.resources.find(({ type }) => type === "audit");
  const auditWorkflow = await assessWorkflow(root, { auditId: audit.id });
  assert.equal(auditWorkflow.dataModelVersion, "4");
});

test("model v4 keeps bounded Systems, Components, Vendors, Assets, Controls, and Evidence distinct", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-model-v4-relationships-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "4");

  await createResource(root, {
    id: "system-customer-portal",
    type: "system",
    title: "Customer portal",
    status: "active",
    purpose: "Provide the customer-facing service.",
    servicesProvided: ["Customer portal"],
    boundary: "The application, production platform, and supporting operations.",
    exclusions: [],
    criticality: "high",
    ownerIds: ["appointment-example"]
  });
  const loaded = await loadWorkspace(root);
  const program = loaded.resources.find(({ type }) => type === "program");
  await updateResource(root, "program", program.id, {
    ...program,
    systemIds: [...program.systemIds, "system-customer-portal"]
  });

  await createResource(root, {
    id: "vendor-corporate-card",
    type: "vendor",
    title: "Corporate card provider",
    status: "active",
    category: "financial",
    criticality: "low",
    description: "Supports corporate purchasing outside the selected Program boundary.",
    ownerIds: ["appointment-example"]
  });
  await createResource(root, {
    id: "vendor-platform",
    type: "vendor",
    title: "Platform provider",
    status: "active",
    category: "technology",
    criticality: "high",
    description: "Supplies multiple material Components.",
    ownerIds: ["appointment-example"]
  });
  await createResource(root, {
    id: "component-shared-identity",
    type: "component",
    title: "Shared identity service",
    status: "active",
    componentKind: "external-system",
    description: "Authenticates users for both bounded Systems.",
    ownerIds: ["appointment-example"],
    systemUses: [
      {
        systemId: "system-example",
        roles: ["control-support", "evidence-source"],
        rationale: "Enforces access and produces the authoritative access log for the production application."
      },
      {
        systemId: "system-customer-portal",
        roles: ["service-delivery"],
        rationale: "Provides customer authentication as part of portal delivery."
      }
    ],
    evidenceSourceKinds: ["access-management"],
    evidenceOwnerIds: ["person-example"]
  });
  await createResource(root, {
    id: "component-platform-runtime",
    type: "component",
    title: "Platform runtime",
    status: "active",
    componentKind: "infrastructure",
    description: "Runs the production service.",
    vendorId: "vendor-platform",
    ownerIds: ["appointment-example"],
    systemUses: [{
      systemId: "system-example",
      roles: ["service-delivery", "control-support"],
      rationale: "Runs the service and supports the selected production Controls."
    }]
  });
  await createResource(root, {
    id: "component-platform-logs",
    type: "component",
    title: "Platform audit logs",
    status: "active",
    componentKind: "service",
    description: "Retains authoritative platform audit records.",
    vendorId: "vendor-platform",
    ownerIds: ["appointment-example"],
    systemUses: [{
      systemId: "system-example",
      roles: ["evidence-source"],
      rationale: "Produces the audit records used to evidence production access and changes."
    }],
    evidenceSourceKinds: ["access-management"],
    evidenceOwnerIds: ["person-example"]
  });
  await createResource(root, {
    id: "component-internal-procedure-engine",
    type: "component",
    title: "Internal procedure engine",
    status: "active",
    componentKind: "software",
    description: "Operates a selected Control without an external provider.",
    ownerIds: ["appointment-example"],
    systemUses: [{
      systemId: "system-example",
      roles: ["control-support"],
      rationale: "Runs the workflow used by the selected Control."
    }]
  });

  let current = await loadWorkspace(root);
  const asset = current.resources.find(({ type }) => type === "asset");
  await updateResource(root, "asset", asset.id, { ...asset, componentIds: ["component-platform-runtime"] });
  current = await loadWorkspace(root);
  const evidence = current.resources.find(({ type }) => type === "evidence");
  await updateResource(root, "evidence", evidence.id, {
    ...evidence,
    sourceKind: "component",
    sourceComponentId: "component-platform-logs",
    componentIds: ["component-platform-logs"]
  });
  current = await loadWorkspace(root);
  const control = current.resources.find(({ type }) => type === "control");
  await updateResource(root, "control", control.id, {
    ...control,
    componentIds: ["component-internal-procedure-engine"],
    evidenceSourceComponentIds: ["component-platform-logs"]
  });

  const result = await validateWorkspace(root);
  assert.equal(result.ok, true, result.diagnostics.map(({ message }) => message).join("\n"));
  const records = result.loaded.resources;
  assert.equal(records.find(({ id }) => id === "vendor-corporate-card").type, "vendor");
  assert.equal(records.some(({ type, vendorId }) => type === "component" && vendorId === "vendor-corporate-card"), false);
  assert.equal(records.filter(({ type, vendorId }) => type === "component" && vendorId === "vendor-platform").length, 2);
  assert.equal(records.find(({ id }) => id === "component-internal-procedure-engine").vendorId, undefined);
  assert.deepEqual(records.find(({ id }) => id === asset.id).componentIds, ["component-platform-runtime"]);
  assert.equal(records.find(({ id }) => id === evidence.id).sourceComponentId, "component-platform-logs");
  assert.deepEqual(records.find(({ id }) => id === control.id).componentIds, ["component-internal-procedure-engine"]);
  assert.deepEqual(records.find(({ id }) => id === control.id).evidenceSourceComponentIds, ["component-platform-logs"]);
});

test("v4 Vendor collection revisions track Vendors without Component links", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-model-v4-scope-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "4");
  let loaded = await loadWorkspace(root);
  const program = loaded.resources.find(({ type }) => type === "program");
  assert.equal(loaded.resources.some(({ type, vendorId }) => (
    type === "component" && vendorId === "vendor-example"
  )), false);
  assert.equal(assessCollectionReview(loaded, "vendor", { programId: program.id }).recordCount, 1);
  await applyCollectionReview(root, {
    resourceType: "vendor",
    decision: "complete",
    rationale: "Confirmed every material external provider relationship in the Vendor inventory.",
    reviewedByIds: ["person-example"],
    reviewedOn: "2026-07-01",
    scopeRevision: "example-scope-revision",
    confirmed: true
  });
  loaded = await loadWorkspace(root);
  assert.equal(assessCollectionReview(loaded, "vendor", { programId: program.id }).status, "current");

  await updateResource(root, "program", program.id, {
    ...program,
    candidateCoverage: { kind: "as-of", on: "2026-08-31" }
  });
  loaded = await loadWorkspace(root);
  assert.equal(assessCollectionReview(loaded, "vendor", { programId: program.id }).status, "current");

  await createResource(root, {
    id: "vendor-corporate-card",
    type: "vendor",
    title: "Office supplies provider",
    status: "active",
    category: "office",
    criticality: "low",
    description: "A material commercial relationship that does not supply a Component.",
    ownerIds: ["appointment-example"]
  });
  loaded = await loadWorkspace(root);
  let assessment = assessCollectionReview(loaded, "vendor", { programId: program.id });
  assert.equal(assessment.recordCount, 2);
  assert.equal(assessment.status, "stale");

  await applyCollectionReview(root, {
    resourceType: "vendor",
    decision: "complete",
    rationale: "Confirmed both material external provider relationships.",
    reviewedByIds: ["person-example"],
    reviewedOn: "2026-07-02",
    scopeRevision: "example-scope-revision-2",
    confirmed: true
  });
  loaded = await loadWorkspace(root);
  const vendor = loaded.resources.find(({ id }) => id === "vendor-corporate-card");
  await updateResource(root, "vendor", vendor.id, {
    ...vendor,
    criticality: "medium"
  });
  loaded = await loadWorkspace(root);
  assessment = assessCollectionReview(loaded, "vendor", { programId: program.id });
  assert.equal(assessment.status, "stale");
});

test("v4 collection revisions track authoritative Markdown", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-model-v4-collection-markdown-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "4");

  for (const resourceType of ["system", "component"]) {
    const program = await confirmCollectionReview(root, resourceType);
    let loaded = await loadWorkspace(root);
    const assessment = assessCollectionReview(loaded, resourceType, { programId: program.id });
    const record = assessment.records[0];
    const path = markdownEntries(loaded.model, record)[0].path;
    const source = await readFile(join(root, "data", path), "utf8");
    await updateContent(root, path, `${source}\nMaterial review detail changed.`);
    loaded = await loadWorkspace(root);
    assert.equal(
      assessCollectionReview(loaded, resourceType, { programId: program.id }).status,
      "stale",
      `${resourceType} review should become stale after its Markdown changes`
    );
  }
});

test("v4 collection revisions track type-specific source dependencies", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-model-v4-collection-dependencies-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "4");
  let loaded = await loadWorkspace(root);
  const program = loaded.resources.find(({ type }) => type === "program");

  await confirmCollectionReview(root, "framework");
  loaded = await loadWorkspace(root);
  const requirementId = program.requirementApplicability.find(({ decision }) => decision === "applicable").requirementId;
  const requirement = loaded.resources.find(({ id }) => id === requirementId);
  await updateResource(root, "requirement", requirement.id, {
    ...requirement,
    description: `${requirement.description} Updated criterion wording.`
  });
  loaded = await loadWorkspace(root);
  assert.equal(assessCollectionReview(loaded, "framework", { programId: program.id }).status, "stale");

  await confirmCollectionReview(root, "component");
  loaded = await loadWorkspace(root);
  const system = loaded.resources.find(({ type, id }) => type === "system" && program.systemIds.includes(id));
  await updateResource(root, "system", system.id, {
    ...system,
    boundary: `${system.boundary} Expanded service boundary.`
  });
  loaded = await loadWorkspace(root);
  assert.equal(assessCollectionReview(loaded, "component", { programId: program.id }).status, "stale");

  const component = assessCollectionReview(loaded, "component", { programId: program.id }).records[0];
  const vendor = loaded.resources.find(({ type }) => type === "vendor");
  await updateResource(root, "component", component.id, { ...component, vendorId: vendor.id });
  await confirmCollectionReview(root, "component");
  loaded = await loadWorkspace(root);
  const currentVendor = loaded.resources.find(({ id }) => id === vendor.id);
  await updateResource(root, "vendor", vendor.id, {
    ...currentVendor,
    criticality: currentVendor.criticality === "critical" ? "high" : "critical"
  });
  loaded = await loadWorkspace(root);
  assert.equal(assessCollectionReview(loaded, "component", { programId: program.id }).status, "stale");

  await confirmCollectionReview(root, "complementary-control");
  loaded = await loadWorkspace(root);
  const control = loaded.resources.find(({ type, id }) => type === "control" && program.controlIds.includes(id));
  await updateResource(root, "control", control.id, {
    ...control,
    statement: `${control.statement} Updated customer dependency.`
  });
  loaded = await loadWorkspace(root);
  assert.equal(assessCollectionReview(loaded, "complementary-control", { programId: program.id }).status, "stale");
});

test("v4 externally managed collection revisions track the authoritative Component", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-model-v4-authoritative-collection-source-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "4");
  let loaded = await loadWorkspace(root);
  const program = loaded.resources.find(({ type }) => type === "program");
  const component = loaded.resources.find(({ type }) => type === "component");
  await applyCollectionReview(root, {
    resourceType: "vendor",
    decision: "externally-managed",
    rationale: "The named Component is the authoritative source for the complete Vendor inventory.",
    reviewedByIds: ["person-example"],
    reviewedOn: "2026-08-18",
    scopeRevision: "authoritative-vendor-source",
    authoritativeComponentId: component.id,
    confirmed: true
  });
  loaded = await loadWorkspace(root);
  assert.equal(assessCollectionReview(loaded, "vendor", { programId: program.id }).status, "current");

  const currentComponent = loaded.resources.find(({ id }) => id === component.id);
  await updateResource(root, "component", component.id, {
    ...currentComponent,
    tags: [...(currentComponent.tags || []), "inventory-source"]
  });
  loaded = await loadWorkspace(root);
  assert.equal(assessCollectionReview(loaded, "vendor", { programId: program.id }).status, "current");

  const taggedComponent = loaded.resources.find(({ id }) => id === component.id);
  await updateResource(root, "component", component.id, {
    ...taggedComponent,
    extensions: {
      "example.inventory": { sourceScope: "All material providers" }
    }
  });
  loaded = await loadWorkspace(root);
  assert.equal(assessCollectionReview(loaded, "vendor", { programId: program.id }).status, "stale");

  await applyCollectionReview(root, {
    resourceType: "vendor",
    decision: "externally-managed",
    rationale: "Reconfirmed the authoritative Component after its source scope changed.",
    reviewedByIds: ["person-example"],
    reviewedOn: "2026-08-19",
    scopeRevision: "authoritative-vendor-source-2",
    authoritativeComponentId: component.id,
    confirmed: true
  });
  loaded = await loadWorkspace(root);
  const scopedComponent = loaded.resources.find(({ id }) => id === component.id);
  await updateResource(root, "component", component.id, {
    ...scopedComponent,
    description: `${scopedComponent.description} Inventory source details changed.`
  });
  loaded = await loadWorkspace(root);
  assert.equal(assessCollectionReview(loaded, "vendor", { programId: program.id }).status, "stale");
});

test("v4 collection revisions ignore semantic JSON formatting and relation order", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-model-v4-collection-canonical-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "4");
  let loaded = await loadWorkspace(root);
  const program = loaded.resources.find(({ type }) => type === "program");
  const vendor = loaded.resources.find(({ type }) => type === "vendor");
  await updateResource(root, "vendor", vendor.id, {
    ...vendor,
    ownerIds: ["person-example", "person-independent-approver-example"],
    extensions: {
      "example.review": { orderedChecks: ["contract", "security"] }
    }
  });
  await confirmCollectionReview(root, "vendor");

  loaded = await loadWorkspace(root);
  const vendorEntry = loaded.entries.find(({ record }) => record.id === vendor.id);
  await writeFile(vendorEntry.path, JSON.stringify(vendorEntry.record), "utf8");
  loaded = await loadWorkspace(root);
  assert.equal(assessCollectionReview(loaded, "vendor", { programId: program.id }).status, "current");

  const currentVendor = loaded.resources.find(({ id }) => id === vendor.id);
  await updateResource(root, "vendor", vendor.id, {
    ...currentVendor,
    ownerIds: [...currentVendor.ownerIds].reverse()
  });
  loaded = await loadWorkspace(root);
  assert.equal(assessCollectionReview(loaded, "vendor", { programId: program.id }).status, "current");

  const reorderedVendor = loaded.resources.find(({ id }) => id === vendor.id);
  await updateResource(root, "vendor", vendor.id, {
    ...reorderedVendor,
    extensions: {
      "example.review": { orderedChecks: ["security", "contract"] }
    }
  });
  loaded = await loadWorkspace(root);
  assert.equal(assessCollectionReview(loaded, "vendor", { programId: program.id }).status, "stale");
});

test("v4 collection revisions distinguish unrelated dependency fields from scope changes", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-model-v4-collection-projections-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "4");
  let loaded = await loadWorkspace(root);
  const program = loaded.resources.find(({ type }) => type === "program");
  const system = loaded.resources.find(({ type, id }) => type === "system" && program.systemIds.includes(id));
  const control = loaded.resources.find(({ type, id }) => type === "control" && program.controlIds.includes(id));
  const vendor = loaded.resources.find(({ type }) => type === "vendor");

  await confirmCollectionReview(root, "framework");
  await updateResource(root, "system", system.id, { ...system, title: `${system.title} renamed` });
  loaded = await loadWorkspace(root);
  assert.equal(assessCollectionReview(loaded, "framework", { programId: program.id }).status, "current");

  const component = loaded.resources.find(({ type }) => type === "component");
  await updateResource(root, "component", component.id, { ...component, vendorId: vendor.id });
  await confirmCollectionReview(root, "component");
  loaded = await loadWorkspace(root);
  const currentControl = loaded.resources.find(({ id }) => id === control.id);
  await updateResource(root, "control", control.id, {
    ...currentControl,
    statement: `${currentControl.statement} Clarified wording that does not change Component scope.`,
    activity: `${currentControl.activity} Clarified operating detail that does not change Component scope.`,
    controlType: currentControl.controlType === "detective" ? "preventive" : "detective",
    operationMode: currentControl.operationMode === "manual" ? "hybrid" : "manual",
    operationPattern: currentControl.operationPattern === "continuous" ? "scheduled" : "continuous",
    implementationReviewedOn: "2026-08-18"
  });
  loaded = await loadWorkspace(root);
  assert.equal(assessCollectionReview(loaded, "component", { programId: program.id }).status, "current");

  const controlContentPath = markdownEntries(loaded.model, loaded.resources.find(({ id }) => id === control.id))[0].path;
  const controlContent = await readFile(join(root, "data", controlContentPath), "utf8");
  await updateContent(root, controlContentPath, `${controlContent}\nUpdated procedure detail that does not change Component scope.`);
  loaded = await loadWorkspace(root);
  assert.equal(assessCollectionReview(loaded, "component", { programId: program.id }).status, "current");

  const currentVendor = loaded.resources.find(({ id }) => id === vendor.id);
  await updateResource(root, "vendor", vendor.id, {
    ...currentVendor,
    standardAgreement: !currentVendor.standardAgreement,
    agreementDocumentId: "document-example",
    classificationId: "classification-example",
    informationTypeIds: ["information-type-example"]
  });
  loaded = await loadWorkspace(root);
  assert.equal(assessCollectionReview(loaded, "component", { programId: program.id }).status, "current");

  const relatedControl = loaded.resources.find(({ id }) => id === control.id);
  await updateResource(root, "control", control.id, {
    ...relatedControl,
    componentIds: []
  });
  loaded = await loadWorkspace(root);
  assert.equal(assessCollectionReview(loaded, "component", { programId: program.id }).status, "stale");

  await confirmCollectionReview(root, "complementary-control");
  loaded = await loadWorkspace(root);
  const operatingControl = loaded.resources.find(({ id }) => id === control.id);
  await updateResource(root, "control", control.id, {
    ...operatingControl,
    controlType: operatingControl.controlType === "corrective" ? "preventive" : "corrective",
    operationMode: operatingControl.operationMode === "automated" ? "hybrid" : "automated",
    operationPattern: operatingControl.operationPattern === "event-driven" ? "mixed" : "event-driven"
  });
  loaded = await loadWorkspace(root);
  assert.equal(assessCollectionReview(loaded, "complementary-control", { programId: program.id }).status, "current");

  const currentSystem = loaded.resources.find(({ id }) => id === system.id);
  await updateResource(root, "system", system.id, {
    ...currentSystem,
    continuityObjectives: {
      ...currentSystem.continuityObjectives,
      recoveryTimeHours: (currentSystem.continuityObjectives?.recoveryTimeHours || 24) + 1
    }
  });
  loaded = await loadWorkspace(root);
  assert.equal(assessCollectionReview(loaded, "complementary-control", { programId: program.id }).status, "stale");

  await confirmCollectionReview(root, "complementary-control");
  loaded = await loadWorkspace(root);

  const dependencyControl = loaded.resources.find(({ id }) => id === control.id);
  await updateResource(root, "control", control.id, {
    ...dependencyControl,
    statement: `${dependencyControl.statement} Changed external responsibility.`
  });
  loaded = await loadWorkspace(root);
  assert.equal(assessCollectionReview(loaded, "complementary-control", { programId: program.id }).status, "stale");
});

test("active-model Component reviews ignore Control operation details but track relationships", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-model-v6-component-review-dependencies-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "6");
  const program = await confirmCollectionReview(root, "component");
  let loaded = await loadWorkspace(root);
  const control = loaded.resources.find(({ type, id }) => type === "control" && program.controlIds.includes(id));

  await updateResource(root, "control", control.id, {
    ...control,
    statement: `${control.statement} Updated wording.`,
    activity: `${control.activity} Updated operating detail.`
  });
  loaded = await loadWorkspace(root);
  assert.equal(assessCollectionReview(loaded, "component", { programId: program.id }).status, "current");

  const contentPath = markdownEntries(loaded.model, loaded.resources.find(({ id }) => id === control.id))[0].path;
  const content = await readFile(join(root, "data", contentPath), "utf8");
  await updateContent(root, contentPath, `${content}\nUpdated procedure detail.`);
  loaded = await loadWorkspace(root);
  assert.equal(assessCollectionReview(loaded, "component", { programId: program.id }).status, "current");

  const currentControl = loaded.resources.find(({ id }) => id === control.id);
  await updateResource(root, "control", control.id, {
    ...currentControl,
    componentIds: []
  });
  loaded = await loadWorkspace(root);
  assert.equal(assessCollectionReview(loaded, "component", { programId: program.id }).status, "stale");
});

test("active-model collection reviews accept 0.9.1 hashes without rewriting management reviews", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-model-v6-legacy-collection-revisions-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "6");
  let loaded = await loadWorkspace(root);
  const scopedProgram = loaded.resources.find(({ type }) => type === "program");
  const scopedSystem = loaded.resources.find(({ type, id }) => (
    type === "system" && scopedProgram.systemIds.includes(id)
  ));
  await updateResource(root, "system", scopedSystem.id, {
    ...scopedSystem,
    criticality: "high"
  });
  const expectedLegacyRevisions = {
    framework: "7db4925853fd4155b149cc22269cdd6a8fcd4740712efc2096a0e19b131cebca",
    component: "90137d5da83862a83e8465a2d981ac87dffe9d0ca6700b697ee2171fc867d73b"
  };

  for (const resourceType of ["framework", "component"]) {
    const program = await confirmCollectionReview(root, resourceType);
    loaded = await loadWorkspace(root);
    const review = loaded.resources.find((record) => (
      record.type === "collection-review"
      && record.resourceType === resourceType
      && record.status === "active"
    ));
    const options = { programId: program.id };
    const currentRevision = collectionRevision(loaded, resourceType, options);
    const legacyRevision = legacyCollectionRevision(loaded, resourceType, options);
    assert.equal(legacyRevision, expectedLegacyRevisions[resourceType]);
    assert.notEqual(legacyRevision, currentRevision);

    await updateResource(root, "collection-review", review.id, {
      ...review,
      collectionRevision: legacyRevision
    });
    loaded = await loadWorkspace(root);
    const assessment = assessCollectionReview(loaded, resourceType, options);
    assert.equal(assessment.status, "current");
    assert.equal(assessment.collectionRevision, currentRevision);
    assert.equal(assessment.review.collectionRevision, legacyRevision);
  }

  loaded = await loadWorkspace(root);
  const program = loaded.resources.find(({ type }) => type === "program");
  const system = loaded.resources.find(({ type, id }) => type === "system" && program.systemIds.includes(id));
  await updateResource(root, "system", system.id, {
    ...system,
    boundary: `${system.boundary} Materially changed after both reviews.`
  });
  const changed = await loadWorkspace(root);
  assert.equal(assessCollectionReview(changed, "framework", { programId: program.id }).status, "stale");
  assert.equal(assessCollectionReview(changed, "component", { programId: program.id }).status, "stale");
});

test("v4 Complementary Control reviews exclude retired records", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-model-v4-complementary-retired-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "4");
  const program = await confirmCollectionReview(root, "complementary-control");
  let loaded = await loadWorkspace(root);
  const before = assessCollectionReview(loaded, "complementary-control", { programId: program.id });
  const complementaryControl = before.records[0];
  await updateResource(root, "complementary-control", complementaryControl.id, {
    ...complementaryControl,
    status: "retired",
    statusTransition: {
      changedByIds: ["person-example"],
      changedOn: "2026-08-18",
      reason: "The customer action no longer applies to the current service."
    }
  });

  loaded = await loadWorkspace(root);
  const after = assessCollectionReview(loaded, "complementary-control", { programId: program.id });
  assert.equal(after.status, "stale");
  assert.equal(after.recordCount, before.recordCount - 1);
  assert.equal(after.records.some(({ id }) => id === complementaryControl.id), false);
});

test("v4 validation assesses collection reviews scoped to a retired Program", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-model-v4-retired-review-program-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "4");
  await confirmCollectionReview(root, "vendor");
  const loaded = await loadWorkspace(root);
  const program = loaded.resources.find(({ type }) => type === "program");
  const programEntry = loaded.entries.find(({ record }) => record.id === program.id);
  await writeJson(programEntry.path, {
    ...program,
    status: "retired",
    statusTransition: {
      changedByIds: ["person-example"],
      changedOn: "2026-08-18",
      reason: "Management retired this Program scope."
    }
  });

  const result = await validateWorkspace(root);
  assert.equal(result.ok, true, result.diagnostics.map(({ message }) => message).join("\n"));
});

test("v4 Complementary Control reviews exclude records outside the selected Program", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-model-v4-complementary-scope-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "4");
  let loaded = await loadWorkspace(root);
  const program = loaded.resources.find(({ type }) => type === "program");
  const before = assessCollectionReview(loaded, "complementary-control", { programId: program.id });
  const system = loaded.resources.find(({ type }) => type === "system");
  const control = loaded.resources.find(({ type }) => type === "control");
  const complementaryControl = loaded.resources.find(({ type }) => type === "complementary-control");

  await createResource(root, {
    ...system,
    id: "system-outside-program",
    title: "Outside Program System"
  });
  await createResource(root, {
    id: "control-outside-program",
    type: "control",
    title: "Outside Program Control",
    status: "planned",
    statement: "A control outside the selected Program.",
    ownerIds: control.ownerIds,
    requirementIds: control.requirementIds,
    activity: control.activity,
    operationMode: control.operationMode,
    operationPattern: control.operationPattern,
    systemIds: ["system-outside-program"]
  });
  await createResource(root, {
    id: "complementary-control-outside-program",
    type: "complementary-control",
    title: "Outside Program Customer Action",
    status: "active",
    responsibleParty: complementaryControl.responsibleParty,
    statement: "A customer action used only by the outside Program System.",
    systemIds: ["system-outside-program"],
    relatedControlIds: ["control-outside-program"]
  });

  loaded = await loadWorkspace(root);
  const after = assessCollectionReview(loaded, "complementary-control", { programId: program.id });
  assert.equal(after.recordCount, before.recordCount);
  assert.equal(after.records.some(({ id }) => id === "complementary-control-outside-program"), false);
});

async function confirmCollectionReview(root, resourceType) {
  const loaded = await loadWorkspace(root);
  const program = loaded.resources.find(({ type }) => type === "program");
  const assessment = assessCollectionReview(loaded, resourceType, { programId: program.id });
  await applyCollectionReview(root, {
    resourceType,
    decision: assessment.recordCount ? "complete" : "zero-population",
    rationale: `Confirmed the current ${resourceType} records and material scope inputs.`,
    reviewedByIds: ["person-example"],
    reviewedOn: "2026-08-18",
    scopeRevision: `collection-${resourceType}-revision`,
    confirmed: true
  });
  return program;
}
