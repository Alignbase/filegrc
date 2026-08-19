import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  activatePolicies,
  createResource,
  currentCalendarDate,
  loadWorkspace,
  planPolicyActivation,
  serveWorkspace,
  updateResource
} from "../src/index.js";
import { makeWorkspace, writeJson } from "./helpers.js";

const execute = promisify(execFile);
const cli = fileURLToPath(new URL("../bin/filegrc.js", import.meta.url));

test("activates selected approved Policies atomically through the domain and CLI", async (context) => {
  const root = await policyWorkspace(context, "filegrc-policy-cutover-");
  const effectiveOn = currentCalendarDate("UTC");
  const loaded = await loadWorkspace(root);
  const expectedRevisions = Object.fromEntries(loaded.entries
    .filter(({ record }) => record.type === "policy")
    .map(({ record, source }) => [record.id, createHash("sha256").update(source).digest("hex")]));
  const policyIds = Object.keys(expectedRevisions);

  const preview = await planPolicyActivation(root, { policyIds, effectiveOn, expectedRevisions });
  assert.equal(preview.changes.update.length, 2);
  assert.ok(Object.values(expectedRevisions).every((revision) => /^[a-f0-9]{64}$/.test(revision)));
  assert.ok(preview.changes.update.every(({ status }) => status === "active"));
  await assert.rejects(activatePolicies(root, { policyIds, effectiveOn }), /confirm/);
  await assert.rejects(
    planPolicyActivation(root, { policyIds, effectiveOn, expectedRevisions: {} }),
    /needs the current revision/
  );
  await assert.rejects(
    planPolicyActivation(root, { policyIds, effectiveOn: "2000-01-01" }),
    /has passed.*do not backdate/
  );

  const payloadPath = join(root, "policy-activation.json");
  await writeJson(payloadPath, { policyIds, effectiveOn, expectedRevisions });
  const cliPreview = JSON.parse((await execute(process.execPath, [
    cli,
    "activate-policies",
    payloadPath,
    "--preview",
    "--json",
    "--root",
    root
  ])).stdout);
  assert.deepEqual(cliPreview.policyIds, policyIds);
  await execute(process.execPath, [cli, "activate-policies", payloadPath, "--yes", "--json", "--root", root]);
  const active = (await loadWorkspace(root)).resources.filter(({ id }) => policyIds.includes(id));
  assert.ok(active.every((policy) => policy.status === "active" && policy.effectiveOn === effectiveOn));
});

test("activates selected approved Policies through the shared HTTP cutover", async (context) => {
  const root = await policyWorkspace(context, "filegrc-policy-cutover-api-");
  const loaded = await loadWorkspace(root);
  const policyEntries = loaded.entries.filter(({ record }) => record.type === "policy");
  const policyIds = [policyEntries[0].record.id];
  const result = await serveWorkspace(root, { port: 0, allowNonAuthoritativeWrites: true });
  context.after(() => new Promise((resolve) => result.server.close(resolve)));
  const response = await fetch(`${result.url}/api/policy-activations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      policyIds,
      effectiveOn: currentCalendarDate("UTC"),
      expectedRevisions: { [policyIds[0]]: createHash("sha256").update(policyEntries[0].source).digest("hex") }
    })
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.policyIds, policyIds);
  const policies = (await loadWorkspace(root)).resources.filter(({ type }) => type === "policy");
  assert.equal(policies.find(({ id }) => id === policyIds[0]).status, "active");
  assert.equal(policies.find(({ id }) => id !== policyIds[0]).status, "approved");
});

async function policyWorkspace(context, prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  for (const id of ["policy-access", "policy-change"]) {
    await createResource(root, {
      id,
      type: "policy",
      title: id === "policy-access" ? "Access Policy" : "Change Policy",
      status: "draft",
      ownerIds: ["person-owner"]
    }, {
      content: { content: `# ${id}\n\nManagement-approved requirements.` }
    });
    const entry = (await loadWorkspace(root)).entries.find(({ record }) => record.id === id);
    await updateResource(root, "policy", id, {
      ...entry.record,
      status: "approved",
      approverIds: ["person-approver"],
      approvedOn: currentCalendarDate("UTC")
    }, { expectedRevision: entry.revision });
  }
  assert.match(await readFile(join(root, "data", "policies", "policy-access.md"), "utf8"), /Management-approved/);
  return root;
}
