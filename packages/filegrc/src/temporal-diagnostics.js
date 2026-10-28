import { addCalendarDays } from "./recurrence.js";
import { timestampFromLocalDateTime } from "./time.js";

// Coverage selection is explicit: an examination's agreed period wins over a
// candidate period. Ambiguous or invalid selections never borrow another scope.
export function resolveAssessmentCoverage(loaded, options = {}) {
  const resources = loaded.resources || [];
  const programs = resources.filter(record => record.type === "program" && record.status !== "retired");
  const audit = options.auditId ? resources.find(record => record.type === "audit" && record.id === options.auditId) : null;
  if (options.auditId && !audit) return null;
  if (options.programId && audit?.programId && options.programId !== audit.programId) return null;
  const requestedProgramId = options.programId || audit?.programId;
  const program = requestedProgramId ? programs.find(record => record.id === requestedProgramId)
    : programs.length === 1 ? programs[0] : null;
  if (!program) return null;
  // A selected audit must belong to the selected Program.
  if (audit && audit.programId !== program.id) return null;
  const coverage = audit ? audit.coverage : options.coverage ?? program.candidateCoverage;
  if (!coverage || typeof coverage !== "object") return null;
  const kind = coverage.kind || (!audit && options.coverage && coverage.start && coverage.end ? "range" : undefined);
  const start = kind === "as-of" ? coverage.on : coverage.start || coverage.startsOn;
  const end = kind === "as-of" ? coverage.on : coverage.end || coverage.endsOn;
  if (!["range", "as-of"].includes(kind) || !validDate(start) || !validDate(end) || start > end) return null;
  try {
    timestampFromLocalDateTime(`${start}T00:00:00`, loaded.workspace?.timezone || "UTC");
    timestampFromLocalDateTime(`${end}T00:00:00`, loaded.workspace?.timezone || "UTC");
  } catch { return null; }
  return { start, end, kind, basis: audit ? "audit" : options.coverage != null ? "explicit" : "candidate",
    programId: program.id, auditId: audit?.id || null };
}

// Domains opt in only after proving a bounded, resolved evidence limitation.
// This does not reinterpret structural errors or proof of operating failures.
export function classifyTemporalDiagnostic(diagnostic, loaded, options = {}) {
  const base = restoreTemporalDiagnostic(diagnostic);
  const temporal = base.temporal;
  if (base.severity !== "warning" || !temporal?.programId || temporal.resolved !== true || temporal.evidenceLimitation !== true) return base;
  if (options.programId && options.programId !== temporal.programId) return base;
  const coverage = resolveAssessmentCoverage(loaded, { ...options, programId: temporal.programId });
  if (!coverage) return base;
  const startsAt = instant(temporal.startsAt), endsAt = instant(temporal.endsAt);
  if (startsAt === null || endsAt === null || startsAt >= endsAt) return base;
  const coverageStartsAt = Date.parse(timestampFromLocalDateTime(`${coverage.start}T00:00:00`, loaded.workspace?.timezone || "UTC"));
  const coverageEndsAt = Date.parse(timestampFromLocalDateTime(`${addCalendarDays(coverage.end, 1)}T00:00:00`, loaded.workspace?.timezone || "UTC"));
  const relation = endsAt <= coverageStartsAt ? "before" : startsAt >= coverageEndsAt ? "after" : null;
  if (!relation) return base;
  const context = relation === "before"
    ? `Retained historical context: this resolved authorization or evidence limitation ended by the start of selected coverage on ${coverage.start}.`
    : `Retained subsequent context: this resolved authorization or evidence limitation began after selected coverage ended on ${coverage.end}.`;
  return { ...base, severity: "info", assessmentCoverage: coverage,
    temporal: { ...temporal, relation, originalSeverity: base.severity, originalMessage: base.message },
    message: `${base.message} ${context} It does not establish an operating violation or require current follow-up.` };
}

// Cached validation can be reused in another view only after restoring each
// temporal warning and assessing it against that view's selected coverage.
export function reclassifyTemporalValidation(validation, loaded, options = {}) {
  const diagnostics = (validation.diagnostics || []).map(diagnostic => classifyTemporalDiagnostic(diagnostic, loaded, options));
  const errors = diagnostics.filter(({ severity }) => severity === "error").length;
  const counts = { ...validation.counts, errors,
    warnings: diagnostics.filter(({ severity }) => severity === "warning").length,
    information: diagnostics.filter(({ severity }) => severity === "info").length };
  const descriptors = Object.getOwnPropertyDescriptors(validation);
  for (const [key, value] of Object.entries({ diagnostics, counts, ok: validation.ok !== false && errors === 0 })) {
    descriptors[key] = { value, enumerable: true, configurable: true, writable: true };
  }
  return Object.defineProperties(Object.create(Object.getPrototypeOf(validation)), descriptors);
}

function restoreTemporalDiagnostic(diagnostic) {
  const temporal = diagnostic.temporal;
  if (diagnostic.severity !== "info" || !temporal || temporal.originalSeverity !== "warning" || typeof temporal.originalMessage !== "string") return diagnostic;
  const { assessmentCoverage, ...base } = diagnostic;
  const { relation, ...originalTemporal } = temporal;
  return { ...base, temporal: originalTemporal, severity: temporal.originalSeverity, message: temporal.originalMessage };
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function instant(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)
    || !validDate(value.slice(0, 10))) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
