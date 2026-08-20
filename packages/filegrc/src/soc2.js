import { modelSupports } from "../model/index.js";
import { coverageEnd, coverageStart } from "./coverage.js";

export const REQUIRED_SOC2_DESCRIPTION_REFERENCES = Array.from(
  { length: 9 },
  (_, index) => `DC${index + 1}`
);

export const REQUIRED_SOC2_SECURITY_REFERENCES = [
  "CC1.1",
  "CC1.2",
  "CC1.3",
  "CC1.4",
  "CC1.5",
  "CC2.1",
  "CC2.2",
  "CC2.3",
  "CC3.1",
  "CC3.2",
  "CC3.3",
  "CC3.4",
  "CC4.1",
  "CC4.2",
  "CC5.1",
  "CC5.2",
  "CC5.3",
  "CC6.1",
  "CC6.2",
  "CC6.3",
  "CC6.4",
  "CC6.5",
  "CC6.6",
  "CC6.7",
  "CC6.8",
  "CC7.1",
  "CC7.2",
  "CC7.3",
  "CC7.4",
  "CC7.5",
  "CC8.1",
  "CC9.1",
  "CC9.2"
];

const SOC2_PROGRAM_GOALS = new Set([
  "readiness",
  "soc-2-type-1",
  "soc-2-type-2"
]);

export function soc2RequirementApplicabilityConstraint(requirement, program, modelVersion = "4") {
  if (
    !modelSupports(modelVersion, "program-scope")
    || requirement?.type !== "requirement"
    || !SOC2_PROGRAM_GOALS.has(program?.assuranceGoal)
  ) return null;
  const reference = String(requirement.reference || "").trim().toUpperCase();
  const security = REQUIRED_SOC2_SECURITY_REFERENCES.includes(reference);
  const description = REQUIRED_SOC2_DESCRIPTION_REFERENCES.includes(reference);
  if (!security && !description) return null;
  const family = security ? "Security Common Criteria" : "SOC 2 Description Criteria";
  return {
    requiredDecision: "applicable",
    allowedDecisions: ["applicable"],
    message: `${reference} is required for the selected SOC 2 Security program.`,
    defaultRationale: `${reference} is part of the required ${family} baseline for the selected ${soc2GoalLabel(program.assuranceGoal)} Program.`
  };
}

function soc2GoalLabel(goal) {
  if (goal === "soc-2-type-1") return "SOC 2 Type 1";
  if (goal === "soc-2-type-2") return "SOC 2 Type 2";
  return "SOC 2 readiness";
}

export function missingSoc2References(requirements, requiredReferences) {
  const references = new Set(requirements.map(({ reference }) => String(reference || "").trim().toUpperCase()));
  return requiredReferences.filter((reference) => !references.has(reference));
}

export function recordWasInUseDuringAudit(record, engagementStart, engagementEnd) {
  if (!record) return false;
  if (record.type === "vendor") {
    if (!["active", "deprecated", "terminated"].includes(record.status)) return false;
    const endedOn = record.endDate || (record.status === "terminated" ? record.statusTransition?.changedOn : null);
    if (engagementEnd && record.startDate && record.startDate > engagementEnd) return false;
    if (engagementStart && endedOn && endedOn < engagementStart) return false;
    if (record.status === "terminated" && engagementStart && !endedOn) return false;
    return true;
  }
  if (["active", "deprecated"].includes(record.status)) return true;
  if (!engagementStart) return false;
  if (["component", "system"].includes(record.type) && record.status === "retired") {
    return Boolean(record.statusTransition?.changedOn && record.statusTransition.changedOn >= engagementStart);
  }
  return false;
}

export function auditorWasEngaged(auditor, audit) {
  const engagementStart = audit?.managementAcknowledgedOn
    || audit?.fieldworkStart
    || coverageStart(audit?.coverage);
  const engagementEnd = audit?.reportDate
    || audit?.fieldworkEnd
    || coverageEnd(audit?.coverage);
  if (!recordWasInUseDuringAudit(auditor, engagementStart, engagementEnd)) return false;
  const endedOn = auditor.endDate || (auditor.status === "terminated" ? auditor.statusTransition?.changedOn : null);
  if (engagementStart && auditor.startDate && auditor.startDate > engagementStart) return false;
  if (engagementEnd && endedOn && endedOn < engagementEnd) return false;
  return true;
}

export function personWasActiveOn(person, on) {
  if (person?.type !== "person" || !on) return false;
  if (person.startDate && person.startDate > on) return false;
  const endedOn = person.endDate || (person.status === "inactive" ? person.statusTransition?.changedOn : null);
  if (endedOn && endedOn < on) return false;
  return person.status === "active" || (person.status === "inactive" && Boolean(endedOn));
}

export function appointmentWasAuthorizedOn(appointment, on, byId) {
  if (appointment?.type !== "appointment" || !on || !["active", "ended"].includes(appointment.status)) return false;
  if (!appointment.startsOn || appointment.startsOn > on) return false;
  if (appointment.endsOn && appointment.endsOn < on) return false;
  return personWasActiveOn(byId.get(appointment.holderId), on);
}

export function signatoryAppointmentIssue(audit, byId) {
  if (!audit?.reportDate) {
    return {
      code: "signatory-authority-date-missing",
      message: "Record the CPA report date before confirming who had authority to sign management's assertion and written representations."
    };
  }
  const ids = audit.signatoryAppointmentIds || [];
  if (!ids.length) {
    return {
      code: "signatory-authority-missing",
      message: "Link the dated authority Appointment for each management assertion and representation signer."
    };
  }
  const permittedScopes = new Set([
    "workspace",
    audit.id,
    audit.programId,
    ...(audit.systemIds || []),
    ...[...byId.values()].filter((record) => record.type === "organization").map(({ id }) => id)
  ].filter(Boolean));
  const invalid = ids.filter((id) => {
    const appointment = byId.get(id);
    return !appointmentWasAuthorizedOn(appointment, audit.reportDate, byId)
      || !(appointment.scopeResourceIds || []).some((scopeId) => permittedScopes.has(scopeId));
  });
  if (invalid.length) {
    return {
      code: "signatory-authority-invalid",
      message: `Confirm that ${invalid.join(", ")} names a dated Appointment whose holder was active and whose scope covered the workspace, Program, or Audit on ${audit.reportDate}.`
    };
  }
  return null;
}

export function soc2ReportEvidenceIssue(evidence, audit, modelVersion = "4") {
  if (
    evidence?.type !== "evidence"
    || evidence.status !== "verified"
    || evidence.artifactKind !== "third-party-report"
    || evidence.artifactSubtype !== "soc2-report"
  ) {
    return {
      code: "invalid-audit-report-evidence",
      message: `${evidence?.title || audit?.title || "The audit"} must be verified third-party-report Evidence with subtype soc2-report for the issued SOC 2 report.`
    };
  }
  const issuedOn = (modelSupports(modelVersion, "program-scope")
    ? evidence.sourceGeneratedAt
    : evidence.sourceGeneratedAt || evidence.businessEventAt || evidence.collectedOn
  )?.slice(0, 10);
  if (!issuedOn) {
    return {
      code: "audit-report-date-missing",
      message: `Record the issued SOC 2 report's actual issuance timestamp in ${evidence.title}'s sourceGeneratedAt field.`
    };
  }
  if (audit?.reportDate && issuedOn !== audit.reportDate) {
    return {
      code: "audit-report-date-mismatch",
      message: `${evidence.title} is dated ${issuedOn}, which does not match the Audit reportDate ${audit.reportDate}.`
    };
  }
  if (audit?.reportDate && audit.opinionDate && audit.opinionDate !== audit.reportDate) {
    return {
      code: "audit-opinion-date-mismatch",
      message: `The Audit opinionDate ${audit.opinionDate} does not match reportDate ${audit.reportDate}. Reconcile both dates to the issued CPA report.`
    };
  }
  return null;
}

export function subsequentEventsReviewIssue(audit) {
  const review = audit?.subsequentEventsReview;
  if (!review) {
    return {
      code: "subsequent-events-review-missing",
      message: "Review incidents, changes, findings, fraud, legal matters, subservice coverage, representations, and other relevant events through the CPA report date."
    };
  }
  if (!(review.reviewedByIds || []).length || !String(review.conclusion || "").trim()) {
    return {
      code: "subsequent-events-review-incomplete",
      message: "The subsequent-events review must name its reviewers and record management's conclusion."
    };
  }
  const requiredThroughOn = audit.reportDate || audit.fieldworkEnd || audit.coverage?.endsOn || audit.coverage?.on;
  if (!review.throughOn || (requiredThroughOn && review.throughOn < requiredThroughOn)) {
    return {
      code: "subsequent-events-period-incomplete",
      message: `The subsequent-events review must cover through ${requiredThroughOn || "the latest engagement date"}${audit.reportDate ? ", the CPA report date" : ""}.`
    };
  }
  if (!review.reviewedOn || review.reviewedOn < review.throughOn) {
    return {
      code: "subsequent-events-review-date-invalid",
      message: "The subsequent-events review date must be on or after the date through which events were reviewed."
    };
  }
  return null;
}
