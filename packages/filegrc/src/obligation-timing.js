import {
  addCalendarDays,
  calendarOccurrence,
  calendarOccurrenceIndex,
  parseCalendarDate,
} from "./recurrence.js";

export function populationCutoffDate(selector, window, occurrence = null) {
  if (selector?.cutoff === "review-date")
    return occurrence?.membershipCutoffAt || window.populationAsOf || null;
  if (selector?.cutoff === "coverage-end")
    return (
      (occurrence?.requiredCoverage || window.requiredCoverage)?.endsOn || null
    );
  return selector?.cutoff === "window-end"
    ? window.dueWindowEnd
    : window.dueWindowStart;
}

export function populationIsFinal(selector, window, asOf, occurrence = null) {
  if (!selector) return true;
  const cutoff = populationCutoffDate(selector, window, occurrence);
  if (!parseCalendarDate(cutoff)) return false;
  // A review-date is a reviewed snapshot, not a claim about the remainder
  // of that calendar day. Fixed window/period ends remain inclusive.
  return selector.cutoff === "review-date" ? asOf >= cutoff : asOf > cutoff;
}

export function wholePeriodCoverage(rule, recurrence, window, index = null) {
  if (rule?.completionCoverage !== "whole-period") return null;
  const cycle =
    index ??
    calendarOccurrenceIndex(
      recurrence,
      addCalendarDays(window.dueWindowStart, -(rule.window?.startsAfter || 0)),
    );
  const start = calendarOccurrence(recurrence, cycle),
    next = calendarOccurrence(recurrence, cycle + 1);
  return start && next
    ? { kind: "range", startsOn: start, endsOn: addCalendarDays(next, -1) }
    : null;
}

export function completionCoversRequiredPeriod(
  record,
  required,
  executionDate,
  asOf,
) {
  if (!required) return true;
  const coverage = record.coverage;
  return (
    coverage?.kind === "range" &&
    coverage.startsOn <= required.startsOn &&
    coverage.endsOn >= required.endsOn &&
    executionDate > required.endsOn &&
    (!asOf || required.endsOn < asOf)
  );
}

export function requiredPeriodIsFinal(window, asOf) {
  return !window.requiredCoverage || asOf > window.requiredCoverage.endsOn;
}
