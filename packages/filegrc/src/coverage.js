export function coverageBounds(coverage) {
  if (coverage?.kind === "as-of" && typeof coverage.on === "string") {
    return { start: coverage.on, end: coverage.on };
  }
  if (
    coverage?.kind === "range"
    && typeof coverage.startsOn === "string"
    && typeof coverage.endsOn === "string"
  ) {
    return { start: coverage.startsOn, end: coverage.endsOn };
  }
  return { start: null, end: null };
}

export function coverageStart(coverage) {
  return coverageBounds(coverage).start;
}

export function coverageEnd(coverage) {
  return coverageBounds(coverage).end;
}

export function coverageMatches(coverage, start, end = start) {
  const bounds = coverageBounds(coverage);
  return bounds.start === start && bounds.end === end;
}

export function coverageOverlaps(coverage, start, end = start) {
  const bounds = coverageBounds(coverage);
  return Boolean(bounds.start && bounds.end && bounds.start <= end && bounds.end >= start);
}

export function coverageContains(coverage, date) {
  return coverageOverlaps(coverage, date, date);
}

export function coverageLabel(coverage) {
  const bounds = coverageBounds(coverage);
  if (!bounds.start || !bounds.end) return "";
  return bounds.start === bounds.end ? bounds.start : `${bounds.start} through ${bounds.end}`;
}

export function legacyCoverage(record, options = {}) {
  const asOf = options.asOfFields?.map((field) => record[field]).find(Boolean);
  if (asOf) return { kind: "as-of", on: asOf };
  const start = options.startFields?.map((field) => record[field]).find(Boolean);
  const end = options.endFields?.map((field) => record[field]).find(Boolean);
  if (start && end) return { kind: "range", startsOn: start, endsOn: end };
  return null;
}
