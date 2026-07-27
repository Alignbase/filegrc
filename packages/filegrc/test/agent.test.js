import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  buildAgentGuide,
  findResourceReferences,
  listResourceTypes,
  loadWorkspace,
  scaffoldResourceMutation,
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
  assert.deepEqual(Object.keys(JSON.parse(overview.stdout).actions), [
    "help",
    "version",
    "serve",
    "setup",
    "build",
    "validate",
    "model",
    "describe",
    "types",
    "guide",
    "scaffold",
    "list",
    "search",
    "obligations",
    "auditReadiness",
    "prepareAudit",
    "trigger",
    "evidencePacket",
    "get",
    "references",
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

  for (const { type } of types) {
    const guide = buildAgentGuide(loaded, type);
    assert.equal(guide.type, type);
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
  const mutation = JSON.parse(scaffolded.stdout);
  Object.assign(mutation.record, {
    assessmentDate: "2026-07-26",
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

  const evidenceMutation = scaffoldResourceMutation(loaded, "evidence", "Risk Assessment Notes");
  Object.assign(evidenceMutation.record, {
    evidenceKind: "review",
    source: "Risk assessment session",
    collectedOn: "2026-07-26",
    classification: "Internal",
    collectorIds: ["person-owner"]
  });
  const evidenceMutationPath = join(root, "evidence-mutation.json");
  await writeFile(evidenceMutationPath, `${JSON.stringify(evidenceMutation, null, 2)}\n`, "utf8");
  await execute(process.execPath, [cli, "create", evidenceMutationPath, "--root", root]);
  const attachmentSource = join(root, "risk-notes.txt");
  await writeFile(attachmentSource, "Fixed review notes.\n", "utf8");
  const attached = await execute(process.execPath, [
    cli,
    "attach",
    evidenceMutation.record.id,
    attachmentSource,
    "--name",
    "risk-notes.txt",
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
  await assert.rejects(
    execute(process.execPath, [cli, "delete", "evidence", evidenceMutation.record.id, "--yes", "--root", root]),
    /still has local attachments/
  );
  const detached = await execute(process.execPath, [
    cli,
    "detach",
    evidenceMutation.record.id,
    "risk-notes.txt",
    "--yes",
    "--root",
    root,
    "--json"
  ]);
  assert.deepEqual(JSON.parse(detached.stdout).filePaths, []);
  await assert.rejects(readFile(join(root, attachmentResult.path), "utf8"), /ENOENT/);
  await execute(process.execPath, [
    cli,
    "delete",
    "evidence",
    evidenceMutation.record.id,
    "--yes",
    "--root",
    root
  ]);
  assert.equal(
    (await loadWorkspace(root)).resources.some(({ id }) => id === evidenceMutation.record.id),
    false
  );
  assert.equal((await validateWorkspace(root)).ok, true);
});
