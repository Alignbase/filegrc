import assert from "node:assert/strict";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildWorkspace, serveWorkspace } from "../src/index.js";
import { makeWorkspace } from "./helpers.js";

test("builds a self-contained read-only site", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "soc2-build-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const { output } = await buildWorkspace(root);
  const html = await readFile(join(output, "index.html"), "utf8");
  assert.match(html, /id="soc2-data"/);
  assert.match(html, /"readOnly":true/);
  await access(join(output, "soc2-app.js"));
  await access(join(output, "soc2.css"));
});

test("serves state and browser assets", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "soc2-server-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const result = await serveWorkspace(root, { port: 0 });
  context.after(() => new Promise((resolve) => result.server.close(resolve)));
  const stateResponse = await fetch(`${result.url}/api/state`);
  assert.equal(stateResponse.status, 200);
  const state = await stateResponse.json();
  assert.equal(state.validation.ok, true);
  assert.equal(state.resources.length, 2);
  const appResponse = await fetch(`${result.url}/soc2-app.js`);
  assert.equal(appResponse.status, 200);
  assert.match(await appResponse.text(), /function renderHome/);

  const person = {
    schemaVersion: 1,
    id: "person-api-reviewer",
    type: "person",
    title: "API Reviewer",
    status: "active"
  };
  const createResponse = await fetch(`${result.url}/api/resources`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(person)
  });
  assert.equal(createResponse.status, 201);
  person.role = "Reviewer";
  const updateResponse = await fetch(`${result.url}/api/resource/person/person-api-reviewer`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(person)
  });
  assert.equal(updateResponse.status, 200);
  const deleteResponse = await fetch(`${result.url}/api/resource/person/person-api-reviewer`, { method: "DELETE" });
  assert.equal(deleteResponse.status, 200);
});
