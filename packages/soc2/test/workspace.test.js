import assert from "node:assert/strict";
import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createResource, deleteResource, loadWorkspace, searchResources, updateResource, validateWorkspace } from "../src/index.js";
import { makeWorkspace } from "./helpers.js";

test("loads, validates, and searches resources", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "soc2-workspace-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const validation = await validateWorkspace(root);
  assert.equal(validation.ok, true);
  assert.equal(validation.counts.resources, 2);
  const loaded = await loadWorkspace(root);
  assert.deepEqual(searchResources(loaded.resources, loaded.model, { query: "program owner" }).map(({ id }) => id), ["person-owner"]);
});

test("CRUD writes formatted JSON and never leaves an invalid workspace", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "soc2-crud-"));
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
  person.role = "Reviewer";
  await updateResource(root, "person", "person-reviewer", person);
  const source = await readFile(join(root, "data", "people", "person-reviewer.json"), "utf8");
  assert.match(source, /"role": "Reviewer"/);
  await deleteResource(root, "person", "person-reviewer");
  assert.equal((await validateWorkspace(root)).ok, true);
});

test("rejects traversal through content paths and rolls back the record", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "soc2-traversal-"));
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
});

test("rejects content symlinks that resolve outside data", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "soc2-symlink-"));
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
  }), /outside data/i);
});
