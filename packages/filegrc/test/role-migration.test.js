import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyResourceBatch, createResource } from "../src/files.js";
import { migrateLegacyRoles, planRoleMigration } from "../src/role-migration.js";
import { validateWorkspace } from "../src/validate.js";
import { makeWorkspace, writeJson } from "./helpers.js";

test("previews and atomically migrates the legacy Policy Owner person role", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-role-migration-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await writeJson(join(root, "data", "workspace.json"), {
    schemaVersion: 1,
    id: "workspace-example",
    type: "workspace",
    title: "Example Workspace",
    dataModelVersion: "1",
    organizationName: "Example Company",
    timezone: "UTC"
  });
  await writeJson(join(root, "data", "people", "person-owner.json"), {
    schemaVersion: 1,
    id: "person-owner",
    type: "person",
    title: "Program Owner",
    status: "active",
    email: "security@example.com",
    role: "Policy Owner"
  });
  await createResource(root, {
    schemaVersion: 1,
    id: "team-security",
    type: "team",
    title: "Security Team",
    status: "active",
    purpose: "Operate and review the security program.",
    memberIds: ["person-owner"]
  });
  await createResource(root, {
    schemaVersion: 1,
    id: "system-program-repository",
    type: "system",
    title: "Program Repository",
    status: "active",
    criticality: "high",
    ownerIds: ["person-owner"],
    evidenceOwnerIds: ["person-owner"]
  });

  const incomplete = await planRoleMigration(root);
  assert.deepEqual(incomplete.missing, [
    { personId: "person-owner", field: "jobTitle" },
    { personId: "person-owner", field: "startsOn" }
  ]);
  await assert.rejects(
    migrateLegacyRoles(root),
    /person-owner\.jobTitle, person-owner\.startsOn/
  );

  const preview = await planRoleMigration(root, {
    jobTitle: "Chief Executive Officer",
    startsOn: "2026-08-02"
  });
  assert.equal(preview.changes.create[0].id, "appointment-policy-owner");
  assert.deepEqual(preview.changes.create[0].scopeResourceIds, ["workspace-example"]);
  assert.equal(preview.appointments[0].references.length, 2);
  await writeJson(join(root, "data", "people", "person-owner.json"), {
    ...preview.changes.update.find(({ id }) => id === "person-owner"),
    department: "Operations",
    role: "Policy Owner"
  });
  await assert.rejects(
    applyResourceBatch(root, preview.changes),
    /Resource "person-owner" changed after you opened it/
  );
  await assert.rejects(
    readFile(join(root, "data", "appointments", "appointment-policy-owner.json"), "utf8"),
    { code: "ENOENT" }
  );

  const result = await migrateLegacyRoles(root, {
    jobTitle: "Chief Executive Officer",
    startsOn: "2026-08-02"
  });
  assert.equal(result.applied, true);

  const person = JSON.parse(await readFile(join(root, "data", "people", "person-owner.json"), "utf8"));
  assert.equal(person.jobTitle, "Chief Executive Officer");
  assert.equal(person.role, undefined);
  const appointment = JSON.parse(await readFile(
    join(root, "data", "appointments", "appointment-policy-owner.json"),
    "utf8"
  ));
  assert.equal(appointment.holderId, person.id);
  const system = JSON.parse(await readFile(join(root, "data", "systems", "system-program-repository.json"), "utf8"));
  assert.deepEqual(system.ownerIds, [appointment.id]);
  assert.deepEqual(system.evidenceOwnerIds, [appointment.id]);
  const team = JSON.parse(await readFile(join(root, "data", "teams", "team-security.json"), "utf8"));
  assert.deepEqual(team.memberIds, [person.id]);
  assert.deepEqual((await validateWorkspace(root)).counts, { resources: 6, errors: 0, warnings: 0 });
});
