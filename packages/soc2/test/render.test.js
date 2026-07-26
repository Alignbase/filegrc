import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildWorkspace, renderMarkdown, serveWorkspace } from "../src/index.js";
import { APP_SCRIPT, APP_STYLES, renderIndex } from "../src/web.js";
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

test("static builds cannot leave the workspace through paths or symlinks", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "soc2-build-boundary-"));
  const outside = await mkdtemp(join(tmpdir(), "soc2-build-outside-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(outside, { recursive: true, force: true })
  ])));
  await makeWorkspace(root);
  await assert.rejects(buildWorkspace(root, { output: outside }), /leaves the workspace/);
  await symlink(outside, join(root, ".soc2"));
  await assert.rejects(buildWorkspace(root), /resolves outside the workspace/);
});

test("static builds reject output files that are external symlinks", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "soc2-build-file-boundary-"));
  const outside = await mkdtemp(join(tmpdir(), "soc2-build-file-outside-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(outside, { recursive: true, force: true })
  ])));
  await makeWorkspace(root);
  await mkdir(join(root, ".soc2", "site"), { recursive: true });
  const outsideIndex = join(outside, "index.html");
  await writeFile(outsideIndex, "keep", "utf8");
  await symlink(outsideIndex, join(root, ".soc2", "site", "index.html"));

  await assert.rejects(buildWorkspace(root), /resolves outside the workspace/);
  assert.equal(await readFile(outsideIndex, "utf8"), "keep");
});

test("static builds reject broken output symlinks before creating their external targets", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "soc2-build-broken-link-"));
  const outside = await mkdtemp(join(tmpdir(), "soc2-build-broken-outside-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(outside, { recursive: true, force: true })
  ])));
  await makeWorkspace(root);
  await mkdir(join(root, ".soc2", "site"), { recursive: true });
  const outsideIndex = join(outside, "not-created.html");
  await symlink(outsideIndex, join(root, ".soc2", "site", "index.html"));

  await assert.rejects(buildWorkspace(root), /unavailable symlink/);
  await assert.rejects(access(outsideIndex), /ENOENT/);
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
  assert.equal(appResponse.headers.get("x-frame-options"), "DENY");
  assert.equal(appResponse.headers.get("referrer-policy"), "no-referrer");
  assert.match(appResponse.headers.get("content-security-policy"), /frame-ancestors 'none'/);
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
  const primitiveResponse = await fetch(`${result.url}/api/resources`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "null"
  });
  assert.equal(primitiveResponse.status, 400);
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
  const missingContentResponse = await fetch(`${result.url}/api/content`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: "content/missing.md", source: "# Missing" })
  });
  assert.equal(missingContentResponse.status, 404);
  const missingContentError = (await missingContentResponse.json()).error;
  assert.equal(missingContentError, "The requested file was not found.");
  assert.equal(missingContentError.includes(root), false);

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

  const reboundResponse = await requestWithHeaders(result.url, {
    host: "attacker.example",
    origin: "http://attacker.example"
  });
  assert.equal(reboundResponse.status, 403);

  await assert.rejects(serveWorkspace(root, { port: 65_536 }), /port must be an integer/);
  const wildcard = await serveWorkspace(root, { host: "0.0.0.0", port: 0 });
  context.after(() => new Promise((resolve) => wildcard.server.close(resolve)));
  assert.match(wildcard.url, /^http:\/\/127\.0\.0\.1:/);
  assert.equal((await fetch(`${wildcard.url}/api/state`)).status, 200);
});

test("renders safe Markdown links without changing query parameters", () => {
  const html = renderMarkdown("[Review](https://example.test/review?a=1&b=2) <script>alert(1)</script>");
  assert.match(html, /href="https:\/\/example\.test\/review\?a=1&amp;b=2"/);
  assert.doesNotMatch(html, /&amp;amp;/);
  assert.doesNotMatch(html, /<script>/);
});

test("keeps hostile workspace text inert in static HTML", () => {
  const html = renderIndex({
    organizationName: "</script><script>globalThis.compromised = true</script>",
    separator: "\u2028"
  });
  assert.doesNotMatch(html, /<\/script><script>globalThis/);
  assert.match(html, /\\u003c\/script>/);
  assert.match(html, /\\u2028/);
});

test("keeps the sidebar fixed while the workspace owns page scrolling", () => {
  assert.match(APP_STYLES, /html,body\{height:100%;overflow:hidden\}/);
  assert.match(APP_STYLES, /\.sidebar\{height:100vh;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain\}/);
  assert.match(APP_STYLES, /\.workspace\{height:100vh;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;/);
  assert.match(APP_STYLES, /\.side-foot\{background:#000024;[^}]*z-index:1\}/);
});

test("persists each sidebar group state between page renders", () => {
  assert.match(APP_SCRIPT, /const NAV_GROUP_STORAGE_KEY = "soc2\.sidebar\.groups\.v1"/);
  assert.match(APP_SCRIPT, /window\.localStorage\.getItem\(NAV_GROUP_STORAGE_KEY\)/);
  assert.match(APP_SCRIPT, /navigationGroupState\[group\] \?\? \(currentGroup === group \|\| DEFAULT_OPEN_NAV_GROUPS\.has\(group\)\)/);
  assert.match(APP_SCRIPT, /setNavigationGroupOpen\(group\.dataset\.group, open\)/);
  assert.match(APP_SCRIPT, /window\.localStorage\.setItem\(NAV_GROUP_STORAGE_KEY, JSON\.stringify\(navigationGroupState\)\)/);
});

test("uses a black page canvas in dark mode", () => {
  assert.match(APP_STYLES, /@media\(prefers-color-scheme:dark\)\{\s*:root\{[^}]*--paper:#000;/);
  assert.match(APP_STYLES, /\.topbar\{background:rgba\(0,0,0,.9\)\}/);
});

test("centers modal close icons without relying on font metrics", () => {
  assert.match(APP_STYLES, /\.icon-button\{position:relative;display:grid;place-items:center;padding:0;/);
  assert.match(APP_STYLES, /\.icon-button:before,\.icon-button:after\{content:"";position:absolute;width:13px;height:2px;/);
});

test("uses the shared blue gradient and follows the browser color scheme", () => {
  assert.match(renderIndex(), /<meta name="color-scheme" content="light dark">/);
  assert.match(APP_STYLES, /--primary-gradient:linear-gradient\(135deg,#000070 0%,#000035 60%\)/);
  assert.match(APP_STYLES, /\.sidebar\{background:var\(--sidebar\);color:#eef1ff\}/);
  assert.match(APP_STYLES, /\.button\.primary\{background:var\(--primary-gradient\);border-color:#000070;color:#fff\}/);
  assert.match(APP_STYLES, /@media\(prefers-color-scheme:dark\)/);
});

test("keeps IDs behind the guided editor and generates them from titles", () => {
  assert.match(APP_SCRIPT, /function createResourceId/);
  assert.match(APP_SCRIPT, /createResourceId\(type, nextTitle/);
  assert.match(APP_SCRIPT, /titleLabel \|\| state\.model\.commonFields\.title\.label/);
  assert.match(APP_SCRIPT, /A stable ID and file name will be generated from this value/);
  assert.doesNotMatch(APP_SCRIPT, /\[\s*"id",\s*"title"/);
});

test("paginates large result sets and makes the mobile drawer modal", () => {
  assert.match(APP_SCRIPT, /const LIST_PAGE_SIZE = 25/);
  assert.match(APP_SCRIPT, /const SEARCH_PAGE_SIZE = 25/);
  assert.match(APP_SCRIPT, /data-page="previous"/);
  assert.match(APP_SCRIPT, /data-search-page="next"/);
  assert.match(APP_SCRIPT, /syncRoute\("push"\)/);
  assert.match(APP_SCRIPT, /aria-controls="sidebar-navigation"/);
  assert.match(APP_SCRIPT, /workspace\.inert = open/);
  assert.match(APP_STYLES, /\.sidebar\.shown\+\.nav-scrim\{opacity:1;pointer-events:auto\}/);
  assert.match(APP_STYLES, /\.sidebar\{visibility:hidden;transition:/);
});

test("ships local timestamp formatting while preserving calendar dates", () => {
  assert.match(APP_SCRIPT, /definition\?\.type === "date"/);
  assert.match(APP_SCRIPT, /definition\?\.type === "timestamp"/);
  assert.match(APP_SCRIPT, /function formatCalendarDate/);
  assert.match(APP_SCRIPT, /function formatLocalDateTime/);
  assert.match(APP_SCRIPT, /timeZoneName: "short"/);
  assert.doesNotMatch(APP_SCRIPT, /function shortDate/);
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

function requestWithHeaders(url, headers) {
  return new Promise((resolve, reject) => {
    const outgoing = request(url, { headers }, (response) => {
      response.resume();
      response.once("end", () => resolve({ status: response.statusCode }));
    });
    outgoing.once("error", reject);
    outgoing.end();
  });
}
