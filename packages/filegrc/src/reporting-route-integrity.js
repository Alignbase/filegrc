import { createHash } from "node:crypto";

export function reportingRouteRevision(record) {
  const effectiveFacts = {
    id: record.id,
    type: record.type,
    title: record.title,
    purpose: record.purpose,
    priority: record.priority,
    channelKind: record.channelKind,
    route: record.route,
    effectiveAt: record.effectiveAt,
    dependencySystemIds: record.dependencySystemIds,
    approvedByIds: record.approvedByIds,
    approvedOn: record.approvedOn,
    sourceResourceIds: record.sourceResourceIds,
    ownerIds: record.ownerIds
  };
  return createHash("sha256").update(JSON.stringify(effectiveFacts)).digest("hex");
}
