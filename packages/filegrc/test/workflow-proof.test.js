import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadWorkspace, updateResource, validateWorkspace } from "../src/index.js";
import { validateWorkflowHistoryIntegrity } from "../src/workflow-history-integrity.js";
import { markdownEntries } from "../src/resource-markdown.js";
import { loadModel, SUPPORTED_MODEL_VERSIONS } from "../model/index.js";
import { workflowProofIds } from "../src/workflow-proof.js";
import { makeComprehensiveWorkspace } from "./fixtures.js";
import { commitWorkspaceFiles, initializeGitWorkspace, writeJson } from "./helpers.js";

test("proof links distinguish context from evidence without losing explicit completions", () => {
  const records = new Map([
    ["completion", { id: "completion", type: "access-review", status: "complete", evidenceIds: ["proof"] }],
    ["proof", { id: "proof", type: "evidence", sourceResourceIds: ["control", "ongoing", "nested"] }],
    ["control", { id: "control", type: "control", evidenceIds: ["unrelated"] }],
    ["ongoing", { id: "ongoing", type: "access-review", status: "in-progress", evidenceIds: ["unrelated"] }],
    ["nested", { id: "nested", type: "evidence", sourceResourceIds: ["proof"] }]
  ]);
  const ids = workflowProofIds({ members: [{ completionResourceIds: ["completion"] }] }, (id) => records.get(id));
  assert.deepEqual([...ids].sort(), ["completion", "nested", "proof"]);
});

test("mutable source context evolves while finalized proof stays bound to Git", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-proof-context-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "9");
  const loaded = await loadWorkspace(root);
  const entry = (type) => loaded.entries.find(({ record }) => record.type === type);
  const occurrence = entry("obligation-occurrence");
  const completion = loaded.entries.find(({ record }) => record.id === occurrence.record.members[0].completionResourceIds[0]);
  const evidence = loaded.entries.find(({ record }) => record.id === completion.record.evidenceIds[0]);
  const control = entry("control");
  const review = entry("access-review");
  review.record.status = "in-progress";
  delete review.record.outcome;
  delete review.record.approvedOn;
  delete review.record.completedOn;
  evidence.record.sourceResourceIds = [control.record.id, review.record.id];
  evidence.record.sourceKind = "file";
  delete evidence.record.externalReference;
  delete evidence.record.sourceComponentId;
  evidence.record.filePaths = [`evidence/${evidence.record.id}/proof.txt`];
  await mkdir(join(root, "data", "evidence", evidence.record.id), { recursive: true });
  await writeFile(join(root, "data", evidence.record.filePaths[0]), "Fixed export\n");
  await writeJson(review.path, review.record);
  await writeJson(evidence.path, evidence.record);
  await initializeGitWorkspace(root);
  const historyDiagnostics = async () => {
    const diagnostics = [];
    await validateWorkflowHistoryIntegrity(await loadWorkspace(root), diagnostics);
    return diagnostics;
  };
  assert.deepEqual(await historyDiagnostics(), []);
  assert.deepEqual((await validateWorkspace(root)).diagnostics.filter(({ severity }) => severity === "error"), []);
  await updateResource(root, "control", control.record.id, { ...control.record, title: "Current endpoint procedure" });
  await writeJson(review.path, { ...review.record, title: "Ongoing current access review" });
  assert.deepEqual(await historyDiagnostics(), []);
  assert.deepEqual((await validateWorkspace(root)).diagnostics.filter(({ severity }) => severity === "error"), []);
  await commitWorkspaceFiles(root, "Update current source context");
  await writeJson(occurrence.path, { ...occurrence.record, status: "superseded" });
  assert.deepEqual(await historyDiagnostics(), []);
  await commitWorkspaceFiles(root, "Preserve superseded occurrence");
  await writeFile(completion.path, JSON.stringify({ ...completion.record, title: "Rewritten completion" }));
  assert.ok((await historyDiagnostics()).some(({ message }) => message.includes(`Proof record "${completion.record.id}" differs`)));
  await writeJson(completion.path, completion.record);
  // Removing a nested proof link from current evidence cannot hide its old proof.
  await writeJson(evidence.path, { ...evidence.record, sourceResourceIds: [] });
  assert.ok((await historyDiagnostics()).some(({ message }) => message.includes(`Proof record "${evidence.record.id}" differs`)));
  await writeJson(evidence.path, evidence.record);
  const companion = markdownEntries(loaded.model, completion.record)[0];
  const companionPath = join(root, "data", companion.path);
  const originalCompanion = await readFile(companionPath, "utf8").catch(() => null);
  await writeFile(companionPath, "# Changed single-slot proof\n");
  assert.ok((await historyDiagnostics()).some(({ code, path }) => code === "rewritten-finalized-content" && path === `data/${companion.path}`));
  if (originalCompanion === null) await rm(companionPath);
  else await writeFile(companionPath, originalCompanion);
  const attachment = evidence.record.filePaths?.[0];
  assert.ok(attachment);
  const original = await readFile(join(root, "data", attachment));
  await writeFile(join(root, "data", attachment), Buffer.concat([original, Buffer.from("rewritten")]));
  assert.ok((await historyDiagnostics()).some(({ message }) => /attachment/i.test(message)));
});


test("supported models identify every meeting companion by name", () => {
  for (const version of SUPPORTED_MODEL_VERSIONS) {
    const model = loadModel(version);
    const multiSlotTypes = Object.entries(model.resources)
      .filter(([, definition]) => Object.keys(definition.markdown || {}).length > 1)
      .map(([type]) => type);
    assert.deepEqual(multiSlotTypes, ["meeting"], `model v${version}`);
    const entries = markdownEntries(model, { type: "meeting", id: "meeting-example" });
    assert.deepEqual(entries.map(({ name }) => name), ["agenda", "minutes"]);
    assert.equal(entries.find(({ primary }) => primary).name, "minutes");
    assert.match(entries[0].path, /-agenda\.md$/);
    assert.match(entries[1].path, /meeting-example\.md$/);
  }
});

for (const { version, extended = false } of [{ version: "9" }, { version: "13" }, { version: "13", extended: true }]) {
  test(`committed meeting proof preserves each Markdown companion in model v${version}${extended ? " with extended slots" : ""}`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "filegrc-meeting-proof-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    await makeComprehensiveWorkspace(root, version);
    const extendModel = (loaded) => {
      if (extended) loaded.model.resources.meeting.markdown = {
        followUpPath: { label: "Follow-up", primary: true },
        minutes: { label: "Minutes" },
        agenda: { label: "Agenda" }
      };
      return loaded;
    };
    const loaded = extendModel(await loadWorkspace(root));
    const meeting = loaded.entries.find(({ record }) => record.type === "meeting");
    const occurrence = loaded.entries.find(({ record }) => record.type === "obligation-occurrence");
    const obligation = loaded.entries.find(({ record }) => record.type === "obligation");
    obligation.record.activityType = "meeting";
    await writeJson(obligation.path, obligation.record);
    occurrence.record.members[0].resourceId = loaded.workspace.id;
    occurrence.record.members[0].completionResourceIds = [meeting.record.id];
    await writeJson(occurrence.path, occurrence.record);
    const companions = markdownEntries(loaded.model, meeting.record);
    const originals = new Map(companions.map(({ path, name }) => [path, `# ${name}\nDistinct ${name} proof.\n`]));
    for (const [path, content] of originals) await writeFile(join(root, "data", path), content);
    await initializeGitWorkspace(root, { message: "Finalize meeting and occurrence with distinct companions" });
    const diagnostics = async () => {
      const result = [];
      await validateWorkflowHistoryIntegrity(extendModel(await loadWorkspace(root)), result);
      return result;
    };
    assert.deepEqual(await diagnostics(), []);
    if (version === "9") assert.deepEqual((await validateWorkspace(root)).diagnostics, []);
    for (const { path } of companions) {
      const absolute = join(root, "data", path);
      await writeFile(absolute, "# Changed proof\n");
      assert.ok((await diagnostics()).some((item) => item.code === "rewritten-finalized-content" && item.path === `data/${path}`));
      await writeFile(absolute, originals.get(path));
      await rm(absolute);
      assert.ok((await diagnostics()).some((item) => item.code === "rewritten-finalized-content" && item.path === `data/${path}`));
      await writeFile(absolute, originals.get(path));
    }
    assert.deepEqual(await diagnostics(), []);
    // An optional companion absent at finalization cannot be added afterward.
    const agenda = companions.find(({ name }) => name === "agenda");
    await rm(join(root, "data", agenda.path));
    // Start a separate history so the absence is part of the first final version.
    await rm(join(root, ".git"), { recursive: true, force: true });
    await initializeGitWorkspace(root, { message: "Finalize meeting without optional agenda" });
    assert.deepEqual(await diagnostics(), []);
    await writeFile(join(root, "data", agenda.path), originals.get(agenda.path));
    assert.ok((await diagnostics()).some((item) => item.code === "rewritten-finalized-content" && item.path === `data/${agenda.path}`));
  });
}
