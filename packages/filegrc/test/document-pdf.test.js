import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCli } from "../src/cli.js";
import { hasMarkdownContent, openPlaceholderCount, substantiveMarkdown } from "../src/content-readiness.js";
import { exportDocumentPdf } from "../src/document-pdf.js";
import { renderMarkdown } from "../src/markdown.js";
import { calculateRevision } from "../src/revisions.js";
import { serveWorkspace } from "../src/server.js";
import { captureCli, commitWorkspaceFiles, initializeGitWorkspace, makeWorkspace, writeJson } from "./helpers.js";

const form = "Printed name: {{pdf-field:customer-name}}\nSignature: {{pdf-blank}}\n";

test("explicit PDF blanks render without becoming approval placeholders", () => {
  assert.equal(openPlaceholderCount(form), 0);
  assert.equal(hasMarkdownContent(form), false);
  assert.equal(hasMarkdownContent(form + "Short policy rule."), true);
  assert.equal(openPlaceholderCount(form + "TODO {{company_name}}"), 2);
  assert.equal(substantiveMarkdown(form.repeat(20)), false);
  assert.match(renderMarkdown(form), /aria-label="Fillable in the PDF"/);
  assert.match(renderMarkdown(form), /aria-label="Blank line"/);
  assert.match(renderMarkdown("Name: _____"), /_____/);
  const fenced = `\`\`\`\n${form}\`\`\``;
  assert.match(renderMarkdown(fenced), /\{\{pdf-field:customer-name\}\}/);
  assert.equal(openPlaceholderCount(fenced), 2);
  assert.match(renderMarkdown("| Terms \\| Conditions | Amount |\n| --- | --- |\n| A | 10 |"),
    /<th>Terms \| Conditions<\/th><th>Amount<\/th>/);
});

test("governed PDF export keeps committed approval, checks live revision, and shares bytes with HTTP", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-document-pdf-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeWorkspace(root);
  await mkdir(join(root, "data", "documents"));
  const id = "document-contract-template";
  const relative = `documents/${id}.md`;
  const sourcePath = join(root, "data", relative);
  const source = "This agreement template describes the responsibilities that the parties will agree in writing.\n\n" + form;
  const recordRevision = calculateRevision("content", source);
  await writeFile(sourcePath, source);
  const recordPath = join(root, "data", "documents", `${id}.json`);
  const record = {
    id, type: "document", title: "Service Agreement Template", documentKind: "contract-template",
    template: true, status: "active", ownerIds: ["person-owner"], approverIds: ["person-approver"],
    approvedOn: "2025-01-01", effectiveOn: "2025-01-02",
    approvedContentRevisions: { [relative]: recordRevision }
  };
  await writeJson(recordPath, record);
  await initializeGitWorkspace(root);
  const git = (...args) => execFileSync("git", args, { encoding: "utf8", cwd: root }).trim();
  git("switch", "--quiet", "-c", "document-history");
  await writeFile(join(root, "notes.md"), "Historical snapshot on another branch.\n");
  await commitWorkspaceFiles(root, "Record a document snapshot");
  const commit = git("rev-parse", "HEAD");
  git("switch", "--quiet", "main");
  git("tag", "-a", "document-snapshot", "-m", "Document snapshot", commit);
  const tag = git("rev-parse", "document-snapshot");
  await assert.rejects(exportDocumentPdf(root, "document", id, { commit: tag }), /Use the commit ID itself/);
  git("switch", "--quiet", "-c", "document-symlink");
  await rm(sourcePath);
  await symlink("alternate.md", sourcePath);
  await commitWorkspaceFiles(root, "Record a non-regular companion");
  await assert.rejects(exportDocumentPdf(root, "document", id, { commit: git("rev-parse", "HEAD") }), /no file in this revision/);
  git("switch", "--quiet", "main");
  const historicalArgs = ["export-pdf", "document", id, "--root", root, "--revision", commit, "--json"];
  const result = JSON.parse((await captureCli(runCli, historicalArgs)).stdout);
  assert.equal(result.status, "Approved content");
  assert.equal(result.commit, commit);
  const bytes = await readFile(result.path);
  assert.match(bytes.toString("latin1"), /^%PDF-1.7/);
  assert.match(bytes.toString("latin1"), /\/FT \/Tx \/T \(customer-name\)/);
  assert.doesNotMatch(bytes.toString("latin1"), /\/FT \/Sig/);

  const running = await serveWorkspace(root, { port: 0, readOnly: true });
  context.after(() => new Promise((resolve) => running.server.close(resolve)));
  const resourceUrl = `${running.url}/api/resource/document/${id}`;
  const detail = await (await fetch(resourceUrl)).json();
  assert.equal(detail.pdfExport, true);
  const live = `${resourceUrl}/pdf?` + new URLSearchParams({
    slot: "content", recordRevision: detail.revision, contentRevision: detail.content.content.revision
  });
  assert.equal((await fetch(live)).status, 200);
  assert.equal((await fetch(live, { headers: { "sec-fetch-site": "cross-site" } })).status, 403);
  const workingArgs = ["export-pdf", "document", id, "--root", root, "--json"];
  const working = JSON.parse((await captureCli(runCli, workingArgs)).stdout);
  const approverPath = join(root, "data", "people", "person-approver.json");
  const approver = JSON.parse(await readFile(approverPath, "utf8"));
  await writeJson(approverPath, { ...approver, startDate: "2025-01-02" });
  const noLongerApproved = JSON.parse((await captureCli(runCli, workingArgs)).stdout);
  assert.equal(noLongerApproved.status, "Unapproved content");
  assert.notEqual(noLongerApproved.path, working.path);
  await writeJson(approverPath, approver);
  await writeJson(recordPath, { ...record, approvedOn: "9999-01-01" });
  assert.equal((await exportDocumentPdf(root, "document", id)).status, "Unapproved content");
  await writeJson(recordPath, { ...record, approverIds: record.ownerIds });
  assert.equal((await exportDocumentPdf(root, "document", id)).status, "Unapproved content");
  const incomplete = source + "\nTODO Confirm the payment schedule.\n";
  await writeFile(sourcePath, incomplete);
  await writeJson(recordPath, { ...record, approvedContentRevisions: { [relative]: calculateRevision("content", incomplete) } });
  assert.equal((await exportDocumentPdf(root, "document", id)).status, "Unapproved content");
  await writeFile(sourcePath, form);
  await writeJson(recordPath, { ...record, approvedContentRevisions: { [relative]: calculateRevision("content", form) } });
  assert.equal((await exportDocumentPdf(root, "document", id)).status, "Unapproved content");
  await writeJson(recordPath, record);
  await writeFile(sourcePath, source + "\nThis line is new.\n");
  assert.equal((await fetch(live)).status, 409);
  assert.equal((await exportDocumentPdf(root, "document", id)).status, "Unapproved content");
  const committed = await fetch(`${resourceUrl}/pdf?commit=${commit}`);
  assert.equal(committed.headers.get("content-type"), "application/pdf");
  assert.deepEqual(Buffer.from(await committed.arrayBuffer()), bytes);

  await writeFile(result.path, "Recipient copy");
  await assert.rejects(captureCli(runCli, historicalArgs), /A different PDF already exists/);
  assert.equal(await readFile(result.path, "utf8"), "Recipient copy");
});

test("historical training exports use the selected model's approval fields", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-training-pdf-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeWorkspace(root);
  const workspacePath = join(root, "data", "workspace.json");
  const workspace = JSON.parse(await readFile(workspacePath, "utf8"));
  await writeJson(workspacePath, { ...workspace, dataModelVersion: "5" });
  await mkdir(join(root, "data", "training"));
  const source = "# Training\n\nRead the training before running this exercise with your assigned reviewer.\n";
  await writeFile(join(root, "data", "training", "training-exercise.md"), source);
  await writeJson(join(root, "data", "training", "training-exercise.json"), {
    id: "training-exercise", type: "training", title: "Training", status: "active",
    ownerIds: ["person-owner"], approvedByIds: ["person-approver"], approvedOn: "2025-01-01",
    effectiveContentRevisions: { "training/training-exercise.md": calculateRevision("content", source) }
  });
  await initializeGitWorkspace(root);
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", cwd: root }).trim();
  await writeJson(workspacePath, { ...workspace, dataModelVersion: "13" });
  const exported = await exportDocumentPdf(root, "training", "training-exercise", { commit });
  assert.equal(exported.commit, commit);
  assert.equal(exported.status, "Approved content");
});
