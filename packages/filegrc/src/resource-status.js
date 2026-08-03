export function effectiveResourceStatus(record, asOf) {
  if (
    record?.type === "attestation"
    && record.status === "pending"
    && record.dueOn
    && asOf
    && record.dueOn < asOf
  ) return "overdue";
  if (
    record?.type === "evidence"
    && ["collected", "verified"].includes(record.status)
    && record.expiresOn
    && asOf
    && record.expiresOn < asOf
  ) return "expired";
  return record?.status;
}
