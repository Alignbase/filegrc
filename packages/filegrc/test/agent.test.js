import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  buildAgentProgramPath,
  buildAgentGuide,
  createAppState,
  findResourceReferences,
  listResourceTypes,
  loadWorkspace,
  scaffoldResourceMutation,
  RESOURCE_INSTRUCTIONS,
  RESOURCE_PAGE_SUMMARIES,
  updateResource,
  validateWorkspace
} from "../src/index.js";
import { makeWorkspace } from "./helpers.js";

const execute = promisify(execFile);
const cli = fileURLToPath(new URL("../bin/filegrc.js", import.meta.url));

test("agent guides and scaffolds cover every resource type from the model", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-agent-guide-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const loaded = await loadWorkspace(root);
  const types = listResourceTypes(loaded.model);
  assert.equal(types.length, Object.keys(loaded.model.resources).length);
  const overview = await execute(process.execPath, [cli, "guide", "--root", root, "--json"]);
  const parsedOverview = JSON.parse(overview.stdout);
  assert.equal(parsedOverview.programPath.length, 5);
  assert.deepEqual(parsedOverview.programPath.map(({ title }) => title), [
    "Define Scope",
    "Approve Policies and Plans",
    "Implement Controls",
    "Operate the Program",
    "Audit"
  ]);
  assert.deepEqual(Object.keys(parsedOverview.actions), [
    "help",
    "version",
    "serve",
    "setup",
    "build",
    "validate",
    "model",
    "migrate",
    "describe",
    "types",
    "guide",
    "programPath",
    "workflow",
    "periodHealth",
    "milestoneCheck",
    "scaffold",
    "list",
    "search",
    "obligations",
    "programReadiness",
    "evidenceMap",
    "auditReadiness",
    "prepareAudit",
    "reconcile",
    "externalReviewerSetup",
    "policyActivation",
    "documentActivation",
    "nextAuditCycle",
    "reviewApplicability",
    "reviewCollection",
    "trigger",
    "evidencePacket",
    "get",
    "references",
    "previewMutation",
    "create",
    "complete",
    "completeAction",
    "completeEvent",
    "update",
    "content",
    "attach",
    "detach",
    "delete",
    "commit"
  ]);
  const path = buildAgentProgramPath(loaded.model);
  assert.equal(path.length, 5);
  assert.equal(path[0].pages.find(({ type }) => type === "system").summary, RESOURCE_PAGE_SUMMARIES.system);
  assert.equal(path[0].pages.find(({ type }) => type === "system").instructions, RESOURCE_INSTRUCTIONS.system);
  assert.equal(path[0].pages.find(({ type }) => type === "system").guide, "npx filegrc guide system --json");
  assert.ok(path.every((stage) => stage.commands.every((command) => command.startsWith("npx filegrc "))));
  assert.deepEqual(path[2].commands.slice(-2), [
    "npx filegrc evidence-map --json",
    "npx filegrc program-readiness --json"
  ]);
  assert.equal(path[2].summary, "Describe each Control and connect its evidence source.");
  assert.ok(path.every(({ summary }) => summary.length <= 120));
  assert.ok(Object.values(RESOURCE_PAGE_SUMMARIES).every((summary) => summary.length <= 100));
  assert.deepEqual(path[3].pages.map(({ utility }) => utility), ["policy-events", "work-queue"]);
  assert.equal(path[3].operatingRecords.length, path[3].resourceTypes.length + path[3].supportingResourceTypes.length);
  assert.equal(path[3].operatingRecords.every(({ order }) => order === null), true);
  const auditGuide = buildAgentGuide(loaded, "audit");
  assert.equal(auditGuide.optionalFields.some(({ name }) => name === "controlTestIds"), false);
  assert.equal(auditGuide.optionalFields.some(({ name }) => name === "evidenceIds"), false);
  const personGuide = buildAgentGuide(loaded, "person");
  assert.equal(personGuide.optionalFields.some(({ name }) => name === "teamIds"), false);
  assert.equal(personGuide.optionalFields.some(({ name }) => name === "role"), false);
  assert.match(personGuide.workflow[2], /current facts and lifecycle state in JSON/);
  const policyGuide = buildAgentGuide(loaded, "policy");
  assert.match(policyGuide.workflow[2], /recommended Markdown companion/);
  const workspaceGuide = buildAgentGuide(loaded, "workspace");
  assert.match(workspaceGuide.workflow[1], /Open the existing singleton record/);
  const personGuideText = await execute(process.execPath, [cli, "guide", "person", "--root", root]);
  assert.doesNotMatch(personGuideText.stdout, /\nrole\t|\nteamIds\t/);
  assert.match(personGuideText.stdout, /Completion checks:\n- Required and status-dependent fields are complete/);
  const pathCommand = await execute(process.execPath, [cli, "program-path", "--root", root, "--json"]);
  const parsedPath = JSON.parse(pathCommand.stdout);
  assert.equal(parsedPath.dataModelVersion, String(loaded.model.modelVersion));
  assert.equal(parsedPath.currentStep.number, 1);
  assert.equal(parsedPath.stages.length, 5);
  assert.equal(parsedPath.stages[0].pages.find(({ type }) => type === "system").instructions, RESOURCE_INSTRUCTIONS.system);
  assert.equal(parsedPath.stages[0].pages.find(({ type }) => type === "system").summary, RESOURCE_PAGE_SUMMARIES.system);
  const pathText = await execute(process.execPath, [cli, "program-path", "--root", root]);
  assert.match(pathText.stdout, /Step 1\.g · Systems[\s\S]*Define the service boundary\.[\s\S]*Details: npx filegrc guide system --json/);
  assert.doesNotMatch(pathText.stdout, /Policy basis:|Instructions:/);
  const pathSummaryCommand = await execute(process.execPath, [
    cli,
    "program-path",
    "--root",
    root,
    "--summary",
    "--json"
  ]);
  const parsedPathSummary = JSON.parse(pathSummaryCommand.stdout);
  assert.equal(parsedPathSummary.dataModelVersion, String(loaded.model.modelVersion));
  assert.equal(parsedPathSummary.stages.length, 5);
  assert.equal(parsedPathSummary.stages[0].pages, undefined);
  assert.equal(parsedPathSummary.stages[0].nextAction?.checks, undefined);
  assert.ok(pathSummaryCommand.stdout.length < pathCommand.stdout.length / 4);
  const nextPath = JSON.parse((await execute(process.execPath, [
    cli,
    "program-path",
    "--root",
    root,
    "--next",
    "--json"
  ])).stdout);
  assert.equal(nextPath.dataModelVersion, String(loaded.model.modelVersion));
  assert.equal(nextPath.currentStep.number, 1);
  assert.equal(nextPath.step.id, "scope");
  assert.equal(nextPath.stages, undefined);
  assert.deepEqual(nextPath.step.commands, [
    "npx filegrc setup",
    "npx filegrc get workspace --mutation"
  ]);
  const workspacePath = join(root, "data", "workspace.json");
  const malformedWorkspace = JSON.parse(await readFile(workspacePath, "utf8"));
  malformedWorkspace.id = "workspace; touch PWNED";
  await writeFile(workspacePath, `${JSON.stringify(malformedWorkspace, null, 2)}\n`, "utf8");
  const malformedNextPath = JSON.parse((await execute(process.execPath, [
    cli,
    "program-path",
    "--root",
    root,
    "--next",
    "--json"
  ])).stdout);
  assert.deepEqual(malformedNextPath.step.commands, [
    "npx filegrc setup",
    "npx filegrc get 'workspace; touch PWNED' --mutation"
  ]);
  malformedWorkspace.id = "workspace";
  await writeFile(workspacePath, `${JSON.stringify(malformedWorkspace, null, 2)}\n`, "utf8");
  const currentPath = JSON.parse((await execute(process.execPath, [
    cli,
    "program-path",
    "--root",
    root,
    "--current",
    "--json"
  ])).stdout);
  assert.equal(currentPath.dataModelVersion, String(loaded.model.modelVersion));
  assert.deepEqual(currentPath.stages.map(({ id }) => id), ["scope"]);
  assert.ok(currentPath.stages[0].pages.length > 0);

  for (const { type } of types) {
    const guide = buildAgentGuide(loaded, type);
    assert.equal(guide.type, type);
    assert.equal(guide.instructions, RESOURCE_INSTRUCTIONS[type] || loaded.model.resources[type].description);
    assert.equal(guide.use, loaded.model.resources[type].description);
    if (RESOURCE_INSTRUCTIONS[type]) assert.ok(guide.programStep, `${type} has a program step`);
    assert.ok(guide.requiredAtCreation.some(({ name }) => name === "id"));
    assert.ok(guide.requiredAtCreation.some(({ name }) => name === "title"));
    assert.ok(guide.workflow.length >= 4);
    assert.ok(guide.completionChecks.length >= 5);
    if (loaded.model.resources[type].singleton) {
      assert.throws(
        () => scaffoldResourceMutation(loaded, type, `New ${guide.title}`),
        /singleton/
      );
      continue;
    }
    const mutation = scaffoldResourceMutation(loaded, type, `Agent test ${guide.title}`);
    assert.equal(mutation.record.type, type);
    assert.match(mutation.record.id, new RegExp(`^${type}-`));
    if (type === "evidence" && Number(loaded.model.modelVersion) >= 4) {
      assert.equal(mutation.record.artifactKind, "business-record");
      assert.equal(mutation.record.sourceKind, "file");
    }
    for (const field of guide.requiredAtCreation) {
      assert.equal(Object.hasOwn(mutation.record, field.name), true, `${type} scaffold includes ${field.name}`);
    }
    for (const slot of guide.markdown.filter(({ recommended }) => true)) {
      if (slot.recommended) assert.equal(typeof mutation.content?.[slot.name], "string", `${type} scaffolds ${slot.name}`);
    }
  }
});

test("headless CRUD uses one mutation envelope for JSON and Markdown", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-agent-crud-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);

  const scaffolded = await execute(process.execPath, [
    cli,
    "scaffold",
    "risk-assessment",
    "--title",
    "2026 Annual Risk Assessment",
    "--root",
    root
  ]);
  let mutation = JSON.parse(scaffolded.stdout);
  Object.assign(mutation.record, {
    scheduledFor: "2026-07-26",
    assessmentKind: "enterprise-risk",
    scope: "Production service and supporting business operations",
    assessorIds: ["person-owner"],
    reviewerIds: ["person-approver"]
  });
  mutation.content.record = mutation.content.record.replace(
    "## Conclusion and follow-up\n",
    "## Conclusion and follow-up\n\nAssessment remains in progress.\n"
  );
  const mutationPath = join(root, "risk-assessment-mutation.json");
  await writeFile(mutationPath, `${JSON.stringify(mutation, null, 2)}\n`, "utf8");
  const rawRecordPath = join(root, "risk-assessment-record.json");
  await writeFile(rawRecordPath, `${JSON.stringify(mutation.record, null, 2)}\n`, "utf8");
  await assert.rejects(
    execute(process.execPath, [cli, "create", rawRecordPath, "--root", root, "--json"]),
    /mutation envelope/
  );

  const created = await execute(process.execPath, [cli, "create", mutationPath, "--root", root, "--json"]);
  assert.equal(JSON.parse(created.stdout).record.id, mutation.record.id);
  const contentPath = join(root, "data", "risk-assessments", `${mutation.record.id}.md`);
  assert.match(await readFile(contentPath, "utf8"), /Assessment remains in progress/);

  const content = await execute(process.execPath, [
    cli,
    "content",
    "risk-assessment",
    mutation.record.id,
    "--root",
    root,
    "--json"
  ]);
  assert.equal(JSON.parse(content.stdout).exists, true);

  const updateMutation = await execute(process.execPath, [
    cli,
    "get",
    mutation.record.id,
    "--mutation",
    "--root",
    root
  ]);
  mutation = JSON.parse(updateMutation.stdout);
  const missingRevision = structuredClone(mutation);
  delete missingRevision.revision;
  await writeFile(mutationPath, `${JSON.stringify(missingRevision, null, 2)}\n`, "utf8");
  await assert.rejects(
    execute(process.execPath, [
      cli,
      "update",
      mutation.record.type,
      mutation.record.id,
      mutationPath,
      "--root",
      root
    ]),
    /revision is required/
  );
  const missingContentRevisions = structuredClone(mutation);
  delete missingContentRevisions.contentRevisions;
  await writeFile(mutationPath, `${JSON.stringify(missingContentRevisions, null, 2)}\n`, "utf8");
  await assert.rejects(
    execute(process.execPath, [
      cli,
      "update",
      mutation.record.type,
      mutation.record.id,
      mutationPath,
      "--root",
      root
    ]),
    /content revision is required/
  );
  mutation.record.summary = "Annual assessment of the in-scope service and operations.";
  mutation.content.record = "# 2026 Annual Risk Assessment\n\nUpdated through one mutation envelope.\n";
  await writeFile(mutationPath, `${JSON.stringify(mutation, null, 2)}\n`, "utf8");
  const updated = await execute(process.execPath, [
    cli,
    "update",
    "risk-assessment",
    mutation.record.id,
    mutationPath,
    "--root",
    root,
    "--json"
  ]);
  assert.equal(JSON.parse(updated.stdout).record.summary, mutation.record.summary);

  const replacementPath = join(root, "replacement.md");
  await writeFile(replacementPath, "# 2026 Annual Risk Assessment\n\nUpdated work record.\n", "utf8");
  await execute(process.execPath, [
    cli,
    "content",
    "risk-assessment",
    mutation.record.id,
    "--write",
    replacementPath,
    "--root",
    root,
    "--json"
  ]);
  assert.match(await readFile(contentPath, "utf8"), /Updated work record/);

  const listed = await execute(process.execPath, [cli, "list", "risk-assessment", "--root", root, "--json"]);
  assert.deepEqual(JSON.parse(listed.stdout).map(({ id }) => id), [mutation.record.id]);
  const listedWithLeadingFlag = await execute(process.execPath, [cli, "list", "--json", "risk-assessment", "--root", root]);
  assert.deepEqual(JSON.parse(listedWithLeadingFlag.stdout).map(({ id }) => id), [mutation.record.id]);
  const fetched = await execute(process.execPath, [cli, "get", mutation.record.id, "--root", root]);
  assert.equal(JSON.parse(fetched.stdout).type, "risk-assessment");
  const editable = await execute(process.execPath, [cli, "get", mutation.record.id, "--mutation", "--root", root]);
  const editableMutation = JSON.parse(editable.stdout);
  assert.equal(typeof editableMutation.revision, "string");
  assert.equal(typeof editableMutation.content.record, "string");
  assert.equal(typeof Object.values(editableMutation.contentRevisions)[0], "string");
  const current = (await loadWorkspace(root)).resources.find(({ id }) => id === mutation.record.id);
  await updateResource(root, current.type, current.id, {
    ...current,
    summary: "A newer concurrent change."
  });
  editableMutation.record.summary = "A stale agent change.";
  const stalePath = join(root, "stale-mutation.json");
  await writeFile(stalePath, `${JSON.stringify(editableMutation, null, 2)}\n`, "utf8");
  await assert.rejects(
    execute(process.execPath, [
      cli,
      "update",
      mutation.record.type,
      mutation.record.id,
      stalePath,
      "--root",
      root
    ]),
    /changed after you opened/
  );
  assert.equal(
    (await loadWorkspace(root)).resources.find(({ id }) => id === mutation.record.id).summary,
    "A newer concurrent change."
  );

  const loaded = await loadWorkspace(root);
  const references = findResourceReferences(loaded, "person-owner");
  assert.ok(references.references.some(({ id, field }) => id === mutation.record.id && field === "assessorIds"));
  loaded.resources.push({
    id: "team-security-risk-oversight",
    type: "team",
    title: "Security and Risk Oversight",
    status: "active",
    memberIds: ["person-owner"],
    chairIds: ["person-approver"]
  });
  loaded.resources.find(({ id }) => id === "person-owner").teamIds = ["team-security-risk-oversight"];
  const teamReferences = findResourceReferences(loaded, "team-security-risk-oversight");
  assert.equal(
    teamReferences.references.some(({ id, field }) => id === "person-owner" && field === "teamIds"),
    false
  );

  const evidenceMutation = scaffoldResourceMutation(loaded, "evidence", "Risk Assessment Notes");
  Object.assign(evidenceMutation.record, {
    artifactKind: "business-record",
    artifactSubtype: "review",
    sourceKind: "authored-record",
    sourceDescription: "Risk assessment session",
    collectedOn: "2026-07-26",
    classificationId: "internal",
    collectorIds: ["person-owner"]
  });
  const evidenceMutationPath = join(root, "evidence-mutation.json");
  await writeFile(evidenceMutationPath, `${JSON.stringify(evidenceMutation, null, 2)}\n`, "utf8");
  await execute(process.execPath, [cli, "create", evidenceMutationPath, "--root", root]);
  const attachmentSource = join(root, "risk-notes.txt");
  await writeFile(attachmentSource, "Fixed review notes.\n", "utf8");
  let evidenceRevision = (await createAppState(root)).resources.find(
    ({ record }) => record.id === evidenceMutation.record.id
  ).revision;
  const attached = await execute(process.execPath, [
    cli,
    "attach",
    evidenceMutation.record.id,
    attachmentSource,
    "--name",
    "risk-notes.txt",
    "--expected-revision",
    evidenceRevision,
    "--root",
    root,
    "--json"
  ]);
  const attachmentResult = JSON.parse(attached.stdout);
  assert.equal(attachmentResult.path, `data/evidence/${evidenceMutation.record.id}/risk-notes.txt`);
  assert.equal(
    await readFile(join(root, attachmentResult.path), "utf8"),
    "Fixed review notes.\n"
  );
  evidenceRevision = (await createAppState(root)).resources.find(
    ({ record }) => record.id === evidenceMutation.record.id
  ).revision;
  await assert.rejects(
    execute(process.execPath, [
      cli,
      "delete",
      "evidence",
      evidenceMutation.record.id,
      "--yes",
      "--expected-revision",
      evidenceRevision,
      "--root",
      root
    ]),
    /still has local attachments/
  );
  const detached = await execute(process.execPath, [
    cli,
    "detach",
    evidenceMutation.record.id,
    "risk-notes.txt",
    "--yes",
    "--expected-revision",
    evidenceRevision,
    "--root",
    root,
    "--json"
  ]);
  assert.deepEqual(JSON.parse(detached.stdout).filePaths, []);
  await assert.rejects(readFile(join(root, attachmentResult.path), "utf8"), /ENOENT/);
  evidenceRevision = (await createAppState(root)).resources.find(
    ({ record }) => record.id === evidenceMutation.record.id
  ).revision;
  await execute(process.execPath, [
    cli,
    "delete",
    "evidence",
    evidenceMutation.record.id,
    "--yes",
    "--expected-revision",
    evidenceRevision,
    "--root",
    root
  ]);
  assert.equal(
    (await loadWorkspace(root)).resources.some(({ id }) => id === evidenceMutation.record.id),
    false
  );
  assert.equal((await validateWorkspace(root)).ok, true);
});

test("headless document flows require a separate approver before activation", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-agent-document-approval-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);

  const guideResult = await execute(process.execPath, [
    cli,
    "guide",
    "document",
    "--root",
    root,
    "--json"
  ]);
  const guide = JSON.parse(guideResult.stdout);
  assert.deepEqual(
    guide.conditionalRequirements.find(({ name }) => name === "approverIds")?.requiredWhen,
    { status: ["active", "superseded", "retired"] }
  );

  const scaffoldResult = await execute(process.execPath, [
    cli,
    "scaffold",
    "document",
    "--title",
    "Access Procedure",
    "--root",
    root
  ]);
  let mutation = JSON.parse(scaffoldResult.stdout);
  assert.equal(mutation.record.status, "draft");
  assert.equal(mutation.record.approverIds, undefined);
  Object.assign(mutation.record, {
    documentKind: "procedure",
    ownerIds: ["person-owner"]
  });
  const mutationPath = join(root, "document-mutation.json");
  await writeFile(mutationPath, `${JSON.stringify(mutation, null, 2)}\n`, "utf8");
  await execute(process.execPath, [cli, "create", mutationPath, "--root", root, "--json"]);

  const editableResult = await execute(process.execPath, [
    cli,
    "get",
    mutation.record.id,
    "--mutation",
    "--root",
    root
  ]);
  mutation = JSON.parse(editableResult.stdout);
  Object.assign(mutation.record, {
    status: "active",
    effectiveOn: "2026-07-01",
    approvedOn: "2026-07-01"
  });
  await writeFile(mutationPath, `${JSON.stringify(mutation, null, 2)}\n`, "utf8");
  await assert.rejects(
    execute(process.execPath, [
      cli,
      "update",
      "document",
      mutation.record.id,
      mutationPath,
      "--root",
      root,
      "--json"
    ]),
    /Required field "approverIds" is missing/
  );
  assert.equal(
    (await loadWorkspace(root)).resources.find(({ id }) => id === mutation.record.id).status,
    "draft"
  );

  mutation.record.approverIds = ["person-approver"];
  await writeFile(mutationPath, `${JSON.stringify(mutation, null, 2)}\n`, "utf8");
  const activated = await execute(process.execPath, [
    cli,
    "update",
    "document",
    mutation.record.id,
    mutationPath,
    "--root",
    root,
    "--json"
  ]);
  assert.equal(JSON.parse(activated.stdout).record.status, "active");
  assert.equal((await validateWorkspace(root)).ok, true);
});
