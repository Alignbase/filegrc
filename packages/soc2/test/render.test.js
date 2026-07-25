import assert from "node:assert/strict";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildWorkspace, renderMarkdown, serveWorkspace } from "../src/index.js";
import { makeWorkspace } from "./helpers.js";

test("builds a self-contained read-only site", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "soc2-build-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const { output, state } = await buildWorkspace(root);
  const html = await readFile(join(output, "index.html"), "utf8");
  assert.match(html, /id="soc2-data"/);
  assert.match(html, /"readOnly":true/);
  assert.equal(Object.hasOwn(state.git, "root"), false);
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
  const duplicateResponse = await fetch(`${result.url}/api/resources`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(person)
  });
  assert.equal(duplicateResponse.status, 409);
  const invalidIdResponse = await fetch(`${result.url}/api/resources`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...person, id: "Invalid ID" })
  });
  assert.equal(invalidIdResponse.status, 400);
  person.role = "Reviewer";
  const updateResponse = await fetch(`${result.url}/api/resource/person/person-api-reviewer`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(person)
  });
  assert.equal(updateResponse.status, 200);
  const deleteResponse = await fetch(`${result.url}/api/resource/person/person-api-reviewer`, { method: "DELETE" });
  assert.equal(deleteResponse.status, 200);

  const contentPath = "content/policy-api.md";
  const policyResponse = await fetch(`${result.url}/api/resources`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      record: {
        schemaVersion: 1,
        id: "policy-api",
        type: "policy",
        title: "API Policy",
        status: "draft",
        contentPath,
        ownerIds: ["person-owner"],
        approverIds: ["person-owner"]
      },
      content: { [contentPath]: "# API Policy\n\nInitial." }
    })
  });
  assert.equal(policyResponse.status, 201);
  const contentResponse = await fetch(`${result.url}/api/content`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: contentPath, source: "# API Policy\n\nUpdated." })
  });
  assert.equal(contentResponse.status, 200);
  assert.match(await readFile(join(root, "data", contentPath), "utf8"), /Updated/);

  const ownerEntry = state.resources.find(({ record }) => record.id === "person-owner");
  const ownerPath = join(root, ownerEntry.relativePath);
  const externallyEditedOwner = { ...ownerEntry.record, role: "Externally edited" };
  await writeFile(ownerPath, `${JSON.stringify(externallyEditedOwner, null, 2)}\n`, "utf8");
  const staleResponse = await fetch(`${result.url}/api/resource/person/person-owner`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      record: { ...ownerEntry.record, role: "Stale browser edit" },
      revision: ownerEntry.revision
    })
  });
  assert.equal(staleResponse.status, 409);
  assert.equal(JSON.parse(await readFile(ownerPath, "utf8")).role, "Externally edited");

  const wrongSchemeResponse = await fetch(`${result.url}/api/resources`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: result.url.replace("http:", "https:")
    },
    body: JSON.stringify(person)
  });
  assert.equal(wrongSchemeResponse.status, 403);
});

test("renders safe Markdown links without changing query parameters", () => {
  const html = renderMarkdown("[Review](https://example.test/review?a=1&b=2) <script>alert(1)</script>");
  assert.match(html, /href="https:\/\/example\.test\/review\?a=1&amp;b=2"/);
  assert.doesNotMatch(html, /&amp;amp;/);
  assert.doesNotMatch(html, /<script>/);
});

test("builds a recovery view when workspace configuration is malformed", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "soc2-broken-workspace-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await writeFile(join(root, "data", "workspace.json"), '{"broken":\n', "utf8");
  const { state } = await buildWorkspace(root);
  assert.equal(state.workspace.organizationName, "Workspace configuration unavailable");
  assert.equal(state.validation.ok, false);
  assert.equal(state.validation.diagnostics.some(({ code }) => code === "missing-workspace"), true);
  assert.equal(state.validation.diagnostics.some(({ code }) => code === "invalid-json"), true);
});
