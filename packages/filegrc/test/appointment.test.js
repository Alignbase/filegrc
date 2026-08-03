import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createResource, updateResource } from "../src/files.js";
import { validateWorkspace } from "../src/validate.js";
import { makeWorkspace, writeJson } from "./helpers.js";

test("creates and validates a scoped active appointment", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-appointment-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);

  await createResource(root, {
    id: "appointment-policy-owner",
    type: "appointment",
    title: "Policy Owner",
    status: "active",
    appointmentKind: "policy-owner",
    holderId: "person-owner",
    scopeResourceIds: ["workspace"],
    startsOn: "2026-08-02"
  });

  assert.deepEqual((await validateWorkspace(root)).counts, { resources: 4, errors: 0, warnings: 0 });
  assert.equal(
    JSON.parse(await readFile(join(root, "data", "appointments", "appointment-policy-owner.json"), "utf8")).holderId,
    "person-owner"
  );
  const person = JSON.parse(await readFile(join(root, "data", "people", "person-owner.json"), "utf8"));
  await assert.rejects(
    updateResource(root, "person", person.id, {
      ...person,
      status: "inactive",
      statusTransition: {
        changedByIds: ["person-owner"],
        changedOn: "2026-08-02",
        reason: "The person left the organization."
      }
    }),
    /active Appointment must have an active Person/
  );
});

test("rejects an active appointment held by an inactive person", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-inactive-appointment-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await writeJson(join(root, "data", "people", "person-owner.json"), {
    id: "person-owner",
    type: "person",
    affiliation: "internal",
    title: "Former Program Owner",
    status: "inactive",
    statusTransition: {
      changedByIds: ["person-owner"],
      changedOn: "2026-08-02",
      reason: "The person left the organization."
    }
  });
  await mkdir(join(root, "data", "appointments"), { recursive: true });
  await writeJson(join(root, "data", "appointments", "appointment-policy-owner.json"), {
    id: "appointment-policy-owner",
    type: "appointment",
    title: "Policy Owner",
    status: "active",
    appointmentKind: "policy-owner",
    holderId: "person-owner",
    scopeResourceIds: ["workspace"],
    startsOn: "2026-08-02"
  });

  const result = await validateWorkspace(root);
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some(({ code }) => code === "inactive-appointment-holder"));
});
