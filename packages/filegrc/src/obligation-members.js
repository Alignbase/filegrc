export function occurrenceMemberExceptionIsValid(member, occurrence, byId) {
  const exception = byId.get(member.exceptionId);
  const occurrenceStart = occurrence.coverage?.kind === "as-of"
    ? occurrence.coverage.on
    : occurrence.coverage?.startsOn;
  const occurrenceEnd = occurrence.coverage?.kind === "as-of"
    ? occurrence.coverage.on
    : occurrence.coverage?.endsOn;
  const exceptionCoversMember = exception?.scopeResourceIds?.includes(member.resourceId)
    || exception?.scopeResourceIds?.includes(occurrence.obligationId);
  const statusCoveredOccurrence = exception?.status === "approved"
    || ["revoked", "closed"].includes(exception?.status)
      && exception.resolution?.resolvedOn > occurrenceEnd;
  return Boolean(
    exception?.type === "exception"
    && statusCoveredOccurrence
    && exceptionCoversMember
    && exception.approval?.approvedOn <= occurrenceStart
    && exception.approval?.expiresOn >= occurrenceEnd
  );
}

export function occurrenceMemberIsResolved(member, occurrence, byId, expectedCompletionIsValid = () => false) {
  if (member.disposition === "expected") {
    return member.result === "passed"
      && (member.completionResourceIds || []).some((id) => expectedCompletionIsValid(id, member));
  }
  if (member.disposition === "exception") return occurrenceMemberExceptionIsValid(member, occurrence, byId);
  if (member.disposition === "not-applicable") return Boolean(String(member.rationale || "").trim());
  return false;
}
