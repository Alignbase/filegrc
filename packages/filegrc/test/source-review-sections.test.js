import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { contentRevision } from "../src/files.js";
import { collectionRevision, collectionRevisionMatches } from "../src/collection-revision.js";
import { runCli } from "../src/cli.js";
import { assessRetentionReadiness, resourceReviewRevisions, retentionReviewResourceIds, retentionRuleIsCurrent, reviewedMarkdownSection } from "../src/retention.js";
import { retentionScheduleApprovalIssues } from "../src/retention-schedule-approval.js";
import { assessRequirementMappingReadiness } from "../src/requirement-mapping.js";
import { validateWorkspace } from "../src/validate.js";
import { loadWorkspace } from "../src/workspace.js";
import { captureCli, commitWorkspaceFiles, initializeGitWorkspace, writeJson } from "./helpers.js";

test("source section selection ignores fenced examples", () => {
  const source = "# Policy\n\n```md\n## Retention\nExample only.\n```\n\n## Retention\nKeep records for one year.\n";
  assert.equal(reviewedMarkdownSection(source, "Retention"), "# Policy\n\n## Retention\nKeep records for one year.");
  assert.equal(reviewedMarkdownSection("# Policy\n\n~~~md\n## Retention\nExample only.\n~~~\n", "Retention"), null);
});

test("twenty retention rows follow their approved Policy section through proposal, approval, and activation", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-section-review-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const data = join(root, "data");
  await mkdir(join(data, "policies"), { recursive: true });
  await mkdir(join(data, "documents"), { recursive: true });
  await mkdir(join(data, "retention-schedule-items"), { recursive: true });
  await mkdir(join(data, "information-types"), { recursive: true });
  await mkdir(join(data, "programs"), { recursive: true });
  await writeJson(join(data, "workspace.json"), { id: "workspace", type: "workspace", title: "Workspace", dataModelVersion: "11" });
  const policyPath = join(data, "policies", "policy-security.md");
  const policyRecordPath = join(data, "policies", "policy-security.json");
  const policyText = (change, retention, parent = "Data lifecycle") => `# Information Security Policy\n\n## ${parent}\n\n### Data Protection Policy\n\n${retention}\n\n## Change Management Policy\n\n${change}\n`;
  let policyMarkdown = policyText("Review changes before release.", "Delete records after the approved period.");
  await writeFile(policyPath, policyMarkdown);
  const policy = {
    id: "policy-security", type: "policy", title: "Information Security Policy", status: "active",
    version: "1.0",
    approvedContentRevisions: { "policies/policy-security.md": contentRevision(policyMarkdown) }
  };
  await writeJson(policyRecordPath, policy);
  const scheduleMarkdown = "# Data Retention Schedule\n\nDelete records after one year.\n";
  await writeFile(join(data, "documents", "document-schedule.md"), scheduleMarkdown);
  await writeJson(join(data, "documents", "document-schedule.json"), {
    id: "document-schedule", type: "document", title: "Data Retention Schedule", status: "active",
    documentKind: "schedule", workflowScope: "program",
    approvedContentRevisions: { "documents/document-schedule.md": contentRevision(scheduleMarkdown) }
  });
  await writeJson(join(data, "information-types", "information-type-records.json"), {
    id: "information-type-records", type: "information-type", title: "Records", status: "active", description: "Business records."
  });
  await writeJson(join(data, "programs", "program-main.json"), {
    id: "program-main", type: "program", title: "Program", status: "active"
  });
  const rowPath = join(data, "retention-schedule-items", "retention-records.json");
  const row = {
    id: "retention-records", type: "retention-schedule-item", title: "Record retention", status: "active",
    description: "Retain business records.", informationTypeIds: ["information-type-records"],
    scopeResourceIds: ["program-main"], scheduleDocumentId: "document-schedule",
    sourceResourceIds: ["policy-security"], sourceSectionHeadings: { "policy-security": "Data Protection Policy" },
    cutoff: { basis: "event", event: "Record closes" },
    retentionPeriod: { basis: "fixed", amount: 1, unit: "year" },
    dispositionAction: "delete", dispositionInstructions: "Delete approved copies.",
    ownerIds: ["person-owner"], reviewedSourceRevisions: {}
  };
  await writeJson(rowPath, row);
  await initializeGitWorkspace(root);
  let loaded = await loadWorkspace(root);
  row.reviewedSourceRevisions = Object.fromEntries(await resourceReviewRevisions(
    loaded, retentionReviewResourceIds(row, loaded), "legacy", row
  ));
  await writeJson(rowPath, row);
  for (let number = 2; number <= 20; number += 1) {
    await writeJson(join(data, "retention-schedule-items", `retention-records-${number}.json`), {
      ...row,
      id: `retention-records-${number}`,
      title: `Record retention ${number}`
    });
  }
  await commitWorkspaceFiles(root, "Approve schedule row");
  const bindings = await captureCli(runCli, ["review-bindings", row.id, "--root", root, "--json"]);
  assert.deepEqual(bindings.result.reviewedSourceRevisions, row.reviewedSourceRevisions);
  await writeJson(rowPath, { ...row, sourceSectionHeadings: { "policy-security": "Missing section" } });
  const missingHeading = await captureCli(runCli, ["review-bindings", row.id, "--root", root, "--json"]);
  assert.deepEqual(missingHeading.result.missingSectionIds, ["policy-security"]);
  await writeJson(rowPath, row);

  const state = async () => {
    const current = await loadWorkspace(root);
    const currentRow = current.resources.find(({ id }) => id === row.id);
    const revisions = await resourceReviewRevisions(current, retentionReviewResourceIds(currentRow, current));
    const currentRule = retentionRuleIsCurrent(currentRow, revisions,
      new Map(current.resources.map((record) => [record.id, record])), current);
    const diagnostics = await validateWorkspace(current);
    const program = current.resources.find(({ id }) => id === "program-main");
    const readiness = await assessRetentionReadiness(current, program);
    const approvalIssues = retentionScheduleApprovalIssues(current, program, [currentRow]);
    return {
      currentRule,
      scheduleRevision: collectionRevision(current, "retention-schedule-item"),
      rowReady: readiness.find(({ id }) => id === `retention-rule-${row.id}`)?.status === "complete",
      rowApprovalIssue: approvalIssues.some(({ code }) => code === "incomplete-retention-schedule-row"),
      stale: diagnostics.diagnostics?.filter(({ code }) => code === "stale-retention-review") || []
    };
  };
  const approvedScheduleRevision = (await state()).scheduleRevision;
  const originalWholePolicyRevision = (await resourceReviewRevisions(
    await loadWorkspace(root), ["policy-security"]
  )).get("policy-security");
  const olderWholeSourceRevision = collectionRevision(
    await loadWorkspace(root), "retention-schedule-item", { historicalReviewMetadata: true }
  );
  assert.equal((await state()).currentRule, true);

  policy.status = "in-review";
  delete policy.approvedContentRevisions;
  policyMarkdown = policyText("Require a deployment checklist and rollback review.", "Delete records after the approved period.");
  await writeJson(policyRecordPath, policy);
  await writeFile(policyPath, policyMarkdown);
  await commitWorkspaceFiles(root, "Propose change management update");
  assert.deepEqual(await state(), { currentRule: true, scheduleRevision: approvedScheduleRevision, rowReady: true, rowApprovalIssue: false, stale: [] });
  assert.equal((await resourceReviewRevisions(await loadWorkspace(root), ["policy-security"])).get("policy-security"), originalWholePolicyRevision);

  policy.status = "approved";
  policy.version = "1.1";
  policy.approvedContentRevisions = { "policies/policy-security.md": contentRevision(policyMarkdown) };
  await writeJson(policyRecordPath, policy);
  await commitWorkspaceFiles(root, "Approve change management update");
  assert.deepEqual(await state(), { currentRule: true, scheduleRevision: approvedScheduleRevision, rowReady: true, rowApprovalIssue: false, stale: [] });
  assert.notEqual((await resourceReviewRevisions(await loadWorkspace(root), ["policy-security"])).get("policy-security"), originalWholePolicyRevision);
  assert.equal(collectionRevisionMatches(await loadWorkspace(root), "retention-schedule-item", olderWholeSourceRevision), true);
  policy.status = "active";
  await writeJson(policyRecordPath, policy);
  await commitWorkspaceFiles(root, "Activate change management update");
  assert.deepEqual(await state(), { currentRule: true, scheduleRevision: approvedScheduleRevision, rowReady: true, rowApprovalIssue: false, stale: [] });

  await writeFile(policyPath, policyText("Require a deployment checklist and rollback review.", "Delete records after two years."));
  assert.equal((await state()).stale.length, 20);
  await writeFile(policyPath, policyMarkdown);
  assert.deepEqual(await state(), { currentRule: true, scheduleRevision: approvedScheduleRevision, rowReady: true, rowApprovalIssue: false, stale: [] });

  policy.effectiveOn = "2027-01-01";
  await writeJson(policyRecordPath, policy);
  assert.equal((await state()).stale.length, 20);
  delete policy.effectiveOn;
  await writeJson(policyRecordPath, policy);
  assert.deepEqual(await state(), { currentRule: true, scheduleRevision: approvedScheduleRevision, rowReady: true, rowApprovalIssue: false, stale: [] });

  policy.extensions = { "example:retentionScope": "special records" };
  await writeJson(policyRecordPath, policy);
  assert.equal((await state()).stale.length, 20);
  delete policy.extensions;
  await writeJson(policyRecordPath, policy);
  assert.deepEqual(await state(), { currentRule: true, scheduleRevision: approvedScheduleRevision, rowReady: true, rowApprovalIssue: false, stale: [] });

  const currentChangeText = "Require a deployment checklist and rollback review.";
  policyMarkdown = policyText(currentChangeText, "Delete records after the approved period.", "Optional data lifecycle");
  policy.approvedContentRevisions = { "policies/policy-security.md": contentRevision(policyMarkdown) };
  await writeFile(policyPath, policyMarkdown);
  await writeJson(policyRecordPath, policy);
  assert.equal((await state()).stale.length, 20);
  policyMarkdown = policyText(currentChangeText, "Delete records after the approved period.");
  policy.approvedContentRevisions = { "policies/policy-security.md": contentRevision(policyMarkdown) };
  await writeFile(policyPath, policyMarkdown);
  await writeJson(policyRecordPath, policy);
  assert.deepEqual(await state(), { currentRule: true, scheduleRevision: approvedScheduleRevision, rowReady: true, rowApprovalIssue: false, stale: [] });

  policy.status = "in-review";
  delete policy.approvedContentRevisions;
  policyMarkdown = policyText("Require a deployment checklist and rollback review.", "Delete records after two years.");
  await writeJson(policyRecordPath, policy);
  await writeFile(policyPath, policyMarkdown);
  await commitWorkspaceFiles(root, "Propose retention update");
  assert.deepEqual(await state(), { currentRule: true, scheduleRevision: approvedScheduleRevision, rowReady: true, rowApprovalIssue: false, stale: [] });

  policy.status = "approved";
  policy.version = "1.2";
  policy.approvedContentRevisions = { "policies/policy-security.md": contentRevision(policyMarkdown) };
  await writeJson(policyRecordPath, policy);
  await commitWorkspaceFiles(root, "Approve retention update");
  const changed = await state();
  assert.equal(changed.currentRule, false);
  assert.notEqual(changed.scheduleRevision, approvedScheduleRevision);
  assert.equal(changed.rowReady, false);
  assert.equal(changed.rowApprovalIssue, true);
  assert.equal(changed.stale.length, 20);
  policy.status = "active";
  await writeJson(policyRecordPath, policy);
  await commitWorkspaceFiles(root, "Activate retention update");
  assert.equal((await state()).stale.length, 20);
});

test("a mapping follows a Commitment's selected Policy section", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-mapping-section-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const data = join(root, "data");
  for (const collection of ["policies", "commitments", "controls", "requirement-mappings"]) {
    await mkdir(join(data, collection), { recursive: true });
  }
  await writeJson(join(data, "workspace.json"), { id: "workspace", type: "workspace", title: "Workspace", dataModelVersion: "11" });
  const policyPath = join(data, "policies", "policy-security.md");
  const policyRecordPath = join(data, "policies", "policy-security.json");
  const markdown = (retention, changes) => `# Policy\n\n## Retention\n\n${retention}\n\n## Changes\n\n${changes}\n`;
  const policy = { id: "policy-security", type: "policy", title: "Security Policy", status: "active" };
  const setPolicy = async (retention, changes) => {
    const source = markdown(retention, changes);
    policy.approvedContentRevisions = { "policies/policy-security.md": contentRevision(source) };
    await writeFile(policyPath, source);
    await writeJson(policyRecordPath, policy);
  };
  await setPolicy("Keep records for one year.", "Review changes before release.");
  await writeJson(join(data, "commitments", "commitment-retention.json"), {
    id: "commitment-retention", type: "commitment", title: "Retention promise", status: "active",
    statement: "Keep records for one year.", sourceResourceIds: ["policy-security"],
    sourceSectionHeadings: { "policy-security": "Retention" }
  });
  await writeJson(join(data, "controls", "control-retention.json"), {
    id: "control-retention", type: "control", title: "Retention Control", status: "implemented",
    statement: "Delete records after one year."
  });
  const mappingPath = join(data, "requirement-mappings", "requirement-mapping-retention.json");
  const mapping = {
    id: "requirement-mapping-retention", type: "requirement-mapping", title: "Retention mapping", status: "active",
    sourceResourceIds: ["commitment-retention"], targetResourceIds: ["control-retention"],
    relationship: "equivalent-to", method: "semantic", rationale: "Both require the same cutoff.",
    ownerIds: ["person-owner"], reviewedByIds: ["person-reviewer"], reviewedOn: "2026-10-04",
    reviewedSourceRevisions: {}
  };
  await writeJson(mappingPath, mapping);
  let loaded = await loadWorkspace(root);
  mapping.reviewedSourceRevisions = Object.fromEntries(await resourceReviewRevisions(
    loaded, ["commitment-retention", "control-retention"]
  ));
  await writeJson(mappingPath, mapping);
  const status = async () => {
    loaded = await loadWorkspace(root);
    return (await assessRequirementMappingReadiness(loaded))[0].status;
  };
  assert.equal(await status(), "complete");
  await setPolicy("Keep records for one year.", "Require a rollback plan.");
  assert.equal(await status(), "complete");
  await setPolicy("Keep records for two years.", "Require a rollback plan.");
  assert.equal(await status(), "action");
  await setPolicy("Keep records for one year.", "Require a rollback plan.");
  assert.equal(await status(), "complete");
  const commitmentPath = join(data, "commitments", "commitment-retention.json");
  const commitment = JSON.parse(await readFile(commitmentPath, "utf8"));
  commitment.statement = "Keep records for two years.";
  await writeJson(commitmentPath, commitment);
  assert.equal(await status(), "action");
});
