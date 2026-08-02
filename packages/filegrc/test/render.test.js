import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildWorkspace, PROGRAM_PATH, renderMarkdown, RESOURCE_INSTRUCTIONS, serveWorkspace } from "../src/index.js";
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
  const logoMark = await readFile(join(output, "logo-mark-white.png"));
  assert.deepEqual([...logoMark.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
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

test("static builds reject output symlinks that target workspace source files", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-build-internal-link-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await mkdir(join(root, ".filegrc", "site"), { recursive: true });
  const workspacePath = join(root, "data", "workspace.json");
  const original = await readFile(workspacePath, "utf8");
  await symlink(workspacePath, join(root, ".filegrc", "site", "index.html"));

  await assert.rejects(buildWorkspace(root), /symbolic link/);
  assert.equal(await readFile(workspacePath, "utf8"), original);
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
  assert.equal(state.resources.length, 3);
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
  const logoMarkResponse = await fetch(`${result.url}/logo-mark-white.png`);
  assert.equal(logoMarkResponse.status, 200);
  assert.equal(logoMarkResponse.headers.get("content-type"), "image/png");
  assert.deepEqual([...new Uint8Array(await logoMarkResponse.arrayBuffer()).subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

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

  const contentPath = "policies/policy-api.md";
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
        ownerIds: ["person-owner"],
        approverIds: ["person-approver"]
      },
      content: { content: "# API Policy\n\nInitial." }
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
    body: JSON.stringify({ path: "policies/missing.md", source: "# Missing" })
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
  assert.equal(state.repository.mode, "manual");
  assert.equal(state.readOnly, false);
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
      record: { ...entry.record, showOnboarding: false, completedStagePageIds: ["scope:system"] },
      revision: entry.revision
    })
  });
  assert.equal(response.status, 200);
  const system = JSON.parse(await readFile(join(root, "data", "systems", "system-onboarding-service.json"), "utf8"));
  assert.equal(system.inScope, true);
  const saved = JSON.parse(await readFile(join(root, "data", "renderer.json"), "utf8"));
  assert.equal(saved.showOnboarding, false);
  assert.deepEqual(saved.completedStagePageIds, ["scope:system"]);
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
        collectorIds: ["person-owner"]
      },
      content: { content: "# Quarterly review evidence" }
    })
  });
  assert.equal(response.status, 201);
  const saved = JSON.parse(await readFile(join(root, "data", "obligations", "obligation-review.json"), "utf8"));
  assert.deepEqual(saved.completionResourceIds, ["evidence-review"]);
  assert.equal(await readFile(join(root, "data", "evidence", "evidence-review", "evidence.md"), "utf8"), "# Quarterly review evidence\n");
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
  assert.match(APP_STYLES, /\.sidebar-nav\{scrollbar-width:none;-ms-overflow-style:none\}/);
  assert.match(APP_STYLES, /\.sidebar-nav::-webkit-scrollbar\{display:none\}/);
  assert.match(APP_SCRIPT, /const NAV_SCROLL_STORAGE_KEY = "filegrc\.sidebar\.scroll\.v1"/);
  assert.match(APP_SCRIPT, /if \(previousNavigation\) navigationScrollTop = previousNavigation\.scrollTop/);
  assert.match(APP_SCRIPT, /if \(nextNavigation\) nextNavigation\.scrollTop = navigationScrollTop/);
  assert.match(APP_SCRIPT, /sidebarNavigation\?\.addEventListener\("scroll"/);
  assert.match(APP_SCRIPT, /localStorage\.setItem\(NAV_SCROLL_STORAGE_KEY, String\(navigationScrollTop\)\)/);
  assert.match(APP_STYLES, /\.workspace\{height:100vh;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;/);
  assert.match(APP_STYLES, /\.sidebar-footer\{flex:0 0 auto;[^}]*background:#000024;/);
});

test("keeps repository and validation status in separate topbar controls", () => {
  assert.match(APP_SCRIPT, /class="topbar-status"/);
  assert.match(APP_SCRIPT, /class="validation-chip"/);
  assert.match(APP_SCRIPT, /class="repo-chip"/);
  assert.match(APP_SCRIPT, /Data valid/);
  assert.doesNotMatch(APP_SCRIPT, /class="side-validation"/);
  assert.match(APP_STYLES, /\.topbar-status\{display:flex;align-items:center;gap:8px\}/);
  assert.match(APP_STYLES, /\.repo-chip,\.validation-chip\{display:flex/);
});

test("uses compact topbar spacing on wide and narrow screens", () => {
  assert.match(APP_STYLES, /\.topbar\{height:63px\}/);
  assert.match(APP_STYLES, /@media\(max-width:760px\)\{\.topbar\{height:56px\}/);
});

test("uses the larger interface type scale", () => {
  assert.match(APP_STYLES, /\.nav-stage-copy strong\{font-size:12px/);
  assert.match(APP_STYLES, /\.button\{[^}]*font-size:14\.4px/);
  assert.match(APP_STYLES, /\.record-table\{[^}]*font-size:13\.2px/);
  assert.match(APP_STYLES, /\.markdown p,\.markdown li\{font-size:15\.6px/);
  assert.match(APP_STYLES, /\.page-intro h2,\.detail-head h2\{[^}]*font-size:37\.2px/);
});

test("persists each sidebar group state between page renders", () => {
  assert.match(APP_SCRIPT, /const NAV_GROUP_STORAGE_KEY = "filegrc\.sidebar\.groups\.v3"/);
  assert.match(APP_SCRIPT, /window\.localStorage\.getItem\(NAV_GROUP_STORAGE_KEY\)/);
  assert.match(APP_SCRIPT, /navigationGroupState\[stage\.id\] \?\? currentStage\?\.id === stage\.id/);
  assert.match(APP_SCRIPT, /navigationGroupState\[sectionKey\] \?\? \(sectionCurrent \|\| section\.defaultOpen\)/);
  assert.match(APP_SCRIPT, /querySelectorAll\("\.nav-toggle, \.nav-subgroup-toggle"\)/);
  assert.match(APP_SCRIPT, /setNavigationGroupOpen\(group\.dataset\.group, open\)/);
  assert.match(APP_SCRIPT, /window\.localStorage\.setItem\(NAV_GROUP_STORAGE_KEY, JSON\.stringify\(navigationGroupState\)\)/);
});

test("uses a black page canvas in dark mode", () => {
  assert.match(APP_STYLES, /@media\(prefers-color-scheme:dark\)\{\s*:root\{[^}]*--paper:#000;/);
  assert.match(APP_STYLES, /\.topbar\{background:rgba\(0,0,0,.9\)\}/);
});

test("centers close icons without relying on font metrics", () => {
  assert.match(APP_STYLES, /\.icon-button\{position:relative;display:grid;place-items:center;padding:0;/);
  assert.match(APP_STYLES, /\.icon-button:before,\.icon-button:after\{content:"";position:absolute;width:13px;height:2px;/);
  assert.match(APP_STYLES, /\.nav-close\{font-size:0\}/);
  assert.match(APP_STYLES, /\.nav-close:before,\.nav-close:after\{content:"";position:absolute;width:13px;height:2px;/);
});

test("uses the shared blue gradient and follows the browser color scheme", () => {
  assert.match(renderIndex(), /<meta name="color-scheme" content="light dark">/);
  assert.match(APP_STYLES, /--primary-gradient:linear-gradient\(135deg,#000070 0%,#000035 60%\)/);
  assert.match(APP_STYLES, /\.sidebar\{background:var\(--sidebar\);color:#eef1ff\}/);
  assert.match(APP_SCRIPT, /<img class="mark" src="\.\/logo-mark-white\.png" alt="" width="39" height="39">/);
  assert.match(APP_STYLES, /\.button\.primary\{background:var\(--primary-gradient\);border-color:#000070;color:#fff\}/);
  assert.match(APP_STYLES, /@media\(prefers-color-scheme:dark\)/);
});

test("places record context left of Markdown on wide screens", () => {
  assert.match(APP_STYLES, /@media\(min-width:761px\)\{\.detail-grid\{grid-template-columns:minmax\(270px,1fr\) minmax\(0,2fr\)\}/);
  assert.match(APP_STYLES, /\.detail-grid aside\{grid-column:1;grid-row:1\}/);
  assert.match(APP_STYLES, /\.detail-main\{grid-column:2;grid-row:1\}/);
  assert.match(APP_STYLES, /\.detail-grid\{grid-template-columns:1fr\}/);
});

test("uses the full detail width when a record has no authored body", () => {
  const detailSource = APP_SCRIPT.slice(APP_SCRIPT.indexOf("function renderDetail"), APP_SCRIPT.indexOf("function recordNarrative"));
  assert.match(detailSource, /const hasRecordBody = Boolean\(narrativeContent \|\| markdownContent\)/);
  assert.match(detailSource, /const detailMain = hasRecordBody/);
  assert.match(detailSource, /detail-grid-structured/);
  assert.doesNotMatch(detailSource, /Add Record Markdown when this record needs context beyond its structured fields/);
  assert.doesNotMatch(detailSource, /<h3>Record<\/h3>/);
  assert.match(APP_STYLES, /\.detail-grid\.detail-grid-structured\{grid-template-columns:1fr\}/);
  assert.match(APP_STYLES, /\.detail-grid-structured aside\{[^}]*grid-template-columns:repeat\(auto-fit,minmax\(320px,1fr\)\)/);
});

test("places source attributes first in record metadata", () => {
  assert.match(APP_SCRIPT, /const sourceMetadata = '<div><dt>Source file<\/dt>/);
  assert.match(APP_SCRIPT, /<dt>Workspace revision<\/dt>/);
  assert.match(APP_SCRIPT, /<dl class="metadata">' \+ sourceMetadata \+ visible\.map/);
  assert.doesNotMatch(APP_SCRIPT, /<h3>Source<\/h3>/);
});

test("uses a concise record edit action", () => {
  assert.match(APP_SCRIPT, /id="edit-resource">Edit<\/button>/);
  assert.doesNotMatch(APP_SCRIPT, /id="edit-resource">Edit record<\/button>/);
});

test("aligns list and record page headers", () => {
  assert.match(APP_SCRIPT, /class="detail-head"><div><div class="breadcrumbs header-breadcrumbs"/);
  assert.doesNotMatch(APP_SCRIPT, /class="type-pill"/);
  assert.match(APP_STYLES, /\.page-intro,\.detail-head\{align-items:center;margin-bottom:12px\}/);
  assert.match(APP_STYLES, /\.actions\{align-items:center\}/);
  assert.match(APP_STYLES, /\.page-guide\{[^}]*margin:0;/);
  assert.doesNotMatch(APP_STYLES, /\.page-guide\{margin-top:-/);
  assert.match(APP_STYLES, /\.detail-head h2\{margin:7px 0\}/);
  assert.match(APP_STYLES, /\.detail-head \.header-breadcrumbs\{margin:0;font-size:10\.8px;line-height:normal;min-height:11px;align-items:center\}/);
});

test("places list filters before the create action in the page header", () => {
  const listSource = APP_SCRIPT.slice(APP_SCRIPT.indexOf("function renderList"), APP_SCRIPT.indexOf("function renderDetail"));
  assert.match(listSource, /const listTools = '<div class="list-tools list-header-tools">/);
  assert.match(listSource, /records<\/span>' \+ createButton \+ '<\/div>'/);
  assert.match(listSource, /\+ listTools \+ '<\/div>' \+ resourceGuide\(type\)/);
  assert.match(APP_STYLES, /\.list-header-tools\{flex:1;justify-content:flex-end;margin:0 0 0 28px\}/);
  assert.match(APP_STYLES, /\.page-intro>\.list-header-tools\{justify-content:flex-start;margin:15px 0 0\}/);
});

test("provides model-driven Record Markdown without exposing its path", () => {
  assert.match(APP_SCRIPT, /function recordContentDefinition\(type\)/);
  assert.match(APP_SCRIPT, /!definition \|\| !config\?\.slot \|\| definition\.markdown/);
  assert.match(APP_SCRIPT, /data-record-content/);
  assert.match(APP_SCRIPT, /Add Record Markdown/);
  assert.match(APP_SCRIPT, /markdownPathFor\(updated\.type, updated\.id, recordContent\.slot\)/);
  assert.doesNotMatch(APP_SCRIPT, /data-field-group="' \+ esc\(markdown\.name\)/);
  assert.match(APP_SCRIPT, /entry\.content\[recordContent\.slot\]/);
  assert.match(APP_STYLES, /\.record-content-details\{/);
});

test("uses semantic nesting within the readiness sidebar", () => {
  assert.match(APP_SCRIPT, /const SHARED_PROGRAM_STAGES = \[/);
  assert.match(APP_SCRIPT, /const READINESS_STAGES = SHARED_PROGRAM_STAGES\.map/);
  assert.deepEqual(
    PROGRAM_PATH.map(({ number, title, description }) => ({ number, title, description })),
    [
      { number: 1, title: "Define Scope", description: "Ownership, criteria, and service boundary" },
      { number: 2, title: "Approve Policies", description: "Tailor, review, approve, and adopt" },
      { number: 3, title: "Implement Controls", description: "Tailor and finish the starter control set" },
      { number: 4, title: "Test Evidence Collection", description: "Verify sources before the period starts" },
      { number: 5, title: "Operate the Program", description: "Run the work and retain dated proof" },
      { number: 6, title: "Audit", description: "Firm, formal period, fieldwork, and report" }
    ]
  );
  const scopeStage = PROGRAM_PATH.find(({ id }) => id === "scope");
  const operationStage = PROGRAM_PATH.find(({ id }) => id === "run");
  const auditStage = PROGRAM_PATH.find(({ id }) => id === "audit");
  const section = (stage, title) => stage.sections.find((candidate) => candidate.title === title);
  assert.deepEqual(section(scopeStage, "Service Boundary").types, ["vendor", "system"]);
  assert.equal(section(scopeStage, "Dependencies"), undefined);
  assert.deepEqual(section(scopeStage, "Criteria").types, ["framework", "requirement", "commitment"]);
  assert.deepEqual(section(PROGRAM_PATH[2], "Control Catalog").types, ["control", "complementary-control"]);
  assert.deepEqual(section(operationStage, "Risk").types, ["risk-assessment", "risk"]);
  assert.ok(scopeStage.sections.findIndex(({ id }) => id === "criteria") < scopeStage.sections.findIndex(({ id }) => id === "boundary"));
  assert.equal(scopeStage.resourceTypes.includes("risk"), false);
  assert.deepEqual(section(operationStage, "Assets and Vendors").types, ["asset", "vendor-review"]);
  assert.deepEqual(section(PROGRAM_PATH[3], "Collection Test").types, ["evidence"]);
  assert.deepEqual(section(operationStage, "Work Queue").types, ["obligation", "obligation-event", "data-request"]);
  assert.deepEqual(section(operationStage, "Access and Training").types, ["service-account", "access-grant", "access-review", "training", "attestation"]);
  assert.deepEqual(section(auditStage, "Engagement").types, ["audit", "audit-request"]);
  assert.deepEqual(section(auditStage, "Fieldwork").types, ["audit-population", "control-test"]);
  assert.match(APP_SCRIPT, /\}\)\.join\(""\) \+ renderSidebarUtility\(section\.utility, route, direct\)/);
  assert.match(APP_SCRIPT, /for \(const type of section\.types\)[\s\S]*if \(section\.utility === "audit-packet"\) destinations\.push/);
  assert.ok(section(operationStage, "Governance").types.length);
  assert.match(APP_SCRIPT, /const direct = stage\.sections\.length === 1 \|\| sectionDestinations\(section\)\.length === 1/);
  assert.match(APP_SCRIPT, /if \(direct\) return links/);
  assert.match(APP_SCRIPT, /direct \? "nav-direct " : ""/);
  assert.match(APP_SCRIPT, /class="nav-group nav-stage /);
  assert.match(APP_SCRIPT, /class="nav-group nav-subgroup /);
  assert.match(APP_SCRIPT, /<button class="nav-subheading-row nav-subgroup-toggle" type="button"/);
  assert.match(APP_SCRIPT, /<span class="nav-subheading">/);
  assert.doesNotMatch(APP_SCRIPT, /class="nav-subheading [^"]*" href="#\/stage\//);
  assert.doesNotMatch(APP_SCRIPT, /class="nav-count"/);
  assert.match(APP_SCRIPT, /class="nav-control-slot"/);
  assert.doesNotMatch(APP_SCRIPT, /<span>Overview<\/span>/);
  assert.match(APP_SCRIPT, /class="nav-stage-number"/);
  assert.match(APP_SCRIPT, /class="brand"' \+ \(route\.name === "home" \? ' aria-current="page"'/);
  assert.doesNotMatch(APP_STYLES, /--nav-count-width/);
  assert.match(APP_STYLES, /--nav-control-width:14px/);
  assert.match(APP_STYLES, /\.nav-heading-row\{display:grid;grid-template-columns:minmax\(0,1fr\) 24px;gap:2px;align-items:stretch\}/);
  assert.match(APP_STYLES, /\.nav-heading-row>\.nav-heading\{display:grid;grid-template-columns:24px minmax\(0,1fr\)/);
  assert.match(APP_STYLES, /\.nav-stage-number\{display:grid;place-items:center/);
  assert.match(APP_STYLES, /\.nav-subheading-row\{display:grid;grid-template-columns:minmax\(0,1fr\) 22px;gap:2px;align-items:center;width:100%/);
  assert.match(APP_STYLES, /\.nav-toggle\{display:grid;place-items:center;width:24px;height:auto;min-height:100%/);
  assert.match(APP_STYLES, /\.nav-chevron\{display:block;width:12px;height:12px;place-self:center/);
  assert.match(APP_STYLES, /\.nav-stage>\.nav-items>a\.nav-direct\{[^}]*grid-template-columns:minmax\(0,1fr\) var\(--nav-control-width\)/);
  assert.doesNotMatch(APP_STYLES, /\.nav-count\{/);
  assert.match(APP_STYLES, /\.nav-group\.open>\.nav-heading-row \.nav-chevron,\.nav-group\.open>\.nav-subheading-row \.nav-chevron\{transform:rotate\(90deg\)\}/);
  assert.match(APP_SCRIPT, /href="#\/stage\/' \+ encodeURIComponent\(stage\.id\)/);
  assert.match(APP_SCRIPT, /class="nav-toggle nav-stage-toggle"/);
  assert.doesNotMatch(APP_SCRIPT, /class="nav-toggle nav-subtoggle"/);
  assert.match(APP_SCRIPT, /querySelectorAll\("\.nav-toggle, \.nav-subgroup-toggle"\)/);
  assert.match(APP_SCRIPT, /<svg class="nav-chevron" viewBox="0 0 12 12"/);
  assert.doesNotMatch(APP_SCRIPT, /<section class="nav-path"><p>Readiness path<\/p>/);
  assert.match(APP_SCRIPT, /function readinessStageForRoute\(route\)/);
  assert.match(APP_SCRIPT, /function renderOrganization\(main\)/);
  assert.match(APP_SCRIPT, /class="organization-nav /);
  assert.doesNotMatch(APP_SCRIPT, /<h3>People and Teams<\/h3>/);
  assert.deepEqual(section(scopeStage, "Program Ownership").types, ["person", "appointment", "team"]);
  assert.match(section(scopeStage, "Program Ownership").steps.join(" "), /Review the starter Security and Risk Oversight team/);
  assert.match(APP_SCRIPT, /Renderer and Repository/);
  assert.match(APP_SCRIPT, /function readinessOverview\(\)/);
  assert.match(APP_SCRIPT, /programStage\("scope", "Confirm program ownership, criteria, and commitments, then describe the service, supporting systems, and dependencies/);
  assert.match(APP_SCRIPT, /programStage\("run", "Begin the candidate period, maintain risk assessments/);
  assert.match(APP_SCRIPT, /programStage\("policies", "Tailor the policy set/);
  assert.match(APP_SCRIPT, /programStage\("controls", "Finish the internal control set[\s\S]*then record any complementary controls/);
  assert.match(APP_SCRIPT, /programStage\("evidence", "For each control family/);
  assert.doesNotMatch(APP_SCRIPT, /#\/program-readiness/);
  assert.doesNotMatch(APP_SCRIPT, /function renderProgramReadiness/);
  assert.match(APP_SCRIPT, /function auditEngagementPrompt\(audit = null\)/);
  assert.match(APP_SCRIPT, /Optional: Engage a CPA Firm Early/);
  assert.match(APP_SCRIPT, /function recordNarrative\(record, fields\)/);
  assert.match(APP_SCRIPT, /function resourceConnections\(entry\)/);
  assert.match(APP_SCRIPT, /Linked from /);
  assert.match(APP_SCRIPT, /Linked by /);
  assert.match(APP_SCRIPT, /if \(!definition\.relation \|\| definition\.legacy\) return/);
  assert.match(APP_SCRIPT, /field === "sourceReference"/);
  assert.match(APP_SCRIPT, /function safeExternalUrl\(value\)/);
  assert.match(APP_SCRIPT, /\["http:", "https:"\]\.includes\(url\.protocol\)/);
  assert.match(APP_STYLES, /\.readiness-flow\{display:grid;grid-template-columns:repeat\(3/);
  assert.match(APP_STYLES, /\.record-prose\{max-width:790px\}/);
  assert.match(APP_STYLES, /\.connections\{display:grid\}/);
  assert.match(APP_STYLES, /\.external-source\{display:flex/);
  assert.match(APP_STYLES, /\.organization-grid\{display:grid;grid-template-columns:repeat\(2/);
});

test("keeps IDs behind the guided editor and generates them from titles", () => {
  assert.match(APP_SCRIPT, /function createResourceId/);
  assert.match(APP_SCRIPT, /createResourceId\(type, nextTitle/);
  assert.match(APP_SCRIPT, /titleLabel \|\| state\.model\.commonFields\.title\.label/);
  assert.match(APP_SCRIPT, /A stable ID and file name will be generated from this value/);
  assert.doesNotMatch(APP_SCRIPT, /\[\s*"id",\s*"title"/);
});

test("proper-cases enum displays and uses native required validation", () => {
  assert.match(APP_SCRIPT, /function properCase\(value\)/);
  assert.match(APP_SCRIPT, /esc\(properCase\(item\)\)/);
  assert.match(APP_SCRIPT, /esc\(filterOptionLabel\(value\)\)/);
  assert.match(APP_SCRIPT, /if \(definition\?\.type === "enum"\) return esc\(properCase\(value\)\)/);
  assert.match(APP_SCRIPT, /status-' \+ esc\(String\(value\)\) \+ '">' \+ esc\(properCase\(value\)\)/);
  assert.match(APP_SCRIPT, /status-' \+ status \+ '">' \+ esc\(properCase\(status\)\)/);
  assert.match(APP_SCRIPT, /esc\(properCase\(item\.status\)\) \+ ' · ' \+ esc\(properCase\(item\.evidenceKind\)\)/);
  assert.match(APP_SCRIPT, /esc\(properCase\(item\.severity\)\)/);
  assert.match(APP_SCRIPT, /<option value="">Not Set<\/option>/);
  assert.match(APP_SCRIPT, /labelledControl = labelledControl\.replace\([\s\S]*"<\$1 required"/);
  assert.match(APP_SCRIPT, /wireEditorRequirements\(dialog, record, fields,/);
  assert.match(APP_SCRIPT, /checkbox\.required = required && index === requiredIndex/);
  assert.match(APP_SCRIPT, /choice\.control\.setCustomValidity\(choice\.present \? "" : "Provide at least one of:/);
  assert.match(APP_SCRIPT, /querySelector\("form"\)\.reportValidity\(\)/);
  assert.match(APP_SCRIPT, /querySelector\("form"\)\.noValidate = true/);
  assert.match(APP_SCRIPT, /field\.requiredWhen/);
});

test("title-cases multi-word navigation and interface headings", () => {
  assert.match(APP_SCRIPT, /function titleCase\(value\)/);
  assert.doesNotMatch(APP_SCRIPT, /title: "Scope Details"/);
  assert.ok(PROGRAM_PATH.some(({ sections }) => sections.some(({ title }) => title === "Work Queue")));
  assert.ok(PROGRAM_PATH.some(({ sections }) => sections.some(({ title }) => title === "Fieldwork")));
  assert.match(APP_SCRIPT, /esc\(titleCase\(definition\.pluralTitle\)\)/);
  assert.match(APP_SCRIPT, /if \(utility === "obligation-board"\) return ""/);
  assert.match(APP_SCRIPT, /<span>Audit Evidence &amp; Packet<\/span>/);
  assert.match(APP_SCRIPT, /<h1>' \+ esc\(titleCase\(title\)\)/);
  assert.match(APP_SCRIPT, /<h3>Prepare, Operate, Then Audit<\/h3>/);
  assert.match(APP_SCRIPT, /<h2>Prepare Fieldwork<\/h2>/);
  assert.match(APP_SCRIPT, /<h2>Repository State<\/h2>/);
  assert.match(APP_SCRIPT, /esc\(titleCase\(step\.title\)\)/);
});

test("lets record editors close without validating required fields", () => {
  assert.match(APP_SCRIPT, /<button type="button" class="icon-button" data-editor-dismiss aria-label="Close">/);
  assert.match(APP_SCRIPT, /<button type="button" class="button" data-editor-dismiss>Cancel<\/button>/);
  assert.match(APP_SCRIPT, /<button type="submit" class="button primary" id="save-record">/);
  assert.match(APP_SCRIPT, /querySelectorAll\("\[data-editor-dismiss\]"\).*dialog\.close\(\)/);
  assert.match(APP_SCRIPT, /querySelector\("form"\)\.addEventListener\("submit", async \(event\) => \{\s+event\.preventDefault\(\)/);
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

test("reuses Step-page instructions in the interactive index popover", () => {
  const listSource = APP_SCRIPT.slice(APP_SCRIPT.indexOf("function renderList"), APP_SCRIPT.indexOf("function renderDetail"));
  const detailSource = APP_SCRIPT.slice(APP_SCRIPT.indexOf("function renderDetail"), APP_SCRIPT.indexOf("function recordNarrative"));
  const guideSource = APP_SCRIPT.slice(APP_SCRIPT.indexOf("function resourceGuide"), APP_SCRIPT.indexOf("function setupResourceGuide"));
  assert.match(APP_SCRIPT, /function resourceGuide\(type\)/);
  assert.match(APP_SCRIPT, /function stagePageSummary\(destination\)/);
  for (const [type, instructions] of Object.entries(RESOURCE_INSTRUCTIONS)) {
    assert.ok(APP_SCRIPT.includes(JSON.stringify(type)), `${type} is included in renderer instructions`);
    assert.ok(APP_SCRIPT.includes(instructions), `${type} renderer instruction matches the headless guide`);
  }
  assert.match(guideSource, /const instructions = stagePageSummary\(\{ type \}\)/);
  assert.match(APP_SCRIPT, /definition\.description/);
  assert.match(APP_SCRIPT, /guidance\.policyBasis/);
  assert.match(APP_SCRIPT, /guidance\.sourceResourceIds/);
  assert.match(guideSource, /<span>Instructions<\/span><p>' \+ esc\(instructions\)/);
  assert.match(APP_SCRIPT, /<span>Use<\/span>/);
  assert.match(APP_SCRIPT, /<span>Policy basis<\/span>/);
  assert.match(guideSource, /<span>Instructions<\/span>[\s\S]*<span>Use<\/span>[\s\S]*<span>Policy basis<\/span>/);
  assert.doesNotMatch(guideSource, /<span>Timing<\/span>/);
  assert.doesNotMatch(guideSource, /guidance\.cadence/);
  assert.doesNotMatch(guideSource, /guidance\.obligationActivityTypes/);
  assert.match(listSource, /resourceGuide\(type\)/);
  assert.match(listSource, /id="resource-guide-trigger"/);
  assert.match(listSource, /M7\.8 7\.5a2\.4 2\.4 0 1 1/);
  assert.match(listSource, /resourceGuideCleanup = setupResourceGuide\(main\)/);
  assert.doesNotMatch(detailSource, /resourceGuide\(type\)/);
  assert.match(APP_SCRIPT, /id="resource-guide"[^>]+hidden/);
  assert.match(APP_SCRIPT, /trigger\.addEventListener\("mouseenter", show/);
  assert.match(APP_SCRIPT, /trigger\.addEventListener\("click"/);
  assert.match(APP_SCRIPT, /document\.addEventListener\("pointerdown"/);
  assert.match(APP_SCRIPT, /event\.key !== "Escape"/);
  assert.match(APP_STYLES, /\.page-guide\{display:grid;grid-template-columns:/);
  assert.match(APP_STYLES, /\.resource-guide-popover\{position:fixed;z-index:40;overflow:auto/);
  assert.match(APP_STYLES, /\.resource-guide-popover\[hidden\]\{display:none\}/);
  assert.match(APP_STYLES, /\.setup-banner,\.page-guide,\.stage-overview-hero/);
});

test("keeps operation status explicit without inline instruction panels", () => {
  assert.doesNotMatch(APP_SCRIPT, /function resourceWorkflowPanel\(type, entries\)/);
  assert.doesNotMatch(APP_SCRIPT, /class="stage-instructions/);
  assert.match(APP_SCRIPT, /function controlOperationTracking\(control\)/);
  assert.match(APP_SCRIPT, /Operation tracking/);
  assert.match(APP_SCRIPT, /Work Queue[\s\S]*linked/);
  assert.match(APP_SCRIPT, /Running in Work Queue/);
  assert.match(APP_SCRIPT, /Waiting for policy approval/);
  assert.match(APP_SCRIPT, /Ready when implemented/);
  assert.match(APP_SCRIPT, /Work Queue needs attention/);
  assert.match(APP_SCRIPT, /Not scheduled in Work Queue/);
  assert.match(APP_STYLES, /\.operation-tracking strong,\.operation-tracking small\{display:block;overflow-wrap:anywhere\}/);
  assert.match(APP_SCRIPT, /Show operation with evidence records/);
  assert.match(APP_SCRIPT, /function workQueueScheduleStatus\(obligation, control = null\)/);
  assert.match(APP_SCRIPT, /function obligationWorkQueueStatus\(obligation\)/);
  assert.match(APP_SCRIPT, /type === "obligation" \? \["\$workQueueStatus"\]/);
  assert.match(APP_SCRIPT, /type === "obligation" && name === "status"\) return "Configuration"/);
  assert.doesNotMatch(APP_SCRIPT, /Work Queue · ' \+ esc\(label\)/);
  assert.match(APP_SCRIPT, /governing policies are effective and at least one linked control is implemented/);
  assert.match(APP_SCRIPT, /preview and explicitly create the missing collection-test drafts/);
  assert.match(APP_SCRIPT, /Work Queue[\s\S]*Other controls operate continuously or per transaction in their source systems/);
  assert.doesNotMatch(APP_STYLES, /\.stage-instruction-grid/);
  assert.doesNotMatch(APP_STYLES, /\.evidence-instruction-grid/);
});

test("previews and creates Step 4 evidence drafts before using the standard record table", () => {
  assert.doesNotMatch(APP_SCRIPT, /function evidenceCollectionTestPlan\(\)/);
  assert.doesNotMatch(APP_SCRIPT, /data-edit-evidence-test/);
  assert.doesNotMatch(APP_SCRIPT, /Open Draft/);
  assert.doesNotMatch(APP_SCRIPT, /Finish Source Setup/);
  assert.doesNotMatch(APP_STYLES, /\.evidence-test-card/);
  assert.match(APP_SCRIPT, /function renderEvidenceTestDraftCallout\(\)/);
  assert.match(APP_SCRIPT, /state\.evidenceTestDrafts\?\.create/);
  assert.match(APP_SCRIPT, /data-preview-evidence-test-drafts/);
  assert.match(APP_SCRIPT, /Preview ' \+ missing\.length \+ " proposed "/);
  assert.match(APP_SCRIPT, /item\.testEvidenceKind/);
  assert.match(APP_SCRIPT, /item\.testPrompt/);
  assert.match(APP_SCRIPT, /item\.controlIds\.map\(formatReference\)/);
  assert.match(APP_SCRIPT, /data-create-evidence-test-drafts>Create test drafts/);
  assert.match(APP_SCRIPT, /localFetch\("\/api\/evidence-test-drafts", \{ method: "POST" \}\)/);
  assert.match(APP_SCRIPT, /evidenceTestDraftFeedback = \{/);
  assert.match(APP_SCRIPT, /state = await fetchJson\("\/api\/state"\)/);
  assert.match(APP_SCRIPT, /Created " \+ created\.length \+ " " \+ pluralize\("test draft"/);
  assert.match(APP_STYLES, /\.evidence-draft-callout\{/);
  assert.match(APP_STYLES, /\.evidence-draft-preview-item\{/);
  assert.match(APP_STYLES, /\.evidence-draft-preview\[hidden\]\{display:none\}/);
  assert.match(APP_SCRIPT, /<section class="record-table-wrap"><table class="record-table">/);
});

test("renders six navigable stage pages with instructions, links, and honest progress", () => {
  const cardSource = APP_SCRIPT.slice(APP_SCRIPT.indexOf("function stagePageCard"), APP_SCRIPT.indexOf("function stageProgress"));
  const summarySource = APP_SCRIPT.slice(APP_SCRIPT.indexOf("const STAGE_PAGE_SUMMARIES"), APP_SCRIPT.indexOf("const STAGE_PAGE_ID_ALIASES"));
  assert.match(APP_SCRIPT, /parts\.length === 2 && parts\[0\] === "stage"/);
  assert.doesNotMatch(APP_SCRIPT, /parts\.length === 3 && parts\[0\] === "stage"/);
  assert.match(APP_SCRIPT, /function renderStageOverview\(main, stageId, params = new URLSearchParams\(\)\)/);
  assert.match(APP_SCRIPT, /if \(stage\.id === "run"\) return renderObligations\(main, params\)/);
  assert.doesNotMatch(APP_SCRIPT, /function renderSectionOverview/);
  assert.match(APP_SCRIPT, /function renderStagePageIndex\(stage\)/);
  assert.match(APP_SCRIPT, /function stagePageCard\(stage, destination, index\)/);
  assert.match(APP_SCRIPT, /const summary = stagePageSummary\(destination\)/);
  assert.match(APP_SCRIPT, /function stageProgress\(stage\)/);
  assert.match(APP_SCRIPT, /function programPathProgress\(\)/);
  assert.match(APP_SCRIPT, /pages\.filter\(\(destination\) => stagePageComplete\(stagePageId\(stage, destination\)\)\)\.length/);
  assert.match(APP_SCRIPT, /if \(!total\) return \{ percent: 0/);
  assert.match(APP_SCRIPT, /Step ' \+ esc\(stage\.number\) \+ ' of 6/);
  assert.doesNotMatch(APP_SCRIPT, /<h3>Step Plan<\/h3>/);
  assert.doesNotMatch(APP_SCRIPT, /stage\.steps\.map/);
  assert.match(PROGRAM_PATH[0].summary, /Confirm the people and teams responsible for the program, set the management goal/);
  assert.match(APP_SCRIPT, /Record supplemental customer promises and service requirements/);
  assert.match(PROGRAM_PATH[2].summary, /Mark it implemented only after the procedure is operating/);
  assert.match(PROGRAM_PATH[4].summary, /Maintain current risk assessments and risks, updating the control set when needed/);
  assert.deepEqual(PROGRAM_PATH[0].sections[0].types, ["person", "appointment", "team"]);
  assert.deepEqual(PROGRAM_PATH[0].sections[1].types, ["framework", "requirement", "commitment"]);
  assert.deepEqual(PROGRAM_PATH[2].sections[0].types, ["control", "complementary-control"]);
  assert.equal(PROGRAM_PATH.some(({ sections }) => sections.some(({ id }) => id === "service-description")), false);
  assert.doesNotMatch(APP_SCRIPT, /Working areas/);
  assert.doesNotMatch(APP_SCRIPT, /Complete This Step/);
  assert.doesNotMatch(APP_SCRIPT, /Follow each area’s instructions/);
  assert.match(APP_SCRIPT, /class="stage-page-card ' \+ \(complete \? "complete" : ""\)/);
  assert.match(APP_SCRIPT, /const stepLabel = "Step " \+ stage\.number \+ "\." \+ String\.fromCharCode\(97 \+ index\)/);
  assert.match(cardSource, /<small>' \+ esc\(stepLabel\) \+ '<\/small><h3>' \+ esc\(destination\.label\)/);
  assert.doesNotMatch(cardSource, /destination\.description/);
  assert.doesNotMatch(cardSource, /guidance\?\.cadence/);
  assert.doesNotMatch(cardSource, /stage-page-actions?/);
  assert.match(summarySource, /Catalog all in-scope systems for the program\. Treat anything that operates a control or produces evidence as a System, including software provided by a vendor \(like HR software\)\./);
  assert.match(summarySource, /Catalog the companies that provide in-scope software or services\. Link each vendor-provided System with the System’s vendorId\./);
  assert.doesNotMatch(summarySource, /manage contracts, due diligence, supplier risk, and reviews/);
  const boundary = PROGRAM_PATH[0].sections.find(({ id }) => id === "boundary");
  assert.match(boundary.description, /An application or platform is a System because it operates controls or produces evidence/);
  assert.match(boundary.description, /the company providing it is a Vendor because contracts, due diligence, and supplier risk belong to that relationship/);
  assert.match(boundary.steps.join(" "), /Create a Vendor record for each material provider[\s\S]*connect vendor-provided Systems to their providers/);
  const issues = PROGRAM_PATH[4].sections.find(({ id }) => id === "issues");
  assert.equal(issues.title, "Issues and Remediation");
  assert.match(issues.steps.join(" "), /Create a Finding only when a confirmed gap needs its own owner/);
  assert.doesNotMatch(APP_SCRIPT, /function sectionContextNote/);
  assert.doesNotMatch(APP_SCRIPT, /class="relationship-note"/);
  assert.match(APP_STYLES, /\.stage-overview-hero\{display:grid/);
  assert.match(APP_STYLES, /\.stage-progress-card\{/);
  assert.match(APP_STYLES, /\.stage-pages\{margin-top:24px\}/);
  assert.match(APP_STYLES, /\.stage-page-grid\{display:grid/);
  assert.match(APP_STYLES, /\.stage-page-card\{position:relative;display:flex/);
  assert.match(APP_STYLES, /\.stage-page-card-link\{position:absolute;inset:0;z-index:1/);
});

test("uses the Step 5 page for compact policy-event triggers and the Work Queue", () => {
  const start = APP_SCRIPT.indexOf("function renderObligations");
  const end = APP_SCRIPT.indexOf("function obligationCard", start);
  const stepFive = APP_SCRIPT.slice(start, end);
  assert.match(APP_SCRIPT, /href="#\/stage\/run">Open board/);
  assert.match(APP_SCRIPT, /href="#\/stage\/run\?section=events"/);
  assert.doesNotMatch(stepFive, /renderStagePageIndex\(stage\)/);
  assert.doesNotMatch(stepFive, /data-stage-page-completion/);
  assert.ok(stepFive.indexOf("<h2>Policy Events</h2>") < stepFive.indexOf("<h2>Work Queue</h2>"));
  assert.match(stepFive, /policyEventTrigger\(trigger, index\)/);
  assert.match(stepFive, /Trigger Work/);
  assert.doesNotMatch(stepFive, /Trigger Workflow/);
  assert.match(stepFive, /Work added to the Work Queue/);
  assert.match(stepFive, /role="status" aria-live="polite"/);
  assert.match(stepFive, /data-view-added-work/);
  assert.match(stepFive, /data-dismiss-policy-event-feedback/);
  assert.match(stepFive, /role="tooltip"/);
  assert.match(stepFive, /class="policy-event-title"/);
  assert.match(stepFive, /class="guide-trigger policy-event-guide-trigger"/);
  assert.match(stepFive, /aria-label="Show ' \+ esc\(policyEventName\(trigger\.eventType\)\) \+ ' workflow steps"/);
  assert.doesNotMatch(stepFive, /class="policy-event-row" tabindex/);
  assert.match(stepFive, /Other controls operate continuously or per transaction in their source systems/);
  assert.match(APP_SCRIPT, /function operationProgress\(\)/);
  assert.match(APP_SCRIPT, /Evidence collection is running and the Work Queue has no overdue work/);
  const issues = PROGRAM_PATH[4].sections.find(({ id }) => id === "issues");
  assert.deepEqual(issues.types, ["finding"]);
  assert.match(stepFive, /plan\.standaloneItems\.length/);
  assert.match(stepFive, /data-new-action-item/);
  assert.match(APP_SCRIPT, /item\.kind === "action" \? "Assigned Follow-up"/);
  assert.match(APP_SCRIPT, /item\.kind === "event" \? "Policy Event Task"/);
  assert.doesNotMatch(stepFive, /Active and Recent Workflows/);
  assert.doesNotMatch(APP_SCRIPT, /function eventRunCard/);
  assert.doesNotMatch(APP_STYLES, /\.event-run/);
  assert.match(stepFive, /Triggered Policy Event actions appear here as individual tasks in Upcoming, Due, or Overdue/);
  assert.match(APP_SCRIPT, /data-record-finding/);
  assert.match(APP_SCRIPT, /data-add-action-item/);
  assert.match(APP_SCRIPT, /function issueSeed\(type, source\)/);
  assert.doesNotMatch(APP_SCRIPT, /href="#\/obligations"/);
  assert.match(APP_STYLES, /\.policy-event-list\{display:grid/);
  assert.match(APP_STYLES, /\.policy-event-tooltip\{position:absolute/);
  assert.match(APP_STYLES, /\.policy-event-guide:hover \.policy-event-tooltip,\.policy-event-guide:focus-within \.policy-event-tooltip/);
  assert.doesNotMatch(APP_STYLES, /\.policy-event-row:hover \.policy-event-tooltip/);
});

test("persists manual completion for step pages without blocking card navigation", () => {
  assert.match(APP_SCRIPT, /completedStagePageIds/);
  assert.match(APP_SCRIPT, /data-stage-page-completion/);
  assert.match(APP_SCRIPT, /Mark incomplete/);
  assert.match(APP_SCRIPT, /Mark complete/);
  assert.match(APP_SCRIPT, /function toggleStagePageCompletion\(button\)/);
  assert.match(APP_SCRIPT, /writeRendererSettingsResource/);
  assert.match(APP_SCRIPT, /event\.stopPropagation\(\)/);
  assert.match(APP_SCRIPT, /class="stage-page-card-link" href="' \+ destination\.href/);
  assert.match(APP_SCRIPT, /stage-page-card-foot"><span class="stage-page-open"[\s\S]*completionControl/);
  assert.match(APP_STYLES, /\.stage-page-card-head\{display:flex;align-items:center/);
  assert.match(APP_STYLES, /\.stage-page-rollup\{display:flex;flex:0 0 104px;flex-direction:column;justify-content:center/);
  assert.match(APP_STYLES, /\.stage-page-completion\{position:relative;z-index:2/);
});

test("runs optional onboarding from committed renderer settings", () => {
  assert.doesNotThrow(() => new Function(APP_SCRIPT));
  assert.match(APP_SCRIPT, /rendererSettingsEntry\(\)\?\.record\.showOnboarding === true/);
  assert.match(APP_SCRIPT, /function initialSetupBanner\(\)/);
  assert.match(APP_SCRIPT, /Setup draft saved/);
  assert.match(APP_SCRIPT, /Review the saved service boundary/);
  assert.match(APP_SCRIPT, /Confirm the saved program goal/);
  assert.match(APP_SCRIPT, /Complete setup to activate the planned service/);
  assert.match(APP_SCRIPT, /!state\.readOnly && rendererSettingsEntry/);
  assert.match(APP_SCRIPT, /onboardingDialog\.showModal\(\)/);
  assert.match(APP_SCRIPT, /onboardingDialog\.addEventListener\("cancel"/);
  assert.match(APP_SCRIPT, /function positionOnboardingShade\(target\)/);
  assert.match(APP_SCRIPT, /function onboardingTarget\(step\)/);
  assert.match(APP_SCRIPT, /window\.addEventListener\("scroll", positionCurrentOnboarding, true\)/);
  assert.match(APP_SCRIPT, /persistOnboardingPreference\(false\)/);
  assert.match(APP_SCRIPT, /localFetch\("\/api\/setup"/);
  assert.match(APP_SCRIPT, /Files are the program/);
  assert.match(APP_SCRIPT, /Choose the report goal/);
  assert.match(APP_SCRIPT, /function onboardingSteps\(\)[\s\S]*title: "Files are the program"[\s\S]*title: "Follow the audit chain"[\s\S]*title: "Choose the report goal"[\s\S]*title: "Engage the firm and prepare fieldwork"/);
  assert.match(APP_SCRIPT, /target: "\.repo-chip",[\s\S]*title: "Files are the program"/);
  assert.match(APP_SCRIPT, /SOC 2 is an independent CPA report on controls relevant to the selected Trust Services Criteria/);
  assert.match(APP_SCRIPT, /Most customer requests focus on Security/);
  assert.match(APP_SCRIPT, /Array\.isArray\(step\.body\)[\s\S]*<p class="onboarding-body">/);
  assert.match(APP_SCRIPT, /title: "Type 1"/);
  assert.match(APP_SCRIPT, /Type 1 is optional before Type 2/);
  assert.match(APP_SCRIPT, /title: "Type 2"/);
  assert.match(APP_SCRIPT, /often six months/);
  assert.match(APP_SCRIPT, /Most evidence comes from production, identity, monitoring/);
  assert.match(APP_SCRIPT, /onboarding-after-sections/);
  assert.match(APP_SCRIPT, /class="onboarding-sections"/);
  assert.match(APP_SCRIPT, /Follow the audit chain/);
  assert.match(APP_SCRIPT, /Scope starts with the people and oversight team, applicable criteria, commitments, material vendors, and in-scope systems/);
  assert.match(APP_SCRIPT, /Program operation includes current risk assessments and risks/);
  assert.match(APP_SCRIPT, /Work the policy queue/);
  assert.match(APP_SCRIPT, /Complete a checklist when key events occur/);
  assert.match(APP_SCRIPT, /Engage the firm and prepare fieldwork/);
  assert.match(APP_SCRIPT, /formal report period, fieldwork, and final report are the last stage/);
  assert.match(APP_SCRIPT, /This renderer edits those files/);
  assert.match(APP_SCRIPT, /Use the UI, an editor, the CLI, or an agent/);
  assert.match(APP_SCRIPT, /each browser save fast-forwards, validates, creates one focused commit, and pushes it/);
  assert.match(APP_SCRIPT, /Record status represents approval/);
  assert.match(APP_SCRIPT, /Agents and terminal users continue to manage Git explicitly/);
  assert.match(APP_SCRIPT, /The UI and filegrc CLI use the same calculation/);
  assert.match(APP_SCRIPT, /Every action has a policy-based cutoff or a reasonable default deadline/);
  assert.doesNotMatch(APP_SCRIPT, /no fixed (?:deadline|cutoff|overdue)/i);
  assert.match(APP_SCRIPT, /data-onboarding="draft">Save draft/);
  assert.doesNotMatch(APP_SCRIPT, /name="independentApproverName" maxlength/);
  assert.doesNotMatch(APP_SCRIPT, /name="independentApproverEmail" type="email" maxlength/);
  assert.match(APP_SCRIPT, /programGoal: onboardingDraft\.programGoal/);
  assert.doesNotMatch(APP_SCRIPT, /auditId: onboardingDraft\.auditId/);
  assert.match(APP_SCRIPT, /finish Step 1 by adding the real reviewers and operators, finishing the oversight team/);
  assert.match(APP_SCRIPT, /history\.replaceState\(null, "", draft \? "#\/" : "#\/stage\/scope"\)/);
  assert.match(APP_SCRIPT, /Complete the remaining Step 1 pages next/);
  assert.match(APP_SCRIPT, /browser saves and synchronizes the related files together/);
  assert.match(APP_SCRIPT, /selected for scope review, but it is not approved or active/);
  assert.match(APP_SCRIPT, /Completing onboarding will save its related workspace, system, and renderer changes in one commit and push it/);
  assert.match(APP_SCRIPT, /Manual repository mode/);
  assert.match(APP_SCRIPT, /Git setup needed/);
  assert.match(APP_SCRIPT, /Manual-mode writes still work/);
  assert.match(APP_SCRIPT, /The filegrc server is unavailable/);
  assert.match(APP_SCRIPT, /async function localFetch/);
  assert.match(APP_SCRIPT, /id="start-onboarding"/);
  assert.match(APP_SCRIPT, /id="commit-workspace"/);
  assert.match(APP_SCRIPT, /localFetch\("\/api\/commit"/);
  assert.match(APP_SCRIPT, /Commit and Push Workspace Changes/);
  assert.match(APP_SCRIPT, /result\.pushed/);
  assert.match(APP_SCRIPT, /result\.pushSkipped/);
  assert.match(APP_SCRIPT, /Commit locally/);
  assert.match(APP_SCRIPT, />Pull with rebase<\/button>/);
  assert.match(APP_SCRIPT, />Push<\/button>/);
  assert.match(APP_SCRIPT, /localFetch\("\/api\/git\/" \+ action/);
  assert.match(APP_SCRIPT, /state\.git\.upstream/);
  assert.match(APP_SCRIPT, /class="repository-sync-status"/);
  assert.match(APP_SCRIPT, /Pushed " \+ result\.shortCommit/);
  assert.match(APP_SCRIPT, /Retry sync/);
  assert.match(APP_SCRIPT, /Development write override active/);
  assert.match(APP_SCRIPT, /Pending FileGRC-only Commits/);
  assert.match(APP_SCRIPT, /nextCalendarOccurrence\(recurrence, currentDate\(\)\)/);
  assert.match(APP_STYLES, /\.onboarding-dialog::backdrop\{/);
  assert.match(APP_STYLES, /\.onboarding-dialog::backdrop\{background:transparent;backdrop-filter:none\}/);
  assert.match(APP_STYLES, /\.onboarding-shade\{position:fixed;inset:0;z-index:60;pointer-events:none\}/);
  assert.match(APP_STYLES, /\.onboarding-focus\{/);
  assert.match(APP_SCRIPT, /class="onboarding-scroll"/);
  assert.match(APP_STYLES, /\.onboarding-dialog\[open\]\{display:flex;flex-direction:column/);
  assert.match(APP_STYLES, /\.onboarding-scroll\{min-height:0;overflow-y:auto\}/);
  assert.match(APP_STYLES, /\.onboarding-actions\{flex:0 0 auto;[\s\S]*border-top:1px solid var\(--line\)/);
  assert.match(APP_SCRIPT, /--onboarding-step-count:' \+ steps\.length/);
  assert.match(APP_STYLES, /\.onboarding-progress\{grid-template-columns:repeat\(var\(--onboarding-step-count\),1fr\)/);
  assert.match(APP_STYLES, /\.onboarding-body\+\.onboarding-body\{margin-top:8px\}/);
  assert.match(APP_STYLES, /\.onboarding-git-status\{display:flex/);
  assert.match(APP_STYLES, /\.commit-dialog\{width:min\(560px/);
  assert.match(APP_STYLES, /@media\(max-width:520px\)\{\.onboarding-form,\.onboarding-sections,\.setup-steps\{grid-template-columns:1fr\}/);
});

test("renders shared obligation and evidence-packet workflows", () => {
  assert.match(APP_SCRIPT, /function renderObligations\(main, params = new URLSearchParams\(\)\)/);
  assert.match(APP_SCRIPT, /const sections = \["proposed", "upcoming", "due", "overdue"\]\.map/);
  assert.doesNotMatch(APP_SCRIPT, /class="metrics obligation-metrics"/);
  assert.match(APP_SCRIPT, /state\.obligations\.counts\.overdue/);
  assert.match(APP_SCRIPT, /state\.obligations\.counts\.proposed/);
  assert.match(APP_SCRIPT, /daysUntilOverdue/);
  assert.match(APP_SCRIPT, /dueWindowStart/);
  assert.match(APP_SCRIPT, /dueWindowEnd/);
  assert.match(APP_SCRIPT, /overdueOn/);
  assert.match(APP_SCRIPT, /localFetch\("\/api\/obligation-events"/);
  assert.match(APP_SCRIPT, /Add Tasks to Work Queue/);
  assert.match(APP_SCRIPT, /const created = await response\.json\(\)/);
  assert.match(APP_SCRIPT, /taskCount: created\.actions\?\.length \|\| trigger\.steps\.length/);
  assert.match(APP_SCRIPT, /history\.replaceState\(null, "", "#\/stage\/run"\)/);
  assert.match(APP_SCRIPT, /localFetch\(url,[\s\S]*\/api\/obligation-completions/);
  assert.match(APP_SCRIPT, /function obligationCompletionSeed\(type, item, obligation\)/);
  assert.match(APP_SCRIPT, /function currentPeopleForParties\(ids = \[\], seen = new Set\(\)\)/);
  assert.match(APP_SCRIPT, /function completionTeam\(item\)/);
  assert.match(APP_SCRIPT, /blocked: "Assign current owner"/);
  assert.match(APP_SCRIPT, /completion\?\.blocked === "Assign current owner"/);
  assert.doesNotMatch(APP_SCRIPT, /people\.slice\(0, 1\)/);
  assert.match(APP_SCRIPT, /data-record-obligation/);
  assert.match(APP_SCRIPT, /data-expand-obligations/);
  assert.match(APP_SCRIPT, /#\/stage\/run\?section=events/);
  assert.match(APP_SCRIPT, /#\/stage\/run\?event=/);
  assert.match(APP_SCRIPT, /params\.get\("event"\)/);
  assert.match(APP_SCRIPT, /function renderAuditPacket\(main/);
  assert.doesNotMatch(APP_SCRIPT, /function renderProgramReadiness\(/);
  assert.match(APP_SCRIPT, /function renderAuditPreparation\(preparation\)/);
  assert.match(APP_SCRIPT, /Review both evidence paths/);
  assert.match(APP_SCRIPT, /filegrc Evidence/);
  assert.match(APP_SCRIPT, /External Evidence/);
  assert.match(APP_SCRIPT, /localFetch\("\/api\/audit-preparation"/);
  assert.match(APP_SCRIPT, /localFetch\("\/api\/evidence-packet"/);
  assert.match(APP_SCRIPT, /let latestPacketResult = null/);
  assert.match(APP_SCRIPT, /root\.querySelector\("#packet-results"\)/);
  assert.match(APP_SCRIPT, /control matrix/i);
  assert.match(APP_SCRIPT, /required for delivery/i);
  assert.match(APP_SCRIPT, /class="packet-preflight"/);
  assert.match(APP_SCRIPT, /Generate draft/);
  assert.match(APP_STYLES, /\.obligation-board\{display:grid/);
  assert.match(APP_STYLES, /\.packet-builder form\{display:grid/);
  assert.match(APP_STYLES, /\.packet-preflight\{display:grid/);
});

test("keeps the overview focused on readiness, current work, and the audit", () => {
  assert.match(APP_SCRIPT, /function readinessOverview\(\)/);
  assert.match(APP_SCRIPT, /class="hero overview-hero"/);
  assert.match(APP_SCRIPT, /class="readiness-progress-summary"/);
  assert.match(APP_SCRIPT, /<span>Page Review Progress<\/span><strong>' \+ progress\.percent \+ '%<\/strong>/);
  assert.match(APP_SCRIPT, /program pages marked reviewed/);
  assert.match(APP_SCRIPT, /This tracks page review, while readiness checks the records themselves/);
  assert.match(APP_SCRIPT, /function distinctObligationPreviews\(items, limit\)/);
  assert.match(APP_SCRIPT, /const previewObligations = distinctObligationPreviews\(openObligations, 3\)/);
  assert.doesNotMatch(APP_SCRIPT, /obligationPreview\(openObligations\.slice\(0, 3\)\)/);
  assert.match(APP_SCRIPT, /<a class="button primary" href="' \+ nextHref \+ '">Continue<\/a>/);
  assert.doesNotMatch(APP_SCRIPT, /Build and test the management program first/);
  assert.doesNotMatch(APP_SCRIPT, /class="panel program-start-panel"/);
  assert.match(APP_SCRIPT, /class="overview-grid"/);
  assert.match(APP_SCRIPT, /class="panel obligation-panel"/);
  assert.match(APP_SCRIPT, /class="panel event-reminder-panel"/);
  assert.match(APP_SCRIPT, /class="panel audit-panel"/);
  assert.match(APP_SCRIPT, /No audit requests yet/);
  assert.doesNotMatch(APP_SCRIPT, /Baseline review/);
  assert.doesNotMatch(APP_SCRIPT, /Everything the program can track/);
  assert.doesNotMatch(APP_SCRIPT, /class="panel schedule-panel"/);
  assert.doesNotMatch(APP_SCRIPT, /function programSetup\(\)/);
  assert.match(APP_STYLES, /\.overview-hero\{min-height:72px;padding:10px 20px;align-items:center\}/);
  assert.match(APP_STYLES, /\.overview-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(APP_STYLES, /\.readiness-progress-summary\{display:grid;grid-template-columns:minmax\(0,1fr\) auto/);
  assert.match(APP_STYLES, /\.readiness-progress-summary>div>strong\{font-size:9\.6px;font-weight:700/);
});

test("uses stage names and routes overview cards through stage pages", () => {
  assert.match(APP_SCRIPT, /readinessStageForType\(type\)\?\.title/);
  assert.match(APP_SCRIPT, /programStage\("run", "Begin the candidate period/);
  assert.match(APP_SCRIPT, /function nextProgramStageHref\(\)/);
  assert.match(APP_SCRIPT, /READINESS_STAGES\.find\(\(stage\) => \{/);
  assert.match(APP_SCRIPT, /progress\.complete < progress\.total/);
  assert.doesNotMatch(APP_SCRIPT, /function readinessItemHref\(item\)/);
  assert.match(APP_SCRIPT, /programStage\("scope"[\s\S]*"#\/stage\/scope"/);
  assert.match(APP_SCRIPT, /programStage\("policies"[\s\S]*"#\/stage\/policies"/);
  assert.match(APP_SCRIPT, /programStage\("controls"[\s\S]*"#\/stage\/controls"/);
  assert.match(APP_SCRIPT, /programStage\("evidence"[\s\S]*"#\/stage\/evidence"/);
  assert.match(APP_SCRIPT, /programStage\("run"[\s\S]*"#\/stage\/run"/);
  assert.match(APP_SCRIPT, /"#\/stage\/audit"/);
  assert.doesNotMatch(APP_SCRIPT, /Open checklist/);
  assert.doesNotMatch(APP_STYLES, /\.program-next-action\{/);
  assert.match(APP_SCRIPT, /#\/resources\/audit\?new=1/);
  assert.match(APP_SCRIPT, /params\.get\("new"\) === "1"[\s\S]*queueMicrotask\(\(\) => openEditor\(type\)\)/);
  assert.match(APP_STYLES, /\.readiness-state\{/);
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
