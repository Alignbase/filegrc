import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCli } from "../src/cli.js";
import { contentRevision, updateResource } from "../src/files.js";
import { setGitSubprocessObserverForTests, setHistoricalRevisionReadObserverForTests } from "../src/git.js";
import { markdownEntries } from "../src/resource-markdown.js";
import { createResourceDetail, readResourceMutation } from "../src/state.js";
import { collectTimings } from "../src/timing.js";
import { loadWorkspace } from "../src/workspace.js";
import { makeComprehensiveWorkspace } from "./fixtures.js";
import { captureCli } from "./helpers.js";

async function mutationFixture(context) {
  const root = await mkdtemp(join(tmpdir(), "filegrc-resource-mutation-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const record = {
    id: "meeting-export-example", type: "meeting", title: "Planned review", status: "planned",
    teamId: "team-example", scheduledFor: "2026-10-01", chairIds: ["person-example"]
  };
  const recordPath = join(root, "data", "meetings", `${record.id}.json`);
  const source = `${JSON.stringify(record, null, 4)}\r\n`;
  await mkdir(join(root, "data", "meetings"), { recursive: true });
  await writeFile(recordPath, source, "utf8");
  const loaded = await loadWorkspace(root);
  const slots = markdownEntries(loaded.model, record);
  const content = { agenda: "# Review agenda\r\n\r\nReview access for café staff.", minutes: "" };
  for (const slot of slots) await writeFile(join(root, "data", slot.path), content[slot.name], "utf8");
  return { root, record, recordPath, source, slots, content };
}

function updateFromMutation(root, mutation) {
  return updateResource(root, mutation.record.type, mutation.record.id, mutation.record, {
    content: mutation.content, expectedRevision: mutation.revision,
    expectedContentRevisions: mutation.contentRevisions, requireExpectedContentRevisions: true
  });
}

test("mutation export preserves exact record and all companion bytes, paths and revisions", async (context) => {
  const { root, record, source, slots, content } = await mutationFixture(context);
  const mutation = await readResourceMutation(root, record.type, record.id);
  assert.deepEqual(mutation.record, record);
  assert.equal(mutation.revision, contentRevision(source));
  assert.deepEqual(mutation.content, content);
  assert.deepEqual(mutation.contentRevisions, Object.fromEntries(slots.map((slot) => [slot.path, contentRevision(content[slot.name])])));
  const loaded = await loadWorkspace(root);
  const detail = await createResourceDetail(loaded, record.type, record.id, { includeHistory: false });
  assert.equal(detail.revision, mutation.revision);
  for (const slot of slots) {
    assert.equal(detail.content[slot.name].source, mutation.content[slot.name]);
    assert.equal(detail.content[slot.name].revision, mutation.contentRevisions[slot.path]);
  }
  for (const args of [[record.id], [record.type, record.id]]) {
    const exported = await captureCli(runCli, ["get", ...args, "--mutation", "--root", root]);
    assert.deepEqual(exported.result, mutation);
    assert.deepEqual(JSON.parse(exported.stdout), mutation);
  }
});

test("mutation export skips unrelated workflow, validation and Git history calculation", async (context) => {
  const { root, record } = await mutationFixture(context);
  // Unrelated broken source remains visible to validation but cannot prevent
  // the owner from reading an existing record for repair.
  await writeFile(join(root, "data", "unrelated-invalid.json"), "{invalid", "utf8");
  let subprocesses = 0;
  let historicalReads = 0;
  const restoreSubprocesses = setGitSubprocessObserverForTests(() => { subprocesses++; });
  const restoreReads = setHistoricalRevisionReadObserverForTests(() => { historicalReads++; });
  let measured;
  try {
    measured = await collectTimings(() => captureCli(runCli, ["get", record.id, "--mutation", "--root", root]));
  } finally {
    restoreSubprocesses();
    restoreReads();
  }
  assert.equal(measured.result.result.record.id, record.id);
  assert.equal(measured.timings["workspace-load"].count, 1);
  assert.equal(measured.timings.validation, undefined);
  assert.equal(measured.timings["workflow-assessment"], undefined);
  assert.equal(measured.timings["git-history-export"], undefined);
  assert.equal(subprocesses, 0);
  assert.equal(historicalReads, 0);
});

test("mutation export covers singleton, nested and implicit Markdown records and omits missing companions", async (context) => {
  const { root } = await mutationFixture(context);
  const loaded = await loadWorkspace(root);
  for (const type of ["workspace", "evidence", "person", "policy"]) {
    const entry = loaded.entries.find(({ record }) => record.type === type);
    const mutation = await readResourceMutation(loaded, type, entry.record.id);
    assert.deepEqual(mutation.record, entry.record, type);
    assert.equal(mutation.revision, contentRevision(entry.source), type);
    const expectedContent = {};
    const expectedRevisions = {};
    for (const slot of markdownEntries(loaded.model, entry.record)) {
      let source;
      try { source = await readFile(join(root, "data", slot.path), "utf8"); }
      catch (error) { if (error.code === "ENOENT") continue; throw error; }
      expectedContent[slot.name] = source;
      expectedRevisions[slot.path] = contentRevision(source);
    }
    assert.deepEqual(mutation.content, Object.keys(expectedContent).length ? expectedContent : undefined, type);
    assert.deepEqual(mutation.contentRevisions, Object.keys(expectedContent).length ? expectedRevisions : undefined, type);
  }
  await assert.rejects(readResourceMutation(loaded, "vendor", "person-example"), /Resource "vendor\/person-example" was not found/);
  await assert.rejects(readResourceMutation(loaded, null, "missing-resource"), /Resource "missing-resource" was not found/);
});

test("exported mutation rejects a stale JSON revision without overwriting newer source", async (context) => {
  const { root, record, recordPath } = await mutationFixture(context);
  const mutation = await readResourceMutation(root, record.type, record.id);
  const newer = `${JSON.stringify({ ...record, title: "Newer source title" }, null, 2)}\n`;
  await writeFile(recordPath, newer, "utf8");
  await assert.rejects(updateFromMutation(root, mutation), /The record changed after you opened it/);
  assert.equal(await readFile(recordPath, "utf8"), newer);
});

test("exported mutation protects each companion independently and requires every existing revision", async (context) => {
  const { root, record, recordPath, slots, content, source } = await mutationFixture(context);
  for (const slot of slots) {
    const mutation = await readResourceMutation(root, record.type, record.id);
    const newer = `${content[slot.name]}\nNewer ${slot.name}.\n`;
    await writeFile(join(root, "data", slot.path), newer, "utf8");
    await assert.rejects(updateFromMutation(root, mutation), /Content at data\/.* changed after you opened it/, slot.name);
    assert.equal(await readFile(join(root, "data", slot.path), "utf8"), newer);
    assert.equal(await readFile(recordPath, "utf8"), source);
    await writeFile(join(root, "data", slot.path), content[slot.name], "utf8");
    delete mutation.contentRevisions[slot.path];
    await assert.rejects(updateFromMutation(root, mutation), /A content revision is required for existing content/, slot.name);
  }
});

test("lightweight export keeps full mutation validation and permits a current valid edit", async (context) => {
  const { root, record, recordPath, source } = await mutationFixture(context);
  const invalid = await readResourceMutation(root, record.type, record.id);
  invalid.record.status = "unknown-status";
  const measured = await collectTimings(() => assert.rejects(updateFromMutation(root, invalid), /unknown-status|must be one of/i));
  assert.ok(measured.timings.validation.count >= 2);
  assert.equal(await readFile(recordPath, "utf8"), source);
  const current = await readResourceMutation(root, record.type, record.id);
  current.record.title = "Reviewed meeting plan";
  await updateFromMutation(root, current);
  assert.equal(JSON.parse(await readFile(recordPath, "utf8")).title, current.record.title);
});

test("mutation export does not hide an unreadable companion as an absent optional file", async context => {
  const { root, record, slots } = await mutationFixture(context);
  const path = join(root, "data", slots[0].path);
  await rm(path); await mkdir(path);
  await assert.rejects(readResourceMutation(root, record.type, record.id));
});
