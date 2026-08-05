import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assessRequiredAppointments } from "./appointments.js";
import { assessSourceCoverageReadiness } from "./source-coverage.js";
import { coverageEnd, coverageStart } from "./coverage.js";
import {
  applyResourceBatch,
  createResource,
  deleteResource,
  updateResource
} from "./files.js";
import { getGitSummary, getWorkspaceHistories } from "./git.js";
import {
  completeObligationAction,
  completeObligationEvent,
  completeObligationOccurrence,
  createObligationEvent,
  planObligations
} from "./obligations.js";
import { assessAuditPreparation } from "./audit-preparation.js";
import { assessProgramReadiness } from "./program-readiness.js";
import { planReconciliation } from "./reconciliation.js";
import { currentCalendarDate } from "./time.js";
import { validateWorkspace } from "./validate.js";
import { loadWorkspace } from "./workspace.js";

export const WORKFLOW_CONTRACT_VERSION = 1;

const TERMINAL_STATUSES = new Set([
  "accepted",
  "approved",
  "closed",
  "complete",
  "completed",
  "done",
  "expired",
  "inactive",
  "not-applicable",
  "reconciled",
  "remediated",
  "resolved",
  "retired",
  "superseded",
  "terminated",
  "verified"
]);

const DATE_FIELDS = [
  "dueOn",
  "expiresOn",
  "targetRemediationOn",
  "treatmentTargetOn",
  "reviewDueOn",
  "scheduledFor",
  "validThrough",
  "fieldworkStart",
  "fieldworkEnd",
  "reportDate",
  "endsOn",
  "endDate",
  "proposedEffectiveOn"
];

const OWNER_FIELDS = [
  "assigneeIds",
  "ownerIds",
  "responsibleIds",
  "reviewerIds"
];

/**
 * Return the shared, interface-neutral workflow assessment for a workspace.
 *
 * Focused readiness functions use the same source facts, while this envelope is
 * the complete contract for cross-interface workflow guidance.
 */
export async function assessWorkflow(input, options = {}) {
  const loaded = input?.resources && input?.model && input?.entries
    ? input
    : await loadWorkspace(input);
  const workspace = loaded.workspace
    || loaded.resources.find((record) => record.type === "workspace");
  const timezone = options.timezone || workspace?.timezone || "UTC";
  const asOf = options.asOf || currentCalendarDate(timezone);
  const evaluatedAt = options.evaluatedAt || options.now || new Date().toISOString();
  const program = options.programReadiness || await assessProgramReadiness(loaded, {
    asOf,
    generatedAt: evaluatedAt
  });
  const audits = selectedAudits(loaded.resources, options.auditId);
  const auditPreparations = options.auditPreparations || Object.fromEntries(await Promise.all(
    audits.map(async (audit) => [
      audit.id,
      await assessAuditPreparation(loaded, {
        auditId: audit.id,
        generatedAt: evaluatedAt,
        programReadiness: program
      })
    ])
  ));
  const obligationPlan = options.obligations || planObligations(loaded.resources, {
    asOf,
    through: options.through || asOf,
    now: evaluatedAt,
    includeComplete: Boolean(options.includeComplete),
    model: loaded.model
  });
  const validation = options.validation || await validateWorkspace(loaded);
  const reconciliation = options.reconciliation || await planReconciliation(loaded.root);
  const coverage = normalizeCoverage(
    options.coverage
    || (options.auditId ? audits[0]?.coverage : null)
    || workspace?.candidateCoverage
  );
  const periodFindings = await assessPeriodHealth(loaded, {
    coverage,
    asOf,
    evaluatedAt,
    controlIds: options.auditId ? audits[0]?.controlIds : workspace?.controlIds
  });
  const guidedFindings = [
    ...programFindings(program),
    ...Object.values(auditPreparations).flatMap(auditFindings),
    ...appointmentTemplateFindings(loaded),
    ...sourceCoverageFindings(loaded),
    ...reconciliationFindings(reconciliation),
    ...periodFindings,
    ...auditLifecycleFindings(loaded, audits)
  ];
  const findings = [
    ...validationFindings(validation, loaded),
    ...removeRedundantRecordFindings(recordFinalizationFindings(loaded), guidedFindings),
    ...guidedFindings
  ];
  const workItems = buildWorkItems(loaded.resources, obligationPlan, {
    asOf,
    includeComplete: Boolean(options.includeComplete)
  });
  const git = options.git || safeGitSummary(loaded.root);
  const assessments = buildAssessments({
    program,
    audits,
    auditPreparations,
    obligationPlan,
    findings,
    validation,
    coverage
  });
  const recommended = recommendedAction(findings, workItems, program);

  return {
    contractVersion: WORKFLOW_CONTRACT_VERSION,
    dataModelVersion: loaded.model.modelVersion,
    evaluatedAt,
    input: {
      asOf,
      timezone,
      coverage,
      auditId: options.auditId || null,
      gitRevision: git.commit || null
    },
    assessments,
    findings: findings.sort(compareFindings),
    workItems: workItems.sort(compareWorkItems),
    recommended: recommended
      ? { ...recommended, rankingReason: rankingReason(recommended) }
      : null,
    counts: {
      findings: countBy(findings, "state"),
      workItems: countBy(workItems, "state")
    },
    reconciliation
  };
}

export function buildWorkflowDelta(before, after) {
  const beforeFindings = keyed(before?.findings);
  const afterFindings = keyed(after?.findings);
  const beforeWork = keyed(before?.workItems);
  const afterWork = keyed(after?.workItems);
  return {
    contractVersion: WORKFLOW_CONTRACT_VERSION,
    assessments: changedAssessments(before?.assessments || {}, after?.assessments || {}),
    findings: changedItems(beforeFindings, afterFindings),
    workItems: changedItems(beforeWork, afterWork),
    recommendedBefore: before?.recommended?.key || null,
    recommendedAfter: after?.recommended?.key || null
  };
}

export function workflowForResource(workflow, type, id) {
  if (!workflow) return { findings: [], workItems: [], recommended: null };
  const matches = (item) => item.subject?.type === type && item.subject?.id === id;
  const findings = workflow.findings.filter(matches);
  const workItems = workflow.workItems.filter((item) => (
    matches(item)
    || item.source?.type === type && item.source?.id === id
  ));
  return {
    contractVersion: workflow.contractVersion,
    assessments: workflow.assessments,
    findings,
    workItems,
    recommended: [...findings, ...workItems].sort(compareRecommended)[0] || null
  };
}

export async function previewWorkflowMutation(input, mutation) {
  const loaded = await loadWorkspace(input);
  const previewRoot = await mkdtemp(join(tmpdir(), "filegrc-workflow-preview-"));
  try {
    await cp(join(loaded.root, "data"), join(previewRoot, "data"), {
      recursive: true,
      errorOnExist: true,
      force: false
    });
    const before = await assessWorkflow(loaded.root, mutation?.assessment || {});
    const record = mutation?.record;
    const existing = record?.id
      ? loaded.resources.find((item) => item.id === record.id && item.type === record.type)
      : null;
    const operation = mutation?.operation || (existing ? "update" : "create");
    let result;
    if (operation === "create") {
      if (!record) throw new Error("A record is required for a create preview.");
      result = await createResource(previewRoot, record, { content: mutation.content });
    } else if (operation === "update") {
      if (!record) throw new Error("A record is required for an update preview.");
      result = await updateResource(previewRoot, mutation.type || record.type, mutation.id || record.id, record, {
        content: mutation.content
      });
    } else if (operation === "delete") {
      if (!mutation.type || !mutation.id) throw new Error("A type and ID are required for a delete preview.");
      result = await deleteResource(previewRoot, mutation.type, mutation.id);
    } else if (operation === "batch") {
      result = await applyResourceBatch(previewRoot, mutation.changes);
    } else if (operation === "complete-obligation") {
      result = await completeObligationOccurrence(previewRoot, mutation);
    } else if (operation === "complete-action") {
      result = await completeObligationAction(previewRoot, mutation);
    } else if (operation === "complete-event") {
      result = await completeObligationEvent(previewRoot, mutation);
    } else if (operation === "trigger-event") {
      result = await createObligationEvent(previewRoot, mutation);
    } else {
      throw new Error(`Unsupported preview operation "${operation}".`);
    }
    const after = await assessWorkflow(previewRoot, mutation?.assessment || {});
    return {
      operation,
      target: mutationTarget(operation, mutation, record),
      result,
      workflowDelta: buildWorkflowDelta(before, after),
      workflow: after
    };
  } finally {
    await rm(previewRoot, { recursive: true, force: true });
  }
}

function selectedAudits(records, auditId) {
  const audits = records.filter((record) => record.type === "audit");
  if (!auditId) return audits;
  return audits.filter((audit) => audit.id === auditId);
}

function mutationTarget(operation, mutation, record) {
  if (operation === "delete") return { type: mutation.type, id: mutation.id };
  if (["create", "update"].includes(operation)) return { type: record.type, id: record.id };
  if (operation === "complete-obligation") return { type: "obligation", id: mutation.obligationId };
  if (operation === "complete-action") return { type: "action-item", id: mutation.actionItemId };
  if (operation === "complete-event") return { type: "obligation-event", id: mutation.eventId };
  if (operation === "trigger-event") return { type: "policy-event", id: mutation.eventType };
  return { type: "workspace", id: "batch" };
}

function programFindings(program) {
  return program.stages.flatMap((stage) => stage.items
    .filter(({ id }) => !["required-appointments", "independent-reviewer"].includes(id))
    .map((item) => normalizeFinding(
      `program.${stage.id}.${item.id}`,
      item,
      {
        assessment: stage.id === "operation" ? "period-health" : "program-configuration",
        stage: stage.id
      }
    )));
}

function auditFindings(preparation) {
  return preparation.stages.flatMap((stage) => stage.items.map((item) => normalizeFinding(
    `audit.${preparation.audit?.id || "unscoped"}.${stage.id}.${item.id}`,
    item,
    {
      assessment: stage.id === "auditor" ? "audit-closure" : "audit-readiness",
      stage: stage.id,
      auditId: preparation.audit?.id || null
    }
  )));
}

function validationFindings(validation, loaded) {
  const entriesByPath = new Map(loaded.entries.map((entry) => [
    `data/${entry.relativePath}`,
    entry.record
  ]));
  return (validation?.diagnostics || []).map((diagnostic) => {
    const record = entriesByPath.get(diagnostic.path);
    const state = "ready";
    const code = `structural.${diagnostic.code}.${record?.id || pathKey(diagnostic.path)}.${stableSuffix(diagnostic.message)}`;
    return {
      key: code,
      code,
      assessment: "structural-validity",
      stage: "structure",
      state,
      severity: diagnostic.severity,
      requiredness: "required",
      title: record?.title || "Workspace structure",
      message: diagnostic.message,
      fieldPath: diagnostic.path,
      ...(record ? { subject: { type: record.type, id: record.id } } : {}),
      dependencies: [],
      actions: record
        ? [mutationAction(record)]
        : [{ kind: "command", command: "npx filegrc validate --json" }]
    };
  });
}

function recordFinalizationFindings(loaded) {
  const findings = [];
  for (const record of loaded.resources) {
    if (["workspace", "renderer-settings"].includes(record.type)) continue;
    const incomplete = recordIncompleteReason(record, loaded);
    if (incomplete) {
      findings.push(finalizationFinding(record, incomplete));
    }
    for (const missing of finalizationFields(record, loaded.model)) {
      findings.push(fieldFinding(record, missing));
    }
  }
  return findings;
}

function removeRedundantRecordFindings(recordFindings, guidedFindings) {
  const guidedSubjects = new Set(guidedFindings
    .filter(({ subject }) => subject?.type && subject?.id)
    .map(({ subject }) => subjectKey(subject)));
  const guidedApplicabilitySubjects = new Set(guidedFindings
    .filter(({ code, subject }) => (
      subject?.type
      && subject?.id
      && (
        (subject.type === "control" && code.startsWith("program.controls.control-"))
        || (subject.type === "commitment" && code === "program.scope.commitments")
      )
    ))
    .map(({ subject }) => subjectKey(subject)));
  const guidedSubjectIds = new Set(guidedFindings
    .filter(({ subject }) => subject?.id)
    .map(({ subject }) => subject.id));
  const applicabilityFieldSubjects = new Set(recordFindings
    .filter(({ fieldPath, subject }) => (
      fieldPath === "applicabilityReview"
      && subject?.type
      && subject?.id
    ))
    .map(({ subject }) => subjectKey(subject)));

  return recordFindings.filter((finding) => {
    const key = finding.subject ? subjectKey(finding.subject) : null;
    if (!key) return true;
    if (finding.code.endsWith(".finalize")) {
      if (finding.subject?.type === "collection-review" && guidedSubjectIds.has(finding.subject.id)) {
        return false;
      }
      return !guidedSubjects.has(key) && !applicabilityFieldSubjects.has(key);
    }
    if (finding.fieldPath === "applicabilityReview") {
      return !guidedApplicabilitySubjects.has(key);
    }
    return true;
  });
}

function subjectKey(subject) {
  return `${subject.type}:${subject.id}`;
}

function recordIncompleteReason(record, loaded) {
  if (record.type === "requirement" && record.applicability === "undetermined") {
    return {
      state: "ready",
      requiredness: "required",
      message: "Review this criterion against the current service scope and record the applicability decision."
    };
  }
  if (record.type === "appointment" && record.status === "planned") {
    const assessed = assessRequiredAppointments(loaded.resources, loaded.model)
      .find(({ kind }) => kind === record.appointmentKind);
    if (assessed) return null;
    return {
      state: "ready",
      requiredness: appointmentRequiredness(record, loaded.model),
      message: "Assign a holder, confirm the authority scope and independence needs, then activate this Appointment on its real start date."
    };
  }
  const messages = {
    draft: "Complete the record, its relationships, and required Markdown before moving it to review.",
    planned: "Review this planned record against the actual program and complete its finalization checks.",
    proposed: "Review the proposed work, owner, schedule, and completion profile before activating it.",
    "in-review": "Complete independent review and bind the approval to the exact content revision.",
    open: "Complete or formally dispose of this open work with the required proof.",
    "in-progress": "Finish the work, record its result, and link its completion proof.",
    blocked: "Resolve the recorded blockers before completing this work.",
    "partially-implemented": "Finish the remaining control design, operation, source, and scheduling work."
  };
  if (!messages[record.status]) return null;
  const requiredness = recordFinalizationRequiredness(record, loaded);
  if (record.status === "blocked") {
    const byId = new Map(loaded.resources.map((resource) => [resource.id, resource]));
    return {
      state: "blocked",
      requiredness,
      message: actionBlockingReason(record, byId),
      dependencies: blockingDependencies(record.blockingResourceIds, byId)
    };
  }
  return {
    state: requiredness === "conditional" ? "scheduled" : "ready",
    requiredness,
    message: requiredness === "conditional"
      ? "Keep this starter in draft until its recorded audience, program role, or audit stage applies. Finalize or retire it when that decision is made."
      : messages[record.status]
  };
}

function recordFinalizationRequiredness(record, loaded) {
  if (!["policy", "document", "training"].includes(record.type)) return "required";
  const selectedControlIds = new Set(
    loaded.workspace?.controlIds?.length
      ? loaded.workspace.controlIds
      : loaded.resources
        .filter((resource) => resource.type === "control" && !["not-applicable", "retired"].includes(resource.status))
        .map(({ id }) => id)
  );
  const requiredByRunningObligation = loaded.resources.some((resource) => (
    resource.type === "obligation"
    && resource.status === "active"
    && (
      resource.templateResourceId === record.id
      || (resource.scopeResourceIds || []).includes(record.id)
    )
  ));
  if (requiredByRunningObligation) return "required";
  if (
    ["policy", "document"].includes(record.type)
    && record.programRole === "required"
    && (record.controlIds || []).some((id) => selectedControlIds.has(id))
  ) return "required";
  if (
    record.type === "policy"
    && loaded.resources.some((control) => (
      control.type === "control"
      && selectedControlIds.has(control.id)
      && (control.policyIds || []).includes(record.id)
    ))
  ) return "required";
  return "conditional";
}

function finalizationFields(record, model) {
  const fields = [];
  const needsReview = ["requirement", "commitment", "complementary-control", "control"].includes(record.type)
    && model.resources[record.type]?.fields?.applicabilityReview
    && !record.applicabilityReview;
  if (needsReview) {
    fields.push({
      field: "applicabilityReview",
      requiredness: "required",
      message: "Record the reviewed applicability decision, rationale, reviewer, and date. FileGRC records the current scope automatically."
    });
  }
  if (record.type === "policy" && model.resources.policy?.fields?.programRole && !record.programRole) {
    fields.push({
      field: "programRole",
      requiredness: "required",
      message: "Classify this starter as required, conditional, alternative, or supporting for this program."
    });
  }
  if (record.type === "policy" && ["draft", "in-review"].includes(record.status) && record.effectiveOn) {
    fields.push({
      field: "effectiveOn",
      requiredness: "required",
      message: "A draft cannot assert a factual effective date. Move the date to proposedEffectiveOn or activate the approved revision."
    });
  }
  const requested = {
    risk: [
      ["treatmentTargetOn", ["open", "monitoring"].includes(record.status)],
      ["reviewDueOn", ["open", "monitoring"].includes(record.status)]
    ],
    vulnerability: [
      ["confirmedOn", record.status !== "false-positive"],
      ["severityAssignedOn", record.severity !== "unknown"],
      ["targetRemediationOn", ["open", "in-progress"].includes(record.status)]
    ],
    "access-grant": [["businessNeed", !["revoked", "expired"].includes(record.status)]],
    "service-account": [
      ["authenticationMethod", record.status === "active"],
      ["reviewDueOn", record.status === "active"],
      ["nonExpiringRationale", record.status === "active" && !record.expiresOn]
    ],
    training: [
      ["effectiveContentRevisions", record.status === "active"],
      ["effectiveOn", record.status === "active"]
    ],
    control: [
      ["procedureRevision", record.status === "implemented"],
      ["procedureEffectiveOn", record.status === "implemented"],
      ["implementationReviewedByIds", record.status === "implemented"],
      ["implementationReviewedOn", record.status === "implemented"]
    ]
  }[record.type] || [];
  for (const [field, applies] of requested) {
    if (!model.resources[record.type]?.fields?.[field] || !applies || present(record[field])) continue;
    fields.push({
      field,
      requiredness: "conditional",
      message: `Complete ${fieldLabel(field)} before treating this ${fieldLabel(record.type).toLowerCase()} as finalized.`
    });
  }
  return fields;
}

function finalizationFinding(record, details) {
  const code = `record.${record.type}.${record.id}.finalize`;
  return {
    key: code,
    code,
    assessment: recordAssessment(record.type),
    stage: recordStage(record.type),
    state: details.state,
    severity: details.state === "blocked" ? "error" : "warning",
    requiredness: details.requiredness,
    title: `Finalize ${record.title}`,
    message: details.message,
    subject: { type: record.type, id: record.id },
    dependencies: details.dependencies || [],
    actions: [mutationAction(record)]
  };
}

function fieldFinding(record, missing) {
  const code = `record.${record.type}.${record.id}.field.${missing.field}`;
  return {
    key: code,
    code,
    assessment: recordAssessment(record.type),
    stage: recordStage(record.type),
    state: "ready",
    severity: "warning",
    requiredness: missing.requiredness,
    title: `${record.title}: ${fieldLabel(missing.field)}`,
    message: missing.message,
    subject: { type: record.type, id: record.id },
    fieldPath: missing.field,
    dependencies: [],
    actions: [mutationAction(record)]
  };
}

function appointmentTemplateFindings(loaded) {
  return assessRequiredAppointments(loaded.resources, loaded.model)
    .map(({ kind, template, record, state, requiredness }) => (
      appointmentFinding(kind, template, record, state, requiredness)
    ));
}

function appointmentFinding(kind, template, record, state, requiredness) {
  const code = `governance.appointment.${kind}`;
  const messages = {
    complete: `${template.title} is assigned through an active dated Appointment.`,
    ready: record
      ? `Assign and activate the planned ${template.title} Appointment.`
      : `Create, assign, and activate the required ${template.title} Appointment.`,
    "not-applicable": `${template.title} is conditional and no current scope fact requires it.`
  };
  return {
    key: code,
    code,
    assessment: "program-configuration",
    stage: kind === "independent-policy-reviewer" ? "policies" : "scope",
    state,
    severity: state === "ready" ? "warning" : "info",
    requiredness,
    title: template.title,
    message: messages[state],
    subject: { type: "appointment", ...(record ? { id: record.id } : {}) },
    dependencies: [],
    actions: record
      ? [mutationAction(record)]
      : [{ kind: "command", command: `npx filegrc scaffold appointment --title ${shellArgument(template.title)}` }]
  };
}

function sourceCoverageFindings(loaded) {
  const selectedControlIds = loaded.resources
    .filter((record) => record.type === "control" && record.status !== "not-applicable" && record.status !== "retired")
    .map(({ id }) => id);
  return assessSourceCoverageReadiness(loaded, selectedControlIds)
    .map(({ family, record, complete }) => {
      const state = complete ? "complete" : "ready";
      const code = `evidence-source.${family.id}.coverage`;
      return {
        key: code,
        code,
        assessment: "program-configuration",
        stage: "controls",
        state,
        severity: state === "complete" ? "info" : "warning",
        requiredness: "required",
        title: `${family.title} source coverage`,
        message: complete
          ? "The source family has a reviewed authoritative path, valid coverage dates, retrieval ownership, and reconciliation method."
          : record
            ? record.status === "active"
              ? "Complete any missing source details and link a passed retrieval test after a candidate period is set."
              : "Finish the planned source-family decision, retrieval method, retention, validity dates, and pre-period dry run when a candidate period is set."
            : "Create a source-family coverage record and choose FileGRC, an external authoritative System, reviewed zero population, or reviewed not applicable.",
        subject: { type: "source-coverage", ...(record ? { id: record.id } : {}) },
        dependencies: [],
        actions: record
          ? [mutationAction(record)]
          : [{ kind: "command", command: `npx filegrc scaffold source-coverage --title ${shellArgument(`${family.title} coverage`)}` }]
      };
    });
}

function reconciliationFindings(reconciliation) {
  return (reconciliation?.candidates || []).map((candidate) => ({
    key: `reconciliation.${candidate.transitionFingerprint}`,
    code: `reconciliation.${candidate.eventType}`,
    assessment: "period-health",
    stage: "operate",
    state: "ready",
    severity: "warning",
    requiredness: "conditional",
    title: `Confirm ${fieldLabel(candidate.eventType)}`,
    message: candidate.message,
    subject: candidate.subject,
    fieldPath: candidate.sourcePath,
    dependencies: [],
    actions: [candidate.action]
  }));
}

async function assessPeriodHealth(loaded, options) {
  const coverage = options.coverage;
  if (!coverage?.start || !coverage?.end) {
    if (loaded.workspace?.assuranceGoal !== "soc-2-type-2") return [];
    return [periodFinding(
      "period.coverage.select",
      "Select the candidate operating period",
      "Set the candidate Type 2 start and end dates before FileGRC can calculate continuous policy, control, source, role, and obligation coverage.",
      "ready",
      { type: "workspace", id: loaded.workspace.id },
      [{ kind: "command", command: "npx filegrc get workspace workspace --mutation" }]
    )];
  }

  const findings = [];
  const recordById = new Map(loaded.resources.map((record) => [record.id, record]));
  const relevantEntries = loaded.entries.filter(({ record }) => [
    "appointment",
    "control",
    "evidence",
    "obligation",
    "policy",
    "source-coverage",
    "system"
  ].includes(record.type));
  const paths = relevantEntries.map(({ relativePath }) => `data/${relativePath}`);
  const histories = getWorkspaceHistories(loaded.root, paths, 50);
  const allHistory = [...histories.values()].flat().filter(Boolean);
  const earliestCommitDate = allHistory
    .map(({ timestamp }) => timestamp?.slice(0, 10))
    .filter(Boolean)
    .sort()[0];
  if (!earliestCommitDate || earliestCommitDate > coverage.start) {
    findings.push(periodFinding(
      "period.git-history.span",
      "Confirm history before the period start",
      earliestCommitDate
        ? `The available FileGRC history starts on ${earliestCommitDate}, after the proposed period start ${coverage.start}. Confirm that authoritative external history covers the earlier interval or change the period.`
        : "No committed FileGRC history covers the proposed period. Commit current facts and identify authoritative external history before relying on this period.",
      "ready",
      { type: "workspace", id: loaded.workspace.id },
      [{ kind: "command", command: "git log --reverse -- data" }]
    ));
  }

  const coreKinds = assessRequiredAppointments(loaded.resources, loaded.model)
    .filter(({ requiredness }) => ["required", "core"].includes(requiredness))
    .map(({ kind }) => kind);
  for (const kind of coreKinds) {
    const covering = loaded.resources.some((record) => (
      record.type === "appointment"
      && record.appointmentKind === kind
      && record.status === "active"
      && record.startsOn
      && record.startsOn <= coverage.start
      && (!record.endsOn || record.endsOn >= coverage.end)
    ));
    if (!covering) {
      findings.push(periodFinding(
        `period.appointment.${kind}.gap`,
        `${fieldLabel(kind)} period coverage`,
        `No active dated ${fieldLabel(kind)} Appointment covers ${coverage.start} through ${coverage.end}.`,
        "ready",
        { type: "appointment" },
        [{ kind: "command", command: `npx filegrc list appointment --workflow --json` }]
      ));
    }
  }

  const selectedControlIds = new Set(options.controlIds || []);
  const selectedControlCodes = new Set(loaded.resources
    .filter((record) => record.type === "control" && selectedControlIds.has(record.id))
    .map(({ code }) => code)
    .filter(Boolean));
  const selectedSourceFamilies = new Set((loaded.model.evidenceSourceFamilies || [])
    .filter((family) => family.controlCodes.some((code) => selectedControlCodes.has(code)))
    .map(({ id }) => id));
  for (const record of loaded.resources) {
    if (record.type === "policy" && ["required", "alternative"].includes(record.programRole)) {
      if (record.status !== "active" || !record.effectiveOn || record.effectiveOn > coverage.start) {
        findings.push(periodGap(record, "policy", record.effectiveOn, coverage));
      }
    }
    if (
      record.type === "control"
      && selectedControlIds.has(record.id)
      && !["not-applicable", "retired"].includes(record.status)
    ) {
      const startsOn = record.procedureEffectiveOn || record.effectiveOn;
      if (record.status !== "implemented" || !startsOn || startsOn > coverage.start || (
        record.retiredOn && record.retiredOn < coverage.end
      )) {
        findings.push(periodGap(record, "control procedure", startsOn, coverage));
      }
    }
    if (
      record.type === "source-coverage"
      && selectedSourceFamilies.has(record.sourceFamilyId)
      && record.status !== "retired"
    ) {
      if (
        record.status !== "active"
        || !record.validFrom
        || record.validFrom > coverage.start
        || (record.validThrough && record.validThrough < coverage.end)
      ) {
        findings.push(periodGap(record, "evidence source", record.validFrom, coverage));
      }
    }
  }

  const periodThrough = [coverage.end, options.asOf].sort()[0];
  const periodResources = loaded.resources.filter((record) => (
    record.type !== "obligation"
    || !(record.controlIds || []).length
    || record.controlIds.some((id) => selectedControlIds.has(id))
  ));
  const occurrences = planObligations(periodResources, {
    from: coverage.start,
    asOf: periodThrough,
    through: periodThrough,
    now: options.evaluatedAt,
    includeComplete: true,
    model: loaded.model
  });
  for (const item of occurrences.items.filter((item) => ["overdue", "blocked", "due", "proposed"].includes(item.status))) {
    findings.push(periodFinding(
      `period.obligation.${item.key || stableSuffix(JSON.stringify(item))}`,
      item.title,
      item.status === "proposed"
        ? "This occurrence is still a proposal because its governing policy, control, owner, or completion profile is incomplete."
        : item.status === "blocked"
          ? item.blockingReason || "This work is blocked by an unresolved source record."
        : item.status === "due"
          ? `This occurrence is open within its allowed window and must be completed by ${item.dueWindowEnd}.`
          : `The expected occurrence for ${item.dueWindowStart} through ${item.dueWindowEnd} has no accepted completion.`,
      item.status === "overdue"
        ? "overdue"
        : item.status === "blocked"
          ? "blocked"
          : item.status === "due" ? "scheduled" : "ready",
      item.actionItemId
        ? { type: "action-item", id: item.actionItemId }
        : { type: "obligation", id: item.obligationId },
      [obligationNextAction(item)],
      item.status === "blocked"
        ? blockingDependencies(item.blockingResourceIds, recordById)
        : []
    ));
  }

  for (const entry of relevantEntries) {
    const record = entry.record;
    const history = histories.get(`data/${entry.relativePath}`) || [];
    const changesInsidePeriod = history.filter(({ timestamp }) => (
      timestamp?.slice(0, 10) > coverage.start
      && timestamp?.slice(0, 10) <= coverage.end
    ));
    if (changesInsidePeriod.length > 1 && ["appointment", "control", "policy", "source-coverage", "system"].includes(record.type)) {
      findings.push(periodFinding(
        `period.change.${record.type}.${record.id}`,
        `Review period impact for ${record.title}`,
        `${changesInsidePeriod.length} committed revisions fall inside the period. Confirm the effective date, review, source continuity, and any needed Policy Event or Exception.`,
        "ready",
        { type: record.type, id: record.id },
        [mutationAction(record)]
      ));
    }
    if (record.type === "evidence") {
      const businessDate = (record.businessEventAt || record.sourceGeneratedAt || record.generatedAt || record.collectedOn)?.slice(0, 10);
      const firstCommit = history.map(({ timestamp }) => timestamp?.slice(0, 10)).filter(Boolean).sort()[0];
      if (businessDate && firstCommit && calendarDaysBetween(businessDate, firstCommit) > 7) {
        findings.push(periodFinding(
          `period.contemporaneity.evidence.${record.id}`,
          `Explain late entry for ${record.title}`,
          `The recorded source date is ${businessDate}, but the first available Git entry is ${firstCommit}. Preserve the reason for the delay and verify the original source.`,
          "ready",
          { type: "evidence", id: record.id },
          [mutationAction(record)]
        ));
      }
    }
  }
  return findings;
}

function auditLifecycleFindings(loaded, audits) {
  if (String(loaded.model.modelVersion) !== "3") return [];
  const findings = [];
  for (const audit of audits) {
    if (!(audit.controlIds || []).length) {
      findings.push(auditLifecycleFinding(
        audit,
        "control-scope",
        "audit-readiness",
        "Select the audit control scope",
        "An audit with no selected controls cannot produce a meaningful evidence or occurrence assessment."
      ));
    }
    if (!audit.scopeRevision) {
      const workspaceControls = new Set(loaded.workspace?.controlIds || []);
      const omittedControls = [...workspaceControls].filter((id) => !(audit.controlIds || []).includes(id));
      findings.push(auditLifecycleFinding(
        audit,
        "scope-revision",
        "audit-readiness",
        "Review the engagement scope diff",
        `Confirm the carried-forward services, systems, categories, requirements, controls, commitments, subservices, and signatories. ${omittedControls.length} workspace controls are outside the current audit selection.`
      ));
    }
    if (audit.auditKind === "soc-2-type-2") {
      const start = coverageStart(audit.coverage);
      const end = coverageEnd(audit.coverage);
      if (!start || !end) {
        findings.push(auditLifecycleFinding(
          audit,
          "formal-period",
          "audit-readiness",
          "Record the firm-agreed Type 2 period",
          "Set the exact start and end dates before evaluating expected occurrences and source continuity."
        ));
      }
      const candidateStart = coverageStart(loaded.workspace?.candidateCoverage);
      if (start && candidateStart && start < candidateStart) {
        findings.push(auditLifecycleFinding(
          audit,
          "period-feasibility",
          "audit-readiness",
          "Resolve the retrospective period gap",
          `The formal period starts on ${start}, before the candidate-ready date ${candidateStart}. Identify authoritative earlier history or change the period.`
        ));
      }
    }
    if (!["planning", "draft"].includes(audit.status)) {
      if (!audit.engagementTermsDocumentId) {
        findings.push(auditLifecycleFinding(
          audit,
          "engagement-terms",
          "audit-readiness",
          "Link the engagement terms",
          "Record the CPA firm's engagement terms without representing its professional judgments as management facts."
        ));
      }
      if (!(audit.managementAcknowledgedByIds || []).length || !audit.managementAcknowledgedOn) {
        findings.push(auditLifecycleFinding(
          audit,
          "management-acknowledgement",
          "audit-readiness",
          "Record management acknowledgement",
          "Name who acknowledged the engagement terms and the actual acknowledgement date."
        ));
      }
    }
    const lateStage = ["report-draft", "issued", "delivered", "complete"].includes(audit.status);
    if (lateStage && !audit.subsequentEventsReview) {
      findings.push(auditLifecycleFinding(
        audit,
        "subsequent-events",
        "audit-readiness",
        "Complete the subsequent-events review",
        "Review incidents, changes, findings, subservice coverage, representations, and system-description disclosures through the report date."
      ));
    }
    if (["fieldwork", "report-draft", "issued", "delivered", "complete"].includes(audit.status) && !audit.packetDelivery) {
      findings.push(auditLifecycleFinding(
        audit,
        "packet-delivery",
        "delivery-readiness",
        "Approve and record packet delivery",
        "Record the least-disclosure review, redaction decision, recipient, delivery system, exact packet revision and manifest, management approval, delivery date, and receipt."
      ));
    }
    if (audit.status !== "complete") {
      const nextStep = auditClosureNextStep(audit.status);
      findings.push(auditLifecycleFinding(
        audit,
        "advance",
        "audit-closure",
        nextStep.title,
        nextStep.message
      ));
    }
    if (audit.status !== "complete") continue;
    const openRequests = loaded.resources.filter((record) => (
      record.type === "audit-request"
      && (record.auditId === audit.id || record.auditIds?.includes(audit.id))
      && !["complete", "closed", "accepted", "canceled"].includes(record.status)
    ));
    const openFindings = loaded.resources.filter((record) => (
      record.type === "finding"
      && (record.auditId === audit.id || record.auditIds?.includes(audit.id))
      && !["closed", "accepted", "remediated"].includes(record.status)
    ));
    for (const [suffix, records, noun] of [
      ["requests", openRequests, "Audit Requests"],
      ["findings", openFindings, "Findings"]
    ]) {
      if (!records.length) continue;
      findings.push(auditLifecycleFinding(
        audit,
        suffix,
        "audit-closure",
        `Resolve or accept open ${noun}`,
        `${records.length} ${noun} remain open, so this engagement cannot be treated as closed.`
      ));
    }
    for (const [field, title, message] of [
      ["reportEvidenceId", "Link the issued report", "Link the exact issued report evidence and its coverage."],
      ["retentionDecision", "Record the retention decision", "Record the approved retention and authorized distribution decision."],
      ["carryForwardActionIds", "Review carry-forward work", "Record the next-period actions, including an explicit empty list when no carry-forward work remains."],
      ["signatoryAppointmentIds", "Confirm authorized signatories", "Link active authority Appointments for management assertion and representation signers."]
    ]) {
      if (field === "carryForwardActionIds" ? Array.isArray(audit[field]) : present(audit[field])) continue;
      findings.push(auditLifecycleFinding(audit, field, "audit-closure", title, message));
    }
  }
  return findings;
}

function normalizeFinding(code, item, context) {
  const state = findingState(item.status);
  const subject = item.resourceType
    ? { type: item.resourceType, ...(item.resourceId ? { id: item.resourceId } : {}) }
    : null;
  const dependencies = (item.unresolvedAssignments || []).map((assignment) => ({
    type: assignment.resourceType,
    id: assignment.resourceId,
    reasons: assignment.reasons || []
  }));
  return {
    key: code,
    code,
    assessment: context.assessment,
    stage: context.stage,
    ...(context.auditId ? { auditId: context.auditId } : {}),
    state,
    severity: findingSeverity(state, context.assessment),
    title: item.title,
    message: item.message,
    ...(subject ? { subject } : {}),
    dependencies,
    actions: (item.commands || []).map((command) => ({
      kind: "command",
      command
    }))
  };
}

function mutationAction(record) {
  return {
    kind: "command",
    command: `npx filegrc get ${shellArgument(record.id)} --mutation`
  };
}

function findingState(status) {
  if (status === "action") return "ready";
  if (status === "later") return "scheduled";
  if (status === "external") return "waiting-external";
  if (status === "info") return "not-applicable";
  return status || "ready";
}

function findingSeverity(state, assessment) {
  if (state === "overdue") return "error";
  if (["ready", "blocked"].includes(state)) {
    return ["period-health", "audit-readiness", "delivery-readiness"].includes(assessment)
      ? "error"
      : "warning";
  }
  return "info";
}

function buildWorkItems(records, obligationPlan, options) {
  const byId = new Map(records.map((record) => [record.id, record]));
  const items = obligationPlan.items.map((item) => obligationWorkItem(item, byId, options.asOf));
  const obligationSources = new Set(items
    .map((item) => item.source?.id)
    .filter(Boolean));
  for (const record of records) {
    if (record.type === "obligation" || obligationSources.has(record.id)) continue;
    const due = firstDate(record);
    if (!due) continue;
    const state = sourceWorkState(record, due, options.asOf);
    if (state === "complete" && !options.includeComplete) continue;
    items.push({
      key: `source:${record.type}:${record.id}:${due}`,
      kind: "source-deadline",
      source: { type: record.type, id: record.id },
      subject: { type: record.type, id: record.id },
      title: record.title,
      ownerIds: firstOwners(record),
      dueOn: due,
      state,
      priority: workPriority(state, due, options.asOf),
      scope: workScope(record),
      blockingReason: record.status === "blocked"
        ? actionBlockingReason(record, byId)
        : null,
      dependencies: record.status === "blocked"
        ? blockingDependencies(record.blockingResourceIds, byId)
        : [],
      requiredCompletionProfile: sourceCompletionProfile(record),
      nextAction: sourceNextAction(record, due, options.asOf, records)
    });
  }
  return uniqueByKey(items);
}

function obligationWorkItem(item, byId, asOf) {
  const subjectId = item.subjectResourceId
    || (item.scopeResourceIds?.length === 1 ? item.scopeResourceIds[0] : null);
  const subjectRecord = subjectId ? byId.get(subjectId) : null;
  const due = item.dueWindowEndAt || item.dueWindowEnd;
  return {
    key: `obligation:${item.key || item.actionItemId || item.obligationId}${subjectId ? `:${subjectId}` : ""}`,
    kind: item.kind === "calendar" ? "obligation-occurrence" : "assigned-work",
    source: {
      type: item.actionItemId ? "action-item" : "obligation",
      id: item.actionItemId || item.obligationId
    },
    ...(subjectId ? { subject: { type: subjectRecord?.type || "unknown", id: subjectId } } : {}),
    title: item.title,
    ownerIds: item.ownerIds || item.assigneeIds || [],
    ...(item.dueWindowStart ? { availableOn: item.dueWindowStart } : {}),
    ...(due ? { dueOn: due } : {}),
    state: item.status,
    priority: workPriority(item.status, due?.slice(0, 10), asOf),
    scope: item.scopeResourceIds || (subjectId ? [subjectId] : []),
    blockingReason: item.blockingReason || item.reason || null,
    dependencies: blockingDependencies(item.blockingResourceIds, byId),
    requiredCompletionProfile: item.completionProfile || item.activityType || null,
    completionProfile: {
      activityType: item.activityType || null,
      profileId: item.completionProfile || null,
      resourceTypes: item.completionResourceTypes || []
    },
    nextAction: obligationNextAction(item)
  };
}

function obligationNextAction(item) {
  if (item.actionItemId) {
    if (item.status === "blocked") {
      return {
        kind: "command",
        command: `npx filegrc get ${shellArgument(item.actionItemId)} --mutation`
      };
    }
    return {
      kind: "command",
      command: `npx filegrc complete-action ${shellArgument(item.actionItemId)} --scaffold --completed-on YYYY-MM-DD`
    };
  }
  return {
    kind: "command",
    command: `npx filegrc complete ${shellArgument(item.obligationId)} --scaffold --window-start ${shellArgument(item.dueWindowStart)} --completed-on YYYY-MM-DD`
  };
}

function actionBlockingReason(record, byId) {
  if (record.status !== "blocked") return null;
  const blockers = (record.blockingResourceIds || [])
    .map((id) => byId.get(id)?.title || id)
    .filter(Boolean);
  return blockers.length
    ? `Blocked by ${blockers.join(", ")}.`
    : "The source record is blocked.";
}

function blockingDependencies(ids = [], byId) {
  return ids.map((id) => {
    const record = byId.get(id);
    return {
      type: record?.type || "unknown",
      id,
      reasons: ["Resolve this prerequisite before continuing the blocked work."]
    };
  });
}

function buildAssessments({ program, audits, auditPreparations, obligationPlan, findings, validation, coverage }) {
  const scopeStage = program.stages.find((stage) => stage.id === "scope");
  const configurationReady = stageComplete(scopeStage);
  const evidenceReady = program.evidenceReady;
  const periodFindings = findings.filter((finding) => finding.assessment === "period-health");
  const periodStarted = evidenceReady && Boolean(coverage?.start && coverage?.end);
  const periodHealthy = periodStarted
    && obligationPlan.counts.overdue === 0
    && obligationPlan.counts.blocked === 0
    && !periodFindings.some(blockingFinding);
  const auditValues = Object.values(auditPreparations);
  const auditReady = audits.length > 0
    && auditValues.every((preparation) => preparation.status === "management-ready");
  const deliveryReady = auditReady && audits.every((audit) => (
    ["fieldwork", "report-draft", "issued", "delivered", "complete"].includes(audit.status)
  )) && !findings.some((finding) => finding.assessment === "delivery-readiness" && blockingFinding(finding));
  const auditClosed = audits.length > 0
    && audits.every((audit) => audit.status === "complete")
    && !findings.some((finding) => finding.assessment === "audit-closure" && blockingFinding(finding));
  const deliveryFindingKeys = findingKeys(findings, "delivery-readiness");
  return {
    structuralValidity: assessment(
      validation.ok ? "complete" : "needs-work",
      validation.ok ? "Workspace records pass structural validation." : "Workspace structure or relationships need work.",
      findingKeys(findings, "structural-validity")
    ),
    programConfiguration: assessment(
      configurationReady ? "complete" : "needs-work",
      configurationReady ? "Program scope and ownership are configured." : "Program scope or ownership still needs work.",
      findingKeys(findings, "program-configuration", ({ key, stage }) => (
        key.startsWith("program.") && stage === "scope"
      ))
    ),
    evidenceReadiness: assessment(
      evidenceReady ? "complete" : "needs-work",
      evidenceReady ? "Evidence collection can begin." : "Evidence collection prerequisites remain.",
      findingKeys(findings, "program-configuration", ({ key }) => key.startsWith("program."))
    ),
    periodHealth: assessment(
      !periodStarted ? "not-started" : periodHealthy ? "complete" : "at-risk",
      !evidenceReady
        ? "Period health starts after the Evidence Ready gate."
        : !coverage?.start || !coverage?.end
          ? "Select the candidate or formal period before checking period health."
          : periodHealthy
            ? "No current period-health blockers were found."
            : "The candidate or operating period has blockers.",
      periodStarted ? findingKeys(findings, "period-health") : []
    ),
    auditReadiness: assessment(
      auditReady ? "complete" : audits.length ? "needs-work" : "not-started",
      auditReady ? "Management audit preparation is complete." : audits.length ? "Audit preparation remains." : "No audit engagement is selected.",
      findingKeys(findings, "audit-readiness")
    ),
    deliveryReadiness: assessment(
      deliveryReady
        ? "complete"
        : auditReady || deliveryFindingKeys.length ? "needs-work" : "not-started",
      deliveryReady
        ? "The engagement is ready for packet delivery review."
        : auditReady || deliveryFindingKeys.length
          ? "Complete the delivery checks before sending the packet."
          : "Packet delivery starts after management audit preparation is complete.",
      auditReady || deliveryFindingKeys.length ? deliveryFindingKeys : []
    ),
    auditClosure: assessment(
      auditClosed ? "complete" : audits.length ? "needs-work" : "not-started",
      auditClosed ? "All selected audits are closed." : "Audit closure remains.",
      findingKeys(findings, "audit-closure")
    )
  };
}

function assessment(status, message, findingKeysValue) {
  return { status, message, findingKeys: findingKeysValue };
}

function stageComplete(stage) {
  return Boolean(stage) && !stage.items.some((item) => item.status === "action");
}

function findingKeys(findings, assessmentName, predicate = () => true) {
  return findings
    .filter((finding) => (
      finding.assessment === assessmentName
      && blockingFinding(finding)
      && predicate(finding)
    ))
    .map((finding) => finding.key);
}

function blockingFinding(finding) {
  return ["blocked", "overdue", "ready"].includes(finding.state);
}

function recommendedAction(findings, workItems, program) {
  const firstProgramAction = program?.firstAction;
  if (firstProgramAction) {
    const preferred = findings.find((finding) => (
      finding.key.startsWith("program.")
      && finding.key.endsWith(`.${firstProgramAction.id}`)
      && blockingFinding(finding)
    ));
    if (preferred) return preferred;
  }
  return [...findings.filter(blockingFinding), ...workItems.filter(activeWork)]
    .sort(compareRecommended)[0] || null;
}

function compareRecommended(left, right) {
  const leftPriority = left.priority ?? findingPriority(left);
  const rightPriority = right.priority ?? findingPriority(right);
  return leftPriority - rightPriority || left.key.localeCompare(right.key);
}

function compareFindings(left, right) {
  return compareRecommended(left, right);
}

function compareWorkItems(left, right) {
  return compareRecommended(left, right);
}

function findingPriority(finding) {
  if (finding.state === "overdue") return 0;
  if (finding.state === "ready") return finding.severity === "error" ? 10 : 20;
  if (finding.state === "blocked") return 30;
  if (finding.severity === "error") return 10;
  if (finding.state === "waiting-external") return 40;
  if (finding.state === "scheduled") return 50;
  return 90;
}

function workPriority(state, dueOn, asOf) {
  if (state === "overdue") return 0;
  if (dueOn && asOf && dueOn < asOf) return 5;
  if (state === "due") return 10;
  if (state === "ready" || state === "open") return 20;
  if (state === "blocked") return 30;
  if (state === "upcoming" || state === "scheduled") return 50;
  return 90;
}

function activeWork(item) {
  return !["canceled", "complete", "not-applicable", "superseded"].includes(item.state);
}

function firstDate(record) {
  if (record.completionWindow?.dueAt) return record.completionWindow.dueAt;
  if (record.completionWindow?.dueOn) return record.completionWindow.dueOn;
  for (const field of DATE_FIELDS) {
    if (typeof record[field] === "string" && record[field]) return record[field];
  }
  return null;
}

function workScope(record) {
  for (const field of [
    "scopeResourceIds",
    "systemIds",
    "controlIds",
    "vendorIds",
    "requirementIds"
  ]) {
    if (Array.isArray(record[field]) && record[field].length) return record[field];
  }
  return [];
}

function sourceCompletionProfile(record) {
  if (record.type === "action-item") return record.obligationId ? "assigned-obligation-work" : "assigned-action";
  if (record.type === "audit-request") return "audit-request-response";
  if (record.type === "risk") return "risk-treatment-and-review";
  if (record.type === "vulnerability") return "vulnerability-remediation";
  if (record.type === "finding") return "finding-remediation-and-verification";
  if (record.type === "exception") return "exception-expiry-and-compensating-control-review";
  if (record.type === "service-account") return "service-account-review-or-disablement";
  if (record.type === "vendor") return "vendor-assurance-renewal-or-termination";
  if (record.type === "access-grant") return "access-renewal-or-revocation";
  if (record.type === "audit") return "audit-lifecycle-transition";
  return `${record.type}-lifecycle`;
}

function sourceNextAction(record, due, asOf, records) {
  const eventType = due <= asOf ? {
    exception: "exception-expired",
    "service-account": "service-account-expired",
    vulnerability: "vulnerability-overdue"
  }[record.type] : null;
  const alreadyRecorded = eventType && records.some((item) => (
    item.type === "obligation-event"
    && item.eventType === eventType
    && (item.subjectResourceIds || []).includes(record.id)
    && item.occurredOn >= due.slice(0, 10)
  ));
  if (eventType && !alreadyRecorded) {
    return {
      kind: "command",
      command: `npx filegrc trigger ${eventType} --occurred-on YYYY-MM-DD --subject ${shellArgument(record.id)} --json`
    };
  }
  return {
    kind: "command",
    command: `npx filegrc get ${shellArgument(record.id)} --mutation`
  };
}

function firstOwners(record) {
  for (const field of OWNER_FIELDS) {
    if (Array.isArray(record[field]) && record[field].length) return record[field];
  }
  return [];
}

function sourceWorkState(record, due, asOf) {
  if (TERMINAL_STATUSES.has(record.status)) return "complete";
  if (["canceled", "superseded"].includes(record.status)) return record.status;
  if (["draft", "in-review", "partially-implemented", "planned", "proposed"].includes(record.status)) {
    return "proposed";
  }
  if (due < asOf) return "overdue";
  if (due === asOf) return "due";
  return "scheduled";
}

function candidateCoverage(workspace) {
  const coverage = workspace?.candidateCoverage;
  if (!coverage) return null;
  return {
    kind: coverage.kind,
    start: coverageStart(coverage),
    end: coverageEnd(coverage)
  };
}

function normalizeCoverage(coverage) {
  if (!coverage) return null;
  const start = coverage.start || coverage.startsOn || coverage.on || null;
  const end = coverage.end || coverage.endsOn || coverage.on || null;
  return {
    kind: coverage.kind || (start === end ? "as-of" : "range"),
    start,
    end
  };
}

function periodFinding(key, title, message, state, subject, actions, dependencies = []) {
  return {
    key,
    code: key,
    assessment: "period-health",
    stage: "operation",
    state,
    severity: findingSeverity(state, "period-health"),
    requiredness: "required",
    title,
    message,
    subject,
    dependencies,
    actions
  };
}

function auditClosureNextStep(status) {
  const steps = {
    planning: {
      title: "Confirm the engagement and start audit preparation",
      message: "Link the agreed engagement terms, confirm scope and management acknowledgement, then move the audit to in progress."
    },
    draft: {
      title: "Finalize the draft engagement",
      message: "Resolve the draft scope and ownership, link the agreed engagement terms, then move the audit to in progress."
    },
    "in-progress": {
      title: "Begin fieldwork",
      message: "Finish management preparation, confirm the fieldwork dates, and move the audit to fieldwork when the CPA firm begins testing."
    },
    fieldwork: {
      title: "Finish fieldwork and prepare the report",
      message: "Resolve management audit requests, record the approved packet delivery, and move the audit to report draft when fieldwork is complete."
    },
    "report-draft": {
      title: "Complete the report-date review",
      message: "Complete the subsequent-events review and final management representations, then wait for the CPA firm to issue its report."
    },
    issued: {
      title: "Record final report delivery",
      message: "Confirm the issued report evidence, opinion, report date, authorized recipient, and delivery receipt, then move the audit to delivered."
    },
    delivered: {
      title: "Close the audit",
      message: "Resolve or accept open requests and findings, record retention and carry-forward decisions, then move the audit to complete."
    }
  };
  return steps[status] || {
    title: "Advance the audit",
    message: "Review the audit record, complete the current lifecycle requirements, and record the next status."
  };
}

function periodGap(record, noun, startsOn, coverage) {
  const timing = startsOn
    ? `Its recorded start is ${startsOn}, after the period begins on ${coverage.start}, or it does not remain effective through ${coverage.end}.`
    : `It has no effective start that covers ${coverage.start} through ${coverage.end}.`;
  return periodFinding(
    `period.coverage.${record.type}.${record.id}`,
    `${record.title}: continuous ${noun} coverage`,
    timing,
    "ready",
    { type: record.type, id: record.id },
    [mutationAction(record)]
  );
}

function auditLifecycleFinding(audit, suffix, assessmentName, title, message) {
  const key = `audit.${audit.id}.lifecycle.${suffix}`;
  return {
    key,
    code: key,
    assessment: assessmentName,
    stage: assessmentName === "audit-closure" ? "auditor" : "deliver",
    auditId: audit.id,
    state: "ready",
    severity: "warning",
    requiredness: "required",
    title,
    message,
    subject: { type: "audit", id: audit.id },
    dependencies: [],
    actions: [mutationAction(audit)]
  };
}

function calendarDaysBetween(start, end) {
  return Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

function safeGitSummary(root) {
  try {
    return getGitSummary(root);
  } catch {
    return {};
  }
}

function countBy(items, field) {
  return items.reduce((counts, item) => {
    const key = item[field] || "unknown";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function keyed(items = []) {
  return new Map(items.map((item) => [item.key, item]));
}

function changedAssessments(before, after) {
  const changes = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[key]?.status === after[key]?.status) continue;
    changes.push({
      assessment: key,
      before: before[key]?.status || null,
      after: after[key]?.status || null
    });
  }
  return changes;
}

function changedItems(before, after) {
  const added = [];
  const removed = [];
  const changed = [];
  for (const [key, item] of after) {
    if (!before.has(key)) added.push(item);
    else if (before.get(key).state !== item.state) {
      changed.push({ key, before: before.get(key).state, after: item.state });
    }
  }
  for (const [key, item] of before) {
    if (!after.has(key)) removed.push(item);
  }
  return { added, removed, changed };
}

function uniqueByKey(items) {
  return [...new Map(items.map((item) => [item.key, item])).values()];
}

function shellArgument(value) {
  const text = String(value);
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(text)
    ? text
    : `'${text.replaceAll("'", "'\\''")}'`;
}

function recordAssessment(type) {
  if (["audit", "audit-request", "audit-population"].includes(type)) return "audit-readiness";
  if (["action-item", "obligation", "obligation-event", "control-activity"].includes(type)) return "period-health";
  return "program-configuration";
}

function recordStage(type) {
  if (["person", "appointment", "team", "framework", "requirement", "commitment", "system", "vendor"].includes(type)) {
    return "scope";
  }
  if (["policy", "document", "training"].includes(type)) return "policies";
  if (["control", "complementary-control", "source-coverage"].includes(type)) return "controls";
  if (["audit", "audit-request", "audit-population"].includes(type)) return "audit";
  return "operate";
}

function appointmentRequiredness(record, model) {
  return model.appointmentTemplates?.[record.appointmentKind]?.requiredness || "conditional";
}

function present(value) {
  if (value === undefined || value === null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function fieldLabel(value) {
  return String(value)
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function pathKey(value) {
  return String(value || "workspace")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.|\.$/g, "");
}

function stableSuffix(value) {
  let hash = 2166136261;
  for (const character of String(value || "")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function rankingReason(item) {
  if (item.state === "overdue") return "Ranked first because it is overdue.";
  if (item.state === "expired") return "Ranked first because it is expired.";
  if (item.state === "ready" || item.state === "due") return "Ranked before blocked work because it can be acted on now.";
  if (item.state === "blocked") return "Ranked after ready work because its named prerequisite must be resolved first.";
  if (item.severity === "error") return "Ranked before warning-level work because it blocks a named assessment.";
  return "Ranked by due date, workflow state, and stable item key.";
}
