import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getWorkItems, loadWorkspace, notificationContacts, validateNotificationConfig, validateWorkspace, migrateModel } from "../src/index.js";
import { makeWorkspace, writeJson } from "./helpers.js";
import { makeComprehensiveWorkspace } from "./fixtures.js";

const person = { id: "person-owner", type: "person", status: "active", email: "owner@example.com" };
const config = { slack: { "person-owner": { workspaceId: "T012ABC", userId: "U012ABC" } } };

async function fixture(t, comprehensive = false) {
  const root = await mkdtemp(join(tmpdir(), "filegrc-notifications-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  if (comprehensive) await makeComprehensiveWorkspace(root, "11");
  else await makeWorkspace(root);
  await mkdir(join(root, ".filegrc"), { recursive: true });
  return root;
}

test("notification schema rejects credentials, email copies, malformed IDs and invalid people", () => {
  assert.deepEqual(validateNotificationConfig(config, [person]), []);
  for (const invalid of [null, [], { token: "example" }, { slack: [] }, { slack: { "person-owner": null } },
    { slack: { "person-owner": { ...config.slack[person.id], email: "copy@example.com" } } },
    { slack: { "person-owner": { workspaceId: "invalid", userId: "U012 ABC" } } }]) {
    assert.ok(validateNotificationConfig(invalid, [person]).length);
  }
  for (const records of [[], [{ ...person, type: "team" }], [person, person]]) {
    assert.match(validateNotificationConfig(config, records)[0].message, /missing, ambiguous, or is not a Person/);
  }
});

test("contacts resolve active people through teams and appointments and use current Person email", () => {
  const records = [person, { id: "team", type: "team", status: "active", memberIds: [person.id] },
    { id: "appointment", type: "appointment", status: "active", holderId: person.id }];
  assert.deepEqual(notificationContacts(["team", "appointment", person.id], records, config), [
    { personId: person.id, email: person.email, slack: config.slack[person.id] }
  ]);
  assert.equal(notificationContacts([person.id], [{ ...person, email: "new@example.com" }], config)[0].email, "new@example.com");
  assert.deepEqual(notificationContacts([person.id], [{ ...person, status: "inactive" }], config), []);
});

test("optional config and invalid JSON produce workspace validation diagnostics", async (t) => {
  const root = await fixture(t);
  assert.deepEqual((await loadWorkspace(root)).notifications, {});
  await writeJson(join(root, ".filegrc/notifications.json"), config);
  assert.deepEqual((await loadWorkspace(root)).notifications, config);
  const proposed = await loadWorkspace(root);
  proposed.resources = proposed.resources.filter(({ id }) => id !== person.id);
  assert.ok((await validateWorkspace(proposed)).diagnostics.some(({ field }) => field === "slack.person-owner"));
  await writeJson(join(root, ".filegrc/notifications.json"), { slack: { missing: config.slack[person.id] } });
  const validation = await validateWorkspace(root);
  assert.equal(validation.ok, false);
  assert.ok(validation.diagnostics.some(({ path, field }) => path === ".filegrc/notifications.json" && field === "slack.missing"));
  await assert.rejects(promisify(execFile)(process.execPath, [
    new URL("../bin/filegrc.js", import.meta.url).pathname, "validate", "--root", root, "--json"
  ]), (error) => {
    assert.ok(JSON.parse(error.stdout).diagnostics.some(({ field }) => field === "slack.missing"));
    return true;
  });
  await writeJson(join(root, ".filegrc/notifications.json"), null);
  assert.ok((await validateWorkspace(root)).diagnostics.some(({ message }) => message === "Notification configuration must be an object."));
  await writeFile(join(root, ".filegrc/notifications.json"), "{");
  assert.match((await loadWorkspace(root)).diagnostics[0].message, /Cannot read notification/);
});

test("getWorkItems exposes stable owners and repository contacts", async (t) => {
  const root = await fixture(t, true);
  const loaded = await loadWorkspace(root);
  const owner = loaded.resources.find(({ type, status }) => type === "person" && status === "active");
  owner.email = "owner@example.com";
  await writeJson(loaded.entries.find(({ record }) => record.id === owner.id).path, owner);
  await writeJson(join(root, ".filegrc/notifications.json"), { slack: { [owner.id]: config.slack[person.id] } });
  await writeJson(join(root, "data/action-items/action-notify.json"), {
    id: "action-notify", type: "action-item", title: "Review source", status: "open", assigneeIds: [owner.id], dueOn: "2026-10-01"
  });
  const item = (await getWorkItems(root, { asOf: "2026-10-07" })).find(({ source }) => source.id === "action-notify");
  assert.deepEqual(item.ownerIds, [owner.id]);
  assert.deepEqual(item.notificationContacts, [{ personId: owner.id, email: owner.email, slack: config.slack[person.id] }]);
});

test("model migration preserves optional repository notification routing", async (t) => {
  const root = await fixture(t);
  const path = join(root, ".filegrc/notifications.json");
  await writeJson(path, config);
  const before = await readFile(path, "utf8");
  const result = await migrateModel(root, { targetModelVersion: "3", yes: true });
  assert.equal(result.applied, true);
  assert.equal((await loadWorkspace(root)).workspace.dataModelVersion, "3");
  assert.equal(await readFile(path, "utf8"), before);
  assert.deepEqual((await loadWorkspace(root)).notifications, config);
});

test("malformed resource values do not crash notification loading or contacts", async (t) => {
  const root = await fixture(t);
  await writeJson(join(root, ".filegrc/notifications.json"), config);
  await writeJson(join(root, "data/people/malformed.json"), null);
  const loaded = await loadWorkspace(root);
  assert.deepEqual(loaded.notifications, config);
  assert.deepEqual(validateNotificationConfig(config, [null, person]), []);
  assert.deepEqual(notificationContacts([person.id], [null, person], config), [
    { personId: person.id, email: person.email, slack: config.slack[person.id] }
  ]);
});
