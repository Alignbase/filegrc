import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeComprehensiveWorkspace } from "../fixtures.js";
import { commitWorkspaceFiles, initializeGitWorkspace, writeJson } from "../helpers.js";
import { contentRevision } from "../../src/files.js";
import { loadWorkspace } from "../../src/workspace.js";
import { resourceReviewRevisionsSync, retentionReviewResourceIds } from "../../src/retention.js";
import { planApplicabilityReview, applyApplicabilityReview } from "../../src/batch-review.js";
import { applyCollectionReview } from "../../src/collection-review.js";
import { currentCalendarDate } from "../../src/time.js";

export async function makeRetentionActivationWorkspace(root, { priorBindings = false } = {}) {
  await makeComprehensiveWorkspace(root, "11");
  let loaded = await loadWorkspace(root);
  const governed = loaded.entries.filter(({ record }) => ["policy", "document", "training"].includes(record.type));
  const document = governed.find(({ record }) => record.type === "document");
  const scheduleId = "document-retention-schedule";
  const scheduleMarkdown = "# Data Retention Schedule\n\nRetain production backups for one year after creation.\n";
  await writeFile(join(root, "data/documents", `${scheduleId}.md`), scheduleMarkdown);
  await writeJson(join(root, "data/documents", `${scheduleId}.json`), {
    ...document.record, id: scheduleId, title: "Data Retention Schedule", documentKind: "schedule",
    approvedContentRevisions: { [`documents/${scheduleId}.md`]: contentRevision(scheduleMarkdown) },
    activatedContentRevisions: { [`documents/${scheduleId}.md`]: contentRevision(scheduleMarkdown) }
  });
  for (const entry of governed) {
    const record = { ...entry.record, status: "approved" };
    if (record.type === "document") record.programRole = "required";
    for (const field of ["effectiveOn", "activationBasis", "activatedOn", "activatedByIds", "activatedContentRevisions"]) delete record[field];
    record.proposedEffectiveOn = "2026-12-01";
    await writeJson(entry.path, record);
  }
  loaded = await loadWorkspace(root);
  const row = loaded.entries.find(({ record }) => record.type === "retention-schedule-item");
  row.record = {
    ...row.record, status: "active", title: "Production backup retention", scheduleDocumentId: scheduleId,
    informationTypeIds: ["information-type-example"],
    sourceResourceIds: governed.filter(({ record }) => record.type !== "training").map(({ record }) => record.id),
    cutoff: { basis: "creation" }, retentionPeriod: { basis: "fixed", amount: 1, unit: "year" },
    dispositionAction: "delete", dispositionInstructions: "Delete expired backups through the approved backup service."
  };
  row.record.reviewedSourceRevisions = Object.fromEntries(resourceReviewRevisionsSync(
    loaded, retentionReviewResourceIds(row.record, loaded), "legacy", priorBindings, null, row.record, !priorBindings
  ));
  await writeJson(row.path, row.record);
  const control = loaded.entries.find(({ record }) => record.type === "control");
  await writeJson(control.path, { ...control.record, procedureRevision: "1", procedureEffectiveOn: "2026-06-30" });
  const obligation = loaded.entries.find(({ record }) => record.type === "obligation");
  const trainingObligation = {
    ...obligation.record, id: "obligation-training", scheduleMode: "legacy", activityType: "training", scopeResourceIds: ["training-example"], templateResourceId: "training-example",
    recurrence: { mode: "calendar", unit: "month", interval: 1, anchorDate: "2026-08-21" }
  };
  delete trainingObligation.ruleIds;
  delete trainingObligation.activeRuleId;
  await writeJson(join(root, "data/obligations/obligation-training.json"), trainingObligation);
  await initializeGitWorkspace(root);
  loaded = await loadWorkspace(root);
  const review = {
    decision: "complete", rationale: "Reviewed the implemented controls and operating sources.",
    reviewedByIds: ["person-independent-approver-example"],
    reviewedOn: currentCalendarDate(loaded.workspace.timezone), confirmed: true
  };
  const applicability = {
    decisions: [{ id: control.record.id, decision: "applicable", rationale: "The Control applies to the scoped service.", reviewedByIds: review.reviewedByIds, reviewedOn: review.reviewedOn }]
  };
  const plan = await planApplicabilityReview(root, applicability);
  await applyApplicabilityReview(root, { ...applicability, basis: plan.basis, confirmed: true });
  await commitWorkspaceFiles(root, "Record Control applicability");
  await applyCollectionReview(root, { ...review, resourceType: "complementary-control" });
  await commitWorkspaceFiles(root, "Review complementary responsibilities");
  await applyCollectionReview(root, { ...review, resourceType: "control" });
  return { ids: governed.map(({ record }) => record.id), rowId: row.record.id };
}
