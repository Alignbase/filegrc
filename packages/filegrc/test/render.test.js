import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildWorkspace, renderMarkdown, serveWorkspace } from "../src/index.js";
import { APP_SCRIPT, APP_STYLES, renderIndex } from "../src/web.js";
import { makeWorkspace, writeJson } from "./helpers.js";

test("builds a self-contained read-only site", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-build-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const { output, state } = await buildWorkspace(root);
  const html = await readFile(join(output, "index.html"), "utf8");
  assert.match(html, /id="filegrc-data"/);
  assert.match(html, /"readOnly":true/);
  assert.equal(Object.hasOwn(state.git, "root"), false);
  assert.match(html, /<link rel="icon" type="image\/png" href="\.\/favicon\.png">/);
  const favicon = await readFile(join(output, "favicon.png"));
  assert.deepEqual([...favicon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  await access(join(output, "filegrc-app.js"));
  await access(join(output, "filegrc.css"));
});

test("static builds cannot leave the workspace through paths or symlinks", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-build-boundary-"));
  const outside = await mkdtemp(join(tmpdir(), "filegrc-build-outside-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(outside, { recursive: true, force: true })
  ])));
  await makeWorkspace(root);
  await assert.rejects(buildWorkspace(root, { output: outside }), /leaves the workspace/);
  await symlink(outside, join(root, ".filegrc"));
  await assert.rejects(buildWorkspace(root), /resolves outside the workspace/);
});

test("static builds reject output files that are external symlinks", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-build-file-boundary-"));
  const outside = await mkdtemp(join(tmpdir(), "filegrc-build-file-outside-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(outside, { recursive: true, force: true })
  ])));
  await makeWorkspace(root);
  await mkdir(join(root, ".filegrc", "site"), { recursive: true });
  const outsideIndex = join(outside, "index.html");
  await writeFile(outsideIndex, "keep", "utf8");
  await symlink(outsideIndex, join(root, ".filegrc", "site", "index.html"));

  await assert.rejects(buildWorkspace(root), /resolves outside the workspace/);
  assert.equal(await readFile(outsideIndex, "utf8"), "keep");
});

test("static builds reject broken output symlinks before creating their external targets", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-build-broken-link-"));
  const outside = await mkdtemp(join(tmpdir(), "filegrc-build-broken-outside-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(outside, { recursive: true, force: true })
  ])));
  await makeWorkspace(root);
  await mkdir(join(root, ".filegrc", "site"), { recursive: true });
  const outsideIndex = join(outside, "not-created.html");
  await symlink(outsideIndex, join(root, ".filegrc", "site", "index.html"));

  await assert.rejects(buildWorkspace(root), /unavailable symlink/);
  await assert.rejects(access(outsideIndex), /ENOENT/);
});

test("serves state and browser assets", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-server-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const result = await serveWorkspace(root, { port: 0 });
  context.after(() => new Promise((resolve) => result.server.close(resolve)));
  const stateResponse = await fetch(`${result.url}/api/state`);
  assert.equal(stateResponse.status, 200);
  const state = await stateResponse.json();
  assert.equal(state.validation.ok, true);
  assert.equal(state.resources.length, 2);
  const appResponse = await fetch(`${result.url}/filegrc-app.js`);
  assert.equal(appResponse.status, 200);
  assert.equal(appResponse.headers.get("x-frame-options"), "DENY");
  assert.equal(appResponse.headers.get("referrer-policy"), "no-referrer");
  assert.match(appResponse.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.match(await appResponse.text(), /function renderHome/);
  const faviconResponse = await fetch(`${result.url}/favicon.png`);
  assert.equal(faviconResponse.status, 200);
  assert.equal(faviconResponse.headers.get("content-type"), "image/png");
  assert.deepEqual([...new Uint8Array(await faviconResponse.arrayBuffer()).subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

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

test("persists onboarding resources without requiring Git", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-onboarding-setting-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await writeJson(join(root, "data", "renderer.json"), {
    schemaVersion: 1,
    id: "renderer-settings",
    type: "renderer-settings",
    title: "Renderer settings",
    showOnboarding: true
  });
  const result = await serveWorkspace(root, { port: 0 });
  context.after(() => new Promise((resolve) => result.server.close(resolve)));
  const state = await (await fetch(`${result.url}/api/state`)).json();
  assert.equal(state.git.available, false);
  const systemResponse = await fetch(`${result.url}/api/resources`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      record: {
        schemaVersion: 1,
        id: "system-onboarding-service",
        type: "system",
        title: "Onboarding Service",
        status: "active",
        criticality: "high",
        ownerIds: ["person-owner"],
        description: "Production service boundary.",
        systemKind: "service",
        dataClassification: "Confidential",
        internetExposed: true,
        inScope: true
      }
    })
  });
  assert.equal(systemResponse.status, 201);
  const entry = state.resources.find(({ record }) => record.type === "renderer-settings");
  const response = await fetch(`${result.url}/api/resource/renderer-settings/renderer-settings`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      record: { ...entry.record, showOnboarding: false },
      revision: entry.revision
    })
  });
  assert.equal(response.status, 200);
  const system = JSON.parse(await readFile(join(root, "data", "systems", "system-onboarding-service.json"), "utf8"));
  assert.equal(system.inScope, true);
  const saved = JSON.parse(await readFile(join(root, "data", "renderer.json"), "utf8"));
  assert.equal(saved.showOnboarding, false);
  const deleteResponse = await fetch(`${result.url}/api/resource/renderer-settings/renderer-settings`, { method: "DELETE" });
  assert.equal(deleteResponse.status, 400);
  assert.match((await deleteResponse.json()).error, /Singleton records cannot be deleted/);
});

test("records and links obligation work through the writable API", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-obligation-completion-api-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await mkdir(join(root, "data", "obligations"), { recursive: true });
  await writeJson(join(root, "data", "obligations", "obligation-review.json"), {
    schemaVersion: 1,
    id: "obligation-review",
    type: "obligation",
    title: "Quarterly review",
    status: "active",
    activityType: "review",
    recurrence: { mode: "calendar", unit: "month", interval: 3, anchorDate: "2026-01-01" },
    ownerIds: ["person-owner"]
  });
  const result = await serveWorkspace(root, { port: 0 });
  context.after(() => new Promise((resolve) => result.server.close(resolve)));
  const state = await (await fetch(`${result.url}/api/state`)).json();
  const obligation = state.resources.find(({ record }) => record.id === "obligation-review");
  const response = await fetch(`${result.url}/api/obligation-completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      obligationId: obligation.record.id,
      revision: obligation.revision,
      record: {
        schemaVersion: 1,
        id: "evidence-review",
        type: "evidence",
        title: "Quarterly review evidence",
        status: "collected",
        evidenceKind: "review",
        source: "Internal review",
        collectedOn: "2026-01-20",
        classification: "Internal",
        contentPath: "content/evidence-review.md"
      },
      content: { "content/evidence-review.md": "# Quarterly review evidence" }
    })
  });
  assert.equal(response.status, 201);
  const saved = JSON.parse(await readFile(join(root, "data", "obligations", "obligation-review.json"), "utf8"));
  assert.deepEqual(saved.completionResourceIds, ["evidence-review"]);
  assert.equal(await readFile(join(root, "data", "content", "evidence-review.md"), "utf8"), "# Quarterly review evidence\n");
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
  assert.match(APP_STYLES, /\.sidebar\{display:flex;flex-direction:column;height:100vh;overflow:hidden;overscroll-behavior:contain\}/);
  assert.match(APP_STYLES, /\.sidebar-nav\{[^}]*flex:1;min-height:0;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain/);
  assert.match(APP_STYLES, /\.workspace\{height:100vh;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;/);
  assert.match(APP_STYLES, /\.sidebar-footer\{flex:0 0 auto;[^}]*background:#000024;/);
});

test("persists each sidebar group state between page renders", () => {
  assert.match(APP_SCRIPT, /const NAV_GROUP_STORAGE_KEY = "filegrc\.sidebar\.groups\.v3"/);
  assert.match(APP_SCRIPT, /window\.localStorage\.getItem\(NAV_GROUP_STORAGE_KEY\)/);
  assert.match(APP_SCRIPT, /navigationGroupState\[stage\.id\] \?\? currentStage\?\.id === stage\.id/);
  assert.match(APP_SCRIPT, /navigationGroupState\[sectionKey\] \?\? \(sectionCurrent \|\| section\.defaultOpen\)/);
  assert.match(APP_SCRIPT, /querySelectorAll\("\.nav-heading, \.nav-subheading"\)/);
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
  assert.match(APP_SCRIPT, /<img class="mark" src="\.\/favicon\.png" alt="" width="39" height="39">/);
  assert.match(APP_STYLES, /\.button\.primary\{background:var\(--primary-gradient\);border-color:#000070;color:#fff\}/);
  assert.match(APP_STYLES, /@media\(prefers-color-scheme:dark\)/);
});

test("places record context left of Markdown on wide screens", () => {
  assert.match(APP_STYLES, /@media\(min-width:761px\)\{\.detail-grid\{grid-template-columns:minmax\(270px,1fr\) minmax\(0,2fr\)\}/);
  assert.match(APP_STYLES, /\.detail-grid aside\{grid-column:1;grid-row:1\}/);
  assert.match(APP_STYLES, /\.detail-main\{grid-column:2;grid-row:1\}/);
  assert.match(APP_STYLES, /\.detail-grid\{grid-template-columns:1fr\}/);
});

test("uses the readiness path as the nested sidebar information architecture", () => {
  assert.match(APP_SCRIPT, /const READINESS_STAGES = \[/);
  assert.match(APP_SCRIPT, /title: "Scope",\s+description: "Systems and boundary"/);
  assert.match(APP_SCRIPT, /title: "Run the program",\s+description: "Recurring and event work"/);
  assert.match(APP_SCRIPT, /class="nav-group nav-stage /);
  assert.match(APP_SCRIPT, /class="nav-group nav-subgroup /);
  assert.match(APP_SCRIPT, /class="nav-count"/);
  assert.match(APP_SCRIPT, /class="nav-control-slot"/);
  assert.match(APP_STYLES, /--nav-count-width:28px;--nav-control-width:14px/);
  assert.match(APP_STYLES, /\.nav-subgroup>\.nav-subheading,\.nav-subgroup>\.nav-items a\{[^}]*grid-template-columns:minmax\(0,1fr\) var\(--nav-count-width\) var\(--nav-control-width\)/);
  assert.match(APP_STYLES, /\.nav-count\{justify-self:end;text-align:right;font-variant-numeric:tabular-nums\}/);
  assert.doesNotMatch(APP_SCRIPT, /<section class="nav-path"><p>Readiness path<\/p>/);
  assert.match(APP_SCRIPT, /function readinessStageForRoute\(route\)/);
  assert.match(APP_SCRIPT, /function renderOrganization\(main\)/);
  assert.match(APP_SCRIPT, /class="organization-nav /);
  assert.match(APP_SCRIPT, /People and teams/);
  assert.match(APP_SCRIPT, /Renderer and repository/);
  assert.match(APP_SCRIPT, /function readinessOverview\(\)/);
  assert.match(APP_SCRIPT, /Scope", "Define the service, system boundary, people, data, and vendors/);
  assert.match(APP_SCRIPT, /function auditEngagementPrompt\(audit = null\)/);
  assert.match(APP_SCRIPT, /Shortlist independent CPA firms that perform SOC 2 examinations/);
  assert.match(APP_SCRIPT, /function recordNarrative\(record, fields\)/);
  assert.match(APP_SCRIPT, /function resourceConnections\(entry\)/);
  assert.match(APP_SCRIPT, /Linked from /);
  assert.match(APP_SCRIPT, /Linked by /);
  assert.match(APP_SCRIPT, /field === "sourceReference"/);
  assert.match(APP_SCRIPT, /function safeExternalUrl\(value\)/);
  assert.match(APP_SCRIPT, /\["http:", "https:"\]\.includes\(url\.protocol\)/);
  assert.match(APP_STYLES, /\.readiness-flow\{display:grid;grid-template-columns:repeat\(6/);
  assert.match(APP_STYLES, /\.resource-directory\{display:grid/);
  assert.match(APP_STYLES, /\.record-prose\{max-width:790px\}/);
  assert.match(APP_STYLES, /\.connections\{display:grid\}/);
  assert.match(APP_STYLES, /\.external-source\{display:flex/);
  assert.match(APP_STYLES, /\.organization-grid\{display:grid;grid-template-columns:repeat\(3/);
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
  assert.match(APP_SCRIPT, /function parseCalendarDate/);
  assert.match(APP_SCRIPT, /function validCalendarRecurrence/);
  assert.match(APP_SCRIPT, /function calendarOccurrenceIndex/);
  assert.match(APP_SCRIPT, /function formatCalendarDate/);
  assert.match(APP_SCRIPT, /function formatLocalDateTime/);
  assert.match(APP_SCRIPT, /timeZoneName: "short"/);
  assert.doesNotMatch(APP_SCRIPT, /function shortDate/);
});

test("explains purpose, policy basis, and timing on every resource view", () => {
  assert.match(APP_SCRIPT, /function resourceGuide\(type\)/);
  assert.match(APP_SCRIPT, /definition\.description/);
  assert.match(APP_SCRIPT, /guidance\.policyBasis/);
  assert.match(APP_SCRIPT, /guidance\.sourceResourceIds/);
  assert.match(APP_SCRIPT, /guidance\.obligationActivityTypes/);
  assert.match(APP_SCRIPT, /<span>Use<\/span>/);
  assert.match(APP_SCRIPT, /<span>Policy basis<\/span>/);
  assert.match(APP_SCRIPT, /<span>Timing<\/span>/);
  assert.match(APP_SCRIPT, /renderList[\s\S]*resourceGuide\(type\)/);
  assert.match(APP_SCRIPT, /renderDetail[\s\S]*resourceGuide\(type\)/);
  assert.match(APP_STYLES, /\.page-guide\{display:grid;grid-template-columns:/);
  assert.match(APP_STYLES, /\.setup-banner,\.page-guide\{grid-template-columns:1fr\}/);
});

test("runs optional onboarding from committed renderer settings", () => {
  assert.doesNotThrow(() => new Function(APP_SCRIPT));
  assert.match(APP_SCRIPT, /rendererSettingsEntry\(\)\?\.record\.showOnboarding === true/);
  assert.match(APP_SCRIPT, /!state\.readOnly && rendererSettingsEntry/);
  assert.match(APP_SCRIPT, /onboardingDialog\.showModal\(\)/);
  assert.match(APP_SCRIPT, /onboardingDialog\.addEventListener\("cancel"/);
  assert.match(APP_SCRIPT, /function positionOnboardingShade\(target\)/);
  assert.match(APP_SCRIPT, /function onboardingTarget\(step\)/);
  assert.match(APP_SCRIPT, /window\.addEventListener\("scroll", positionCurrentOnboarding, true\)/);
  assert.match(APP_SCRIPT, /persistOnboardingPreference\(false\)/);
  assert.match(APP_SCRIPT, /type: "system"/);
  assert.match(APP_SCRIPT, /type: "audit"/);
  assert.match(APP_SCRIPT, /Files are the program/);
  assert.match(APP_SCRIPT, /Follow the audit chain/);
  assert.match(APP_SCRIPT, /Work the policy queue/);
  assert.match(APP_SCRIPT, /Start a checklist when something changes/);
  assert.match(APP_SCRIPT, /Plan the engagement and generate evidence/);
  assert.match(APP_SCRIPT, /filegrc obligations CLI command/);
  assert.match(APP_SCRIPT, /filegrc trigger/);
  assert.match(APP_SCRIPT, /filegrc evidence-packet/);
  assert.match(APP_SCRIPT, /Saving writes JSON files but does not commit them/);
  assert.match(APP_SCRIPT, /Git repository detected/);
  assert.match(APP_SCRIPT, /Git setup needed/);
  assert.match(APP_SCRIPT, /Saving still works/);
  assert.match(APP_SCRIPT, /The FileGRC server is unavailable/);
  assert.match(APP_SCRIPT, /async function localFetch/);
  assert.match(APP_SCRIPT, /id="start-onboarding"/);
  assert.match(APP_SCRIPT, /id="commit-workspace"/);
  assert.match(APP_SCRIPT, /localFetch\("\/api\/commit"/);
  assert.match(APP_SCRIPT, /nextCalendarOccurrence\(recurrence, currentDate\(\)\)/);
  assert.match(APP_SCRIPT, /class="panel schedule-panel"/);
  assert.match(APP_STYLES, /\.onboarding-dialog::backdrop\{/);
  assert.match(APP_STYLES, /\.onboarding-dialog::backdrop\{background:transparent;backdrop-filter:none\}/);
  assert.match(APP_STYLES, /\.onboarding-shade\{position:fixed;inset:0;z-index:60;pointer-events:none\}/);
  assert.match(APP_STYLES, /\.onboarding-focus\{/);
  assert.match(APP_STYLES, /\.onboarding-dialog\{max-height:56vh\}\.onboarding-actions\{position:sticky/);
  assert.match(APP_SCRIPT, /--onboarding-step-count:' \+ steps\.length/);
  assert.match(APP_STYLES, /\.onboarding-progress\{grid-template-columns:repeat\(var\(--onboarding-step-count\),1fr\)/);
  assert.match(APP_STYLES, /\.onboarding-git-status\{display:flex/);
  assert.match(APP_STYLES, /\.commit-dialog\{width:min\(560px/);
  assert.match(APP_STYLES, /@media\(max-width:520px\)\{\.onboarding-form,\.setup-steps\{grid-template-columns:1fr\}/);
});

test("renders shared obligation and evidence-packet workflows", () => {
  assert.match(APP_SCRIPT, /function renderObligations\(main\)/);
  assert.match(APP_SCRIPT, /state\.obligations\.counts\.overdue/);
  assert.match(APP_SCRIPT, /daysUntilOverdue/);
  assert.match(APP_SCRIPT, /dueWindowStart/);
  assert.match(APP_SCRIPT, /dueWindowEnd/);
  assert.match(APP_SCRIPT, /overdueOn/);
  assert.match(APP_SCRIPT, /localFetch\("\/api\/obligation-events"/);
  assert.match(APP_SCRIPT, /localFetch\(url,[\s\S]*\/api\/obligation-completions/);
  assert.match(APP_SCRIPT, /function obligationCompletionSeed\(type, item, obligation\)/);
  assert.match(APP_SCRIPT, /data-record-obligation/);
  assert.match(APP_SCRIPT, /data-expand-obligations/);
  assert.match(APP_SCRIPT, /function renderAuditPacket\(main/);
  assert.match(APP_SCRIPT, /localFetch\("\/api\/evidence-packet"/);
  assert.match(APP_SCRIPT, /every dated record/i);
  assert.match(APP_SCRIPT, /class="packet-preflight"/);
  assert.match(APP_SCRIPT, /Generate draft/);
  assert.match(APP_STYLES, /\.obligation-board\{display:grid/);
  assert.match(APP_STYLES, /\.packet-builder form\{display:grid/);
  assert.match(APP_STYLES, /\.packet-preflight\{display:grid/);
});

test("separates valid data from readiness and uses stage names on resource pages", () => {
  assert.match(APP_SCRIPT, /metric\("Data health", state\.validation\.ok \? "Valid"/);
  assert.match(APP_SCRIPT, /function programSetup\(\)/);
  assert.match(APP_SCRIPT, /The files can be valid while the program is still unconfigured/);
  assert.match(APP_SCRIPT, /readinessStageForType\(type\)\?\.title/);
  assert.match(APP_SCRIPT, /\["Run the program", "Complete recurring and event work/);
  assert.match(APP_SCRIPT, /#\/resources\/audit\?new=1/);
  assert.match(APP_SCRIPT, /params\.get\("new"\) === "1"[\s\S]*queueMicrotask\(\(\) => openEditor\(type\)\)/);
  assert.match(APP_STYLES, /\.readiness-state\{/);
  assert.match(APP_STYLES, /\.setup-steps\{display:grid/);
});

test("builds a recovery view when workspace configuration is malformed", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-broken-workspace-"));
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
