import { writeJson, initializeGitWorkspace, commitWorkspaceFiles } from "../helpers.js";
import { makeComprehensiveWorkspace } from "../fixtures.js";
import { loadWorkspace } from "../../src/workspace.js";
import { resourceReviewRevisionsSync, retentionReviewResourceIds } from "../../src/retention.js";
import { applyCollectionReview, scaffoldCollectionReview } from "../../src/collection-review.js";
import { currentCalendarDate } from "../../src/time.js";

export async function makeRetentionApplicationWorkspace(root, { programWide = false } = {}) {
  // Historical approvals remain valid when a workspace adopts the new action.
  await makeComprehensiveWorkspace(root, "11");
  let loaded = await loadWorkspace(root);
  const document = loaded.entries.find(({ record }) => record.id === "document-example");
  await writeJson(document.path, { ...document.record, documentKind: "schedule", reportingRouteRequirements: undefined });
  const rowEntry = loaded.entries.find(({ record }) => record.type === "retention-schedule-item");
  const row = {
    ...rowEntry.record, status: "active",
    scopeResourceIds: programWide ? ["program-example"] : ["system-example", "component-example", "vendor-example"],
    scheduleDocumentId: document.record.id, informationTypeIds: ["information-type-example"],
    cutoff: { basis: "creation" }, retentionPeriod: { basis: "fixed", amount: 3, unit: "year" },
    dispositionAction: "delete", dispositionInstructions: "Delete after the approved cutoff and period unless a hold applies."
  };
  if (programWide) {
    const system = loaded.entries.find(({ record }) => record.id === "system-example");
    await writeJson(system.path, { ...system.record, informationTypeIds: ["information-type-example"] });
    const vendor = loaded.entries.find(({ record }) => record.id === "vendor-example");
    await writeJson(vendor.path, { ...vendor.record, informationTypeIds: ["information-type-example"] });
  }
  loaded = await loadWorkspace(root);
  row.reviewedSourceRevisions = Object.fromEntries(resourceReviewRevisionsSync(
    loaded, retentionReviewResourceIds(row, loaded), "legacy", false, null, row
  ));
  await writeJson(rowEntry.path, row);
  await initializeGitWorkspace(root);
  const scaffold = await scaffoldCollectionReview(root, { resourceType: "retention-schedule-item" });
  await applyCollectionReview(root, {
    ...scaffold, decision: "complete", rationale: "Reviewed the complete schedule and all approved rule requirements.",
    reviewedByIds: ["person-independent-approver-example"], reviewedOn: currentCalendarDate("UTC"), confirmed: true
  });
  await commitWorkspaceFiles(root, "Approve retention schedule");
  loaded = await loadWorkspace(root);
  await writeJson(loaded.entries.find(({ record }) => record.type === "workspace").path, { ...loaded.workspace, dataModelVersion: "13" });
  await writeJson(`${root}/package.json`, { private: true, dependencies: { filegrc: "^0.19.2" } });
  await writeJson(`${root}/package-lock.json`, { lockfileVersion: 3, packages: { "": { dependencies: { filegrc: "^0.19.2" } }, "node_modules/filegrc": { version: "0.19.2" } } });
  await commitWorkspaceFiles(root, "Upgrade workspace model");
  return root;
}
