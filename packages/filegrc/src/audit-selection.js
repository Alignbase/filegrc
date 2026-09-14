export function selectDefaultAudit(audits = [], asOf = "") {
  const terminal = new Set(["complete", "closed", "canceled", "delivered"]);
  const coverageStart = (audit) => audit?.coverage?.startsOn
    || audit?.coverage?.periodStart
    || audit?.coverage?.on
    || "";
  const statusOrder = new Map([
    ["planned", 0],
    ["in-progress", 1],
    ["fieldwork", 2],
    ["report-draft", 3],
    ["issued", 4],
    ["delivered", 5],
    ["complete", 6]
  ]);
  const open = audits.filter((audit) => !terminal.has(audit.status));
  const candidates = [...(open.length ? open : audits)];
  candidates.sort((left, right) => {
    const leftStart = coverageStart(left);
    const rightStart = coverageStart(right);
    const leftStarted = Boolean(leftStart && (!asOf || leftStart <= asOf));
    const rightStarted = Boolean(rightStart && (!asOf || rightStart <= asOf));
    return Number(rightStarted) - Number(leftStarted)
      || (leftStarted && rightStarted
        ? rightStart.localeCompare(leftStart)
        : leftStart && rightStart
          ? leftStart.localeCompare(rightStart)
          : Number(Boolean(rightStart)) - Number(Boolean(leftStart)))
      || (statusOrder.get(right.status) ?? -1) - (statusOrder.get(left.status) ?? -1)
      || String(left.id || "").localeCompare(String(right.id || ""));
  });
  return candidates[0] || null;
}
