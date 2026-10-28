import assert from "node:assert/strict";
import test from "node:test";
import { classifyTemporalDiagnostic, resolveAssessmentCoverage, reclassifyTemporalValidation } from "../src/temporal-diagnostics.js";

function fixture() {
  return { workspace: { timezone: "America/Chicago" }, resources: [
    { type: "program", id: "a", candidateCoverage: { kind: "range", startsOn: "2026-10-01", endsOn: "2026-12-31" } },
    { type: "program", id: "b", candidateCoverage: { kind: "range", startsOn: "2026-08-01", endsOn: "2026-12-31" } },
    { type: "audit", id: "audit-a", programId: "a", coverage: { kind: "range", startsOn: "2026-08-01", endsOn: "2026-09-30" } },
    { type: "audit", id: "type-one", programId: "a", coverage: { kind: "as-of", on: "2026-10-01" } }
  ] };
}
function diagnostic(overrides = {}) {
  return { code: "approval-evidence-unproven", severity: "warning", message: "Earlier authorization is unproven.",
    temporal: { programId: "a", startsAt: "2026-08-01T00:00:00-05:00", endsAt: "2026-09-01T00:00:00-05:00", resolved: true, evidenceLimitation: true, ...overrides } };
}

test("resolved preperiod evidence limitations are retained as information", () => {
  const source = diagnostic(), result = classifyTemporalDiagnostic(source, fixture());
  assert.equal(result.severity, "info");
  assert.equal(result.assessmentCoverage.programId, "a");
  assert.equal(result.assessmentCoverage.basis, "candidate");
  assert.match(result.message, /Retained historical context/);
  assert.match(result.message, /does not establish an operating violation/);
  assert.equal(source.severity, "warning");
});

test("overlapping, unresolved, and non-opted-in errors remain actionable", () => {
  for (const source of [diagnostic({ endsAt: "2026-10-02T00:00:00-05:00" }), diagnostic({ resolved: false }),
    diagnostic({ evidenceLimitation: false }), { ...diagnostic(), severity: "error" }, { code: "structural-error", severity: "error" }]) {
    assert.equal(classifyTemporalDiagnostic(source, fixture()), source);
  }
});

test("exclusive interval end at local coverage midnight is historical", () => {
  assert.equal(classifyTemporalDiagnostic(diagnostic({ endsAt: "2026-10-01T05:00:00Z" }), fixture()).severity, "info");
  const overlap = diagnostic({ endsAt: "2026-10-01T05:00:00.001Z" });
  assert.equal(classifyTemporalDiagnostic(overlap, fixture()), overlap);
});

test("selected audit coverage wins over explicit and candidate coverage", () => {
  const source = diagnostic(), loaded = fixture();
  const options = { auditId: "audit-a", coverage: { kind: "as-of", on: "2026-12-31" } };
  assert.equal(classifyTemporalDiagnostic(source, loaded, options), source);
  assert.deepEqual(resolveAssessmentCoverage(loaded, options), { start: "2026-08-01", end: "2026-09-30", kind: "range", basis: "audit", programId: "a", auditId: "audit-a" });
  assert.equal(classifyTemporalDiagnostic(source, loaded, { auditId: "type-one" }).severity, "info");
  assert.equal(resolveAssessmentCoverage(loaded, { auditId: "type-one" }).end, "2026-10-01");
});

test("Programs stay isolated and invalid selections never fall back", () => {
  const loaded = fixture();
  assert.equal(resolveAssessmentCoverage(loaded), null);
  assert.equal(resolveAssessmentCoverage(loaded, { programId: "missing" }), null);
  assert.equal(resolveAssessmentCoverage(loaded, { auditId: "missing" }), null);
  assert.equal(resolveAssessmentCoverage(loaded, { programId: "b", auditId: "audit-a" }), null);
  assert.equal(resolveAssessmentCoverage(loaded, { programId: "b" }).start, "2026-08-01");
  const source = diagnostic();
  assert.equal(classifyTemporalDiagnostic(source, loaded, { programId: "b" }), source);
  assert.equal(classifyTemporalDiagnostic(diagnostic({ programId: "b" }), loaded).severity, "warning");
});

test("invalid coverage, timezone, and temporal bounds cannot suppress diagnostics", () => {
  for (const coverage of [null, {}, { kind: "range", startsOn: "2026-02-30", endsOn: "2026-12-31" },
    { kind: "range", startsOn: "2026-12-31", endsOn: "2026-01-01" }, { kind: "as-of", on: "invalid" }]) {
    const loaded = fixture(); loaded.resources[2].coverage = coverage;
    assert.equal(resolveAssessmentCoverage(loaded, { auditId: "audit-a" }), null);
  }
  for (const endsAt of [null, "invalid", "2026-08-01T00:00:00-05:00", "2026-02-30T00:00:00Z", "2026-09-01"]) {
    const source = diagnostic({ endsAt }); assert.equal(classifyTemporalDiagnostic(source, fixture()), source);
  }
  const loaded = fixture(); loaded.workspace.timezone = "Invalid/Zone";
  assert.equal(resolveAssessmentCoverage(loaded, { programId: "a" }), null);
});

test("explicit coverage applies only within a valid selected Program", () => {
  assert.deepEqual(resolveAssessmentCoverage(fixture(), { programId: "b", coverage: { kind: "as-of", on: "2026-10-10" } }),
    { start: "2026-10-10", end: "2026-10-10", kind: "as-of", basis: "explicit", programId: "b", auditId: null });
});

test("normalized explicit range coverage does not require a kind", () => {
  assert.deepEqual(resolveAssessmentCoverage(fixture(), { programId: "a", coverage: { start: "2026-10-01", end: "2026-10-02" } }),
    { start: "2026-10-01", end: "2026-10-02", kind: "range", basis: "explicit", programId: "a", auditId: null });
});

test("cached information is reversible across coverage selections without repeated context", () => {
  const loaded = fixture(), source = diagnostic();
  const candidate = classifyTemporalDiagnostic(source, loaded);
  const audit = classifyTemporalDiagnostic(candidate, loaded, { auditId: "audit-a" });
  assert.equal(audit.severity, "warning");
  assert.equal(audit.message, source.message);
  assert.equal(audit.assessmentCoverage, undefined);
  assert.equal(audit.temporal.originalSeverity, "warning");
  const candidateAgain = classifyTemporalDiagnostic(audit, loaded);
  assert.deepEqual(candidateAgain, candidate);
  assert.equal(candidateAgain.message.split("Retained historical context").length, 2);
  assert.equal(classifyTemporalDiagnostic(candidate, loaded, { auditId: "missing" }).severity, "warning");
});

test("validation reclassification updates counts and preserves other fields and hidden loaded state", () => {
  const loaded = fixture(), structural = { code: "structural", severity: "error" };
  const validation = { ok: false, counts: { resources: 4, errors: 1, warnings: 1 }, diagnostics: [diagnostic(), structural], reconciliation: { candidates: [] } };
  Object.defineProperty(validation, "loaded", { value: loaded });
  const candidate = reclassifyTemporalValidation(validation, loaded);
  assert.deepEqual(candidate.counts, { resources: 4, errors: 1, warnings: 0, information: 1 });
  assert.equal(candidate.ok, false);
  assert.equal(candidate.loaded, loaded);
  assert.equal(candidate.reconciliation, validation.reconciliation);
  assert.equal(candidate.diagnostics[1], structural);
  const audit = reclassifyTemporalValidation(candidate, loaded, { auditId: "audit-a" });
  assert.deepEqual(audit.counts, { resources: 4, errors: 1, warnings: 1, information: 0 });
  assert.equal(validation.diagnostics[0].severity, "warning");
  assert.equal(reclassifyTemporalValidation({ diagnostics: [diagnostic()], counts: {} }, loaded).ok, true);
});


test("closed subsequent evidence context is informational outside inclusive examination coverage", () => {
  const loaded = fixture();
  const source = diagnostic({ startsAt:"2026-10-01T00:00:00-05:00", endsAt:"2026-10-02T00:00:00-05:00" });
  const later = classifyTemporalDiagnostic(source, loaded, { auditId:"audit-a" });
  assert.equal(later.severity,"info");
  assert.equal(later.temporal.relation,"after");
  assert.match(later.message,/Retained subsequent context/);
  assert.equal(classifyTemporalDiagnostic(later,loaded,{auditId:"type-one"}).severity,"warning");
  const withinLastDay = diagnostic({startsAt:"2026-09-30T23:59:59-05:00",endsAt:"2026-10-02T00:00:00-05:00"});
  assert.equal(classifyTemporalDiagnostic(withinLastDay,loaded,{auditId:"audit-a"}).severity,"warning");
  const actualFailure = diagnostic({startsAt:"2026-10-01T00:00:00-05:00",endsAt:"2026-10-02T00:00:00-05:00",evidenceLimitation:false});
  assert.equal(classifyTemporalDiagnostic(actualFailure,loaded,{auditId:"audit-a"}).severity,"warning");
});


test("current errors remain immutable even when carrying cached informational context", () => {
  const loaded=fixture();
  const cached=classifyTemporalDiagnostic(diagnostic(),loaded);
  const error={...cached,severity:"error",message:"Current committed proof is invalid."};
  assert.equal(classifyTemporalDiagnostic(error,loaded),error);
  const validation=reclassifyTemporalValidation({ok:false,diagnostics:[error],counts:{}},loaded);
  assert.equal(validation.ok,false);
  assert.equal(validation.counts.errors,1);
  assert.equal(validation.counts.information,0);
  assert.equal(validation.diagnostics[0],error);
});
