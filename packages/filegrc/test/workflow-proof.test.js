import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadWorkspace, updateResource, validateWorkspace } from "../src/index.js";
import { validateWorkflowHistoryIntegrity } from "../src/workflow-history-integrity.js";
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
  const attachment = evidence.record.filePaths?.[0];
  assert.ok(attachment);
  const original = await readFile(join(root, "data", attachment));
  await writeFile(join(root, "data", attachment), Buffer.concat([original, Buffer.from("rewritten")]));
  assert.ok((await historyDiagnostics()).some(({ message }) => /attachment/i.test(message)));
});
