import { readFile } from "node:fs/promises";
import {
  getDataRecordHistoryIndex,
  getFileAtRevision,
  getFileHistory,
  getFileObjectIdAtRevision,
  getFilePathAtRevision,
  getRecordIdentityHistories,
  getWorkingFileObjectId,
  isDataHistoryAncestor
} from "./git.js";
import { resolveDataPath } from "./paths.js";
import { markdownEntries } from "./resource-markdown.js";
import { currentCalendarDate, isRfc3339Timestamp, timestampFromLocalDateTime } from "./time.js";
import { recordsAtRevision, reportingRouteFixedEvidence } from "./reporting-route-integrity.js";

const FINAL_STATUSES = new Map([
  ["reconciliation-dismissal", new Set([undefined])],
  ["collection-review", new Set(["active", "retired"])],
  ["obligation-rule", new Set(["active", "retired"])],
  ["obligation-occurrence", new Set(["reconciled", "superseded"])],
  ["audit-population", new Set(["reconciled", "not-applicable", "superseded"])],
  ["reporting-route", new Set(["active", "retired"])],
  ["reporting-route-set", new Set(["approved", "canceled", "historical"])],
  ["attestation", new Set(["completed"])],
  ["obligation-event", new Set(["complete", "canceled"])],
  ["action-item", new Set(["done", "canceled"])],
  ["exception", new Set(["approved", "revoked", "closed"])]
]);

const PROOF_FIELDS = [
  "completionResourceIds",
  "evidenceIds",
  "sampleEvidenceIds",
  "sourceEvidenceId",
  "sourceResourceIds",
  "exceptionId",
  "exceptionIds",
  "attestationIds"
];

export async function validateWorkflowHistoryIntegrity(loaded, diagnostics) {
  const historical = historicalState(loaded);
  if (!historical.available) {
    if (!loaded.resources.some(isFinalized)) return;
    diagnostics.push({
      severity: "error",
      code: "workflow-history-unavailable",
      path: "data/workspace.json",
      message: "Complete Git history is required to verify finalized workflow records. Restore Git history access, unshallow the repository if needed, and validate again."
    });
    return;
  }
  const { commits, historicalFinalized, revisionRecords, historiesById } = historical;
  const historyStart = commits[0];
  const workspaceHistoryCommits = (getFileHistory(loaded.root, "data/workspace.json", Number.MAX_SAFE_INTEGER) || [])
    .map(({ commit }) => commit)
    .filter((commit) => !historyStart || isDataHistoryAncestor(loaded, historyStart, commit));
  const chronologyCommits = [...new Set([...commits, ...workspaceHistoryCommits])];
  const invalidWorkspaceCommit = chronologyCommits.find((commit) => !historicalWorkspaceTimezoneAtRevision(loaded, commit));
  if (invalidWorkspaceCommit) {
    diagnostics.push({
      severity: "error",
      code: "invalid-historical-workspace-timezone",
      path: "data/workspace.json",
      message: `Workspace history at commit ${invalidWorkspaceCommit} does not contain a readable Workspace with a valid IANA timezone. Restore or correct the historical record before relying on dated workflow facts.`
    });
    return;
  }
  const firstFinalized = new Map();
  const currentById = new Map(loaded.resources.map((record) => [record.id, record]));
  for (const [id, historical] of historicalFinalized) {
    const current = currentById.get(id);
    if (!current || !isFinalized(current)) {
      diagnostics.push({
        severity: "error",
        code: current ? "reopened-finalized-record" : "deleted-finalized-record",
        path: historical.path,
        message: `Finalized ${historical.record.type} "${id}" was ${current ? "moved back to a non-final state" : "deleted"}. Restore its finalized state and use its correction or supersession workflow.`
      });
    }
  }
  for (const entry of loaded.entries) {
    if (!isFinalized(entry.record)) continue;
    const versions = finalizedVersions(commits, entry.record.id, revisionRecords, historiesById);
    const historical = versions[0];
    if (!historical) continue;
    firstFinalized.set(entry.record.id, historical);
    if (
      entry.record.type === "collection-review"
      && !validInitialCollectionReview(historical, loaded.workspace.timezone)
      && !legacyCollectionReview(loaded, historical)
    ) {
      diagnostics.push(integrityError(
        entry,
        `Collection Review "${entry.record.id}" must first be committed active with a knowledge cutoff on its recorded review date. Create a current review instead of initially retiring one or changing its review binding.`
      ));
      continue;
    }
    if (
      entry.record.type === "reconciliation-dismissal"
      && !validInitialReconciliationDismissal(
        historical,
        loaded,
        historiesById,
        workspaceTimezoneAtRevision(loaded, historical.commit)
      )
    ) {
      diagnostics.push(integrityError(
        entry,
        `Reconciliation dismissal "${entry.record.id}" must first be committed with exactly one active Person reviewer.`
      ));
      continue;
    }
    if (
      entry.record.type === "exception"
      && historical.record.reportingRouteSetId
      && historical.commit !== commits.find((commit) => {
        try { return Number(JSON.parse(getFileAtRevision(loaded.root, commit, "data/workspace.json"))?.dataModelVersion) >= 10; } catch (error) { rethrowGitDeadline(error); return false; }
      })
    ) {
      const records = recordsAtRevision(loaded, historical.commit);
      const historicalTimezone = workspaceTimezoneAtRevision(loaded, historical.commit);
      if (!reportingRouteFixedEvidence(
        records,
        historical.record.id,
        historical.record.evidenceIds,
        historical.record.approval?.approvedOn,
        historicalTimezone,
        { root: loaded.root, commit: historical.commit }
      ).length) {
        diagnostics.push(integrityError(
          entry,
          `Reporting-route Exception "${entry.record.id}" requires verified, fixed Evidence covering its approval event.`
        ));
      }
    }
    const chain = [...versions, { record: entry.record, commit: null }];
    if (chain.some((item, index) => index > 0
      && !permittedFinalizedTransition(chain[index - 1].record, item.record)
      && !legacyCollectionReviewTransition(loaded, chain[index - 1], item))) {
      diagnostics.push(integrityError(entry, `Finalized ${entry.record.type} "${entry.record.id}" differs from its first committed final state. Use its correction or supersession workflow.`));
      continue;
    }
    await compareMarkdownAtRevision(loaded, entry, historical, diagnostics);
  }

  const firstV10Commit = commits.find((commit) => {
    try { return Number(JSON.parse(getFileAtRevision(loaded.root, commit, "data/workspace.json"))?.dataModelVersion) >= 10; } catch (error) { rethrowGitDeadline(error); return false; }
  });
  const protectedRouteSources = new Map();
  for (const [commit, records] of revisionRecords) {
    for (const [id, historical] of records) {
      if (!protectedRouteRequirementSource(historical.record)) continue;
      const versions = protectedRouteSources.get(id) || [];
      versions.push({
        ...historical,
        commit,
        ...(historiesById.get(id) || []).find(({ commit: changedAt }) => changedAt === commit)
      });
      protectedRouteSources.set(id, versions);
    }
  }
  for (const [id, protectedVersions] of protectedRouteSources) {
    const entry = loaded.entries.find(({ record }) => record.id === id);
    if (!entry) {
      const historical = protectedVersions[0];
      diagnostics.push({
        severity: "error",
        code: "deleted-finalized-record",
        path: historical.path,
        message: `Protected ${historical.record.type} "${id}" was deleted after its structured Reporting Route requirements became effective. Restore it and use a preserved successor or retirement workflow.`
      });
      continue;
    }
    if (
      !routeRequirementSource(entry.record)
      || routeRequirementVersionsRewritten(
        changedVersions(id, commits, revisionRecords, historiesById),
        entry.record
      )
    ) {
      diagnostics.push(integrityError(
        entry,
        `${entry.record.type} "${entry.record.id}" changed structured Reporting Route requirements after approval without first returning the decision to draft or review. Preserve the approved revision, then use its review workflow or create a successor decision.`
      ));
    }
    const first = protectedVersions[0];
    if (first.commit !== firstV10Commit) {
      const historicalRecords = recordsAtRevision(loaded, first.commit);
      const historicalTimezone = workspaceTimezoneAtRevision(loaded, first.commit);
      for (const requirement of Array.isArray(first.record.reportingRouteRequirements) ? first.record.reportingRouteRequirements : []) {
        if (!requirement?.effectiveAt) continue;
        const support = reportingRouteFixedEvidence(
          historicalRecords,
          first.record.id,
          requirement.evidenceIds,
          requirement.effectiveAt,
          requirement.timezone || loaded.workspace.timezone,
          { root: loaded.root, commit: first.commit }
        );
        if (!support.length) {
          diagnostics.push(integrityError(
            entry,
            `${first.record.type} "${first.record.id}" requires verified, fixed Evidence covering its Reporting Route requirement decision.`
          ));
          continue;
        }
        for (const evidence of support) {
          const evidenceEntry = loaded.entries.find(({ record }) => record.id === evidence.id);
          const evidencePath = evidenceEntry ? `data/${evidenceEntry.relativePath}` : null;
          if (
            !evidenceEntry
            || getFileObjectIdAtRevision(loaded.root, first.commit, evidencePath) !== getWorkingFileObjectId(loaded.root, evidencePath)
          ) {
            diagnostics.push(integrityError(
              evidenceEntry || entry,
              `Evidence "${evidence.id}" supporting backfilled Reporting Route requirement source "${first.record.id}" must remain identical to its first relied-upon revision.`
            ));
            continue;
          }
          await compareMarkdownAtRevision(loaded, evidenceEntry, { record: evidenceEntry.record, commit: first.commit }, diagnostics, first.record.id);
          await compareEvidenceAttachmentsAtRevision(loaded, evidenceEntry, first.commit, diagnostics, first.record.id);
        }
      }
    }
    if (!sameJson(first.record.effectiveOn, entry.record.effectiveOn)) {
      diagnostics.push(integrityError(
        entry,
        `${entry.record.type} "${entry.record.id}" changed the effective date governing its structured Reporting Route requirements. Preserve the original interval and create a successor decision.`
      ));
    }
    const firstTerminal = protectedVersions.find(({ record }) => routeRequirementSourceIsTerminal(record));
    if (firstTerminal && !sameJson(
      pick(firstTerminal.record, ["status", "statusTransition"]),
      pick(entry.record, ["status", "statusTransition"])
    )) {
      diagnostics.push(integrityError(
        entry,
        `${entry.record.type} "${entry.record.id}" changed the terminal lifecycle interval governing its structured Reporting Route requirements. Preserve it and create a successor decision.`
      ));
    }
    if (
      !firstTerminal
      && routeRequirementSourceIsTerminal(entry.record)
      && entry.record.statusTransition?.changedOn
      && currentCalendarDate(loaded.workspace.timezone, new Date()) > entry.record.statusTransition.changedOn
    ) {
      diagnostics.push(integrityError(
        entry,
        `${entry.record.type} "${entry.record.id}" cannot introduce a backdated terminal transition for structured Reporting Route requirements. Use the current date and preserve the prior interval.`
      ));
    }
  }

  await validateReportingRouteAuthorityHistory(loaded, commits, revisionRecords, historiesById, diagnostics);

  const byId = new Map(loaded.resources.map((record) => [record.id, record]));
  const proofOwners = loaded.resources.filter((record) => (
    (record.type === "obligation-occurrence" && ["reconciled", "superseded"].includes(record.status))
    || (record.type === "audit-population" && ["reconciled", "not-applicable", "superseded"].includes(record.status))
    || (record.type === "attestation" && record.status === "completed")
    || (record.type === "exception" && ["approved", "revoked", "closed"].includes(record.status))
  ));
  const proofIdsByOwner = new Map(proofOwners.map((owner) => [owner.id, proofIds(owner, byId)]));
  const proofIdentityHistories = getRecordIdentityHistories(
    loaded.root,
    new Set([...proofIdsByOwner.values()].flatMap((ids) => [...ids]))
  );
  for (const owner of proofOwners) {
    const finalized = firstFinalized.get(owner.id);
    if (!finalized) continue;
    if (owner.type === "obligation-occurrence" && owner.collectionReviewCommit && (
      !isDataHistoryAncestor(loaded, owner.scopeRevision, owner.collectionReviewCommit)
      || !isDataHistoryAncestor(loaded, owner.collectionReviewCommit, finalized.commit)
    )) {
      const ownerEntry = loaded.entries.find(({ record }) => record.id === owner.id);
      diagnostics.push(integrityError(ownerEntry, `Occurrence "${owner.id}" must bind a Collection Review committed after its scope revision and before the occurrence was finalized.`));
    }
    const protectedIds = proofIdsByOwner.get(owner.id);
    for (const id of protectedIds) {
      const currentEntry = loaded.entries.find(({ record }) => record.id === id);
      const historical = recordAtRevision(loaded, finalized.commit, id, proofIdentityHistories.get(id) || []);
      if (!currentEntry || !historical) {
        const ownerEntry = loaded.entries.find(({ record }) => record.id === owner.id);
        diagnostics.push(integrityError(ownerEntry, `Proof record "${id}" must exist in the commit where ${owner.type} "${owner.id}" was first finalized.`));
        continue;
      }
      if (!sameJson(currentEntry.record, historical.record)) {
        diagnostics.push(integrityError(currentEntry, `Proof record "${id}" differs from the version used when ${owner.type} "${owner.id}" was first finalized. Create corrected proof and a superseding record.`));
        continue;
      }
      await compareMarkdownAtRevision(loaded, currentEntry, { ...historical, commit: finalized.commit }, diagnostics, owner.id);
      await compareEvidenceAttachmentsAtRevision(loaded, currentEntry, finalized.commit, diagnostics, owner.id);
    }
  }
}

function legacyCollectionReviewTransition(loaded, previous, current) {
  if (
    previous.record.type !== "collection-review"
    || current.record.type !== "collection-review"
    || previous.record.status !== "active"
    || current.record.status !== "active"
    || !current.commit
  ) return false;
  try {
    const workspace = JSON.parse(getFileAtRevision(loaded.root, current.commit, "data/workspace.json"));
    return Number(workspace?.dataModelVersion) < 9;
  } catch (error) {
    rethrowGitDeadline(error);
    return false;
  }
}

function historicalState(loaded) {
  const index = getDataRecordHistoryIndex(loaded.root);
  if (!index.available) return { available: false };
  const firstV9 = index.commits.findIndex((commit) => {
    try {
      const workspace = JSON.parse(getFileAtRevision(loaded.root, commit, "data/workspace.json"));
      return Number(workspace?.dataModelVersion) >= 9;
    } catch (error) {
      rethrowGitDeadline(error);
      return false;
    }
  });
  const commits = firstV9 >= 0 ? index.commits.slice(firstV9) : index.commits;
  const revisionRecords = new Map(index.recordsByCommit);
  const historicalFinalized = new Map();
  if (firstV9 >= 0) {
    const baselineCommit = index.commits[firstV9];
    const baseline = new Map(revisionRecords.get(baselineCommit) || []);
    for (const [id, identityHistory] of index.historiesById) {
      const item = recordAtRevision(loaded, baselineCommit, id, identityHistory);
      if (item) {
        const prior = firstV9 > 0
          ? recordAtRevision(loaded, index.commits[firstV9 - 1], id, identityHistory)
          : null;
        baseline.set(id, {
          ...item,
          ...(prior && isFinalized(prior.record) ? { legacyBaseline: true } : {})
        });
      }
    }
    revisionRecords.set(baselineCommit, baseline);
  }
  for (const commit of commits) {
    const records = recordMapAtRevision(loaded, commit, revisionRecords);
    for (const [id, item] of records) {
      if (isFinalized(item.record) && !historicalFinalized.has(id)) historicalFinalized.set(id, { ...item, commit });
    }
  }
  return { available: true, commits, revisionRecords, historicalFinalized, historiesById: index.historiesById };
}

function finalizedVersions(commits, id, cache, historiesById) {
  const history = historiesById.get(id) || [];
  return commits.flatMap((commit) => {
    const historical = recordMapAtRevision(null, commit, cache).get(id) || null;
    const summary = history.find((item) => item.commit === commit);
    return historical && isFinalized(historical.record) ? [{ ...historical, ...summary, commit }] : [];
  });
}

function validInitialCollectionReview(historical, timezone) {
  return historical.record.status === "active"
    && isRfc3339Timestamp(historical.record.knowledgeCutoffAt)
    && historical.record.reviewedOn === currentCalendarDate(
      timezone,
      new Date(historical.record.knowledgeCutoffAt)
    );
}

function validInitialReconciliationDismissal(historical, loaded, historiesById, timezone) {
  const reviewerIds = historical.record.reviewedByIds || [];
  if (reviewerIds.length !== 1) return false;
  const reviewer = recordAtRevision(
    loaded,
    historical.commit,
    reviewerIds[0],
    historiesById.get(reviewerIds[0]) || []
  )?.record;
  return reviewer?.type === "person"
    && reviewer.status === "active"
    && isRfc3339Timestamp(historical.timestamp)
    && historical.record.reviewedOn === currentCalendarDate(timezone, new Date(historical.timestamp));
}

function legacyCollectionReview(loaded, historical) {
  if (historical.legacyBaseline && historical.record.status === "active" && !historical.record.knowledgeCutoffAt) {
    return true;
  }
  let workspace;
  try {
    workspace = JSON.parse(getFileAtRevision(loaded.root, historical.commit, "data/workspace.json"));
  } catch (error) {
    rethrowGitDeadline(error);
    return false;
  }
  return Number(workspace?.dataModelVersion) < 9
    && historical.record.status === "active"
    && !historical.record.knowledgeCutoffAt;
}

function recordAtRevision(loaded, commit, id, identityHistory) {
  const item = identityHistory.find(({ commit: changedAt }) => isDataHistoryAncestor(loaded, changedAt, commit));
  if (!item) return null;
  const source = getFileAtRevision(loaded.root, commit, item.path);
  if (!source) return null;
  try {
    const record = JSON.parse(source);
    return record?.id === id ? { record, path: item.path } : null;
  } catch (error) {
    rethrowGitDeadline(error);
    return null;
  }
}

function recordMapAtRevision(_loaded, commit, cache) {
  return cache.get(commit) || new Map();
}

function isFinalized(record) {
  if (record?.type === "action-item" && !record.obligationId) return false;
  return FINAL_STATUSES.get(record?.type)?.has(record.status) || false;
}

function protectedRouteRequirementSource(record) {
  if (!routeRequirementSource(record)) return false;
  if (["policy", "document"].includes(record.type)) {
    return ["approved", "active", "superseded", "retired"].includes(record.status);
  }
  if (record.type === "commitment") return ["active", "superseded", "retired"].includes(record.status);
  return record.type === "risk" && record.status !== "draft";
}

function routeRequirementVersionsRewritten(versions, current) {
  const chain = [...versions, { record: current }];
  return chain.some(({ record }, index) => (
    index > 0
    && protectedRouteRequirementSource(chain[index - 1].record)
    && !sameJson(chain[index - 1].record.reportingRouteRequirements, record.reportingRouteRequirements)
  ));
}

function routeRequirementSource(record) {
  return ["policy", "document", "commitment", "risk"].includes(record?.type);
}

function routeRequirementSourceIsTerminal(record) {
  return ["superseded", "retired", "closed", "archived"].includes(record?.status);
}

async function validateReportingRouteAuthorityHistory(loaded, commits, revisionRecords, historiesById, diagnostics) {
  const routeSets = loaded.resources.filter(({ type, status }) => (
    type === "reporting-route-set" && ["approved", "canceled"].includes(status)
  ));
  if (!routeSets.length) return;
  const firstV10Commit = commits.find((commit) => {
    try { return Number(JSON.parse(getFileAtRevision(loaded.root, commit, "data/workspace.json"))?.dataModelVersion) >= 10; } catch (error) { rethrowGitDeadline(error); return false; }
  });
  for (const route of routeSets) {
    const versions = changedVersions(route.id, commits, revisionRecords, historiesById);
    for (const eventName of ["approval", "cancellation"]) {
      const eventVersion = versions.find(({ record }) => record[eventName]);
      if (!eventVersion) continue;
      for (const evidenceId of arrayValue(eventVersion.record[eventName]?.evidenceIds)) {
        const evidenceEntry = loaded.entries.find(({ record }) => record.id === evidenceId && record.type === "evidence");
        const currentEvidencePath = evidenceEntry ? `data/${evidenceEntry.relativePath}` : null;
        const historicalEvidencePath = currentEvidencePath
          ? getFilePathAtRevision(loaded.root, currentEvidencePath, eventVersion.commit)
          : null;
        const committedEvidenceObject = historicalEvidencePath
          ? getFileObjectIdAtRevision(loaded.root, eventVersion.commit, historicalEvidencePath)
          : null;
        const currentEvidenceObject = currentEvidencePath
          ? getWorkingFileObjectId(loaded.root, currentEvidencePath)
          : null;
        if (
          !evidenceEntry
          || committedEvidenceObject !== currentEvidenceObject
        ) {
          diagnostics.push(integrityError(
            evidenceEntry || loaded.entries.find(({ record }) => record.id === route.id),
            `Evidence "${evidenceId}" supporting Reporting Route ${eventName} for "${route.id}" must remain identical to the revision first committed with that event (${committedEvidenceObject || "missing"} != ${currentEvidenceObject || "missing"}).`
          ));
          continue;
        }
        await compareMarkdownAtRevision(loaded, evidenceEntry, { record: evidenceEntry.record, commit: eventVersion.commit }, diagnostics, route.id);
        await compareEvidenceAttachmentsAtRevision(loaded, evidenceEntry, eventVersion.commit, diagnostics, route.id);
      }
    }
  }
  const appointmentIds = new Set(routeSets.flatMap((route) => [
    route.approval?.approvalAppointmentId,
    route.cancellation?.authorityAppointmentId,
    ...loaded.resources.filter((candidate) => (
      candidate.type === "appointment"
      && ["active", "ended"].includes(candidate.status)
      && candidate.appointmentKind === route.authorityAppointmentKind
      && arrayValue(candidate.scopeResourceIds).some((id) => [route.id, route.programId, loaded.workspace.id].includes(id))
    )).map(({ id }) => id)
  ].filter(Boolean)));
  const historicalAppointments = [...revisionRecords].flatMap(([commit, records]) => (
    [...records.values()]
      .filter(({ record }) => record.type === "appointment")
      .map((item) => ({
        ...item,
        commit,
        ...(historiesById.get(item.record.id) || []).find(({ commit: changedAt }) => changedAt === commit)
      }))
  ));
  for (const route of routeSets) {
    for (const historicalAppointment of historicalAppointments) {
      const appointment = historicalAppointment.record;
      if (
        [route.approval?.approvalAppointmentId, route.cancellation?.authorityAppointmentId].includes(appointment.id)
        || (
          authorityAppointmentOverlapsRoute(
            appointment,
            route,
            loaded.workspace.id,
            workspaceTimezoneAtRevision(loaded, historicalAppointment.commit)
          )
        )
      ) appointmentIds.add(appointment.id);
    }
  }
  const holderAppointments = new Map();
  for (const { record } of historicalAppointments) {
    if (!appointmentIds.has(record.id) || !record.holderId) continue;
    const appointments = holderAppointments.get(record.holderId) || [];
    appointments.push(record);
    holderAppointments.set(record.holderId, appointments);
  }
  for (const id of appointmentIds) {
    const entry = loaded.entries.find(({ record }) => record.id === id);
    const versions = changedVersions(id, commits, revisionRecords, historiesById);
    if (!versions.length) continue;
    const first = versions[0];
    const current = entry?.record || versions.at(-1).record;
    const firstAuthoritative = versions.find(({ record }) => ["active", "ended"].includes(record.status));
    const startTimezone = workspaceTimezoneAtRevision(loaded, firstAuthoritative?.commit);
    const historicalStartSupport = historicalAuthoritySupport(
      loaded,
      versions,
      current.startsOn,
      commits,
      revisionRecords,
      historiesById
    );
    const firstRecordedEnd = versions.find(({ record }) => record.endsOn);
    const recordedEnd = firstRecordedEnd || (current.endsOn ? {
      record: current,
      commit: null,
      timestamp: new Date().toISOString()
    } : null);
    const endTimezone = workspaceTimezoneAtRevision(loaded, recordedEnd?.commit);
    const historicalEndSupport = historicalAuthoritySupport(
      loaded,
      versions,
      current.endsOn,
      commits,
      revisionRecords,
      historiesById
    );
    const frozenEvidence = new Map(
      [historicalStartSupport, historicalEndSupport]
        .filter(Boolean)
        .flatMap(({ evidenceVersions }) => evidenceVersions)
        .map((version) => [version.record.id, version])
    );
    for (const evidenceVersion of frozenEvidence.values()) {
      const evidenceEntry = loaded.entries.find(({ record }) => record.id === evidenceVersion.record.id);
      if (!evidenceEntry || !sameJson(evidenceEntry.record, evidenceVersion.record)) {
        diagnostics.push({
          severity: "error",
          code: evidenceEntry ? "rewritten-finalized-record" : "deleted-finalized-record",
          path: evidenceEntry ? `data/${evidenceEntry.relativePath}` : evidenceVersion.path,
          message: `Evidence "${evidenceVersion.record.id}" that established backfilled authority Appointment "${id}" must remain identical to its bound verified revision.`
        });
        continue;
      }
      await compareMarkdownAtRevision(loaded, evidenceEntry, evidenceVersion, diagnostics, id);
      await compareAuthorityEvidenceAttachmentsAtRevision(loaded, evidenceEntry, evidenceVersion.commit, diagnostics, id);
    }
    if (!entry) {
      diagnostics.push({
        severity: "error",
        code: "deleted-finalized-record",
        path: first.path,
        message: `Reporting-route authority Appointment "${id}" was deleted after it governed a finalized Route Set. Restore the historical Appointment.`
      });
      continue;
    }
    if (!firstAuthoritative) {
      diagnostics.push(integrityError(entry, `Reporting-route authority Appointment "${id}" must be committed active or ended before its interval can be relied on.`));
      continue;
    }
    for (const field of ["appointmentKind", "holderId", "scopeResourceIds", "startsOn"]) {
      if (!sameJson(firstAuthoritative.record[field], current[field])) {
        diagnostics.push(integrityError(entry, `Reporting-route authority Appointment "${id}" changed ${field} after it was recorded. Preserve the original Appointment and create a successor.`));
      }
    }
    if (firstAuthoritative.record.status === "ended" && current.status !== "ended") {
      diagnostics.push(integrityError(entry, `Ended reporting-route authority Appointment "${id}" cannot return to ${current.status}. Preserve its final lifecycle state.`));
    }
    if (firstRecordedEnd && current.endsOn !== firstRecordedEnd.record.endsOn) {
      diagnostics.push(integrityError(entry, `Reporting-route authority Appointment "${id}" changed its recorded end date. Preserve the original interval and create a correction record.`));
    }
    const firstEnded = versions.find(({ record }) => record.status === "ended");
    if (firstEnded && !sameJson(
      pick(firstEnded.record, ["status", "endsOn", "statusTransition"]),
      pick(current, ["status", "endsOn", "statusTransition"])
    )) {
      diagnostics.push(integrityError(entry, `Ended reporting-route authority Appointment "${id}" changed its final interval. Preserve it and create a correction record.`));
    }
    const startEvidence = supportingAuthorityEvidence(loaded.resources, startTimezone, current, current.startsOn, { root: loaded.root });
    const endEvidence = supportingAuthorityEvidence(loaded.resources, endTimezone, current, current.endsOn, { root: loaded.root });
    const missingFrozenEvidenceIds = [...frozenEvidence.keys()].filter((evidenceId) => !arrayValue(current.evidenceIds).includes(evidenceId));
    if (missingFrozenEvidenceIds.length) {
      diagnostics.push(integrityError(entry, `Reporting-route authority Appointment "${id}" removed bound backfill Evidence ${missingFrozenEvidenceIds.join(", ")}. Preserve the original proof links.`));
    }
    if (firstAuthoritative.commit !== firstV10Commit && !startEvidence.length) {
      diagnostics.push(integrityError(entry, `Reporting-route authority Appointment "${id}" requires verified, fixed Evidence covering the start of its authority interval.`));
    }
    if (recordedEnd && recordedEnd.commit !== firstV10Commit && !endEvidence.length) {
      diagnostics.push(integrityError(entry, `Reporting-route authority Appointment "${id}" requires verified, fixed Evidence covering the end of its authority interval.`));
    }
  }
  for (const [holderId, appointments] of holderAppointments) {
    const entry = loaded.entries.find(({ record }) => record.id === holderId && record.type === "person");
    const versions = changedVersions(holderId, commits, revisionRecords, historiesById);
    if (!versions.length) continue;
    const first = versions[0];
    if (!entry) {
      diagnostics.push({
        severity: "error",
        code: "deleted-finalized-record",
        path: first.path,
        message: `Reporting-route authority holder "${holderId}" was deleted after their Appointment governed a finalized Route Set. Restore the historical Person record.`
      });
      continue;
    }
    const current = entry.record;
    if (!sameJson(first.record.startDate, current.startDate)) {
      diagnostics.push(integrityError(entry, `Reporting-route authority holder "${holderId}" changed their recorded start date. Preserve the historical identity interval.`));
    }
    const firstRecordedEnd = versions.find(({ record }) => record.endDate);
    if (firstRecordedEnd && current.endDate !== firstRecordedEnd.record.endDate) {
      diagnostics.push(integrityError(entry, `Reporting-route authority holder "${holderId}" changed their recorded end date. Preserve the historical identity interval.`));
    }
    const firstInactive = versions.find(({ record }) => record.status === "inactive");
    if (firstInactive && !sameJson(
      pick(firstInactive.record, ["status", "endDate", "statusTransition"]),
      pick(current, ["status", "endDate", "statusTransition"])
    )) {
      diagnostics.push(integrityError(entry, `Inactive reporting-route authority holder "${holderId}" changed their final identity interval. Preserve the historical Person record.`));
    }
    const recordedEnd = firstRecordedEnd || (current.endDate ? {
      record: current,
      commit: null,
      timestamp: new Date().toISOString()
    } : null);
    const endTimezone = workspaceTimezoneAtRevision(loaded, recordedEnd?.commit);
    const hasMatchingEndEvidence = loaded.resources.some((appointment) => (
      appointment.type === "appointment"
      && appointmentIds.has(appointment.id)
      && appointment.holderId === holderId
      && ["active", "ended"].includes(appointment.status)
      && appointment.endsOn === current.endDate
      && supportingAuthorityEvidence(loaded.resources, endTimezone, appointment, current.endDate, { root: loaded.root }).length > 0
    ));
    if (recordedEnd && recordedEnd.commit !== firstV10Commit && !hasMatchingEndEvidence) {
      diagnostics.push(integrityError(entry, `Reporting-route authority holder "${holderId}" requires verified, fixed Evidence from the related Appointment covering the end of the identity interval.`));
    }
  }
}

function historicalAuthoritySupport(loaded, appointmentVersions, date, commits, revisionRecords, historiesById) {
  if (!date || !appointmentVersions.length) return null;
  const evidenceHistories = new Map();
  for (const appointment of appointmentVersions) {
    for (const id of arrayValue(appointment.record.evidenceIds)) {
      if (!evidenceHistories.has(id)) {
        evidenceHistories.set(id, changedVersions(id, commits, revisionRecords, historiesById));
      }
    }
  }
  for (const commit of commits) {
    const timezone = workspaceTimezoneAtRevision(loaded, commit);
    const appointment = [...appointmentVersions].reverse()
      .find((version) => isDataHistoryAncestor(loaded, version.commit, commit));
    if (!appointment) continue;
    const evidenceVersions = arrayValue(appointment.record.evidenceIds).flatMap((id) => {
      const version = [...(evidenceHistories.get(id) || [])].reverse()
        .find((candidate) => isDataHistoryAncestor(loaded, candidate.commit, commit));
      return version ? [version] : [];
    });
    const qualifyingIds = new Set(
      supportingAuthorityEvidence(
        evidenceVersions.map(({ record }) => record),
        timezone,
        appointment.record,
        date,
        {
          root: loaded.root,
          commit,
          personIds: [...new Set(evidenceVersions.flatMap(({ record }) => [
            ...arrayValue(record.collectorIds),
            ...arrayValue(record.verifierIds)
          ]))].filter((id) => (
            recordAtRevision(loaded, commit, id, historiesById.get(id) || [])?.record.type === "person"
          ))
        }
      ).map(({ id }) => id)
    );
    const qualifyingVersions = evidenceVersions.filter(({ record }) => qualifyingIds.has(record.id));
    if (qualifyingVersions.length) return { appointmentVersion: appointment, evidenceVersions: qualifyingVersions };
  }
  return null;
}

function authorityAppointmentOverlapsRoute(appointment, route, workspaceId, timezone) {
  if (
    appointment.appointmentKind !== route.authorityAppointmentKind
    || !["active", "ended"].includes(appointment.status)
    || !arrayValue(appointment.scopeResourceIds).some((id) => [route.id, route.programId, workspaceId].includes(id))
    || !appointment.startsOn
    || !route.approval?.effectiveAt
  ) return false;
  let routeStart;
  let routeEnd;
  try {
    routeStart = currentCalendarDate(timezone, new Date(route.approval.effectiveAt));
    routeEnd = route.cancellation?.canceledAt
      ? currentCalendarDate(timezone, new Date(route.cancellation.canceledAt))
      : null;
  } catch (error) {
    rethrowGitDeadline(error);
    return false;
  }
  return (!routeEnd || appointment.startsOn <= routeEnd)
    && (!appointment.endsOn || appointment.endsOn >= routeStart);
}

function supportingAuthorityEvidence(records, timezone, appointment, date, options = {}) {
  return reportingRouteFixedEvidence(records, appointment.id, appointment.evidenceIds, date, timezone, options);
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

async function compareAuthorityEvidenceAttachmentsAtRevision(loaded, entry, commit, diagnostics, appointmentId) {
  for (const path of arrayValue(entry.record.filePaths)) {
    const relativePath = `data/${path}`;
    const committed = getFileObjectIdAtRevision(loaded.root, commit, relativePath);
    const current = getWorkingFileObjectId(loaded.root, relativePath);
    if (committed && current && committed === current) continue;
    diagnostics.push({
      severity: "error",
      code: "rewritten-finalized-attachment",
      path: relativePath,
      message: `Evidence attachment supporting backfilled authority Appointment "${appointmentId}" differs from its first committed verified bytes.`
    });
  }
}

function changedVersions(id, commits, revisionRecords, historiesById) {
  const history = historiesById.get(id) || [];
  return commits.flatMap((commit) => {
    const item = revisionRecords.get(commit)?.get(id);
    if (!item) return [];
    const summary = history.find(({ commit: changedAt }) => changedAt === commit);
    return [{ ...item, ...summary, commit }];
  });
}

function workspaceTimezoneAtRevision(loaded, commit) {
  if (!commit) return loaded.workspace.timezone;
  const timezone = historicalWorkspaceTimezoneAtRevision(loaded, commit);
  if (!timezone) throw new Error(`Workspace timezone is unavailable at ${commit}.`);
  return timezone;
}

function historicalWorkspaceTimezoneAtRevision(loaded, commit) {
  try {
    const workspace = JSON.parse(getFileAtRevision(loaded.root, commit, "data/workspace.json"));
    if (typeof workspace?.timezone !== "string" || !workspace.timezone.trim()) return null;
    new Intl.DateTimeFormat("en", { timeZone: workspace.timezone }).format();
    return workspace.timezone;
  } catch (error) {
    rethrowGitDeadline(error);
    return null;
  }
}

function pick(record, fields) {
  return Object.fromEntries(fields.map((field) => [field, record?.[field]]));
}

function permittedFinalizedTransition(previous, current) {
  if (previous.type !== current.type || previous.id !== current.id) return false;
  let allowed = [];
  if (previous.type === "collection-review" && previous.status === "active" && current.status === "retired") allowed = ["status", "statusTransition"];
  if (previous.type === "obligation-rule" && previous.status === "active" && current.status === "retired") allowed = ["status", "retiredOn"];
  if (previous.type === "obligation-occurrence" && previous.status === "reconciled" && current.status === "superseded") allowed = ["status"];
  if (previous.type === "audit-population" && ["reconciled", "not-applicable"].includes(previous.status) && current.status === "superseded") allowed = ["status"];
  if (previous.type === "reporting-route" && previous.status === "active" && current.status === "retired") allowed = ["status", "endsAt"];
  if (previous.type === "reporting-route-set" && previous.status === "approved" && current.status === "canceled") allowed = ["status", "cancellation"];
  if (previous.type === "exception" && previous.status === "approved" && ["revoked", "closed"].includes(current.status)) allowed = ["status", "resolution"];
  if (previous.type === "exception" && previous.status === "revoked" && current.status === "closed") allowed = ["status"];
  if (
    previous.type === "action-item"
    && previous.status === "done"
    && current.status === "done"
    && (previous.evidenceIds || []).every((id) => (current.evidenceIds || []).includes(id))
  ) allowed = ["evidenceIds"];
  return [...new Set([...Object.keys(previous), ...Object.keys(current)])].every((key) => (
    allowed.includes(key) || sameJson(previous[key], current[key])
  ));
}

function sameJson(left, right) {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
}

function proofIds(occurrence, byId) {
  const pending = [
    ...(occurrence.evidenceIds || []),
    ...(occurrence.sourceEvidenceId ? [occurrence.sourceEvidenceId] : []),
    ...(occurrence.members || []).flatMap((member) => [
    ...(member.completionResourceIds || []),
    member.exceptionId
    ])
  ].filter(Boolean);
  const ids = new Set();
  while (pending.length) {
    const id = pending.pop();
    if (!id || ids.has(id)) continue;
    ids.add(id);
    const record = byId.get(id);
    if (!record) continue;
    for (const field of PROOF_FIELDS) {
      const value = record[field];
      pending.push(...(Array.isArray(value) ? value : value ? [value] : []));
    }
  }
  return ids;
}

async function compareMarkdownAtRevision(loaded, entry, historical, diagnostics, occurrenceId = null) {
  for (const markdown of markdownEntries(loaded.model, entry.record)) {
    const historicalPath = markdownEntries(loaded.model, historical.record)
      .find(({ slot }) => slot === markdown.slot)?.path;
    const committed = historicalPath
      ? getFileAtRevision(loaded.root, historical.commit, `data/${historicalPath}`)
      : null;
    let current = null;
    try {
      current = await readFile(resolveDataPath(loaded.root, markdown.path), "utf8");
    } catch {
      // Presence is part of the finalized record.
    }
    if (current !== committed) {
      const context = occurrenceId ? ` used by occurrence "${occurrenceId}"` : "";
      diagnostics.push({
        severity: "error",
        code: "rewritten-finalized-content",
        path: `data/${markdown.path}`,
        message: `Finalized Markdown${context} differs from its committed final version. Use the record's correction or supersession workflow.`
      });
    }
  }
}

async function compareEvidenceAttachmentsAtRevision(loaded, entry, commit, diagnostics, occurrenceId) {
  if (entry.record.type !== "evidence") return;
  for (const path of entry.record.filePaths || []) {
    const relativePath = `data/${path}`;
    const committed = getFileObjectIdAtRevision(loaded.root, commit, relativePath);
    const current = getWorkingFileObjectId(loaded.root, relativePath);
    if (!committed || !current || committed !== current) {
      diagnostics.push({
        severity: "error",
        code: "rewritten-finalized-attachment",
        path: `data/${path}`,
        message: `Evidence attachment used by occurrence "${occurrenceId}" differs from the bytes committed when the occurrence was first finalized.`
      });
    }
  }
}

function integrityError(entry, message) {
  return {
    severity: "error",
    code: "rewritten-finalized-record",
    path: `data/${entry.relativePath}`,
    message
  };
}

function rethrowGitDeadline(error) {
  if (error?.code === "FILEGRC_GIT_DEADLINE") throw error;
}
