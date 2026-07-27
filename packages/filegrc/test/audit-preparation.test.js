import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  assessAuditPreparation,
  createResource,
  loadModel,
  loadWorkspace,
  prepareAuditWorkspace,
  prepareEvidencePacket,
  serveWorkspace
} from "../src/index.js";
import { makeWorkspace } from "./helpers.js";

const execute = promisify(execFile);

test("initializes model-owned Type 2 populations and management document links", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-audit-preparation-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await createResource(root, {
    schemaVersion: 1,
    id: "framework-security",
    type: "framework",
    title: "Security criteria",
    status: "active",
    version: "2022"
  });
  for (const definition of loadModel().auditReadiness.managementDocuments) {
    await createResource(root, {
      schemaVersion: 1,
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
    schemaVersion: 1,
    id: "audit-type-2",
    type: "audit",
    title: "Type 2 engagement",
    status: "planned",
    auditKind: "soc-2-type-2",
    frameworkIds: ["framework-security"],
    scope: "Production service",
    ownerIds: ["person-owner"],
    periodStart: "2026-01-01",
    periodEnd: "2026-06-30"
  });

  const before = await assessAuditPreparation(root, { auditId: "audit-type-2" });
  assert.equal(before.canInitialize, true);
  assert.equal(before.stages.find(({ id }) => id === "populations").counts.action, 10);
  assert.equal(before.stages.find(({ id }) => id === "populations").title, "Population Completeness");
  assert.equal(before.stages.find(({ id }) => id === "auditor").title, "Auditor-Owned Work");

  const result = await prepareAuditWorkspace(root, { auditId: "audit-type-2" });
  assert.equal(result.linkedDocumentIds.length, 4);
  assert.equal(result.createdPopulationIds.length, 10);

  const loaded = await loadWorkspace(root);
  const audit = loaded.resources.find(({ id }) => id === "audit-type-2");
  assert.equal(result.createdDocumentIds.length, 4);
  assert.equal(audit.systemDescriptionDocumentId, "document-audit-type-2-soc2-system-description");
  assert.equal(audit.managementAssertionDocumentId, "document-audit-type-2-soc2-management-assertion");
  assert.equal(audit.periodCompletenessDocumentId, "document-audit-type-2-soc2-period-completeness");
  assert.equal(audit.managementRepresentationDocumentId, "document-audit-type-2-soc2-management-representation");
  assert.ok(result.createdDocumentIds.every((id) => loaded.resources.find((record) => record.id === id)?.template !== true));
  const populations = loaded.resources.filter((record) => record.type === "audit-population");
  assert.equal(populations.length, 10);
  assert.deepEqual(
    populations.map(({ populationKind }) => populationKind).sort(),
    loadModel().auditReadiness.populationTemplates.map(({ kind }) => kind).sort()
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
  const after = await assessAuditPreparation(root, { auditId: "audit-type-2" });
  assert.equal(after.canInitialize, false);
  assert.equal(after.stages.find(({ id }) => id === "populations").counts.action, 10);

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
  assert.equal(cliResult.stages.find(({ id }) => id === "populations").items.length, 10);

  await createResource(root, {
    schemaVersion: 1,
    id: "audit-type-1",
    type: "audit",
    title: "Type 1 engagement",
    status: "planned",
    auditKind: "soc-2-type-1",
    frameworkIds: ["framework-security"],
    scope: "Production service",
    ownerIds: ["person-owner"],
    typeOneAsOf: "2026-07-31"
  });
  const typeOneBefore = await assessAuditPreparation(root, { auditId: "audit-type-1" });
  assert.equal(typeOneBefore.stages.find(({ id }) => id === "populations").counts.action, 0);
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
