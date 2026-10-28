import { isDeepStrictEqual } from "node:util";

// Only an exact, unambiguous, finalized correction can replace an assignment.
// The old proof remains immutable and visible in its historical occurrence.
export function supersededOperatingProofIds(resources, validationOk) {
  if (!validationOk) return new Set();
  const byId = new Map(resources.map(record => [record.id, record]));
  const occurrences = resources.filter(record => record.type === "obligation-occurrence");
  const replaced = new Set();
  for (const original of occurrences.filter(record => record.status === "superseded")) {
    let current = original;
    const seen = new Set([original.id]);
    while (current.status === "superseded") {
      const next = occurrences.filter(record => record.supersedesId === current.id);
      if (next.length !== 1 || seen.has(next[0].id)) { current = null; break; }
      const candidate = next[0];
      if (candidate.programId !== original.programId || candidate.obligationId !== original.obligationId || !isDeepStrictEqual(candidate.coverage, original.coverage)) { current = null; break; }
      seen.add(candidate.id); current = candidate;
    }
    if (current?.status !== "reconciled" || !["complete", "complete-with-exceptions", "zero-population"].includes(current.conclusion)) continue;
    for (const member of original.members || []) {
      const replacement = current.members?.find(row => row.resourceId === member.resourceId);
      if (!replacement || replacement.disposition !== "expected" || replacement.result !== "passed" || !replacement.completionResourceIds?.length) continue;
      const proofs = replacement.completionResourceIds.map(id => byId.get(id));
      if (proofs.some(record => !record || !["complete", "completed", "passed", "reconciled"].includes(record.status))) continue;
      for (const id of member.completionResourceIds || []) {
        if (replacement.completionResourceIds.includes(id)) continue;
        // A separate live assignment still needs this record to be finished.
        const live = occurrences.some(record => record.status !== "superseded" && (record.members || []).some(row => row.completionResourceIds?.includes(id)))
          || resources.some(record => record.type === "action-item" && ["open", "in-progress", "blocked"].includes(record.status) && record.completionResourceIds?.includes(id));
        if (!live) replaced.add(id);
      }
    }
  }
  return replaced;
}
