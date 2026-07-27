import { readFile } from "node:fs/promises";
import { planObligations } from "./obligations.js";
import { resolveDataPath } from "./paths.js";
import { markdownEntries } from "./resource-markdown.js";
import { currentCalendarDate } from "./time.js";
import { loadWorkspace } from "./workspace.js";

const TEST_EVIDENCE_KINDS = new Set(["test-capture", "test-export"]);

export async function assessProgramReadiness(input, options = {}) {
  const loaded = input?.resources && input?.model && input?.entries
    ? input
    : await loadWorkspace(input);
  const records = loaded.resources;
  const byId = new Map(records.map((record) => [record.id, record]));
  const workspace = loaded.workspace || records.find((record) => record.type === "workspace");
  const asOf = options.asOf || currentCalendarDate(workspace?.timezone || "UTC");
  const scope = programScope(workspace, records, byId);
  const markdown = new Map();
  const readMarkdown = async (record) => {
    if (!record) return "";
    if (!markdown.has(record.id)) markdown.set(record.id, await primaryMarkdown(loaded, record));
    return markdown.get(record.id);
  };

  const sourceStage = await evidenceSourcesStage(scope, byId, loaded.model, readMarkdown);
  const collectionStage = evidenceCollectionStage(scope, records, byId, loaded.model);
  const evidenceStage = stage(
    "evidence",
    "Prepare Evidence",
    "Catalog authoritative systems, document repeatable extraction, and verify one test capture for every selected control family.",
    [...sourceStage.items, ...collectionStage.items]
  );
  const evidenceGateStages = [
    scopeStage(workspace, scope, records),
    await policiesStage(scope, byId, readMarkdown, asOf),
    await controlsStage(scope, byId, readMarkdown, asOf),
    evidenceStage
  ];
  for (const current of evidenceGateStages) finalizeStage(current);
  const evidenceReady = evidenceGateStages.every((current) => current.counts.action === 0);
  const stages = [
    ...evidenceGateStages,
    operationStage(workspace, scope, records, byId, asOf, evidenceReady)
  ];
  finalizeStage(stages.at(-1));
  const candidateStarted = Boolean(
    workspace?.assuranceGoal === "soc-2-type-2"
    && workspace.candidatePeriodStart
    && workspace.candidatePeriodStart <= asOf
  );
  const obligations = planObligations(records, { asOf, through: asOf });
  const operating = evidenceReady && candidateStarted && obligations.counts.overdue === 0;
  const canStartCandidatePeriod = Boolean(
    evidenceReady
    && workspace?.assuranceGoal === "soc-2-type-2"
    && !workspace.candidatePeriodStart
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
      candidateTypeOneAsOf: workspace?.candidateTypeOneAsOf || null,
      candidatePeriodStart: workspace?.candidatePeriodStart || null,
      candidatePeriodEnd: workspace?.candidatePeriodEnd || null
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

function programScope(workspace, records, byId) {
  const select = (ids, type, fallback) => {
    if (ids?.length) return ids.map((id) => byId.get(id)).filter((record) => record?.type === type);
    return records.filter(fallback);
  };
  return {
    systems: select(workspace?.systemIds, "system", (record) => (
      record.type === "system" && record.inScope === true && record.status !== "retired"
    )),
    frameworks: select(workspace?.frameworkIds, "framework", (record) => (
      record.type === "framework" && record.status === "active"
    )),
    requirements: select(workspace?.requirementIds, "requirement", (record) => (
      record.type === "requirement" && record.applicability === "applicable"
    )),
    controls: select(workspace?.controlIds, "control", (record) => (
      record.type === "control" && !["not-applicable", "retired"].includes(record.status)
    ))
  };
}

function scopeStage(workspace, scope, records) {
  const items = [];
  const goal = workspace?.assuranceGoal || "none";
  items.push(item(
    "program-goal",
    goal !== "none" ? "complete" : "action",
    "Choose the program goal",
    goal !== "none"
      ? `Target: ${assuranceGoalLabel(goal)}. This is a management objective, not an active CPA engagement.`
      : "Choose readiness, SOC 2 Type 1, or SOC 2 Type 2 as the management objective.",
    workspace || { type: "workspace" }
  ));

  const completeSystems = scope.systems.filter((system) => (
    system.status === "active"
    && system.inScope === true
    && system.description
    && system.dataClassification
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
    workspace || { type: "workspace" }
  ));

  return stage("scope", "Define Scope", "Set the management objective, service boundary, criteria, controls, and dependencies.", items);
}

async function policiesStage(scope, byId, readMarkdown, asOf) {
  const linkedPolicyIds = new Set(scope.controls.flatMap((control) => control.policyIds || []));
  const policies = [...linkedPolicyIds].map((id) => byId.get(id)).filter((record) => (
    record?.type === "policy" && !["superseded", "retired"].includes(record.status)
  ));
  const approvers = policies.flatMap((policy) => partyPeople(policy.approverIds || [], byId))
    .map((id) => byId.get(id))
    .filter(Boolean);
  const appointedReviewer = approvers.find((person) => (
    ["active", "external"].includes(person.status)
    && person.email
    && !(person.id === "person-independent-approver" && ["Independent Approver", "Independent Reviewer"].includes(person.title))
  ));
  const items = [
    item(
      "independent-reviewer",
      appointedReviewer ? "complete" : "action",
      "Appoint the independent policy reviewer",
      appointedReviewer
        ? `${appointedReviewer.title} is recorded as a reviewer separate from policy ownership.`
        : "Appoint a reviewer who is separate from the policy owner. The reviewer may be another person in the organization or an external person, and is separate from the CPA firm that may later perform the audit.",
      appointedReviewer || { type: "person", id: "person-independent-approver" }
    )
  ];
  if (!policies.length) {
    items.push(item(
      "policy-scope",
      "action",
      "Link policies to the selected controls",
      "No applicable policies are linked from the controls in program scope.",
      { type: "policy" }
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
      linkedControls: (policy.controlIds || []).some((id) => scope.controls.some((control) => control.id === id)),
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
      { checks, placeholderCount }
    ));
  }
  return stage("policies", "Approve Policies", "Review the draft, obtain independent management approval, set the effective date, link controls, and clear placeholders.", items);
}

async function controlsStage(scope, byId, readMarkdown, asOf) {
  const items = [];
  if (!scope.controls.length) {
    items.push(item("control-scope", "action", "Select the program controls", "No controls are selected for the management program.", { type: "control" }));
  }
  for (const control of scope.controls) {
    const source = await readMarkdown(control);
    const sourceSystems = (control.evidenceSourceIds || []).map((id) => byId.get(id)).filter((record) => record?.type === "system");
    const checks = {
      implemented: control.status === "implemented",
      owner: (control.ownerIds || []).length > 0,
      procedure: substantiveMarkdown(source) && openPlaceholderCount(source) === 0,
      scope: (control.systemIds || []).some((id) => scope.systems.some((system) => system.id === id)),
      cadence: Boolean(control.frequency),
      evidenceSource: sourceSystems.length > 0,
      implementationDate: Boolean(control.effectiveOn && control.effectiveOn <= asOf),
      policyMapping: (control.policyIds || []).length > 0,
      criteriaMapping: (control.requirementIds || []).length > 0
    };
    const missing = Object.entries(checks).filter(([, value]) => !value).map(([name]) => controlCheckLabel(name));
    items.push(item(
      `control-${control.id}`,
      missing.length ? "action" : "complete",
      `${control.code ? `${control.code}: ` : ""}${control.title}`,
      missing.length
        ? `Before implementation: ${missing.join(", ")}.`
        : `Implemented ${control.effectiveOn}; owned, scoped, scheduled, documented, mapped, and tied to ${sourceSystems.length} authoritative ${sourceSystems.length === 1 ? "source" : "sources"}.`,
      control,
      { checks }
    ));
  }
  return stage("controls", "Implement Controls", "Each implemented control needs an owner, actual procedure, scope, cadence, evidence source, mappings, and implementation date.", items);
}

async function evidenceSourcesStage(scope, byId, model, readMarkdown) {
  const families = selectedControlFamilies(scope.controls, model);
  const items = [];
  if (!families.length) {
    items.push(item("source-families", "action", "Map evidence sources", "No selected control families have authoritative evidence sources.", { type: "system" }));
  }
  for (const family of families) {
    const selectedSources = [...new Set(family.controls.flatMap((control) => control.evidenceSourceIds || []))]
      .map((id) => byId.get(id))
      .filter((record) => record?.type === "system");
    const completeSources = [];
    for (const source of selectedSources) {
      const instructions = await readMarkdown(source);
      const matchesRole = !family.sourceKinds.length
        || family.sourceKinds.some((kind) => (source.evidenceSourceKinds || []).includes(kind));
      if (
        source.status === "active"
        && matchesRole
        && (source.evidenceSourceKinds || []).length
        && (source.evidenceOwnerIds || []).length
        && substantiveMarkdown(instructions)
        && openPlaceholderCount(instructions) === 0
      ) {
        completeSources.push(source);
      }
    }
    const coveredControls = family.controls.filter((control) => (
      (control.evidenceSourceIds || []).some((id) => completeSources.some((source) => source.id === id))
    ));
    const complete = completeSources.length > 0 && coveredControls.length === family.controls.length;
    items.push(item(
      `source-family-${family.id}`,
      complete ? "complete" : "action",
      family.title,
      complete
        ? `${completeSources.map((source) => source.title).join(", ")} cover all ${family.controls.length} selected controls and record access owners and extraction instructions.`
        : `${coveredControls.length} of ${family.controls.length} selected controls have an active authoritative system with the required source role, access owners, and extraction instructions.`,
      completeSources[0] || selectedSources[0] || { type: "system" },
      { controlIds: family.controls.map((control) => control.id), sourceSystemIds: selectedSources.map((source) => source.id) }
    ));
  }
  return stage("sources", "Configure Evidence Sources", "Catalog the authoritative systems, name who can export from them, and write repeatable extraction instructions.", items);
}

function evidenceCollectionStage(scope, records, byId, model) {
  const families = selectedControlFamilies(scope.controls, model);
  const captures = records.filter((record) => (
    record.type === "evidence"
    && record.status === "verified"
    && TEST_EVIDENCE_KINDS.has(record.evidenceKind)
    && record.sourceSystemId
  ));
  const items = families.map((family) => {
    const sourceIds = new Set(family.controls.flatMap((control) => control.evidenceSourceIds || []));
    const controlIds = new Set(family.controls.map((control) => control.id));
    const capture = captures.find((record) => (
      sourceIds.has(record.sourceSystemId)
      && [...controlIdsForRecord(record, byId)].some((id) => controlIds.has(id))
    ));
    return item(
      `test-family-${family.id}`,
      capture ? "complete" : "action",
      family.title,
      capture
        ? `${capture.title} proves that management successfully captured and verified evidence from ${byId.get(capture.sourceSystemId)?.title || "the authoritative source"}.`
        : `Run and verify one test export or test capture from an authoritative source for this selected control family, then link it to a family control.`,
      capture || { type: "evidence" },
      { controlIds: [...controlIds], evidenceId: capture?.id || null }
    );
  });
  if (!items.length) {
    items.push(item("test-families", "action", "Test evidence collection", "Select and implement controls before testing their evidence sources.", { type: "evidence" }));
  }
  return stage("collection", "Test Evidence Collection", "A verified test export or capture is required for every selected control family before the candidate period can begin.", items);
}

function operationStage(workspace, scope, records, byId, asOf, evidenceReady) {
  const goal = workspace?.assuranceGoal || "none";
  if (!evidenceReady) {
    return stage("operation", "Operate the Program", "Run the controls and preserve dated evidence after the Evidence Ready gate passes.", [
      item(
        "operation-later",
        "later",
        "Begin reliable evidence collection",
        "Finish scope, policy adoption, control implementation, source configuration, and test captures before recording the candidate period.",
        workspace || { type: "workspace" }
      )
    ]);
  }
  if (goal !== "soc-2-type-2") {
    const date = workspace?.candidateTypeOneAsOf;
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

  const obligations = planObligations(records, { asOf, through: asOf });
  const start = workspace.candidatePeriodStart;
  const end = workspace.candidatePeriodEnd;
  const startStatus = !start ? "action" : start <= asOf ? "complete" : "later";
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
      "ongoing-obligations",
      obligations.counts.overdue ? "action" : "complete",
      "Keep policy work current",
      obligations.counts.overdue
        ? `${obligations.counts.overdue} policy obligations are overdue. Complete the work and retain its dated proof.`
        : `${obligations.counts.due} due and ${obligations.counts.upcoming} upcoming obligations; no overdue policy work.`,
      { type: "obligation" }
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
    && record.assessmentDate >= shiftYear(asOf, -1)
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

function selectedControlFamilies(controls, model) {
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

function partiesIndependent(ownerIds = [], approverIds = [], byId) {
  const owners = new Set(partyPeople(ownerIds, byId));
  const approvers = partyPeople(approverIds, byId);
  return owners.size > 0 && approvers.length > 0 && !approvers.some((id) => owners.has(id));
}

function partyPeople(ids = [], byId, seen = new Set()) {
  const people = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const record = byId.get(id);
    if (record?.type === "person") people.push(id);
    if (record?.type === "team") {
      people.push(...partyPeople([...(record.memberIds || []), ...(record.chairIds || [])], byId, seen));
    }
  }
  return [...new Set(people)];
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

function controlCheckLabel(name) {
  return ({
    implemented: "implemented status",
    owner: "owner",
    procedure: "actual procedure in Record Markdown",
    scope: "in-scope systems",
    cadence: "cadence",
    evidenceSource: "authoritative evidence source",
    implementationDate: "implementation date",
    policyMapping: "policy mapping",
    criteriaMapping: "criteria mapping"
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
