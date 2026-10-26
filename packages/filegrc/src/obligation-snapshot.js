import { calculationMemo } from "./calculation-cache.js";
import { committedOccurrencePopulation } from "./obligation-population.js";
import { isDeepStrictEqual } from "node:util";
import { currentCalendarDate } from "./time.js";
import { recordsAtRevision } from "./reporting-route-integrity.js";
import { selectScopedCollectionRecords } from "./collection-scope.js";
import {
  getGitSummary,
  isDataHistoryAncestor,
  getDataRecordHistoryIndex,
} from "./git.js";

const snapshotRecords = (loaded, revision) =>
  calculationMemo(
    loaded.resources,
    "obligation-snapshot-source",
    [loaded.root, revision],
    () => recordsAtRevision(loaded, revision),
  );

const idsEqual = (a, b) =>
  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const unchanged = (a, b, ignored = []) =>
  isDeepStrictEqual(
    Object.fromEntries(
      Object.entries(a || {}).filter(([k]) => !ignored.includes(k)),
    ),
    Object.fromEntries(
      Object.entries(b || {}).filter(([k]) => !ignored.includes(k)),
    ),
  );

export function recordedCorrectionPopulation(loaded, occurrence, rule) {
  if (
    !loaded.root ||
    !occurrence?.populationSourceRevision ||
    !occurrence.supersedesId ||
    rule?.cutoverDecision !== "correct-open-window"
  )
    return null;
  const head = getGitSummary(loaded.root).commit;
  if (
    !head ||
    !isDataHistoryAncestor(loaded, occurrence.populationSourceRevision, head)
  )
    return null;
  const resources = snapshotRecords(
    loaded,
    occurrence.populationSourceRevision,
  );
  let sourceId = occurrence.supersedesId;
  const seen = new Set([occurrence.id]);
  let prior = resources.find(({ id }) => id === sourceId);
  while (!prior && !seen.has(sourceId)) {
    seen.add(sourceId);
    const predecessor = loaded.resources.find(({ id }) => id === sourceId);
    if (
      !predecessor ||
      predecessor.ruleId !== occurrence.ruleId ||
      predecessor.programId !== occurrence.programId ||
      predecessor.obligationId !== occurrence.obligationId ||
      predecessor.occurrenceKey !== occurrence.occurrenceKey ||
      !unchanged(predecessor.coverage, occurrence.coverage) ||
      predecessor.membershipCutoffAt !== occurrence.membershipCutoffAt ||
      predecessor.populationSourceRevision !==
        occurrence.populationSourceRevision
    )
      return null;
    sourceId = predecessor.supersedesId;
    prior = resources.find(({ id }) => id === sourceId);
  }
  const current = loaded.resources.find(({ id }) => id === sourceId);
  const priorRule = resources.find(({ id }) => id === prior?.ruleId);
  if (
    prior?.type !== "obligation-occurrence" ||
    prior.status !== "open" ||
    !current ||
    !unchanged(prior, current, ["status"]) ||
    prior.programId !== occurrence.programId ||
    prior.obligationId !== occurrence.obligationId ||
    prior.occurrenceKey !== occurrence.occurrenceKey ||
    !unchanged(prior.coverage, occurrence.coverage) ||
    rule.supersedesId !== prior.ruleId ||
    priorRule?.completionCoverage === "whole-period" ||
    rule.completionCoverage !== "point-in-time" ||
    rule.selector?.cutoff !== "review-date" ||
    !unchanged(priorRule?.recurrence, rule.recurrence) ||
    !unchanged(priorRule?.window, rule.window) ||
    !unchanged(priorRule?.selector, rule.selector, ["cutoff"])
  )
    return null;
  const eligibleHistory = committedOccurrencePopulation(
    { ...loaded, resources },
    prior,
    priorRule.selector,
    occurrence.populationSourceRevision,
  );
  if (
    !eligibleHistory.established ||
    prior.members.some((m) => !eligibleHistory.memberIds.includes(m.resourceId))
  )
    return null;
  const program = resources.find(({ id }) => id === prior.programId);
  const selected = selectScopedCollectionRecords(
    { ...loaded, resources },
    rule.selector,
    program,
  ).map(({ id }) => id);
  // Keep every old row, including retired members and N/A decisions. Include
  // known eligible additions, which need their own proof or reviewed disposition.
  return {
    source: prior,
    resources,
    memberIds: [
      ...new Set([...prior.members.map((m) => m.resourceId), ...selected]),
    ].sort(),
  };
}

export function currentSnapshotPopulation(loaded, occurrence, rule) {
  if (
    !loaded.root ||
    !occurrence?.scopeRevision ||
    occurrence.populationSourceRevision ||
    rule?.selector?.cutoff !== "review-date"
  )
    return null;
  const head = getGitSummary(loaded.root).commit;
  if (!head || !isDataHistoryAncestor(loaded, occurrence.scopeRevision, head))
    return null;
  let basis = occurrence;
  const seen = new Set();
  while (basis.supersedesId && !seen.has(basis.id)) {
    seen.add(basis.id);
    const previous = loaded.resources.find((r) => r.id === basis.supersedesId);
    if (
      !previous ||
      previous.ruleId !== occurrence.ruleId ||
      previous.occurrenceKey !== occurrence.occurrenceKey ||
      previous.scopeRevision !== occurrence.scopeRevision ||
      previous.membershipCutoffAt !== occurrence.membershipCutoffAt ||
      !unchanged(previous.coverage, occurrence.coverage)
    )
      return null;
    basis = previous;
  }
  const first = getDataRecordHistoryIndex(loaded.root)
    .historiesById.get(basis.id)
    ?.at(-1);
  if (!first) {
    if (
      occurrence.scopeRevision !== head ||
      (occurrence.membershipCutoffAt &&
        occurrence.membershipCutoffAt !==
          currentCalendarDate(
            loaded.resources.find((r) => r.type === "workspace")?.timezone ||
              "UTC",
          ))
    )
      return null;
  } else {
    const zone =
      loaded.resources.find((r) => r.type === "workspace")?.timezone || "UTC";
    if (
      !first.timestamp ||
      currentCalendarDate(zone, new Date(first.timestamp)) !==
        occurrence.membershipCutoffAt
    )
      return null;
    const initial = snapshotRecords(loaded, first.commit).find(
      (r) => r.id === basis.id,
    );
    if (
      !initial ||
      initial.scopeRevision !== occurrence.scopeRevision ||
      initial.ruleId !== occurrence.ruleId ||
      initial.membershipCutoffAt !== occurrence.membershipCutoffAt ||
      initial.occurrenceKey !== occurrence.occurrenceKey ||
      !unchanged(initial.coverage, occurrence.coverage)
    )
      return null;
  }
  const resources = snapshotRecords(loaded, occurrence.scopeRevision);
  const program = resources.find(({ id }) => id === occurrence.programId);
  if (!program) return null;
  return selectScopedCollectionRecords(
    { ...loaded, resources },
    rule.selector,
    program,
  )
    .map(({ id }) => id)
    .sort();
}

export function samePopulation(left, right) {
  return idsEqual(left, right);
}
