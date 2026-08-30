import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createAppState, createResource, createResourceAndLink, currentCalendarDate, deleteResource, dismissReconciliation, effectiveResourceStatus, loadWorkspace, planReconciliation, searchResources, updateContent, updateResource, validateWorkspace } from "../src/index.js";
import { collectTimings } from "../src/timing.js";
import { fingerprintWorkspace, setFingerprintFileReadObserverForTests } from "../src/validate.js";
import { markdownEntries } from "../src/resource-markdown.js";
import { makeWorkspace } from "./helpers.js";
import { makeComprehensiveWorkspace } from "./fixtures.js";

const execute = promisify(execFile);

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
    dataModelVersion: "999",
    id: "workspace-alternate",
    type: "workspace",
    title: "Alternate workspace",
    organizationName: "Alternate",
    timezone: "UTC"
  })}\n`, "utf8");
  const reloaded = await loadWorkspace(root);
  assert.equal(reloaded.workspace.organizationName, "Test Organization");
  assert.equal(reloaded.model.modelVersion, "2");
});

test("derives overdue and expired display states without changing stored workflow states", () => {
  const attestation = {
    type: "attestation",
    status: "pending",
    dueOn: "2026-08-01"
  };
  assert.equal(effectiveResourceStatus(attestation, "2026-08-01"), "pending");
  assert.equal(effectiveResourceStatus(attestation, "2026-08-02"), "overdue");
  assert.equal(attestation.status, "pending");
  const evidence = {
    type: "evidence",
    status: "verified",
    expiresOn: "2026-08-01"
  };
  assert.equal(effectiveResourceStatus(evidence, "2026-08-01"), "verified");
  assert.equal(effectiveResourceStatus(evidence, "2026-08-02"), "expired");
  assert.equal(evidence.status, "verified");
});

test("requires an explicit data model version and rejects unknown top-level fields", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-strict-model-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const workspacePath = join(root, "data", "workspace.json");
  const ownerPath = join(root, "data", "people", "person-owner.json");
  const workspace = JSON.parse(await readFile(workspacePath, "utf8"));
  const owner = JSON.parse(await readFile(ownerPath, "utf8"));

  delete workspace.dataModelVersion;
  await writeFile(workspacePath, `${JSON.stringify(workspace, null, 2)}\n`, "utf8");
  let validation = await validateWorkspace(root);
  assert.equal(validation.ok, false);
  assert.equal(validation.diagnostics.some(({ code }) => code === "missing-model-version"), true);

  workspace.dataModelVersion = "2";
  owner.legacyCustomField = "move me";
  owner.extensions = { "example.test": { customField: "kept" } };
  await writeFile(workspacePath, `${JSON.stringify(workspace, null, 2)}\n`, "utf8");
  await writeFile(ownerPath, `${JSON.stringify(owner, null, 2)}\n`, "utf8");
  validation = await validateWorkspace(root);
  assert.equal(validation.ok, false);
  assert.equal(validation.diagnostics.some(({ code, severity }) => code === "unknown-field" && severity === "error"), true);

  delete owner.legacyCustomField;
  await writeFile(ownerPath, `${JSON.stringify(owner, null, 2)}\n`, "utf8");
  validation = await validateWorkspace(root);
  assert.equal(validation.ok, true);
});

test("rejects unknown nested fields outside namespaced extensions", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-nested-model-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const loaded = await loadWorkspace(root);
  await assert.rejects(
    updateResource(root, "workspace", loaded.workspace.id, {
      ...loaded.workspace,
      riskMethodology: {
        method: "5x5 likelihood and impact",
        likelihoodScale: ["low", "high"],
        impactScale: ["low", "high"],
        ratingBands: { low: "1-2", high: "3-4" },
        undocumentedSetting: true
      }
    }),
    /riskMethodology\.undocumentedSetting/
  );
  await assert.rejects(
    updateResource(root, "workspace", loaded.workspace.id, {
      ...loaded.workspace,
      extensions: {
        "Not A Namespace": { customField: "value" }
      }
    }),
    /extension namespaces must use lowercase dot-separated names/
  );
  await updateResource(root, "workspace", loaded.workspace.id, {
    ...loaded.workspace,
    extensions: {
      "example.test": { customField: "value" }
    }
  });
  assert.equal((await validateWorkspace(root)).ok, true);
});

test("reusable validation state invalidates when a source record changes", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-validation-proof-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const validation = await validateWorkspace(root);
  const fingerprint = (await fingerprintWorkspace(validation.loaded)).fingerprint;
  assert.equal(JSON.stringify(validation).includes('"loaded"'), false);
  const ownerPath = join(root, "data", "people", "person-owner.json");
  const owner = JSON.parse(await readFile(ownerPath, "utf8"));
  await writeFile(ownerPath, `${JSON.stringify({ ...owner, department: "External source edit" }, null, 2)}\n`, "utf8");

  const { result: state, timings } = await collectTimings(() => createAppState(root, {
    includeDetails: false,
    validationProof: { validation, fingerprint }
  }));

  assert.equal(timings.validation.count, 1);
  assert.equal(state.resources.find(({ record }) => record.id === owner.id).record.department, "External source edit");
});

test("workspace fingerprints include fixed evidence attachment bytes", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-attachment-fingerprint-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root);
  const loaded = await loadWorkspace(root);
  const evidenceEntry = loaded.entries.find(({ record }) => record.type === "evidence");
  assert.ok(evidenceEntry);
  const attachment = `evidence/${evidenceEntry.record.id}/attachment.txt`;
  const secondAttachment = `evidence/${evidenceEntry.record.id}/second.bin`;
  const evidence = { ...evidenceEntry.record, sourceKind: "file", filePaths: [attachment, secondAttachment] };
  await writeFile(join(root, "data", evidenceEntry.relativePath), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  const attachmentPath = join(root, "data", attachment);
  await mkdir(join(attachmentPath, ".."), { recursive: true });
  await writeFile(attachmentPath, "Example fixed evidence attachment.\n", "utf8");
  const secondAttachmentPath = join(root, "data", secondAttachment);
  await writeFile(secondAttachmentPath, "Second fixed evidence attachment.\n", "utf8");
  const fileDigestCache = new Map();
  let attachmentReads = 0;
  const restoreObserver = setFingerprintFileReadObserverForTests((path) => {
    if (path.endsWith(`/${attachment}`) || path.endsWith(`/${secondAttachment}`)) attachmentReads += 1;
  });
  context.after(restoreObserver);
  const before = (await fingerprintWorkspace(root, { fileDigestCache })).fingerprint;
  assert.equal(attachmentReads, 2);
  attachmentReads = 0;
  assert.equal((await fingerprintWorkspace(root, { fileDigestCache })).fingerprint, before);
  assert.equal(attachmentReads, 0);
  const source = await readFile(attachmentPath, "utf8");
  await writeFile(attachmentPath, source.replace("Example", "Changed"), "utf8");
  const after = (await fingerprintWorkspace(root, { fileDigestCache })).fingerprint;
  assert.notEqual(after, before);

  const secondMarker = Buffer.from(`data-path\0${secondAttachment}\0file\0`);
  await writeFile(attachmentPath, Buffer.from("left"));
  await writeFile(secondAttachmentPath, Buffer.concat([Buffer.from("right\0"), secondMarker, Buffer.from("tail")]));
  const boundaryBefore = (await fingerprintWorkspace(root, { fileDigestCache })).fingerprint;
  await writeFile(attachmentPath, Buffer.concat([Buffer.from("left\0"), secondMarker, Buffer.from("right")]));
  await writeFile(secondAttachmentPath, Buffer.from("tail"));
  const boundaryAfter = (await fingerprintWorkspace(root, { fileDigestCache })).fingerprint;
  assert.notEqual(boundaryAfter, boundaryBefore);
});

test("workspace fingerprint attachment reads stop when the verification budget expires", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-attachment-budget-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root);
  const loaded = await loadWorkspace(root);
  const evidenceEntry = loaded.entries.find(({ record }) => record.type === "evidence");
  assert.ok(evidenceEntry);
  const attachments = [
    `evidence/${evidenceEntry.record.id}/first.txt`,
    `evidence/${evidenceEntry.record.id}/second.txt`
  ];
  await writeFile(join(root, "data", evidenceEntry.relativePath), `${JSON.stringify({
    ...evidenceEntry.record,
    sourceKind: "file",
    filePaths: attachments
  }, null, 2)}\n`, "utf8");
  await mkdir(join(root, "data", "evidence", evidenceEntry.record.id), { recursive: true });
  for (const path of attachments) await writeFile(join(root, "data", path), "attachment\n", "utf8");
  const fingerprintInput = await loadWorkspace(root);

  const reads = [];
  const restoreObserver = setFingerprintFileReadObserverForTests(async (path) => {
    if (path.endsWith("/first.txt") || path.endsWith("/second.txt")) {
      reads.push(path);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  });
  context.after(restoreObserver);

  await assert.rejects(
    fingerprintWorkspace(fingerprintInput, {
      deadlineAt: performance.now() + 100,
      maxUncachedFileBytes: 1024 * 1024
    }),
    (error) => error?.code === "FILEGRC_FINGERPRINT_BUDGET"
  );
  assert.equal(reads.length, 1);
});

test("workspace fingerprints reuse unchanged Markdown digests and bound changed Markdown reads", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-markdown-fingerprint-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root);
  const loaded = await loadWorkspace(root);
  const markdownCandidates = loaded.entries
    .flatMap(({ record }) => markdownEntries(loaded.model, record))
    .map(({ path }) => path);
  let markdownRelative = null;
  for (const candidate of markdownCandidates) {
    try {
      if ((await stat(join(root, "data", candidate))).isFile()) {
        markdownRelative = candidate;
        break;
      }
    } catch {}
  }
  assert.ok(markdownRelative);
  const markdown = join(root, "data", markdownRelative);
  const fileDigestCache = new Map();
  let markdownReads = 0;
  const restoreObserver = setFingerprintFileReadObserverForTests(async (path) => {
    if (!path.endsWith(`/${markdownRelative}`)) return;
    markdownReads += 1;
    if (markdownReads > 1) await new Promise((resolve) => setTimeout(resolve, 150));
  });
  context.after(restoreObserver);

  await fingerprintWorkspace(loaded, { fileDigestCache });
  assert.equal(markdownReads, 1);
  await fingerprintWorkspace(loaded, { fileDigestCache });
  assert.equal(markdownReads, 1);
  await writeFile(markdown, `${await readFile(markdown, "utf8")}\n`, "utf8");
  await assert.rejects(
    fingerprintWorkspace(loaded, { fileDigestCache, deadlineAt: performance.now() + 100 }),
    (error) => error?.code === "FILEGRC_FINGERPRINT_BUDGET"
  );
  assert.equal(markdownReads, 2);
});

test("workspace fingerprints include malformed authoritative JSON bytes", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-malformed-fingerprint-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const malformedPath = join(root, "data", "people", "malformed.json");
  await writeFile(malformedPath, "{", "utf8");
  const before = (await fingerprintWorkspace(root)).fingerprint;
  await writeFile(malformedPath, "[", "utf8");
  const after = (await fingerprintWorkspace(root)).fingerprint;
  assert.notEqual(after, before);
});

test("app state reuses the validated workspace for repository configuration", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-state-workspace-reuse-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);

  const { timings } = await collectTimings(() => createAppState(root, { includeDetails: false }));

  assert.equal(timings["workspace-load"].count, 1);
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
    candidateCoverage: { kind: "range", startsOn: "2026-07-26", endsOn: "2026-07-25" },
  }, null, 2)}\n`, "utf8");

  const validation = await validateWorkspace(root);
  assert.equal(validation.ok, false);
  assert.ok(validation.diagnostics.some(({ code, message }) => (
    code === "invalid-date-range" && message.includes("coverage.endsOn")
  )));
});

test("rejects negative model counts", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-count-range-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await createResource(root, {
    id: "system-report-source",
    type: "system",
    title: "Report source",
    status: "active",
    criticality: "high",
    ownerIds: ["person-owner"]
  });
  await assert.rejects(createResource(root, {
    id: "evidence-negative-population",
    type: "evidence",
    title: "Negative population",
    status: "collected",
    artifactKind: "population-export",
    sourceKind: "system",
    sourceDescription: "Report source",
    collectedOn: "2026-07-26",
    classificationId: "internal",
    coverage: { kind: "range", startsOn: "2026-01-01", endsOn: "2026-06-30" },
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
    id: "person-reviewer",
    type: "person",
    affiliation: "internal",
    title: "Reviewer",
    status: "active"
  };
  await createResource(root, person);
  const personPath = join(root, "data", "people", "person-reviewer.json");
  await chmod(personPath, 0o640);
  person.department = "Security";
  await updateResource(root, "person", "person-reviewer", person);
  const source = await readFile(personPath, "utf8");
  assert.match(source, /"department": "Security"/);
  assert.equal((await stat(personPath)).mode & 0o777, 0o640);
  await deleteResource(root, "person", "person-reviewer");
  assert.equal((await validateWorkspace(root)).ok, true);

  const ownerPath = join(root, "data", "people", "person-owner.json");
  await chmod(ownerPath, 0o640);
  await createResource(root, {
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
    id: "obligation-quarterly-review",
    type: "obligation",
    title: "Quarterly review",
    status: "active",
    activityType: "inventory-review",
    recurrence: { mode: "calendar", unit: "month", interval: 3, anchorDate: "2026-01-01" },
    ownerIds: ["person-owner"]
  };
  await createResource(root, obligation);
  const evidence = {
    id: "evidence-quarterly-review",
    type: "evidence",
    title: "Quarterly review evidence",
    status: "collected",
    artifactKind: "business-record",
    artifactSubtype: "review",
    sourceKind: "authored-record",
    sourceDescription: "Internal review",
    collectedOn: "2026-01-20",
    classificationId: "internal",
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
    id: "evidence-unsafe",
    type: "evidence",
    title: "Unsafe evidence",
    status: "collected",
    artifactKind: "other",
    artifactSubtype: "attachment",
    sourceKind: "file",
    sourceDescription: "Manual capture",
    collectedOn: "2026-07-25",
    classificationId: "internal",
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
    id: "evidence-misplaced",
    type: "evidence",
    title: "Misplaced evidence",
    status: "collected",
    artifactKind: "other",
    artifactSubtype: "attachment",
    sourceKind: "file",
    sourceDescription: "Manual capture",
    collectedOn: "2026-07-25",
    classificationId: "internal",
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
    id: "evidence-path-traversal",
    type: "evidence",
    title: "Noncanonical evidence path",
    status: "collected",
    artifactKind: "other",
    artifactSubtype: "attachment",
    sourceKind: "file",
    sourceDescription: "Manual capture",
    collectedOn: "2026-07-25",
    classificationId: "internal",
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
  await execute("git", ["init", "--initial-branch=main"], { cwd: root });
  await execute("git", ["config", "user.name", "Test User"], { cwd: root });
  await execute("git", ["config", "user.email", "test@example.test"], { cwd: root });
  await execute("git", ["add", "."], { cwd: root });
  await execute("git", ["commit", "-m", "Create workspace"], { cwd: root });
  const personPath = join(root, "data", "people", "person-example.json");
  const person = JSON.parse(await readFile(personPath, "utf8"));
  await writeFile(personPath, `${JSON.stringify({ ...person, jobTitle: "Security Director" }, null, 2)}\n`, "utf8");
  const candidate = (await planReconciliation(root)).candidates.find(({ eventType }) => eventType === "person-role-changed");
  await dismissReconciliation(root, {
    candidateId: candidate.transitionFingerprint,
    reviewedById: "person-independent-approver-example",
    reviewedOn: currentCalendarDate("America/Chicago"),
    rationale: "The fixture changes the title only to exercise a reviewed false-positive transition.",
    confirmed: true
  });
  await execute("git", ["add", "."], { cwd: root });
  await execute("git", ["commit", "-m", "Record transition dismissal"], { cwd: root });
  const validation = await validateWorkspace(root);
  assert.equal(validation.counts.resources, Object.keys(model.resources).length + 1);
  assert.deepEqual(validation.diagnostics, []);
});

test("enforces model-declared relationship cycles, active uniqueness, and nested actor types", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-relationship-constraints-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root);
  const loaded = await loadWorkspace(root);
  const byId = new Map(loaded.resources.map((record) => [record.id, record]));
  const requirement = structuredClone(byId.get("requirement-example"));
  const appointment = structuredClone(byId.get("appointment-example"));
  const accessGrant = structuredClone(byId.get("access-grant-example"));
  const risk = structuredClone(byId.get("risk-example"));

  requirement.parentRequirementId = requirement.id;
  risk.response = "accept";
  risk.acceptance = {
    rationale: "Management approved the residual exposure.",
    acceptedByIds: [appointment.id],
    acceptedOn: "2026-06-30",
    expiresOn: "2026-08-15"
  };
  appointment.id = "appointment-duplicate";
  appointment.title = "Duplicate active appointment";
  accessGrant.id = "access-grant-duplicate";
  accessGrant.title = "Duplicate active access grant";

  const requirementEntry = loaded.entries.find(({ record }) => record.id === requirement.id);
  const riskEntry = loaded.entries.find(({ record }) => record.id === risk.id);
  await writeFile(requirementEntry.path, `${JSON.stringify(requirement, null, 2)}\n`, "utf8");
  await writeFile(riskEntry.path, `${JSON.stringify(risk, null, 2)}\n`, "utf8");
  await writeFile(
    join(root, "data", "appointments", `${appointment.id}.json`),
    `${JSON.stringify(appointment, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    join(root, "data", "access-grants", `${accessGrant.id}.json`),
    `${JSON.stringify(accessGrant, null, 2)}\n`,
    "utf8"
  );

  const validation = await validateWorkspace(root);
  assert.equal(validation.ok, false);
  assert.ok(validation.diagnostics.some(({ code }) => code === "cyclic-relationship"));
  assert.ok(validation.diagnostics.some(({ code }) => code === "duplicate-active-relationship"));
  assert.ok(validation.diagnostics.some(({ code, message }) => (
    code === "wrong-reference-type" && message.includes("acceptance.acceptedByIds")
  )));
});

test("rejects lifecycle timestamps that move backward and invalid attestation bindings", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-lifecycle-integrity-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root);
  const loaded = await loadWorkspace(root);
  const grantEntry = loaded.entries.find(({ record }) => record.id === "access-grant-example");
  const attestationEntry = loaded.entries.find(({ record }) => record.id === "attestation-example");
  const grant = structuredClone(grantEntry.record);
  const attestation = structuredClone(attestationEntry.record);

  grant.requestedOn = "2026-07-01";
  grant.approvedOn = "2026-06-30";
  attestation.subjectResourceIds = [
    ...new Set([...(attestation.subjectResourceIds || []), "training-example"])
  ];
  attestation.contentRevisions = {
    "policies/unrelated.md": "0".repeat(64)
  };
  await writeFile(grantEntry.path, `${JSON.stringify(grant, null, 2)}\n`, "utf8");
  await writeFile(attestationEntry.path, `${JSON.stringify(attestation, null, 2)}\n`, "utf8");

  const validation = await validateWorkspace(root);
  assert.equal(validation.ok, false);
  assert.ok(validation.diagnostics.some(({ code }) => code === "invalid-completion-order"));
  assert.ok(validation.diagnostics.some(({ code, message }) => (
    code === "invalid-attestation-binding" && message.includes("training-example")
  )));
});

test("creates and updates Markdown content with its resource", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-content-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const policy = {
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

test("binds approvals to exact Markdown revisions and requires reapproval after edits", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-approval-binding-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await createResource(root, {
    id: "policy-bound",
    type: "policy",
    title: "Bound Policy",
    status: "draft",
    ownerIds: ["person-owner"]
  }, {
    content: { content: "# Bound Policy\n\nFirst approved text." }
  });
  const draft = (await loadWorkspace(root)).resources.find(({ id }) => id === "policy-bound");
  const approved = await updateResource(root, "policy", draft.id, {
    ...draft,
    status: "active",
    approverIds: ["person-approver"],
    approvedOn: "2026-08-02",
    effectiveOn: "2026-08-02"
  });
  assert.match(approved.record.approvedContentRevisions["policies/policy-bound.md"], /^[a-f0-9]{64}$/);
  await assert.rejects(
    updateContent(root, "policies/policy-bound.md", "# Bound Policy\n\nUnapproved edit."),
    /Approved content no longer matches/
  );
  assert.match(await readFile(join(root, "data", "policies", "policy-bound.md"), "utf8"), /First approved text/);

  const inReviewRecord = { ...approved.record, status: "in-review" };
  delete inReviewRecord.approvedOn;
  await updateResource(root, "policy", approved.record.id, inReviewRecord, {
    content: { content: "# Bound Policy\n\nReviewed replacement text." }
  });
  const inReview = (await loadWorkspace(root)).resources.find(({ id }) => id === "policy-bound");
  assert.equal(inReview.approvedContentRevisions, undefined);
  const reapproved = await updateResource(root, "policy", inReview.id, {
    ...inReview,
    status: "active",
    approvedOn: "2026-08-03",
    effectiveOn: "2026-08-03"
  });
  assert.notEqual(
    reapproved.record.approvedContentRevisions["policies/policy-bound.md"],
    approved.record.approvedContentRevisions["policies/policy-bound.md"]
  );
});

test("rejects a new Policy approval while detected content blockers remain", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-policy-content-blocker-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await createResource(root, {
    id: "policy-employment",
    type: "policy",
    title: "Employment Policy",
    status: "draft",
    ownerIds: ["person-owner"]
  }, {
    content: {
      content: "# Employment Policy\n\n[Confirm before approval: qualified counsel and jurisdiction-specific reporting routes.]"
    }
  });
  const draft = (await loadWorkspace(root)).resources.find(({ id }) => id === "policy-employment");
  await assert.rejects(updateResource(root, "policy", draft.id, {
    ...draft,
    status: "approved",
    approverIds: ["person-approver"],
    approvedOn: "2026-08-02"
  }), /Cannot approve or activate Employment Policy.*open placeholder/);
  assert.equal((await loadWorkspace(root)).resources.find(({ id }) => id === draft.id).status, "draft");
});

test("binds active training to its effective Markdown revision", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-training-binding-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const workspacePath = join(root, "data", "workspace.json");
  const workspace = JSON.parse(await readFile(workspacePath, "utf8"));
  await writeFile(workspacePath, `${JSON.stringify({ ...workspace, dataModelVersion: "3" }, null, 2)}\n`, "utf8");
  await createResource(root, {
    id: "training-security",
    type: "training",
    title: "Security training",
    status: "draft",
    ownerIds: ["person-owner"]
  }, {
    content: { content: "# Security training\n\nUse strong authentication and report suspected incidents promptly." }
  });
  const draft = (await loadWorkspace(root)).resources.find(({ id }) => id === "training-security");
  const active = await updateResource(root, "training", draft.id, {
    ...draft,
    status: "active",
    effectiveOn: "2026-08-03",
    approvedByIds: ["person-approver"],
    approvedOn: "2026-08-03"
  });
  assert.match(active.record.effectiveContentRevisions["training/training-security.md"], /^[a-f0-9]{64}$/);
  await assert.rejects(
    updateContent(root, "training/training-security.md", "# Security training\n\nUnapproved replacement."),
    /Approved content no longer matches/
  );
});

test("keeps scheduled work separate from completed operating proof", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-completion-integrity-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await createResource(root, {
    id: "vendor-provider",
    type: "vendor",
    title: "Provider",
    status: "active",
    category: "infrastructure",
    criticality: "high",
    ownerIds: ["person-owner"]
  });
  await createResource(root, {
    id: "vendor-review-planned",
    type: "vendor-review",
    title: "Planned provider review",
    status: "planned",
    vendorId: "vendor-provider",
    scheduledFor: "2026-08-15"
  });
  await assert.rejects(
    createResource(root, {
      id: "vendor-review-premature-decision",
      type: "vendor-review",
      title: "Premature decision",
      status: "planned",
      vendorId: "vendor-provider",
      scheduledFor: "2026-08-15",
      decision: "approved"
    }),
    /decision is not allowed/
  );
  await assert.rejects(
    createResource(root, {
      id: "vendor-review-incomplete-proof",
      type: "vendor-review",
      title: "Incomplete provider review",
      status: "complete",
      vendorId: "vendor-provider",
      reviewerIds: ["person-owner"],
      completedOn: "2026-08-15",
      decision: "approved"
    }),
    /Required field "evidenceIds" is missing|Required field "coverage" is missing/
  );
});

test("stores Markdown beside records without path fields", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-companion-markdown-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const policy = {
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
    id: "policy-missing-markdown",
    type: "policy",
    title: "Missing Markdown",
    status: "draft",
    ownerIds: ["person-owner"],
    approverIds: ["person-approver"]
  };
  await assert.rejects(createResource(root, policy), /Required Policy Markdown is missing/);

  const evidence = {
    id: "evidence-companion",
    type: "evidence",
    title: "Markdown Evidence",
    status: "collected",
    artifactKind: "business-record",
    artifactSubtype: "narrative",
    sourceKind: "authored-record",
    sourceDescription: "Program owner",
    collectedOn: "2026-07-25",
    classificationId: "internal",
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
    id: "evidence-access-collection-test",
    type: "evidence",
    title: "Access report export",
    status: "draft",
    artifactKind: "system-export",
    artifactSubtype: "access-export",
    sourceKind: "system"
  };
  await createResource(root, draft);
  assert.equal((await validateWorkspace(root)).ok, true);
  await assert.rejects(
    updateResource(root, "evidence", draft.id, { ...draft, status: "collected" }),
    /Required field "sourceDescription" is missing/
  );
  assert.equal((await loadWorkspace(root)).resources.find(({ id }) => id === draft.id).status, "draft");
});

test("stores common Record Markdown for result-bearing resources", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-record-markdown-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const finding = {
    id: "finding-review-delay",
    type: "finding",
    title: "Review completed late",
    status: "open",
    severity: "medium",
    sourceResourceId: "finding-review-delay",
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
    id: "framework-control-test",
    type: "framework",
    title: "Control test framework",
    status: "active",
    version: "1"
  });
  await createResource(root, {
    id: "requirement-control-test",
    type: "requirement",
    title: "Control test requirement",
    frameworkId: "framework-control-test",
    reference: "TEST1",
    applicability: "applicable"
  });
  await createResource(root, {
    id: "system-control-test",
    type: "system",
    title: "Control test system",
    status: "active",
    criticality: "high",
    ownerIds: ["person-owner"]
  });
  const control = {
    id: "control-procedure-test",
    type: "control",
    title: "Procedure test control",
    status: "implemented",
    statement: "Management performs the test control.",
    ownerIds: ["person-owner"],
    requirementIds: ["requirement-control-test"],
    activity: "Perform and document the control.",
    operationMode: "manual",
    operationPattern: "continuous",
    systemIds: ["system-control-test"],
    evidenceSourceIds: ["system-control-test"],
    effectiveOn: "2026-07-01"
  };
  await assert.rejects(createResource(root, control), /Required Procedure Markdown is missing/);
  await createResource(root, control, {
    content: {
      record: "# Procedure test control\n\nThe owner performs the control and keeps the dated result."
    }
  });
  assert.equal((await validateWorkspace(root)).ok, true);

  const policy = {
    id: "policy-procedure-test",
    type: "policy",
    title: "Procedure test policy",
    status: "draft",
    ownerIds: ["person-owner"],
    approverIds: ["person-approver"]
  };
  await createResource(root, policy, {
    content: {
      content: "# Procedure test policy\n\nThe owner completes and records the scheduled control."
    }
  });
  await updateResource(root, "control", control.id, {
    ...control,
    policyIds: [policy.id]
  });
  assert.equal((await validateWorkspace(root)).ok, true);
  const obligation = {
    id: "obligation-procedure-test",
    type: "obligation",
    title: "Run the procedure test",
    status: "active",
    activityType: "inventory-review",
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
  await updateResource(root, "policy", policy.id, {
    ...policy,
    status: "approved",
    approvedOn: "2026-07-01"
  });
  await createResource(root, obligation);
  await updateResource(root, "control", control.id, { ...control, policyIds: [policy.id], status: "planned" });
  await updateResource(root, "control", control.id, { ...control, policyIds: [policy.id] });
  assert.equal(
    (await loadWorkspace(root)).resources.find(({ id }) => id === control.id).status,
    "implemented"
  );
  await assert.rejects(
    updateResource(root, "obligation", obligation.id, {
      ...obligation,
      status: "paused",
      statusTransition: {
        changedByIds: ["person-owner"],
        changedOn: "2026-07-01",
        reason: "Management paused the schedule."
      }
    }),
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
    id: "team-owner-reviewers",
    type: "team",
    title: "Owner reviewers",
    status: "active",
    purpose: "Review governed documents.",
    memberIds: ["person-owner"]
  });
  await assert.rejects(createResource(root, {
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
    id: "person-reviewer",
    type: "person",
    affiliation: "internal",
    title: "Alex Reviewer",
    status: "active"
  });
  const policy = {
    id: "policy-internal-approver",
    type: "policy",
    title: "Internal approver",
    status: "approved",
    ownerIds: ["person-owner"],
    approverIds: ["person-reviewer"],
    approvedOn: "2026-08-02"
  };
  await createResource(root, policy, { content: { content: "# Internal approver" } });
  assert.equal((await validateWorkspace(root)).ok, true);
});

test("does not count an empty array as a one-of value", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-empty-choice-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await assert.rejects(createResource(root, {
    id: "evidence-empty",
    type: "evidence",
    title: "Empty evidence",
    status: "collected",
    artifactKind: "capture",
    artifactSubtype: "screenshot",
    sourceKind: "file",
    sourceDescription: "Manual capture",
    collectedOn: "2026-07-25",
    classificationId: "internal",
    collectorIds: ["person-owner"],
    filePaths: []
  }), /Required field "filePaths" is missing/i);
});

test("serializes concurrent writes and rejects stale deletion", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-concurrent-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const person = {
    id: "person-concurrent",
    type: "person",
    affiliation: "internal",
    title: "Concurrent editor",
    status: "active"
  };
  await createResource(root, person);
  const initialEntry = (await createAppState(root)).resources.find(({ record }) => record.id === person.id);
  const results = await Promise.allSettled([
    updateResource(root, person.type, person.id, { ...person, department: "First edit" }, { expectedRevision: initialEntry.revision }),
    updateResource(root, person.type, person.id, { ...person, department: "Second edit" }, { expectedRevision: initialEntry.revision })
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
    id: "evidence-json-export",
    type: "evidence",
    title: "JSON event export",
    status: "collected",
    artifactKind: "system-export",
    sourceKind: "file",
    sourceDescription: "Source system",
    collectedOn: "2026-07-25",
    classificationId: "internal",
    collectorIds: ["person-owner"],
    filePaths: ["evidence/evidence-json-export/export.json"]
  });
  const validation = await validateWorkspace(root);
  assert.equal(validation.ok, true);
  assert.equal(validation.counts.resources, 4);
});
