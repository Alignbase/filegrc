import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  applyModelMigration,
  createResource,
  planModelMigration,
  validateWorkspace
} from "../src/index.js";
import { makeWorkspace } from "./helpers.js";

test("plans and explicitly applies the v1-to-v2 companion Markdown migration", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-migrate-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await writeFile(join(root, ".gitignore"), ".filegrc/\n", "utf8");
  const policy = {
    schemaVersion: 1,
    id: "policy-migration",
    type: "policy",
    title: "Migration Policy",
    status: "draft",
    contentPath: "content/policy-migration-source.md",
    ownerIds: ["person-owner"],
    approverIds: ["person-owner"]
  };
  await createResource(root, policy, { content: { [policy.contentPath]: "# Migration Policy\n\nPolicy text." } });
  const finding = {
    schemaVersion: 1,
    id: "finding-migration",
    type: "finding",
    title: "Migration Finding",
    status: "open",
    severity: "low",
    sourceResourceId: policy.id,
    description: "Migration test finding.",
    ownerIds: ["person-owner"],
    notesPath: "content/finding-migration-source.md"
  };
  await createResource(root, finding, { content: { [finding.notesPath]: "# Migration Finding\n\nFinding details." } });
  git(root, ["init"]);
  git(root, ["config", "user.name", "Test User"]);
  git(root, ["config", "user.email", "test@example.test"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "Initial workspace"]);

  const plan = await planModelMigration(root, "2");
  assert.deepEqual(plan.summary, { records: 4, changedRecords: 3, markdownFiles: 2, blockers: 0 });
  assert.deepEqual(plan.markdown.map(({ from, to }) => [from, to]), [
    ["data/content/finding-migration-source.md", "data/findings/finding-migration.md"],
    ["data/content/policy-migration-source.md", "data/policies/policy-migration.md"]
  ]);
  assert.equal(JSON.parse(await readFile(join(root, "data", "workspace.json"), "utf8")).dataModelVersion, "1");

  const result = await applyModelMigration(root, "2");
  assert.match(result.backup, /^\.filegrc\/migrations\//);
  assert.equal(JSON.parse(await readFile(join(root, "data", "workspace.json"), "utf8")).dataModelVersion, "2");
  const migratedPolicy = JSON.parse(await readFile(join(root, "data", "policies", "policy-migration.json"), "utf8"));
  const migratedFinding = JSON.parse(await readFile(join(root, "data", "findings", "finding-migration.json"), "utf8"));
  assert.equal("contentPath" in migratedPolicy, false);
  assert.equal("notesPath" in migratedFinding, false);
  assert.match(await readFile(join(root, "data", "policies", "policy-migration.md"), "utf8"), /Policy text/);
  assert.match(await readFile(join(root, "data", "findings", "finding-migration.md"), "utf8"), /Finding details/);
  await assert.rejects(access(join(root, "data", "content", "policy-migration-source.md")), /ENOENT/);
  assert.equal((await validateWorkspace(root)).ok, true);
});

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" });
}
