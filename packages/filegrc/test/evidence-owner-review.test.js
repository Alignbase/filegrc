import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { makeComprehensiveWorkspace } from "./fixtures.js";
import { initializeGitWorkspace, commitWorkspaceFiles, writeJson } from "./helpers.js";
import { loadWorkspace, updateResource, validateWorkspace, prepareEvidencePacket, writeEvidencePacket, assessAuditPreparation } from "../src/index.js";
import { assessCompletionForObligation } from "../src/obligations.js";
import { buildAgentGuide } from "../src/agent.js";
import { currentCalendarDate } from "../src/time.js";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "filegrc-owner-review-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  let loaded = await loadWorkspace(root);
  const entry = loaded.entries.find(({ record }) => record.type === "evidence");
  const collected = { ...entry.record, status: "collected", collectedOn: "2026-07-01", generatedAt: "2026-07-01T12:00:00Z", filePaths: ["evidence/evidence-example/retained-export.csv"] };
  await mkdir(join(root, "data/evidence/evidence-example"), { recursive: true });
  await writeFile(join(root, "data", collected.filePaths[0]), "account,status\n" + Array.from({ length: 30 }, (_, index) => `fixture-${index},active\n`).join(""));
  delete collected.verifierIds; delete collected.verifiedOn; delete collected.verifiedAt;
  await writeJson(entry.path, collected);
  const vendor = loaded.entries.find(({ record }) => record.type === "vendor-review");
  await writeJson(vendor.path, { ...vendor.record, completedOn: "2026-07-01" });
  await initializeGitWorkspace(root);
  await writeJson(join(root, "data/workspace.json"), { ...loaded.workspace, dataModelVersion: "13" });
  await commitWorkspaceFiles(root, "Adopt current model with retained operating history");
  return { root, collected };
}

test("owner review satisfies artifact readiness and packet review without reopening a completed vendor assessment", async (t) => {
  const { root, collected } = await fixture(t);
  let loaded = await loadWorkspace(root);
  const audit = loaded.resources.find(({ type }) => type === "audit");
  const vendor = loaded.resources.find(({ type }) => type === "vendor-review");
  const obligation = { ...loaded.resources.find(({ type }) => type === "obligation"), activityType: "vendor-review", scopeResourceIds: [] };
  const asOf = currentCalendarDate(loaded.workspace.timezone);
  const completion = () => assessCompletionForObligation(vendor, obligation, loaded, { asOf });
  assert.equal(completion().complete, true, JSON.stringify(completion()));
  const before = await prepareEvidencePacket(root, { auditId: audit.id });
  assert.ok(before.gaps.some(({ code, resourceId }) => code === "unverified-evidence" && resourceId === collected.id));
  const beforePreparation = await assessAuditPreparation(root, { auditId: audit.id });
  assert.equal(beforePreparation.stages.flatMap(({ items }) => items).find(({ id }) => id === "evidence-external-evidence").status === "complete", false);
  const reviewer = collected.collectorIds[0];
  await updateResource(root, "evidence", collected.id, { ...collected, status: "verified", verifierIds: [reviewer], verifiedOn: asOf });
  await commitWorkspaceFiles(root, "Record actual substantive owner review");
  loaded = await loadWorkspace(root);
  assert.equal((await validateWorkspace(loaded)).counts.errors, 0);
  assert.equal(completion().complete, true);
  assert.deepEqual(loaded.resources.find(({ id }) => id === vendor.id), vendor);
  const after = await prepareEvidencePacket(root, { auditId: audit.id });
  assert.ok(!after.gaps.some(({ code }) => ["unverified-evidence", "evidence-verification-missing"].includes(code)));
  assert.ok(!after.gaps.some(({ resourceId, severity }) => resourceId === collected.id && severity === "error"), JSON.stringify(after.gaps.filter(({ resourceId }) => resourceId === collected.id)));
  assert.deepEqual(after.evidence.find(({ id }) => id === collected.id).verifierIds, [reviewer]);
  const preparation = await assessAuditPreparation(root, { auditId: audit.id });
  assert.equal(preparation.stages.flatMap(({ items }) => items).find(({ id }) => id === "evidence-external-evidence").status, "complete");
  const written = await writeEvidencePacket(root, after, { output: ".filegrc/owner-reviewed-packet" });
  assert.match(await readFile(join(written.output, "README.md"), "utf8"), /collector may also review/);
  assert.match(await readFile(join(written.output, "evidence-index.csv"), "utf8"), /Verified On.*Verifier IDs/);
  assert.match(await readFile(join(written.output, "index.html"), "utf8"), /Reviewed/);
});

test("review terminology is model-driven while policy and risk independence stay mandatory", async (t) => {
  const { root } = await fixture(t);
  const loaded = await loadWorkspace(root);
  const guide = buildAgentGuide(loaded, "evidence");
  assert.equal([...guide.requiredAtCreation, ...guide.conditionalRequirements, ...guide.optionalFields].find(({ name }) => name === "status").valueLabels.verified, "Reviewed");
  assert.equal([...guide.requiredAtCreation, ...guide.conditionalRequirements, ...guide.optionalFields].find(({ name }) => name === "verifierIds").label, "Reviewed by");
  for (const type of ["policy", "risk-assessment"]) {
    const entry = loaded.entries.find(({ record }) => record.type === type);
    const field = type === "policy" ? "approverIds" : "reviewerIds";
    const owners = type === "policy" ? entry.record.ownerIds : entry.record.assessorIds;
    await writeJson(entry.path, { ...entry.record, [field]: owners });
    const validation = await validateWorkspace(root);
    assert.ok(validation.diagnostics.some(({ message }) => message.includes(field) && message.includes("same IDs")), JSON.stringify(validation.diagnostics));
    await writeJson(entry.path, entry.record);
  }
});
