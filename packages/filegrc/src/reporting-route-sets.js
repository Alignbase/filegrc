import { getRepositorySnapshot, isDataHistoryAncestor } from "./git.js";
import { applyResourceBatch, INTERNAL_WORKFLOW_CAPABILITIES, updateResource } from "./files.js";
import {
  effectiveReportingRouteRequirements as deriveEffectiveReportingRouteRequirements,
  reportingRouteAssertionTiming,
  reportingRouteCommitTimestamp,
  reportingRouteEventCommit,
  reportingRouteEventAuthorityIssue,
  reportingRouteEventAuthorityIssueAtCommit,
  reportingRouteExactHistoryEntry,
  reportingRouteFixedEvidence,
  reportingRouteLanesIndependent,
  reportingRouteOngoingAuthorities,
  reportingRouteProposalIssues,
  reportingRouteProposalAssessmentTime,
  reportingRouteProposalIssuesForRequirements,
  reportingRouteRecordAtRevision,
  reportingRouteRequirementAppliesToProgram,
  reportingRouteRequirementsForProposal,
  reportingRouteSupportIssues,
  recordsAtRevision,
  reportingRouteSourceEffective,
  reportingRouteSourceMayApply,
  reportingRouteSourceMayBecomeEffective,
  reportingRouteSourceAppliesToProgram
} from "./reporting-route-integrity.js";
import { localDateTimeValue } from "./time.js";
import { timestampFromLocalDateTime } from "./time.js";
import { addCalendarDays } from "./recurrence.js";
import { loadWorkspace } from "./workspace.js";

const COMMIT_REQUIRED_STATUSES = new Set(["proposed", "approved", "canceled"]);
const SOURCE_TYPES = new Set(["policy", "document", "commitment", "risk"]);
const MAX_PERIOD_BOUNDARIES = 512;
const PERIOD_REPOSITORY_SNAPSHOT = Symbol("filegrc.reportingRoutePeriodRepositorySnapshot");

export { reportingRouteLanesIndependent };

export async function assessReportingRouteSets(input = process.cwd(), options = {}) {
  const loaded = typeof input === "object" && input?.resources ? input : await loadWorkspace(input);
  if (!loaded.model.resources?.["reporting-route-set"]) {
    return { supported: false, requirements: [], routeSets: [], issues: [], counts: { complete: 0, action: 0, later: 0, inactive: 0 } };
  }
  const at = instant(options.at || new Date().toISOString(), "Assessment time");
  const programId = options.programId || loaded.resources.find(({ type }) => type === "program")?.id;
  const timezone = options.timezone || loaded.workspace?.timezone || "UTC";
  if (programId && !loaded.resources.some(({ type, id }) => type === "program" && id === programId)) {
    return {
      supported: true,
      at: at.toISOString(),
      programId,
      requirements: [],
      proposedRequirements: [],
      routeSets: [],
      issues: [issue("invalid-program", programId, `Program "${programId}" was not found.`)],
      counts: { complete: 0, action: 0, later: 0, inactive: 0 }
    };
  }
  const requirements = deriveEffectiveReportingRouteRequirements(loaded.resources, at, programId, timezone);
  const proposedRequirements = loaded.resources.flatMap((source) => (
    SOURCE_TYPES.has(source.type)
      && reportingRouteSourceMayBecomeEffective(source)
      && (!programId || reportingRouteSourceAppliesToProgram(
        source,
        loaded.resources.find(({ type, id }) => type === "program" && id === programId),
        loaded.resources
      ))
      ? (Array.isArray(source.reportingRouteRequirements) ? source.reportingRouteRequirements : [])
        .filter((requirement) => (
          requirement
          && typeof requirement === "object"
          && !Array.isArray(requirement)
          && (!programId || reportingRouteRequirementAppliesToProgram(requirement, programId))
        ))
        .map((requirement) => ({
        ...requirement,
        sourceId: source.id,
        sourceType: source.type,
        sourceStatus: source.status
      }))
      : []
  ));
  const routeSets = loaded.resources.filter((record) => (
    record.type === "reporting-route-set" && (!programId || record.programId === programId)
  ));
  const repository = options[PERIOD_REPOSITORY_SNAPSHOT]
    || await getRepositorySnapshot(loaded.root, { fresh: true });
  const assessments = routeSets.map((record) => ({
    ...assessRouteSet(record, loaded, at, repository),
    ...proposedRequirementAssessment(record, loaded, repository, proposedRequirements, at, timezone)
  }));
  const issues = loaded.resources.flatMap((source) => {
    if (!SOURCE_TYPES.has(source.type) || !Object.hasOwn(source, "reportingRouteRequirements")) return [];
    if (!reportingRouteSourceMayApply(source)) return [];
    try {
      if (!reportingRouteSourceEffective(source, at, timezone)) return [];
    } catch (error) {
      return [issue("invalid-reporting-route-requirement", source.id, error.message)];
    }
    if (!Array.isArray(source.reportingRouteRequirements)) {
      return [issue("invalid-reporting-route-requirement", source.id, "reportingRouteRequirements must be an array.")];
    }
    return source.reportingRouteRequirements.flatMap((requirement) => {
      if (!requirement || typeof requirement !== "object" || Array.isArray(requirement)) {
        return [issue("invalid-reporting-route-requirement", source.id, "Each Reporting Route requirement must be an object.")];
      }
      if (
        programId
        && requirement.programScope === "selected-programs"
        && Array.isArray(requirement.programIds)
        && !requirement.programIds.includes(programId)
      ) return [];
      return validateRequirementForAssessment(requirement, source.id, loaded.resources);
    });
  });
  for (const requirement of requirements) {
    if (!Array.isArray(requirement.requiredLanes)) {
      issues.push(issue("invalid-reporting-route-requirement", requirement.sourceId, `Reporting Route requirements for ${requirement.purposeKey || "this purpose"} need a requiredLanes array.`));
      continue;
    }
    const candidates = assessments.filter(({ record, effective, canceled }) => (
      record.purposeKey === requirement.purposeKey && effective && !canceled
    ));
    if (!candidates.length) {
      issues.push(issue("uncovered-reporting-route-interval", requirement.sourceId, `No committed approved Reporting Channel Set covers ${requirement.purposeKey} at ${at.toISOString()}.`));
      continue;
    }
    if (candidates.length > 1) {
      issues.push(issue(
        "overlapping-reporting-route-sets",
        candidates[1].record.id,
        `More than one committed approved Reporting Channel Set covers ${requirement.purposeKey} at ${at.toISOString()}.`
      ));
      continue;
    }
    const route = candidates[0].record;
    if (requirement.requiredLanes.includes("alternate") && !route.alternateLane) {
      issues.push(issue("missing-alternate-reporting-route", route.id, `${requirement.sourceId} requires a fallback reporting channel for ${requirement.purposeKey}.`));
    }
    if (requirement.distinctChannels && route.alternateLane?.channelKind === route.primaryLane?.channelKind) {
      issues.push(issue("reporting-route-channel-not-distinct", route.id, `${requirement.sourceId} requires different normal and fallback channel types.`));
    }
    if (requirement.independentDependencies && !reportingRouteLanesIndependent(route, loaded.resources, at, {
      timezone,
      root: loaded.root
    })) {
      issues.push(issue("reporting-route-dependencies-not-independent", route.id, `${requirement.sourceId} requires independent channel dependencies or an applicable Exception.`));
    }
  }
  for (const assessment of assessments) issues.push(...assessment.issues);
  return {
    supported: true,
    at: at.toISOString(),
    programId,
    requirements,
    proposedRequirements,
    routeSets: assessments,
    issues,
    counts: {
      complete: assessments.filter(({ state }) => state === "complete").length,
      action: assessments.filter(({ state }) => state === "action").length,
      later: assessments.filter(({ state }) => state === "later").length,
      inactive: assessments.filter(({ state }) => state === "inactive").length
    }
  };
}

function validateRequirementForAssessment(requirement, sourceId, records) {
  const invalid = (message) => [issue("invalid-reporting-route-requirement", sourceId, message)];
  if (!String(requirement.purposeKey || "").trim()) {
    return invalid("Each Reporting Route requirement needs a purpose key.");
  }
  if (!["all-programs", "selected-programs"].includes(requirement.programScope)) {
    return invalid("Each Reporting Route requirement must cover all Programs or name selected Programs.");
  }
  if (requirement.programScope === "all-programs" && Object.hasOwn(requirement, "programIds")) {
    return invalid("An all-Programs Reporting Route requirement cannot also list selected Programs.");
  }
  if (requirement.programScope === "selected-programs") {
    if (!Array.isArray(requirement.programIds) || !requirement.programIds.length) {
      return invalid("A selected-Programs Reporting Route requirement must name at least one Program.");
    }
    const programIds = new Set(records.filter(({ type }) => type === "program").map(({ id }) => id));
    if (requirement.programIds.some((id) => typeof id !== "string" || !programIds.has(id))) {
      return invalid("A selected-Programs Reporting Route requirement must name existing Program IDs.");
    }
  }
  if (
    !Array.isArray(requirement.requiredLanes)
    || !requirement.requiredLanes.length
    || requirement.requiredLanes.some((lane) => !["primary", "alternate"].includes(lane))
  ) {
    return invalid("Each Reporting Route requirement must name one or more valid required lanes.");
  }
  if (
    (Object.hasOwn(requirement, "distinctChannels") && typeof requirement.distinctChannels !== "boolean")
    || (Object.hasOwn(requirement, "independentDependencies") && typeof requirement.independentDependencies !== "boolean")
  ) {
    return invalid("Reporting Route channel and dependency requirements must be true or false.");
  }
  let effectiveAt;
  let endsAt;
  let requirementTimezone;
  try {
    effectiveAt = instant(requirement.effectiveAt, "Requirement start");
    endsAt = requirement.endsAt ? instant(requirement.endsAt, "Requirement end") : null;
    requirementTimezone = timezoneName(requirement.timezone);
    assertTimestampZone(requirement.effectiveAt, requirementTimezone, "Requirement start");
    if (requirement.endsAt) assertTimestampZone(requirement.endsAt, requirementTimezone, "Requirement end");
  } catch (error) {
    return invalid(error.message);
  }
  if (endsAt && endsAt <= effectiveAt) {
    return invalid("A Reporting Route requirement must end after it starts.");
  }
  return [];
}

export async function assessReportingRoutePeriod(input = process.cwd(), options = {}) {
  const loaded = typeof input === "object" && input?.resources ? input : await loadWorkspace(input);
  if (!loaded.model.resources?.["reporting-route-set"]) return { supported: false, snapshots: [], issues: [] };
  const timezone = options.timezone || loaded.workspace?.timezone || "UTC";
  if (options.programId && !loaded.resources.some(({ type, id }) => type === "program" && id === options.programId)) {
    return {
      supported: true,
      start: options.start,
      end: options.end,
      timezone,
      snapshots: [],
      issues: [issue("invalid-program", options.programId, `Program "${options.programId}" was not found.`)]
    };
  }
  let startsAt;
  let endsAt;
  try {
    startsAt = new Date(timestampFromLocalDateTime(`${options.start}T00:00:00`, timezone));
    endsAt = new Date(timestampFromLocalDateTime(`${addCalendarDays(options.end, 1)}T00:00:00`, timezone));
  } catch {
    return {
      supported: true,
      start: options.start,
      end: options.end,
      timezone,
      snapshots: [],
      issues: [issue("invalid-reporting-route-period", loaded.workspace.id, "Reporting Route period dates and timezone must be valid.")]
    };
  }
  const boundaries = new Set([startsAt.toISOString()]);
  const boundaryIssues = [];
  const invalidBoundary = (resourceId, label) => {
    boundaryIssues.push(issue("invalid-reporting-route-boundary", resourceId, `${label} must use a valid date, timestamp, and IANA timezone.`));
  };
  const addDateBoundary = (date, afterInclusiveEnd = false, boundaryTimezone = timezone, resourceId = loaded.workspace.id, label = "Reporting Route boundary") => {
    if (!date) return;
    try {
      const boundaryDate = afterInclusiveEnd ? addCalendarDays(date, 1) : date;
      const boundary = new Date(timestampFromLocalDateTime(`${boundaryDate}T00:00:00`, boundaryTimezone));
      if (Number.isNaN(boundary.getTime())) throw new Error("Invalid boundary");
      if (boundary > startsAt && boundary < endsAt) boundaries.add(boundary.toISOString());
    } catch {
      invalidBoundary(resourceId, label);
    }
  };
  const addInstantBoundary = (value, resourceId, label) => {
    if (!value) return;
    const boundary = new Date(value);
    if (Number.isNaN(boundary.getTime())) {
      invalidBoundary(resourceId, label);
      return;
    }
    if (boundary > startsAt && boundary < endsAt) boundaries.add(boundary.toISOString());
  };
  for (const record of loaded.resources) {
    if (["policy", "document", "commitment"].includes(record.type) && record.effectiveOn) {
      addDateBoundary(record.effectiveOn, false, timezone, record.id, `${record.title || record.id} effective date`);
    }
    for (const requirement of Array.isArray(record.reportingRouteRequirements) ? record.reportingRouteRequirements : []) {
      if (!requirement || typeof requirement !== "object" || Array.isArray(requirement)) continue;
      for (const value of [requirement.effectiveAt, requirement.endsAt]) {
        addInstantBoundary(value, record.id, `${record.title || record.id} requirement boundary`);
      }
    }
    if (["policy", "document", "commitment", "risk"].includes(record.type)) {
      addDateBoundary(record.statusTransition?.changedOn, false, timezone, record.id, `${record.title || record.id} lifecycle date`);
    }
    if (record.type !== "reporting-route-set") continue;
    for (const value of [record.approval?.effectiveAt, record.cancellation?.canceledAt]) {
      addInstantBoundary(value, record.id, `${record.title || record.id} lifecycle timestamp`);
    }
  }
  const byId = new Map(loaded.resources.map((record) => [record.id, record]));
  const appointmentsByKind = new Map();
  for (const appointment of loaded.resources.filter(({ type }) => type === "appointment")) {
    const appointments = appointmentsByKind.get(appointment.appointmentKind) || [];
    appointments.push(appointment);
    appointmentsByKind.set(appointment.appointmentKind, appointments);
  }
  const authorityContexts = new Map();
  for (const routeSet of loaded.resources.filter(({ type }) => type === "reporting-route-set")) {
    const authorityTimezone = routeSet.approval?.timezone || timezone;
    const key = `${routeSet.authorityAppointmentKind}\0${authorityTimezone}`;
    const context = authorityContexts.get(key) || {
      appointmentKind: routeSet.authorityAppointmentKind,
      timezone: authorityTimezone,
      scopeIds: new Set([loaded.workspace.id])
    };
    context.scopeIds.add(routeSet.id);
    context.scopeIds.add(routeSet.programId);
    authorityContexts.set(key, context);
  }
  for (const context of authorityContexts.values()) {
    for (const appointment of appointmentsByKind.get(context.appointmentKind) || []) {
      if (!appointment.scopeResourceIds?.some((id) => context.scopeIds.has(id))) continue;
      addDateBoundary(appointment.startsOn, false, context.timezone, appointment.id, `${appointment.title || appointment.id} start date`);
      addDateBoundary(appointment.endsOn, true, context.timezone, appointment.id, `${appointment.title || appointment.id} end date`);
      const holder = byId.get(appointment.holderId);
      addDateBoundary(holder?.startDate, false, context.timezone, holder?.id || appointment.id, `${holder?.title || appointment.holderId} start date`);
      addDateBoundary(holder?.endDate || holder?.statusTransition?.changedOn, true, context.timezone, holder?.id || appointment.id, `${holder?.title || appointment.holderId} end date`);
    }
  }
  if (boundaries.size > MAX_PERIOD_BOUNDARIES) {
    return {
      supported: true,
      start: options.start,
      end: options.end,
      timezone,
      snapshots: [],
      issues: [...boundaryIssues, issue(
        "reporting-route-period-too-complex",
        loaded.workspace.id,
        `Reporting Route period assessment is limited to ${MAX_PERIOD_BOUNDARIES} distinct change boundaries. Split the audit period or consolidate duplicate lifecycle facts.`
      )]
    };
  }
  const repository = await getRepositorySnapshot(loaded.root, { fresh: true });
  const snapshots = [];
  for (const at of [...boundaries].sort()) {
    snapshots.push(await assessReportingRouteSets(loaded, {
      ...options,
      at,
      [PERIOD_REPOSITORY_SNAPSHOT]: repository
    }));
  }
  const issues = [...new Map([...boundaryIssues, ...snapshots.flatMap((snapshot) => snapshot.issues)].map((item) => [
    `${item.code}\0${item.resourceId}\0${item.message}`,
    item
  ])).values()];
  return { supported: true, start: options.start, end: options.end, timezone, snapshots, issues };
}

export function effectiveReportingRouteRequirements(records, at = new Date(), programId, timezone = "UTC") {
  return deriveEffectiveReportingRouteRequirements(records, at, programId, timezone);
}

export async function proposeReportingRouteSet(input, options = {}) {
  const loaded = await loadWorkspace(input);
  const entry = routeEntry(loaded, options.routeSetId);
  if (entry.record.status !== "draft") throw new Error(`Reporting Channel Set "${entry.record.id}" must be draft before it is proposed.`);
  const proposalIssues = reportingRouteProposalIssues(loaded.resources, entry.record, {
    at: new Date(),
    timezone: loaded.workspace?.timezone || "UTC",
    root: loaded.root
  });
  if (proposalIssues.length) throw new Error(proposalIssues[0].message);
  const result = await updateResource(loaded.root, entry.record.type, entry.record.id, {
    ...entry.record,
    status: "proposed"
  }, {
    expectedRevision: options.expectedRevision || entry.revision,
    workflowCapability: INTERNAL_WORKFLOW_CAPABILITIES.reportingRouteSetProposal
  });
  return { ...result, commitRequired: true, nextAction: "Commit the proposal, then approve that exact commit." };
}

export async function approveReportingRouteSet(input, options = {}) {
  const loaded = await loadWorkspace(input);
  const entry = routeEntry(loaded, options.routeSetId);
  if (entry.record.status !== "proposed") throw new Error(`Reporting Channel Set "${entry.record.id}" must be proposed before approval.`);
  const proposalCommit = fullCommit(options.proposalCommit, "Proposal commit");
  assertProposalMatches(loaded, entry, proposalCommit);
  const proposalRecords = recordsAtRevision(loaded, proposalCommit);
  const proposalTimestamp = reportingRouteCommitTimestamp(loaded, entry.record.id, proposalCommit);
  if (!proposalTimestamp) throw new Error(`Proposal commit ${proposalCommit} is not present in Reporting Channel Set history.`);
  const proposalAssessmentAt = reportingRouteProposalAssessmentTime(proposalTimestamp, new Date());
  if (!proposalAssessmentAt) throw new Error("Proposal commit time is too far in the future to establish a reliable proposal.");
  const proposalIssues = reportingRouteProposalIssues(proposalRecords, entry.record, {
    at: proposalAssessmentAt,
    timezone: proposalRecords.find(({ type }) => type === "workspace")?.timezone || loaded.workspace?.timezone || "UTC",
    root: loaded.root,
    commit: proposalCommit
  });
  if (proposalIssues.length) throw new Error(proposalIssues[0].message);
  const approvedAt = pastOrPresentTimestamp(options.approvedAt, "Approval time");
  const effectiveAt = instant(options.effectiveAt, "Effective time");
  const timezone = timezoneName(options.timezone);
  assertTimestampZone(options.approvedAt, timezone, "Approval time");
  assertTimestampZone(options.effectiveAt, timezone, "Effective time");
  if (effectiveAt < approvedAt) throw new Error("A Reporting Channel Set cannot become effective before it is approved.");
  const cutoverIssues = reportingRouteSupportIssues(
    reportingRouteRequirementsForProposal(loaded.resources, entry.record, { at: effectiveAt, timezone }),
    entry.record,
    proposalRecords,
    loaded.resources,
    {
      at: effectiveAt,
      availableAt: approvedAt,
      timezone,
      root: loaded.root,
      proposalCommit
    }
  );
  if (cutoverIssues.length) throw new Error(cutoverIssues[0].message);
  const authority = approvalAuthority(loaded, entry.record, options, approvedAt, timezone);
  const approvalEvidenceIds = [...new Set(options.evidenceIds || [])];
  if (!reportingRouteFixedEvidence(
    loaded.resources,
    entry.record.id,
    approvalEvidenceIds,
    approvedAt,
    timezone,
    { root: loaded.root }
  ).length) {
    throw new Error("Reporting Route approval requires linked verified, fixed Evidence covering the approval event.");
  }
  const next = {
    ...entry.record,
    status: "approved",
    proposalCommit,
    approval: {
      proposalCommit,
      approvedById: authority.holderId,
      approvalAppointmentId: authority.id,
      approvedAt: String(options.approvedAt),
      effectiveAt: String(options.effectiveAt),
      timezone,
      evidenceIds: approvalEvidenceIds
    }
  };
  const predecessorEntry = entry.record.predecessorId
    ? routeEntry(loaded, entry.record.predecessorId)
    : null;
  if (predecessorEntry?.record.status === "approved") {
    if (effectiveAt > new Date()) {
      throw new Error("A successor that replaces an approved Route Set must become effective now or in the past so both lifecycle changes can be recorded atomically.");
    }
    const predecessorAppointmentId = options.predecessorCancellationAppointmentId || options.approvalAppointmentId;
    const predecessorAuthority = approvalAuthority(loaded, predecessorEntry.record, {
      approvalAppointmentId: predecessorAppointmentId,
      approvedById: options.predecessorCanceledById || options.approvedById
    }, effectiveAt, timezone);
    const predecessorEvidenceIds = [...new Set(options.predecessorCancellationEvidenceIds || [])];
    if (!reportingRouteFixedEvidence(
      loaded.resources,
      predecessorEntry.record.id,
      predecessorEvidenceIds,
      effectiveAt,
      timezone,
      { root: loaded.root }
    ).length) {
      throw new Error("Replacing an approved Reporting Route Set requires linked verified, fixed Evidence covering the predecessor cancellation event.");
    }
    const predecessor = {
      ...predecessorEntry.record,
      status: "canceled",
      cancellation: {
        canceledAt: String(options.effectiveAt),
        canceledById: predecessorAuthority.holderId,
        authorityAppointmentId: predecessorAuthority.id,
        reason: `Superseded by ${entry.record.id}.`,
        evidenceIds: predecessorEvidenceIds
      }
    };
    const batch = await applyResourceBatch(loaded.root, {
      update: [next, predecessor],
      expectedRevisions: {
        [entry.record.id]: options.expectedRevision || entry.revision,
        [predecessor.id]: options.predecessorExpectedRevision || predecessorEntry.revision
      },
      validateWholeWorkspace: true,
      workflowCapability: INTERNAL_WORKFLOW_CAPABILITIES.reportingRouteSetApproval
    });
    return {
      ...batch,
      record: next,
      replacedRouteSet: predecessor,
      commitRequired: true,
      nextAction: "Commit the approval and predecessor cancellation together before the channel cutover can be relied on."
    };
  }
  const result = await updateResource(loaded.root, entry.record.type, entry.record.id, next, {
    expectedRevision: options.expectedRevision || entry.revision,
    workflowCapability: INTERNAL_WORKFLOW_CAPABILITIES.reportingRouteSetApproval
  });
  return { ...result, commitRequired: true, nextAction: "Commit this approval before the Reporting Channel Set can become effective." };
}

export async function cancelReportingRouteSet(input, options = {}) {
  const loaded = await loadWorkspace(input);
  const entry = routeEntry(loaded, options.routeSetId);
  if (entry.record.status !== "approved") throw new Error(`Reporting Channel Set "${entry.record.id}" must be approved before cancellation.`);
  const canceledAt = pastOrPresentTimestamp(options.canceledAt, "Cancellation time");
  const timezone = timezoneName(options.timezone || entry.record.approval?.timezone);
  assertTimestampZone(options.canceledAt, timezone, "Cancellation time");
  if (canceledAt < new Date(entry.record.approval.effectiveAt)) {
    throw new Error("A Reporting Channel Set cannot be canceled before it becomes effective.");
  }
  const authority = approvalAuthority(loaded, entry.record, options, canceledAt, timezone);
  const evidenceIds = [...new Set(options.evidenceIds || [])];
  if (!reportingRouteFixedEvidence(
    loaded.resources,
    entry.record.id,
    evidenceIds,
    canceledAt,
    timezone,
    { root: loaded.root }
  ).length) {
    throw new Error("Reporting Route cancellation requires linked verified, fixed Evidence covering the cancellation event.");
  }
  const result = await updateResource(loaded.root, entry.record.type, entry.record.id, {
    ...entry.record,
    status: "canceled",
    cancellation: {
      canceledAt: String(options.canceledAt),
      canceledById: authority.holderId,
      authorityAppointmentId: authority.id,
      reason: requiredText(options.reason, "Cancellation reason"),
      evidenceIds
    }
  }, {
    expectedRevision: options.expectedRevision || entry.revision,
    workflowCapability: INTERNAL_WORKFLOW_CAPABILITIES.reportingRouteSetCancellation
  });
  return { ...result, commitRequired: true, nextAction: "Commit this cancellation before it changes route coverage." };
}

export function scaffoldReportingRouteSet(input = {}) {
  const action = input.action || "approve";
  if (!["approve", "cancel", "successor"].includes(action)) {
    throw new Error('Reporting Channel Set scaffold action must be "approve", "cancel", or "successor".');
  }
  if (action === "cancel") {
    return {
      routeSetId: input.routeSetId || "REPORTING_ROUTE_SET_ID",
      approvalAppointmentId: input.approvalAppointmentId || "CANCELLATION_APPOINTMENT_ID",
      canceledAt: input.canceledAt || new Date().toISOString(),
      timezone: input.timezone || "IANA_TIMEZONE",
      reason: input.reason || "CANCELLATION_REASON",
      evidenceIds: [],
      expectedRevision: input.expectedRevision || "CURRENT_ROUTE_SET_REVISION"
    };
  }
  const effectiveAt = input.effectiveAt || null;
  const scaffold = {
    routeSetId: input.routeSetId || "REPORTING_ROUTE_SET_ID",
    proposalCommit: input.proposalCommit || "FULL_PROPOSAL_COMMIT",
    approvalAppointmentId: input.approvalAppointmentId || "APPROVAL_APPOINTMENT_ID",
    approvedAt: input.approvedAt || new Date().toISOString(),
    effectiveAt,
    timezone: input.timezone || "IANA_TIMEZONE",
    evidenceIds: [],
    expectedRevision: input.expectedRevision || "CURRENT_ROUTE_SET_REVISION"
  };
  if (action === "successor") {
    scaffold.predecessorCancellationAppointmentId = input.predecessorCancellationAppointmentId || "PREDECESSOR_CANCELLATION_APPOINTMENT_ID";
    scaffold.predecessorCancellationEvidenceIds = [];
    scaffold.predecessorExpectedRevision = input.predecessorExpectedRevision || "CURRENT_PREDECESSOR_REVISION";
  }
  return scaffold;
}

function assessRouteSet(record, loaded, at, repository) {
  const issues = [];
  const approvalAssertionTiming = record.approval
    ? reportingRouteAssertionTiming(loaded, record, "approval")
    : null;
  const cancellationAssertionTiming = record.cancellation
    ? reportingRouteAssertionTiming(loaded, record, "cancellation")
    : null;
  const validEffectiveAt = typeof record.approval?.effectiveAt === "string"
    && !Number.isNaN(new Date(record.approval.effectiveAt).getTime());
  const committed = COMMIT_REQUIRED_STATUSES.has(record.status)
    ? repository.available && repository.commit && committedRecordMatches(loaded, record, repository.commit)
    : null;
  if (COMMIT_REQUIRED_STATUSES.has(record.status) && !committed) {
    issues.push(issue("reporting-route-commit-required", record.id, `${record.title} must be committed before this lifecycle state can be relied on.`));
  }
  const proposalEntry = loaded.entries.find(({ record: candidate }) => candidate.id === record.id);
  const historicalProposal = ["approved", "canceled"].includes(record.status)
    && proposalEntry
    && /^[a-f0-9]{40}$/i.test(String(record.proposalCommit || ""))
    ? reportingRouteRecordAtRevision(loaded, proposalEntry, record.proposalCommit)
    : null;
  if (record.status === "proposed") {
    const proposalHistory = committed && repository.commit
      ? reportingRouteExactHistoryEntry(loaded, record, repository.commit)
      : null;
    const proposalRecords = proposalHistory ? recordsAtRevision(loaded, proposalHistory.commit) : loaded.resources;
    const proposalRecord = proposalHistory
      ? proposalRecords.find(({ id }) => id === record.id) || record
      : record;
    const proposalAssessmentAt = proposalHistory
      ? reportingRouteProposalAssessmentTime(proposalHistory.timestamp, at)
      : at;
    if (proposalHistory && !proposalAssessmentAt) {
      issues.push(issue("invalid-reporting-route-proposal-time", record.id, "The proposal commit time is too far in the future to establish a reliable proposal."));
    }
    issues.push(...reportingRouteProposalIssues(proposalRecords, proposalRecord, {
      at: proposalAssessmentAt || at,
      timezone: proposalRecords.find(({ type }) => type === "workspace")?.timezone || loaded.workspace?.timezone || "UTC",
      root: loaded.root,
      commit: proposalHistory?.commit
    }));
  } else if (historicalProposal) {
    const proposalRecords = recordsAtRevision(loaded, record.proposalCommit);
    const proposalTimestamp = reportingRouteCommitTimestamp(loaded, record.id, record.proposalCommit);
    const proposalAssessmentAt = proposalTimestamp
      ? reportingRouteProposalAssessmentTime(proposalTimestamp, at)
      : null;
    if (!proposalTimestamp) {
      issues.push(issue("invalid-reporting-route-proposal", record.id, "The proposal commit must be an exact Reporting Channel Set history entry."));
    } else if (!proposalAssessmentAt) {
      issues.push(issue("invalid-reporting-route-proposal-time", record.id, "The proposal commit time is too far in the future to establish a reliable proposal."));
    } else {
      const proposalIssues = reportingRouteProposalIssues(
        proposalRecords,
        historicalProposal,
        {
          at: proposalAssessmentAt,
          timezone: proposalRecords.find(({ type }) => type === "workspace")?.timezone || loaded.workspace?.timezone || "UTC",
          root: loaded.root,
          commit: record.proposalCommit
        }
      );
      issues.push(...proposalIssues);
      if (!proposalIssues.length) {
        const approvalCommit = reportingRouteEventCommit(loaded, record, "approval");
        const approvalRecords = approvalCommit ? recordsAtRevision(loaded, approvalCommit) : loaded.resources;
        const liveCommit = record.status === "canceled"
          ? reportingRouteEventCommit(loaded, record, "cancellation")
          : null;
        const liveRecords = liveCommit ? recordsAtRevision(loaded, liveCommit) : loaded.resources;
        const cutoverAt = record.approval?.effectiveAt || record.approval?.approvedAt || at;
        const cutoverTimezone = record.approval?.timezone || loaded.workspace?.timezone || "UTC";
        issues.push(...reportingRouteSupportIssues(
          reportingRouteRequirementsForProposal(approvalRecords, record, {
            at: cutoverAt,
            timezone: cutoverTimezone
          }),
          record,
          proposalRecords,
          liveRecords,
          {
            at: cutoverAt,
            availableAt: record.approval?.approvedAt || at,
            timezone: cutoverTimezone,
            root: loaded.root,
            proposalCommit: record.proposalCommit,
            currentCommit: liveCommit
          }
        ));
      }
    }
  }
  if (record.status === "approved" && record.approval && repository.commit && !isDataHistoryAncestor(loaded, record.proposalCommit, repository.commit)) {
    issues.push(issue("invalid-reporting-route-proposal-lineage", record.id, "The approved revision must descend from the exact committed proposal."));
  }
  if (["approved", "canceled"].includes(record.status)) {
    issues.push(...reportingRouteLifecycleIssues(loaded, record));
  }
  if (["approved", "canceled"].includes(record.status) && !validEffectiveAt) {
    issues.push(issue("invalid-reporting-route-approval", record.id, `${record.title} needs a valid approval and effective timestamp.`));
  }
  const effective = ["approved", "canceled"].includes(record.status)
    && committed
    && validEffectiveAt
    && new Date(record.approval.effectiveAt) <= at;
  const validCanceledAt = typeof record.cancellation?.canceledAt === "string"
    && !Number.isNaN(new Date(record.cancellation.canceledAt).getTime());
  const canceled = record.status === "canceled" && committed && validCanceledAt && new Date(record.cancellation.canceledAt) <= at;
  let authorities = [];
  if (effective && !canceled) {
    try {
      authorities = reportingRouteOngoingAuthorities(loaded.resources, record, at, loaded.workspace?.id);
    } catch {
      issues.push(issue("invalid-reporting-route-timezone", record.id, `${record.title} has an invalid approval timezone.`));
    }
  }
  if (effective && !canceled && !authorities.length) {
    issues.push(issue("missing-reporting-route-authority", record.id, `${record.title} has no current ${record.authorityAppointmentKind} Appointment.`));
  }
  const state = issues.length
    ? "action"
    : record.status === "draft" || (record.status === "approved" && !effective)
      ? "later"
      : record.status === "proposed"
        ? "action"
        : effective && !canceled
          ? "complete"
          : "inactive";
  return {
    record,
    committed,
    effective,
    canceled,
    authorities,
    approvalAssertionTiming,
    cancellationAssertionTiming,
    issues,
    state
  };
}

function proposedRequirementAssessment(record, loaded, repository, requirements, at, timezone) {
  const history = repository.commit
    ? reportingRouteExactHistoryEntry(loaded, record, repository.commit)
    : null;
  const records = history ? recordsAtRevision(loaded, history.commit) : loaded.resources;
  return {
    proposedRequirementIssues: reportingRouteProposalIssuesForRequirements(
      requirements,
      record,
      records,
      {
        at: history ? reportingRouteProposalAssessmentTime(history.timestamp, at) || at : at,
        timezone,
        root: loaded.root,
        commit: history?.commit
      }
    )
  };
}

function committedRecordMatches(loaded, record, commit) {
  const entry = loaded.entries.find(({ record: candidate }) => candidate.id === record.id);
  const historical = entry ? reportingRouteRecordAtRevision(loaded, entry, commit) : null;
  return historical ? JSON.stringify(historical) === JSON.stringify(record) : false;
}

function reportingRouteLifecycleIssues(loaded, record) {
  const issues = [];
  const entry = loaded.entries.find(({ record: candidate }) => candidate.id === record.id);
  if (new Date(record.approval?.approvedAt) > new Date()) {
    issues.push(issue("future-reporting-route-approval", record.id, "Approval time must be an actual nonfuture event time."));
  }
  const proposal = entry && /^[a-f0-9]{40}$/i.test(String(record.proposalCommit || ""))
    ? reportingRouteRecordAtRevision(loaded, entry, record.proposalCommit)
    : null;
  if (!proposal || proposal.status !== "proposed" || !sameRouteProposal(proposal, record)) {
    issues.push(issue("changed-reporting-route-proposal", record.id, "The approved Route Set facts do not match the exact committed proposal."));
  }
  if (record.approval?.proposalCommit !== record.proposalCommit) {
    issues.push(issue("invalid-reporting-route-proposal", record.id, "Approval proposalCommit does not match the Route Set proposalCommit."));
  }
  const approvalCommit = reportingRouteEventCommit(loaded, record, "approval");
  if (approvalCommit && (
    approvalCommit === record.proposalCommit
    || !isDataHistoryAncestor(loaded, record.proposalCommit, approvalCommit)
  )) {
    issues.push(issue("invalid-reporting-route-order", record.id, "The approval commit must descend from the exact proposal commit."));
  }
  const approvalAuthorityIssue = reportingRouteEventAuthorityIssueAtCommit(loaded, record, "approval");
  if (approvalAuthorityIssue) issues.push(issue(approvalAuthorityIssue.code, record.id, approvalAuthorityIssue.message));
  if (
    !reportingRouteFixedEvidence(
      loaded.resources,
      record.id,
      record.approval?.evidenceIds,
      record.approval?.approvedAt,
      record.approval?.timezone,
      { root: loaded.root }
    ).length
  ) {
    issues.push(issue("missing-reporting-route-event-evidence", record.id, "Reporting Route approval needs linked verified, fixed Evidence covering the approval event."));
  }
  if (record.status === "canceled") {
    const cancellationCommit = reportingRouteEventCommit(loaded, record, "cancellation");
    if (approvalCommit && cancellationCommit && (
      cancellationCommit === approvalCommit
      || !isDataHistoryAncestor(loaded, approvalCommit, cancellationCommit)
    )) {
      issues.push(issue("invalid-reporting-route-order", record.id, "The cancellation commit must descend from the approval commit."));
    }
    if (new Date(record.cancellation?.canceledAt) > new Date()) {
      issues.push(issue("future-reporting-route-cancellation", record.id, "Cancellation time must be an actual nonfuture event time."));
    }
    const cancellationAuthorityIssue = reportingRouteEventAuthorityIssueAtCommit(loaded, record, "cancellation");
    if (cancellationAuthorityIssue) issues.push(issue(cancellationAuthorityIssue.code, record.id, cancellationAuthorityIssue.message));
    if (new Date(record.cancellation?.canceledAt) < new Date(record.approval?.effectiveAt)) {
      issues.push(issue("invalid-reporting-route-order", record.id, "The Route Set was canceled before it became effective."));
    }
    if (
      !reportingRouteFixedEvidence(
        loaded.resources,
        record.id,
        record.cancellation?.evidenceIds,
        record.cancellation?.canceledAt,
        record.approval?.timezone,
        { root: loaded.root }
      ).length
    ) {
      issues.push(issue("missing-reporting-route-event-evidence", record.id, "Reporting Route cancellation needs linked verified, fixed Evidence covering the cancellation event."));
    }
  }
  return issues;
}

function sameRouteProposal(proposal, finalized) {
  const allowed = new Set(["status", "proposalCommit", "approval", "cancellation"]);
  const keys = new Set([...Object.keys(proposal), ...Object.keys(finalized)]);
  return [...keys].every((key) => allowed.has(key) || JSON.stringify(proposal[key]) === JSON.stringify(finalized[key]));
}

function assertProposalMatches(loaded, entry, commit) {
  const historical = reportingRouteRecordAtRevision(loaded, entry, commit);
  if (!historical) throw new Error(`Proposal commit ${commit} does not contain valid JSON for Reporting Channel Set "${entry.record.id}".`);
  if (JSON.stringify(historical) !== JSON.stringify(entry.record)) {
    throw new Error("The current JSON does not exactly match the supplied proposal commit. Restore or repropose the changed Route Set.");
  }
}

function approvalAuthority(loaded, routeSet, options, at, timezone) {
  const appointment = loaded.resources.find(({ type, id }) => type === "appointment" && id === options.approvalAppointmentId);
  const authorityIssue = reportingRouteEventAuthorityIssue(loaded.resources, routeSet, {
    appointmentId: options.approvalAppointmentId,
    actorId: options.approvedById || appointment?.holderId,
    at,
    timezone,
    workspaceId: loaded.workspace.id
  });
  if (authorityIssue) throw new Error(authorityIssue.message);
  return appointment;
}

function routeEntry(loaded, id) {
  const entry = loaded.entries.find(({ record }) => record.type === "reporting-route-set" && record.id === id);
  if (!entry) throw new Error(`Reporting Channel Set "${id || ""}" was not found.`);
  return entry;
}

function assertTimestampZone(value, timezone, label) {
  const source = typeof value === "string" ? value : value.toISOString();
  const local = source.replace(/(?:Z|[+-]\d\d:\d\d)$/, "").replace(/\.\d+$/, "");
  if (localDateTimeValue(value, timezone) !== local) {
    throw new Error(`${label} UTC offset does not match ${timezone}.`);
  }
}

function pastOrPresentTimestamp(value, label) {
  const result = instant(value, label);
  if (result > new Date()) throw new Error(`${label} cannot be in the future.`);
  return result;
}

function instant(value, label) {
  const result = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(result.getTime())) throw new Error(`${label} must be an RFC 3339 timestamp.`);
  return result;
}

function fullCommit(value, label) {
  if (!/^[a-f0-9]{40}$/i.test(String(value || ""))) throw new Error(`${label} must be a full 40-character Git commit ID.`);
  return value;
}

function timezoneName(value) {
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); } catch { throw new Error("An IANA timezone is required."); }
  return value;
}

function requiredText(value, label) {
  if (!String(value || "").trim()) throw new Error(`${label} is required.`);
  return String(value).trim();
}

function issue(code, resourceId, message) {
  return { code, resourceId, message };
}
