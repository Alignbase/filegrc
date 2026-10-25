import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { makeComprehensiveWorkspace } from "./fixtures.js";
import { initializeGitWorkspace, commitWorkspaceFiles, writeJson } from "./helpers.js";
import { loadWorkspace, updateResource, validateWorkspace } from "../src/index.js";
import { addEvidenceAttachment, removeEvidenceAttachment, updateContent } from "../src/files.js";
import { validateWorkflowHistoryIntegrity } from "../src/workflow-history-integrity.js";
import { evidenceObservationMatches } from "../src/evidence-observation.js";
import { workflowProofIds } from "../src/workflow-proof.js";
import { currentCalendarDate } from "../src/time.js";

async function fixture(t, { timezone, emptyVerification = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "filegrc-evidence-verification-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "13");
  const loaded = await loadWorkspace(root);
  if (timezone) {
    loaded.workspace.timezone = timezone;
    await writeJson(join(root, "data/workspace.json"), loaded.workspace);
  }
  const evidence = loaded.resources.find(({ type }) => type === "evidence");
  const proof = { ...evidence, id: "evidence-retained-observation", title: "Retained observation", status: "collected",
    filePaths: ["evidence/evidence-retained-observation/export.txt"] };
  delete proof.verifierIds; delete proof.verifiedOn; delete proof.verifiedAt;
  if (emptyVerification) Object.assign(proof, { verifierIds: [], verifiedOn: null, verifiedAt: null });
  const folder = join(root, "data/evidence", proof.id);
  await mkdir(folder, { recursive: true });
  const path = join(folder, "evidence.json"), markdown = join(folder, "evidence.md");
  await writeJson(path, proof);
  await writeFile(markdown, "# Observation\n\nThe retained export records the actual observed population.\n");
  await writeFile(join(root, "data", proof.filePaths[0]), "Original fixed observation\n");
  for (const owner of loaded.entries.filter(({ record }) => ["attestation", "exception", "access-grant"].includes(record.type))) {
    await writeJson(owner.path, { ...owner.record, evidenceIds: [...(owner.record.evidenceIds || []), proof.id] });
  }
  const population = loaded.entries.find(({ record }) => record.type === "audit-population");
  await writeJson(population.path, { ...population.record, status: "reconciled", sourceEvidenceId: proof.id,
    sourceComponentId: "component-example", reconciledByIds: ["person-example"], reconciledOn: "2026-07-07", conclusion: "complete" });
  await initializeGitWorkspace(root);
  return { root, proof, path, markdown, promote: { ...proof, status: "verified", verifiedOn: currentCalendarDate(loaded.workspace.timezone), verifierIds: ["person-independent-approver-example"] } };
}
async function integrity(root) {
  const diagnostics = [];
  await validateWorkflowHistoryIntegrity(await loadWorkspace(root), diagnostics);
  return diagnostics;
}

test("one additive verification preserves collected proof across finalized owners and freezes its metadata", async (t) => {
  const f = await fixture(t), loaded = await loadWorkspace(f.root);
  for (const type of ["attestation", "exception", "obligation-occurrence", "audit-population"]) {
    const owner = loaded.resources.find((record) => record.type === type);
    assert.ok(workflowProofIds(owner, (id) => loaded.resources.find((record) => record.id === id)).has(f.proof.id), type);
  }
  const original = await integrity(f.root);
  assert.ok(!original.some(({ message }) => message.includes(f.proof.id)), JSON.stringify(original));
  const validation = await validateWorkspace(f.root);
  assert.ok(validation.diagnostics.every(({ code }) => code === "schedule-set-approval-required"), JSON.stringify(validation.diagnostics));
  const content = await readFile(f.markdown, "utf8");
  await updateResource(f.root, "evidence", f.proof.id, f.promote, { content: { content: content } });
  assert.deepEqual(await integrity(f.root), original);
  assert.equal(await readFile(f.markdown, "utf8"), content);
  await commitWorkspaceFiles(f.root, "Independently verify retained observation");
  assert.deepEqual(await integrity(f.root), original);
  const reordered = Object.fromEntries(Object.entries(f.promote).reverse());
  reordered.coverage = Object.fromEntries(Object.entries(reordered.coverage).reverse());
  await updateResource(f.root, "evidence", f.proof.id, reordered);
  assert.deepEqual(await integrity(f.root), original);
  for (const record of [f.proof, { ...f.promote, verifierIds: ["person-example"] }, { ...f.promote, verifiedOn: "2026-07-08" }, { ...f.promote, status: "withdrawn" }]) {
    await assert.rejects(updateResource(f.root, "evidence", f.proof.id, record), /immutable/);
  }
  await writeJson(f.path, { ...f.promote, verifiedOn: "2026-07-08" });
  const tampered = (await integrity(f.root)).filter(({ message }) => message.includes(f.proof.id));
  for (const type of ["attestation", "exception", "obligation-occurrence", "audit-population"]) assert.ok(tampered.some(({ message }) => message.includes(type)), type);
  await writeJson(f.path, f.proof);
  assert.ok((await integrity(f.root)).some(({ message }) => message.includes(f.proof.id)));
});

test("promotion rejects observation rewrites, conflicted verifiers and backdated or future verification", async (t) => {
  const f = await fixture(t);
  const variants = [
    { ...f.promote, title: "Different observation" }, { ...f.promote, sourceResourceIds: ["control-example"] },
    { ...f.promote, filePaths: [] }, { ...f.promote, collectorIds: ["person-independent-approver-example"] },
    { ...f.promote, collectedOn: "2026-07-02" }, { ...f.promote, verifierIds: f.proof.collectorIds },
    { ...f.promote, verifierIds: [] }, { ...f.promote, verifierIds: ["appointment-example"] },
    { ...f.promote, verifiedOn: "2026-07-08" }, { ...f.promote, verifiedOn: "2999-01-01" },
    { ...f.promote, verifiedAt: "2999-01-01T12:00:00Z" }
  ];
  const original = await readFile(f.path, "utf8");
  for (const record of variants) {
    await assert.rejects(updateResource(f.root, "evidence", f.proof.id, record), /immutable|invalid/);
    assert.equal(await readFile(f.path, "utf8"), original);
  }
  await assert.rejects(updateResource(f.root, "evidence", f.proof.id, f.promote, { content: { content: "Changed observation" } }), /immutable/);
  await assert.rejects(updateContent(f.root, "evidence/evidence-retained-observation/evidence.md", "Changed observation"), /immutable/);
  await assert.rejects(addEvidenceAttachment(f.root, f.proof.id, f.markdown), /immutable/);
  await assert.rejects(removeEvidenceAttachment(f.root, f.proof.id, f.proof.filePaths[0]), /immutable/);
  const loaded = await loadWorkspace(f.root), commit = loaded.git?.commit;
  assert.equal(evidenceObservationMatches(f.proof, f.promote, loaded, commit), true);
  await writeFile(join(f.root, "data", f.proof.filePaths[0]), "Replaced observation\n");
  assert.ok((await integrity(f.root)).some(({ code, path }) => code === "rewritten-finalized-attachment" && path.includes(f.proof.id)));
});


test("empty verifier metadata allows promotion and committed verification retains its timezone", async (t) => {
  const f = await fixture(t, { timezone: "Etc/GMT+12", emptyVerification: true });
  const loaded = await loadWorkspace(f.root);
  const workspaceEntry = loaded.entries.find(({ record }) => record.type === "workspace");
  const workspace = workspaceEntry.record, collected = f.proof;
  const verifiedAt = new Date().toISOString();
  const promoted = { ...collected, status: "verified", verifierIds: ["person-independent-approver-example"],
    verifiedAt, verifiedOn: currentCalendarDate(workspace.timezone, new Date(verifiedAt)) };
  await updateResource(f.root, "evidence", collected.id, promoted);
  await commitWorkspaceFiles(f.root, "Verify observation in its actual timezone");
  await writeJson(workspaceEntry.path, { ...workspace, timezone: "Pacific/Kiritimati" });
  await commitWorkspaceFiles(f.root, "Change current workspace timezone");
  assert.ok(!(await integrity(f.root)).some(({ message }) => message.includes(f.proof.id)));
  await writeJson(f.path, { ...promoted, verifiedOn: currentCalendarDate("Pacific/Kiritimati", new Date(verifiedAt)) });
  assert.ok((await integrity(f.root)).some(({ message }) => message.includes(f.proof.id)));
});


test("historical promotion cannot become valid through time passing or later verifier inventory", async (t) => {
  const f = await fixture(t);
  const commitAt = (at, message) => {
    execFileSync("git", ["add", "."], { cwd: f.root });
    execFileSync("git", ["-c", "commit.gpgSign=false", "commit", "--allow-empty", "-m", message],
      { cwd: f.root, env: { ...process.env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at } });
  };
  execFileSync("git", ["-c", "commit.gpgSign=false", "commit", "--amend", "--no-edit", "--date=2026-07-01T12:00:00Z"],
    { cwd: f.root, env: { ...process.env, GIT_COMMITTER_DATE: "2026-07-01T12:00:00Z" } });
  const loaded = await loadWorkspace(f.root), reliedOn = execFileSync("git", ["rev-parse", "HEAD"], { cwd: f.root, encoding: "utf8" }).trim();
  const premature = { ...f.promote, verifiedOn: "2026-07-03", verifiedAt: "2026-07-03T12:00:00Z" };
  await writeJson(f.path, premature);
  commitAt("2026-07-02T12:00:00Z", "Record invalid future verification");
  assert.equal(evidenceObservationMatches(f.proof, premature, await loadWorkspace(f.root), reliedOn), false);
  execFileSync("git", ["reset", "--hard", reliedOn], { cwd: f.root });
  const missingPerson = { ...f.promote, verifiedOn: "2026-07-02", verifierIds: ["person-added-after-verification"] };
  await writeJson(f.path, missingPerson);
  commitAt("2026-07-02T12:00:00Z", "Record verification naming absent person");
  const person = loaded.resources.find(({ id }) => id === "person-independent-approver-example");
  await writeJson(join(f.root, "data/people/person-added-after-verification.json"), { ...person, id: "person-added-after-verification" });
  commitAt("2026-07-04T12:00:00Z", "Add later person inventory");
  assert.equal(evidenceObservationMatches(f.proof, missingPerson, await loadWorkspace(f.root), reliedOn), false);
});
