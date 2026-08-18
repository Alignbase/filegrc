import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { buildWorkspace, PROGRAM_PATH, renderMarkdown, RESOURCE_INSTRUCTIONS, RESOURCE_PAGE_SUMMARIES, serveWorkspace } from "../src/index.js";
import { APP_SCRIPT, APP_STYLES, dashboardProgramReadiness, renderIndex } from "../src/web.js";
import { makeWorkspace, writeJson } from "./helpers.js";

const DEV_SCRIPT = await readFile(new URL("../../../scripts/dev.mjs", import.meta.url), "utf8");
const execute = promisify(execFile);
const CLI = fileURLToPath(new URL("../bin/filegrc.js", import.meta.url));

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

test("uses item-level program readiness for the dashboard lifecycle summary", () => {
  assert.deepEqual(dashboardProgramReadiness({
    progress: { percent: 11, complete: 7, total: 62 },
    evidenceReady: false,
    operating: false
  }), {
    percent: 11,
    complete: 7,
    total: 62,
    status: "Needs work",
    tone: "warn"
  });
  assert.deepEqual(dashboardProgramReadiness({
    progress: { percent: 100, complete: 62, total: 62 },
    status: "evidence-ready",
    evidenceReady: true,
    operating: false,
    target: {
      goal: "soc-2-type-2",
      candidateCoverage: { kind: "range", startsOn: "2026-09-01", endsOn: "2027-02-28" }
    }
  }), {
    percent: 100,
    complete: 62,
    total: 62,
    status: "Evidence ready",
    tone: "good"
  });
  assert.deepEqual(dashboardProgramReadiness({
    progress: { percent: 100, complete: 62, total: 62 },
    status: "operating",
    evidenceReady: true,
    operating: true,
    target: {
      goal: "soc-2-type-2",
      candidateCoverage: { kind: "range", startsOn: "2026-08-01", endsOn: "2027-01-31" }
    }
  }), {
    percent: 100,
    complete: 62,
    total: 62,
    status: "Operating",
    tone: "good"
  });
});

test("static and editable dashboards receive the same program readiness progress", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-dashboard-state-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);

  const { state: staticState } = await buildWorkspace(root);
  const result = await serveWorkspace(root, { port: 0, allowNonAuthoritativeWrites: true });
  context.after(() => new Promise((resolve) => result.server.close(resolve)));
  const editableState = await fetch(`${result.url}/api/state`).then((response) => response.json());
  const cliSummary = JSON.parse((await execute(process.execPath, [
    CLI,
    "program-readiness",
    "--root",
    root,
    "--as-of",
    staticState.asOf,
    "--summary",
    "--json"
  ])).stdout);

  assert.equal(staticState.readOnly, true);
  assert.equal(editableState.readOnly, false);
  assert.deepEqual(editableState.programReadiness.progress, staticState.programReadiness.progress);
  assert.deepEqual(staticState.programReadiness.progress, cliSummary.progress);
  assert.deepEqual(
    dashboardProgramReadiness(editableState.programReadiness),
    dashboardProgramReadiness(staticState.programReadiness)
  );
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
  const ownerSummary = state.resources.find(({ record }) => record.id === "person-owner");
  assert.equal(ownerSummary.detailsLoaded, false);
  assert.equal(ownerSummary.history, undefined);
  const ownerDetailResponse = await fetch(`${result.url}/api/resource/person/person-owner`);
  assert.equal(ownerDetailResponse.status, 200);
  const ownerDetail = await ownerDetailResponse.json();
  assert.equal(ownerDetail.detailsLoaded, true);
  assert.deepEqual(ownerDetail.history, []);
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
    id: "person-api-reviewer",
    type: "person",
    affiliation: "internal",
    title: "API Reviewer",
    status: "active",
    affiliation: "internal"
  };
  const createResponse = await fetch(`${result.url}/api/resources`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ record: person })
  });
  assert.equal(createResponse.status, 201);
  const createdPerson = await createResponse.json();
  const duplicateResponse = await fetch(`${result.url}/api/resources`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ record: person })
  });
  assert.equal(duplicateResponse.status, 409);
  const rawRecordResponse = await fetch(`${result.url}/api/resources`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...person, id: "person-raw-record" })
  });
  assert.equal(rawRecordResponse.status, 400);
  assert.match((await rawRecordResponse.json()).error, /mutation envelope/);
  const primitiveResponse = await fetch(`${result.url}/api/resources`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "null"
  });
  assert.equal(primitiveResponse.status, 400);
  const invalidIdResponse = await fetch(`${result.url}/api/resources`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ record: { ...person, id: "Invalid ID" } })
  });
  assert.equal(invalidIdResponse.status, 400);
  person.department = "Security";
  const missingRevisionResponse = await fetch(`${result.url}/api/resource/person/person-api-reviewer`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ record: person })
  });
  assert.equal(missingRevisionResponse.status, 400);
  assert.match((await missingRevisionResponse.json()).error, /revision is required/);
  const personEntry = createdPerson.state.resources.find(({ record }) => record.id === person.id);
  const updateResponse = await fetch(`${result.url}/api/resource/person/person-api-reviewer`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ record: person, revision: personEntry.revision })
  });
  assert.equal(updateResponse.status, 200);
  const updatedPerson = await updateResponse.json();
  const updatedPersonEntry = updatedPerson.state.resources.find(({ record }) => record.id === person.id);
  const deleteResponse = await fetch(
    `${result.url}/api/resource/person/person-api-reviewer?revision=${encodeURIComponent(updatedPersonEntry.revision)}`,
    { method: "DELETE" }
  );
  assert.equal(deleteResponse.status, 200);

  const contentPath = "policies/policy-api.md";
  const policyResponse = await fetch(`${result.url}/api/resources`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      record: {
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
  await policyResponse.json();
  const policyEntry = await (
    await fetch(`${result.url}/api/resource/policy/policy-api`)
  ).json();
  const contentResponse = await fetch(`${result.url}/api/content`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      path: contentPath,
      source: "# API Policy\n\nUpdated.",
      revision: policyEntry.content.content.revision
    })
  });
  assert.equal(contentResponse.status, 200);
  assert.match(await readFile(join(root, "data", contentPath), "utf8"), /Updated/);
  const missingContentResponse = await fetch(`${result.url}/api/content`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      path: "policies/missing.md",
      source: "# Missing",
      revision: "0".repeat(64)
    })
  });
  assert.equal(missingContentResponse.status, 404);
  const missingContentError = (await missingContentResponse.json()).error;
  assert.equal(missingContentError, "The requested file was not found.");
  assert.equal(missingContentError.includes(root), false);

  const ownerEntry = state.resources.find(({ record }) => record.id === "person-owner");
  const ownerPath = join(root, ownerEntry.relativePath);
  const externallyEditedOwner = { ...ownerEntry.record, department: "Externally edited" };
  await writeFile(ownerPath, `${JSON.stringify(externallyEditedOwner, null, 2)}\n`, "utf8");
  const staleResponse = await fetch(`${result.url}/api/resource/person/person-owner`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      record: { ...ownerEntry.record, department: "Stale browser edit" },
      revision: ownerEntry.revision
    })
  });
  assert.equal(staleResponse.status, 409);
  assert.equal(JSON.parse(await readFile(ownerPath, "utf8")).department, "Externally edited");

  const wrongSchemeResponse = await fetch(`${result.url}/api/resources`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: result.url.replace("http:", "https:")
    },
    body: JSON.stringify({ record: person })
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

test("falls back to an available port only when requested", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-server-port-fallback-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);

  const blocker = createServer();
  await new Promise((resolve, reject) => {
    blocker.once("error", reject);
    blocker.listen(0, "127.0.0.1", resolve);
  });
  context.after(() => new Promise((resolve) => blocker.close(resolve)));
  const occupiedPort = blocker.address().port;

  await assert.rejects(
    serveWorkspace(root, { port: occupiedPort }),
    (error) => error.code === "EADDRINUSE"
  );
  const result = await serveWorkspace(root, {
    port: occupiedPort,
    fallbackToAvailablePort: true
  });
  context.after(() => new Promise((resolve) => result.server.close(resolve)));
  assert.equal(result.requestedPort, occupiedPort);
  assert.equal(result.usedFallbackPort, true);
  assert.notEqual(result.address.port, occupiedPort);
  assert.equal((await fetch(`${result.url}/api/state`)).status, 200);
});

test("enables local-only browser writes for the internal development server", () => {
  assert.match(DEV_SCRIPT, /fallbackToAvailablePort: true,[\s\S]*allowNonAuthoritativeWrites: true/);
  assert.match(DEV_SCRIPT, /browser changes stay local and are not committed or pushed/);
  assert.match(DEV_SCRIPT, /policyOwnerEmail: "security@example\.com"/);
  assert.match(DEV_SCRIPT, /timezone: Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone \|\| "UTC"/);
});

test("persists onboarding resources without requiring Git", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-onboarding-setting-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await writeJson(join(root, "data", "renderer.json"), {
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
        id: "system-onboarding-service",
        type: "system",
        title: "Onboarding Service",
        status: "active",
        criticality: "high",
        ownerIds: ["person-owner"],
        description: "Production service boundary.",
        systemKind: "service",
        classificationId: "confidential",
        internetExposed: true,
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
  const workspace = JSON.parse(await readFile(join(root, "data", "workspace.json"), "utf8"));
  assert.equal((workspace.systemIds || []).includes(system.id), false);
  const saved = JSON.parse(await readFile(join(root, "data", "renderer.json"), "utf8"));
  assert.equal(saved.showOnboarding, false);
  assert.deepEqual(saved.completedStagePageIds, ["scope:system"]);
  const deleteResponse = await fetch(
    `${result.url}/api/resource/renderer-settings/renderer-settings?revision=${encodeURIComponent(entry.revision)}`,
    { method: "DELETE" }
  );
  assert.equal(deleteResponse.status, 400);
  assert.match((await deleteResponse.json()).error, /Singleton records cannot be deleted/);
  const localPathAttachmentResponse = await fetch(`${result.url}/api/evidence-attachments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      evidenceId: "evidence-example",
      sourcePath: "/etc/passwd",
      revision: "unused"
    })
  });
  assert.equal(localPathAttachmentResponse.status, 404);
});

test("records and links obligation work through the writable API", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-obligation-completion-api-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await mkdir(join(root, "data", "obligations"), { recursive: true });
  await writeJson(join(root, "data", "obligations", "obligation-review.json"), {
    id: "obligation-review",
    type: "obligation",
    title: "Quarterly review",
    status: "active",
    activityType: "inventory-review",
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
        id: "evidence-review",
        type: "evidence",
        title: "Quarterly review evidence",
        status: "collected",
        artifactKind: "business-record",
        artifactSubtype: "review",
        sourceKind: "authored-record",
        sourceDescription: "Internal review",
        collectedOn: "2026-01-20",
        classificationId: "internal",
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
  assert.match(APP_STYLES, /@media\(max-width:760px\)\{\.topbar\{height:56px\}\.topbar>div:first-of-type\{display:none\}\.search\{flex:1;min-width:0\}/);
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
  assert.match(APP_STYLES, /\.repository-override,\.repository-sync-alert\{border-color:#77612f;background:#382f19\}/);
  assert.match(APP_STYLES, /\.repository-override code\{color:#ffe2a3\}/);
  assert.match(APP_STYLES, /\.workflow-finding-status\.ready,[^}]*\.stage-page-completion-state,[^}]*\.readiness-state\.warn,[^}]*\.preparation-status\.later\{background:#483714;color:#ffd991\}/);
  assert.match(APP_STYLES, /\.workflow-finding-status\.overdue,[^}]*\.readiness-state\.bad,[^}]*\.preparation-status\.action\{background:#4a252a;color:#ffb5ad\}/);
  assert.match(APP_STYLES, /\.workflow-finding-status\.complete,[^}]*\.stage-page-completion-state\.complete,[^}]*\.readiness-state\.good,[^}]*\.preparation-status\.complete\{background:#173b2b;color:#a8edc4\}/);
  assert.match(APP_STYLES, /\.badge\.status-overdue,\.badge\.status-blocked\{background:#4a252a;color:#ffb5ad\}/);
  assert.match(APP_STYLES, /\.stage-page-card\.complete,\.evidence-map-card\.complete\{border-color:#315f48\}/);
  assert.match(APP_STYLES, /\.evidence-map-source\.complete\{border-color:#315f48;background:#183426\}/);
  assert.match(APP_STYLES, /\.operation-tracking\.running strong\{color:#a8edc4\}/);
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

test("renders nested relationship values without exposing raw JSON", () => {
  assert.match(APP_SCRIPT, /function formatObjectArray\(items, objectType, compact = false\)/);
  assert.match(APP_SCRIPT, /definition\?\.items === "object"\) return formatObjectArray/);
  assert.match(APP_SCRIPT, /formatValue\(name === "status" \? displayStatus\(entry\.record\) : entry\.record\[name\], name, type, true\)/);
  assert.match(APP_STYLES, /\.object-value-list\{display:grid;gap:7px\}/);
});

test("uses model-driven controls for fixed-shape object fields", () => {
  assert.match(APP_SCRIPT, /schema\?\.additionalProperties === false/);
  assert.match(APP_SCRIPT, /function objectPropertyFields\(schema, value = \{\}\)/);
  assert.match(APP_SCRIPT, /function readStructuredObject\(container\)/);
  assert.match(APP_SCRIPT, /wireStructuredObjectEditors\(dialog\)/);
  assert.match(APP_SCRIPT, /return fieldWrap\(name, "structured-object"/);
  assert.match(APP_STYLES, /\.structured-object-fields\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(APP_SCRIPT, /nested\?\.additionalProperties\?\.type === "string"/);
  assert.match(APP_SCRIPT, /function stringMapEditor\(value = \{\}, name = "item"\)/);
  assert.match(APP_SCRIPT, /function readStringMap\(container\)/);
  assert.match(APP_STYLES, /\.string-map-row\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\) auto/);
  assert.match(APP_SCRIPT, /typeof value === "object" && !Array\.isArray\(value\) && !Object\.keys\(value\)\.length/);
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
  assert.match(listSource, /records<\/span>' \+ applicabilityButton \+ createButton \+ '<\/div>'/);
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
      { number: 3, title: "Implement Controls", description: "Finish controls and their evidence sources" },
      { number: 4, title: "Operate the Program", description: "Run the work and retain dated proof" },
      { number: 5, title: "Audit", description: "Firm, formal period, fieldwork, and report" }
    ]
  );
  const scopeStage = PROGRAM_PATH.find(({ id }) => id === "scope");
  const operationStage = PROGRAM_PATH.find(({ id }) => id === "run");
  const auditStage = PROGRAM_PATH.find(({ id }) => id === "audit");
  const section = (stage, title) => stage.sections.find((candidate) => candidate.title === title);
  assert.deepEqual(section(scopeStage, "System Boundary").types, ["system", "component", "vendor", "classification", "information-type"]);
  assert.equal(section(scopeStage, "Dependencies"), undefined);
  assert.deepEqual(section(scopeStage, "Program and Criteria").types, ["program", "framework", "requirement", "commitment"]);
  assert.deepEqual(section(PROGRAM_PATH[2], "Control Catalog").types, ["control", "complementary-control"]);
  assert.deepEqual(section(operationStage, "Risk").types, ["risk-assessment", "risk"]);
  assert.ok(scopeStage.sections.findIndex(({ id }) => id === "criteria") < scopeStage.sections.findIndex(({ id }) => id === "boundary"));
  assert.equal(scopeStage.resourceTypes.includes("risk"), false);
  assert.deepEqual(section(operationStage, "Assets and Vendors").types, ["asset", "vendor-review"]);
  assert.deepEqual(section(operationStage, "Work Queue").types, ["obligation", "obligation-event", "data-request"]);
  assert.deepEqual(section(operationStage, "Evidence Artifacts").types, ["evidence"]);
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
  assert.match(APP_SCRIPT, /return \[stage\.title, stage\.summary, href/);
  assert.match(APP_SCRIPT, /programStage\("scope", "#\/stage\/scope"\)/);
  assert.match(APP_SCRIPT, /programStage\("run", "#\/stage\/run"\)/);
  assert.match(APP_SCRIPT, /programStage\("policies", "#\/stage\/policies"\)/);
  assert.match(APP_SCRIPT, /programStage\("controls", "#\/stage\/controls"\)/);
  assert.doesNotMatch(APP_SCRIPT, /programStage\("evidence"/);
  assert.doesNotMatch(APP_SCRIPT, /#\/program-readiness/);
  assert.doesNotMatch(APP_SCRIPT, /function renderProgramReadiness/);
  assert.match(APP_SCRIPT, /function auditEngagementPrompt\(audit = null\)/);
  assert.match(APP_SCRIPT, /Optional: Engage a CPA Firm Early/);
  assert.match(APP_SCRIPT, /function recordNarrative\(record, fields\)/);
  assert.match(APP_SCRIPT, /function resourceConnections\(entry\)/);
  assert.match(APP_SCRIPT, /\.\.\.\(definition\.formFields \|\| \[\]\)/);
  assert.match(APP_SCRIPT, /Linked from /);
  assert.match(APP_SCRIPT, /Linked by /);
  assert.doesNotMatch(APP_SCRIPT, /definition\.legacy/);
  assert.match(APP_SCRIPT, /const relatedPeopleOnly = entry\.record\.type === "person"/);
  assert.match(APP_SCRIPT, /relatedPeopleOnly && connectedEntry\.record\.type !== "person"/);
  assert.match(APP_SCRIPT, /relatedPeopleOnly \? "Related people" : "Connections"/);
  assert.match(APP_SCRIPT, /Appointments and teams/);
  assert.match(APP_SCRIPT, /Assigned records/);
  assert.doesNotMatch(APP_SCRIPT, /Legacy fields need migration/);
  assert.match(APP_SCRIPT, /field === "sourceReference"/);
  assert.match(APP_SCRIPT, /function safeExternalUrl\(value\)/);
  assert.match(APP_SCRIPT, /\["http:", "https:"\]\.includes\(url\.protocol\)/);
  assert.match(APP_STYLES, /\.readiness-flow\{display:grid;grid-template-columns:repeat\(3/);
  assert.match(APP_STYLES, /\.record-prose\{max-width:790px\}/);
  assert.match(APP_STYLES, /\.connections\{display:grid\}/);
  assert.match(APP_STYLES, /\.external-source\{display:flex/);
  assert.match(APP_SCRIPT, /function resourceCreationAllowed\(type\)/);
  assert.match(APP_SCRIPT, /resourceCreationAllowed\(type\) \? '<button class="button primary"/);
  assert.match(APP_SCRIPT, /params\.get\("new"\) === "1"[\s\S]*resourceCreationAllowed\(type\)/);
  assert.match(APP_STYLES, /\.organization-grid\{display:grid;grid-template-columns:repeat\(2/);
});

test("keeps IDs behind the guided editor and generates them from titles", () => {
  assert.match(APP_SCRIPT, /function createResourceId/);
  assert.match(APP_SCRIPT, /createResourceId\(type, nextTitle/);
  assert.match(APP_SCRIPT, /titleLabel \|\| state\.model\.commonFields\.title\.label/);
  assert.match(APP_SCRIPT, /A stable ID and file name will be generated from this value/);
  assert.match(APP_SCRIPT, /labels\.slice\(0, -1\)\.join\(", "\) \+ ", or " \+ labels\.at\(-1\)/);
  assert.doesNotMatch(APP_SCRIPT, /\[\s*"id",\s*"title"/);
  assert.doesNotMatch(APP_SCRIPT, /state\.model\.resources\[record\.type\]\.title \+ " · " \+ record\.id/);
  assert.match(APP_SCRIPT, /function relationTypeLabel\(field, plural = false\)/);
  assert.match(APP_SCRIPT, /field\.relation\.length > 3\) return plural \? "Resources" : "resource"/);
  assert.match(APP_SCRIPT, /field\.relation\.length > 3\) return "References supported records"/);
});

test("proper-cases enum displays and uses native required validation", () => {
  assert.match(APP_SCRIPT, /function properCase\(value\)/);
  assert.match(APP_SCRIPT, /esc\(properCase\(item\)\)/);
  assert.match(APP_SCRIPT, /field === "evidenceSourceKinds"\) return value\.map\(\(item\) => '<span class="tag choice-tag">' \+ esc\(properCase\(item\)\)/);
  assert.match(APP_SCRIPT, /esc\(filterOptionLabel\(value\)\)/);
  assert.match(APP_SCRIPT, /if \(definition\?\.type === "enum"\) return esc\(properCase\(value\)\)/);
  assert.match(APP_SCRIPT, /status-' \+ esc\(String\(value\)\) \+ '">' \+ esc\(properCase\(value\)\)/);
  assert.match(APP_SCRIPT, /status-' \+ status \+ '">' \+ esc\(properCase\(status\)\)/);
  assert.match(APP_SCRIPT, /esc\(properCase\(item\.status\)\) \+ ' · ' \+ esc\(properCase\(item\.artifactKind\)\)/);
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

test("gives missing records and routes a concise recovery path", () => {
  assert.match(APP_SCRIPT, /const recordMissing = route\.name === "detail" && definition/);
  assert.match(APP_SCRIPT, /definition\.title \+ " Not Found"/);
  assert.match(APP_SCRIPT, /This record may have been renamed or deleted/);
  assert.match(APP_SCRIPT, /Back to ' \+ esc\(titleCase\(definition\.pluralTitle\)\)/);
  assert.match(APP_SCRIPT, />Program overview<\/a>/);
  assert.doesNotMatch(APP_SCRIPT, /That resource does not exist/);
  assert.match(APP_STYLES, /\.not-found\{max-width:620px;padding:28px\}/);
});

test("lets record editors close without validating required fields", () => {
  assert.match(APP_SCRIPT, /<button type="button" class="icon-button" data-editor-dismiss aria-label="Close">/);
  assert.match(APP_SCRIPT, /<button type="button" class="button" data-editor-dismiss>Cancel<\/button>/);
  assert.match(APP_SCRIPT, /<button type="submit" class="button primary" id="save-record">/);
  assert.match(APP_SCRIPT, /querySelectorAll\("\[data-editor-dismiss\]"\).*dialog\.close\(\)/);
  assert.match(APP_SCRIPT, /querySelector\("form"\)\.addEventListener\("submit", async \(event\) => \{\s+event\.preventDefault\(\)/);
  assert.match(APP_SCRIPT, /const items = Array\.isArray\(value\) \? value : \[\]/);
});

test("saves collection confirmations without a repetitive preview step", () => {
  assert.match(APP_SCRIPT, /<strong>What this saves<\/strong>/);
  assert.match(APP_SCRIPT, /<button type="submit" class="button primary">Confirm and save<\/button>/);
  assert.match(APP_SCRIPT, /localFetch\("\/api\/collection-review",/);
  assert.match(APP_SCRIPT, /saveStatus\.textContent = "Not saved"/);
  assert.doesNotMatch(APP_SCRIPT, /data-preview-collection-review/);
  assert.doesNotMatch(APP_SCRIPT, /localFetch\("\/api\/collection-review\/preview",/);
});

test("uses one accessible confirmation pattern for destructive and evidence-file actions", () => {
  assert.match(APP_SCRIPT, /function confirmAction\(\{ kicker, title, message, confirmLabel = "Confirm", danger = false \}\)/);
  assert.match(APP_SCRIPT, /aria-describedby", "confirmation-dialog-message"/);
  assert.match(APP_SCRIPT, /kicker: "Delete record"[\s\S]*confirmLabel: "Delete"[\s\S]*danger: true/);
  assert.match(APP_SCRIPT, /kicker: "Attach evidence"[\s\S]*confirmLabel: "Attach"/);
  assert.match(APP_SCRIPT, /const input = event\.currentTarget;\s+const file = input\.files\?\.\[0\]/);
  assert.match(APP_SCRIPT, /\}\)\) \{\s+input\.value = ""/);
  assert.match(APP_SCRIPT, /kicker: "Remove attachment"[\s\S]*confirmLabel: "Remove"[\s\S]*danger: true/);
  assert.doesNotMatch(APP_SCRIPT, /\bconfirm\(/);
  assert.match(APP_STYLES, /\.button\.danger-action\{background:var\(--red\);border-color:var\(--red\);color:#fff\}/);
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
  assert.match(APP_STYLES, /\.topbar h1\{overflow:hidden;text-overflow:ellipsis;white-space:nowrap\}/);
  assert.match(APP_SCRIPT, /const clearSearch = \(\) => \{[\s\S]*if \(search\?\.value\.trim\(\) === query\) search\.value = ""/);
  assert.match(APP_SCRIPT, /querySelector\("\.icon-button"\)\.onclick = \(\) => \{\s+clearSearch\(\)/);
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

test("keeps concise Step-page summaries separate from detailed resource guides", () => {
  const listSource = APP_SCRIPT.slice(APP_SCRIPT.indexOf("function renderList"), APP_SCRIPT.indexOf("function renderDetail"));
  const detailSource = APP_SCRIPT.slice(APP_SCRIPT.indexOf("function renderDetail"), APP_SCRIPT.indexOf("function recordNarrative"));
  const guideSource = APP_SCRIPT.slice(APP_SCRIPT.indexOf("function resourceGuide"), APP_SCRIPT.indexOf("function setupResourceGuide"));
  assert.match(APP_SCRIPT, /function resourceGuide\(type\)/);
  assert.match(APP_SCRIPT, /function stagePageSummary\(destination\)/);
  for (const [type, instructions] of Object.entries(RESOURCE_INSTRUCTIONS)) {
    assert.ok(APP_SCRIPT.includes(JSON.stringify(type)), `${type} is included in renderer instructions`);
    assert.ok(APP_SCRIPT.includes(instructions), `${type} renderer instruction matches the headless guide`);
  }
  assert.match(guideSource, /const instructions = RESOURCE_GUIDE_INSTRUCTIONS\[type\] \|\| definition\.description/);
  assert.match(APP_SCRIPT, /const RESOURCE_GUIDE_INSTRUCTIONS = /);
  for (const [type, summary] of Object.entries(RESOURCE_PAGE_SUMMARIES)) {
    assert.ok(APP_SCRIPT.includes(summary), `${type} has a concise Step-page summary`);
  }
  assert.match(APP_SCRIPT, /definition\.description/);
  assert.match(APP_SCRIPT, /guidance\.policyBasis/);
  assert.match(APP_SCRIPT, /guidance\.sourceResourceIds/);
  assert.match(guideSource, /<span>Instructions<\/span><p>' \+ esc\(instructions\)/);
  assert.match(APP_SCRIPT, /<span>Use<\/span>/);
  assert.match(APP_SCRIPT, /<span>Policy basis<\/span>/);
  assert.match(guideSource, /<span>Instructions<\/span>[\s\S]*<span>Use<\/span>[\s\S]*<span>Policy basis<\/span>/);
  assert.match(guideSource, /guidance\.reviewPoints/);
  assert.match(guideSource, /<span>When reviewing<\/span>/);
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
  const listSource = APP_SCRIPT.slice(APP_SCRIPT.indexOf("function renderList"), APP_SCRIPT.indexOf("function renderDetail"));
  const detailSource = APP_SCRIPT.slice(APP_SCRIPT.indexOf("function renderDetail"), APP_SCRIPT.indexOf("function recordNarrative"));
  assert.doesNotMatch(APP_SCRIPT, /function resourceWorkflowPanel\(type, entries\)/);
  assert.doesNotMatch(APP_SCRIPT, /class="stage-instructions/);
  assert.match(APP_SCRIPT, /<p class="kicker">To-do<\/p>/);
  assert.doesNotMatch(APP_SCRIPT, />Derived workflow</);
  assert.match(APP_SCRIPT, /function workflowItemHref\(item\)/);
  assert.match(APP_SCRIPT, /workflowItemStatePriority\(left\) - workflowItemStatePriority\(right\)/);
  assert.match(APP_SCRIPT, /if \(!items\.length\) return "";/);
  assert.doesNotMatch(APP_SCRIPT, /No current blockers/);
  assert.doesNotMatch(APP_SCRIPT, /The assessment will add a checklist item here/);
  assert.match(APP_SCRIPT, /ready: 30,[\s\S]*blocked: 40/);
  assert.match(APP_SCRIPT, /\["due", "open", "ready"\]\.includes\(item\.state\)\) return 20;[\s\S]*item\.state === "blocked"\) return 30/);
  assert.match(APP_SCRIPT, /#\/stage\/run\?work=/);
  assert.match(APP_SCRIPT, /data-work-source=/);
  assert.match(APP_SCRIPT, /params\.get\("work"\)/);
  assert.match(APP_SCRIPT, /card\.classList\.add\("workflow-target"\)/);
  assert.match(APP_SCRIPT, /#\/resources\/" \+ encodeURIComponent\(applicabilityType\) \+ "\?review=1"/);
  assert.match(APP_SCRIPT, /missingType[\s\S]*state\.readOnly \? "" : "\?new=1"/);
  assert.match(APP_SCRIPT, /params\.get\("review"\) === "1"/);
  assert.doesNotMatch(listSource, /workflowGuidance\(/);
  assert.match(listSource, /collectionReviewPanel\(type\)/);
  assert.match(listSource, /<th>Next action<\/th>/);
  assert.match(APP_SCRIPT, /function recordWorkflowCell\(type, entry\)/);
  assert.match(APP_SCRIPT, /No calculated action/);
  assert.match(APP_SCRIPT, /function openCollectionReviewDialog\(type\)/);
  assert.match(APP_SCRIPT, /commit-dialog event-dialog collection-review-dialog/);
  assert.match(APP_SCRIPT, /Before confirming/);
  assert.match(APP_SCRIPT, /FileGRC will ask for another review/);
  assert.match(APP_SCRIPT, /" Note: " \+ esc\(assessment\.review\.rationale\)/);
  assert.doesNotMatch(APP_SCRIPT, /name="scopeRevision"/);
  assert.match(APP_SCRIPT, /function resourceReviewCriteria\(type, collapsed = false\)/);
  assert.match(APP_SCRIPT, /<summary>Review criteria<\/summary>/);
  assert.match(detailSource, /resourceReviewCriteria\(type\)/);
  assert.match(APP_SCRIPT, /resourceReviewCriteria\(type, true\)/);
  assert.match(APP_STYLES, /\.workflow-findings>a:hover\{/);
  assert.match(APP_STYLES, /\.event-dialog label\[hidden\]\{display:none\}/);
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
  assert.match(APP_SCRIPT, /governing policies are effective, at least one linked control is implemented/);
  assert.match(APP_SCRIPT, /Create an Evidence Artifact when the artifact exists or an operating record needs fixed supporting proof/);
  assert.match(APP_SCRIPT, /Complete scheduled work and assigned follow-up here/);
  assert.doesNotMatch(APP_STYLES, /\.stage-instruction-grid/);
  assert.doesNotMatch(APP_STYLES, /\.evidence-instruction-grid/);
});

test("handles evidence-source readiness during Control implementation and creates real evidence during operation", () => {
  assert.match(APP_SCRIPT, /function renderEvidenceReadiness\(\)/);
  assert.match(APP_SCRIPT, /find\(\(stage\) => stage\.id === "controls"\)/);
  assert.match(APP_SCRIPT, /item\.id\.startsWith\("source-family-"\)/);
  assert.match(APP_SCRIPT, /item\.evidencePrompt/);
  assert.match(APP_SCRIPT, /item\.sourceKinds\?\.length/);
  assert.match(APP_SCRIPT, /item\.sourceComponentChecks \|\| item\.sourceSystemChecks \|\| \[\]/);
  assert.match(APP_SCRIPT, /add retrieval instructions/);
  assert.match(APP_SCRIPT, /item\.controlIds \|\| \[\]\)\.map\(\(id\) => formatReference\(id\)\)/);
  assert.match(APP_SCRIPT, /item\.sourceComponentIds \|\| item\.sourceSystemIds \|\| \[\]/);
  assert.match(APP_SCRIPT, /sourceType \+ '\?new=1">Add source ' \+ sourceLabel/);
  assert.match(APP_SCRIPT, /href="#\/resources\/control">Review Controls/);
  assert.equal(PROGRAM_PATH.some(({ id }) => id === "evidence"), false);
  assert.equal(PROGRAM_PATH.some(({ sections }) => sections.some(({ relatedLinks }) => relatedLinks?.length)), false);
  assert.match(APP_SCRIPT, /name: "detail", type: parts\[1\], id: parts\[2\], params: new URLSearchParams\(query\)/);
  assert.doesNotMatch(APP_SCRIPT, /function contextualListGuide\(type, stageId\)/);
  assert.match(APP_SCRIPT, /\.\.\.\(definition\.listFields \|\| \[\]\)/);
  assert.doesNotMatch(APP_SCRIPT, /type === "system" \? \["evidenceSourceKinds", "evidenceOwnerIds"\]/);
  assert.doesNotMatch(APP_SCRIPT, /type === "control" \? \["evidenceSourceIds"\]/);
  assert.match(APP_SCRIPT, /\.\.\.\(definition\.formFields \|\| \[\]\)/);
  assert.match(APP_SCRIPT, /name === "evidenceSourceKinds"/);
  assert.match(APP_SCRIPT, /class="choice-picker"/);
  assert.match(APP_SCRIPT, /Select only roles this Component performs/);
  assert.match(APP_SCRIPT, /data-show-evidence-families/);
  assert.match(APP_SCRIPT, /data-evidence-family-extra hidden/);
  assert.match(APP_SCRIPT, /item\.sourceKinds\.map\(\(kind\) => esc\(properCase\(kind\)\)\)/);
  assert.match(APP_SCRIPT, /Connect each Control to the ' \+ sourceLabel \+ ' that produce its evidence/);
  assert.match(APP_SCRIPT, /Confirm each source Component is active/);
  assert.doesNotMatch(APP_SCRIPT, /evidenceTestDrafts/);
  assert.doesNotMatch(APP_SCRIPT, /api\/evidence-test-drafts/);
  assert.doesNotMatch(APP_SCRIPT, /Create test drafts/);
  assert.match(APP_STYLES, /\.evidence-map\{/);
  assert.match(APP_STYLES, /\.evidence-map-card\{/);
  assert.match(APP_STYLES, /\.evidence-map-source\.complete\{/);
  assert.match(APP_SCRIPT, /Evidence Artifacts/);
  assert.match(APP_SCRIPT, /Create records only for real exports, reports, screenshots, signed files, or approved external references/);
});

test("renders five navigable stage pages with progressive guidance and honest progress", () => {
  const cardSource = APP_SCRIPT.slice(APP_SCRIPT.indexOf("function stagePageCard"), APP_SCRIPT.indexOf("function stageProgress"));
  const summarySource = APP_SCRIPT.slice(APP_SCRIPT.indexOf("const STAGE_PAGE_SUMMARIES"), APP_SCRIPT.indexOf("const RECORD_TEXT_FIELDS"));
  assert.match(APP_SCRIPT, /parts\.length === 2 && parts\[0\] === "stage"/);
  assert.doesNotMatch(APP_SCRIPT, /parts\.length === 3 && parts\[0\] === "stage"/);
  assert.match(APP_SCRIPT, /function renderStageOverview\(main, stageId, params = new URLSearchParams\(\)\)/);
  assert.match(APP_SCRIPT, /if \(stage\.id === "run"\) return renderObligations\(main, params\)/);
  assert.doesNotMatch(APP_SCRIPT, /function renderSectionOverview/);
  assert.match(APP_SCRIPT, /function renderStagePageIndex\(stage\)/);
  assert.match(APP_SCRIPT, /function stagePageCard\(stage, destination, index\)/);
  assert.match(APP_SCRIPT, /function stagePageItems\(stage, destination\)/);
  assert.match(APP_SCRIPT, /function stagePageItemDetail\(item\)/);
  assert.match(APP_SCRIPT, /implementation checks remain\. Open the Control to review them/);
  assert.match(APP_SCRIPT, /class="stage-page-tasks"/);
  assert.doesNotMatch(APP_SCRIPT, /workflowGuidance\(\{ stageId: stage\.id/);
  assert.match(APP_SCRIPT, /const summary = stagePageSummary\(destination\)/);
  assert.match(APP_SCRIPT, /function stageProgress\(stage\)/);
  assert.doesNotMatch(APP_SCRIPT, /function programPathProgress\(\)/);
  assert.match(APP_SCRIPT, /const progress = dashboardProgramReadiness\(state\.programReadiness\)/);
  assert.match(APP_SCRIPT, /pages\.filter\(\(destination\) => derivedStagePageState\(stage, destination\)\.complete\)\.length/);
  assert.match(APP_SCRIPT, /if \(!total\) return \{ percent: 0/);
  assert.match(APP_SCRIPT, /Step ' \+ esc\(stage\.number\) \+ ' of 5/);
  assert.doesNotMatch(APP_SCRIPT, /<h3>Step Plan<\/h3>/);
  assert.doesNotMatch(APP_SCRIPT, /stage\.steps\.map/);
  assert.equal(PROGRAM_PATH[0].summary, "Name the owners, criteria, service, Systems, and providers in scope.");
  assert.equal(PROGRAM_PATH[2].summary, "Describe each Control and connect its evidence source.");
  assert.equal(PROGRAM_PATH[3].summary, "Complete scheduled and event work. Keep dated proof.");
  assert.ok(PROGRAM_PATH.every(({ summary }) => summary.length <= 120));
  assert.deepEqual(PROGRAM_PATH[0].sections[0].types, ["person", "appointment", "team"]);
  assert.deepEqual(PROGRAM_PATH[0].sections[1].types, ["program", "framework", "requirement", "commitment"]);
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
  assert.match(summarySource, /Define the service boundary\./);
  assert.match(summarySource, /List material external providers\./);
  assert.doesNotMatch(summarySource, /Before implementing|repeatable retrieval instructions|required evidence role/);
  assert.doesNotMatch(summarySource, /manage contracts, due diligence, supplier risk, and reviews/);
  const boundary = PROGRAM_PATH[0].sections.find(({ id }) => id === "boundary");
  assert.match(boundary.description, /Start with the bounded System/);
  assert.match(boundary.description, /Keep Vendor relationships and specific Assets separate/);
  assert.match(boundary.steps.join(" "), /Create Vendors for material external provider relationships and link supplied Components when factual/);
  const issues = PROGRAM_PATH[3].sections.find(({ id }) => id === "issues");
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

test("uses the Step 4 page for compact policy-event triggers and the Work Queue", () => {
  const start = APP_SCRIPT.indexOf("function renderObligations");
  const end = APP_SCRIPT.indexOf("function obligationCard", start);
  const stepFour = APP_SCRIPT.slice(start, end);
  assert.match(APP_SCRIPT, /href="#\/stage\/run">Open board/);
  assert.match(APP_SCRIPT, /href="#\/stage\/run\?section=events"/);
  assert.doesNotMatch(stepFour, /renderStagePageIndex\(stage\)/);
  assert.doesNotMatch(stepFour, /data-stage-page-completion/);
  assert.ok(stepFour.indexOf("<h2>Policy Events</h2>") < stepFour.indexOf("<h2>Work Queue</h2>"));
  assert.match(stepFour, /renderExternalEvidenceSection\(\)/);
  assert.match(APP_SCRIPT, /function renderExternalEvidenceSection\(\)/);
  assert.match(APP_SCRIPT, /data-new-external-evidence>New Evidence Artifact/);
  assert.match(APP_SCRIPT, /data-new-external-evidence.*openEditor\("evidence"\)/s);
  assert.match(APP_SCRIPT, /field\.showWhenInactive !== true/);
  assert.match(APP_STYLES, /\.external-evidence-list\{/);
  assert.match(stepFour, /policyEventTrigger\(trigger, index, index >= eventTriggerLimit\)/);
  assert.match(stepFour, /data-expand-policy-events/);
  assert.match(stepFour, /Trigger Work/);
  assert.doesNotMatch(stepFour, /Trigger Workflow/);
  assert.match(stepFour, /Work added to the Work Queue/);
  assert.match(stepFour, /role="status" aria-live="polite"/);
  assert.match(stepFour, /data-view-added-work/);
  assert.match(stepFour, /data-dismiss-policy-event-feedback/);
  assert.match(stepFour, /role="tooltip"/);
  assert.match(stepFour, /class="policy-event-title"/);
  assert.match(stepFour, /class="guide-trigger policy-event-guide-trigger"/);
  assert.match(stepFour, /aria-label="Show ' \+ esc\(policyEventName\(trigger\.eventType\)\) \+ ' workflow steps"/);
  assert.doesNotMatch(stepFour, /class="policy-event-row" tabindex/);
  assert.match(stepFour, /Complete scheduled work and assigned follow-up here/);
  assert.match(stepFour, /Each card shows its due window, source, and next action/);
  assert.match(APP_SCRIPT, /function operationProgress\(\)/);
  assert.match(APP_SCRIPT, /Evidence collection is running and the Work Queue has no overdue or blocked work/);
  const issues = PROGRAM_PATH[3].sections.find(({ id }) => id === "issues");
  assert.deepEqual(issues.types, ["finding"]);
  assert.match(stepFour, /data-new-action-item/);
  assert.match(APP_SCRIPT, /item\.kind === "action" \? "Assigned Follow-up"/);
  assert.match(APP_SCRIPT, /item\.kind === "event" \? "Policy Event Task"/);
  assert.doesNotMatch(stepFour, /Active and Recent Workflows/);
  assert.doesNotMatch(APP_SCRIPT, /function eventRunCard/);
  assert.doesNotMatch(APP_STYLES, /\.event-run/);
  assert.doesNotMatch(stepFour, /This board schedules work linked to|Triggered Policy Event actions appear here as individual tasks/);
  assert.match(APP_SCRIPT, /data-record-finding/);
  assert.match(APP_SCRIPT, /data-add-action-item/);
  assert.match(APP_SCRIPT, /function issueSeed\(type, source\)/);
  assert.doesNotMatch(APP_SCRIPT, /href="#\/obligations"/);
  assert.match(APP_STYLES, /\.policy-event-list\{display:grid/);
  assert.match(APP_STYLES, /\.policy-event-tooltip\{position:absolute/);
  assert.match(APP_STYLES, /\.policy-event-guide:hover \.policy-event-tooltip,\.policy-event-guide:focus-within \.policy-event-tooltip/);
  assert.doesNotMatch(APP_STYLES, /\.policy-event-row:hover \.policy-event-tooltip/);
});

test("derives step-page completion from the shared workflow assessment", () => {
  assert.doesNotMatch(APP_SCRIPT, /data-stage-page-completion/);
  assert.doesNotMatch(APP_SCRIPT, /Mark incomplete/);
  assert.doesNotMatch(APP_SCRIPT, /Mark complete/);
  assert.doesNotMatch(APP_SCRIPT, /function toggleStagePageCompletion\(button\)/);
  assert.match(APP_SCRIPT, /function derivedStagePageState\(stage, destination\)/);
  assert.match(APP_SCRIPT, /state\.workflow\?\.findings/);
  assert.match(APP_SCRIPT, /Review applicability/);
  assert.match(APP_SCRIPT, /previewedPayload = \{ \.\.\.payload, basis: preview\.basis \}/);
  assert.doesNotMatch(APP_SCRIPT, /label: "Review"/);
  assert.match(APP_SCRIPT, /return \{ complete: true, label: "Ready" \}/);
  assert.match(APP_SCRIPT, /class="stage-page-card-link" href="' \+ destination\.href/);
  assert.match(APP_SCRIPT, /stage-page-card-head"[\s\S]*completionState[\s\S]*stage-page-card-foot"><span class="stage-page-open"/);
  assert.doesNotMatch(APP_SCRIPT, /class="stage-page-rollup"/);
  assert.doesNotMatch(APP_SCRIPT, /function resourceRollup\(/);
  assert.doesNotMatch(APP_SCRIPT, /function utilityRollup\(/);
  assert.match(APP_STYLES, /\.stage-page-card-head\{display:flex;align-items:center/);
  assert.match(APP_STYLES, /\.stage-page-completion-state\{flex:0 0 auto;max-width:150px/);
  assert.match(APP_STYLES, /\.stage-page-tasks\{position:relative;z-index:2/);
});

test("runs optional onboarding from committed renderer settings", () => {
  assert.doesNotThrow(() => new Function(APP_SCRIPT));
  assert.match(APP_SCRIPT, /rendererSettingsEntry\(\)\?\.record\.showOnboarding === true && !initialSetupSystem\(\)/);
  assert.match(APP_SCRIPT, /function initialSetupSystem\(\)/);
  assert.match(APP_SCRIPT, /function initialSetupBanner\(\)/);
  assert.match(APP_SCRIPT, /class="setup-draft-state"/);
  assert.match(APP_SCRIPT, /Review and confirm the initial scope/);
  assert.match(APP_SCRIPT, /Choose goal/);
  assert.match(APP_SCRIPT, /!state\.readOnly && rendererSettingsEntry/);
  assert.match(APP_SCRIPT, /onboardingDialog\.showModal\(\)/);
  assert.match(APP_SCRIPT, /onboardingDialog\.addEventListener\("cancel"/);
  assert.match(APP_SCRIPT, /function positionOnboardingShade\(target\)/);
  assert.match(APP_SCRIPT, /function onboardingTarget\(step\)/);
  assert.match(APP_SCRIPT, /window\.addEventListener\("scroll", positionCurrentOnboarding, true\)/);
  assert.match(APP_SCRIPT, /persistOnboardingPreference\(false\)/);
  assert.match(APP_SCRIPT, /localFetch\("\/api\/setup"/);
  assert.equal((APP_SCRIPT.match(/fetchJson\("\/api\/state"\)/g) || []).length, 1);
  const saveOnboardingSource = APP_SCRIPT.match(/async function saveOnboarding[\s\S]*?\n}\n\nfunction showOnboardingError/)?.[0] || "";
  assert.doesNotMatch(saveOnboardingSource, /fetchJson\("\/api\/state"\)/);
  assert.match(saveOnboardingSource, /if \(onboardingBusy\) return/);
  assert.match(saveOnboardingSource, /applyMutationState\(result\)/);
  assert.match(APP_SCRIPT, /localFetch\("\/api\/git\/sync-status"\)/);
  assert.match(APP_SCRIPT, /function scheduleRepositorySyncPoll/);
  assert.match(APP_SCRIPT, /function repositorySyncAlert/);
  assert.match(APP_SCRIPT, /Saved locally, but Git sync failed/);
  assert.match(APP_SCRIPT, /Git sync and workspace checks can take a moment/);
  assert.match(APP_SCRIPT, /function retryOnboardingSync/);
  assert.match(APP_SCRIPT, /if \(dialog\.dataset\.mutationBusy === "true"\) return/);
  assert.match(APP_SCRIPT, /setMutationBusy\(dialog, true, "Saving…"/);
  assert.match(APP_SCRIPT, /Files are the program/);
  assert.match(APP_SCRIPT, /Choose a goal/);
  assert.match(APP_SCRIPT, /function onboardingSteps\(\)[\s\S]*title: "Files are the program"[\s\S]*title: "Follow the audit chain"[\s\S]*title: "Run work and record changes"[\s\S]*title: "Choose a goal"/);
  assert.match(APP_SCRIPT, /target: "\.repo-chip",[\s\S]*title: "Files are the program"/);
  assert.match(APP_SCRIPT, /SOC 2 is an independent CPA report on controls tied to selected Trust Services Criteria/);
  assert.match(APP_SCRIPT, /Array\.isArray\(step\.body\)[\s\S]*<p class="onboarding-body">/);
  assert.match(APP_SCRIPT, /title: "Type 1"/);
  assert.match(APP_SCRIPT, /Optional before Type 2/);
  assert.match(APP_SCRIPT, /title: "Type 2"/);
  assert.match(APP_SCRIPT, /Evidence and populations must cover it/);
  assert.match(APP_SCRIPT, /The CPA tests and reports/);
  assert.match(APP_SCRIPT, /onboarding-after-sections/);
  assert.match(APP_SCRIPT, /class="onboarding-sections"/);
  assert.match(APP_SCRIPT, /Follow the audit chain/);
  assert.match(APP_SCRIPT, /Run work and record changes/);
  assert.match(APP_SCRIPT, /Policy Events add tasks when a listed change occurs/);
  assert.match(APP_SCRIPT, /Source files live under data\//);
  assert.match(APP_SCRIPT, /browser saves validate, commit, and push/);
  assert.match(APP_SCRIPT, /Record status tracks approval/);
  assert.match(APP_SCRIPT, /Open a task to see its owner, due date, and proof/);
  assert.doesNotMatch(APP_SCRIPT, /no fixed (?:deadline|cutoff|overdue)/i);
  assert.match(APP_SCRIPT, /data-onboarding="draft">Save as planned/);
  assert.doesNotMatch(APP_SCRIPT, /name="independentApproverName" maxlength/);
  assert.doesNotMatch(APP_SCRIPT, /name="independentApproverEmail" type="email" maxlength/);
  assert.match(APP_SCRIPT, /programGoal: onboardingDraft\.programGoal/);
  assert.doesNotMatch(APP_SCRIPT, /auditId: onboardingDraft\.auditId/);
  assert.match(APP_SCRIPT, /Create the first System and choose the program goal/);
  assert.match(APP_SCRIPT, /history\.replaceState\(null, "", draft \? "#\/" : "#\/stage\/scope"\)/);
  assert.match(APP_SCRIPT, /Planned saves a draft/);
  assert.match(APP_SCRIPT, /Confirm scope activates it/);
  assert.match(APP_SCRIPT, /Both add it to the Program/);
  assert.match(APP_SCRIPT, /data-onboarding="next">Confirm scope/);
  assert.match(APP_SCRIPT, /requestOnboarding\(\{ setupOnly: Boolean\(initialSetupSystem\(\)\) \}\)/);
  assert.match(APP_SCRIPT, /onboardingStep = setupOnly \? onboardingSteps\(\)\.length - 1 : 0/);
  assert.match(APP_SCRIPT, /onboardingSetupOnly \? "Close" : "Skip onboarding"/);
  assert.match(APP_SCRIPT, /onboardingSetupOnly \? closeOnboarding : cancelOnboarding/);
  assert.match(APP_SCRIPT, /Completing onboarding will save its related Workspace, Program, System, Component, and renderer changes in one local commit, then push it in the background/);
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
  assert.match(APP_SCRIPT, /function conciseResourceDescription\(definition\)/);
  assert.match(APP_SCRIPT, /conciseResourceDescription\(definition\)[\s\S]*Add the facts known now/);
  assert.match(APP_SCRIPT, /Pushed " \+ result\.shortCommit/);
  assert.match(APP_SCRIPT, /Retry sync/);
  assert.doesNotMatch(APP_SCRIPT, /class="repository-override"/);
  assert.match(APP_SCRIPT, /class="panel repository-state-banner"/);
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
  assert.match(APP_SCRIPT, /const sections = \["proposed", "upcoming", "blocked", "due", "overdue"\]\.map/);
  assert.doesNotMatch(APP_SCRIPT, /class="metrics obligation-metrics"/);
  assert.match(APP_SCRIPT, /state\.obligations\.counts\.overdue/);
  assert.match(APP_SCRIPT, /state\.obligations\.counts\.blocked/);
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
  assert.match(APP_SCRIPT, /const soleEntry = audits\.length === 1 \? audits\[0\] : null/);
  assert.match(APP_SCRIPT, /requestedEntry \|\| openEntry \|\| soleEntry/);
  assert.doesNotMatch(APP_SCRIPT, /function renderProgramReadiness\(/);
  assert.match(APP_SCRIPT, /function renderAuditPreparation\(preparation\)/);
  assert.match(APP_SCRIPT, /Review both evidence paths/);
  assert.match(APP_SCRIPT, /filegrc Evidence/);
  assert.match(APP_SCRIPT, /Evidence Artifacts/);
  assert.match(APP_SCRIPT, /localFetch\("\/api\/audit-preparation"/);
  assert.match(APP_SCRIPT, /localFetch\("\/api\/evidence-packet"/);
  assert.match(APP_SCRIPT, /let latestPacketResult = null/);
  assert.match(APP_SCRIPT, /root\.querySelector\("#packet-results"\)/);
  assert.match(APP_SCRIPT, /Review fieldwork readiness, then build the evidence packet for the agreed audit date or period/);
  assert.match(APP_SCRIPT, /required for delivery/i);
  assert.match(APP_SCRIPT, /class="packet-preflight"/);
  assert.match(APP_SCRIPT, /Generate draft/);
  assert.match(APP_STYLES, /\.obligation-board\{display:grid/);
  assert.match(APP_STYLES, /\.badge\.status-overdue,\.badge\.status-blocked\{/);
  assert.match(APP_STYLES, /\.packet-builder form\{display:grid/);
  assert.match(APP_STYLES, /\.packet-preflight\{display:grid/);
});

test("keeps the overview focused on readiness, current work, and the audit", () => {
  assert.match(APP_SCRIPT, /function readinessOverview\(\)/);
  assert.match(APP_SCRIPT, /class="hero overview-hero"/);
  assert.match(APP_SCRIPT, /class="readiness-progress-summary"/);
  assert.match(APP_SCRIPT, /<span>Program readiness<\/span><strong>' \+ progress\.percent \+ '%<\/strong>/);
  assert.match(APP_SCRIPT, /progress\.complete \+ " of " \+ progress\.total \+ " readiness items complete"/);
  assert.match(APP_SCRIPT, /class="badge ' \+ esc\(progress\.tone\) \+ '">' \+ esc\(progress\.status\) \+ '<\/b>/);
  assert.match(APP_SCRIPT, /pluralize\(noun, total\) \+ \(complete === 1 \? " is" : " are"\) \+ " ready\."/);
  assert.match(APP_SCRIPT, /function obligationBoardItems\(items, status\)/);
  assert.match(APP_SCRIPT, /function distinctObligationPreviews\(items, limit\)/);
  assert.match(APP_SCRIPT, /const previewObligations = distinctObligationPreviews\(openObligations, 3\)/);
  assert.doesNotMatch(APP_SCRIPT, /obligationPreview\(openObligations\.slice\(0, 3\)\)/);
  assert.match(APP_SCRIPT, /eventReminderPreview\(orderedPolicyEventTriggers\(state\.obligations\.triggers\)\.slice\(0, 4\)\)/);
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
  assert.match(APP_SCRIPT, /const listStage = readinessStageForType\(type\)/);
  assert.match(APP_SCRIPT, /listStage\?\.title \|\| groupTitle/);
  assert.match(APP_SCRIPT, /programStage\("run", "#\/stage\/run"\)/);
  assert.match(APP_SCRIPT, /function nextProgramStageHref\(\)/);
  assert.match(APP_SCRIPT, /READINESS_STAGES\.find\(\(stage\) => \{/);
  assert.match(APP_SCRIPT, /progress\.complete < progress\.total/);
  assert.doesNotMatch(APP_SCRIPT, /function readinessItemHref\(item\)/);
  assert.match(APP_SCRIPT, /programStage\("scope", "#\/stage\/scope"\)/);
  assert.match(APP_SCRIPT, /programStage\("policies", "#\/stage\/policies"\)/);
  assert.match(APP_SCRIPT, /programStage\("controls", "#\/stage\/controls"\)/);
  assert.doesNotMatch(APP_SCRIPT, /programStage\("evidence"/);
  assert.match(APP_SCRIPT, /programStage\("run", "#\/stage\/run"\)/);
  assert.match(APP_SCRIPT, /programStage\("audit", "#\/stage\/audit"\)/);
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
