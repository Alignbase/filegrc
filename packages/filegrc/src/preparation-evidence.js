import { personWasActiveOn } from "./soc2.js";

// A retrieval rehearsal uses the ordinary Evidence lifecycle. Independent
// verification is required only by a governing workflow, never by this helper.
export function preparationEvidenceIssues(record, byId, asOf) {
  const issues = [];
  if (record?.type !== "evidence" || !["collected", "verified"].includes(record.status)) return ["Collect a real Evidence Artifact; a draft or withdrawn artifact does not prove operation."];
  if (!record.collectedOn || record.collectedOn > asOf) issues.push("Record the actual collection date, on or before the assessment date.");
  if (record.expiresOn && record.expiresOn < asOf) issues.push("Replace expired proof with a current retrieval rehearsal.");
  if (!record.collectorIds?.length || record.collectorIds.some((id) => !personWasActiveOn(byId.get(id), record.collectedOn))) issues.push("Name the Person who actually collected this proof and was active on that date.");
  if (record.status === "verified" && (!record.verifiedOn || record.verifiedOn < record.collectedOn || record.verifiedOn > asOf || !record.verifierIds?.length || record.verifierIds.some((id) => !personWasActiveOn(byId.get(id), record.verifiedOn)))) issues.push("Keep the existing Evidence verification date and verifier valid; do not invent a new approval.");
  return issues;
}

export function verifiedPreparationEvidence(record, byId, asOf) {
  return !preparationEvidenceIssues(record, byId, asOf).length;
}
