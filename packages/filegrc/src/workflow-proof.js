// Proof relationships preserve operating facts. Evidence sourceResourceIds also
// describe mutable context (Controls, inventories, ongoing reviews), whose past
// versions remain in Git rather than becoming permanently frozen records.
const PROOF_FIELDS = [
  "completionResourceIds", "evidenceIds", "sampleEvidenceIds",
  "sourceEvidenceId", "exceptionId", "exceptionIds", "attestationIds"
];
const SOURCE_PROOF_TYPES = new Set(["evidence", "exception", "attestation"]);

export function workflowProofIds(owner, resolveRecord) {
  if (owner.type === "nonmaterial-amendment") return new Set(owner.evidenceIds || []);
  const pending = [
    ...(owner.evidenceIds || []),
    ...(owner.sourceEvidenceId ? [owner.sourceEvidenceId] : []),
    ...(owner.members || []).flatMap((member) => [
      ...(member.completionResourceIds || []), member.exceptionId
    ])
  ].filter(Boolean);
  const ids = new Set();
  while (pending.length) {
    const id = pending.pop();
    if (!id || ids.has(id)) continue;
    ids.add(id);
    const record = resolveRecord(id);
    if (!record) continue;
    for (const field of PROOF_FIELDS) {
      const value = record[field];
      pending.push(...(Array.isArray(value) ? value : value ? [value] : []));
    }
    for (const sourceId of record.sourceResourceIds || []) {
      if (SOURCE_PROOF_TYPES.has(resolveRecord(sourceId)?.type)) pending.push(sourceId);
    }
  }
  return ids;
}
