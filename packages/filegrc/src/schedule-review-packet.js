import { calculationMemo } from "./calculation-cache.js";
import { collectionRevision, collectionRevisionMatches } from "./collection-revision.js";
import { reviewHistoricalWorkspace, reviewHistoryContext } from "./historical-workspace.js";
import { scheduleSetRecords, scheduleSetIssues, scheduleReviewerConflicts } from "./schedule-set.js";
import { resolveProgram } from "./program.js";
import { resourceIndex } from "./resource-index.js";
import { personWasActiveOn } from "./soc2.js";
import { currentCalendarDate } from "./time.js";
import { calendarOccurrenceIndex, validCalendarRecurrence } from "./recurrence.js";
import { calendarWindow, obligationScheduleRecurrence } from "./obligations.js";
import { revisionsMatch } from "./revisions.js";

// This packet is derived review context, never a stored decision or approval.
export function scheduleReviewPacket(loaded, program, review, reviewRevision, asOf = currentCalendarDate(loaded.workspace?.timezone)) {
  return calculationMemo(loaded, "schedule-review-packet", [program.id, review, reviewRevision, asOf], () => {
    let before = null, priorProgram = null;
    if (loaded.root && /^[a-f0-9]{40,64}$/i.test(review?.scopeRevision || "")) {
      before = reviewHistoricalWorkspace(reviewHistoryContext(loaded.root, loaded), review.scopeRevision);
      try { if (before) priorProgram = resolveProgram(before, program.id); } catch { before = null; }
    }
    const conflicts = before && priorProgram ? scheduleReviewerConflicts(before, priorProgram) : [];
    const priorPopulation = before && priorProgram ? scheduleSetRecords(before, priorProgram).map(({ id }) => id).sort() : [];
    const trusted = Boolean(before && priorProgram && review?.status === "active" && review.decision === "complete"
      && review.reviewedByIds?.length && review.reviewedByIds.every((id) => !conflicts.includes(id)
        && personWasActiveOn(before.resources.find((record) => record.id === id), review.reviewedOn))
      && JSON.stringify(priorPopulation) === JSON.stringify([...(review.populationResourceIds || [])].sort())
      && !scheduleSetIssues(before, priorProgram, review).length
      && collectionRevisionMatches(before, "obligation", review.collectionRevision, { programId: program.id, historicalCommit: review.scopeRevision }));
    const byId = resourceIndex(loaded.resources).byId;
    const priorById = trusted ? resourceIndex(before.resources).byId : new Map();
    const rows = scheduleSetRecords(loaded, program).map((record) => {
      const prior = priorById.get(record.id);
      const decision = trusted ? review.scheduleDecisions?.find(({ obligationId }) => obligationId === record.id) : null;
      const unchanged = Boolean(prior && decision && revisionsMatch("collection",
        collectionRevision(loaded, "obligation", { programId: program.id, obligationIds: [record.id] }),
        collectionRevision(before, "obligation", { programId: program.id, obligationIds: [record.id], historicalCommit: review.scopeRevision })));
      return { obligationId: record.id, title: record.title, state: unchanged ? "unchanged" : prior ? "changed" : trusted ? "added" : "review-required",
        current: scheduleFacts(record, byId, loaded, asOf, unchanged),
        ...(prior && !unchanged ? { previous: scheduleFacts(prior, priorById, before, asOf) } : {}),
        ...(decision ? { priorDecision: { disposition: decision.disposition, ...(!unchanged && decision.ruleId ? { ruleId: decision.ruleId } : {}),
          ...(decision.replacementObligationIds?.length ? { replacementObligationIds: decision.replacementObligationIds } : {}),
          ...(decision.excludedRuleIds?.length ? { excludedRuleIds: decision.excludedRuleIds } : {}),
          ...(!unchanged ? { readCommand: `npx filegrc get ${review.id} --json` } : {}) } } : {}) };
    });
    return { asOf, historyAvailable: trusted, timingBasis: "Configured rule windows at the stated as-of date. Work Queue eligibility and frozen occurrences remain authoritative for actual completion.",
      ...(trusted ? { priorReview: { id: review.id, reviewedOn: review.reviewedOn, reviewedByIds: review.reviewedByIds,
        scopeRevision: review.scopeRevision, readCommand: `npx filegrc get ${review.id} --json` } } : {}),
      expectedPriorReviewRevision: reviewRevision || null,
      counts: { total: rows.length, unchanged: rows.filter(({ state }) => state === "unchanged").length, requiringDecision: rows.filter(({ state }) => state !== "unchanged").length },
      instructions: "Review changed rules, governing sources and timing effects. Supply fresh decisions for rows requiring a decision. To explicitly reaffirm every unchanged disposition, set confirmUnchangedSchedules to true and retain expectedPriorReviewRevision. Write a fresh overall conclusion and name the actual reviewer and review date. Prior narratives are historical context, not today's statements.", rows };
  });
}

export function expandedScheduleDecisions(loaded, program, assessment, options) {
  const submitted = options.scheduleDecisions;
  if (options.confirmUnchangedSchedules !== true) return submitted;
  const packet = assessment.scheduleReview;
  if (!packet?.historyAvailable || !packet.expectedPriorReviewRevision
    || !revisionsMatch("content", options.expectedPriorReviewRevision, packet.expectedPriorReviewRevision)) {
    throw new Error("The prior schedule review changed or its reviewed snapshot is unavailable. Scaffold and review the current schedule set again.");
  }
  if (!Array.isArray(submitted)) return submitted;
  const decisions = submitted.map((decision) => ({ ...decision }));
  for (const row of packet.rows.filter(({ state }) => state === "unchanged")) {
    const position = decisions.findIndex(({ obligationId }) => obligationId === row.obligationId);
    if (position >= 0 && decisions[position].disposition) continue;
    const prior = assessment.review.scheduleDecisions.find(({ obligationId }) => obligationId === row.obligationId);
    const reaffirmed = { ...prior, rationale: `Explicitly reaffirmed the unchanged disposition from ${assessment.review.id} during this review of the current schedule set.` };
    if (position >= 0) decisions[position] = reaffirmed;
    else decisions.push(reaffirmed);
  }
  return decisions;
}

function scheduleFacts(record, byId, loaded, asOf, compact = false) {
  const rule = byId.get(record.activeRuleId);
  const timezone = rule?.timezone || loaded.workspace?.timezone || "UTC";
  const { recurrence, activationDate } = obligationScheduleRecurrence(record, rule, byId, loaded.model, timezone, new Set(), asOf);
  let nextWindow = null;
  if (validCalendarRecurrence(recurrence)) {
    let index = Math.max(0, calendarOccurrenceIndex(recurrence, asOf));
    nextWindow = calendarWindow(recurrence, rule?.window || record.window, index);
    if (nextWindow?.dueWindowEnd < asOf) nextWindow = calendarWindow(recurrence, rule?.window || record.window, ++index);
    const effectiveOn = activationDate;
    if (nextWindow && effectiveOn && effectiveOn > nextWindow.dueWindowStart && effectiveOn <= nextWindow.dueWindowEnd) {
      nextWindow = { ...nextWindow, dueWindowStart: effectiveOn };
    }
  }
  if (compact) return { status: record.status, ...(rule ? { ruleId: rule.id } : {}), readCommand: `npx filegrc get ${record.id} --json` };
  return { status: record.status, timezone, activityType: record.activityType, ownerIds: record.ownerIds || [],
    scopeResourceIds: rule?.scopeResourceIds || record.scopeResourceIds || [],
    ...(rule ? { ruleId: rule.id, ruleStatus: rule.status, effectiveAt: rule.effectiveAt || null } : {}),
    recurrence, window: rule?.window || record.window || null, ...(nextWindow ? { nextWindow } : {}),
    selector: rule?.selector || record.selector || null,
    sourceResourceIds: [...new Set([...(record.policyIds || []), ...(record.controlIds || []), ...(rule?.sourceResourceIds || [])])],
    ...(record.customActivity ? { customActivity: record.customActivity } : {}),
    ...(rule ? { ruleConfiguration: Object.fromEntries(Object.entries(rule).filter(([field]) => !["id", "type", "title", "status", "obligationId", "rationale", "tags", "approvedOn", "approvedByIds", "effectiveAt", "timezone", "recurrence", "window", "selector", "sourceResourceIds"].includes(field))), rationale: rule.rationale, ruleReadCommand: `npx filegrc get ${rule.id} --json` } : {}),
    otherRules: loaded.resources.filter((item) => item.type === "obligation-rule" && item.obligationId === record.id && item.id !== rule?.id && ["proposed", "approved", "withdrawn"].includes(item.status))
      .map((item) => ({ id: item.id, status: item.status, supersedesId: item.supersedesId || null, recurrence: item.recurrence, window: item.window, selector: item.selector, rationale: item.rationale, ...(item.withdrawalReason ? { withdrawalReason: item.withdrawalReason, withdrawnOn: item.withdrawnOn } : {}) })) };
}
