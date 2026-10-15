import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadModel } from "../model/index.js";
import { applicabilityScopeRevision } from "../src/applicability-scope.js";
import { calculationMemo, withCalculationCache } from "../src/calculation-cache.js";
import { assessCollectionReview } from "../src/collection-review.js";
import { getRepositoryStateSignature, setGitCommandInterceptorForTests } from "../src/git.js";
import { resourceReviewRevisions, resourceReviewRevisionsSync } from "../src/retention.js";
import { createStateCalculator } from "../src/state-calculator.js";
import { createAppStateSection } from "../src/state.js";
import { loadWorkspace } from "../src/workspace.js";
import { makeComprehensiveWorkspace } from "./fixtures.js";

async function workspace(context) {
  const root = await mkdtemp(join(tmpdir(), "filegrc-calculation-cache-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  return root;
}

function sourceWorkspace(root) {
  const policy = { id: "policy-rule", type: "policy", policyKind: "security", status: "active", sourceResourceIds: [] };
  return { root, model: loadModel("11"), resources: [policy],
    entries: [{ record: policy, relativePath: "policies/policy-rule.json", source: JSON.stringify(policy) }] };
}

test("review source reuse preserves sections, graphs, and fresh Markdown boundaries", async (context) => {
  const root = await workspace(context);
  await mkdir(join(root, "data/policies"), { recursive: true });
  const path = join(root, "data/policies/policy-rule.md");
  await writeFile(path, "# Policy\n\n## Retention\nKeep records for one year.\n\n## Access\nReview access quarterly.\n");
  const loaded = sourceWorkspace(root);
  const row = { type: "retention-schedule-item", sourceSectionHeadings: { "policy-rule": "Retention" } };
  const access = { ...row, sourceSectionHeadings: { "policy-rule": "Access" } };
  const revision = (reviewer) => resourceReviewRevisionsSync(loaded, ["policy-rule"], "legacy", false, null, reviewer).get("policy-rule");
  const original = revision(row);
  await withCalculationCache(new WeakMap(), async () => {
    assert.equal(revision(row), original);
    assert.equal((await resourceReviewRevisions(loaded, ["policy-rule"], "legacy", row)).get("policy-rule"), original);
    assert.notEqual(revision(access), original);
    await writeFile(path, "# Policy\n\n## Retention\nKeep records for two years.\n\n## Access\nReview access quarterly.\n");
    // A read snapshot stays fixed; its owner must verify files before delivery.
    assert.equal(revision({ ...row, id: "another-row" }), original);
  });
  assert.notEqual(revision(row), original);
  const changed = revision(row);
  withCalculationCache(new WeakMap(), () => assert.equal(revision(row), changed));
  loaded.entries[0].record.sourceResourceIds = ["missing-source"];
  loaded.entries[0].source = JSON.stringify(loaded.entries[0].record);
  withCalculationCache(new WeakMap(), () => assert.equal(revision(row), undefined));
});

test("applicability reuse separates Programs and observes changed scope in a new snapshot", () => {
  const model = loadModel("11");
  const record = { id: "control-a", type: "control", statement: "Review access", requirementIds: [], systemIds: ["system-a"] };
  const programs = [
    { id: "program-a", type: "program", systemIds: ["system-a"], assuranceGoal: "soc-2-type-1" },
    { id: "program-b", type: "program", systemIds: ["system-a"], assuranceGoal: "soc-2-type-2" }
  ];
  const resources = [record, ...programs];
  const revision = (program) => applicabilityScopeRevision(record, program, resources, model);
  const original = revision(programs[0]);
  withCalculationCache(new WeakMap(), () => {
    assert.equal(revision(programs[0]), original);
    assert.notEqual(revision(programs[1]), original);
  });
  programs[0].systemIds = [];
  withCalculationCache(new WeakMap(), () => assert.notEqual(revision(programs[0]), original));
});

test("collection assessment reuses only the selected snapshot and Program", async (context) => {
  const root = await workspace(context);
  const loaded = await loadWorkspace(root);
  withCalculationCache(new WeakMap(), () => {
    const first = assessCollectionReview(loaded, "person");
    assert.strictEqual(assessCollectionReview(loaded, "person"), first);
  });
  assert.notStrictEqual(assessCollectionReview(loaded, "person"), assessCollectionReview(loaded, "person"));
});

test("repository signatures detect already-dirty and ignored attributes and effective configuration", async (context) => {
  const root = await workspace(context);
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  git("init", "--initial-branch=main");
  const attributes = join(root, "data/.gitattributes");
  await writeFile(attributes, "*.json merge=first\n");
  const first = await getRepositoryStateSignature(root);
  await writeFile(attributes, "*.json merge=second\n");
  const second = await getRepositoryStateSignature(root);
  assert.notEqual(second, first);
  await writeFile(join(root, ".gitignore"), "data/.gitattributes\n");
  const ignored = await getRepositoryStateSignature(root);
  await writeFile(attributes, "*.json merge=third\n");
  assert.notEqual(await getRepositoryStateSignature(root), ignored);
  const beforeConfig = await getRepositoryStateSignature(root);
  git("config", "core.autocrlf", "true");
  assert.notEqual(await getRepositoryStateSignature(root), beforeConfig);
});

test("worker and direct calculations agree and fresh snapshot IDs invalidate worker results", async (context) => {
  const root = await workspace(context);
  const loaded = await loadWorkspace(root);
  const calculator = createStateCalculator();
  context.after(() => calculator.close());
  const options = { asOf: "2026-10-12", generatedAt: "2026-10-12T12:00:00.000Z" };
  await assert.rejects(
    calculator.calculate("expired", loaded, "program", options, performance.now() - 1),
    (error) => error.code === "FILEGRC_GIT_DEADLINE"
  );
  const expected = await createAppStateSection(loaded, "program", options);
  const actual = await calculator.calculate("before", loaded, "program", options, performance.now() + 10_000);
  assert.deepEqual(actual, expected);
  loaded.resources.find(({ type }) => type === "person").status = "retired";
  const changed = await calculator.calculate("after", loaded, "program", options, performance.now() + 10_000);
  assert.deepEqual(changed, await createAppStateSection(loaded, "program", options));
  assert.notDeepEqual(changed, actual);
});

test("closing a calculator prevents another worker from starting", async () => {
  const calculator = createStateCalculator();
  await calculator.close();
  await assert.rejects(calculator.calculate("closed", {}, "program", {}, performance.now() + 1000), /server stopped/);
});

test("worker registers once, supports concurrent reads, and re-registers evicted snapshots", async (context) => {
  const loaded = await loadWorkspace(await workspace(context));
  const calculator = createStateCalculator();
  context.after(() => calculator.close());
  const options = { asOf: "2026-10-12", generatedAt: "2026-10-12T12:00:00.000Z" };
  const deadline = () => performance.now() + 20_000;
  const expected = await createAppStateSection(loaded, "program", options);
  const first = calculator.calculate("a", loaded, "program", options, deadline());
  // This value cannot cross a worker boundary. Reusing a registered snapshot
  // must send only its ID, even while the first calculation is still pending.
  const cannotClone = { ...loaded, unexpectedFunction: () => {} };
  const second = calculator.calculate("a", cannotClone, "program", options, deadline());
  assert.deepEqual(await first, expected);
  assert.deepEqual(await second, expected);
  await calculator.calculate("b", loaded, "program", options, deadline());
  await calculator.calculate("c", loaded, "program", options, deadline());
  await assert.rejects(calculator.calculate("a", cannotClone, "program", options, deadline()), { name: "DataCloneError" });
  assert.deepEqual(await calculator.calculate("a", loaded, "program", options, deadline()), expected);
});

test("older Git attribute verification tracks effective changes and fails closed", async (context) => {
  const root = await workspace(context);
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: root });
  let value = "first";
  let fail = false;
  const restore = setGitCommandInterceptorForTests(({ args, run }) => {
    if (args[0] === "var" && args[1] === "-l") return "";
    if (args[0] === "check-attr" && args.includes("--all")) {
      if (fail) throw new Error("Could not verify legacy system attributes");
      return `data/workspace.json\0merge\0${value}\0`;
    }
    return run();
  });
  context.after(restore);
  const before = await getRepositoryStateSignature(root);
  value = "second";
  assert.notEqual(await getRepositoryStateSignature(root), before);
  fail = true;
  await assert.rejects(getRepositoryStateSignature(root), /Could not verify legacy system attributes/);
});

test("shared scope projections preserve every legacy hash and nested-extension invalidation", () => {
  const model = loadModel("12");
  const record = { id: "control-a", type: "control", statement: "Review access", systemIds: ["system-a"],
    extensions: { example: { rule: "first", values: [2, 1] } } };
  const program = { id: "program-a", type: "program", systemIds: ["system-a"], controlIds: [record.id] };
  const system = { id: "system-a", type: "system", purpose: "Service", servicesProvided: ["Support", "Processing"] };
  const resources = [record, program, system];
  const modes = [{}, { legacyDecisionScope: true }, { legacyResourceProjection: true },
    { legacyDecisionScope: true, legacyBroadScope: true },
    { legacyDecisionScope: true, legacyPolicyStatus: "draft", legacyPolicyWithoutApprovalBinding: true }];
  const expected = modes.map((options) => applicabilityScopeRevision(record, program, resources, model, options));
  withCalculationCache(new WeakMap(), () => {
    for (let pass = 0; pass < 2; pass += 1) {
      assert.deepEqual(modes.map((options) => applicabilityScopeRevision(record, program, resources, model, options)), expected);
    }
  });
  record.extensions.example.rule = "second";
  const changed = applicabilityScopeRevision(record, program, resources, model);
  assert.notEqual(changed, expected[0]);
  withCalculationCache(new WeakMap(), () => assert.equal(applicabilityScopeRevision(record, program, resources, model), changed));
});

test("large projection workloads retain completed collection assessments at the cache limit", async (context) => {
  const root = await workspace(context);
  const loaded = await loadWorkspace(root);
  withCalculationCache(new WeakMap(), () => {
    const assessment = assessCollectionReview(loaded, "person");
    for (let id = 0; id < 256; id += 1) calculationMemo(loaded, "additional-projections", [id], () => id);
    assert.strictEqual(assessCollectionReview(loaded, "person"), assessment);
  }, { maxResults: 128 });
});

test("assessment caches share nested work and discard results after success or failure", async () => {
  const { withAssessmentCache, hasCalculationCache } = await import("../src/calculation-cache.js");
  const owner = {}; let calculated = 0;
  const read = () => calculationMemo(owner, "assessment", [], () => ++calculated);
  await withAssessmentCache(async () => {
    assert.equal(read(), 1);
    await Promise.resolve();
    assert.equal(withAssessmentCache(read), 1);
  });
  assert.equal(hasCalculationCache(), false);
  assert.equal(withAssessmentCache(read), 2);
  await assert.rejects(withAssessmentCache(async () => { assert.equal(read(), 3); throw new Error("failed"); }), /failed/);
  assert.equal(hasCalculationCache(), false);
  assert.equal(withAssessmentCache(read), 4);
  withCalculationCache(new WeakMap(), () => {
    assert.equal(read(), 5);
    assert.equal(withAssessmentCache(read), 5);
    assert.equal(read(), 5);
  });
});

test("parallel assessments cannot reuse another invocation's mutable inputs", async () => {
  const { withAssessmentCache } = await import("../src/calculation-cache.js");
  const owner = {}; let release;
  const pending = new Promise(resolve => { release = resolve; });
  const first = withAssessmentCache(async () => {
    assert.equal(calculationMemo(owner, "value", [], () => "first"), "first");
    await pending;
    return calculationMemo(owner, "value", [], () => "unexpected");
  });
  assert.equal(await withAssessmentCache(async () => calculationMemo(owner, "value", [], () => "second")), "second");
  release(); assert.equal(await first, "first");
});

test("public workflow bounds review Markdown reads and observes edits on its next invocation", async context => {
  const { createRequire, syncBuiltinESMExports } = await import("node:module");
  const { assessWorkflow, validateWorkspace } = await import("../src/index.js");
  const { resolve } = await import("node:path");
  const root = await workspace(context), loaded = await loadWorkspace(root);
  const policy = loaded.entries.find(({record}) => record.type === "policy");
  const rule = loaded.resources.find(record => record.type === "retention-schedule-item");
  rule.status = "active";
  rule.sourceResourceIds = [policy.record.id];
  rule.reviewedSourceRevisions = { [policy.record.id]: "stale" };
  for (let index=0;index<20;index++) {
    const record={...rule,id:`retention-row-${index}`};
    loaded.resources.push(record);
    loaded.entries.push({record,relativePath:`retention-schedule-items/${record.id}.json`,source:JSON.stringify(record)});
  }
  const markdownPath = resolve(loaded.root, "data", policy.relativePath.replace(/\.json$/, ".md"));
  const fs = createRequire(import.meta.url)("node:fs"), originalRead = fs.readFileSync;
  const validation = await validateWorkspace(loaded);
  let reads = 0;
  fs.readFileSync = function(path, ...args) { if(String(path) === markdownPath)reads++; return originalRead.call(this,path,...args); };
  syncBuiltinESMExports();
  try {
    const options = { asOf:"2026-10-14", now:"2026-10-14T20:00:00.000Z", validation };
    await assessWorkflow(loaded, options);
    const firstReads=reads;
    assert.ok(firstReads>0 && firstReads<=2, "source reads must stay bounded as schedule rows share a review graph");
    const original = originalRead(markdownPath,"utf8");
    await writeFile(markdownPath, `${original}\nChanged operating procedure.\n`);
    await assessWorkflow(loaded, options);
    assert.equal(reads, firstReads*2, "the next assessment must re-read mutable source content");
  } finally { fs.readFileSync=originalRead;syncBuiltinESMExports(); }
});
