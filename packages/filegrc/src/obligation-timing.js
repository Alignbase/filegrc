import {
  addCalendarDays,
  calendarDayDifference,
  validCalendarRecurrence,
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

// Whole-period proof is executed after the inclusive final day. A deadline
// inside that period cannot be repaired by recording N/A or waiting longer.
export function wholePeriodOccurrenceWindowIssue(window) {
  return window.requiredCoverage && window.dueWindowEnd <= window.requiredCoverage.endsOn
    ? "The allowed execution deadline must fall after the full inclusive required period. Review the schedule through a successor; retain the original deadline and proof."
    : null;
}

export function wholePeriodRuleWindowIssue(rule, recurrence = rule.recurrence) {
  if (rule.completionCoverage !== "whole-period") return null;
  if (!validCalendarRecurrence(recurrence)) return "A whole-period duty requires a supported calendar recurrence.";
  const dueAfter = rule.window?.precision === "date" ? rule.window.dueAfter : null;
  if (!Number.isSafeInteger(dueAfter)) return "A whole-period duty needs an explicit execution window extending after its inclusive period end.";
  const step = recurrence.interval * (recurrence.unit === "year" ? 12 : 1);
  if (!Number.isSafeInteger(step)) return "The whole-period recurrence exceeds the supported calendar range.";
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  // Gregorian month/year lengths repeat every 400 years. Check the reachable
  // phases, rather than accepting a deadline that works only in the first year.
  const cycles = ["month", "year"].includes(recurrence.unit) ? 4800 / gcd(step, 4800) : 1;
  for (let index = 0; index < cycles; index += 1) {
    const start = calendarOccurrence(recurrence, index), next = calendarOccurrence(recurrence, index + 1);
    if (!start || !next) return index === 0 ? "The whole-period recurrence exceeds the supported calendar range." : null;
    if (rule.endsOn && start > rule.endsOn) break;
    if (dueAfter < calendarDayDifference(start, next)) return "A whole-period duty's execution deadline must follow every inclusive required period, including longer calendar cycles. Review a successor with adequate post-period execution time.";
  }
  return null;
}
