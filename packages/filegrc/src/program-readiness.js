import { readFile } from "node:fs/promises";
import { modelSupports } from "../model/index.js";
import { applicabilityReviewIsCurrent } from "./applicability-scope.js";
import { assessRequiredAppointments } from "./appointments.js";
import { assessCollectionReviews } from "./collection-review.js";
import { collectionMembershipSourceTypes, collectionRevisionInputs, collectionScopeRevisionFacts } from "./collection-scope.js";
import { openPlaceholderCount, substantiveMarkdown } from "./content-readiness.js";
import { coverageEnd, coverageStart } from "./coverage.js";
import { planObligations } from "./obligations.js";
import { resolveDataPath } from "./paths.js";
import {
  contentRevisionBindingsMatch,
  documentIsAuditSpecific,
  governedDocumentIsOperating,
  obligationIsEnabled,
  obligationIsRunning
} from "./program-lifecycle.js";
import { currentPartyPeople, partiesIndependent, partyPeople } from "./parties.js";
import { assessPolicyLibraryUpgrades } from "./policy-library.js";
import { assessProgramAmendmentReadiness } from "./program-amendment.js";
import { programComponents, resolveProgram, selectedRequirementIds } from "./program.js";
import { assessRequirementMappingReadiness } from "./requirement-mapping.js";
import { assessReportingRouteSets } from "./reporting-route-sets.js";
import { assessRetentionReadiness } from "./retention.js";
import { markdownEntries } from "./resource-markdown.js";
import {
  missingSoc2References,
  personWasActiveOn,
  REQUIRED_SOC2_DESCRIPTION_REFERENCES,
  REQUIRED_SOC2_SECURITY_REFERENCES
} from "./soc2.js";
import { assessSourceCoverageReadiness } from "./source-coverage.js";
import { currentCalendarDate, timestampFromLocalDateTime } from "./time.js";
import { loadWorkspace } from "./workspace.js";

export function calculateProgramProgress({
  stages = [],
  target = {},
  evidenceReady = false,
  operating = false,
  asOf,
  window = null
} = {}) {
  const typeTwo = target.goal === "soc-2-type-2";
  const trackedWindow = normalizeProgressWindow(window || target.candidateCoverage, window ? "audit" : "candidate");
  const windowStarted = Boolean(
    typeTwo
    && trackedWindow
    && asOf
    && trackedWindow.start <= asOf
  );
  const setupProgress = calculateSetupActionProgress(stages, target, Boolean(trackedWindow));
  if (windowStarted) {
    const totalDays = calendarDayDistance(trackedWindow.start, trackedWindow.end) + 1;
    const elapsedDays = Math.min(
      totalDays,
      Math.max(0, calendarDayDistance(trackedWindow.start, asOf) + 1)
    );
    const percent = totalDays ? Math.round((elapsedDays / totalDays) * 100) : 0;
    const complete = elapsedDays >= totalDays;
    const healthy = Boolean(operating);
    return {
      mode: "operating-window",
      label: trackedWindow.source === "audit" ? "Audit window" : "Operating window",
      status: healthy ? complete ? "Window complete" : "Operating" : "Needs attention",
      complete: elapsedDays,
      total: totalDays,
      remaining: Math.max(0, totalDays - elapsedDays),
      percent,
      unit: "day",
      start: trackedWindow.start,
      end: trackedWindow.end,
      source: trackedWindow.source,
      detail: complete
        ? `${totalDays} of ${totalDays} days elapsed.`
        : `Day ${elapsedDays} of ${totalDays}; ${Math.max(0, totalDays - elapsedDays)} days remain.`,
      operating
    };
  }

  return {
    mode: "setup-progress",
    label: "Program setup",
    status: !setupProgress.remaining
      ? evidenceReady && typeTwo && trackedWindow?.start > asOf
        ? "Scheduled"
        : evidenceReady ? "Evidence ready" : "Ready"
      : evidenceReady && typeTwo ? "Ready to start" : "Needs work",
    ...setupProgress,
    unit: "action",
    detail: setupProgress.remaining
      ? `${setupProgress.complete} of ${setupProgress.total} required actions complete.`
      : `All ${setupProgress.total} required actions are complete.`,
    operating
  };
}

function calculateSetupActionProgress(stages, target, windowMilestoneComplete) {
  const units = new Map();
  for (const currentStage of stages.filter(({ id }) => id !== "operation")) {
    for (const current of currentStage.items || []) {
      if (current.progressUnit === false) continue;
      const candidates = current.progressUnits?.length
        ? current.progressUnits
        : [current];
      for (const candidate of candidates) {
        if (["info", "later"].includes(candidate.status) || candidate.progressUnit === false) continue;
        const key = `${currentStage.id}:${candidate.progressUnitId || current.progressUnitId || candidate.id || current.id}`;
        const existing = units.get(key);
        if (!existing || existing.status === "complete" && candidate.status !== "complete") {
          units.set(key, candidate);
        }
      }
    }
  }

  const setupUnits = [...units.values()];
  const complete = setupUnits.filter(({ status }) => status === "complete").length;
  const total = setupUnits.length + (target.goal === "soc-2-type-2" ? 1 : 0);
  const completed = complete + (windowMilestoneComplete ? 1 : 0);
  const remaining = Math.max(0, total - completed);
  return {
    complete: completed,
    total,
    remaining,
    percent: total ? Math.round((completed / total) * 100) : 0
  };
}

export async function assessProgramReadiness(input, options = {}) {
  const loaded = input?.resources && input?.model && input?.entries
    ? input
    : await loadWorkspace(input);
  const records = loaded.resources;
  const byId = new Map(records.map((record) => [record.id, record]));
  const workspace = loaded.workspace || records.find((record) => record.type === "workspace");
  const program = resolveProgram(loaded, options.programId);
  const asOf = options.asOf || currentCalendarDate(workspace?.timezone || "UTC");
  const requestedAudit = options.auditId
    ? records.find((record) => record.type === "audit" && record.id === options.auditId)
    : null;
  const auditWindow = requestedAudit?.auditKind === "soc-2-type-2"
    ? requestedAudit.coverage
    : selectedAuditWindow(records, program, asOf);
  const progressWindow = requestedAudit?.auditKind === "soc-2-type-2"
    ? normalizeProgressWindow(auditWindow, "audit")
    : selectedProgressWindow(program?.candidateCoverage, auditWindow, asOf);
  const scope = programScope(program, records, byId, loaded.model, loaded);
  const collectionReviews = assessCollectionReviews(loaded, { programId: program.id });
  const markdown = new Map();
  const readMarkdown = async (record) => {
    if (!record) return "";
    if (!markdown.has(record.id)) markdown.set(record.id, await primaryMarkdown(loaded, record));
    return markdown.get(record.id);
  };

  const policyStage = await policiesStage(scope, records, byId, readMarkdown, loaded.model);
  const controlStage = await controlsStage(scope, byId, readMarkdown, asOf, loaded.model);
  controlStage.items.unshift(...collectionReviews
    .filter(({ resourceType }) => resourceType === "complementary-control")
    .map(collectionReviewReadinessItem));
  const sourceStage = await evidenceSourcesStage(scope, byId, loaded.model, readMarkdown);
  controlStage.items.push(...sourceStage.items);
  const retentionScheduleReview = collectionReviews.find(({ resourceType }) => resourceType === "retention-schedule-item");
  const retentionItems = await assessRetentionReadiness(loaded, program, {
    informationTypesReviewed: collectionReviews.find(({ resourceType }) => resourceType === "information-type")?.complete === true,
    scheduleApproved: retentionScheduleReview?.complete === true
  });
  const retentionReviewItems = retentionScheduleReview
    ? [collectionReviewReadinessItem(retentionScheduleReview)]
    : [];
  if (modelSupports(loaded.model, "retention-schedule-approval")) {
    const scheduleDocumentIds = new Set(records.filter((record) => (
      record.type === "document"
      && record.documentKind === "schedule"
      && record.workflowScope === "program"
      && !["superseded", "retired"].includes(record.status)
    )).map(({ id }) => id));
    policyStage.items = policyStage.items.filter(({ id }) => (
      ![...scheduleDocumentIds].some((documentId) => id === `document-approval-${documentId}`)
    ));
    policyStage.items.push(...retentionItems.filter(({ id }) => !id.startsWith("retention-source-coverage-")));
    controlStage.items.push(...retentionItems.filter(({ id }) => id.startsWith("retention-source-coverage-")));
    policyStage.items.push(...retentionReviewItems);
  } else {
    controlStage.items.push(...retentionItems, ...retentionReviewItems);
  }
  const governedContent = await governedContentItems(scope, records, byId, readMarkdown, asOf, loaded.model);
  const policyActivations = await assessPolicyActivations(
    requiredPolicies(scope, byId),
    scope.controls,
    records,
    byId,
    readMarkdown,
    asOf,
    loaded.model
  );
  const controlOversight = collectionReviews.find(({ resourceType }) => resourceType === "control");
  const oversightEligible = Boolean(controlOversight && controlOversightEligible(controlStage.items));
  if (oversightEligible) {
    controlStage.items.push(collectionReviewReadinessItem(controlOversight));
  }
  const oversightCurrent = oversightEligible && controlOversight.complete === true;
  controlStage.items.push(...governedContent.items.map((item) => oversightCurrent || item.status === "complete"
    ? item
    : { ...item, status: "blocked", message: `Complete the Control collection review before activation. ${item.message}` }));
  controlStage.items.push(...policyActivations.map((assessment) => {
    const item = policyActivationItem(assessment);
    return oversightCurrent || item.status === "complete"
      ? item
      : { ...item, status: "blocked", message: `Complete the Control collection review before activation. ${item.message}` };
  }));
  controlStage.description = `Each implemented Control needs an owner, actual procedure, scope, operation pattern, mappings, an implementation date, enabled Obligations, and complete authoritative source ${modelSupports(loaded.model, "component-sources") ? "Components" : "Systems"}. When implementation is ready, perform one review of the implemented Control collection. Management then activates the unchanged approved program content as the Step 3 cutover.`;
  const scopeReadinessStage = scopeStage(
      program,
      scope,
      records,
      byId,
      loaded.model,
      collectionReviews.filter(({ resourceType }) => ["person", "framework", "system", "component", "vendor", "classification", "information-type"].includes(resourceType)),
      workspace?.timezone || "UTC"
    );
  if (modelSupports(loaded.model, "reporting-route-sets")) {
    const routeSets = await assessReportingRouteSets(loaded, {
      programId: program.id,
      at: timestampFromLocalDateTime(`${asOf}T23:59:59`, workspace?.timezone || "UTC")
    });
    scopeReadinessStage.items.push(reportingRouteSetItem(routeSets));
  }
  scopeReadinessStage.items.push(...await assessRequirementMappingReadiness(loaded));
  scopeReadinessStage.items.push(...await assessProgramAmendmentReadiness(loaded));
  const evidenceGateStages = [
    scopeReadinessStage,
    policyStage,
    controlStage
  ];
  const prioritizedSetupItems = prioritizeReviewDependencies(evidenceGateStages, loaded, program);
  for (const current of evidenceGateStages) finalizeStage(current);
  const evidenceReady = evidenceGateStages.every((current) => current.counts.action === 0);
  const stages = [
    ...evidenceGateStages,
    await operationStage(loaded, program, scope, records, byId, asOf, evidenceReady, loaded.model, progressWindow)
  ];
  finalizeStage(stages.at(-1));
  const periodStarted = Boolean(
    program?.assuranceGoal === "soc-2-type-2"
    && progressWindow?.start <= asOf
  );
  const obligations = planObligations(records, { programId: program.id, asOf, through: asOf, model: loaded.model });
  const policyLibrary = await assessPolicyLibraryUpgrades(loaded);
  const operating = Boolean(
    evidenceReady
    && periodStarted
    && stages.at(-1).counts.action === 0
  );
  const canStartCandidatePeriod = Boolean(
    evidenceReady
    && program?.assuranceGoal === "soc-2-type-2"
    && !program.candidateCoverage
    && !periodStarted
  );
  const items = stages.flatMap((current) => current.items);
  const managedItems = items.filter((current) => !["info", "later"].includes(current.status));
  const complete = managedItems.filter((current) => current.status === "complete").length;
  const firstAction = [...prioritizedSetupItems, ...stages.at(-1).items]
    .find((current) => current.status === "action") || null;
  const target = {
    programId: program?.id || null,
    goal: program?.assuranceGoal || "none",
    label: assuranceGoalLabel(program?.assuranceGoal),
    candidateCoverage: program?.candidateCoverage || null
  };
  const checkProgress = {
    complete,
    total: managedItems.length,
    percent: managedItems.length ? Math.round((complete / managedItems.length) * 100) : 0
  };
  const progress = calculateProgramProgress({
    stages,
    target,
    evidenceReady,
    operating,
    asOf,
    window: progressWindow
  });
  const setupProgress = calculateSetupActionProgress(
    stages,
    target,
    Boolean(progressWindow)
  );

  return {
    program,
    schemaVersion: 1,
    dataModelVersion: String(loaded.model.modelVersion),
    generatedAt: options.generatedAt || new Date().toISOString(),
    asOf,
    target,
    status: operating ? "operating" : evidenceReady ? "evidence-ready" : "needs-work",
    evidenceReady,
    operating,
    canStartCandidatePeriod,
    suggestedCandidatePeriodStart: canStartCandidatePeriod ? asOf : null,
    policyActivations,
    documentActivations: governedContent.documentActivations,
    trainingActivations: governedContent.trainingActivations,
    policyLibraryProposals: [
      ...policyLibrary.proposals,
      ...legacyPolicyLibraryProposals(records)
    ],
    progress,
    setupProgress,
    checkProgress,
    counts: countStatuses(items),
    firstAction,
    scope: {
      systemIds: scope.systems.map((record) => record.id),
      componentIds: scope.components.map((record) => record.id),
      frameworkIds: scope.frameworks.map((record) => record.id),
      requirementIds: scope.requirements.map((record) => record.id),
      controlIds: scope.controls.map((record) => record.id)
    },
    stages
  };
}

export function controlOversightEligible(items) {
  return items.length > 0 && items.every(({ status }) => status === "complete");
}

export async function assessEvidenceMap(input, options = {}) {
  const readiness = await assessProgramReadiness(input, options);
  const evidenceItems = readiness.stages
    .find((stage) => stage.id === "controls")
    ?.items.filter((current) => current.id.startsWith("source-family-")) || [];
  const counts = countStatuses(evidenceItems);
  return {
    schemaVersion: 1,
    generatedAt: readiness.generatedAt,
    asOf: readiness.asOf,
    status: counts.action ? "action" : "complete",
    counts,
    workflow: [
      `Choose an existing ${modelSupports(readiness.dataModelVersion, "component-sources") ? "Component" : "System"} or create one that is authoritative for each evidence family.`,
      `On every source ${modelSupports(readiness.dataModelVersion, "component-sources") ? "Component" : "System"}, set an evidence source role, name current evidence access owners, and write repeatable retrieval instructions in Record Markdown.`,
      `Map each selected Control to the authoritative source ${modelSupports(readiness.dataModelVersion, "component-sources") ? "Components with evidenceSourceComponentIds" : "Systems with evidenceSourceIds"} that produce its evidence.`,
      "Run program-readiness again and resolve every incomplete source check and control mapping before marking the Controls implemented."
    ],
    items: evidenceItems
  };
}

function programScope(program, records, byId, model, loaded) {
  const select = (ids, type, fallback) => {
    if (ids?.length) return ids.map((id) => byId.get(id)).filter((record) => record?.type === type);
    return records.filter(fallback);
  };
  return {
    program,
    systems: (program?.systemIds || [])
      .map((id) => byId.get(id))
      .filter((record) => record?.type === "system" && record.status !== "retired"),
    components: programComponents(loaded, program),
    frameworks: select(program?.frameworkIds, "framework", (record) => (
      record.type === "framework" && record.status === "active"
    )),
    requirements: select(selectedRequirementIds(program, model), "requirement", (record) => (
      record.type === "requirement" && record.applicability === "applicable"
    )).filter((record) => modelSupports(model, "program-scope") || record.applicability === "applicable"),
    controls: select(program?.controlIds, "control", (record) => (
      record.type === "control" && !["not-applicable", "retired"].includes(record.status)
    )).filter((record) => !["not-applicable", "retired"].includes(record.status))
  };
}

function scopeStage(workspace, scope, records, byId, model, collectionReviews = [], timezone = "UTC") {
  const items = [];
  const goal = workspace?.assuranceGoal || "none";
  items.push(item(
    "program-goal",
    goal !== "none" ? "complete" : "action",
    "Choose the program goal",
    goal !== "none"
      ? `Target: ${assuranceGoalLabel(goal)}. This is a management objective, not an active CPA engagement.`
      : "Choose readiness, SOC 2 Type 1, or SOC 2 Type 2 as the management objective.",
    workspace || { type: "workspace" },
    {
      commands: [
        "npx filegrc setup",
        `npx filegrc get ${shellArgument(workspace?.id || "workspace")} --mutation`
      ]
    }
  ));

  if (model.resources?.["reporting-route"] && !modelSupports(model, "reporting-route-sets")) {
    items.push(reportingRouteItem(records, byId, currentCalendarDate(timezone), timezone));
  }

  if (modelSupports(model, "program-scope")) {
    const completeComponents = scope.components.filter((component) => (
      component.status === "active"
      && component.description
      && (component.ownerIds || []).length
      && (component.systemUses || []).some(({ systemId, roles, rationale }) => (
        scope.systems.some(({ id }) => id === systemId)
        && (roles || []).length
        && String(rationale || "").trim()
      ))
    ));
    items.push(item(
      "system-components",
      scope.components.length === completeComponents.length ? "complete" : "action",
      "Confirm scoped Components",
      scope.components.length
        ? `${completeComponents.length} of ${scope.components.length} Components have an active, owned, rationalized role in the selected Systems.`
        : "No Components are selected. This is valid only when the bounded Systems do not rely on a separately managed service-delivery, Control-support, evidence-source, or supporting-operations building block.",
      scope.components[0] || { type: "component" },
      {
        componentIds: scope.components.map(({ id }) => id),
        progressUnit: false
      }
    ));
  }

  items.push(programOwnershipItem(records, byId));
  items.push(requiredAppointmentsItem(records, model));
  for (const assessment of collectionReviews) {
    items.push(collectionReviewReadinessItem(assessment));
  }

  const completeSystems = scope.systems.filter((system) => (
    system.status === "active"
    && (modelSupports(model, "program-scope") ? system.purpose && system.boundary && (system.servicesProvided || []).length : system.description)
    && (modelSupports(model, "program-scope") || system.classificationId)
    && (system.ownerIds || []).length
  ));
  items.push(item(
    "service-boundary",
    scope.systems.length && completeSystems.length === scope.systems.length ? "complete" : "action",
    "Define the service boundary",
    scope.systems.length
      ? `${completeSystems.length} of ${scope.systems.length} program systems are active, explicitly in scope, owned, and described${modelSupports(model, "program-scope") ? "" : ", with a classification"}.`
      : "Select and describe every service and supporting system in the program boundary.",
    scope.systems[0] || { type: "system" }
  ));

  if (modelSupports(model, "guided-workflow")) {
    const allCommitments = records.filter((record) => (
      record.type === "commitment"
      && !["superseded", "retired"].includes(record.status)
    ));
    const commitments = allCommitments.filter((record) => (
      (record.systemIds || []).some((id) => scope.systems.some((system) => system.id === id))
    ));
    const unscopedCommitments = allCommitments.filter((record) => !(record.systemIds || []).length);
    const completeCommitments = commitments.filter((record) => (
      record.status === "active"
      && record.statement
      && record.effectiveOn
      && (!model.resources.commitment?.fields?.applicabilityReview || (
        record.applicabilityReview?.decision === "applicable"
        && applicabilityReviewIsCurrent(record.applicabilityReview, record, workspace, records, model)
      ))
      && currentPartyPeople(record.ownerIds, byId).size > 0
      && (record.requirementIds || []).length > 0
      && (record.controlIds || []).length > 0
    ));
    const uncoveredSystems = scope.systems.filter((system) => !completeCommitments.some((record) => (
      (record.systemIds || []).includes(system.id)
    )));
    items.push(item(
      "commitments",
      !scope.systems.length ? "later" : uncoveredSystems.length === 0 && unscopedCommitments.length === 0 ? "complete" : "action",
      "Record service commitments and system requirements",
      scope.systems.length
        ? `${completeCommitments.length} complete active ${completeCommitments.length === 1 ? "commitment covers" : "commitments cover"} ${scope.systems.length - uncoveredSystems.length} of ${scope.systems.length} in-scope systems.${unscopedCommitments.length ? ` ${unscopedCommitments.length} Commitment${unscopedCommitments.length === 1 ? " has" : "s have"} no System scope and must be reviewed explicitly.` : ""}`
        : "Define the service boundary before recording its customer promises and approved system requirements.",
      commitments[0] || { type: "commitment" },
      {
        uncoveredSystemIds: uncoveredSystems.map(({ id }) => id),
        unscopedCommitmentIds: unscopedCommitments.map(({ id }) => id),
        commands: [
          "npx filegrc guide commitment --json",
          "npx filegrc list commitment --workflow --json",
          'npx filegrc scaffold commitment --title "SERVICE COMMITMENT"',
          "npx filegrc program-readiness --json"
        ]
      }
    ));
  }

  const selectedRequirementIds = new Set(scope.requirements.map((record) => record.id));
  const requirementById = new Map(records
    .filter(({ type }) => type === "requirement")
    .map((record) => [record.id, record]));
  const v4Decisions = new Map((workspace?.requirementApplicability || [])
    .filter((decision) => (
      requirementById.has(decision.requirementId)
      && applicabilityReviewIsCurrent(decision, requirementById.get(decision.requirementId), workspace, records, model)
    ))
    .map((decision) => [decision.requirementId, decision.decision]));
  const applicableRequirements = records.filter((record) => (
    record.type === "requirement"
    && scope.frameworks.some((framework) => framework.id === record.frameworkId)
    && (modelSupports(model, "program-scope") ? v4Decisions.get(record.id) === "applicable" : record.applicability === "applicable")
  ));
  const unresolvedRequirements = records.filter((record) => (
    record.type === "requirement"
    && scope.frameworks.some((framework) => framework.id === record.frameworkId)
    && (modelSupports(model, "program-scope") ? !v4Decisions.has(record.id) || v4Decisions.get(record.id) === "undetermined" : record.applicability === "undetermined")
  ));
  const missingRequirements = applicableRequirements.filter((record) => !selectedRequirementIds.has(record.id));
  const selectedDescriptionRequirements = scope.requirements.filter(isDescriptionRequirement);
  const selectedTrustServicesRequirements = scope.requirements.filter((requirement) => !isDescriptionRequirement(requirement));
  const unresolvedDescriptionRequirements = unresolvedRequirements.filter(isDescriptionRequirement);
  const unresolvedTrustServicesRequirements = unresolvedRequirements.filter((requirement) => !isDescriptionRequirement(requirement));
  const uncoveredRequirements = scope.requirements.filter((requirement) => (
    !isDescriptionRequirement(requirement)
    && !scope.controls.some((control) => (control.requirementIds || []).includes(requirement.id))
  ));
  const enforceSoc2Baseline = modelSupports(model, "program-scope")
    && ["readiness", "soc-2-type-1", "soc-2-type-2"].includes(goal);
  const selectedFrameworkRequirements = records.filter((record) => (
    record.type === "requirement"
    && scope.frameworks.some((framework) => framework.id === record.frameworkId)
  ));
  const securityRequirements = selectedFrameworkRequirements.filter(isSecurityRequirement);
  const descriptionRequirements = selectedFrameworkRequirements.filter(isDescriptionRequirement);
  const missingRequiredSecurityReferences = enforceSoc2Baseline
    ? missingSoc2References(securityRequirements, REQUIRED_SOC2_SECURITY_REFERENCES)
    : [];
  const missingRequiredDescriptionReferences = enforceSoc2Baseline
    ? missingSoc2References(descriptionRequirements, REQUIRED_SOC2_DESCRIPTION_REFERENCES)
    : [];
  const mandatoryRequirements = enforceSoc2Baseline
    ? [...securityRequirements, ...descriptionRequirements].filter(({ reference }) => (
        REQUIRED_SOC2_SECURITY_REFERENCES.includes(String(reference || "").toUpperCase())
        || REQUIRED_SOC2_DESCRIPTION_REFERENCES.includes(String(reference || "").toUpperCase())
      ))
    : [];
  const invalidMandatoryDecisions = mandatoryRequirements.filter((requirement) => (
    v4Decisions.get(requirement.id) !== "applicable"
  ));
  const criteriaComplete = Boolean(
    scope.frameworks.length
    && scope.requirements.length
    && scope.controls.length
    && !unresolvedRequirements.length
    && !missingRequirements.length
    && !uncoveredRequirements.length
    && !missingRequiredSecurityReferences.length
    && !missingRequiredDescriptionReferences.length
    && !invalidMandatoryDecisions.length
  );
  items.push(item(
    "criteria",
    criteriaComplete ? "complete" : "action",
    "Confirm Trust Services criteria, Description Criteria, and Controls",
    criteriaComplete
      ? `${selectedTrustServicesRequirements.length} applicable Trust Services criteria, ${selectedDescriptionRequirements.length} SOC 2 Description Criteria, and ${scope.controls.length} Controls are in scope. Every applicable Trust Services criterion has at least one selected Control; Description Criteria govern the system description and do not map to Controls.`
      : missingRequiredSecurityReferences.length || missingRequiredDescriptionReferences.length
        ? `Use the complete SOC 2 baseline. The selected Frameworks omit ${[
            ...missingRequiredSecurityReferences,
            ...missingRequiredDescriptionReferences
          ].join(", ")}.`
        : invalidMandatoryDecisions.length
          ? `Mark all 33 Security Common Criteria and all nine Description Criteria applicable for this SOC 2 Program. ${invalidMandatoryDecisions.length} required ${invalidMandatoryDecisions.length === 1 ? "decision is" : "decisions are"} missing, undetermined, or not applicable.`
          : `Resolve the program criteria and Controls. ${unresolvedTrustServicesRequirements.length} Trust Services applicability decisions and ${unresolvedDescriptionRequirements.length} Description Criteria decisions remain undetermined, ${missingRequirements.length} applicable criteria are not selected, and ${uncoveredRequirements.length} selected applicable Trust Services criteria have no selected Control. Description Criteria govern the system description and do not map to Controls.`,
    workspace || { type: "workspace" },
    {
      unresolvedRequirementIds: unresolvedRequirements.map(({ id }) => id),
      missingRequirementIds: missingRequirements.map(({ id }) => id),
      uncoveredRequirementIds: uncoveredRequirements.map(({ id }) => id),
      invalidMandatoryRequirementIds: invalidMandatoryDecisions.map(({ id }) => id),
      missingRequiredReferences: [...missingRequiredSecurityReferences, ...missingRequiredDescriptionReferences],
      commands: [
        "npx filegrc review-applicability --scaffold --type requirement > decisions.json",
        "npx filegrc review-applicability decisions.json --preview --json",
        "npx filegrc review-applicability decisions.json --yes --json",
        `npx filegrc get ${shellArgument(workspace?.id || "workspace")} --mutation`
      ]
    }
  ));

  return stage("scope", "Define Scope", "Set program ownership, the management objective, service boundary, criteria, controls, and dependencies.", items);
}

export function reportingRouteSetItem(assessment) {
  const current = assessment.routeSets.find(({ effective, canceled }) => effective && !canceled);
  const draft = assessment.routeSets.find(({ record }) => ["draft", "proposed"].includes(record.status));
  const required = assessment.requirements.length > 0;
  const proposed = assessment.proposedRequirements.length > 0;
  const proposedPurposeKeys = [...new Set(assessment.proposedRequirements
    .map(({ purposeKey }) => purposeKey)
    .filter(Boolean))];
  const preparedPurposeKeys = new Set(assessment.routeSets
    .filter(({ record, committed, effective, canceled, proposedRequirementIssues }) => (
      (["proposed", "approved"].includes(record.status) || effective)
      && committed
      && !canceled
      && proposedRequirementIssues.length === 0
    ))
    .map(({ record }) => record.purposeKey));
  const requiredPurposeKeys = new Set(assessment.requirements.map(({ purposeKey }) => purposeKey).filter(Boolean));
  const purposeKeys = [...new Set([
    ...requiredPurposeKeys,
    ...proposedPurposeKeys
  ])];
  const unpreparedPurposeKeys = proposedPurposeKeys.filter((purposeKey) => !preparedPurposeKeys.has(purposeKey));
  const ready = assessment.issues.length === 0
    && (!required || Boolean(current))
    && unpreparedPurposeKeys.length === 0;
  const needsAction = assessment.issues.length > 0 || unpreparedPurposeKeys.length > 0;
  const target = current?.record || draft?.record || { type: "reporting-route-set" };
  let message;
  if (assessment.issues.length) {
    message = assessment.issues[0].message;
  } else if (unpreparedPurposeKeys.length) {
    message = `Complete and commit a Reporting Channel Set proposal for ${unpreparedPurposeKeys.join(", ")} before Step 1 is complete. Approval and effectiveness remain part of the later implementation cutover.`;
  } else if (required && ready && current) {
    message = `${current.record.title} is committed, effective, and has a current responsible Appointment. Assignments bind its Git commit.`;
  } else if (!required && proposed) {
    message = "Every reporting-channel requirement in proposed program content has a committed Reporting Channel Set proposal. Approve the exact proposal before its governing content becomes active.";
  } else if (!required && draft) {
    message = "No approved rule currently requires these reporting channels. Keep the draft for review or remove it; it is not a readiness gate.";
  } else if (!required) {
    message = "No active Policy, Document, Commitment, or Risk decision currently requires these reporting channels.";
  } else {
    message = assessment.issues[0]?.message || "Set the normal and fallback reporting channels, commit the proposal, approve it, and commit the approval.";
  }
  return item(
    "security-reporting-route-set",
    needsAction ? "action" : required ? ready ? "complete" : "action" : proposed ? "complete" : "info",
    needsAction ? "Prepare required reporting channels" : required ? "Approve required reporting channels" : proposed ? "Reporting channel proposals are ready" : "Reporting channels are not currently required",
    message,
    target,
    {
      requirements: assessment.requirements,
      proposedRequirements: assessment.proposedRequirements,
      proposedRequirementIssues: assessment.routeSets.flatMap(({ proposedRequirementIssues }) => proposedRequirementIssues),
      unpreparedPurposeKeys,
      issues: assessment.issues,
      progressUnits: purposeKeys.flatMap((purposeKey) => {
        const purposeResourceIds = new Set([
          ...assessment.routeSets.filter(({ record }) => record.purposeKey === purposeKey).map(({ record }) => record.id),
          ...assessment.requirements.filter((requirement) => requirement.purposeKey === purposeKey).map(({ sourceId }) => sourceId),
          ...assessment.proposedRequirements.filter((requirement) => requirement.purposeKey === purposeKey).map(({ sourceId }) => sourceId)
        ].filter(Boolean));
        const purposeIssues = assessment.issues.filter(({ resourceId }) => (
          resourceId === assessment.programId || purposeResourceIds.has(resourceId)
        ));
        const approvedSet = assessment.routeSets.find(({ record, effective, canceled }) => (
          record.purposeKey === purposeKey && effective && !canceled
        ));
        const proposedSet = assessment.routeSets.find(({ record, effective, canceled }) => (
          record.purposeKey === purposeKey
          && !canceled
          && (effective || ["proposed", "approved"].includes(record.status))
        ));
        const proposalComplete = Boolean(
          (approvedSet || proposedSet?.committed)
          && proposedSet?.proposedRequirementIssues.length === 0
        );
        return [
          {
            id: `reporting-route-proposal-${purposeKey}`,
            status: proposalComplete ? "complete" : "action",
            title: `${proposedSet?.record.title || purposeKey} proposal`
          },
          {
            id: `reporting-route-approval-${purposeKey}`,
            status: approvedSet && purposeIssues.length === 0
              ? "complete"
              : requiredPurposeKeys.has(purposeKey) ? "action" : "later",
            title: `${proposedSet?.record.title || purposeKey} approval`
          }
        ];
      }),
      commands: [
        "npx filegrc reporting-route-sets --json",
        "npx filegrc reporting-route-set --scaffold"
      ]
    }
  );
}

function reportingRouteItem(records, byId, asOf, timezone = "UTC") {
  const cutoff = new Date(timestampFromLocalDateTime(`${asOf}T23:59:59`, timezone));
  const routes = records.filter((record) => (
    record.type === "reporting-route"
    && record.purpose === "security-reporting"
    && record.status === "active"
    && new Date(record.effectiveAt) <= cutoff
    && (!record.endsAt || new Date(record.endsAt) > cutoff)
  ));
  const routeByPriority = new Map(routes.map((route) => [route.priority, route]));
  const required = ["primary", "alternate"];
  const ready = required.every((priority) => {
    const route = routeByPriority.get(priority);
    return route && currentPartyPeople(route.ownerIds || [], byId).size > 0;
  });
  return item(
    "security-reporting-route",
    ready ? "complete" : "action",
    "Activate the primary and alternate security reporting routes",
    ready
      ? `The current routes are ${required.map((priority) => routeByPriority.get(priority).title).join(" and ")}. Training assignments bind the exact Git revision delivered.`
      : "Activate one owned primary route and one independently usable alternate route before assigning training or relying on policy reporting instructions.",
    routes[0] || records.find(({ type }) => type === "reporting-route") || { type: "reporting-route" }
  );
}

export function collectionReviewReadinessItem(assessment) {
  const firstIncomplete = assessment.incompleteRecordProposals?.[0]
    || assessment.recordProposals?.find(({ complete }) => !complete);
  const needsFirstRecord = assessment.recordCount === 0
    && !(assessment.configuration.decisions || []).some((decision) => ["zero-population", "externally-managed"].includes(decision));
  const proposalAction = !assessment.complete && firstIncomplete;
  const pendingRetentionRow = assessment.resourceType === "retention-schedule-item"
    ? assessment.records?.find(({ status }) => status === "planned")
    : null;
  const approvalAction = !proposalAction && !pendingRetentionRow
    ? collectionApprovalIssueAction(assessment)
    : null;
  const proposalUnits = (assessment.recordProposals || []).map((proposal) => ({
    id: `${assessment.resourceType}-proposal-${proposal.resourceId}`,
    status: proposal.complete ? "complete" : "action",
    title: `${proposal.title} proposal`
  }));
  const proposalBatchComplete = proposalUnits.every(({ status }) => status === "complete");
  const batchProgressUnits = assessment.resourceType !== "retention-schedule-item" && proposalUnits.length
    ? [
        {
          id: `${assessment.resourceType}-proposal-batch`,
          status: proposalBatchComplete ? "complete" : "action",
          title: `${assessment.configuration.title} proposals`
        },
        {
          id: `${assessment.resourceType}-collection-review`,
          status: proposalBatchComplete
            ? assessment.complete ? "complete" : "action"
            : "blocked",
          title: `${assessment.configuration.title} collection review`
        }
      ]
    : null;
  return item(
    `collection-review-${assessment.resourceType}`,
    assessment.complete ? "complete" : pendingRetentionRow && !proposalAction ? "blocked" : "action",
    proposalAction
      ? `Complete ${firstIncomplete.title} proposal`
      : needsFirstRecord
        ? `Add a record for ${assessment.configuration.title.toLowerCase()}`
        : approvalAction
          ? approvalAction.title
        : assessment.status === "stale"
          ? `Review ${assessment.configuration.title.toLowerCase()} again`
          : `Review ${assessment.configuration.title.toLowerCase()}`,
    proposalAction
      ? `Complete ${firstIncomplete.title} before reviewing ${assessment.configuration.title.toLowerCase()}.`
      : assessment.message,
    proposalAction
      ? { id: firstIncomplete.resourceId, type: assessment.resourceType }
      : needsFirstRecord ? { type: assessment.resourceType }
        : approvalAction ? { type: approvalAction.resourceType, ...(approvalAction.resourceId ? { id: approvalAction.resourceId } : {}) }
          : assessment.review || { type: assessment.resourceType },
    {
      resourceType: approvalAction?.resourceType || assessment.resourceType,
      reviewPoints: assessment.configuration.reviewPoints,
      ...(approvalAction?.createResource ? { createResource: true } : {}),
      ...(pendingRetentionRow && !proposalAction ? { unresolvedAssignments: [{
        resourceType: "retention-schedule-item",
        resourceId: pendingRetentionRow.id,
        reasons: ["Complete or retire the planned retention row before approving the schedule."]
      }] } : {}),
      ...(batchProgressUnits ? { progressUnits: batchProgressUnits } : {}),
      commands: proposalAction
        ? [
            `npx filegrc guide ${assessment.resourceType} --json`,
            `npx filegrc get ${shellArgument(firstIncomplete.resourceId)} --mutation > MUTATION.json`,
            `npx filegrc update ${assessment.resourceType} ${shellArgument(firstIncomplete.resourceId)} MUTATION.json --json`
          ]
        : needsFirstRecord
          ? [
              `npx filegrc guide ${assessment.resourceType} --json`,
              `npx filegrc scaffold ${assessment.resourceType} --title "NAME" > MUTATION.json`,
              "npx filegrc create MUTATION.json --json"
            ]
          : approvalAction
            ? approvalAction.commands
            : [
              `npx filegrc review-collection ${assessment.resourceType} --scaffold > REVIEW.json`,
              `npx filegrc review-collection ${assessment.resourceType} REVIEW.json --preview --json`,
              `npx filegrc review-collection ${assessment.resourceType} REVIEW.json --yes --json`
            ]
    }
  );
}

function collectionApprovalIssueAction(assessment) {
  const issue = assessment.approvalIssues?.[0];
  if (!issue || issue.code === "invalid-retention-schedule-approval-binding") return null;
  const rows = assessment.records || [];
  const documentId = issue.resourceId || rows.find(({ scheduleDocumentId }) => scheduleDocumentId)?.scheduleDocumentId;
  if (issue.code.includes("retention-schedule-document")) {
    const resourceId = issue.code === "missing-retention-schedule-document" || issue.code === "multiple-retention-schedule-documents"
      ? null : documentId;
    return {
      title: issue.code === "missing-retention-schedule-document" ? "Add the Data Retention Schedule document"
        : issue.code === "multiple-retention-schedule-documents" ? "Resolve duplicate Data Retention Schedule documents"
          : "Complete the Data Retention Schedule document",
      resourceType: "document",
      resourceId,
      createResource: issue.code === "missing-retention-schedule-document",
      commands: resourceId
        ? ["npx filegrc guide document --json", `npx filegrc get ${shellArgument(resourceId)} --mutation > MUTATION.json`, `npx filegrc update document ${shellArgument(resourceId)} MUTATION.json --json`]
        : issue.code === "missing-retention-schedule-document"
          ? ["npx filegrc guide document --json", 'npx filegrc scaffold document --title "Data Retention Schedule" > MUTATION.json', "npx filegrc create MUTATION.json --json"]
          : ["npx filegrc guide document --json", "npx filegrc list document --workflow --json"]
    };
  }
  if (["retention-row-wrong-schedule-document", "incomplete-retention-schedule-row"].includes(issue.code)) {
    const row = rows.find(({ id }) => id === issue.resourceId);
    if (row) return {
      title: `Complete ${row.title}`,
      resourceType: "retention-schedule-item",
      resourceId: row.id,
      commands: ["npx filegrc guide retention-schedule-item --json", `npx filegrc get ${shellArgument(row.id)} --mutation > MUTATION.json`, `npx filegrc update retention-schedule-item ${shellArgument(row.id)} MUTATION.json --json`]
    };
  }
  if (issue.code === "unreviewed-similar-information-types") return {
    title: "Review similar Information Types",
    resourceType: "information-type",
    commands: ["npx filegrc list information-type --workflow --json", "npx filegrc review-collection information-type --scaffold > REVIEW.json", "npx filegrc review-collection information-type REVIEW.json --preview --json", "npx filegrc review-collection information-type REVIEW.json --yes --json"]
  };
  return {
    title: "Complete retention schedule coverage",
    resourceType: "retention-schedule-item",
    commands: ["npx filegrc guide retention-schedule-item --json", "npx filegrc list retention-schedule-item --workflow --json", 'npx filegrc scaffold retention-schedule-item --title "RETENTION RULE" > MUTATION.json', "npx filegrc create MUTATION.json --json"]
  };
}

function requiredAppointmentsItem(records, model) {
  const assessments = assessRequiredAppointments(records, model);
  const incomplete = assessments.filter(({ requiredness, state }) => (
    ["core", "required"].includes(requiredness) && state !== "complete"
  ));
  const complete = incomplete.length === 0;
  const first = incomplete[0];
  return item(
    "required-appointments",
    complete ? "complete" : "action",
    "Assign required program authority",
    complete
      ? "Every authority required by the current scope has an active dated Appointment."
      : `${incomplete.length} required ${incomplete.length === 1 ? "Appointment needs" : "Appointments need"} a current holder: ${incomplete.map(({ template }) => template.title).join(", ")}.`,
    first?.record || { type: "appointment" },
    {
      commands: [
        "npx filegrc guide appointment --json",
        "npx filegrc list appointment --workflow --json",
        first?.record
          ? `npx filegrc get ${first.record.id} --mutation`
          : `npx filegrc scaffold appointment --title "${first?.template.title || "APPOINTMENT TITLE"}"`
      ]
    }
  );
}

function programOwnershipItem(records, byId) {
  const ownedRecords = records.filter((record) => (
    ["policy", "control", "obligation"].includes(record.type)
    && !["retired", "superseded", "not-applicable"].includes(record.status)
  ));
  const unresolved = ownedRecords.filter((record) => currentPartyPeople(record.ownerIds, byId).size === 0);
  const currentOwners = new Set(ownedRecords.flatMap((record) => [...currentPartyPeople(record.ownerIds, byId)]));
  const missingJobTitles = [...currentOwners]
    .map((id) => byId.get(id))
    .filter((record) => record?.type === "person" && record.status === "active" && !String(record.jobTitle || "").trim());
  const oversight = byId.get("team-security-risk-oversight");
  const policyOwnerIds = new Set(records
    .filter((record) => record.type === "policy" && !["retired", "superseded"].includes(record.status))
    .flatMap((record) => [...partyPeople(record.ownerIds || [], byId)]));
  const oversightChairs = oversight?.type === "team"
    ? currentPartyPeople(oversight.chairIds || [], byId)
    : new Set();
  const oversightComplete = !oversight || (
    oversight.type === "team"
    && oversight.status === "active"
    && currentPartyPeople(oversight.memberIds || [], byId).size > 0
    && oversightChairs.size > 0
    && ![...oversightChairs].some((id) => policyOwnerIds.has(id))
  );
  const complete = currentOwners.size > 0
    && unresolved.length === 0
    && missingJobTitles.length === 0
    && oversightComplete;
  const unresolvedAssignments = unresolved.map((record) => ({
    resourceType: record.type,
    resourceId: record.id,
    title: record.title,
    ownerIds: record.ownerIds || [],
    reasons: ownershipResolutionReasons(record.ownerIds || [], byId)
  }));
  const oversightDependent = oversight?.id
    ? unresolvedAssignments.filter(({ reasons }) => (
        reasons.length > 0
        && reasons.every(({ ownerId, reason }) => (
          ownerId === oversight.id
          && ["inactive-team", "team-has-no-current-members"].includes(reason)
        ))
      ))
    : [];
  const separatelyUnresolved = unresolved.length - oversightDependent.length;
  const detail = [];
  if (!currentOwners.size) detail.push("No current person owns the program records.");
  if (separatelyUnresolved) {
    detail.push(`${separatelyUnresolved} ${separatelyUnresolved === 1 ? "record has" : "records have"} no current person owner.`);
  }
  if (missingJobTitles.length) {
    detail.push(`${missingJobTitles.length} active ${missingJobTitles.length === 1 ? "owner needs" : "owners need"} an organizational job title.`);
  }
  if (!oversightComplete) {
    detail.push(
      "Activate Security and Risk Oversight with current members and a chair separate from policy ownership."
      + (oversightDependent.length
        ? ` This team owns ${oversightDependent.length} proposed ${oversightDependent.length === 1 ? "obligation" : "obligations"}.`
        : "")
    );
  }
  const oversightId = oversight?.id ? shellArgument(oversight.id) : null;
  return item(
    "program-ownership",
    complete ? "complete" : "action",
    "Confirm program owners and oversight",
    complete
      ? `${currentOwners.size} current ${currentOwners.size === 1 ? "person owns" : "people own"} the program records.${oversight ? " Security and Risk Oversight has a separate current chair." : ""}`
      : detail.join(" "),
    !oversightComplete ? oversight : unresolved[0] || { type: "person" },
    {
      unresolvedAssignments,
      missingJobTitleIds: missingJobTitles.map(({ id }) => id),
      ...(!oversightComplete && oversight ? {
        commands: [
          "npx filegrc guide person --json",
          "npx filegrc guide appointment --json",
          "npx filegrc list person --json",
          'npx filegrc scaffold person --title "REVIEWER NAME" | npx filegrc create - --json',
          `npx filegrc get ${oversightId} --mutation`,
          `npx filegrc update team ${oversightId} MUTATION.json --json`
        ]
      } : {})
    }
  );
}

function ownershipResolutionReasons(ownerIds, byId) {
  if (!ownerIds.length) return [{ ownerId: null, reason: "missing-owner" }];
  return ownerIds.flatMap((ownerId) => {
    const owner = byId.get(ownerId);
    if (!owner) return [{ ownerId, reason: "missing-record" }];
    if (owner.type === "person" && owner.status !== "active") {
      return [{ ownerId, reason: "inactive-person" }];
    }
    if (owner.type === "team" && owner.status !== "active") {
      return [{ ownerId, reason: "inactive-team" }];
    }
    if (owner.type === "appointment" && owner.status !== "active") {
      return [{ ownerId, reason: "inactive-appointment" }];
    }
    if (currentPartyPeople([ownerId], byId).size === 0) {
      if (owner.type === "team") return [{ ownerId, reason: "team-has-no-current-members" }];
      if (owner.type === "appointment") return [{ ownerId, reason: "appointment-has-no-current-holder" }];
      return [{ ownerId, reason: "no-current-person" }];
    }
    return [];
  });
}

async function policiesStage(scope, records, byId, readMarkdown, model) {
  const policies = requiredPolicies(scope, byId);
  const documents = modelSupports(model, "governed-document-activation")
    ? requiredGovernedDocuments(scope, records, byId, model)
    : [];
  const trainings = modelSupports(model, "governed-training-activation")
    ? records.filter(({ type, status }) => type === "training" && !["superseded", "retired"].includes(status))
    : [];
  const governedRecords = [...policies, ...documents, ...trainings];
  const appointedReviewer = governedRecords
    .filter((record) => partiesIndependent(record.ownerIds, record.approverIds, byId))
    .flatMap((record) => [...currentPartyPeople(record.approverIds || [], byId)])
    .map((id) => byId.get(id))
    .find(Boolean);
  const policyOwnerIds = new Set(governedRecords.flatMap((record) => (
    [...partyPeople(record.ownerIds || [], byId)]
  )));
  const oversight = byId.get("team-security-risk-oversight");
  const availableReviewer = oversight?.type === "team" && oversight.status === "active"
    ? [...currentPartyPeople(oversight.chairIds || [], byId)]
      .filter((id) => !policyOwnerIds.has(id))
      .map((id) => byId.get(id))
      .find(Boolean)
    : null;
  const reviewerNeedsAssignment = !appointedReviewer && availableReviewer && governedRecords.length;
  const items = [
    item(
      "independent-reviewer",
      appointedReviewer ? "complete" : "action",
      reviewerNeedsAssignment
        ? "Assign the independent policy reviewer"
        : "Appoint the independent policy reviewer",
      appointedReviewer
        ? `${appointedReviewer.title} is recorded as a reviewer separate from policy ownership.`
        : reviewerNeedsAssignment
          ? `${availableReviewer.title} chairs Security and Risk Oversight. Assign this person as approver on each policy after review.`
          : "Appoint a reviewer who is separate from the policy owner. The reviewer may be another person in the organization or an external person, and is separate from the CPA firm that may later perform the audit.",
      appointedReviewer || (reviewerNeedsAssignment ? governedRecords[0] : { type: "person" }),
      {
        progressUnit: false,
        commands: [
          "npx filegrc list appointment --workflow --json",
          "npx filegrc guide appointment --json",
          "npx filegrc external-reviewer-setup --scaffold > reviewer.json",
          "npx filegrc external-reviewer-setup reviewer.json --preview --json"
        ]
      }
    )
  ];
  if (!policies.length) {
    items.push(item(
      "policy-scope",
      "action",
      "Link policies to the selected controls",
      "No applicable policies are linked from the controls in program scope.",
      { type: "policy" },
      {
        commands: [
          "npx filegrc list policy --workflow --json",
          "npx filegrc list control --workflow --json",
          "npx filegrc program-readiness --json"
        ]
      }
    ));
  }
  for (const policy of policies) {
    const source = await readMarkdown(policy);
    const placeholderCount = openPlaceholderCount(source);
    const checks = {
      independentlyApproved: ["approved", "active"].includes(policy.status)
        && policy.approvedOn
        && partiesIndependent(policy.ownerIds, policy.approverIds, byId),
      linkedControls: scope.controls.some((control) => (control.policyIds || []).includes(policy.id)),
      contentComplete: Boolean(source.trim()) && placeholderCount === 0
    };
    const missing = Object.entries(checks).filter(([, value]) => !value).map(([name]) => policyCheckLabel(name));
    items.push(item(
      `policy-${policy.id}`,
      missing.length ? "action" : "complete",
      policy.title,
      missing.length
        ? `Remaining approval work: ${missing.join(", ")}${placeholderCount ? ` (${placeholderCount} open placeholders)` : ""}. Approval accepts the policy requirements; it does not assert Control implementation.`
        : `Independently approved on ${policy.approvedOn}, bound to the approved content revision, linked to Controls, and free of open organization placeholders. Activation remains in Step 3.`,
      policy,
      {
        checks,
        placeholderCount,
        commands: [
          `npx filegrc get ${shellArgument(policy.id)} --mutation`,
          `npx filegrc update policy ${shellArgument(policy.id)} MUTATION.json --json`,
          "npx filegrc program-readiness --json"
        ]
      }
    ));
  }
  for (const document of documents) {
    const source = await readMarkdown(document);
    const placeholderCount = openPlaceholderCount(source);
    const isSecurityIncidentRecoveryPlan = document.id === "document-security-incident-recovery-plan";
    const systemContinuityObjectivesRequired = isSecurityIncidentRecoveryPlan
      && scope.requirements.some(isAvailabilityRequirement);
    const systemsWithCompleteContinuityObjectives = scope.systems.filter(({ continuityObjectives }) => (
      Number.isInteger(continuityObjectives?.recoveryTimeHours)
      && Number.isInteger(continuityObjectives?.recoveryPointHours)
      && Number.isInteger(continuityObjectives?.maximumTolerableDowntimeHours)
    ));
    const checks = {
      independentlyApproved: ["approved", "active"].includes(document.status)
        && Boolean(document.approvedOn)
        && Boolean(document.approvedContentRevisions)
        && partiesIndependent(document.ownerIds, document.approverIds, byId),
      owner: currentPartyPeople(document.ownerIds, byId).size > 0,
      linkedControls: (document.controlIds || []).some((id) => scope.controls.some((control) => control.id === id)),
      contentComplete: substantiveMarkdown(source) && placeholderCount === 0,
      ...(isSecurityIncidentRecoveryPlan
        ? {
            systemContinuityObjectives: !systemContinuityObjectivesRequired
              || systemsWithCompleteContinuityObjectives.length === scope.systems.length && scope.systems.length > 0
          }
        : {})
    };
    const missing = Object.entries(checks)
      .filter(([, value]) => !value)
      .map(([name]) => governedApprovalCheckLabel(name));
    items.push(item(
      `document-approval-${document.id}`,
      missing.length ? "action" : "complete",
      document.title,
      missing.length
        ? `Remaining Step 2 approval work: ${missing.join(", ")}${placeholderCount ? ` (${placeholderCount} open placeholders)` : ""}. Complete and approve the intended values before implementation.`
        : `Independently approved on ${document.approvedOn} and bound to the exact intended values and Markdown revision. Activation remains in Step 3.`,
      document,
      {
        checks,
        placeholderCount,
        ...(isSecurityIncidentRecoveryPlan
          ? {
              systemContinuityObjectivesRequired,
              continuityObjectiveSystemIds: systemsWithCompleteContinuityObjectives.map(({ id }) => id),
              missingContinuityObjectiveSystemIds: systemContinuityObjectivesRequired
                ? scope.systems
                  .filter(({ id }) => !systemsWithCompleteContinuityObjectives.some((system) => system.id === id))
                  .map(({ id }) => id)
                : []
            }
          : {}),
        commands: [
          `npx filegrc get ${shellArgument(document.id)} --mutation`,
          `npx filegrc update document ${shellArgument(document.id)} MUTATION.json --json`,
          "npx filegrc program-readiness --json"
        ]
      }
    ));
  }
  if (modelSupports(model, "governed-training-activation")) {
    for (const training of trainings) {
      const source = await readMarkdown(training);
      const placeholderCount = openPlaceholderCount(source);
      const checks = {
        independentlyApproved: ["approved", "active"].includes(training.status)
          && Boolean(training.approvedOn)
          && Boolean(training.approvedContentRevisions)
          && partiesIndependent(training.ownerIds, training.approverIds, byId),
        owner: currentPartyPeople(training.ownerIds, byId).size > 0,
        linkedControls: (training.controlIds || []).some((id) => scope.controls.some((control) => control.id === id)),
        contentComplete: substantiveMarkdown(source) && placeholderCount === 0
      };
      const missing = Object.entries(checks)
        .filter(([, value]) => !value)
        .map(([name]) => governedApprovalCheckLabel(name));
      items.push(item(
        `training-approval-${training.id}`,
        missing.length ? "action" : "complete",
        training.title,
        missing.length
          ? `Remaining Step 2 approval work: ${missing.join(", ")}${placeholderCount ? ` (${placeholderCount} open placeholders)` : ""}. Review and approve the exact Training content before implementation.`
          : `Independently approved on ${training.approvedOn} and bound to the exact Training revision. Activation remains in Step 3.`,
        training,
        {
          checks,
          placeholderCount,
          commands: [
            `npx filegrc get ${shellArgument(training.id)} --mutation`,
            `npx filegrc update training ${shellArgument(training.id)} MUTATION.json --json`,
            "npx filegrc program-readiness --json"
          ]
        }
      ));
    }
  }
  return stage(
    "policies",
    "Approve Policies",
    "Approve the exact Policy, program Document, and Training content that defines what the organization intends to require. Approval does not prove implementation or activate the content.",
    items
  );
}

function requiredPolicies(scope, byId) {
  const linkedPolicyIds = new Set(scope.controls.flatMap((control) => control.policyIds || []));
  return [...linkedPolicyIds].map((id) => byId.get(id)).filter((record) => (
    record?.type === "policy"
    && record.programRole !== "conditional"
    && !["superseded", "retired"].includes(record.status)
  ));
}

function requiredGovernedDocuments(scope, records, byId, model) {
  const selectedControlIds = new Set(scope.controls.map(({ id }) => id));
  const linkedDocumentIds = new Set(requiredPolicies(scope, byId).flatMap((policy) => policy.relatedDocumentIds || []));
  const obligationDocumentIds = new Set(records
    .filter((record) => record.type === "obligation")
    .flatMap((record) => [
      ...(record.scopeResourceIds || []),
      ...(record.templateResourceId ? [record.templateResourceId] : [])
    ]));
  return records.filter((record) => (
    record.type === "document"
    && !documentIsAuditSpecific(record, model)
    && !["superseded", "retired"].includes(record.status)
    && (
      linkedDocumentIds.has(record.id)
      || obligationDocumentIds.has(record.id)
      || (
        modelSupports(model, "retention-schedule-approval")
        && record.documentKind === "schedule"
        && record.workflowScope === "program"
      )
      || (
        record.programRole === "required"
        && (record.controlIds || []).some((id) => selectedControlIds.has(id))
      )
    )
  ));
}

async function governedContentItems(scope, records, byId, readMarkdown, asOf, model) {
  const enabledObligations = records.filter((record) => (
    record.type === "obligation" && obligationIsEnabled(record)
  ));
  const requiredGovernedIds = new Set(enabledObligations.flatMap((record) => [
    ...(record.scopeResourceIds || []),
    ...(record.templateResourceId ? [record.templateResourceId] : [])
  ]));
  const documents = requiredGovernedDocuments(scope, records, byId, model);
  const governedRecords = [
    ...documents,
    ...records.filter((record) => (
      record.type === "training"
      && !["superseded", "retired"].includes(record.status)
      && (
        requiredGovernedIds.has(record.id)
        || (record.controlIds || []).some((id) => scope.controls.some((control) => control.id === id))
      )
    ))
  ];
  const items = [];
  const documentActivations = [];
  const trainingActivations = [];
  for (const record of governedRecords) {
    const source = await readMarkdown(record);
    const placeholderCount = openPlaceholderCount(source);
    const linkedControlIds = (record.controlIds || []).filter((id) => scope.controls.some((control) => control.id === id));
    const missingImplementationControlIds = linkedControlIds.filter((id) => byId.get(id)?.status !== "implemented");
    const checks = record.type === "document"
      ? modelSupports(model, "governed-document-activation") ? {
          approvalBound: ["approved", "active"].includes(record.status)
            && Boolean(record.approvedOn)
            && Boolean(record.approvedContentRevisions)
            && partiesIndependent(record.ownerIds, record.approverIds, byId),
          owner: currentPartyPeople(record.ownerIds, byId).size > 0,
          active: record.status === "active",
          requirementsImplemented: linkedControlIds.length > 0 && missingImplementationControlIds.length === 0,
          activationRecorded: record.activationBasis === "recorded",
          activated: Boolean(record.activatedOn),
          activator: Boolean((record.activatedByIds || []).length)
            && record.activatedByIds.every((id) => personWasActiveOn(byId.get(id), record.activatedOn)),
          activatedContent: Boolean(record.activatedContentRevisions),
          activationMatchesApproval: contentRevisionBindingsMatch(
            record.approvedContentRevisions,
            record.activatedContentRevisions
          ),
          effective: Boolean(record.effectiveOn && record.effectiveOn <= asOf),
          contentComplete: substantiveMarkdown(source) && placeholderCount === 0
        } : {
          active: record.status === "active",
          owner: currentPartyPeople(record.ownerIds, byId).size > 0,
          independentlyApproved: Boolean(
            record.approvedOn
            && partiesIndependent(record.ownerIds, record.approverIds, byId)
          ),
          effective: Boolean(record.effectiveOn && record.effectiveOn <= asOf),
          contentComplete: substantiveMarkdown(source) && placeholderCount === 0
        }
      : modelSupports(model, "governed-training-activation") ? {
          approvalBound: ["approved", "active"].includes(record.status)
            && Boolean(record.approvedOn)
            && Boolean(record.approvedContentRevisions)
            && partiesIndependent(record.ownerIds, record.approverIds, byId),
          owner: currentPartyPeople(record.ownerIds, byId).size > 0,
          active: record.status === "active",
          requirementsImplemented: linkedControlIds.length > 0 && missingImplementationControlIds.length === 0,
          assignmentScheduled: enabledObligations.some((obligation) => (
            obligation.templateResourceId === record.id
            || (obligation.scopeResourceIds || []).includes(record.id)
          )),
          activationRecorded: ["recorded", "legacy-v5"].includes(record.activationBasis),
          activated: record.activationBasis === "legacy-v5" || Boolean(record.activatedOn),
          activator: record.activationBasis === "legacy-v5" || Boolean((record.activatedByIds || []).length)
            && record.activatedByIds.every((id) => personWasActiveOn(byId.get(id), record.activatedOn)),
          activatedContent: record.activationBasis === "legacy-v5" || Boolean(record.activatedContentRevisions),
          activationMatchesApproval: record.activationBasis === "legacy-v5" || contentRevisionBindingsMatch(
            record.approvedContentRevisions,
            record.activatedContentRevisions
          ),
          effective: Boolean(record.effectiveOn && record.effectiveOn <= asOf),
          contentComplete: substantiveMarkdown(source) && placeholderCount === 0
        } : {
          active: record.status === "active",
          owner: currentPartyPeople(record.ownerIds, byId).size > 0,
          approved: Boolean(record.approvedOn && (record.approvedByIds || []).length),
          effective: Boolean(record.effectiveOn && record.effectiveOn <= asOf),
          effectiveContent: Boolean(record.effectiveContentRevisions),
          contentComplete: substantiveMarkdown(source) && placeholderCount === 0
        };
    const missing = Object.entries(checks)
      .filter(([, value]) => !value)
      .map(([name]) => governedContentCheckLabel(name));
    if (record.type === "document" && modelSupports(model, "governed-document-activation")) {
      const activationComplete = Object.values(checks).every(Boolean);
      const preActivationCheckNames = ["approvalBound", "owner", "requirementsImplemented", "contentComplete"];
      const preActivationGapCount = preActivationCheckNames.filter((name) => !checks[name]).length;
      const readyToActivate = record.status === "approved"
        && checks.approvalBound
        && checks.owner
        && checks.requirementsImplemented
        && checks.contentComplete;
      const state = record.status === "active" && activationComplete
        ? "active-and-operating"
        : record.status === "active"
          ? "active-with-gaps"
          : readyToActivate
          ? "ready-to-activate"
          : record.status === "approved"
            ? "approved-implementation-pending"
            : "approval-pending";
      documentActivations.push({
        documentId: record.id,
        title: record.title,
        state,
        label: documentActivationLabel(state),
        approvedOn: record.approvedOn || null,
        activatedOn: record.activatedOn || null,
        effectiveOn: record.effectiveOn || null,
        linkedControlIds,
        missingImplementationControlIds,
        activationRevisionBound: Boolean(record.activatedContentRevisions),
        activatedByIds: record.activatedByIds || [],
        gapCount: record.status === "active" ? missing.length : preActivationGapCount
      });
    }
    if (record.type === "training" && modelSupports(model, "governed-training-activation")) {
      const activationComplete = Object.values(checks).every(Boolean);
      const preActivationCheckNames = ["approvalBound", "owner", "requirementsImplemented", "assignmentScheduled", "contentComplete"];
      const preActivationGapCount = preActivationCheckNames.filter((name) => !checks[name]).length;
      const readyToActivate = record.status === "approved"
        && preActivationCheckNames.every((name) => checks[name]);
      const state = record.status === "active" && activationComplete
        ? "active-and-operating"
        : record.status === "active"
          ? "active-with-gaps"
          : readyToActivate
            ? "ready-to-activate"
            : record.status === "approved"
              ? "approved-implementation-pending"
              : "approval-pending";
      trainingActivations.push({
        trainingId: record.id,
        title: record.title,
        state,
        label: documentActivationLabel(state),
        approvedOn: record.approvedOn || null,
        activatedOn: record.activatedOn || null,
        effectiveOn: record.effectiveOn || null,
        linkedControlIds,
        missingImplementationControlIds,
        assignmentScheduled: checks.assignmentScheduled,
        activationRevisionBound: Boolean(record.activatedContentRevisions),
        activatedByIds: record.activatedByIds || [],
        gapCount: record.status === "active" ? missing.length : preActivationGapCount
      });
    }
    items.push(item(
      `${record.type}-${record.id}`,
      missing.length ? "action" : "complete",
      record.title,
      missing.length
        ? `Remaining governed-content work: ${missing.join(", ")}${placeholderCount ? ` (${placeholderCount} open placeholders)` : ""}.`
        : record.type === "document"
          ? modelSupports(model, "governed-document-activation")
            ? `Approved on ${record.approvedOn}, activated separately on ${record.activatedOn}, effective ${record.effectiveOn}, revision-bound at both events, and ready for operation.`
            : `Active, approved by a separate reviewer, effective ${record.effectiveOn}, and ready for the selected Controls or running schedule.`
          : `Active, approved, effective ${record.effectiveOn}, revision-bound, and ready for the running training schedule.`,
      record,
      {
        checks,
        placeholderCount,
        ...(["document", "training"].includes(record.type) ? { linkedControlIds, missingImplementationControlIds } : {}),
        commands: [
          `npx filegrc get ${shellArgument(record.id)} --mutation`,
          `npx filegrc update ${record.type} ${shellArgument(record.id)} MUTATION.json --json`,
          "npx filegrc program-readiness --json"
        ]
      }
    ));
  }
  return { items, documentActivations, trainingActivations };
}

function documentActivationLabel(state) {
  return ({
    "approval-pending": "Approval pending in Step 2",
    "approved-implementation-pending": "Approved, implementation pending",
    "ready-to-activate": "Ready to activate",
    "active-with-gaps": "Active with activation or implementation gaps",
    "active-and-operating": "Active and operating"
  })[state] || state;
}

async function assessPolicyActivations(policies, controls, records, byId, readMarkdown, asOf, model) {
  const sourceType = modelSupports(model, "component-sources") ? "component" : "system";
  const sourceField = modelSupports(model, "component-sources") ? "evidenceSourceComponentIds" : "evidenceSourceIds";
  const assessments = [];
  for (const policy of policies.filter((record) => ["approved", "active"].includes(record.status))) {
    const linkedControls = controls.filter((control) => (control.policyIds || []).includes(policy.id));
    const linkedControlIds = linkedControls.map(({ id }) => id);
    const plannedOrPartialControlIds = linkedControls
      .filter((control) => ["planned", "partially-implemented"].includes(control.status))
      .map(({ id }) => id);
    const missingComponentControlIds = modelSupports(model, "component-sources")
      ? linkedControls.filter((control) => ![
          ...(control.componentIds || []),
          ...(control.evidenceSourceComponentIds || [])
        ].some((id) => (
          byId.get(id)?.type === "component" && byId.get(id).status === "active"
        ))).map(({ id }) => id)
      : [];
    const missingEvidenceSourceControlIds = [];
    for (const control of linkedControls) {
      const readySources = [];
      for (const id of control[sourceField] || []) {
        const source = byId.get(id);
        if (source?.type !== sourceType || source.status !== "active") continue;
        const instructions = await readMarkdown(source);
        if (
          (source.evidenceSourceKinds || []).length
          && (source.evidenceOwnerIds || []).length
          && substantiveMarkdown(instructions)
          && openPlaceholderCount(instructions) === 0
        ) readySources.push(source);
      }
      if (!readySources.length) missingEvidenceSourceControlIds.push(control.id);
    }
    const missingScheduleControlIds = linkedControls.filter((control) => (
      ["scheduled", "event-driven", "mixed"].includes(control.operationPattern)
      && !records.some((record) => (
        record.type === "obligation"
        && obligationIsEnabled(record)
        && (record.controlIds || []).includes(control.id)
        && (record.policyIds || []).includes(policy.id)
      ))
    )).map(({ id }) => id);
    const linkedGovernedDocumentIds = modelSupports(model, "governed-document-activation")
      ? (policy.relatedDocumentIds || []).filter((id) => {
          const document = byId.get(id);
          return document?.type === "document"
            && !["superseded", "retired"].includes(document.status)
            && !documentIsAuditSpecific(document, model);
        })
      : [];
    const missingGovernedDocumentIds = linkedGovernedDocumentIds.filter((id) => {
      const document = byId.get(id);
      return !governedDocumentIsOperating(document, asOf, model);
    });
    const relevantExceptions = records.filter((record) => (
      record.type === "exception"
      && (record.scopeResourceIds || []).some((id) => id === policy.id || linkedControlIds.includes(id))
      && !["revoked", "closed"].includes(record.status)
    ));
    const unresolvedExceptionIds = relevantExceptions.filter((record) => (
      record.status !== "approved"
      || !record.approval?.expiresOn
      || record.approval.expiresOn < asOf
    )).map(({ id }) => id);
    const documentedExceptionIds = relevantExceptions.filter((record) => (
      record.status === "approved"
      && record.approval?.expiresOn
      && record.approval.expiresOn >= asOf
    )).map(({ id }) => id);
    const timingWarnings = [
      policy.proposedEffectiveOn && policy.proposedEffectiveOn < asOf
        ? `The proposed effective date ${policy.proposedEffectiveOn} has passed. Choose a current or future activation date; do not backdate adoption.`
        : null,
      policy.status === "active" && (!policy.effectiveOn || policy.effectiveOn > asOf)
        ? policy.effectiveOn
          ? `The Policy is marked active but does not become effective until ${policy.effectiveOn}. Governed Obligations remain dormant until then.`
          : "The Policy is marked active without an effective date."
        : null
    ].filter(Boolean);
    const gapCount = plannedOrPartialControlIds.length
      + missingComponentControlIds.length
      + missingEvidenceSourceControlIds.length
      + missingScheduleControlIds.length
      + missingGovernedDocumentIds.length
      + unresolvedExceptionIds.length
      + timingWarnings.length;
    const activeNow = policy.status === "active" && policy.effectiveOn && policy.effectiveOn <= asOf;
    const state = activeNow
      ? gapCount ? "active-with-implementation-gaps" : "active-and-operating"
      : policy.status === "approved" && gapCount === 0
        ? "ready-to-activate"
        : policy.status === "approved"
          ? "approved-implementation-pending"
          : "active-with-implementation-gaps";
    assessments.push({
      policyId: policy.id,
      title: policy.title,
      state,
      label: policyActivationLabel(state),
      approvedOn: policy.approvedOn || null,
      effectiveOn: policy.effectiveOn || null,
      proposedEffectiveOn: policy.proposedEffectiveOn || null,
      linkedControlIds,
      plannedOrPartialControlIds,
      missingComponentControlIds,
      missingEvidenceSourceControlIds,
      missingScheduleControlIds,
      linkedGovernedDocumentIds,
      missingGovernedDocumentIds,
      unresolvedExceptionIds,
      documentedExceptionIds,
      timingWarnings,
      gapCount,
      canActivateWithDocumentedGaps: policy.status === "approved",
      activationWarning: gapCount
        ? policy.status === "approved"
          ? "You can activate the Policy with a documented gap or approved Exception. Activation does not mark a Control implemented, and Evidence Readiness stays incomplete until the remaining work is done."
          : "The Policy is active, but the remaining gaps keep Evidence Readiness incomplete. Resolve them or record the applicable time-bound Exception."
        : null
    });
  }
  return assessments;
}

function policyActivationLabel(state) {
  return ({
    "approved-implementation-pending": "Approved, implementation pending",
    "ready-to-activate": "Ready to activate",
    "active-with-implementation-gaps": "Active with implementation gaps",
    "active-and-operating": "Active and operating"
  })[state] || state;
}

function policyActivationItem(assessment) {
  const counts = [
    [assessment.plannedOrPartialControlIds.length, "planned or partial Controls"],
    [assessment.missingComponentControlIds.length, "Controls missing active Components"],
    [assessment.missingEvidenceSourceControlIds.length, "Controls missing ready evidence sources"],
    [assessment.missingScheduleControlIds.length, "Controls missing enabled Obligations"],
    [assessment.missingGovernedDocumentIds?.length || 0, "required governed Documents not active"],
    [assessment.unresolvedExceptionIds.length, "unresolved Exceptions"]
  ].filter(([count]) => count).map(([count, label]) => `${count} ${label}`);
  const message = assessment.state === "active-and-operating"
    ? `Active and effective ${assessment.effectiveOn}; all ${assessment.linkedControlIds.length} linked Controls are implemented with Components, evidence sources, and enabled Obligations.`
    : assessment.state === "ready-to-activate"
      ? "Implementation checks are complete. Include this approved Policy in the Step 3 cutover when you are ready for it to take effect."
      : `${assessment.label}: ${counts.join(", ") || assessment.timingWarnings.join(" ")}. ${assessment.activationWarning || ""}`.trim();
  return item(
    `policy-activation-${assessment.policyId}`,
    assessment.state === "active-and-operating" ? "complete" : "action",
    `${assessment.title}: ${assessment.label}`,
    message,
    { type: "policy", id: assessment.policyId },
    {
      activationAssessment: assessment,
      commands: [
        "npx filegrc activate-policies --scaffold > policy-activation.json",
        "npx filegrc activate-policies policy-activation.json --preview --json",
        "npx filegrc program-readiness --json"
      ]
    }
  );
}

function legacyPolicyLibraryProposals(records) {
  const legacyIds = [
    "policy-anti-bribery-corruption",
    "policy-clear-desk-screen",
    "policy-data-protection-handling",
    "policy-employee-handbook",
    "policy-endpoint-remote-work",
    "policy-mobile-computing-communications"
  ];
  const presentIds = legacyIds.filter((id) => records.some((record) => record.type === "policy" && record.id === id));
  if (!presentIds.length) return [];
  return [{
    id: "consolidate-soc2-security-policy",
    title: "Review the minimal SOC 2 Security Policy consolidation",
    policyIds: presentIds,
    status: "review",
    message: "New Security-core workspaces use one Information Security Policy. Review a proposed replacement and Control remapping before superseding absorbed Policies. Keep employment, anti-bribery, privacy, or other broader records outside the SOC 2 Security scope when the organization still uses them. FileGRC never rewrites established content during an upgrade."
  }];
}

async function controlsStage(scope, byId, readMarkdown, asOf, model) {
  const items = [];
  const families = selectedControlFamilies(scope.controls, model);
  if (!scope.controls.length) {
    items.push(item("control-scope", "action", "Select the program controls", "No controls are selected for the management program.", { type: "control" }));
  }
  for (const control of scope.controls) {
    const controlFamilies = families.filter((family) => family.controls.some(({ id }) => id === control.id));
    const source = await readMarkdown(control);
    const sourceSystems = (
      modelSupports(model, "component-sources")
        ? control.evidenceSourceComponentIds || []
        : control.evidenceSourceIds || []
    ).map((id) => byId.get(id)).filter((record) => record?.type === (modelSupports(model, "component-sources") ? "component" : "system"));
    const queueSchedules = [...byId.values()].filter((record) => (
      record.type === "obligation"
      && record.status !== "retired"
      && (record.controlIds || []).includes(control.id)
    ));
    const sourceDetails = await Promise.all(sourceSystems.map(async (sourceRecord) => ({
      record: sourceRecord,
      instructions: await readMarkdown(sourceRecord)
    })));
    const missingSourceFamilies = controlFamilies.filter((family) => !sourceDetails.some(({ record, instructions }) => (
      record.status === "active"
      && (record.evidenceSourceKinds || []).length > 0
      && (!family.sourceKinds.length || family.sourceKinds.some((kind) => (record.evidenceSourceKinds || []).includes(kind)))
      && (record.evidenceOwnerIds || []).length > 0
      && substantiveMarkdown(instructions)
      && openPlaceholderCount(instructions) === 0
    )));
    const checks = {
      ...(model.resources.control?.fields?.applicabilityReview ? {
        applicability: control.applicabilityReview?.decision === "applicable"
          && applicabilityReviewIsCurrent(control.applicabilityReview, control, scope.program, [...byId.values()], model)
      } : {}),
      implemented: control.status === "implemented",
      owner: (control.ownerIds || []).length > 0,
      procedure: substantiveMarkdown(source) && openPlaceholderCount(source) === 0,
      scope: (control.systemIds || []).some((id) => scope.systems.some((system) => system.id === id)),
      operationPattern: Boolean(control.operationPattern),
      evidenceSource: sourceSystems.length > 0,
      ...(modelSupports(model, "component-sources") ? {
        evidenceSourceReady: missingSourceFamilies.length === 0
      } : {}),
      implementationDate: Boolean(control.effectiveOn && control.effectiveOn <= asOf),
      ...(model.resources.control?.fields?.procedureRevision ? {
        procedureRevision: Boolean(control.procedureRevision),
        procedureEffective: Boolean(control.procedureEffectiveOn && control.procedureEffectiveOn <= asOf)
      } : {}),
      policyMapping: (control.policyIds || []).length > 0,
      criteriaMapping: (control.requirementIds || []).length > 0,
      ...(["scheduled", "event-driven", "mixed"].includes(control.operationPattern) ? {
        workQueue: queueSchedules.length > 0
          && queueSchedules.some(obligationIsEnabled)
      } : {})
    };
    const missing = Object.entries(checks).filter(([, value]) => !value).map(([name]) => controlCheckLabel(name));
    const nextSteps = controlImplementationSteps(control, checks, {
      missingSourceFamilies
    });
    items.push(item(
      `control-${control.id}`,
      missing.length ? "action" : "complete",
      `${control.code ? `${control.code}: ` : ""}${control.title}`,
      missing.length
        ? nextSteps[0] || `Complete the remaining Control checks: ${missing.join(", ")}.`
        : `Implemented ${control.effectiveOn}; owned, scoped, scheduled, documented, mapped, and tied to ${sourceSystems.length} authoritative ${sourceSystems.length === 1 ? "source" : "sources"}.`,
      control,
      {
        checks,
        nextSteps,
        commands: [`npx filegrc get ${shellArgument(control.id)} --mutation`],
        workQueue: queueSchedules.length ? {
          enabled: queueSchedules.filter(obligationIsEnabled).length,
          running: queueSchedules.filter((obligation) => obligationIsRunning(obligation, byId, asOf, model)).length,
          total: queueSchedules.length
        } : null
      }
    ));
  }
  return stage("controls", "Implement Controls", "Put each selected Control in place, record how it works, and mark it Implemented when it is working.", items);
}

async function evidenceSourcesStage(scope, byId, model, readMarkdown) {
  const families = selectedControlFamilies(scope.controls, model);
  const items = [];
  for (const family of families) {
    const componentSources = modelSupports(model, "component-sources");
    const sourceField = componentSources ? "evidenceSourceComponentIds" : "evidenceSourceIds";
    const sourceType = componentSources ? "component" : "system";
    const selectedSources = [...new Set(family.controls.flatMap((control) => control[sourceField] || []))]
      .map((id) => byId.get(id))
      .filter((record) => (
        record?.type === sourceType
        && (
          !(record.evidenceSourceKinds || []).length
          || family.sourceKinds.some((kind) => (record.evidenceSourceKinds || []).includes(kind))
        )
      ));
    const completeSources = [];
    const sourceChecks = [];
    for (const source of selectedSources) {
      const instructions = await readMarkdown(source);
      const matchesRole = !family.sourceKinds.length
        || family.sourceKinds.some((kind) => (source.evidenceSourceKinds || []).includes(kind));
      const checks = {
        active: source.status === "active",
        sourceRole: matchesRole && (source.evidenceSourceKinds || []).length > 0,
        accessOwners: (source.evidenceOwnerIds || []).length > 0,
        retrievalInstructions: substantiveMarkdown(instructions) && openPlaceholderCount(instructions) === 0
      };
      const complete = Object.values(checks).every(Boolean);
      sourceChecks.push({
        [componentSources ? "sourceComponentId" : "sourceSystemId"]: source.id,
        complete,
        checks
      });
      if (complete) {
        completeSources.push(source);
      }
    }
    const controlMappings = family.controls.map((control) => {
      const sourceIds = (control[sourceField] || []).filter((id) => selectedSources.some((source) => source.id === id));
      const completeSourceIds = sourceIds.filter((id) => completeSources.some((source) => source.id === id));
      return {
        controlId: control.id,
        [componentSources ? "sourceComponentIds" : "sourceSystemIds"]: sourceIds,
        [componentSources ? "completeSourceComponentIds" : "completeSourceSystemIds"]: completeSourceIds,
        mapped: sourceIds.length > 0,
        complete: completeSourceIds.length > 0
      };
    });
    const coveredControls = controlMappings.filter(({ complete }) => complete);
    const complete = completeSources.length > 0 && coveredControls.length === family.controls.length;
    const commands = [
      ...(selectedSources.length
        ? sourceChecks.filter(({ complete: sourceComplete }) => !sourceComplete).flatMap((sourceCheck) => {
            const sourceId = sourceCheck.sourceComponentId || sourceCheck.sourceSystemId;
            return [
            `npx filegrc get ${shellArgument(sourceId)} --mutation > /tmp/${shellArgument(sourceId)}.json`,
            `npx filegrc update ${sourceType} ${shellArgument(sourceId)} /tmp/${shellArgument(sourceId)}.json --json`
            ];
          })
        : [
            `npx filegrc list ${sourceType} --json`,
            `npx filegrc scaffold ${sourceType} --title "${componentSources ? "COMPONENT" : "SYSTEM"} NAME" > /tmp/filegrc-${sourceType}.json`,
            `npx filegrc create /tmp/filegrc-${sourceType}.json --json`
          ]),
      ...controlMappings.filter(({ mapped }) => !mapped).flatMap(({ controlId }) => [
        `npx filegrc get ${shellArgument(controlId)} --mutation > /tmp/${shellArgument(controlId)}.json`,
        `npx filegrc update control ${shellArgument(controlId)} /tmp/${shellArgument(controlId)}.json --json`
      ]),
      "npx filegrc program-readiness --json"
    ];
    items.push(item(
      `source-family-${family.id}`,
      complete ? "complete" : "action",
      family.title,
      complete
        ? `${completeSources.map((source) => source.title).join(", ")} ${completeSources.length === 1 ? "covers" : "cover"} all ${family.controls.length} selected controls and record access owners and extraction instructions.`
        : `${coveredControls.length} of ${family.controls.length} selected controls have an active authoritative ${componentSources ? "Component" : "System"} with the required source role, access owners, and extraction instructions.`,
      completeSources[0] || selectedSources[0] || { type: sourceType },
      {
        progressUnit: false,
        familyId: family.id,
        sourceKinds: family.sourceKinds,
        controlIds: family.controls.map((control) => control.id),
        [componentSources ? "sourceComponentIds" : "sourceSystemIds"]: selectedSources.map((source) => source.id),
        [componentSources ? "completeSourceComponentIds" : "completeSourceSystemIds"]: completeSources.map((source) => source.id),
        [componentSources ? "sourceComponentChecks" : "sourceSystemChecks"]: sourceChecks,
        controlMappings,
        evidenceForm: family.evidenceForm,
        evidencePrompt: family.evidencePrompt,
        description: family.description,
        timing: family.timing,
        operationRecordTypes: family.operationRecordTypes,
        commands
      }
    ));
  }
  return stage("sources", "Control Evidence Sources", `Complete the authoritative ${modelSupports(model, "component-sources") ? "Components" : "Systems"} for every selected control family before marking the Controls implemented.`, items);
}

async function operationStage(loaded, workspace, scope, records, byId, asOf, evidenceReady, model, progressWindow = null) {
  const goal = workspace?.assuranceGoal || "none";
  if (!evidenceReady) {
    return stage("operation", "Operate the Program", "Run the controls and preserve dated evidence after the Evidence Ready gate passes.", [
      item(
        "operation-later",
        "later",
        "Begin reliable evidence collection",
        "Finish scope, policy adoption, and control implementation, including complete authoritative evidence sources, before recording the candidate period.",
        workspace || { type: "workspace" }
      )
    ]);
  }
  if (goal !== "soc-2-type-2") {
    const date = workspace?.candidateCoverage?.kind === "as-of"
      ? workspace.candidateCoverage.on
      : null;
    return stage("operation", "Operate the Program", "Run the controls and preserve dated evidence before engaging the CPA firm.", [
      item(
        "candidate-type-one-date",
        goal === "soc-2-type-1" && date ? "complete" : "info",
        goal === "soc-2-type-1" ? "Record the management candidate Type 1 date" : "Operate controls and preserve evidence",
        goal === "soc-2-type-1"
          ? date ? `Management candidate Type 1 date: ${date}. The CPA firm must still agree on the formal date.` : "Set the management candidate Type 1 date after the controls and evidence mechanisms are ready."
          : "The program can operate without an audit record. Keep dated evidence from every control occurrence.",
        workspace || { type: "workspace" }
      ),
      riskAssessmentItem(scope, records, byId, asOf)
    ]);
  }

  const obligations = planObligations(records, { programId: workspace.id, asOf, through: asOf, model });
  const start = progressWindow?.start || null;
  const end = progressWindow?.end || null;
  const formalWindow = progressWindow?.source === "audit";
  const startStatus = !start ? "action" : start <= asOf ? "complete" : "later";
  const sourceCoverage = await assessSourceCoverageReadiness(loaded, scope.controls.map(({ id }) => id), workspace);
  const incompleteSourceCoverage = sourceCoverage.filter(({ complete }) => !complete);
  return stage("operation", "Operate the Program", "Start the management candidate Type 2 period only after the Evidence Ready gate, then keep collection running.", [
    item(
      "evidence-running",
      startStatus,
      "Evidence collection running",
      !start
        ? "Set the management candidate period start when the Evidence Ready gate passes. Do not backdate it."
        : start <= asOf
          ? formalWindow
            ? `The auditor-agreed Type 2 period began on ${start}. Keep evidence collection and operating work current through the period.`
            : `Management began the candidate Type 2 evidence period on ${start}. This is not the auditor-agreed report period.`
          : `Evidence collection is scheduled to begin on ${start}.`,
      workspace
    ),
    item(
      "candidate-period-end",
      end ? "complete" : start ? "later" : "info",
      formalWindow ? "Confirm the auditor-agreed period end" : "Plan the candidate period end",
      end
        ? formalWindow
          ? `Auditor-agreed period: ${start || "start not set"} through ${end}.`
          : `Management candidate period: ${start || "start not set"} through ${end}. The CPA firm may agree to different dates.`
        : "Add the management target end when useful. Starting reliable evidence collection is the immediate milestone.",
      workspace
    ),
    item(
      "source-readiness-tests",
      !start ? "later" : incompleteSourceCoverage.length ? "action" : "complete",
      "Pass the evidence-source retrieval dry runs",
      !start
        ? "Set the candidate period before recording the pre-period source retrieval tests."
        : incompleteSourceCoverage.length
          ? `${incompleteSourceCoverage.length} source ${incompleteSourceCoverage.length === 1 ? "family needs" : "families need"} a passed retrieval test with confirmed access before the program is operating.`
          : `${sourceCoverage.length} source ${sourceCoverage.length === 1 ? "family has" : "families have"} passed retrieval tests with confirmed access.`,
      { type: "source-coverage" },
      {
        sourceFamilyIds: incompleteSourceCoverage.map(({ family }) => family.id),
        resourceIds: incompleteSourceCoverage.map(({ record }) => record?.id).filter(Boolean),
        commands: [
          "npx filegrc list source-coverage --workflow --json",
          "npx filegrc guide evidence --json",
          "npx filegrc program-readiness --json"
        ]
      }
    ),
    item(
      "ongoing-obligations",
      obligations.counts.overdue || obligations.counts.blocked ? "action" : "complete",
      "Keep policy work current",
      obligations.counts.overdue
        ? `${obligations.counts.overdue} Work Queue ${obligations.counts.overdue === 1 ? "item is" : "items are"} overdue`
          + (obligations.counts.blocked ? ` and ${obligations.counts.blocked} ${obligations.counts.blocked === 1 ? "is" : "are"} blocked` : "")
          + ". Resolve the work and retain its dated proof."
        : obligations.counts.blocked
          ? `${obligations.counts.blocked} Work Queue ${obligations.counts.blocked === 1 ? "item is" : "items are"} blocked. Open each task, review its named blockers, and resolve them before completion.`
          : `${obligations.counts.due} due and ${obligations.counts.upcoming} upcoming Work Queue items; none are overdue or blocked.`,
      { type: "obligation" },
      {
        commands: [
          "npx filegrc obligations --json",
          "npx filegrc workflow --json"
        ]
      }
    ),
    riskAssessmentItem(scope, records, byId, asOf)
  ]);
}

function riskAssessmentItem(scope, records, byId, asOf) {
  const assessment = records.find((record) => (
    record.type === "risk-assessment"
    && record.status === "complete"
    && record.methodology
    && record.approvedOn
    && record.completedOn >= shiftYear(asOf, -1)
    && partiesIndependent(record.assessorIds, record.reviewerIds, byId)
    && (!scope.systems.length || !(record.systemIds || []).length || record.systemIds.some((id) => scope.systems.some((system) => system.id === id)))
  ));
  return item(
    "risk-assessment",
    assessment ? "complete" : "action",
    "Maintain the current risk assessment",
    assessment
      ? `${assessment.title} is complete, approved, current, and independently reviewed. Update the risk register and control set when its conclusions require changes.`
      : "Complete and approve a current risk assessment for the operating program with a reviewer separate from the assessor, then add or update risks and controls as needed.",
    assessment || { type: "risk-assessment" }
  );
}

export function selectedControlFamilies(controls, model) {
  const remaining = new Set(controls.map((control) => control.id));
  const families = [];
  for (const definition of model.evidenceSourceFamilies || []) {
    const selected = controls.filter((control) => (definition.controlCodes || []).includes(control.code));
    if (!selected.length) continue;
    selected.forEach((control) => remaining.delete(control.id));
    families.push({
      id: definition.id,
      title: definition.title,
      sourceKinds: definition.sourceKinds || [],
      evidenceForm: definition.evidenceForm || "capture",
      evidencePrompt: definition.evidencePrompt || `Retain usable evidence for ${definition.title.toLowerCase()}.`,
      description: definition.description || "",
      timing: definition.timing || "",
      operationRecordTypes: definition.operationRecordTypes || [],
      controls: selected
    });
  }
  const byPrefix = new Map();
  for (const control of controls.filter((record) => remaining.has(record.id))) {
    const prefix = String(control.code || control.id).split("-")[0].toLowerCase();
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
    byPrefix.get(prefix).push(control);
  }
  for (const [prefix, selected] of byPrefix) {
    const title = ({
      data: "Data Handling",
      gov: "Governance",
      net: "Network Security",
      rsk: "Risk Management"
    })[prefix] || `${prefix.toUpperCase()} Controls`;
    families.push({
      id: `control-${prefix}`,
      title,
      sourceKinds: [],
      evidenceForm: "capture",
      evidencePrompt: `Retain usable evidence for the selected ${title.toLowerCase()} controls.`,
      description: `Record the authoritative Systems that produce evidence for the selected ${title.toLowerCase()} controls.`,
      timing: "Map the source and document repeatable retrieval before program operation begins.",
      operationRecordTypes: [],
      controls: selected
    });
  }
  return families;
}

async function primaryMarkdown(loaded, record) {
  const definition = loaded.model.resources[record.type];
  const selected = markdownEntries(loaded.model, record).find((entry) => (
    definition.markdown?.[entry.name]?.primary || entry.name === loaded.model.recordContent?.slot
  ));
  if (!selected) return "";
  try {
    return await readFile(resolveDataPath(loaded.root, selected.path), "utf8");
  } catch {
    return "";
  }
}

function controlIdsForRecord(record, byId, seen = new Set()) {
  const ids = new Set();
  if (!record || seen.has(record.id)) return ids;
  seen.add(record.id);
  if (record.type === "control") ids.add(record.id);
  for (const id of record.controlIds || []) ids.add(id);
  if (record.controlId) ids.add(record.controlId);
  for (const sourceId of record.sourceResourceIds || []) {
    for (const id of controlIdsForRecord(byId.get(sourceId), byId, seen)) ids.add(id);
  }
  if (record.sourceResourceId) {
    for (const id of controlIdsForRecord(byId.get(record.sourceResourceId), byId, seen)) ids.add(id);
  }
  return ids;
}

function policyCheckLabel(name) {
  return ({
    reviewed: "draft review",
    independentlyApproved: "independent approval and approval date",
    effective: "active status and effective date",
    linkedControls: "linked controls",
    contentComplete: "policy text and organization placeholders"
  })[name] || name;
}

function governedApprovalCheckLabel(name) {
  return ({
    independentlyApproved: "independent approval and approval date",
    owner: "current owner",
    linkedControls: "linked Controls",
    contentComplete: "intended values, content, and organization placeholders",
    systemContinuityObjectives: "RTO, RPO, and maximum tolerable downtime for every in-scope System"
  })[name] || name;
}

function governedContentCheckLabel(name) {
  return ({
    approvalBound: "Step 2 independent approval and approved revision",
    active: "active status",
    owner: "current owner",
    independentlyApproved: "independent approval and approval date",
    approved: "approval and approval date",
    effective: "effective date",
    effectiveContent: "effective content revision",
    requirementsImplemented: "implemented linked requirements",
    assignmentScheduled: "enabled Training assignment schedule",
    activationRecorded: "recorded activation basis",
    activated: "separate activation date",
    activator: "named activation Person",
    activatedContent: "separate activated content revision",
    activationMatchesApproval: "unchanged approved revision at activation",
    contentComplete: "content and organization placeholders",
    systemContinuityObjectives: "RTO, RPO, and maximum tolerable downtime for every in-scope System"
  })[name] || name;
}

function controlCheckLabel(name) {
  return ({
    applicability: "reviewed applicability decision",
    implemented: "implemented status",
    owner: "owner",
    procedure: "actual procedure in Record Markdown",
    scope: "in-scope systems",
    operationPattern: "operation pattern",
    evidenceSource: "authoritative evidence source",
    evidenceSourceReady: "usable evidence source",
    implementationDate: "implementation date",
    procedureRevision: "effective procedure revision",
    procedureEffective: "procedure effective date",
    policyMapping: "policy mapping",
    criteriaMapping: "criteria mapping",
    workQueue: "running Obligation schedules"
  })[name] || name;
}

const starterControlSetup = {
  "control-security-governance": "Name a reviewer outside day-to-day security ownership and set up a quarterly security review.",
  "control-policy-management": "Assign someone to maintain the Control list and a separate approver for policies and plans. Set up their review path.",
  "control-security-communication": "Set up how the approved reporting routes, policy changes, and security notices reach staff and outside parties.",
  "control-workforce-expectations": "Set up the checks, agreements, and policy acknowledgements required before someone receives sensitive access.",
  "control-security-training": "Choose how new and existing workers receive security training, acknowledge the current material, and get reminders.",
  "control-risk-assessment": "Use the Program's risk method to assess the scoped service and record the results in FileGRC Risk Assessments and Risks.",
  "control-monitoring-remediation": "Define how Control problems are reported, reviewed, and verified closed. Use FileGRC Findings for gaps that need separate follow-up.",
  "control-access-authorization": "Configure unique, least-privilege accounts in the identity system. Restrict account changes to authorized admins.",
  "control-strong-authentication": "Turn on required MFA and secure sign-in settings for the in-scope Systems. Identify any gap that needs an approved Exception.",
  "control-access-review-offboarding": "Confirm the identity system can produce a complete access list and admins can promptly remove or change permissions.",
  "control-physical-workspace-security": "Decide how visitors, work areas, devices, and paper records are protected in the places your team actually works.",
  "control-data-classification-inventory": "Apply the approved Classifications to important data in the in-scope Systems and record its location in the inventory.",
  "control-encryption-transmission": "Configure encryption for in-scope data and devices, and assign who manages keys and approved transfer methods.",
  "control-data-retention-disposal": "Apply the approved retention schedule to live, backup, and vendor-held data. Define how each class is deleted or destroyed.",
  "control-inventory-configuration": "List important assets and owners, choose their secure settings, and decide how unsupported assets are handled.",
  "control-endpoint-protection": "Apply the required device settings, updates, encryption, screen lock, and malware protection to devices that access company Systems.",
  "control-network-security": "Restrict production network paths and remote access, and document the rules that allow traffic between environments.",
  "control-change-management": "Set up a change path with risk review, testing, approval, deployment, and rollback for software and infrastructure changes.",
  "control-vulnerability-management": "Choose what will be scanned, how often, who handles findings, and the target times for fixing them.",
  "control-penetration-testing": "Decide whether independent testing is needed for this service. If it is, set its scope, cadence, and owner.",
  "control-logging-monitoring": "Enable useful security logs and alerts for important Systems, protect them, and choose who responds to alerts.",
  "control-incident-response": "Set up a way to report, assign, escalate, contain, and close security incidents using the approved response plan.",
  "control-incident-exercise": "Choose a realistic incident scenario and an alert path to test, and assign the people who will run the exercise.",
  "control-backup-restoration": "Choose what needs backup or another recovery path, configure it, and decide how restores will be tested.",
  "control-continuity-exercise": "Set recovery priorities, contacts, and responsibilities, and choose how the continuity plan will be exercised.",
  "control-vendor-due-diligence": "Set a security review and contract check before a new Vendor gets sensitive data or becomes a material dependency.",
  "control-vendor-monitoring": "Choose which Vendors need ongoing review, who reviews them, and what information the review uses.",
  "control-security-exceptions": "Document how an Exception is reviewed and approved before a departure from policy begins. Record actual decisions in FileGRC Exceptions."
};

export function controlImplementationSteps(control, checks, options = {}) {
  const steps = [];
  if (!checks.implemented) steps.push(starterControlSetup[control.id]
    || `Set up this Control: ${control.activity || control.statement}`);
  const record = [];
  if (!checks.owner) record.push("choose an owner");
  if (!checks.scope) record.push("select the Systems this covers");
  if (!checks.operationPattern) record.push("set when it runs");
  if (!checks.procedure) record.push("write who does what and when in Procedure");
  if (!checks.evidenceSource) record.push("link the tool or system that can show it happened");
  if (!checks.policyMapping && checks.policyMapping !== undefined) record.push("link the Policy it implements");
  if (!checks.criteriaMapping && checks.criteriaMapping !== undefined) record.push("link the criteria it covers");
  if (checks.implemented && !checks.implementationDate) record.push("enter the date it started working");
  if (checks.implemented && (checks.procedureRevision === false || checks.procedureEffective === false)) {
    record.push("record the Procedure revision and effective date");
  }
  if (record.length) steps.push(`In this Control, ${record.join("; ")}.`);
  const sourceFamilies = options.missingSourceFamilies || [];
  const sourceTargets = sourceFamilies.map((family) => `${family.title}${family.sourceKinds?.length ? ` (${family.sourceKinds.join(" or ")})` : ""}`);
  const sourceStep = checks.evidenceSourceReady === false
    ? `Cover the missing evidence families: ${sourceTargets.length ? sourceTargets.join(" and ") : "this Control"}. For each, link an active Component with the matching kind, evidence owners, and report retrieval instructions.`
    : null;
  const queueStep = checks.workQueue === false
    ? "Enable a linked Obligation with the owner and schedule for this Control's recurring or event work."
    : null;
  if (!checks.implemented) {
    if (sourceStep || queueStep) steps.push([sourceStep, queueStep].filter(Boolean).join(" "));
    else if (checks.applicability === false) steps.push("Confirm this Control applies to the current Program scope with `review-applicability --scaffold --type control`.");
    else steps.push(checks.procedureRevision === undefined
      ? "When it works, mark this Control Implemented and enter its start date."
      : "When it works, mark this Control Implemented. Enter its start date and the Procedure revision and effective date.");
  } else {
    if (sourceStep) steps.push(sourceStep);
    if (queueStep) steps.push(queueStep);
    if (checks.applicability === false) steps.push("Confirm this Control applies to the current Program scope with `review-applicability --scaffold --type control`.");
  }
  return steps;
}

function assuranceGoalLabel(goal) {
  if (goal === "soc-2-type-1") return "SOC 2 Type 1";
  if (goal === "soc-2-type-2") return "SOC 2 Type 2";
  if (goal === "readiness") return "SOC 2 program readiness";
  return "No assurance goal selected";
}

function isDescriptionRequirement(requirement) {
  return (requirement?.tags || []).includes("description-criteria")
    || /^DC\d+/i.test(requirement?.reference || "");
}

function isAvailabilityRequirement(requirement) {
  return /^A1\./i.test(requirement?.reference || "");
}

function isSecurityRequirement(requirement) {
  const tags = requirement?.tags || [];
  return tags.includes("security") || tags.includes("common-criteria") || /^CC\d+(?:\.|$)/i.test(requirement?.reference || "");
}

function stage(id, title, description, items) {
  return { id, title, description, items };
}

function finalizeStage(current) {
  current.counts = countStatuses(current.items);
  current.status = current.counts.action ? "action" : current.counts.later ? "later" : "complete";
}

// A collection confirmation can be performed early, but an unfinished input
// would make it stale again. Derive the ordering from the same revision inputs
// used to decide whether that confirmation is current.
export function prioritizeReviewDependencies(stages, loaded, program) {
  const items = stages.flatMap(({ items }) => items);
  const edges = new Map(items.map((_, index) => [index, new Set()]));
  const indegree = items.map(() => 0);
  for (const [reviewIndex, review] of items.entries()) {
    if (review.status !== "action" || !review.id.startsWith("collection-review-")) continue;
    const resourceType = review.id.slice("collection-review-".length);
    if (!loaded.model.collectionReviews?.[resourceType]) continue;
    const inputTypes = new Set(collectionRevisionInputs(loaded, resourceType, program)
      .map(({ record }) => record.type));
    for (const type of collectionMembershipSourceTypes(resourceType)) inputTypes.add(type);
    const scopeFacts = collectionScopeRevisionFacts(loaded, resourceType, program);
    if (Object.keys(scopeFacts).some((key) => key !== "programId")) inputTypes.add("program");
    for (const key of Object.keys(scopeFacts)) {
      if (!key.endsWith("Ids")) continue;
      const type = key.slice(0, -3).replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
      if (loaded.model.resources?.[type]) inputTypes.add(type);
    }
    for (const [sourceIndex, source] of items.entries()) {
      if (sourceIndex === reviewIndex || source.status !== "action"
        || source.id.startsWith("collection-review-")
        || !inputTypes.has(source.resourceType)) continue;
      edges.get(sourceIndex).add(reviewIndex);
      indegree[reviewIndex]++;
    }
  }
  const remaining = new Set(items.map((_, index) => index));
  const ordered = [];
  while (remaining.size) {
    const next = [...remaining].find((index) => indegree[index] === 0);
    if (next === undefined) break;
    remaining.delete(next);
    ordered.push(items[next]);
    for (const dependent of edges.get(next)) indegree[dependent]--;
  }
  if (ordered.length !== items.length) return items;
  const rank = new Map(ordered.map((item, index) => [item, index]));
  for (const stage of stages) stage.items.sort((left, right) => rank.get(left) - rank.get(right));
  return ordered;
}

function item(id, status, title, message, resource = {}, details = {}) {
  return {
    id,
    status,
    title,
    message,
    ...(resource.type ? { resourceType: resource.type } : {}),
    ...(resource.id ? { resourceId: resource.id } : {}),
    ...details
  };
}

function shellArgument(value) {
  const text = String(value);
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(text)
    ? text
    : `'${text.replaceAll("'", "'\\''")}'`;
}

function countStatuses(items) {
  const counts = { complete: 0, action: 0, later: 0, info: 0 };
  for (const current of items) counts[current.status] = (counts[current.status] || 0) + 1;
  return counts;
}

export function selectedAuditWindow(records, program, asOf) {
  if (program?.assuranceGoal !== "soc-2-type-2") return null;
  const candidates = records.filter((record) => (
    record.type === "audit"
    && record.auditKind === "soc-2-type-2"
    && (!record.programId || record.programId === program.id)
    && !["canceled", "closed", "complete", "delivered"].includes(record.status)
    && normalizeProgressWindow(record.coverage)
    && coverageStart(record.coverage) <= asOf
  ));
  const statusOrder = new Map([
    ["planned", 0],
    ["in-progress", 1],
    ["fieldwork", 2],
    ["report-draft", 3],
    ["issued", 4]
  ]);
  candidates.sort((left, right) => (
    coverageStart(right.coverage).localeCompare(coverageStart(left.coverage))
    || (statusOrder.get(right.status) ?? -1) - (statusOrder.get(left.status) ?? -1)
    || coverageEnd(right.coverage).localeCompare(coverageEnd(left.coverage))
    || left.id.localeCompare(right.id)
  ));
  return candidates[0]?.coverage || null;
}

export function selectedProgressWindow(candidateCoverage, auditCoverage, asOf) {
  const candidates = [
    normalizeProgressWindow(candidateCoverage, "candidate"),
    normalizeProgressWindow(auditCoverage, "audit")
  ].filter((window) => window && (!asOf || window.start <= asOf));
  candidates.sort((left, right) => (
    right.start.localeCompare(left.start)
    || Number(right.source === "audit") - Number(left.source === "audit")
    || right.end.localeCompare(left.end)
  ));
  if (candidates.length) return candidates[0];
  return normalizeProgressWindow(candidateCoverage, "candidate")
    || normalizeProgressWindow(auditCoverage, "audit");
}

function normalizeProgressWindow(coverage, source = "candidate") {
  const start = coverage?.start || coverageStart(coverage);
  const end = coverage?.end || coverageEnd(coverage);
  if (!start || !end || end < start) return null;
  return { start, end, source: coverage?.source || source };
}

function calendarDayDistance(start, end) {
  const startTime = Date.parse(`${start}T00:00:00Z`);
  const endTime = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return 0;
  return Math.round((endTime - startTime) / 86_400_000);
}

function shiftYear(value, offset) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() + offset);
  return date.toISOString().slice(0, 10);
}
