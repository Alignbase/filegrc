import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { promisify } from "node:util";
import {
  applyApplicabilityReview,
  planApplicabilityReview,
  scaffoldApplicabilityReview,
  serveWorkspace
} from "../src/index.js";
import { runCli } from "../src/cli.js";
import { collectTimings } from "../src/timing.js";
import { makeWorkspace, writeJson } from "./helpers.js";

const execute = promisify(execFile);
const DECISION_COUNT = 42;

test("applicability batch resolves repository revision once and assesses workflow a fixed number of times", async (context) => {
  const root = await applicabilityWorkspace(context, "filegrc-applicability-instrumented-");
  const scaffold = await scaffoldApplicabilityReview(root, { type: "requirement" });
  const payload = { ...decisionsPayload(), basis: scaffold.basis };
  const payloadPath = join(root, "decisions.json");
  await writeFile(payloadPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  const preview = await planApplicabilityReview(root, payload);

  const originalLog = console.log;
  console.log = () => {};
  let measured;
  try {
    measured = await collectTimings(() => runCli([
      "review-applicability",
      payloadPath,
      "--yes",
      "--json",
      "--root",
      root
    ]));
  } finally {
    console.log = originalLog;
  }

  assert.equal(measured.result.reviewedIds.length, DECISION_COUNT);
  assert.deepEqual(measured.result.changes, preview.changes);
  assert.equal(measured.timings["git-discovery"], undefined);
  assert.equal(measured.timings["repository-revision"].count, 1);
  assert.equal(measured.timings["workflow-assessment"].count, 2);
  assert.equal(measured.timings.validation.count, 2);
  const revisions = new Set(measured.result.changes.update.map(({ applicabilityReview }) => (
    applicabilityReview.scopeRevision
  )));
  assert.equal(revisions.size, 1);
  assert.match([...revisions][0], /^[a-f0-9]{40}$/);
});

test("previews 42 applicability decisions within the batch performance budget", async (context) => {
  const root = await applicabilityWorkspace(context, "filegrc-applicability-performance-");
  const started = performance.now();
  const { result, timings } = await collectTimings(() => planApplicabilityReview(root, decisionsPayload()));
  const elapsed = performance.now() - started;

  assert.equal(result.reviewedIds.length, DECISION_COUNT);
  assert.equal(Object.keys(result.changes.expectedRevisions).length, DECISION_COUNT);
  assert.equal(timings["git-discovery"], undefined);
  assert.equal(timings["repository-revision"].count, 1);
  assert.equal(timings["workflow-assessment"], undefined);
  assert.ok(elapsed < 2_000, `expected a 42-decision preview under 2 seconds, received ${elapsed.toFixed(1)} ms`);
});

test("browser preview and apply use the same 42-decision batch", async (context) => {
  const root = await applicabilityWorkspace(context, "filegrc-applicability-browser-");
  const payload = decisionsPayload();
  const running = await serveWorkspace(root, {
    port: 0,
    allowNonAuthoritativeWrites: true
  });
  context.after(() => new Promise((resolve) => running.server.close(resolve)));

  const previewResponse = await fetch(`${running.url}/api/applicability-review/preview`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  assert.equal(preview.reviewedIds.length, DECISION_COUNT);

  const applyResponse = await fetch(`${running.url}/api/applicability-review`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      prefer: "respond-async"
    },
    body: JSON.stringify({ ...payload, basis: preview.basis, confirmed: true })
  });
  assert.equal(applyResponse.status, 201);
  const applied = await applyResponse.json();
  assert.equal(applied.reviewedIds.length, DECISION_COUNT);
  assert.deepEqual(applied.changes, preview.changes);
  assert.equal(applied.stateRefresh, true);

  const first = JSON.parse(await readFile(join(
    root,
    "data",
    "requirements",
    "requirement-01.json"
  ), "utf8"));
  assert.equal(first.applicability, "applicable");
  assert.match(first.applicabilityReview.scopeRevision, /^[a-f0-9]{40}$/);
});

test("rejects apply when structured workspace scope changes after preview", async (context) => {
  const root = await applicabilityWorkspace(context, "filegrc-applicability-stale-scope-");
  const payload = decisionsPayload();
  const preview = await planApplicabilityReview(root, payload);
  const frameworkPath = join(root, "data", "frameworks", "framework-test.json");
  const framework = JSON.parse(await readFile(frameworkPath, "utf8"));
  await writeJson(frameworkPath, { ...framework, title: "Changed framework scope" });
  await execute("git", ["add", "data/frameworks/framework-test.json"], { cwd: root });
  await execute("git", ["commit", "-m", "Change framework scope"], { cwd: root });

  await assert.rejects(
    applyApplicabilityReview(root, {
      ...payload,
      basis: preview.basis,
      confirmed: true
    }),
    /scope changed after this applicability review was prepared/
  );
  const first = JSON.parse(await readFile(join(
    root,
    "data",
    "requirements",
    "requirement-01.json"
  ), "utf8"));
  assert.equal(first.applicability, "undetermined");
});

test("binds dirty structured scope to an exact uncommitted fingerprint", async (context) => {
  const root = await applicabilityWorkspace(context, "filegrc-applicability-dirty-scope-");
  const frameworkPath = join(root, "data", "frameworks", "framework-test.json");
  const framework = JSON.parse(await readFile(frameworkPath, "utf8"));
  await writeJson(frameworkPath, { ...framework, title: "Locally reviewed framework" });
  const payload = decisionsPayload();
  const preview = await planApplicabilityReview(root, payload);
  assert.match(preview.basis.scopeRevision, /^uncommitted:[a-f0-9]{64}$/);

  const applied = await applyApplicabilityReview(root, {
    ...payload,
    basis: preview.basis,
    confirmed: true
  });
  assert.equal(
    applied.changes.update[0].applicabilityReview.scopeRevision,
    preview.basis.scopeRevision
  );
});

test("rejects a dirty applicability change made after preview", async (context) => {
  const root = await applicabilityWorkspace(context, "filegrc-applicability-dirty-stale-");
  const frameworkPath = join(root, "data", "frameworks", "framework-test.json");
  const framework = JSON.parse(await readFile(frameworkPath, "utf8"));
  await writeJson(frameworkPath, { ...framework, title: "Locally reviewed framework" });
  const payload = decisionsPayload();
  const preview = await planApplicabilityReview(root, payload);
  const requirementPath = join(root, "data", "requirements", "requirement-42.json");
  const requirement = JSON.parse(await readFile(requirementPath, "utf8"));
  await writeJson(requirementPath, {
    ...requirement,
    applicability: "applicable",
    applicabilityRationale: "Management reviewed this requirement separately.",
    applicabilityReview: {
      decision: "applicable",
      rationale: "Management reviewed this requirement separately.",
      reviewedByIds: ["person-owner"],
      reviewedOn: "2026-08-18",
      scopeRevision: preview.basis.scopeRevision
    }
  });

  await assert.rejects(
    applyApplicabilityReview(root, {
      ...payload,
      basis: preview.basis,
      confirmed: true
    }),
    /scope changed after this applicability review was prepared/
  );
});

async function applicabilityWorkspace(context, prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeWorkspace(root);
  const workspacePath = join(root, "data", "workspace.json");
  const workspace = JSON.parse(await readFile(workspacePath, "utf8"));
  await writeJson(workspacePath, { ...workspace, dataModelVersion: "3" });
  await Promise.all([
    mkdir(join(root, "data", "frameworks"), { recursive: true }),
    mkdir(join(root, "data", "requirements"), { recursive: true })
  ]);
  await writeJson(join(root, "data", "frameworks", "framework-test.json"), {
    id: "framework-test",
    type: "framework",
    title: "Test framework",
    status: "active",
    version: "test"
  });
  await Promise.all(Array.from({ length: DECISION_COUNT }, (_, index) => {
    const suffix = String(index + 1).padStart(2, "0");
    return writeJson(join(root, "data", "requirements", `requirement-${suffix}.json`), {
      id: `requirement-${suffix}`,
      type: "requirement",
      title: `Requirement ${suffix}`,
      frameworkId: "framework-test",
      reference: `TEST.${index + 1}`,
      applicability: "undetermined"
    });
  }));
  await execute("git", ["init", "--initial-branch=main"], { cwd: root });
  await execute("git", ["config", "user.name", "Test User"], { cwd: root });
  await execute("git", ["config", "user.email", "test@example.test"], { cwd: root });
  await execute("git", ["add", "."], { cwd: root });
  await execute("git", ["commit", "-m", "Create applicability test workspace"], { cwd: root });
  return root;
}

function decisionsPayload() {
  return {
    reviewedByIds: ["person-owner"],
    reviewedOn: "2026-08-18",
    decisions: Array.from({ length: DECISION_COUNT }, (_, index) => {
      const suffix = String(index + 1).padStart(2, "0");
      return {
        id: `requirement-${suffix}`,
        decision: "applicable",
        rationale: `Requirement ${suffix} applies to the reviewed service scope.`
      };
    })
  };
}
