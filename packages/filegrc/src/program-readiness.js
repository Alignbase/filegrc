import { readFile } from "node:fs/promises";
import { assessRequiredAppointments } from "./appointments.js";
import { assessCollectionReviews } from "./collection-review.js";
import { coverageEnd, coverageStart } from "./coverage.js";
import { planObligations } from "./obligations.js";
import { resolveDataPath } from "./paths.js";
import { obligationIsRunning } from "./program-lifecycle.js";
import { currentPartyPeople, partiesIndependent, partyPeople } from "./parties.js";
import { markdownEntries } from "./resource-markdown.js";
import { assessSourceCoverageReadiness } from "./source-coverage.js";
import { currentCalendarDate } from "./time.js";
import { loadWorkspace } from "./workspace.js";

export async function assessProgramReadiness(input, options = {}) {
  const loaded = input?.resources && input?.model && input?.entries
    ? input
    : await loadWorkspace(input);
  const records = loaded.resources;
  const byId = new Map(records.map((record) => [record.id, record]));
  const workspace = loaded.workspace || records.find((record) => record.type === "workspace");
  const asOf = options.asOf || currentCalendarDate(workspace?.timezone || "UTC");
  const scope = programScope(workspace, records, byId);
  const collectionReviews = assessCollectionReviews(loaded);
  const markdown = new Map();
  const readMarkdown = async (record) => {
    if (!record) return "";
    if (!markdown.has(record.id)) markdown.set(record.id, await primaryMarkdown(loaded, record));
    return markdown.get(record.id);
  };

  const controlStage = await controlsStage(scope, byId, readMarkdown, asOf, loaded.model);
  controlStage.items.unshift(...collectionReviews
    .filter(({ resourceType }) => resourceType === "complementary-control")
    .map(collectionReviewReadinessItem));
  const sourceStage = await evidenceSourcesStage(scope, byId, loaded.model, readMarkdown);
  controlStage.items.push(...sourceStage.items);
  controlStage.description = "Each implemented control needs an owner, actual procedure, scope, operation pattern, mappings, an implementation date, and complete authoritative source Systems with the required evidence roles, access owners, and retrieval instructions.";
  const evidenceGateStages = [
    scopeStage(
      workspace,
      scope,
      records,
      byId,
      loaded.model,
      collectionReviews.filter(({ resourceType }) => resourceType !== "complementary-control")
    ),
    await policiesStage(scope, records, byId, readMarkdown, asOf),
    controlStage
  ];
  for (const current of evidenceGateStages) finalizeStage(current);
  const evidenceReady = evidenceGateStages.every((current) => current.counts.action === 0);
  const stages = [
    ...evidenceGateStages,
    operationStage(loaded, workspace, scope, records, byId, asOf, evidenceReady, loaded.model)
  ];
  finalizeStage(stages.at(-1));
  const candidateStarted = Boolean(
    workspace?.assuranceGoal === "soc-2-type-2"
    && workspace.candidateCoverage?.kind === "range"
    && coverageStart(workspace.candidateCoverage) <= asOf
  );
  const obligations = planObligations(records, { asOf, through: asOf, model: loaded.model });
  const operating = evidenceReady && candidateStarted && stages.at(-1).counts.action === 0;
  const canStartCandidatePeriod = Boolean(
    evidenceReady
    && workspace?.assuranceGoal === "soc-2-type-2"
    && !workspace.candidateCoverage
  );
  const items = stages.flatMap((current) => current.items);
  const managedItems = items.filter((current) => !["info", "later"].includes(current.status));
  const complete = managedItems.filter((current) => current.status === "complete").length;
  const firstAction = items.find((current) => current.status === "action") || null;

  return {
    schemaVersion: 1,
    generatedAt: options.generatedAt || new Date().toISOString(),
    asOf,
    target: {
      goal: workspace?.assuranceGoal || "none",
      label: assuranceGoalLabel(workspace?.assuranceGoal),
      candidateCoverage: workspace?.candidateCoverage || null
    },
    status: operating ? "operating" : evidenceReady ? "evidence-ready" : "needs-work",
    evidenceReady,
    operating,
    canStartCandidatePeriod,
    suggestedCandidatePeriodStart: canStartCandidatePeriod ? asOf : null,
    progress: {
      complete,
      total: managedItems.length,
      percent: managedItems.length ? Math.round((complete / managedItems.length) * 100) : 0
    },
    counts: countStatuses(items),
    firstAction,
    scope: {
      systemIds: scope.systems.map((record) => record.id),
      frameworkIds: scope.frameworks.map((record) => record.id),
      requirementIds: scope.requirements.map((record) => record.id),
      controlIds: scope.controls.map((record) => record.id)
    },
    stages
  };
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
      "Choose an existing System or create the System that is authoritative for each evidence family.",
      "On every source System, set an evidence source role, name current evidence access owners, and write repeatable retrieval instructions in Record Markdown.",
      "Set each selected Control's evidenceSourceIds to the authoritative Systems that produce its evidence.",
      "Run program-readiness again and resolve every incomplete source check and control mapping before marking the Controls implemented."
    ],
    items: evidenceItems
  };
}

function programScope(workspace, records, byId) {
  const select = (ids, type, fallback) => {
    if (ids?.length) return ids.map((id) => byId.get(id)).filter((record) => record?.type === type);
    return records.filter(fallback);
  };
  return {
    systems: (workspace?.systemIds || [])
      .map((id) => byId.get(id))
      .filter((record) => record?.type === "system" && record.status !== "retired"),
    frameworks: select(workspace?.frameworkIds, "framework", (record) => (
      record.type === "framework" && record.status === "active"
    )),
    requirements: select(workspace?.requirementIds, "requirement", (record) => (
      record.type === "requirement" && record.applicability === "applicable"
    )).filter((record) => record.applicability === "applicable"),
    controls: select(workspace?.controlIds, "control", (record) => (
      record.type === "control" && !["not-applicable", "retired"].includes(record.status)
    )).filter((record) => !["not-applicable", "retired"].includes(record.status))
  };
}

function scopeStage(workspace, scope, records, byId, model, collectionReviews = []) {
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

  items.push(programOwnershipItem(records, byId));
  items.push(requiredAppointmentsItem(records, model));
  for (const assessment of collectionReviews) {
    items.push(collectionReviewReadinessItem(assessment));
  }

  const completeSystems = scope.systems.filter((system) => (
    system.status === "active"
    && system.description
    && system.classificationId
    && (system.ownerIds || []).length
  ));
  items.push(item(
    "service-boundary",
    scope.systems.length && completeSystems.length === scope.systems.length ? "complete" : "action",
    "Define the service boundary",
    scope.systems.length
      ? `${completeSystems.length} of ${scope.systems.length} program systems are active, explicitly in scope, owned, classified, and described.`
      : "Select and describe every service and supporting system in the program boundary.",
    scope.systems[0] || { type: "system" }
  ));

  if (String(model.modelVersion) === "3") {
    const commitments = records.filter((record) => (
      record.type === "commitment"
      && !["superseded", "retired"].includes(record.status)
      && (record.systemIds || []).some((id) => scope.systems.some((system) => system.id === id))
    ));
    const completeCommitments = commitments.filter((record) => (
      record.status === "active"
      && record.statement
      && record.effectiveOn
      && record.applicabilityReview?.decision === "applicable"
      && currentPartyPeople(record.ownerIds, byId).size > 0
      && (record.requirementIds || []).length > 0
      && (record.controlIds || []).length > 0
    ));
    const uncoveredSystems = scope.systems.filter((system) => !completeCommitments.some((record) => (
      (record.systemIds || []).includes(system.id)
    )));
    items.push(item(
      "commitments",
      scope.systems.length && uncoveredSystems.length === 0 ? "complete" : "action",
      "Record service commitments and system requirements",
      scope.systems.length
        ? `${completeCommitments.length} complete active ${completeCommitments.length === 1 ? "commitment covers" : "commitments cover"} ${scope.systems.length - uncoveredSystems.length} of ${scope.systems.length} in-scope systems.`
        : "Define the service boundary before recording its customer promises and approved system requirements.",
      commitments[0] || { type: "commitment" },
      {
        uncoveredSystemIds: uncoveredSystems.map(({ id }) => id),
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
  const applicableRequirements = records.filter((record) => (
    record.type === "requirement"
    && scope.frameworks.some((framework) => framework.id === record.frameworkId)
    && record.applicability === "applicable"
  ));
  const unresolvedRequirements = records.filter((record) => (
    record.type === "requirement"
    && scope.frameworks.some((framework) => framework.id === record.frameworkId)
    && record.applicability === "undetermined"
  ));
  const missingRequirements = applicableRequirements.filter((record) => !selectedRequirementIds.has(record.id));
  const criteriaComplete = Boolean(
    scope.frameworks.length
    && scope.requirements.length
    && scope.controls.length
    && !unresolvedRequirements.length
    && !missingRequirements.length
  );
  items.push(item(
    "criteria",
    criteriaComplete ? "complete" : "action",
    "Confirm criteria and controls in scope",
    criteriaComplete
      ? `${scope.requirements.length} applicable criteria and ${scope.controls.length} controls are in the management program scope.`
      : `Resolve the program criteria and controls. ${unresolvedRequirements.length} criteria remain undetermined and ${missingRequirements.length} applicable criteria are not selected.`,
    workspace || { type: "workspace" },
    {
      commands: [
        "npx filegrc review-applicability --scaffold --type requirement > decisions.json",
        "npx filegrc review-applicability decisions.json --preview --json",
        "npx filegrc review-applicability decisions.json --yes --json",
        "npx filegrc get workspace --mutation"
      ]
    }
  ));

  return stage("scope", "Define Scope", "Set program ownership, the management objective, service boundary, criteria, controls, and dependencies.", items);
}

function collectionReviewReadinessItem(assessment) {
  return item(
    `collection-review-${assessment.resourceType}`,
    assessment.complete ? "complete" : "action",
    assessment.status === "stale"
      ? `Review ${assessment.configuration.title.toLowerCase()} again`
      : `Review ${assessment.configuration.title.toLowerCase()}`,
    assessment.message,
    assessment.review || { type: assessment.resourceType },
    {
      resourceType: assessment.resourceType,
      reviewPoints: assessment.configuration.reviewPoints,
      commands: [
        `npx filegrc review-collection ${assessment.resourceType} --scaffold`,
        `npx filegrc review-collection ${assessment.resourceType} REVIEW.json --preview --json`
      ]
    }
  );
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

async function policiesStage(scope, records, byId, readMarkdown, asOf) {
  const linkedPolicyIds = new Set(scope.controls.flatMap((control) => control.policyIds || []));
  const policies = [...linkedPolicyIds].map((id) => byId.get(id)).filter((record) => (
    record?.type === "policy" && !["superseded", "retired"].includes(record.status)
  ));
  const appointedReviewer = policies
    .filter((policy) => partiesIndependent(policy.ownerIds, policy.approverIds, byId))
    .flatMap((policy) => [...currentPartyPeople(policy.approverIds || [], byId)])
    .map((id) => byId.get(id))
    .find(Boolean);
  const policyOwnerIds = new Set(policies.flatMap((policy) => (
    [...partyPeople(policy.ownerIds || [], byId)]
  )));
  const oversight = byId.get("team-security-risk-oversight");
  const availableReviewer = oversight?.type === "team" && oversight.status === "active"
    ? [...currentPartyPeople(oversight.chairIds || [], byId)]
      .filter((id) => !policyOwnerIds.has(id))
      .map((id) => byId.get(id))
      .find(Boolean)
    : null;
  const reviewerNeedsAssignment = !appointedReviewer && availableReviewer && policies.length;
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
      appointedReviewer || (reviewerNeedsAssignment ? policies[0] : { type: "person" }),
      {
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
      reviewed: ["in-review", "approved", "active"].includes(policy.status),
      independentlyApproved: ["approved", "active"].includes(policy.status)
        && policy.approvedOn
        && partiesIndependent(policy.ownerIds, policy.approverIds, byId),
      effective: policy.status === "active" && policy.effectiveOn && policy.effectiveOn <= asOf,
      linkedControls: scope.controls.some((control) => (control.policyIds || []).includes(policy.id)),
      contentComplete: Boolean(source.trim()) && placeholderCount === 0
    };
    const missing = Object.entries(checks).filter(([, value]) => !value).map(([name]) => policyCheckLabel(name));
    items.push(item(
      `policy-${policy.id}`,
      missing.length ? "action" : "complete",
      policy.title,
      missing.length
        ? `Remaining adoption work: ${missing.join(", ")}${placeholderCount ? ` (${placeholderCount} open placeholders)` : ""}.`
        : `Reviewed, independently approved, effective ${policy.effectiveOn}, linked to controls, with no open organization placeholders.`,
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
  const selectedControlIds = new Set(scope.controls.map(({ id }) => id));
  const activeObligations = records.filter((record) => (
    record.type === "obligation" && obligationIsRunning(record, byId, asOf)
  ));
  const requiredGovernedIds = new Set(activeObligations.flatMap((record) => [
    ...(record.scopeResourceIds || []),
    ...(record.templateResourceId ? [record.templateResourceId] : [])
  ]));
  const governedRecords = records.filter((record) => (
    (
      record.type === "document"
      && (
        requiredGovernedIds.has(record.id)
        || (
          record.programRole === "required"
          && (record.controlIds || []).some((id) => selectedControlIds.has(id))
        )
      )
    )
    || (record.type === "training" && requiredGovernedIds.has(record.id))
  ));
  for (const record of governedRecords) {
    const source = await readMarkdown(record);
    const placeholderCount = openPlaceholderCount(source);
    const checks = record.type === "document"
      ? {
          active: record.status === "active",
          owner: currentPartyPeople(record.ownerIds, byId).size > 0,
          independentlyApproved: Boolean(
            record.approvedOn
            && partiesIndependent(record.ownerIds, record.approverIds, byId)
          ),
          effective: Boolean(record.effectiveOn && record.effectiveOn <= asOf),
          contentComplete: substantiveMarkdown(source) && placeholderCount === 0
        }
      : {
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
    items.push(item(
      `${record.type}-${record.id}`,
      missing.length ? "action" : "complete",
      record.title,
      missing.length
        ? `Remaining governed-content work: ${missing.join(", ")}${placeholderCount ? ` (${placeholderCount} open placeholders)` : ""}.`
        : record.type === "document"
          ? `Active, independently approved, effective ${record.effectiveOn}, and ready for the selected controls or running schedule.`
          : `Active, approved, effective ${record.effectiveOn}, revision-bound, and ready for the running training schedule.`,
      record,
      {
        checks,
        placeholderCount,
        commands: [
          `npx filegrc get ${shellArgument(record.id)} --mutation`,
          `npx filegrc update ${record.type} ${shellArgument(record.id)} MUTATION.json --json`,
          "npx filegrc program-readiness --json"
        ]
      }
    ));
  }
  return stage(
    "policies",
    "Approve Policies",
    "Review and approve the policies, governed plans, and training content required by selected controls and running schedules.",
    items
  );
}

async function controlsStage(scope, byId, readMarkdown, asOf, model) {
  const items = [];
  if (!scope.controls.length) {
    items.push(item("control-scope", "action", "Select the program controls", "No controls are selected for the management program.", { type: "control" }));
  }
  for (const control of scope.controls) {
    const source = await readMarkdown(control);
    const sourceSystems = (control.evidenceSourceIds || []).map((id) => byId.get(id)).filter((record) => record?.type === "system");
    const queueSchedules = [...byId.values()].filter((record) => (
      record.type === "obligation"
      && record.status !== "retired"
      && (record.controlIds || []).includes(control.id)
    ));
    const checks = {
      ...(model.resources.control?.fields?.applicabilityReview ? {
        applicability: control.applicabilityReview?.decision === "applicable"
      } : {}),
      implemented: control.status === "implemented",
      owner: (control.ownerIds || []).length > 0,
      procedure: substantiveMarkdown(source) && openPlaceholderCount(source) === 0,
      scope: (control.systemIds || []).some((id) => scope.systems.some((system) => system.id === id)),
      operationPattern: Boolean(control.operationPattern),
      evidenceSource: sourceSystems.length > 0,
      implementationDate: Boolean(control.effectiveOn && control.effectiveOn <= asOf),
      ...(model.resources.control?.fields?.procedureRevision ? {
        procedureRevision: Boolean(control.procedureRevision),
        procedureEffective: Boolean(control.procedureEffectiveOn && control.procedureEffectiveOn <= asOf),
        implementationReview: Boolean(
          control.implementationReviewedOn
          && control.implementationReviewedOn <= asOf
          && partiesIndependent(control.ownerIds, control.implementationReviewedByIds, byId)
        )
      } : {}),
      policyMapping: (control.policyIds || []).length > 0,
      criteriaMapping: (control.requirementIds || []).length > 0,
      ...(["scheduled", "event-driven", "mixed"].includes(control.operationPattern) ? {
        workQueue: queueSchedules.length > 0
          && queueSchedules.every((obligation) => obligationIsRunning(obligation, byId, asOf))
      } : {})
    };
    const missing = Object.entries(checks).filter(([, value]) => !value).map(([name]) => controlCheckLabel(name));
    items.push(item(
      `control-${control.id}`,
      missing.length ? "action" : "complete",
      `${control.code ? `${control.code}: ` : ""}${control.title}`,
      missing.length
        ? `Complete ${missing.length} ${missing.length === 1 ? "check" : "checks"} before implementation: ${missing.join(", ")}.`
        : `Implemented ${control.effectiveOn}; owned, scoped, scheduled, documented, mapped, and tied to ${sourceSystems.length} authoritative ${sourceSystems.length === 1 ? "source" : "sources"}.`,
      control,
      {
        checks,
        commands: [
          ...(Object.hasOwn(checks, "applicability") && !checks.applicability ? [
            "npx filegrc review-applicability --scaffold --type control > control-decisions.json",
            "npx filegrc review-applicability control-decisions.json --preview --json",
            "npx filegrc review-applicability control-decisions.json --yes --json"
          ] : []),
          "npx filegrc evidence-map --json",
          `npx filegrc get ${shellArgument(control.id)} --mutation`
        ],
        workQueue: queueSchedules.length ? {
          running: queueSchedules.filter((obligation) => obligationIsRunning(obligation, byId, asOf)).length,
          total: queueSchedules.length
        } : null
      }
    ));
  }
  return stage("controls", "Implement Controls", "Each implemented control needs an owner, actual procedure, scope, operation pattern, evidence source, mappings, an implementation date, and any required Work Queue schedules running.", items);
}

async function evidenceSourcesStage(scope, byId, model, readMarkdown) {
  const families = selectedControlFamilies(scope.controls, model);
  const items = [];
  for (const family of families) {
    const selectedSources = [...new Set(family.controls.flatMap((control) => control.evidenceSourceIds || []))]
      .map((id) => byId.get(id))
      .filter((record) => (
        record?.type === "system"
        && (
          !(record.evidenceSourceKinds || []).length
          || family.sourceKinds.some((kind) => (record.evidenceSourceKinds || []).includes(kind))
        )
      ));
    const completeSources = [];
    const sourceSystemChecks = [];
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
      sourceSystemChecks.push({
        sourceSystemId: source.id,
        complete,
        checks
      });
      if (complete) {
        completeSources.push(source);
      }
    }
    const controlMappings = family.controls.map((control) => {
      const sourceSystemIds = (control.evidenceSourceIds || []).filter((id) => selectedSources.some((source) => source.id === id));
      const completeSourceSystemIds = sourceSystemIds.filter((id) => completeSources.some((source) => source.id === id));
      return {
        controlId: control.id,
        sourceSystemIds,
        completeSourceSystemIds,
        mapped: sourceSystemIds.length > 0,
        complete: completeSourceSystemIds.length > 0
      };
    });
    const coveredControls = controlMappings.filter(({ complete }) => complete);
    const complete = completeSources.length > 0 && coveredControls.length === family.controls.length;
    const commands = [
      ...(selectedSources.length
        ? sourceSystemChecks.filter(({ complete: sourceComplete }) => !sourceComplete).flatMap(({ sourceSystemId }) => [
            `npx filegrc get ${shellArgument(sourceSystemId)} --mutation > /tmp/${shellArgument(sourceSystemId)}.json`,
            `npx filegrc update system ${shellArgument(sourceSystemId)} /tmp/${shellArgument(sourceSystemId)}.json --json`
          ])
        : [
            "npx filegrc list system --json",
            'npx filegrc scaffold system --title "SYSTEM NAME" > /tmp/filegrc-system.json',
            "npx filegrc create /tmp/filegrc-system.json --json"
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
        : `${coveredControls.length} of ${family.controls.length} selected controls have an active authoritative system with the required source role, access owners, and extraction instructions.`,
      completeSources[0] || selectedSources[0] || { type: "system" },
      {
        familyId: family.id,
        sourceKinds: family.sourceKinds,
        controlIds: family.controls.map((control) => control.id),
        sourceSystemIds: selectedSources.map((source) => source.id),
        completeSourceSystemIds: completeSources.map((source) => source.id),
        sourceSystemChecks,
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
  return stage("sources", "Control Evidence Sources", "Complete the authoritative Systems for every selected control family before marking the Controls implemented.", items);
}

function operationStage(loaded, workspace, scope, records, byId, asOf, evidenceReady, model) {
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

  const obligations = planObligations(records, { asOf, through: asOf, model });
  const start = workspace.candidateCoverage?.kind === "range"
    ? coverageStart(workspace.candidateCoverage)
    : null;
  const end = workspace.candidateCoverage?.kind === "range"
    ? coverageEnd(workspace.candidateCoverage)
    : null;
  const startStatus = !start ? "action" : start <= asOf ? "complete" : "later";
  const sourceCoverage = assessSourceCoverageReadiness(loaded, scope.controls.map(({ id }) => id));
  const incompleteSourceCoverage = sourceCoverage.filter(({ complete }) => !complete);
  return stage("operation", "Operate the Program", "Start the management candidate Type 2 period only after the Evidence Ready gate, then keep collection running.", [
    item(
      "evidence-running",
      startStatus,
      "Evidence collection running",
      !start
        ? "Set the management candidate period start when the Evidence Ready gate passes. Do not backdate it."
        : start <= asOf
          ? `Management began the candidate Type 2 evidence period on ${start}. This is not the auditor-agreed report period.`
          : `Evidence collection is scheduled to begin on ${start}.`,
      workspace
    ),
    item(
      "candidate-period-end",
      end ? "complete" : start ? "later" : "info",
      "Plan the candidate period end",
      end
        ? `Management candidate period: ${start || "start not set"} through ${end}. The CPA firm may agree to different dates.`
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

function openPlaceholderCount(source) {
  if (!source) return 0;
  const matches = source.match(
    /\{\{[^}\n]+\}\}|\b(?:TODO|TBD)\b|\[(?:complete|confirm|describe|insert|name|replace|select|specify|todo|tbd)[^\]\n]*\]/giu
  );
  return matches?.length || 0;
}

function substantiveMarkdown(source) {
  return (source.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length >= 10;
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

function governedContentCheckLabel(name) {
  return ({
    active: "active status",
    owner: "current owner",
    independentlyApproved: "independent approval and approval date",
    approved: "approval and approval date",
    effective: "effective date",
    effectiveContent: "effective content revision",
    contentComplete: "content and organization placeholders"
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
    implementationDate: "implementation date",
    procedureRevision: "effective procedure revision",
    procedureEffective: "procedure effective date",
    implementationReview: "independent implementation review",
    policyMapping: "policy mapping",
    criteriaMapping: "criteria mapping",
    workQueue: "running Work Queue schedules"
  })[name] || name;
}

function assuranceGoalLabel(goal) {
  if (goal === "soc-2-type-1") return "SOC 2 Type 1";
  if (goal === "soc-2-type-2") return "SOC 2 Type 2";
  if (goal === "readiness") return "SOC 2 program readiness";
  return "No assurance goal selected";
}

function stage(id, title, description, items) {
  return { id, title, description, items };
}

function finalizeStage(current) {
  current.counts = countStatuses(current.items);
  current.status = current.counts.action ? "action" : current.counts.later ? "later" : "complete";
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

function shiftYear(value, offset) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() + offset);
  return date.toISOString().slice(0, 10);
}
