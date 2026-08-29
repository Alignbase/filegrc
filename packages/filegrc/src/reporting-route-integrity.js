import { createHash } from "node:crypto";
import {
  getDataRecordHistoryIndex,
  getFileAtRevision,
  getFileObjectIdAtRevision,
  getGitSummary,
  getWorkingFileObjectId,
  hasGitRevision,
  isDataHistoryAncestor
} from "./git.js";
import { addCalendarDays } from "./recurrence.js";
import { coverageContains } from "./coverage.js";
import { appointmentWasAuthorizedOn } from "./soc2.js";
import { isRfc3339Timestamp, localDateTimeValue, timestampFromLocalDateTime } from "./time.js";

const CONTEMPORANEOUS_COMMIT_WINDOW_MS = 86_400_000;

export function reportingRouteRevision(record) {
  const effectiveFacts = {
    id: record.id,
    type: record.type,
    title: record.title,
    purpose: record.purpose,
    priority: record.priority,
    channelKind: record.channelKind,
    route: record.route,
    effectiveAt: record.effectiveAt,
    dependencySystemIds: record.dependencySystemIds,
    approvedByIds: record.approvedByIds,
    approvedOn: record.approvedOn,
    sourceResourceIds: record.sourceResourceIds,
    ownerIds: record.ownerIds
  };
  return createHash("sha256").update(JSON.stringify(effectiveFacts)).digest("hex");
}

export function reportingRouteEventAuthorityIssue(records, routeSet, options = {}) {
  const appointment = records.find(({ type, id }) => type === "appointment" && id === options.appointmentId);
  if (!appointment) {
    return { code: "invalid-reporting-route-authority", message: `Approval Appointment "${options.appointmentId || ""}" was not found.` };
  }
  if (appointment.appointmentKind !== routeSet.approvalAppointmentKind) {
    return {
      code: "invalid-reporting-route-authority",
      message: `Approval Appointment "${appointment.id}" must use the authorized ${routeSet.approvalAppointmentKind} Appointment kind.`
    };
  }
  if (appointment.appointmentKind === routeSet.authorityAppointmentKind) {
    return { code: "reporting-route-authority-not-separated", message: "Approval and ongoing route authority must use separate Appointment kinds." };
  }
  let at;
  let timezone;
  try {
    at = instant(options.at, "Reporting Route authority time");
    timezone = timezoneName(options.timezone);
  } catch (error) {
    return { code: "invalid-reporting-route-authority", message: error.message };
  }
  const date = localDateTimeValue(at, timezone).slice(0, 10);
  const byId = new Map(records.map((record) => [record.id, record]));
  if (!appointmentWasAuthorizedOn(appointment, date, byId)) {
    return {
      code: "invalid-reporting-route-authority",
      message: `Approval Appointment "${appointment.id}" and its holder were not authorized at ${at.toISOString()}.`
    };
  }
  if (!arrayValue(appointment.scopeResourceIds).some((id) => [routeSet.id, routeSet.programId, options.workspaceId].includes(id))) {
    return {
      code: "invalid-reporting-route-authority",
      message: `Approval Appointment "${appointment.id}" does not cover this Route Set, Program, or Workspace.`
    };
  }
  if (options.actorId !== appointment.holderId) {
    return { code: "invalid-reporting-route-authority", message: "The approving Person must be the Appointment holder at the asserted event time." };
  }
  if (reportingRouteOngoingAuthorities(records, routeSet, at, options.workspaceId).some(({ holderId }) => holderId === appointment.holderId)) {
    return {
      code: "reporting-route-authority-not-separated",
      message: "The approving Person must be independent from the Person responsible for the reporting channels at the event time."
    };
  }
  return null;
}

export function reportingRouteAssertionTiming(loaded, routeSet, eventName) {
  const event = routeSet[eventName];
  const eventAt = eventName === "approval" ? event?.approvedAt : event?.canceledAt;
  if (!eventAt) return null;
  const history = [...reportingRouteHistory(loaded, routeSet.id)].reverse();
  for (const commit of history) {
    const source = getFileAtRevision(loaded.root, commit.commit, commit.path);
    if (!source) continue;
    try {
      if (JSON.parse(source)[eventName]) {
        return assertionTimingAt(new Date(eventAt), new Date(commit.timestamp));
      }
    } catch {
      continue;
    }
  }
  return assertionTimingAt(new Date(eventAt), new Date());
}

export function reportingRouteFixedEvidence(records, subjectId, evidenceIds, at, timezone = "UTC", options = {}) {
  let date;
  try {
    date = /^\d{4}-\d{2}-\d{2}$/.test(String(at || ""))
      ? String(at)
      : localDateTimeValue(instant(at, "Supported event time"), timezone).slice(0, 10);
  } catch {
    return [];
  }
  const selected = new Set(arrayValue(evidenceIds));
  const personIds = new Set(options.personIds || records.filter(({ type }) => type === "person").map(({ id }) => id));
  return records.filter((evidence) => {
    if (
      !selected.has(evidence.id)
      || evidence.type !== "evidence"
      || evidence.status !== "verified"
      || !arrayValue(evidence.sourceResourceIds).includes(subjectId)
      || !verifiedEvidenceComplete(evidence, personIds)
    ) return false;
    const coversDate = coverageContains(evidence.coverage, date)
      || [evidence.businessEventAt, evidence.sourceGeneratedAt].filter(Boolean).some((value) => {
        try { return localDateTimeValue(new Date(value), timezone).slice(0, 10) === date; } catch { return false; }
      });
    const filePaths = arrayValue(evidence.filePaths);
    const hasFileMaterial = evidence.sourceKind === "file" && filePaths.length && (!options.root || filePaths.every((path) => {
      const relativePath = `data/${path}`;
      if (options.commit) return Boolean(getFileObjectIdAtRevision(options.root, options.commit, relativePath));
      return Boolean(getWorkingFileObjectId(options.root, relativePath));
    }));
    const authoritativeCommit = options.commit || (options.root ? getGitSummary(options.root).commit : null);
    const hasFixedMaterial = hasFileMaterial
      || (
        evidence.sourceKind === "rendered-page"
        && evidence.artifactKind === "rendered-page"
        && evidence.capture
        && coverageContains(evidence.capture.coverage, date)
        && evidence.sourceCommit
        && options.root
        && hasGitRevision(options.root, evidence.sourceCommit)
        && authoritativeCommit
        && isDataHistoryAncestor(options.root, evidence.sourceCommit, authoritativeCommit)
      );
    return coversDate && Boolean(hasFixedMaterial);
  });
}

function verifiedEvidenceComplete(evidence, personIds) {
  const collectors = arrayValue(evidence.collectorIds);
  const verifiers = arrayValue(evidence.verifierIds);
  if (
    typeof evidence.sourceDescription !== "string"
    || !evidence.sourceDescription.trim()
    || !validCalendarDate(evidence.collectedOn)
    || !validCalendarDate(evidence.verifiedOn)
    || evidence.verifiedOn < evidence.collectedOn
    || !collectors.length
    || !verifiers.length
    || !collectors.every((id) => personIds.has(id))
    || !verifiers.every((id) => personIds.has(id))
  ) return false;
  if (evidence.sourceKind !== "rendered-page") return true;
  return evidence.capture
    && typeof evidence.capture.route === "string"
    && evidence.capture.route.trim()
    && evidence.capture.filters
    && typeof evidence.capture.filters === "object"
    && !Array.isArray(evidence.capture.filters)
    && isRfc3339Timestamp(evidence.capture.capturedAt)
    && typeof evidence.capture.method === "string"
    && evidence.capture.method.trim();
}

function validCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function reportingRouteEventCommit(loaded, routeSet, eventName) {
  const history = [...reportingRouteHistory(loaded, routeSet.id)].reverse();
  for (const commit of history) {
    const source = getFileAtRevision(loaded.root, commit.commit, commit.path);
    try {
      if (source && JSON.parse(source)[eventName]) return commit.commit;
    } catch {
      continue;
    }
  }
  return null;
}

export function reportingRouteEventAuthorityIssueAtCommit(loaded, routeSet, eventName) {
  const event = routeSet[eventName];
  const commit = reportingRouteEventCommit(loaded, routeSet, eventName);
  const options = eventName === "approval" ? {
    appointmentId: event?.approvalAppointmentId,
    actorId: event?.approvedById,
    at: event?.approvedAt,
    timezone: event?.timezone,
    workspaceId: loaded.workspace.id
  } : {
    appointmentId: event?.authorityAppointmentId,
    actorId: event?.canceledById,
    at: event?.canceledAt,
    timezone: routeSet.approval?.timezone,
    workspaceId: loaded.workspace.id
  };
  const records = commit ? recordsAtRevision(loaded, commit) : loaded.resources;
  const historicalRoute = records.find(({ id }) => id === routeSet.id) || routeSet;
  const historicalIssue = reportingRouteEventAuthorityIssue(records, historicalRoute, options);
  if (historicalIssue) return historicalIssue;
  const eventAt = instant(options.at, "Reporting Route authority time");
  if (reportingRouteOngoingAuthorities(
    loaded.resources,
    routeSet,
    eventAt,
    loaded.workspace.id
  ).some(({ holderId }) => holderId === options.actorId)) {
    return {
      code: "reporting-route-authority-not-separated",
      message: "The approving Person must be independent from every current or backfilled Appointment responsible for the reporting channels at the event time."
    };
  }
  return null;
}

export function reportingRouteOngoingAuthorities(records, routeSet, at, workspaceId) {
  const date = localDateTimeValue(at, routeSet.approval?.timezone || "UTC").slice(0, 10);
  const byId = new Map(records.map((record) => [record.id, record]));
  return records.filter((record) => (
    record.type === "appointment"
    && record.appointmentKind === routeSet.authorityAppointmentKind
    && arrayValue(record.scopeResourceIds).some((id) => [routeSet.id, routeSet.programId, workspaceId].includes(id))
    && appointmentWasAuthorizedOn(record, date, byId)
  ));
}

export function effectiveReportingRouteRequirements(records, at = new Date(), programId, timezone = "UTC") {
  const when = instant(at, "Requirement assessment time");
  const program = programId ? records.find(({ type, id }) => type === "program" && id === programId) : null;
  return records.flatMap((source) => {
    try {
      if (!reportingRouteSourceEffective(source, when, timezone)) return [];
    } catch {
      return [];
    }
    if (programId && !program) return [];
    const requirements = Array.isArray(source.reportingRouteRequirements) ? source.reportingRouteRequirements : [];
    return requirements.filter((requirement) => (
      requirement && typeof requirement === "object" && !Array.isArray(requirement)
      && typeof requirement.effectiveAt === "string"
      && (!programId || reportingRouteRequirementAppliesToProgram(requirement, programId))
      &&
      new Date(requirement.effectiveAt) <= when
      && (!requirement.endsAt || new Date(requirement.endsAt) > when)
    )).map((requirement) => ({ ...requirement, sourceId: source.id, sourceType: source.type }));
  });
}

export function reportingRouteSourceAppliesToProgram(source, program, records) {
  if (!program || !source) return false;
  return (Array.isArray(source.reportingRouteRequirements) ? source.reportingRouteRequirements : [])
    .some((requirement) => reportingRouteRequirementAppliesToProgram(requirement, program.id));
}

export function reportingRouteRequirementAppliesToProgram(requirement, programId) {
  if (!requirement || typeof requirement !== "object" || Array.isArray(requirement)) return false;
  if (!programId) return true;
  if (requirement.programScope === "all-programs") return true;
  return requirement.programScope === "selected-programs"
    && arrayValue(requirement.programIds).includes(programId);
}

export function reportingRouteSourceEffective(source, at, timezone = "UTC") {
  const when = instant(at, "Source assessment time");
  if (!reportingRouteSourceMayApply(source)) return false;
  if (["policy", "document", "commitment"].includes(source.type) && source.effectiveOn) {
    const startsAt = new Date(timestampFromLocalDateTime(`${source.effectiveOn}T00:00:00`, timezone));
    if (startsAt > when) return false;
  }
  if (["superseded", "retired", "closed", "archived"].includes(source.status)) {
    const changedOn = source.statusTransition?.changedOn;
    if (!changedOn) return false;
    const endsAt = new Date(timestampFromLocalDateTime(`${changedOn}T00:00:00`, timezone));
    if (endsAt <= when) return false;
  }
  return true;
}

export function reportingRouteSourceMayApply(source) {
  if (source?.type === "policy" || source?.type === "document") {
    return ["active", "superseded", "retired"].includes(source.status);
  }
  if (source?.type === "commitment") return ["active", "superseded", "retired"].includes(source.status);
  if (source?.type === "risk") return ["open", "monitoring", "closed", "archived"].includes(source.status);
  return false;
}

export function reportingRouteSetInterval(routeSet) {
  if (!["approved", "canceled"].includes(routeSet?.status) || !routeSet.approval?.effectiveAt) return null;
  return {
    start: new Date(routeSet.approval.effectiveAt),
    end: routeSet.status === "canceled" && routeSet.cancellation?.canceledAt
      ? new Date(routeSet.cancellation.canceledAt)
      : null
  };
}

export function governingReportingRouteSetsAt(records, at, options = {}) {
  const when = instant(at, "Reporting Route assessment time");
  return records.filter((record) => {
    if (record.type !== "reporting-route-set" || record.purposeKey !== options.purposeKey) return false;
    if (options.programId && record.programId !== options.programId) return false;
    const interval = reportingRouteSetInterval(record);
    return interval && interval.start <= when && (!interval.end || interval.end > when);
  });
}

export function reportingRouteBindingExpectation(loaded, attestation) {
  return reportingRouteBindingExpectationFromState(loaded, attestation, loaded.resources, getGitSummary(loaded.root).commit);
}

export function reportingRouteBindingExpectationForValidation(loaded, attestation) {
  const index = getDataRecordHistoryIndex(loaded.root);
  const history = [...(index.historiesById.get(attestation.id) || [])].reverse();
  for (const summary of history) {
    const source = getFileAtRevision(loaded.root, summary.commit, summary.path);
    let historicalAttestation;
    try { historicalAttestation = source ? JSON.parse(source) : null; } catch { continue; }
    if (historicalAttestation?.type !== "attestation" || historicalAttestation.status !== "completed") continue;
    return reportingRouteBindingExpectationFromState(
      loaded,
      historicalAttestation,
      recordsAtRevision(loaded, summary.commit),
      summary.commit
    );
  }
  return reportingRouteBindingExpectation(loaded, attestation);
}

function reportingRouteBindingExpectationFromState(loaded, attestation, records, head) {
  const date = attestation.assignedOn || attestation.completedOn;
  if (!date) return { required: false, routeSet: null, commit: null };
  const timezone = records.find(({ type }) => type === "workspace")?.timezone || loaded.workspace.timezone;
  if (records.some((source) => (
    source.reportingRouteRequirements !== undefined
    && !Array.isArray(source.reportingRouteRequirements)
  ))) {
    return { required: true, routeSet: null, commit: null, error: "Historical Reporting Route requirements must be arrays before an Attestation binding can be verified." };
  }
  let dayStart;
  let dayEnd;
  try {
    dayStart = new Date(timestampFromLocalDateTime(`${date}T00:00:00`, timezone));
    dayEnd = new Date(timestampFromLocalDateTime(`${addCalendarDays(date, 1)}T00:00:00`, timezone));
  } catch {
    return { required: true, routeSet: null, commit: null, error: "The Attestation assignment date is invalid." };
  }
  const rawBoundaries = records.flatMap((source) => (Array.isArray(source.reportingRouteRequirements) ? source.reportingRouteRequirements : [])
    .filter((requirement) => requirement?.purposeKey === "security-reporting")
    .flatMap((requirement) => [requirement.effectiveAt, requirement.endsAt]))
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()) && value > dayStart && value < dayEnd);
  const samples = [dayStart, new Date(dayEnd.getTime() - 1), ...rawBoundaries];
  let anyRequired = false;
  try {
    anyRequired = samples.some((at) => effectiveReportingRouteRequirements(records, at, undefined, timezone)
      .some(({ purposeKey }) => purposeKey === "security-reporting"));
  } catch {
    return { required: true, routeSet: null, commit: null, error: "Reporting Route requirements contain an invalid effective interval." };
  }
  if (!anyRequired) return { required: false, routeSet: null, commit: null };
  const program = records.find(({ type, id }) => type === "program" && id === attestation.programId);
  if (!program) {
    return {
      required: true,
      routeSet: null,
      commit: null,
      error: "A completed Attestation subject to security-reporting requirements must name its Program."
    };
  }
  const programId = program.id;
  let dayRequired = false;
  try {
    dayRequired = samples.some((at) => effectiveReportingRouteRequirements(records, at, programId, timezone)
      .some(({ purposeKey }) => purposeKey === "security-reporting"));
  } catch {
    return { required: true, routeSet: null, commit: null, error: "Reporting Route requirements contain an invalid effective interval." };
  }
  if (!dayRequired) return { required: false, routeSet: null, commit: null };
  let cutoff;
  if (attestation.assignedAt) {
    try {
      cutoff = instant(attestation.assignedAt, "Attestation assignment time");
      if (localDateTimeValue(cutoff, timezone).slice(0, 10) !== date) {
        return { required: true, routeSet: null, commit: null, error: "Attestation assignedAt must fall on assignedOn in the Workspace timezone." };
      }
    } catch (error) {
      return { required: true, routeSet: null, commit: null, error: error.message };
    }
  } else {
    const scopedSources = records.filter((source) => (
      reportingRouteSourceAppliesToProgram(source, program, records)
      && (Array.isArray(source.reportingRouteRequirements) ? source.reportingRouteRequirements : [])
        .some((requirement) => requirement?.purposeKey === "security-reporting")
    ));
    const boundaryInsideDay = [
      ...scopedSources.flatMap((source) => (Array.isArray(source.reportingRouteRequirements) ? source.reportingRouteRequirements : [])
        .flatMap((requirement) => [requirement?.effectiveAt, requirement?.endsAt])),
      ...records.filter(({ type, programId: routeProgramId, purposeKey }) => (
        type === "reporting-route-set" && routeProgramId === programId && purposeKey === "security-reporting"
      )).flatMap((route) => [route.approval?.effectiveAt, route.cancellation?.canceledAt])
    ].map((value) => new Date(value)).some((value) => (
      !Number.isNaN(value.getTime()) && value > dayStart && value < dayEnd
    ));
    if (boundaryInsideDay) {
      return {
        required: true,
        routeSet: null,
        commit: null,
        error: `Attestation assignedAt is required because reporting requirements or channels changed during ${date}.`
      };
    }
    cutoff = new Date(dayEnd.getTime() - 1);
  }
  const required = effectiveReportingRouteRequirements(records, cutoff, programId, timezone)
    .some(({ purposeKey }) => purposeKey === "security-reporting");
  if (!required) return { required: false, routeSet: null, commit: null };
  const routeSets = governingReportingRouteSetsAt(records, cutoff, {
    purposeKey: "security-reporting",
    programId
  });
  if (routeSets.length !== 1) {
    return {
      required: true,
      routeSet: null,
      commit: null,
      error: routeSets.length
        ? `More than one Reporting Channel Set governed security reporting on ${date}.`
        : `No Reporting Channel Set governed security reporting on ${date}.`
    };
  }
  const routeSet = routeSets[0];
  const entry = loaded.entries.find(({ record }) => record.id === routeSet.id);
  const commit = entry && head
    ? approvedRouteSetCommit(loaded, entry, head)
    : null;
  return {
    required: true,
    routeSet,
    commit,
    ...(!commit ? { error: `The approved revision for Reporting Channel Set "${routeSet.id}" is not available in authoritative Git history.` } : {})
  };
}

export function bindAttestationReportingRouteSet(loaded, attestation) {
  const bound = { ...attestation };
  delete bound.reportingRouteSetId;
  delete bound.reportingRouteSetCommit;
  const expectation = reportingRouteBindingExpectation(loaded, attestation);
  if (!expectation.required) return bound;
  const repository = getGitSummary(loaded.root);
  if (!repository.available || !repository.clean || !repository.commit) {
    throw new Error("Commit all Reporting Channel Set facts before completing an Attestation that must bind delivery proof.");
  }
  if (expectation.error) throw new Error(expectation.error);
  return {
    ...bound,
    reportingRouteSetId: expectation.routeSet.id,
    reportingRouteSetCommit: expectation.commit
  };
}

export function assertionTimingAt(eventAt, recordedAt) {
  const elapsed = recordedAt.getTime() - eventAt.getTime();
  if (elapsed < 0) return "git-recorded-before-event";
  return elapsed >= 0 && elapsed <= CONTEMPORANEOUS_COMMIT_WINDOW_MS
    ? "git-recorded-within-day"
    : "git-recorded-later";
}

function instant(value, label) {
  const result = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(result.getTime())) throw new Error(`${label} must be an RFC 3339 timestamp.`);
  return result;
}

function timezoneName(value) {
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); } catch { throw new Error("An IANA timezone is required."); }
  return value;
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function approvedRouteSetCommit(loaded, entry, head) {
  const history = reportingRouteHistory(loaded, entry.record.id);
  for (const summary of history) {
    if (!isDataHistoryAncestor(loaded, summary.commit, head)) continue;
    const source = getFileAtRevision(loaded.root, summary.commit, summary.path);
    try {
      const route = source ? JSON.parse(source) : null;
      if (route?.status === "approved") return summary.commit;
    } catch {
      continue;
    }
  }
  return null;
}

export function reportingRouteRecordAtRevision(loaded, entry, commit) {
  const identity = reportingRouteHistory(loaded, entry.record.id)
    .find(({ commit: changedAt }) => isDataHistoryAncestor(loaded, changedAt, commit));
  const path = identity?.path;
  const source = path ? getFileAtRevision(loaded.root, commit, path) : null;
  try { return source ? JSON.parse(source) : null; } catch { return null; }
}

export function reportingRouteHistory(loaded, routeSetId) {
  return getDataRecordHistoryIndex(loaded.root).historiesById.get(routeSetId) || [];
}

export function recordsAtRevision(loaded, commit) {
  const index = getDataRecordHistoryIndex(loaded.root);
  const records = [];
  for (const [id, history] of index.historiesById) {
    const identity = history.find(({ commit: changedAt }) => isDataHistoryAncestor(loaded, changedAt, commit));
    if (!identity) continue;
    const source = getFileAtRevision(loaded.root, commit, identity.path);
    try {
      const record = source ? JSON.parse(source) : null;
      if (record?.id === id) records.push(record);
    } catch {
      continue;
    }
  }
  return records;
}
