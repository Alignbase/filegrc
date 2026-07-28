import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  createObligationEvent,
  createResource,
  createResources,
  generateEvidencePacket,
  getGitSummary,
  loadModel,
  loadWorkspace,
  prepareEvidencePacket,
  serveWorkspace,
  updateResource,
  writeEvidencePacket
} from "../src/index.js";
import { serializeWorkspaceMutation } from "../src/mutation.js";
import { makeWorkspace } from "./helpers.js";

const execute = promisify(execFile);

test("waits for workspace writes before generating a packet", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-serialized-packet-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  let release;
  let started;
  const entered = new Promise((resolve) => { started = resolve; });
  const blocker = serializeWorkspaceMutation(root, async () => {
    started();
    await new Promise((resolve) => { release = resolve; });
  });
  await entered;
  let settled = false;
  const generated = generateEvidencePacket(root, {
    start: "2026-01-01",
    end: "2026-01-31",
    output: ".filegrc/serialized-packet"
  }).finally(() => { settled = true; });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(settled, false);
  release();
  await blocker;
  const result = await generated;
  assert.equal(result.packet.period.start, "2026-01-01");
  await access(join(result.output, "manifest.json"));
});

test("derives complementary controls from their related controls", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-complementary-controls-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await createResources(root, [
    {
      schemaVersion: 1,
      id: "framework-security",
      type: "framework",
      title: "Security criteria",
      status: "active",
      version: "1"
    },
    {
      schemaVersion: 1,
      id: "requirement-security",
      type: "requirement",
      title: "Security requirement",
      frameworkId: "framework-security",
      reference: "SEC1",
      applicability: "applicable"
    },
    {
      schemaVersion: 1,
      id: "system-service",
      type: "system",
      title: "Customer service",
      status: "active",
      criticality: "high",
      ownerIds: ["person-owner"],
      inScope: true
    },
    {
      schemaVersion: 1,
      id: "control-customer-access",
      type: "control",
      title: "Customer access administration",
      status: "planned",
      statement: "The service restricts customer administration to authorized users.",
      ownerIds: ["person-owner"],
      requirementIds: ["requirement-security"],
      activity: "Restrict customer administration.",
      operationMode: "automated",
      frequency: "Continuous"
    },
    {
      schemaVersion: 1,
      id: "complementary-control-customer-admin",
      type: "complementary-control",
      title: "Customer administrator access",
      status: "active",
      responsibleParty: "user-entity",
      statement: "Customers authorize and remove their administrators.",
      systemIds: ["system-service"],
      relatedControlIds: ["control-customer-access"]
    }
  ]);

  const packet = await prepareEvidencePacket(root, {
    start: "2026-01-01",
    end: "2026-01-31",
    generatedAt: "2026-02-01T00:00:00Z"
  });

  assert.equal(packet.records.some(({ id }) => id === "complementary-control-customer-admin"), true);
});

test("builds an auditor packet from dated records, obligation coverage, policies, and evidence", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-evidence-packet-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await createResource(root, {
    schemaVersion: 1,
    id: "policy-risk-governance",
    type: "policy",
    title: "Risk governance policy",
    status: "active",
    ownerIds: ["person-owner"],
    approverIds: ["person-approver"],
    approvedOn: "2025-12-20",
    effectiveOn: "2026-01-01"
  }, {
    content: {
      content: "# Risk governance policy\n\nMeet quarterly and retain evidence."
    }
  });
  await createResources(root, [
    {
      schemaVersion: 1,
      id: "framework-test-security",
      type: "framework",
      title: "Test security criteria",
      status: "active",
      version: "1"
    },
    {
      schemaVersion: 1,
      id: "requirement-test-security",
      type: "requirement",
      title: "Test security requirement",
      frameworkId: "framework-test-security",
      reference: "TEST1",
      applicability: "applicable"
    },
    {
      schemaVersion: 1,
      id: "requirement-test-description",
      type: "requirement",
      title: "Test description criterion",
      frameworkId: "framework-test-security",
      reference: "DC1",
      applicability: "applicable",
      tags: ["description-criteria"]
    },
    {
      schemaVersion: 1,
      id: "system-customer-service",
      type: "system",
      title: "Customer service",
      status: "active",
      criticality: "high",
      ownerIds: ["person-owner"],
      inScope: true,
      description: "Production customer service boundary.",
      dataClassification: "Confidential",
      evidenceSourceKinds: ["risk-management"],
      evidenceOwnerIds: ["person-owner"],
      commitmentIds: ["commitment-protect-service"]
    },
    {
      schemaVersion: 1,
      id: "commitment-protect-service",
      type: "commitment",
      title: "Protect the customer service",
      status: "active",
      commitmentKind: "system-requirement",
      statement: "Protect the service and its information.",
      ownerIds: ["person-owner"],
      systemIds: ["system-customer-service"],
      requirementIds: ["requirement-test-security"],
      controlIds: ["control-quarterly-risk-review"],
      effectiveOn: "2026-01-01"
    },
    {
      schemaVersion: 1,
      id: "control-quarterly-risk-review",
      type: "control",
      title: "Quarterly risk review",
      status: "partially-implemented",
      statement: "Management reviews service risk quarterly.",
      ownerIds: ["person-owner"],
      requirementIds: ["requirement-test-security"],
      code: "RSK-01",
      activity: "Review service risks, decisions, and follow-up work.",
      operationMode: "manual",
      frequency: "Quarterly",
      systemIds: ["system-customer-service"],
      evidenceSourceIds: ["system-customer-service"],
      commitmentIds: ["commitment-protect-service"],
      policyIds: ["policy-risk-governance"],
      effectiveOn: "2026-01-01"
    },
    {
      schemaVersion: 1,
      id: "risk-assessment-2026",
      type: "risk-assessment",
      title: "2026 risk assessment",
      status: "complete",
      assessmentDate: "2026-01-10",
      assessmentKind: "system-risk",
      scope: "Customer service",
      assessorIds: ["person-owner"],
      reviewerIds: ["person-approver"],
      methodology: "Identify and assess risks to the scoped service using the approved risk method.",
      approvedOn: "2026-01-10",
      systemIds: ["system-customer-service"]
    }
  ]);
  const riskPolicy = (await loadWorkspace(root)).resources.find(({ id }) => id === "policy-risk-governance");
  await updateResource(root, "policy", riskPolicy.id, {
    ...riskPolicy,
    controlIds: ["control-quarterly-risk-review"]
  });
  await writeFile(
    join(root, "data", "systems", "system-customer-service.md"),
    "# Customer service evidence\n\nExport the complete governance review register with dates, owners, decisions, and linked follow-up work. Verify the export against the committed review records.\n",
    "utf8"
  );
  await writeFile(
    join(root, "data", "controls", "control-quarterly-risk-review.md"),
    "# Quarterly risk review procedure\n\nThe program owner prepares the current risk register, open findings, exceptions, and prior action items. The owner records decisions and assigns follow-up work, then the independent reviewer checks the completed minutes and evidence.\n",
    "utf8"
  );
  const programControl = (await loadWorkspace(root)).resources.find(({ id }) => id === "control-quarterly-risk-review");
  await updateResource(root, "control", programControl.id, {
    ...programControl,
    status: "implemented"
  });
  const programWorkspace = (await loadWorkspace(root)).workspace;
  await updateResource(root, "workspace", programWorkspace.id, {
    ...programWorkspace,
    assuranceGoal: "soc-2-type-2",
    frameworkIds: ["framework-test-security"],
    requirementIds: ["requirement-test-security", "requirement-test-description"],
    controlIds: ["control-quarterly-risk-review"],
    systemIds: ["system-customer-service"],
    candidatePeriodStart: "2026-01-01",
    candidatePeriodEnd: "2026-03-31"
  });
  await createResource(root, {
    schemaVersion: 1,
    id: "evidence-risk-review-test-capture",
    type: "evidence",
    title: "Risk review evidence test capture",
    status: "verified",
    evidenceKind: "test-export",
    source: "Governance review register",
    collectedOn: "2025-12-22",
    classification: "Internal",
    sourceSystemId: "system-customer-service",
    controlIds: ["control-quarterly-risk-review"],
    collectorIds: ["person-owner"],
    verifierIds: ["person-approver"],
    verifiedOn: "2025-12-22"
  }, {
    content: {
      content: "# Test capture\n\nManagement exported and reviewed the governance register before the candidate period."
    }
  });
  for (const [id, title, documentKind] of [
    ["document-system-description", "System description", "soc2-system-description"],
    ["document-management-assertion", "Management assertion", "soc2-management-assertion"],
    ["document-period-completeness", "Period completeness statement", "soc2-period-completeness"],
    ["document-management-representation", "Management representation letter", "soc2-management-representation"]
  ]) {
    await createResource(root, {
      schemaVersion: 1,
      id,
      type: "document",
      title,
      status: "active",
      documentKind,
      ownerIds: ["person-owner"],
      approverIds: ["person-approver"],
      approvedOn: "2026-04-01",
      effectiveOn: "2026-04-01"
    }, {
      content: { content: managementDocumentMarkdown(title, documentKind) }
    });
  }
  await createResource(root, {
    schemaVersion: 1,
    id: "audit-2026-type-2",
    type: "audit",
    title: "2026 SOC 2 Type 2",
    status: "fieldwork",
    auditKind: "soc-2-type-2",
    frameworkIds: ["framework-test-security"],
    scope: "Customer service",
    ownerIds: ["person-owner"],
    auditor: { firm: "Independent CPA firm" },
    periodStart: "2026-01-01",
    periodEnd: "2026-03-31",
    systemIds: ["system-customer-service"],
    requirementIds: ["requirement-test-security", "requirement-test-description"],
    controlIds: ["control-quarterly-risk-review"],
    subserviceMethod: "not-applicable",
    complementaryControlsConclusion: "not-applicable",
    systemDescriptionDocumentId: "document-system-description",
    managementAssertionDocumentId: "document-management-assertion",
    periodCompletenessDocumentId: "document-period-completeness",
    managementRepresentationDocumentId: "document-management-representation"
  });
  await createResource(root, {
    schemaVersion: 1,
    id: "obligation-quarterly-risk-meeting",
    type: "obligation",
    title: "Quarterly risk meeting",
    status: "active",
    activityType: "meeting",
    recurrence: {
      mode: "calendar",
      unit: "month",
      interval: 3,
      anchorDate: "2026-01-01"
    },
    ownerIds: ["person-owner"],
    policyIds: ["policy-risk-governance"],
    controlIds: ["control-quarterly-risk-review"],
    startsOn: "2026-01-01"
  });
  await mkdir(join(root, "data", "evidence", "evidence-q1-risk-review"), { recursive: true });
  await writeFile(join(root, "data", "evidence", "evidence-q1-risk-review", "evidence.md"), "# Q1 risk review\n\nCompleted and reviewed.\n", "utf8");
  await mkdir(join(root, "data", "evidence", "evidence-signed-management-representation"), { recursive: true });
  await writeFile(join(root, "data", "evidence", "evidence-signed-management-representation", "signed-representation.pdf"), "Fixed test attachment\n", "utf8");
  await createResource(root, {
    schemaVersion: 1,
    id: "evidence-risk-review-population",
    type: "evidence",
    title: "Risk review population",
    status: "verified",
    evidenceKind: "population-export",
    source: "Governance meeting register",
    collectedOn: "2026-03-31",
    periodStart: "2026-01-01",
    periodEnd: "2026-03-31",
    classification: "Internal",
    generatedAt: "2026-04-01T10:00:00Z",
    timezone: "UTC",
    queryDescription: "All quarterly risk meetings scheduled from 2026-01-01 through 2026-03-31 in UTC.",
    populationCount: 1,
    completenessValidation: "Reconciled to the quarterly obligation calendar.",
    accuracyValidation: "Compared the meeting date and status to the committed meeting record.",
    sourceSystemId: "system-customer-service",
    controlIds: ["control-quarterly-risk-review"],
    collectorIds: ["person-owner"],
    verifierIds: ["person-approver"],
    verifiedOn: "2026-04-01"
  }, {
    content: { content: "# Risk review population\n\nOne required quarterly review." }
  });
  await createResource(root, {
    schemaVersion: 1,
    id: "evidence-signed-management-representation",
    type: "evidence",
    title: "Signed management representation",
    status: "verified",
    evidenceKind: "signed-management-representation",
    source: "Signed management representation letter",
    collectedOn: "2026-04-01",
    classification: "Confidential",
    filePaths: ["evidence/evidence-signed-management-representation/signed-representation.pdf"],
    auditIds: ["audit-2026-type-2"],
    sourceResourceIds: ["document-management-representation"],
    collectorIds: ["person-owner"],
    verifierIds: ["person-approver"],
    verifiedOn: "2026-04-01"
  });
  const representationDocument = (await loadWorkspace(root)).resources.find(({ id }) => id === "document-management-representation");
  await updateResource(root, "document", representationDocument.id, {
    ...representationDocument,
    evidenceIds: ["evidence-signed-management-representation"]
  });
  await createResources(root, [
    {
      schemaVersion: 1,
      id: "audit-population-risk-review",
      type: "audit-population",
      title: "Quarterly risk review population",
      status: "reconciled",
      auditId: "audit-2026-type-2",
      populationKind: "risk-governance",
      periodStart: "2026-01-01",
      periodEnd: "2026-03-31",
      ownerIds: ["person-owner"],
      controlIds: ["control-quarterly-risk-review"],
      sourceSystemId: "system-customer-service",
      sourceEvidenceId: "evidence-risk-review-population",
      reconciledByIds: ["person-owner"],
      reconciledOn: "2026-04-01",
      conclusion: "complete",
      reconciliationSummary: "Reconciled the quarterly schedule to the meeting register."
    },
    ...loadModel().auditReadiness.populationTemplates.map((template) => ({
      schemaVersion: 1,
      id: `audit-population-${template.kind}`,
      type: "audit-population",
      title: template.title,
      status: "not-applicable",
      auditId: "audit-2026-type-2",
      populationKind: template.kind,
      periodStart: "2026-01-01",
      periodEnd: "2026-03-31",
      ownerIds: ["person-owner"],
      notApplicableReason: "This focused test engagement does not exercise this population."
    }))
  ]);
  await createResources(root, [
    {
      schemaVersion: 1,
      id: "action-item-q1-risk-review",
      type: "action-item",
      title: "Record Q1 risk review",
      status: "done",
      assigneeIds: ["person-owner"],
      sourceResourceId: "obligation-quarterly-risk-meeting",
      obligationId: "obligation-quarterly-risk-meeting",
      completedOn: "2026-03-20",
      evidenceIds: ["evidence-q1-risk-review"]
    },
    {
      schemaVersion: 1,
      id: "evidence-q1-risk-review",
      type: "evidence",
      title: "Q1 risk review evidence",
      status: "verified",
      evidenceKind: "rendered-record",
      source: "Risk review action",
      collectedOn: "2026-03-20",
      classification: "Internal",
      collectorIds: ["person-owner"],
      verifierIds: ["person-approver"],
      verifiedOn: "2026-03-20",
      sourceResourceIds: ["action-item-q1-risk-review"],
      controlIds: ["control-quarterly-risk-review"],
      capture: {
        route: "#/resource/meeting/q1-risk-review",
        filters: {},
        periodStart: "2026-01-01",
        periodEnd: "2026-03-31",
        capturedAt: "2026-03-20T12:00:00Z",
        method: "browser-screenshot"
      }
    },
    {
      schemaVersion: 1,
      id: "control-test-quarterly-risk-review",
      type: "control-test",
      title: "Q1 quarterly risk review test",
      status: "complete",
      controlId: "control-quarterly-risk-review",
      testKinds: ["operating-effectiveness"],
      performedBy: "management",
      periodStart: "2026-01-01",
      periodEnd: "2026-03-31",
      outcome: "passed",
      auditId: "audit-2026-type-2",
      testerIds: ["person-owner"],
      sampleSize: 1,
      populationId: "audit-population-risk-review",
      sampleEvidenceIds: ["evidence-q1-risk-review"],
      evidenceIds: ["evidence-risk-review-population", "evidence-q1-risk-review"],
      exceptionCount: 0,
      reviewerIds: ["person-approver"],
      reviewedOn: "2026-04-01",
      completedOn: "2026-04-01"
    },
    {
      schemaVersion: 1,
      id: "finding-risk-review-documentation",
      type: "finding",
      title: "Risk review documentation follow-up",
      status: "closed",
      severity: "low",
      sourceResourceId: "control-test-quarterly-risk-review",
      description: "The review record needed a clearer approval note.",
      ownerIds: ["person-owner"],
      dueOn: "2026-04-01",
      resolvedOn: "2026-04-01",
      verifiedByIds: ["person-approver"],
      verifiedOn: "2026-04-01"
    },
    {
      schemaVersion: 1,
      id: "action-item-risk-review-documentation",
      type: "action-item",
      title: "Clarify risk review approval",
      status: "done",
      assigneeIds: ["person-owner"],
      sourceResourceId: "finding-risk-review-documentation",
      completedOn: "2026-04-01"
    }
  ]);
  const audit = (await loadWorkspace(root)).resources.find(({ id }) => id === "audit-2026-type-2");
  await updateResource(root, "audit", audit.id, {
    ...audit,
    controlTestIds: ["control-test-quarterly-risk-review"]
  });
  const obligation = (await loadWorkspace(root)).resources.find(({ id }) => id === "obligation-quarterly-risk-meeting");
  await updateResource(root, "obligation", "obligation-quarterly-risk-meeting", {
    ...obligation,
    completionResourceIds: ["action-item-q1-risk-review"]
  });

  await git(root, ["init"]);
  await git(root, ["config", "user.name", "Test User"]);
  await git(root, ["config", "user.email", "test@example.test"]);
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "Create Q1 compliance records"]);
  const sourceCommit = getGitSummary(root).commit;
  const evidence = (await loadWorkspace(root)).resources.find(({ id }) => id === "evidence-q1-risk-review");
  await updateResource(root, "evidence", "evidence-q1-risk-review", {
    ...evidence,
    sourceCommit
  });
  const populationEvidence = (await loadWorkspace(root)).resources.find(({ id }) => id === "evidence-risk-review-population");
  await updateResource(root, "evidence", "evidence-risk-review-population", {
    ...populationEvidence,
    sourceCommit
  });
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "Bind Q1 evidence revision"]);

  const packet = await prepareEvidencePacket(root, {
    start: "2026-01-01",
    end: "2026-03-31",
    auditId: "audit-2026-type-2",
    generatedAt: "2026-04-01T12:00:00Z"
  });
  assert.equal(packet.revision.clean, true);
  assert.match(packet.revision.dataDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(packet.summary.obligationOccurrences, 1);
  assert.equal(packet.obligations[0].status, "complete");
  assert.equal(packet.evidence[0].id, "evidence-q1-risk-review");
  assert.equal(packet.fileGRCRecords.some(({ id }) => id === "action-item-q1-risk-review"), true);
  assert.equal(packet.summary.fileGRCRecords, packet.fileGRCRecords.length);
  assert.equal(packet.policies.some(({ id }) => id === "policy-risk-governance"), true);
  assert.equal(packet.datedRecords.some(({ id }) => id === "action-item-q1-risk-review"), true);
  assert.equal(packet.records.find(({ id }) => id === "action-item-q1-risk-review").history[0].author, "Test User");
  assert.equal(packet.records.some(({ id }) => id === "finding-risk-review-documentation"), true);
  assert.equal(packet.records.some(({ id }) => id === "action-item-risk-review-documentation"), true);
  assert.equal(packet.readiness.status, "delivery-ready");
  assert.equal(packet.controlCoverage[0].evidenceIds.includes("evidence-q1-risk-review"), true);
  assert.equal(packet.populations.length, 11);
  assert.equal(packet.controlCoverage[0].tests[0].populationEvidenceId, "evidence-risk-review-population");
  assert.deepEqual(packet.gaps, []);

  await assert.rejects(
    writeEvidencePacket(root, packet, { output: "data/packet" }),
    /under \.filegrc/
  );
  const written = await writeEvidencePacket(root, packet, { output: ".filegrc/test-packet" });
  const packetIndex = await readFile(join(written.output, "index.html"), "utf8");
  assert.match(packetIndex, /Quarterly risk meeting/);
  assert.match(packetIndex, /Create Q1 compliance records/);
  assert.match(packetIndex, /FileGRC Evidence/);
  assert.match(packetIndex, /External Evidence/);
  const formulaPacket = structuredClone(packet);
  formulaPacket.evidence[0].title = "=HYPERLINK(\"https://example.test\",\"Open\")";
  const formulaOutput = await writeEvidencePacket(root, formulaPacket, { output: ".filegrc/formula-packet" });
  const formulaCsv = await readFile(join(formulaOutput.output, "evidence-index.csv"), "utf8");
  assert.ok(formulaCsv.includes(`"'=HYPERLINK(""https://example.test"",""Open"")"`));
  assert.match(await readFile(join(written.output, "manifest.json"), "utf8"), /evidence-q1-risk-review/);
  const controlMatrix = await readFile(join(written.output, "control-matrix.csv"), "utf8");
  assert.match(controlMatrix, /RSK-01/);
  assert.match(controlMatrix, /FileGRC Evidence IDs/);
  assert.match(controlMatrix, /External Evidence IDs/);
  assert.match(controlMatrix, /evidence-risk-review-population/);
  assert.match(await readFile(join(written.output, "population-index.csv"), "utf8"), /Quarterly risk review population/);
  assert.match(await readFile(join(written.output, "SHA256SUMS"), "utf8"), /control-matrix\.csv/);
  assert.match(await readFile(join(written.output, "SHA256SUMS"), "utf8"), /population-index\.csv/);
  assert.match(await readFile(join(written.output, "source-system-index.csv"), "utf8"), /Customer service/);
  assert.match(await readFile(join(written.output, "external-evidence-index.csv"), "utf8"), /Evidence ID/);
  for (const line of (await readFile(join(written.output, "SHA256SUMS"), "utf8")).trim().split("\n")) {
    const [expected, relativePath] = line.split("  ", 2);
    const actual = createHash("sha256").update(await readFile(join(written.output, relativePath))).digest("hex");
    assert.equal(actual, expected, relativePath);
  }
  await access(join(written.output, "records", "action-item", "action-item-q1-risk-review.json"));
  await access(join(written.output, "content", "policies", "policy-risk-governance.md"));
  const policyContentCommit = packet.records.find(({ id }) => id === "policy-risk-governance").contentPaths[0].history[0].commit;
  await access(join(written.output, "history", "policy", "policy-risk-governance", policyContentCommit, "policy-risk-governance.md"));
  await assert.rejects(
    writeEvidencePacket(root, packet, { output: ".filegrc/test-packet" }),
    /already exists/
  );
  await access(join(written.output, "index.html"));
  const unsafePacket = structuredClone(packet);
  unsafePacket.records[0].type = "../../../outside";
  await assert.rejects(
    writeEvidencePacket(root, unsafePacket, { output: ".filegrc/unsafe-packet" }),
    /stay inside the packet directory/
  );
  await assert.rejects(access(join(root, ".filegrc", "unsafe-packet")), /ENOENT/);

  const actionPath = join(root, "data", "action-items", "action-item-q1-risk-review.json");
  const actionSource = await readFile(actionPath, "utf8");
  try {
    await writeFile(actionPath, actionSource.replace("Record Q1 risk review", "Changed after packet preparation"), "utf8");
    await assert.rejects(
      writeEvidencePacket(root, packet, { output: ".filegrc/stale-packet" }),
      /source changed/
    );
    await assert.rejects(access(join(root, ".filegrc", "stale-packet")), /ENOENT/);
  } finally {
    await writeFile(actionPath, actionSource, "utf8");
  }

  const cli = await execute(process.execPath, [
    fileURLToPath(new URL("../bin/filegrc.js", import.meta.url)),
    "evidence-packet",
    "--root",
    root,
    "--start",
    "2026-01-01",
    "--end",
    "2026-03-31",
    "--audit",
    "audit-2026-type-2",
    "--preview",
    "--json"
  ]);
  const cliResult = JSON.parse(cli.stdout);
  assert.equal(cliResult.output, null);
  assert.equal(cliResult.packet.summary.datedRecords, packet.summary.datedRecords);

  const running = await serveWorkspace(root, { port: 0 });
  try {
    const previewResponse = await fetch(`${running.url}/api/evidence-packet?start=2026-01-01&end=2026-03-31&auditId=audit-2026-type-2`);
    assert.equal(previewResponse.status, 200);
    assert.equal((await previewResponse.json()).summary.datedRecords, packet.summary.datedRecords);
    const response = await fetch(`${running.url}/api/evidence-packet`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ start: "2026-01-01", end: "2026-03-31", auditId: "audit-2026-type-2" })
    });
    assert.equal(response.status, 201);
    const apiResult = await response.json();
    assert.equal(apiResult.packet.summary.datedRecords, packet.summary.datedRecords);
    assert.match(apiResult.output, /^\.filegrc\/evidence-packets\//);
    const indexResponse = await fetch(`${running.url}${apiResult.packetUrl}`);
    const indexSource = await indexResponse.text();
    assert.equal(indexResponse.status, 200, indexSource);
    assert.match(indexSource, /Quarterly risk meeting/);
    const generatedRoot = join(root, apiResult.output);
    await mkdir(join(generatedRoot, "attachments"), { recursive: true });
    await writeFile(join(generatedRoot, "attachments", "index.html"), "<script>throw new Error('unsafe')</script>", "utf8");
    const attachmentResponse = await fetch(`${running.url}${apiResult.packetUrl.replace(/index\.html$/, "attachments/index.html")}`);
    assert.equal(attachmentResponse.status, 200);
    assert.equal(attachmentResponse.headers.get("content-type"), "application/octet-stream");
    await symlink(join(root, "data", "workspace.json"), join(generatedRoot, "attachments", "workspace-link.json"));
    const symlinkResponse = await fetch(`${running.url}${apiResult.packetUrl.replace(/index\.html$/, "attachments/workspace-link.json")}`);
    assert.equal(symlinkResponse.status, 400);
    const traversalResponse = await fetch(`${running.url}${apiResult.packetUrl.replace(/index\.html$/, "%2e%2e%2fmanifest.json")}`);
    assert.notEqual(traversalResponse.status, 200);
    const encodedSeparatorResponse = await fetch(`${running.url}${apiResult.packetUrl.replace(/index\.html$/, "attachments%2findex.html")}`);
    assert.equal(encodedSeparatorResponse.status, 400);
    const customResponse = await fetch(`${running.url}/api/evidence-packet`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        start: "2026-01-01",
        end: "2026-03-31",
        auditId: "audit-2026-type-2",
        output: ".filegrc/custom-packet"
      })
    });
    assert.equal(customResponse.status, 201);
    assert.equal((await customResponse.json()).packetUrl, null);
  } finally {
    await new Promise((resolve) => running.server.close(resolve));
  }
});

test("never marks an unscoped packet with no evidence delivery-ready", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-empty-evidence-packet-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await git(root, ["init"]);
  await git(root, ["config", "user.name", "Test User"]);
  await git(root, ["config", "user.email", "test@example.test"]);
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "Create empty program"]);

  const packet = await prepareEvidencePacket(root, {
    start: "2026-01-01",
    end: "2026-03-31"
  });
  assert.equal(packet.readiness.status, "draft");
  assert.equal(packet.gaps.some(({ code }) => code === "missing-audit-scope"), true);
  assert.equal(packet.gaps.some(({ code }) => code === "missing-evidence"), true);
  assert.ok(packet.summary.errors >= 2);
  await assert.rejects(
    execute(process.execPath, [
      fileURLToPath(new URL("../bin/filegrc.js", import.meta.url)),
      "evidence-packet",
      "--root",
      root,
      "--start",
      "2026-01-01",
      "--end",
      "2026-03-31",
      "--preview",
      "--require-ready"
    ]),
    (error) => error.code === 2
  );
});

test("excludes dated records that are unrelated to the selected engagement", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-scoped-evidence-packet-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await createResources(root, [
    {
      schemaVersion: 1,
      id: "framework-scoped-security",
      type: "framework",
      title: "Scoped security criteria",
      status: "active",
      version: "1"
    },
    {
      schemaVersion: 1,
      id: "audit-scoped",
      type: "audit",
      title: "Scoped Type 2 engagement",
      status: "planned",
      auditKind: "soc-2-type-2",
      frameworkIds: ["framework-scoped-security"],
      scope: "Selected service only",
      ownerIds: ["person-owner"],
      periodStart: "2026-01-01",
      periodEnd: "2026-03-31"
    }
  ]);
  await createResource(root, {
    schemaVersion: 1,
    id: "evidence-unrelated-payroll",
    type: "evidence",
    title: "Unrelated payroll record",
    status: "collected",
    evidenceKind: "business-record",
    source: "Unrelated business process",
    collectedOn: "2026-02-15",
    classification: "Confidential",
    collectorIds: ["person-owner"]
  }, {
    content: { content: "# Unrelated business record\n\nThis item has no audit, system, control, policy, or source-resource relationship." }
  });

  const packet = await prepareEvidencePacket(root, { auditId: "audit-scoped" });
  assert.equal(packet.records.some(({ id }) => id === "evidence-unrelated-payroll"), false);
  assert.equal(packet.evidence.some(({ id }) => id === "evidence-unrelated-payroll"), false);
  assert.equal(packet.datedRecords.some(({ id }) => id === "evidence-unrelated-payroll"), false);
});

test("limits event workflow coverage to runs that intersect the audit period", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-evidence-event-period-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await createResource(root, {
    schemaVersion: 1,
    id: "obligation-material-change-review",
    type: "obligation",
    title: "Review material change",
    status: "active",
    activityType: "change-review",
    recurrence: { mode: "event", eventType: "material-change" },
    window: { startOffsetDays: 0, endOffsetDays: 2 },
    ownerIds: ["person-owner"]
  });
  const completedRun = await createObligationEvent(root, {
    eventType: "material-change",
    occurredOn: "2026-01-01",
    title: "Completed during period"
  });
  await createObligationEvent(root, {
    eventType: "material-change",
    occurredOn: "2025-12-01",
    title: "Outside period"
  });
  const evidencedRun = await createObligationEvent(root, {
    eventType: "material-change",
    occurredOn: "2025-12-15",
    title: "Evidence during period"
  });
  const startedRun = await createObligationEvent(root, {
    eventType: "material-change",
    occurredOn: "2026-02-10",
    title: "Started during period"
  });
  const canceledRun = await createObligationEvent(root, {
    eventType: "material-change",
    occurredOn: "2026-02-12",
    title: "Canceled during period"
  });
  const canceledEvent = (await loadWorkspace(root)).resources.find(({ id }) => id === canceledRun.event.id);
  await updateResource(root, "obligation-event", canceledEvent.id, {
    ...canceledEvent,
    status: "canceled"
  });
  const completedAction = (await loadWorkspace(root)).resources.find(({ id }) => id === completedRun.actions[0].id);
  await updateResource(root, "action-item", completedAction.id, {
    ...completedAction,
    status: "done",
    completedOn: "2026-02-02"
  });
  const canceledAction = (await loadWorkspace(root)).resources.find(({ id }) => id === startedRun.actions[0].id);
  await updateResource(root, "action-item", canceledAction.id, {
    ...canceledAction,
    status: "canceled"
  });
  await createResource(root, {
    schemaVersion: 1,
    id: "evidence-material-change",
    type: "evidence",
    title: "Material change evidence",
    status: "verified",
    evidenceKind: "system-export",
    source: "Change system",
    collectedOn: "2026-02-05",
    classification: "Internal",
    collectorIds: ["person-owner"],
    verifierIds: ["person-approver"],
    verifiedOn: "2026-02-05",
    externalReference: { system: "Change system", reference: "change-123" },
    sourceResourceIds: [evidencedRun.actions[0].id]
  });

  const packet = await prepareEvidencePacket(root, {
    start: "2026-02-01",
    end: "2026-02-28"
  });
  assert.deepEqual(packet.eventRuns.map(({ title }) => title).sort(), [
    "Canceled during period",
    "Completed during period",
    "Evidence during period",
    "Started during period"
  ]);
  assert.equal(packet.records.some(({ title }) => title === "Outside period"), false);
  assert.equal(packet.records.some(({ title }) => title === "Evidence during period"), true);
  assert.equal(packet.datedRecords.some(({ id }) => id === completedAction.id), true);
  assert.equal(packet.gaps.some(({ code }) => code === "canceled-event-action"), true);
  assert.equal(packet.gaps.some(({ resourceId }) => resourceId === canceledRun.actions[0].id), false);
});

function git(cwd, args) {
  return execute("git", args, { cwd });
}

function managementDocumentMarkdown(title, documentKind) {
  const date = "2026-01-01 through 2026-03-31";
  if (documentKind === "soc2-system-description") {
    return `# ${title}

Reporting period: ${date}.

${Array.from({ length: 9 }, (_, index) => `## DC${index + 1}: Description topic

Management describes the in-scope customer service, its commitments, components, people, procedures, data, controls, dependencies, incidents, and changes. This test narrative contains enough engagement-specific substance to exercise the preparation checks without using a placeholder.`).join("\n\n")}
`;
  }
  return `# ${title}

This engagement document applies to ${date}. Management reviewed the in-scope service, selected criteria, controls, evidence, dependencies, exceptions, and engagement records. The responsible owner and separate approver confirmed that the document is complete for its stated purpose. ${"The final wording is reconciled to the engagement record and supporting evidence. ".repeat(8)}
`;
}
