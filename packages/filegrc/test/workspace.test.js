import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAppState, createResource, deleteResource, loadWorkspace, searchResources, updateContent, updateResource, validateWorkspace } from "../src/index.js";
import { makeWorkspace } from "./helpers.js";
import { makeComprehensiveWorkspace } from "./fixtures.js";

test("loads, validates, and searches resources", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-workspace-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const validation = await validateWorkspace(root);
  assert.equal(validation.ok, true);
  assert.equal(validation.counts.resources, 2);
  const loaded = await loadWorkspace(root);
  assert.deepEqual(searchResources(loaded.resources, loaded.model, { query: "program owner" }).map(({ id }) => id), ["person-owner"]);
  assert.deepEqual(
    searchResources([{ id: "future-resource", type: "future-type" }], loaded.model, { query: "future-type" }).map(({ id }) => id),
    ["future-resource"]
  );
  await writeFile(join(root, "data", "aaa-workspace.json"), `${JSON.stringify({
    schemaVersion: 1,
    dataModelVersion: "999",
    id: "workspace-alternate",
    type: "workspace",
    title: "Alternate workspace",
    organizationName: "Alternate",
    timezone: "UTC"
  })}\n`, "utf8");
  const reloaded = await loadWorkspace(root);
  assert.equal(reloaded.workspace.organizationName, "Test Organization");
  assert.equal(reloaded.model.modelVersion, "1");
});

test("rejects an invalid workspace timezone", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-timezone-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const workspacePath = join(root, "data", "workspace.json");
  const workspace = JSON.parse(await readFile(workspacePath, "utf8"));
  await writeFile(workspacePath, `${JSON.stringify({ ...workspace, timezone: "Not/A-Timezone" }, null, 2)}\n`, "utf8");

  const validation = await validateWorkspace(root);
  assert.equal(validation.ok, false);
  assert.equal(validation.diagnostics.some(({ message }) => message.includes("IANA time zone")), true);
});

test("CRUD writes formatted JSON and never leaves an invalid workspace", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-crud-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const person = {
    schemaVersion: 1,
    id: "person-reviewer",
    type: "person",
    title: "Reviewer",
    status: "active"
  };
  await createResource(root, person);
  const personPath = join(root, "data", "people", "person-reviewer.json");
  await chmod(personPath, 0o640);
  person.role = "Reviewer";
  await updateResource(root, "person", "person-reviewer", person);
  const source = await readFile(personPath, "utf8");
  assert.match(source, /"role": "Reviewer"/);
  assert.equal((await stat(personPath)).mode & 0o777, 0o640);
  await deleteResource(root, "person", "person-reviewer");
  assert.equal((await validateWorkspace(root)).ok, true);

  const ownerPath = join(root, "data", "people", "person-owner.json");
  await chmod(ownerPath, 0o640);
  await createResource(root, {
    schemaVersion: 1,
    id: "policy-owner-reference",
    type: "policy",
    title: "Owner reference",
    status: "draft",
    contentPath: "content/policy-owner-reference.md",
    ownerIds: ["person-owner"],
    approverIds: ["person-owner"]
  }, { content: { "content/policy-owner-reference.md": "# Owner reference" } });
  await assert.rejects(deleteResource(root, "person", "person-owner"), /leave the workspace invalid/i);
  assert.equal((await stat(ownerPath)).mode & 0o777, 0o640);
});

test("rejects traversal through content paths and rolls back the record", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-traversal-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await assert.rejects(createResource(root, {
    schemaVersion: 1,
    id: "document-unsafe",
    type: "document",
    title: "Unsafe",
    status: "draft",
    documentKind: "procedure",
    contentPath: "../outside.md",
    ownerIds: ["person-owner"]
  }), /leave the workspace invalid/i);
  assert.equal((await loadWorkspace(root)).resources.some(({ id }) => id === "document-unsafe"), false);
  const policy = {
    schemaVersion: 1,
    id: "policy-unsafe",
    type: "policy",
    title: "Unsafe policy",
    status: "draft",
    contentPath: "content/../escaped.md",
    ownerIds: ["person-owner"],
    approverIds: ["person-owner"]
  };
  await assert.rejects(
    createResource(root, policy, { content: { [policy.contentPath]: "# Escaped" } }),
    /under data\/content/i
  );
  await assert.rejects(readFile(join(root, "data", "escaped.md"), "utf8"), /ENOENT/);
});

test("rejects content symlinks that resolve outside data", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-symlink-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const outside = join(root, "outside.md");
  await writeFile(outside, "# Outside", "utf8");
  await symlink(outside, join(root, "data", "outside-link.md"));
  await assert.rejects(createResource(root, {
    schemaVersion: 1,
    id: "document-outside-link",
    type: "document",
    title: "Outside link",
    status: "draft",
    documentKind: "procedure",
    contentPath: "outside-link.md",
    ownerIds: ["person-owner"]
  }), /unavailable data path/i);
});

test("rejects a data directory that resolves outside the workspace", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-external-data-root-"));
  const outside = await mkdtemp(join(tmpdir(), "filegrc-external-data-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(outside, { recursive: true, force: true })
  ])));
  await makeWorkspace(outside);
  await symlink(join(outside, "data"), join(root, "data"));

  await assert.rejects(loadWorkspace(root), /data directory resolves outside the workspace/);
});

test("content and attachment paths must resolve to files", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-data-path-file-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await mkdir(join(root, "data", "content", "directory.md"), { recursive: true });
  await assert.rejects(createResource(root, {
    schemaVersion: 1,
    id: "policy-directory",
    type: "policy",
    title: "Directory policy",
    status: "draft",
    contentPath: "content/directory.md",
    ownerIds: ["person-owner"],
    approverIds: ["person-owner"]
  }), /unavailable data path/i);
});

test("validates a realistic workspace containing every resource type", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-comprehensive-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  const { model } = await makeComprehensiveWorkspace(root);
  const validation = await validateWorkspace(root);
  assert.equal(validation.counts.resources, Object.keys(model.resources).length);
  assert.deepEqual(validation.diagnostics, []);
});

test("creates and updates Markdown content with its resource", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-content-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const policy = {
    schemaVersion: 1,
    id: "policy-access-control",
    type: "policy",
    title: "Access Control Policy",
    status: "draft",
    contentPath: "content/policy-access-control.md",
    ownerIds: ["person-owner"],
    approverIds: ["person-owner"]
  };
  await assert.rejects(createResource(root, { ...policy, id: "policy-invalid-content" }, { content: "" }), /keyed by data-relative/);
  await createResource(root, policy, { content: { [policy.contentPath]: "# Access Control Policy\n\nDraft content." } });
  assert.match(await readFile(join(root, "data", policy.contentPath), "utf8"), /Draft content/);
  await updateContent(root, policy.contentPath, "# Access Control Policy\n\nUpdated content.");
  assert.match(await readFile(join(root, "data", policy.contentPath), "utf8"), /Updated content/);
  const contentRevision = (await createAppState(root)).resources.find(({ record }) => record.id === policy.id).content.contentPath.revision;
  await writeFile(join(root, "data", policy.contentPath), "# Access Control Policy\n\nExternal edit.\n", "utf8");
  await assert.rejects(
    updateContent(root, policy.contentPath, "# Access Control Policy\n\nStale edit.", { expectedRevision: contentRevision }),
    /changed after you opened/i
  );
  assert.match(await readFile(join(root, "data", policy.contentPath), "utf8"), /External edit/);
  const deletion = await deleteResource(root, "policy", policy.id);
  assert.deepEqual(deletion.deletedContent, [policy.contentPath]);
  await assert.rejects(readFile(join(root, "data", policy.contentPath), "utf8"), /ENOENT/);
  assert.equal((await validateWorkspace(root)).ok, true);
});

test("keeps Markdown still referenced by another resource", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-shared-content-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const contentPath = "content/shared-governance.md";
  const policy = {
    schemaVersion: 1,
    id: "policy-shared",
    type: "policy",
    title: "Shared Policy",
    status: "draft",
    contentPath,
    ownerIds: ["person-owner"],
    approverIds: ["person-owner"]
  };
  await createResource(root, policy, { content: { [contentPath]: "# Shared governance content" } });
  await createResource(root, {
    schemaVersion: 1,
    id: "document-shared",
    type: "document",
    title: "Shared Document",
    status: "draft",
    documentKind: "procedure",
    contentPath,
    ownerIds: ["person-owner"]
  });
  const deletion = await deleteResource(root, "policy", policy.id);
  assert.deepEqual(deletion.deletedContent, []);
  assert.match(await readFile(join(root, "data", contentPath), "utf8"), /Shared governance/);
  assert.equal((await validateWorkspace(root)).ok, true);
});

test("rejects empty required relationships and rolls back bundled content", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-required-array-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const policy = {
    schemaVersion: 1,
    id: "policy-no-owner",
    type: "policy",
    title: "Policy without owner",
    status: "draft",
    contentPath: "content/policy-no-owner.md",
    ownerIds: [],
    approverIds: []
  };
  await assert.rejects(
    createResource(root, policy, { content: { [policy.contentPath]: "# Policy" } }),
    /required field/i
  );
  await assert.rejects(readFile(join(root, "data", policy.contentPath), "utf8"), /ENOENT/);
});

test("does not count an empty array as a one-of value", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-empty-choice-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await assert.rejects(createResource(root, {
    schemaVersion: 1,
    id: "evidence-empty",
    type: "evidence",
    title: "Empty evidence",
    status: "collected",
    evidenceKind: "screenshot",
    source: "Manual capture",
    collectedOn: "2026-07-25",
    classification: "internal",
    filePaths: []
  }), /at least one of/i);
});

test("serializes concurrent writes and rejects stale deletion", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-concurrent-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const person = {
    schemaVersion: 1,
    id: "person-concurrent",
    type: "person",
    title: "Concurrent editor",
    status: "active"
  };
  await createResource(root, person);
  const initialEntry = (await createAppState(root)).resources.find(({ record }) => record.id === person.id);
  const results = await Promise.allSettled([
    updateResource(root, person.type, person.id, { ...person, role: "First edit" }, { expectedRevision: initialEntry.revision }),
    updateResource(root, person.type, person.id, { ...person, role: "Second edit" }, { expectedRevision: initialEntry.revision })
  ]);
  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
  assert.match(results.find(({ status }) => status === "rejected").reason.message, /changed after you opened/i);

  await assert.rejects(
    deleteResource(root, person.type, person.id, { expectedRevision: initialEntry.revision }),
    /changed after you opened/i
  );
  const currentEntry = (await createAppState(root)).resources.find(({ record }) => record.id === person.id);
  await deleteResource(root, person.type, person.id, { expectedRevision: currentEntry.revision });
});

test("treats JSON files inside evidence directories as attachments", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-json-evidence-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const evidenceDirectory = join(root, "data", "evidence", "evidence-json-export");
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(join(evidenceDirectory, "export.json"), '{"events":[{"result":"allowed"}]}\n', "utf8");
  await createResource(root, {
    schemaVersion: 1,
    id: "evidence-json-export",
    type: "evidence",
    title: "JSON event export",
    status: "collected",
    evidenceKind: "export",
    source: "Source system",
    collectedOn: "2026-07-25",
    classification: "internal",
    filePaths: ["evidence/evidence-json-export/export.json"]
  });
  const validation = await validateWorkspace(root);
  assert.equal(validation.ok, true);
  assert.equal(validation.counts.resources, 3);
});
