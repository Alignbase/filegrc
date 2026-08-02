import assert from "node:assert/strict";
import { access, chmod, mkdir, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAppState, createResource, createResourceAndLink, deleteResource, loadWorkspace, searchResources, updateContent, updateResource, validateWorkspace } from "../src/index.js";
import { collectTimings } from "../src/timing.js";
import { fingerprintWorkspace } from "../src/validate.js";
import { makeWorkspace } from "./helpers.js";
import { makeComprehensiveWorkspace } from "./fixtures.js";

test("loads, validates, and searches resources", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-workspace-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const validation = await validateWorkspace(root);
  assert.equal(validation.ok, true);
  assert.equal(validation.counts.resources, 3);
  const loaded = await loadWorkspace(root);
  assert.deepEqual(searchResources(loaded.resources, loaded.model, { query: "program owner" }).map(({ id }) => id), ["person-owner"]);
  assert.deepEqual(
    searchResources([{ id: "future-resource", type: "future-type" }], loaded.model, { query: "future-type" }).map(({ id }) => id),
    ["future-resource"]
  );
  await writeFile(join(root, "data", "aaa-workspace.json"), `${JSON.stringify({
    schemaVersion: 1,
    dataModelVersion: "999",
    id: "workspace-alternate",
    type: "workspace",
    title: "Alternate workspace",
    organizationName: "Alternate",
    timezone: "UTC"
  })}\n`, "utf8");
  const reloaded = await loadWorkspace(root);
  assert.equal(reloaded.workspace.organizationName, "Test Organization");
  assert.equal(reloaded.model.modelVersion, "1");
});

test("reusable validation state invalidates when a source record changes", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-validation-proof-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const validation = await validateWorkspace(root);
  const fingerprint = (await fingerprintWorkspace(validation.loaded)).fingerprint;
  const ownerPath = join(root, "data", "people", "person-owner.json");
  const owner = JSON.parse(await readFile(ownerPath, "utf8"));
  await writeFile(ownerPath, `${JSON.stringify({ ...owner, role: "External source edit" }, null, 2)}\n`, "utf8");

  const { result: state, timings } = await collectTimings(() => createAppState(root, {
    includeDetails: false,
    validationProof: { validation, fingerprint }
  }));

  assert.equal(timings.validation.count, 1);
  assert.equal(state.resources.find(({ record }) => record.id === owner.id).record.role, "External source edit");
});

test("rejects an invalid workspace timezone", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-timezone-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const workspacePath = join(root, "data", "workspace.json");
  const workspace = JSON.parse(await readFile(workspacePath, "utf8"));
  await writeFile(workspacePath, `${JSON.stringify({ ...workspace, timezone: "Not/A-Timezone" }, null, 2)}\n`, "utf8");

  const validation = await validateWorkspace(root);
  assert.equal(validation.ok, false);
  assert.equal(validation.diagnostics.some(({ message }) => message.includes("IANA time zone")), true);
});

test("rejects reversed date ranges", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-date-range-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const ownerPath = join(root, "data", "people", "person-owner.json");
  const owner = JSON.parse(await readFile(ownerPath, "utf8"));
  await writeFile(ownerPath, `${JSON.stringify({
    ...owner,
    startDate: "2026-07-26",
    endDate: "2026-07-25"
  }, null, 2)}\n`, "utf8");
  const validation = await validateWorkspace(root);
  assert.equal(validation.ok, false);
  assert.ok(validation.diagnostics.some(({ code }) => code === "invalid-date-range"));
});

test("rejects a reversed management candidate period", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-candidate-date-range-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const workspacePath = join(root, "data", "workspace.json");
  const workspace = JSON.parse(await readFile(workspacePath, "utf8"));
  await writeFile(workspacePath, `${JSON.stringify({
    ...workspace,
    assuranceGoal: "soc-2-type-2",
    candidatePeriodStart: "2026-07-26",
    candidatePeriodEnd: "2026-07-25"
  }, null, 2)}\n`, "utf8");

  const validation = await validateWorkspace(root);
  assert.equal(validation.ok, false);
  assert.ok(validation.diagnostics.some(({ code, message }) => (
    code === "invalid-date-range" && message.includes("candidatePeriodEnd")
  )));
});

test("rejects negative model counts", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-count-range-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await createResource(root, {
    schemaVersion: 1,
    id: "system-report-source",
    type: "system",
    title: "Report source",
    status: "active",
    criticality: "high",
    ownerIds: ["person-owner"]
  });
  await assert.rejects(createResource(root, {
    schemaVersion: 1,
    id: "evidence-negative-population",
    type: "evidence",
    title: "Negative population",
    status: "collected",
    evidenceKind: "population-export",
    source: "Report source",
    collectedOn: "2026-07-26",
    classification: "Internal",
    periodStart: "2026-01-01",
    periodEnd: "2026-06-30",
    generatedAt: "2026-07-01T09:00:00-05:00",
    timezone: "America/Chicago",
    queryDescription: "All records in the audit period.",
    populationCount: -1,
    completenessValidation: "Reconciled to the source.",
    accuracyValidation: "Checked report fields.",
    sourceSystemId: "system-report-source",
    collectorIds: ["person-owner"]
  }, {
    content: { content: "# Negative population" }
  }), /populationCount: must be at least 0/);
});

test("CRUD writes formatted JSON and never leaves an invalid workspace", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-crud-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const person = {
    schemaVersion: 1,
    id: "person-reviewer",
    type: "person",
    title: "Reviewer",
    status: "active"
  };
  await createResource(root, person);
  const personPath = join(root, "data", "people", "person-reviewer.json");
  await chmod(personPath, 0o640);
  person.role = "Reviewer";
  await updateResource(root, "person", "person-reviewer", person);
  const source = await readFile(personPath, "utf8");
  assert.match(source, /"role": "Reviewer"/);
  assert.equal((await stat(personPath)).mode & 0o777, 0o640);
  await deleteResource(root, "person", "person-reviewer");
  assert.equal((await validateWorkspace(root)).ok, true);

  const ownerPath = join(root, "data", "people", "person-owner.json");
  await chmod(ownerPath, 0o640);
  await createResource(root, {
    schemaVersion: 1,
    id: "policy-owner-reference",
    type: "policy",
    title: "Owner reference",
    status: "draft",
    ownerIds: ["person-owner"],
    approverIds: ["person-approver"]
  }, { content: { content: "# Owner reference" } });
  await assert.rejects(deleteResource(root, "person", "person-owner"), /leave the workspace invalid/i);
  assert.equal((await stat(ownerPath)).mode & 0o777, 0o640);
});

test("creates a completion record and links it in one validated mutation", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-linked-completion-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const obligation = {
    schemaVersion: 1,
    id: "obligation-quarterly-review",
    type: "obligation",
    title: "Quarterly review",
    status: "active",
    activityType: "review",
    recurrence: { mode: "calendar", unit: "month", interval: 3, anchorDate: "2026-01-01" },
    ownerIds: ["person-owner"]
  };
  await createResource(root, obligation);
  const evidence = {
    schemaVersion: 1,
    id: "evidence-quarterly-review",
    type: "evidence",
    title: "Quarterly review evidence",
    status: "collected",
    evidenceKind: "review",
    source: "Internal review",
    collectedOn: "2026-01-20",
    classification: "Internal",
    collectorIds: ["person-owner"]
  };
  const result = await createResourceAndLink(root, evidence, {
    type: "obligation",
    id: obligation.id,
    field: "completionResourceIds"
  }, { content: { content: "# Quarterly review evidence" } });
  assert.equal(result.created.id, evidence.id);
  assert.deepEqual(result.linked.completionResourceIds, [evidence.id]);
  const loaded = await loadWorkspace(root);
  assert.deepEqual(loaded.resources.find(({ id }) => id === obligation.id).completionResourceIds, [evidence.id]);
  const evidencePath = join(root, "data", "evidence", evidence.id, "evidence.md");
  assert.equal(await readFile(evidencePath, "utf8"), "# Quarterly review evidence\n");

  const staleEvidence = {
    ...evidence,
    id: "evidence-stale-review",
    title: "Stale review evidence"
  };
  await assert.rejects(createResourceAndLink(root, staleEvidence, {
    type: "obligation",
    id: obligation.id,
    field: "completionResourceIds",
    expectedRevision: "stale"
  }, { content: { content: "# Stale review" } }), /changed after you opened/i);
  await assert.rejects(access(join(root, "data", "evidence", staleEvidence.id, "evidence.json")), /ENOENT/);
  await assert.rejects(access(join(root, "data", "evidence", staleEvidence.id, "evidence.md")), /ENOENT/);
});

test("rejects traversal through attachment paths and rolls back the record", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-traversal-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const evidence = {
    schemaVersion: 1,
    id: "evidence-unsafe",
    type: "evidence",
    title: "Unsafe evidence",
    status: "collected",
    evidenceKind: "attachment",
    source: "Manual capture",
    collectedOn: "2026-07-25",
    classification: "Internal",
    collectorIds: ["person-owner"],
    filePaths: ["../outside.md"]
  };
  await assert.rejects(createResource(root, evidence), /leave the workspace invalid/i);
  assert.equal((await loadWorkspace(root)).resources.some(({ id }) => id === evidence.id), false);
});

test("keeps evidence attachments inside their owning evidence directory", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-evidence-location-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await mkdir(join(root, "data", "attachments"), { recursive: true });
  await writeFile(join(root, "data", "attachments", "report.txt"), "Report\n", "utf8");
  await assert.rejects(createResource(root, {
    schemaVersion: 1,
    id: "evidence-misplaced",
    type: "evidence",
    title: "Misplaced evidence",
    status: "collected",
    evidenceKind: "attachment",
    source: "Manual capture",
    collectedOn: "2026-07-25",
    classification: "Internal",
    collectorIds: ["person-owner"],
    filePaths: ["attachments/report.txt"]
  }), /workspace invalid/);
  assert.equal((await loadWorkspace(root)).resources.some(({ id }) => id === "evidence-misplaced"), false);
});

test("rejects noncanonical evidence paths that traverse out of their owning directory", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-evidence-normalized-location-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await mkdir(join(root, "data", "evidence", "evidence-other"), { recursive: true });
  await writeFile(join(root, "data", "evidence", "evidence-other", "report.txt"), "Report\n", "utf8");
  await assert.rejects(createResource(root, {
    schemaVersion: 1,
    id: "evidence-path-traversal",
    type: "evidence",
    title: "Noncanonical evidence path",
    status: "collected",
    evidenceKind: "attachment",
    source: "Manual capture",
    collectedOn: "2026-07-25",
    classification: "Internal",
    collectorIds: ["person-owner"],
    filePaths: ["evidence/evidence-path-traversal/../evidence-other/report.txt"]
  }), /workspace invalid/);
  assert.equal((await loadWorkspace(root)).resources.some(({ id }) => id === "evidence-path-traversal"), false);
});

test("rejects companion Markdown symlinks that resolve outside data", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-symlink-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const outside = join(root, "outside.md");
  await writeFile(outside, "# Outside", "utf8");
  await mkdir(join(root, "data", "policies"), { recursive: true });
  await symlink(outside, join(root, "data", "policies", "policy-outside-link.md"));
  await assert.rejects(createResource(root, {
    schemaVersion: 1,
    id: "policy-outside-link",
    type: "policy",
    title: "Outside link",
    status: "draft",
    ownerIds: ["person-owner"],
    approverIds: ["person-approver"]
  }), /Required Policy Markdown is missing|regular file/i);
});

test("rejects a data directory that resolves outside the workspace", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-external-data-root-"));
  const outside = await mkdtemp(join(tmpdir(), "filegrc-external-data-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(outside, { recursive: true, force: true })
  ])));
  await makeWorkspace(outside);
  await symlink(join(outside, "data"), join(root, "data"));

  await assert.rejects(loadWorkspace(root), /data directory resolves outside the workspace/);
});

test("companion Markdown paths must resolve to files", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-data-path-file-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await mkdir(join(root, "data", "policies", "policy-directory.md"), { recursive: true });
  await assert.rejects(createResource(root, {
    schemaVersion: 1,
    id: "policy-directory",
    type: "policy",
    title: "Directory policy",
    status: "draft",
    ownerIds: ["person-owner"],
    approverIds: ["person-approver"]
  }), /regular file/i);
});

test("validates a realistic workspace containing every resource type", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-comprehensive-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  const { model } = await makeComprehensiveWorkspace(root);
  const validation = await validateWorkspace(root);
  assert.equal(validation.counts.resources, Object.keys(model.resources).length + 1);
  assert.deepEqual(validation.diagnostics, []);
});

test("creates and updates Markdown content with its resource", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-content-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const policy = {
    schemaVersion: 1,
    id: "policy-access-control",
    type: "policy",
    title: "Access Control Policy",
    status: "draft",
    ownerIds: ["person-owner"],
    approverIds: ["person-approver"]
  };
  await assert.rejects(createResource(root, { ...policy, id: "policy-invalid-content" }, { content: "" }), /keyed by data-relative/);
  await createResource(root, policy, { content: { content: "# Access Control Policy\n\nDraft content." } });
  const policyContentPath = "policies/policy-access-control.md";
  assert.match(await readFile(join(root, "data", policyContentPath), "utf8"), /Draft content/);
  await updateContent(root, policyContentPath, "# Access Control Policy\n\nUpdated content.");
  assert.match(await readFile(join(root, "data", policyContentPath), "utf8"), /Updated content/);
  const contentRevision = (await createAppState(root)).resources.find(({ record }) => record.id === policy.id).content.content.revision;
  await writeFile(join(root, "data", policyContentPath), "# Access Control Policy\n\nExternal edit.\n", "utf8");
  const externallyEdited = (await createAppState(root)).resources.find(({ record }) => record.id === policy.id).content.content;
  assert.match(externallyEdited.html, /External edit/);
  assert.doesNotMatch(externallyEdited.html, /Updated content/);
  await assert.rejects(
    updateContent(root, policyContentPath, "# Access Control Policy\n\nStale edit.", { expectedRevision: contentRevision }),
    /changed after you opened/i
  );
  assert.match(await readFile(join(root, "data", policyContentPath), "utf8"), /External edit/);
  const deletion = await deleteResource(root, "policy", policy.id);
  assert.deepEqual(deletion.deletedContent, [policyContentPath]);
  await assert.rejects(readFile(join(root, "data", policyContentPath), "utf8"), /ENOENT/);
  assert.equal((await validateWorkspace(root)).ok, true);
});

test("stores Markdown beside records without path fields", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-companion-markdown-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const policy = {
    schemaVersion: 1,
    id: "policy-companion",
    type: "policy",
    title: "Companion Policy",
    status: "draft",
    ownerIds: ["person-owner"],
    approverIds: ["person-approver"]
  };
  await createResource(root, policy, { content: { content: "# Companion Policy\n\nInitial." } });
  const markdownPath = join(root, "data", "policies", "policy-companion.md");
  assert.match(await readFile(markdownPath, "utf8"), /Initial/);
  const entry = (await createAppState(root)).resources.find(({ record }) => record.id === policy.id);
  assert.equal("contentPath" in entry.record, false);
  assert.equal(entry.content.content.path, "policies/policy-companion.md");
  assert.match(entry.content.content.source, /Initial/);

  await updateResource(root, policy.type, policy.id, {
    ...policy,
    status: "active",
    approvedOn: "2026-01-01",
    effectiveOn: "2026-01-01"
  }, {
    content: { content: "# Companion Policy\n\nUpdated." },
    expectedRevision: entry.revision,
    expectedContentRevisions: { [entry.content.content.path]: entry.content.content.revision }
  });
  assert.match(await readFile(markdownPath, "utf8"), /Updated/);
  assert.equal((await validateWorkspace(root)).ok, true);

  const deletion = await deleteResource(root, policy.type, policy.id);
  assert.deepEqual(deletion.deletedContent, ["policies/policy-companion.md"]);
  await assert.rejects(readFile(markdownPath, "utf8"), /ENOENT/);
});

test("requires configured Markdown and accepts Markdown as an evidence source", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-required-companion-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const policy = {
    schemaVersion: 1,
    id: "policy-missing-markdown",
    type: "policy",
    title: "Missing Markdown",
    status: "draft",
    ownerIds: ["person-owner"],
    approverIds: ["person-approver"]
  };
  await assert.rejects(createResource(root, policy), /Required Policy Markdown is missing/);

  const evidence = {
    schemaVersion: 1,
    id: "evidence-companion",
    type: "evidence",
    title: "Markdown Evidence",
    status: "collected",
    evidenceKind: "narrative",
    source: "Program owner",
    collectedOn: "2026-07-25",
    classification: "Internal",
    collectorIds: ["person-owner"]
  };
  await createResource(root, evidence, { content: { content: "# Evidence\n\nReview notes." } });
  assert.equal((await validateWorkspace(root)).ok, true);
  assert.match(await readFile(join(root, "data", "evidence", evidence.id, "evidence.md"), "utf8"), /Review notes/);
});

test("allows External Evidence drafts but requires collection facts before advancing them", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-evidence-draft-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const draft = {
    schemaVersion: 1,
    id: "evidence-access-collection-test",
    type: "evidence",
    title: "Access report export",
    status: "draft",
    evidenceKind: "access-export"
  };
  await createResource(root, draft);
  assert.equal((await validateWorkspace(root)).ok, true);
  await assert.rejects(
    updateResource(root, "evidence", draft.id, { ...draft, status: "collected" }),
    /Required field "source" is missing/
  );
  assert.equal((await loadWorkspace(root)).resources.find(({ id }) => id === draft.id).status, "draft");
});

test("stores common Record Markdown for result-bearing resources", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-record-markdown-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const finding = {
    schemaVersion: 1,
    id: "finding-review-delay",
    type: "finding",
    title: "Review completed late",
    status: "open",
    severity: "medium",
    sourceResourceId: "person-owner",
    description: "The scheduled review completed after its cutoff.",
    ownerIds: ["person-owner"],
    dueOn: "2026-08-01"
  };

  await createResource(root, finding, {
    content: {
      record: "# Review completed late\n\nDocument the observation, cause, response, and verification."
    }
  });

  const entry = (await createAppState(root)).resources.find(({ record }) => record.id === finding.id);
  const notesPath = "findings/finding-review-delay.md";
  assert.match(entry.content.record.source, /observation, cause, response/);
  assert.match(await readFile(join(root, "data", notesPath), "utf8"), /verification/);
  await updateResource(root, finding.type, finding.id, { ...finding, description: "The review and follow-up are complete." }, {
    content: { record: "# Review completed late\n\nFollow-up verified." },
    expectedRevision: entry.revision,
    expectedContentRevisions: { [notesPath]: entry.content.record.revision }
  });
  assert.match(await readFile(join(root, "data", notesPath), "utf8"), /Follow-up verified/);
});

test("requires procedure Markdown before a control becomes implemented", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-control-procedure-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await createResource(root, {
    schemaVersion: 1,
    id: "framework-control-test",
    type: "framework",
    title: "Control test framework",
    status: "active",
    version: "1"
  });
  await createResource(root, {
    schemaVersion: 1,
    id: "requirement-control-test",
    type: "requirement",
    title: "Control test requirement",
    frameworkId: "framework-control-test",
    reference: "TEST1",
    applicability: "applicable"
  });
  await createResource(root, {
    schemaVersion: 1,
    id: "system-control-test",
    type: "system",
    title: "Control test system",
    status: "active",
    criticality: "high",
    ownerIds: ["person-owner"]
  });
  const control = {
    schemaVersion: 1,
    id: "control-procedure-test",
    type: "control",
    title: "Procedure test control",
    status: "implemented",
    statement: "Management performs the test control.",
    ownerIds: ["person-owner"],
    requirementIds: ["requirement-control-test"],
    activity: "Perform and document the control.",
    operationMode: "manual",
    frequency: "Monthly",
    systemIds: ["system-control-test"],
    evidenceSourceIds: ["system-control-test"],
    effectiveOn: "2026-07-01"
  };
  await assert.rejects(createResource(root, control), /Required Procedure Markdown is missing/);
  await createResource(root, control, {
    content: {
      record: "# Procedure test control\n\nThe owner performs the control each month and keeps the dated result."
    }
  });
  assert.equal((await validateWorkspace(root)).ok, true);

  const policy = {
    schemaVersion: 1,
    id: "policy-procedure-test",
    type: "policy",
    title: "Procedure test policy",
    status: "draft",
    ownerIds: ["person-owner"],
    approverIds: ["person-approver"],
    controlIds: [control.id]
  };
  await createResource(root, policy, {
    content: {
      content: "# Procedure test policy\n\nThe owner completes and records the scheduled control."
    }
  });
  const obligation = {
    schemaVersion: 1,
    id: "obligation-procedure-test",
    type: "obligation",
    title: "Run the procedure test",
    status: "active",
    activityType: "control-test",
    recurrence: {
      mode: "calendar",
      unit: "month",
      interval: 1,
      anchorDate: "2026-07-01"
    },
    ownerIds: ["person-owner"],
    controlIds: [control.id],
    policyIds: [policy.id]
  };
  await assert.rejects(
    createResource(root, obligation),
    /enabled schedule is waiting for governing policy to become active and effective: Procedure test policy \(draft\)\. Complete Step 2 first/
  );
  await updateResource(root, "policy", policy.id, {
    ...policy,
    status: "active",
    approvedOn: "2026-07-01",
    effectiveOn: "2026-07-01"
  });
  await createResource(root, obligation);
  await updateResource(root, "control", control.id, { ...control, status: "planned" });
  await updateResource(root, "control", control.id, control);
  assert.equal(
    (await loadWorkspace(root)).resources.find(({ id }) => id === control.id).status,
    "implemented"
  );
  await assert.rejects(
    updateResource(root, "obligation", obligation.id, { ...obligation, status: "paused" }),
    /linked schedule is paused\. Enable it before implementing the control/
  );
  assert.equal(
    (await loadWorkspace(root)).resources.find(({ id }) => id === obligation.id).status,
    "active"
  );
});

test("rejects empty required relationships and rolls back bundled content", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-required-array-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const policy = {
    schemaVersion: 1,
    id: "policy-no-owner",
    type: "policy",
    title: "Policy without owner",
    status: "draft",
    ownerIds: [],
    approverIds: []
  };
  await assert.rejects(
    createResource(root, policy, { content: { content: "# Policy" } }),
    /required field/i
  );
  await assert.rejects(readFile(join(root, "data", "policies", "policy-no-owner.md"), "utf8"), /ENOENT/);
});

test("allows draft governance records without approvers", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-draft-approver-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const policy = await createResource(root, {
    schemaVersion: 1,
    id: "policy-awaiting-approver",
    type: "policy",
    title: "Policy awaiting approver",
    status: "draft",
    ownerIds: ["person-owner"]
  }, {
    content: { content: "# Policy awaiting approver" }
  });
  await assert.rejects(
    updateResource(root, "policy", policy.record.id, { ...policy.record, status: "in-review" }),
    /Required field "approverIds" is missing/
  );
  const document = await createResource(root, {
    schemaVersion: 1,
    id: "document-awaiting-approver",
    type: "document",
    title: "Document awaiting approver",
    status: "draft",
    documentKind: "procedure",
    ownerIds: ["person-owner"]
  }, {
    content: { content: "# Document awaiting approver" }
  });
  assert.equal(document.record.approverIds, undefined);
  await assert.rejects(
    updateResource(root, "document", document.record.id, {
      ...document.record,
      status: "active",
      effectiveOn: "2026-07-01",
      approvedOn: "2026-07-01"
    }),
    /Required field "approverIds" is missing/
  );
});

test("requires policy and document approvers to be separate from owners", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-independent-approver-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await assert.rejects(createResource(root, {
    schemaVersion: 1,
    id: "policy-overlapping-approver",
    type: "policy",
    title: "Overlapping approver",
    status: "draft",
    ownerIds: ["person-owner"],
    approverIds: ["person-owner"]
  }, {
    content: { content: "# Overlapping approver" }
  }), /approverIds must not contain the same IDs as ownerIds/);
  await assert.rejects(readFile(join(root, "data", "policies", "policy-overlapping-approver.md"), "utf8"), /ENOENT/);
  await createResource(root, {
    schemaVersion: 1,
    id: "team-owner-reviewers",
    type: "team",
    title: "Owner reviewers",
    status: "active",
    purpose: "Review governed documents.",
    memberIds: ["person-owner"]
  });
  await assert.rejects(createResource(root, {
    schemaVersion: 1,
    id: "document-team-overlap",
    type: "document",
    title: "Team overlap",
    status: "draft",
    documentKind: "test",
    ownerIds: ["person-owner"],
    approverIds: ["team-owner-reviewers"]
  }, {
    content: { content: "# Team overlap" }
  }), /including through team membership/);
});

test("accepts a named internal policy approver without requiring an email", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-named-approver-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await createResource(root, {
    schemaVersion: 1,
    id: "person-reviewer",
    type: "person",
    title: "Alex Reviewer",
    status: "active"
  });
  const policy = {
    schemaVersion: 1,
    id: "policy-internal-approver",
    type: "policy",
    title: "Internal approver",
    status: "approved",
    ownerIds: ["person-owner"],
    approverIds: ["person-reviewer"]
  };
  await createResource(root, policy, { content: { content: "# Internal approver" } });
  assert.equal((await validateWorkspace(root)).ok, true);
});

test("does not count an empty array as a one-of value", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-empty-choice-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await assert.rejects(createResource(root, {
    schemaVersion: 1,
    id: "evidence-empty",
    type: "evidence",
    title: "Empty evidence",
    status: "collected",
    evidenceKind: "screenshot",
    source: "Manual capture",
    collectedOn: "2026-07-25",
    classification: "internal",
    collectorIds: ["person-owner"],
    filePaths: []
  }), /at least one of/i);
});

test("serializes concurrent writes and rejects stale deletion", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-concurrent-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const person = {
    schemaVersion: 1,
    id: "person-concurrent",
    type: "person",
    title: "Concurrent editor",
    status: "active"
  };
  await createResource(root, person);
  const initialEntry = (await createAppState(root)).resources.find(({ record }) => record.id === person.id);
  const results = await Promise.allSettled([
    updateResource(root, person.type, person.id, { ...person, role: "First edit" }, { expectedRevision: initialEntry.revision }),
    updateResource(root, person.type, person.id, { ...person, role: "Second edit" }, { expectedRevision: initialEntry.revision })
  ]);
  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
  assert.match(results.find(({ status }) => status === "rejected").reason.message, /changed after you opened/i);

  await assert.rejects(
    deleteResource(root, person.type, person.id, { expectedRevision: initialEntry.revision }),
    /changed after you opened/i
  );
  const currentEntry = (await createAppState(root)).resources.find(({ record }) => record.id === person.id);
  await deleteResource(root, person.type, person.id, { expectedRevision: currentEntry.revision });
});

test("treats JSON files inside evidence directories as attachments", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-json-evidence-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const evidenceDirectory = join(root, "data", "evidence", "evidence-json-export");
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(join(evidenceDirectory, "export.json"), '{"events":[{"result":"allowed"}]}\n', "utf8");
  await createResource(root, {
    schemaVersion: 1,
    id: "evidence-json-export",
    type: "evidence",
    title: "JSON event export",
    status: "collected",
    evidenceKind: "export",
    source: "Source system",
    collectedOn: "2026-07-25",
    classification: "internal",
    collectorIds: ["person-owner"],
    filePaths: ["evidence/evidence-json-export/export.json"]
  });
  const validation = await validateWorkspace(root);
  assert.equal(validation.ok, true);
  assert.equal(validation.counts.resources, 4);
});
