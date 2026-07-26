import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  createObligationEvent,
  createResource,
  createResources,
  getGitSummary,
  loadWorkspace,
  prepareEvidencePacket,
  serveWorkspace,
  updateResource,
  writeEvidencePacket
} from "../src/index.js";
import { makeWorkspace } from "./helpers.js";

const execute = promisify(execFile);

test("builds an auditor packet from dated records, obligation coverage, policies, and evidence", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-evidence-packet-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await createResource(root, {
    schemaVersion: 1,
    id: "policy-risk-governance",
    type: "policy",
    title: "Risk governance policy",
    status: "active",
    contentPath: "content/policy-risk-governance.md",
    ownerIds: ["person-owner"],
    approverIds: ["person-owner"],
    effectiveOn: "2026-01-01"
  }, {
    content: {
      "content/policy-risk-governance.md": "# Risk governance policy\n\nMeet quarterly and retain evidence."
    }
  });
  await createResource(root, {
    schemaVersion: 1,
    id: "obligation-quarterly-risk-meeting",
    type: "obligation",
    title: "Quarterly risk meeting",
    status: "active",
    activityType: "meeting",
    recurrence: {
      mode: "calendar",
      unit: "month",
      interval: 3,
      anchorDate: "2026-01-01"
    },
    ownerIds: ["person-owner"],
    policyIds: ["policy-risk-governance"],
    startsOn: "2026-01-01"
  });
  await mkdir(join(root, "data", "content"), { recursive: true });
  await writeFile(join(root, "data", "content", "evidence-q1-risk-review.md"), "# Q1 risk review\n\nCompleted and reviewed.\n", "utf8");
  await createResources(root, [
    {
      schemaVersion: 1,
      id: "action-item-q1-risk-review",
      type: "action-item",
      title: "Record Q1 risk review",
      status: "done",
      assigneeIds: ["person-owner"],
      sourceResourceId: "obligation-quarterly-risk-meeting",
      obligationId: "obligation-quarterly-risk-meeting",
      completedOn: "2026-03-20",
      evidenceIds: ["evidence-q1-risk-review"]
    },
    {
      schemaVersion: 1,
      id: "evidence-q1-risk-review",
      type: "evidence",
      title: "Q1 risk review evidence",
      status: "verified",
      evidenceKind: "rendered-record",
      source: "Risk review action",
      collectedOn: "2026-03-20",
      classification: "Internal",
      contentPath: "content/evidence-q1-risk-review.md",
      sourceResourceIds: ["action-item-q1-risk-review"]
    }
  ]);
  const obligation = (await loadWorkspace(root)).resources.find(({ id }) => id === "obligation-quarterly-risk-meeting");
  await updateResource(root, "obligation", "obligation-quarterly-risk-meeting", {
    ...obligation,
    completionResourceIds: ["action-item-q1-risk-review"]
  });

  await git(root, ["init"]);
  await git(root, ["config", "user.name", "Test User"]);
  await git(root, ["config", "user.email", "test@example.test"]);
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "Create Q1 compliance records"]);
  const sourceCommit = getGitSummary(root).commit;
  const evidence = (await loadWorkspace(root)).resources.find(({ id }) => id === "evidence-q1-risk-review");
  await updateResource(root, "evidence", "evidence-q1-risk-review", {
    ...evidence,
    sourceCommit
  });
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "Bind Q1 evidence revision"]);

  const packet = await prepareEvidencePacket(root, {
    start: "2026-01-01",
    end: "2026-03-31",
    generatedAt: "2026-04-01T12:00:00Z"
  });
  assert.equal(packet.revision.clean, true);
  assert.match(packet.revision.dataDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(packet.summary.obligationOccurrences, 1);
  assert.equal(packet.obligations[0].status, "complete");
  assert.equal(packet.evidence[0].id, "evidence-q1-risk-review");
  assert.equal(packet.policies.some(({ id }) => id === "policy-risk-governance"), true);
  assert.equal(packet.datedRecords.some(({ id }) => id === "action-item-q1-risk-review"), true);
  assert.equal(packet.records.find(({ id }) => id === "action-item-q1-risk-review").history[0].author, "Test User");
  assert.deepEqual(packet.gaps, []);

  await assert.rejects(
    writeEvidencePacket(root, packet, { output: "data/packet" }),
    /under \.filegrc/
  );
  const written = await writeEvidencePacket(root, packet, { output: ".filegrc/test-packet" });
  const packetIndex = await readFile(join(written.output, "index.html"), "utf8");
  assert.match(packetIndex, /Quarterly risk meeting/);
  assert.match(packetIndex, /Create Q1 compliance records/);
  assert.match(await readFile(join(written.output, "manifest.json"), "utf8"), /evidence-q1-risk-review/);
  await access(join(written.output, "records", "action-item", "action-item-q1-risk-review.json"));
  await access(join(written.output, "content", "policy-risk-governance.md"));
  await assert.rejects(
    writeEvidencePacket(root, packet, { output: ".filegrc/test-packet" }),
    /already exists/
  );
  await access(join(written.output, "index.html"));
  const unsafePacket = structuredClone(packet);
  unsafePacket.records[0].type = "../../../outside";
  await assert.rejects(
    writeEvidencePacket(root, unsafePacket, { output: ".filegrc/unsafe-packet" }),
    /stay inside the packet directory/
  );
  await assert.rejects(access(join(root, ".filegrc", "unsafe-packet")), /ENOENT/);

  const actionPath = join(root, "data", "action-items", "action-item-q1-risk-review.json");
  const actionSource = await readFile(actionPath, "utf8");
  try {
    await writeFile(actionPath, actionSource.replace("Record Q1 risk review", "Changed after packet preparation"), "utf8");
    await assert.rejects(
      writeEvidencePacket(root, packet, { output: ".filegrc/stale-packet" }),
      /source changed/
    );
    await assert.rejects(access(join(root, ".filegrc", "stale-packet")), /ENOENT/);
  } finally {
    await writeFile(actionPath, actionSource, "utf8");
  }

  const cli = await execute(process.execPath, [
    fileURLToPath(new URL("../bin/filegrc.js", import.meta.url)),
    "evidence-packet",
    "--root",
    root,
    "--start",
    "2026-01-01",
    "--end",
    "2026-03-31",
    "--preview",
    "--json"
  ]);
  const cliResult = JSON.parse(cli.stdout);
  assert.equal(cliResult.output, null);
  assert.equal(cliResult.packet.summary.datedRecords, packet.summary.datedRecords);

  const running = await serveWorkspace(root, { port: 0 });
  try {
    const previewResponse = await fetch(`${running.url}/api/evidence-packet?start=2026-01-01&end=2026-03-31`);
    assert.equal(previewResponse.status, 200);
    assert.equal((await previewResponse.json()).summary.datedRecords, packet.summary.datedRecords);
    const response = await fetch(`${running.url}/api/evidence-packet`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ start: "2026-01-01", end: "2026-03-31" })
    });
    assert.equal(response.status, 201);
    const apiResult = await response.json();
    assert.equal(apiResult.packet.summary.datedRecords, packet.summary.datedRecords);
    assert.match(apiResult.output, /^\.filegrc\/evidence-packets\//);
    const indexResponse = await fetch(`${running.url}${apiResult.packetUrl}`);
    const indexSource = await indexResponse.text();
    assert.equal(indexResponse.status, 200, indexSource);
    assert.match(indexSource, /Quarterly risk meeting/);
    const generatedRoot = join(root, apiResult.output);
    await mkdir(join(generatedRoot, "attachments"), { recursive: true });
    await writeFile(join(generatedRoot, "attachments", "index.html"), "<script>throw new Error('unsafe')</script>", "utf8");
    const attachmentResponse = await fetch(`${running.url}${apiResult.packetUrl.replace(/index\.html$/, "attachments/index.html")}`);
    assert.equal(attachmentResponse.status, 200);
    assert.equal(attachmentResponse.headers.get("content-type"), "application/octet-stream");
    await symlink(join(root, "data", "workspace.json"), join(generatedRoot, "attachments", "workspace-link.json"));
    const symlinkResponse = await fetch(`${running.url}${apiResult.packetUrl.replace(/index\.html$/, "attachments/workspace-link.json")}`);
    assert.equal(symlinkResponse.status, 400);
    const traversalResponse = await fetch(`${running.url}${apiResult.packetUrl.replace(/index\.html$/, "%2e%2e%2fmanifest.json")}`);
    assert.notEqual(traversalResponse.status, 200);
    const customResponse = await fetch(`${running.url}/api/evidence-packet`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        start: "2026-01-01",
        end: "2026-03-31",
        output: ".filegrc/custom-packet"
      })
    });
    assert.equal(customResponse.status, 201);
    assert.equal((await customResponse.json()).packetUrl, null);
  } finally {
    await new Promise((resolve) => running.server.close(resolve));
  }
});

test("limits event workflow coverage to runs that intersect the audit period", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-evidence-event-period-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  await createResource(root, {
    schemaVersion: 1,
    id: "obligation-material-change-review",
    type: "obligation",
    title: "Review material change",
    status: "active",
    activityType: "change-review",
    recurrence: { mode: "event", eventType: "material-change" },
    window: { startOffsetDays: 0, endOffsetDays: 2 },
    ownerIds: ["person-owner"]
  });
  const completedRun = await createObligationEvent(root, {
    eventType: "material-change",
    occurredOn: "2026-01-01",
    title: "Completed during period"
  });
  await createObligationEvent(root, {
    eventType: "material-change",
    occurredOn: "2025-12-01",
    title: "Outside period"
  });
  const evidencedRun = await createObligationEvent(root, {
    eventType: "material-change",
    occurredOn: "2025-12-15",
    title: "Evidence during period"
  });
  const startedRun = await createObligationEvent(root, {
    eventType: "material-change",
    occurredOn: "2026-02-10",
    title: "Started during period"
  });
  const canceledRun = await createObligationEvent(root, {
    eventType: "material-change",
    occurredOn: "2026-02-12",
    title: "Canceled during period"
  });
  const canceledEvent = (await loadWorkspace(root)).resources.find(({ id }) => id === canceledRun.event.id);
  await updateResource(root, "obligation-event", canceledEvent.id, {
    ...canceledEvent,
    status: "canceled"
  });
  const completedAction = (await loadWorkspace(root)).resources.find(({ id }) => id === completedRun.actions[0].id);
  await updateResource(root, "action-item", completedAction.id, {
    ...completedAction,
    status: "done",
    completedOn: "2026-02-02"
  });
  const canceledAction = (await loadWorkspace(root)).resources.find(({ id }) => id === startedRun.actions[0].id);
  await updateResource(root, "action-item", canceledAction.id, {
    ...canceledAction,
    status: "canceled"
  });
  await createResource(root, {
    schemaVersion: 1,
    id: "evidence-material-change",
    type: "evidence",
    title: "Material change evidence",
    status: "verified",
    evidenceKind: "system-export",
    source: "Change system",
    collectedOn: "2026-02-05",
    classification: "Internal",
    externalReference: { system: "Change system", reference: "change-123" },
    sourceResourceIds: [evidencedRun.actions[0].id]
  });

  const packet = await prepareEvidencePacket(root, {
    start: "2026-02-01",
    end: "2026-02-28"
  });
  assert.deepEqual(packet.eventRuns.map(({ title }) => title).sort(), [
    "Canceled during period",
    "Completed during period",
    "Evidence during period",
    "Started during period"
  ]);
  assert.equal(packet.records.some(({ title }) => title === "Outside period"), false);
  assert.equal(packet.records.some(({ title }) => title === "Evidence during period"), true);
  assert.equal(packet.datedRecords.some(({ id }) => id === completedAction.id), true);
  assert.equal(packet.gaps.some(({ code }) => code === "canceled-event-action"), true);
  assert.equal(packet.gaps.some(({ resourceId }) => resourceId === canceledRun.actions[0].id), false);
});

function git(cwd, args) {
  return execute("git", args, { cwd });
}
