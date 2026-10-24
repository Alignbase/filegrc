import { writeJson, initializeGitWorkspace, commitWorkspaceFiles } from "../helpers.js";
import { makeComprehensiveWorkspace } from "../fixtures.js";
import { loadWorkspace } from "../../src/workspace.js";
import { resourceReviewRevisionsSync, retentionReviewResourceIds } from "../../src/retention.js";
import { applyCollectionReview, scaffoldCollectionReview } from "../../src/collection-review.js";
import { currentCalendarDate } from "../../src/time.js";

export async function makeRetentionApplicationWorkspace(root, { programWide = false, businessProof = false } = {}) {
  // Historical approvals remain valid when a workspace adopts the new action.
  await makeComprehensiveWorkspace(root, "11");
  let loaded = await loadWorkspace(root);
  if (businessProof) {
    const informationType = loaded.entries.find(({ record }) => record.type === "information-type");
    await writeJson(informationType.path, { ...informationType.record, title: "Working business records",
      description: "Selected business decisions, review results and approvals; excludes raw source logs and deleted customer content." });
    const source = loaded.entries.find(({ record }) => record.id === "component-example");
    await writeJson(source.path, { ...source.record, vendorId: "vendor-example", classificationId: "classification-example" });
  }
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

// Public, generic fixture for CLI, hosted, and domain tests. The independently
// approved category describes selected business proof, not raw source logs.
export async function makeSourceCoverageRetentionWorkspace(root) {
  await makeRetentionApplicationWorkspace(root, { businessProof: true });
  await writeJson(`${root}/package.json`, { private: true, dependencies: { filegrc: "^0.20.0" } });
  await writeJson(`${root}/package-lock.json`, { lockfileVersion: 3, packages: { "": { dependencies: { filegrc: "^0.20.0" } }, "node_modules/filegrc": { version: "0.20.0" } } });
  const { mkdir } = await import("node:fs/promises");
  await mkdir(`${root}/data/source-coverage`, { recursive: true });
  await writeJson(`${root}/data/source-coverage/source-coverage-selected-proof.json`, {
    id: "source-coverage-selected-proof", type: "source-coverage", title: "Selected access-review proof",
    status: "active", sourceFamilyId: "identity-access", coverageKind: "external-component",
    componentId: "component-example", scopeResourceIds: ["program-example"],
    ownerIds: ["person-example"], retrieverIds: ["person-example"],
    collectionCadence: "Monthly before source expiry.", reconciliationMethod: "Reconcile selected review results with the scoped report count.",
    retrievalMethodKey: "selected-review-export", validFrom: "2026-01-01",
    excludedPopulation: "Raw access logs and deleted customer content.",
    retentionScheduleItemIds: ["retention-schedule-item-example"],
    retentionNotes: "Keep the selected review result and approval using the existing business-record rule."
  });
  const current = await loadWorkspace(root);
  const proof = { ...current.resources.find(({ type }) => type === "evidence"),
    id: "evidence-selected-proof-retrieval", title: "Selected review export retrieval rehearsal",
    readinessTest: true, coveredSourceFamilyIds: ["identity-access"], retrievalMethodKey: "selected-review-export",
    accessConfirmed: true, retrievalResult: "passed", collectedOn: "2026-10-24", verifiedOn: "2026-10-24",
    generatedAt: "2026-10-24T12:00:00Z", timezone: "UTC", populationCount: 1,
    queryDescription: "Select the scoped review result and approval, excluding raw access logs.",
    coverage: { kind: "range", startsOn: "2026-10-24", endsOn: "2026-10-24" },
    filePaths: ["evidence/evidence-selected-proof-retrieval/review.csv"]
  };
  await mkdir(`${root}/data/evidence/${proof.id}`, { recursive: true });
  const { writeFile } = await import("node:fs/promises");
  await writeFile(`${root}/data/evidence/${proof.id}/review.csv`, "review_id,result\nreview-example,passed\n");
  await writeJson(`${root}/data/evidence/${proof.id}/evidence.json`, proof);
  const coveragePath = `${root}/data/source-coverage/source-coverage-selected-proof.json`;
  const coverage = current.resources.find(({ id }) => id === "source-coverage-selected-proof");
  await writeJson(coveragePath, { ...coverage, readinessTestEvidenceIds: [proof.id] });
  await commitWorkspaceFiles(root, "Catalog selected proof collection and retrieval rehearsal");
  return root;
}

export async function sourceCoverageRetentionDecision(root) {
  const { scaffoldRetentionApplication } = await import("../../src/retention-applications.js");
  const payload = await scaffoldRetentionApplication(root, "retention-schedule-item-example");
  Object.assign(payload.record, {
    id: "retention-application-selected-proof", title: "Apply approved business-record rule to selected review proof",
    scopeResourceIds: ["source-coverage-selected-proof"], informationTypeIds: ["information-type-example"],
    reviewedById: "person-example", authorityAppointmentId: "appointment-example",
    purpose: "Selected review results and approvals are working business records under the existing approved category.",
    rationale: "Management confirmed the same purpose, cutoff, period, disposition and holds, without a new information category.",
    disposalImplementation: "Delete selected expired exports after checking holds; source logs retain their existing lifecycle."
  });
  Object.keys(payload.record.confirmations).forEach((key) => payload.record.confirmations[key] = true);
  return payload;
}
