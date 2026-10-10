import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import * as core from "../src/index.js";
import { makeWorkspace, writeJson, executeCli } from "./helpers.js";
import { runCli } from "../src/cli.js";
import { makeComprehensiveWorkspace } from "./fixtures.js";

const person = { id: "person-owner", type: "person", status: "active", email: "owner@example.com" };

test("contacts resolve active People, Team members and chairs, and Appointment holders without routing fields", () => {
  const chair = { ...person, id: "person-chair", email: undefined };
  const records = [null, person, chair,
    { id: "team", type: "team", status: "active", memberIds: [person.id], chairIds: [chair.id] },
    { id: "appointment", type: "appointment", status: "active", holderId: person.id }];
  assert.deepEqual(core.notificationContacts(["team", "appointment", person.id, "missing"], records), [
    { personId: chair.id }, { personId: person.id, email: person.email }
  ]);
  assert.deepEqual(core.notificationContacts([person.id], [{ ...person, email: "new@example.com" }]), [{ personId: person.id, email: "new@example.com" }]);
  assert.deepEqual(core.notificationContacts(["team", "appointment", person.id], records.map(record => record && ({ ...record, status: "inactive" }))), []);
  assert.equal(Object.hasOwn(core, "loadNotificationConfig"), false);
  assert.equal(Object.hasOwn(core, "validateNotificationConfig"), false);
});

test("workspace loading and validation ignore removed notification files, including malformed JSON", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-contacts-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await makeWorkspace(root);
  const before = await core.validateWorkspace(root);
  await mkdir(join(root, ".filegrc"), { recursive: true });
  for (const name of ["notifications.json", "hosted-notifications.json"]) await writeFile(join(root, ".filegrc", name), "{");
  const loaded = await core.loadWorkspace(root);
  assert.equal(Object.hasOwn(loaded, "notifications"), false);
  assert.deepEqual((await core.validateWorkspace(root)).diagnostics, before.diagnostics);
});

test("domain and CLI work items preserve owner IDs and Person email contacts", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-work-contacts-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await core.loadWorkspace(root);
  const owner = loaded.resources.find(({ type, status }) => type === "person" && status === "active");
  owner.email = "owner@example.com";
  await writeJson(loaded.entries.find(({ record }) => record.id === owner.id).path, owner);
  await writeJson(join(root, "data/action-items/action-notify.json"), {
    id: "action-notify", type: "action-item", title: "Review source", status: "open", assigneeIds: [owner.id],
    sourceResourceId: loaded.resources.find(({ type }) => type === "control").id,
    completionWindow: { precision: "date", startsOn: "2026-09-30", dueOn: "2026-10-01", overdueOn: "2026-10-02" }
  });
  const item = (await core.getWorkItems(root, { asOf: "2026-10-07" })).find(({ source }) => source.id === "action-notify");
  assert.deepEqual(item.ownerIds, [owner.id]);
  assert.deepEqual(item.notificationContacts, [{ personId: owner.id, email: owner.email }]);
  const result = await executeCli(runCli, process.execPath, [new URL("../bin/filegrc.js", import.meta.url).pathname, "workflow", "--root", root, "--as-of", "2026-10-07", "--json"]);
  const cliItem = JSON.parse(result.stdout).workItems.find(({ source }) => source.id === "action-notify");
  assert.deepEqual(cliItem.notificationContacts, item.notificationContacts);
  assert.deepEqual(cliItem.ownerIds, item.ownerIds);
});
