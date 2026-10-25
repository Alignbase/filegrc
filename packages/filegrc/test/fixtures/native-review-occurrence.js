import { rm } from "node:fs/promises";
import { makeComprehensiveWorkspace } from "../fixtures.js";
import { writeJson } from "../helpers.js";
import { loadWorkspace } from "../../src/index.js";

export async function nativeReviewFixture(root, activityType = "policy-review") {
  await makeComprehensiveWorkspace(root, "13");
  const loaded = await loadWorkspace(root);
  const entry = (type) => loaded.entries.find(({ record }) => record.type === type);
  const scopes = {
    "policy-review": ["policy-example", "document-example"],
    meeting: ["team-example"],
    "oversight-meeting": ["team-example"],
    "risk-assessment": ["system-example", "component-example", "risk-example"],
    "vendor-review": ["vendor-example"],
    "access-review": ["component-example"]
  };
  const obligation = { ...entry("obligation").record, activityType, scopeResourceIds: scopes[activityType] };
  const rule = { ...entry("obligation-rule").record,
    recurrence: { mode: "calendar", unit: "month", interval: 1, anchorDate: "2026-01-01" },
    window: { precision: "date", startsAfter: 0, dueAfter: 20 }, effectiveAt: "2026-07-05T00:00:00-05:00" };
  delete rule.selector;
  await writeJson(entry("obligation").path, obligation);
  await writeJson(entry("obligation-rule").path, rule);
  for (const current of loaded.entries.filter(({ record }) => record.type === "obligation-occurrence")) await rm(current.path);
  const type = activityType === "oversight-meeting" ? "meeting" : activityType;
  const reviewEntry = entry(type);
  const review = { ...reviewEntry.record };
  if (type === "meeting") Object.assign(review, { scheduledFor: "2026-07-07", startedAt: "2026-07-07T12:00:00Z", endedAt: "2026-07-07T13:00:00Z" });
  else Object.assign(review, { completedOn: "2026-07-07" });
  if (review.approvedOn) review.approvedOn = "2026-07-07";
  if (review.coverage) review.coverage = { kind: "as-of", on: "2026-07-07" };
  if (type === "policy-review") Object.assign(review, { scopeResourceIds: scopes[activityType], reviewerIds: ["person-example"], changesRequired: false });
  await writeJson(reviewEntry.path, review);
  return { root, obligation, rule, review, reviewEntry, obligationEntry: entry("obligation"), ruleEntry: entry("obligation-rule") };
}
