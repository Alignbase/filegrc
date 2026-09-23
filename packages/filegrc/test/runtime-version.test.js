import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCli } from "../src/cli.js";
import { createResource } from "../src/files.js";
import { createFilegrcServer } from "../src/server.js";
import { makeWorkspace } from "./helpers.js";

test("CLI, server, and direct writes reject an installed engine that differs from the lockfile", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-version-drift-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeWorkspace(root);
  await writeFile(join(root, "package-lock.json"), `${JSON.stringify({
    name: "version-drift-test",
    lockfileVersion: 3,
    packages: {
      "": { dependencies: { filegrc: "^99.0.0" } },
      "node_modules/filegrc": { version: "99.0.0" }
    }
  }, null, 2)}\n`);

  const expected = /Installed filegrc .* does not match package-lock\.json \(99\.0\.0\).*npm ci/;
  await assert.rejects(runCli(["validate", "--root", root]), expected);
  for (const command of ["validate", "build", "serve"]) {
    await assert.rejects(runCli([command, root]), expected);
    await assert.rejects(runCli([command, root, "--root", process.cwd()]), expected);
  }
  assert.throws(() => createFilegrcServer(root), expected);
  await assert.rejects(createResource(root, { id: "person-new", type: "person", title: "New person" }), expected);
});

test("package-managed workspaces reject missing and incomplete lockfiles", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-lockfile-required-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeWorkspace(root);
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    name: "lockfile-required-test",
    private: true,
    dependencies: { filegrc: "^0.16.0" }
  }, null, 2)}\n`);
  await assert.rejects(runCli(["validate", "--root", root]), /package-lock\.json is missing/);
  assert.throws(() => createFilegrcServer(root), /package-lock\.json is missing/);
  await assert.rejects(createResource(root, { id: "person-new", type: "person", title: "New person" }), /package-lock\.json is missing/);
  await writeFile(join(root, "package-lock.json"), `${JSON.stringify({
    name: "lockfile-required-test",
    lockfileVersion: 3,
    packages: { "": { dependencies: { filegrc: "^0.16.0" } } }
  }, null, 2)}\n`);
  await assert.rejects(runCli(["validate", "--root", root]), /no filegrc version/);
  assert.throws(() => createFilegrcServer(root), /no filegrc version/);
  await assert.rejects(createResource(root, { id: "person-new", type: "person", title: "New person" }), /no filegrc version/);
});
