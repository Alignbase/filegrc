import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import test from "node:test";
import { runCli } from "../src/cli.js";
import {
  activateDocuments,
  applyResourceBatch,
  assessAuditDocumentActivations,
  assessProgramReadiness,
  assessWorkflow,
  loadWorkspace,
  scaffoldDocumentActivation,
  updateResource,
  validateWorkspace
} from "../src/index.js";
import { makeComprehensiveWorkspace } from "./fixtures.js";
import { executeCli, writeJson } from "./helpers.js";

const execute = (executable, args) => executeCli(runCli, executable, args);
const cli = fileURLToPath(new URL("../bin/filegrc.js", import.meta.url));

test("keeps governed Document approval and activation as separate lifecycle events", async (context) => {
  const root = await mkdtemp(`${tmpdir()}/filegrc-document-activation-`);
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "5");

  let loaded = await loadWorkspace(root);
  const activeDocument = loaded.resources.find(({ type, documentKind }) => (
    type === "document" && documentKind !== "soc2-engagement-terms"
  ));
  const draftDocument = {
    ...activeDocument,
    status: "draft",
    programRole: "required",
    proposedEffectiveOn: "2026-09-01"
  };
  delete draftDocument.approverIds;
  delete draftDocument.approvedOn;
  delete draftDocument.effectiveOn;
  delete draftDocument.activationBasis;
  delete draftDocument.activatedOn;
  delete draftDocument.activatedByIds;
  delete draftDocument.approvedContentRevisions;
  delete draftDocument.activatedContentRevisions;
  await updateResource(root, "document", activeDocument.id, draftDocument);

  let readiness = await assessProgramReadiness(root, { asOf: "2026-08-20" });
  const approvalItem = readiness.stages
    .find(({ id }) => id === "policies")
    .items.find(({ id }) => id === `document-approval-${activeDocument.id}`);
  assert.equal(approvalItem.status, "action");
  assert.equal(readiness.documentActivations.find(({ documentId }) => documentId === activeDocument.id).state, "approval-pending");

  await assert.rejects(
    updateResource(root, "document", activeDocument.id, {
      ...draftDocument,
      status: "active",
      approverIds: ["person-independent-approver-example"],
      approvedOn: "2026-08-19",
      activatedOn: "2026-08-20",
      effectiveOn: "2026-08-20"
    }),
    /must use the dedicated Step 3 Document activation operation after approval/
  );

  const approval = await updateResource(root, "document", activeDocument.id, {
    ...draftDocument,
    status: "approved",
    approverIds: ["person-independent-approver-example"],
    approvedOn: "2026-08-19"
  });
  assert.ok(Object.keys(approval.record.approvedContentRevisions).length);
  assert.equal(approval.record.activatedOn, undefined);
  assert.equal(approval.record.activatedContentRevisions, undefined);

  await assert.rejects(
    applyResourceBatch(root, {
      update: [{
        ...approval.record,
        status: "active",
        activationBasis: "recorded",
        activatedByIds: ["person-example"],
        activatedOn: "2026-08-20",
        effectiveOn: "2026-08-20",
        activatedContentRevisions: structuredClone(approval.record.approvedContentRevisions)
      }],
      validateWholeWorkspace: true,
      lifecycleOperation: "document-activation"
    }),
    /must use the dedicated Step 3 Document activation operation after approval/
  );

  await assert.rejects(
    updateResource(root, "document", activeDocument.id, {
      ...approval.record,
      status: "active",
      activatedOn: "2026-08-20",
      effectiveOn: "2026-08-20"
    }),
    /must use the dedicated Step 3 Document activation operation after approval/
  );

  readiness = await assessProgramReadiness(root, { asOf: "2026-08-20" });
  assert.equal(
    readiness.stages.find(({ id }) => id === "policies").items
      .find(({ id }) => id === `document-approval-${activeDocument.id}`).status,
    "complete"
  );
  const readyAssessment = readiness.documentActivations.find(({ documentId }) => documentId === activeDocument.id);
  assert.equal(readyAssessment.state, "ready-to-activate");
  assert.equal(readyAssessment.gapCount, 0);

  const staleOwnership = await loadWorkspace(root);
  staleOwnership.resources.find(({ id }) => id === "person-example").status = "inactive";
  const staleReadiness = await assessProgramReadiness(staleOwnership, { asOf: "2026-08-20" });
  const staleAssessment = staleReadiness.documentActivations.find(({ documentId }) => documentId === activeDocument.id);
  assert.equal(staleAssessment.state, "approved-implementation-pending");
  assert.equal(staleAssessment.gapCount, 1);
  assert.equal(
    staleReadiness.stages.find(({ id }) => id === "controls").items
      .find(({ id }) => id === `document-${activeDocument.id}`).checks.owner,
    false
  );

  const scaffold = await scaffoldDocumentActivation(root);
  assert.ok(scaffold.documentIds.includes(activeDocument.id));
  scaffold.activatedByIds = ["person-example"];
  const result = await activateDocuments(root, { ...scaffold, confirmed: true });
  assert.ok(result.documentIds.includes(activeDocument.id));

  loaded = await loadWorkspace(root);
  const activated = loaded.resources.find(({ id }) => id === activeDocument.id);
  assert.equal(activated.status, "active");
  assert.equal(activated.activationBasis, "recorded");
  assert.deepEqual(activated.activatedByIds, ["person-example"]);
  assert.equal(activated.approvedOn, "2026-08-19");
  assert.equal(activated.activatedOn, scaffold.activatedOn);
  assert.equal(activated.effectiveOn, scaffold.effectiveOn);
  assert.deepEqual(activated.activatedContentRevisions, activated.approvedContentRevisions);
  assert.notStrictEqual(activated.activatedContentRevisions, activated.approvedContentRevisions);
  await assert.rejects(
    updateResource(root, "document", activated.id, { ...activated, activatedOn: "2026-08-19" }),
    /activation facts are immutable after the event: activatedOn/
  );

  readiness = await assessProgramReadiness(root, { asOf: scaffold.effectiveOn });
  assert.equal(readiness.documentActivations.find(({ documentId }) => documentId === activeDocument.id).state, "active-and-operating");
  assert.equal(
    readiness.stages.find(({ id }) => id === "controls").items
      .find(({ id }) => id === `document-${activeDocument.id}`).status,
    "complete"
  );
  const workflow = await assessWorkflow(root, { asOf: scaffold.effectiveOn });
  assert.equal(workflow.assessments.documentActivation.status, "complete");

  const incompleteLoaded = await loadWorkspace(root);
  const incompleteDocument = incompleteLoaded.resources.find(({ id }) => id === activeDocument.id);
  delete incompleteDocument.activatedByIds;
  const incompleteReadiness = await assessProgramReadiness(incompleteLoaded, { asOf: scaffold.effectiveOn });
  assert.equal(
    incompleteReadiness.documentActivations.find(({ documentId }) => documentId === activeDocument.id).state,
    "active-with-gaps"
  );
  incompleteDocument.activatedByIds = ["person-example"];
  incompleteDocument.activatedContentRevisions = { "documents/document-example.md": "0".repeat(64) };
  const changedRevisionReadiness = await assessProgramReadiness(incompleteLoaded, { asOf: scaffold.effectiveOn });
  assert.equal(
    changedRevisionReadiness.stages.find(({ id }) => id === "controls").items
      .find(({ id }) => id === `document-${activeDocument.id}`).checks.activationMatchesApproval,
    false
  );
});

test("does not activate an approved governed Document before its linked Controls are implemented", async (context) => {
  const root = await mkdtemp(`${tmpdir()}/filegrc-document-implementation-`);
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "5");
  let loaded = await loadWorkspace(root);
  const document = loaded.resources.find(({ type }) => type === "document");
  const control = loaded.resources.find(({ id }) => id === document.controlIds[0]);
  await updateResource(root, "control", control.id, { ...control, status: "partially-implemented" });

  loaded = await loadWorkspace(root);
  const currentDocument = loaded.resources.find(({ id }) => id === document.id);
  const approved = {
    ...currentDocument,
    status: "approved",
    programRole: "required",
    proposedEffectiveOn: currentDocument.effectiveOn
  };
  delete approved.effectiveOn;
  delete approved.activationBasis;
  delete approved.activatedOn;
  delete approved.activatedByIds;
  delete approved.activatedContentRevisions;
  await updateResource(root, "document", document.id, approved);

  const readiness = await assessProgramReadiness(root, { asOf: "2026-08-20" });
  const assessment = readiness.documentActivations.find(({ documentId }) => documentId === document.id);
  assert.equal(assessment.state, "approved-implementation-pending");
  assert.deepEqual(assessment.missingImplementationControlIds, [control.id]);
  const scaffold = await scaffoldDocumentActivation(root);
  assert.equal(scaffold.documentIds.includes(document.id), false);
});

test("keeps audit-specific Document approval and activation as separate Step 5 updates", async (context) => {
  const root = await mkdtemp(`${tmpdir()}/filegrc-audit-document-activation-`);
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "5");
  const loaded = await loadWorkspace(root);
  const sourceDocument = loaded.resources.find(({ type }) => type === "document");
  const audit = loaded.resources.find(({ type }) => type === "audit");
  const draft = {
    ...sourceDocument,
    status: "draft",
    documentKind: "soc2-engagement-terms",
    workflowScope: "engagement",
    template: false
  };
  delete draft.programRole;
  delete draft.approvedOn;
  delete draft.approvedContentRevisions;
  delete draft.activationBasis;
  delete draft.activatedOn;
  delete draft.activatedByIds;
  delete draft.activatedContentRevisions;
  delete draft.effectiveOn;
  await applyResourceBatch(root, {
    update: [draft, { ...audit, engagementTermsDocumentId: draft.id }],
    validateWholeWorkspace: true
  });

  await assert.rejects(
    updateResource(root, "document", draft.id, {
      ...draft,
      status: "active",
      approvedOn: "2026-08-19",
      activationBasis: "recorded",
      activatedByIds: ["person-example"],
      activatedOn: "2026-08-20",
      effectiveOn: "2026-08-20"
    }),
    /must use the dedicated Step 5 Document activation operation after approval/
  );

  const approval = await updateResource(root, "document", draft.id, {
    ...draft,
    status: "approved",
    approvedOn: "2026-08-19"
  });
  assert.ok(Object.keys(approval.record.approvedContentRevisions).length);
  assert.equal(approval.record.activatedContentRevisions, undefined);

  await assert.rejects(
    updateResource(root, "document", draft.id, {
      ...approval.record,
      status: "active",
      activationBasis: "recorded",
      activatedByIds: ["person-example"],
      activatedOn: "2026-08-20",
      effectiveOn: "2026-08-20"
    }),
    /must use the dedicated Step 5 Document activation operation after approval/
  );

  const assessments = await assessAuditDocumentActivations(root, { auditId: audit.id, asOf: "2026-08-20" });
  assert.equal(assessments.find(({ documentId }) => documentId === draft.id).state, "ready-to-activate");
  const cliScaffold = JSON.parse((await execute(process.execPath, [
    cli,
    "activate-documents",
    "--scaffold",
    "--audit",
    audit.id,
    "--root",
    root
  ])).stdout);
  assert.equal(cliScaffold.auditId, audit.id);
  assert.ok(cliScaffold.documentIds.includes(draft.id));
  const scaffold = await scaffoldDocumentActivation(root, { auditId: audit.id });
  assert.equal(scaffold.auditId, audit.id);
  assert.equal(scaffold.workflowScope, "engagement");
  assert.ok(scaffold.documentIds.includes(draft.id));
  await assert.rejects(
    activateDocuments(root, { ...scaffold, activatedByIds: ["person-missing"], confirmed: true }),
    /needs active People as activators: person-missing/
  );
  const activation = await activateDocuments(root, {
    ...scaffold,
    activatedByIds: ["person-example"],
    confirmed: true
  });
  assert.equal(activation.auditId, audit.id);
  const current = (await loadWorkspace(root)).resources.find(({ id }) => id === draft.id);
  assert.equal(current.approvedOn, "2026-08-19");
  assert.equal(current.activatedOn, scaffold.activatedOn);
  assert.deepEqual(current.activatedContentRevisions, current.approvedContentRevisions);
  const premature = await assessAuditDocumentActivations(root, { auditId: audit.id, asOf: "2026-08-19" });
  const prematureAssessment = premature.find(({ documentId }) => documentId === draft.id);
  assert.equal(prematureAssessment.state, "active-with-gaps");
  assert.ok(prematureAssessment.gapCount > 0);
  assert.ok(prematureAssessment.issues.some((issue) => issue.includes("activation date")));
});

test("rejects program Documents in governed Audit fields", async (context) => {
  const root = await mkdtemp(`${tmpdir()}/filegrc-document-scope-audit-`);
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "5");
  const loaded = await loadWorkspace(root);
  const auditEntry = loaded.entries.find(({ record }) => record.type === "audit");
  const document = loaded.resources.find(({ type }) => type === "document");
  await writeJson(auditEntry.path, { ...auditEntry.record, engagementTermsDocumentId: document.id });
  const validation = await validateWorkspace(root);
  assert.equal(validation.ok, false);
  assert.ok(validation.diagnostics.some(({ code }) => code === "invalid-document-workflow-scope"));
  assert.ok(validation.diagnostics.some(({ code }) => code === "program-document-in-engagement-workflow"));
});

test("rejects engagement Documents that govern reusable program work", async (context) => {
  const root = await mkdtemp(`${tmpdir()}/filegrc-document-scope-program-`);
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "5");
  const loaded = await loadWorkspace(root);
  const auditEntry = loaded.entries.find(({ record }) => record.type === "audit");
  const documentEntry = loaded.entries.find(({ record }) => record.type === "document");
  const policyEntry = loaded.entries.find(({ record }) => record.type === "policy");
  const document = { ...documentEntry.record, workflowScope: "engagement", documentKind: "soc2-engagement-terms" };
  delete document.programRole;
  await writeJson(documentEntry.path, document);
  await writeJson(auditEntry.path, { ...auditEntry.record, engagementTermsDocumentId: document.id });
  await writeJson(policyEntry.path, { ...policyEntry.record, relatedDocumentIds: [document.id] });
  const validation = await validateWorkspace(root);
  assert.equal(validation.ok, false);
  assert.ok(validation.diagnostics.some(({ code }) => code === "engagement-document-in-program-workflow"));
  assert.equal(validation.diagnostics.some(({ code }) => code === "invalid-engagement-document-audit-count"), false);
});
