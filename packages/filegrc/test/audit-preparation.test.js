import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCli } from "../src/cli.js";
import {
  assessAuditPreparation,
  createAppState,
  createResource,
  loadModel,
  loadWorkspace,
  prepareAuditWorkspace,
  prepareEvidencePacket,
  serveWorkspace,
  updateResource
} from "../src/index.js";
import { executeCli, makeWorkspace, writeJson } from "./helpers.js";

const execute = (executable, args) => executeCli(runCli, executable, args);

test("initializes model-owned Type 2 populations and management document links", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-audit-preparation-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await createResource(root, {
    id: "framework-security",
    type: "framework",
    title: "Security criteria",
    status: "active",
    version: "2022"
  });
  await createResource(root, {
    id: "requirement-access",
    type: "requirement",
    title: "Access criterion",
    frameworkId: "framework-security",
    reference: "TEST-ACCESS",
    applicability: "applicable"
  });
  await createResource(root, {
    id: "control-access",
    type: "control",
    title: "Access approval",
    status: "planned",
    code: "IAM-01",
    statement: "Approve access before it is granted.",
    ownerIds: ["person-owner"],
    requirementIds: ["requirement-access"],
    activity: "Review and approve each access request.",
    operationMode: "manual",
    operationPattern: "event-driven"
  });
  for (const definition of loadModel().auditReadiness.managementDocuments) {
    await createResource(root, {
      id: `document-${definition.kind}`,
      type: "document",
      title: definition.title,
      status: "draft",
      documentKind: definition.kind,
      template: true,
      ownerIds: ["person-owner"],
      approverIds: ["person-approver"]
    }, {
      content: { content: `# ${definition.title}\n\n[Complete for the engagement.]` }
    });
  }
  await createResource(root, {
    id: "audit-type-2",
    type: "audit",
    title: "Type 2 engagement",
    status: "planned",
    auditKind: "soc-2-type-2",
    frameworkIds: ["framework-security"],
    scope: "Production service",
    ownerIds: ["person-owner"],
    controlIds: ["control-access"],
    coverage: { kind: "range", startsOn: "2026-01-01", endsOn: "2026-06-30" },
  });
  await createResource(root, {
    id: "obligation-quarterly-access-review",
    type: "obligation",
    title: "Quarterly access review",
    status: "active",
    activityType: "access-review",
    recurrence: { mode: "calendar", unit: "month", interval: 3, anchorDate: "2026-01-01" },
    controlIds: ["control-access"],
    ownerIds: ["person-owner"],
    completionResourceIds: []
  });
  const injectedReadiness = {
      asOf: "2026-06-30",
      dataModelVersion: "6",
      evidenceReady: true,
      operating: true,
      target: { label: "SOC 2 Type 2" },
      counts: { action: 0 }
  };
  const missedOccurrence = await assessAuditPreparation(await loadWorkspace(root), {
    auditId: "audit-type-2",
    programReadiness: injectedReadiness
  });
  const occurrenceItem = missedOccurrence.stages.find(({ id }) => id === "fieldwork").items
    .find(({ id }) => id === "occurrences-period-occurrences");
  assert.equal(occurrenceItem.status, "action");
  assert.equal(missedOccurrence.status, "needs-work");
  await createResource(root, {
    id: "action-unrelated-follow-up",
    type: "action-item",
    title: "Unrelated follow-up",
    status: "open",
    assigneeIds: ["person-owner"],
    sourceResourceId: "control-access",
    completionWindow: {
      precision: "date",
      startsOn: "2025-12-01",
      dueOn: "2025-12-15",
      overdueOn: "2025-12-16"
    }
  });
  const withStandaloneFollowUp = await assessAuditPreparation(root, {
    auditId: "audit-type-2",
    programReadiness: injectedReadiness
  });
  assert.equal(
    withStandaloneFollowUp.stages.find(({ id }) => id === "fieldwork").items
      .find(({ id }) => id === "occurrences-period-occurrences").message,
    occurrenceItem.message
  );

  const directPreparation = await assessAuditPreparation(root, {
    auditId: "audit-type-2",
    asOf: "2026-08-22"
  });
  const browserState = await createAppState(root, { asOf: "2026-08-22" });
  const { generatedAt: directGeneratedAt, ...directComparable } = directPreparation;
  const { generatedAt: stateGeneratedAt, ...stateComparable } = browserState.auditPreparations["audit-type-2"];
  assert.ok(directGeneratedAt);
  assert.ok(stateGeneratedAt);
  assert.deepEqual(stateComparable, directComparable);

  const before = await assessAuditPreparation(root, { auditId: "audit-type-2" });
  assert.equal(before.canInitialize, true);
  const engagementOwner = before.stages
    .find(({ id }) => id === "engagement")
    .items.find(({ id }) => id === "engagement-owner");
  assert.equal(engagementOwner.status, "complete");
  assert.doesNotMatch(engagementOwner.message, /Executive Sponsor|Evidence and Audit Liaison/);
  assert.equal(
    before.stages.find(({ id }) => id === "fieldwork").items.filter(({ section }) => section === "Population Completeness").length,
    1
  );
  assert.equal(before.stages.find(({ id }) => id === "fieldwork").title, "Prepare Fieldwork");
  const auditEvidenceItems = before.stages.find(({ id }) => id === "fieldwork").items
    .filter(({ section }) => section === "Audit Evidence");
  assert.equal(auditEvidenceItems.some(({ id, title }) => id === "evidence-filegrc-evidence" && title === "Review filegrc Evidence"), true);
  assert.equal(auditEvidenceItems.some(({ id, title }) => id === "evidence-external-evidence" && title === "Review Evidence Artifacts"), true);
  assert.equal(before.stages.find(({ id }) => id === "auditor").title, "Fieldwork and Report");

  const result = await prepareAuditWorkspace(root, { auditId: "audit-type-2" });
  assert.equal(result.linkedDocumentIds.length, 4);
  assert.equal(result.createdPopulationIds.length, 1);

  const loaded = await loadWorkspace(root);
  const audit = loaded.resources.find(({ id }) => id === "audit-type-2");
  assert.equal(result.createdDocumentIds.length, 4);
  assert.equal(audit.systemDescriptionDocumentId, "document-audit-type-2-soc2-system-description");
  assert.equal(audit.managementAssertionDocumentId, "document-audit-type-2-soc2-management-assertion");
  assert.equal(audit.periodCompletenessDocumentId, "document-audit-type-2-soc2-period-completeness");
  assert.equal(audit.managementRepresentationDocumentId, "document-audit-type-2-soc2-management-representation");
  assert.ok(result.createdDocumentIds.every((id) => loaded.resources.find((record) => record.id === id)?.template !== true));
  const populations = loaded.resources.filter((record) => record.type === "audit-population");
  assert.equal(populations.length, 1);
  assert.deepEqual(
    populations.map(({ populationKind }) => populationKind).sort(),
    ["access-changes"]
  );
  assert.ok(populations.every((record) => (
    record.status === "planned"
    && record.auditId === audit.id
    && record.periodStart === audit.periodStart
    && record.periodEnd === audit.periodEnd
  )));

  const second = await prepareAuditWorkspace(root, { auditId: "audit-type-2" });
  assert.deepEqual(second.linkedDocumentIds, []);
  assert.deepEqual(second.createdDocumentIds, []);
  assert.deepEqual(second.createdPopulationIds, []);
  const controlBeforeRename = loaded.resources.find(({ id }) => id === "control-access");
  await updateResource(root, "control", controlBeforeRename.id, { ...controlBeforeRename, code: "CUSTOM-ACCESS" });
  const customControlPreparation = await assessAuditPreparation(root, {
    auditId: "audit-type-2",
    programReadiness: injectedReadiness
  });
  assert.equal(
    customControlPreparation.stages.find(({ id }) => id === "fieldwork").items
      .filter(({ section }) => section === "Population Completeness").length,
    loadModel("7").auditReadiness.populationTemplates.length
  );
  await updateResource(root, "control", controlBeforeRename.id, controlBeforeRename);
  const after = await assessAuditPreparation(root, { auditId: "audit-type-2" });
  assert.equal(after.canInitialize, false);
  assert.equal(
    after.stages.find(({ id }) => id === "fieldwork").items.filter(({ section, status }) => section === "Population Completeness" && status === "later").length,
    1
  );

  const cli = await execute(process.execPath, [
    new URL("../bin/filegrc.js", import.meta.url).pathname,
    "audit-readiness",
    "audit-type-2",
    "--root",
    root,
    "--json"
  ]);
  const cliResult = JSON.parse(cli.stdout);
  assert.equal(cliResult.audit.id, audit.id);
  assert.equal(
    cliResult.stages.find(({ id }) => id === "fieldwork").items.filter(({ section }) => section === "Population Completeness").length,
    1
  );

  const typeTwo = (await loadWorkspace(root)).resources.find(({ id }) => id === "audit-type-2");
  const typeTwoPath = join(root, "data", "audits", `${typeTwo.id}.json`);
  await writeJson(typeTwoPath, { ...typeTwo, status: "report-draft" });
  const reportDraft = await assessAuditPreparation(root, { auditId: typeTwo.id });
  assert.equal(
    reportDraft.stages.find(({ id }) => id === "fieldwork").items
      .find(({ title }) => title === "Management Representation Letter").status,
    "later"
  );
  await writeJson(typeTwoPath, typeTwo);

  await createResource(root, {
    id: "audit-type-1",
    type: "audit",
    title: "Type 1 engagement",
    status: "planned",
    auditKind: "soc-2-type-1",
    frameworkIds: ["framework-security"],
    scope: "Production service",
    ownerIds: ["person-owner"],
    coverage: { kind: "as-of", on: "2026-07-31" }
  });
  const typeOneBefore = await assessAuditPreparation(root, { auditId: "audit-type-1" });
  assert.equal(
    typeOneBefore.stages.find(({ id }) => id === "fieldwork").items.filter(({ section, status }) => section === "Population Completeness" && status === "action").length,
    0
  );
  const typeOneResult = await prepareAuditWorkspace(root, { auditId: "audit-type-1" });
  assert.equal(typeOneResult.linkedDocumentIds.length, 3);
  assert.equal(typeOneResult.createdDocumentIds.length, 3);
  assert.equal(typeOneResult.createdPopulationIds.length, 0);
  const typeOnePacket = await prepareEvidencePacket(root, { auditId: "audit-type-1" });
  assert.deepEqual(typeOnePacket.period, {
    start: "2026-07-31",
    end: "2026-07-31",
    basis: "as-of"
  });
  assert.equal(typeOnePacket.populations.length, 0);
  assert.equal(typeOnePacket.obligations.length, 0);
  assert.equal(typeOnePacket.gaps.some(({ code }) => code === "not-type-2-audit"), false);
  assert.equal(typeOnePacket.gaps.some(({ code }) => code === "missing-audit-population"), false);

  const server = await serveWorkspace(root, { port: 0 });
  try {
    const response = await fetch(`${server.url}/api/audit-preparation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ auditId: "audit-type-1" })
    });
    assert.equal(response.status, 201);
    assert.deepEqual((await response.json()).createdPopulationIds, []);
  } finally {
    await new Promise((resolve) => server.server.close(resolve));
  }
});

test("keeps future Type 2 occurrence work in a later state", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-future-audit-occurrences-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await createResource(root, {
    id: "framework-future-security",
    type: "framework",
    title: "Future security criteria",
    status: "active",
    version: "2022"
  });
  await createResource(root, {
    id: "audit-future-type-2",
    type: "audit",
    title: "Future Type 2 engagement",
    status: "planned",
    auditKind: "soc-2-type-2",
    frameworkIds: ["framework-future-security"],
    scope: "Production service",
    ownerIds: ["person-owner"],
    controlIds: [],
    coverage: { kind: "range", startsOn: "2027-01-01", endsOn: "2027-06-30" }
  });

  const preparation = await assessAuditPreparation(root, {
    auditId: "audit-future-type-2",
    asOf: "2026-08-22",
    programReadiness: {
      asOf: "2026-08-22",
      dataModelVersion: "7",
      evidenceReady: true,
      operating: true,
      target: { label: "SOC 2 Type 2" },
      counts: { action: 0 }
    }
  });
  const occurrence = preparation.stages.find(({ id }) => id === "fieldwork").items
    .find(({ id }) => id === "occurrences-period-not-started");
  assert.equal(occurrence.status, "later");
  assert.match(occurrence.message, /starts on 2027-01-01/);
  const cliPreparation = JSON.parse((await execute(process.execPath, [
    new URL("../bin/filegrc.js", import.meta.url).pathname,
    "audit-readiness",
    "audit-future-type-2",
    "--root",
    root,
    "--as-of",
    "2026-08-22",
    "--json"
  ])).stdout);
  assert.equal(
    cliPreparation.stages.find(({ id }) => id === "fieldwork").items
      .find(({ id }) => id === "occurrences-period-not-started").status,
    "later"
  );
});
