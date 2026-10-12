import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { createScalingWorkload } from "./scaling-workload.mjs";
import { loadModel } from "../packages/filegrc/model/index.js";
import { applicabilityScopeRevision } from "../packages/filegrc/src/applicability-scope.js";
import { withCalculationCache } from "../packages/filegrc/src/calculation-cache.js";

test("indexed scope calculations preserve pre-index current and legacy revisions", () => {
  const { resources, controls, programs } = createScalingWorkload(100, 3);
  const modes = [{}, { legacyDecisionScope: true }, { legacyDecisionScope: true, legacyBroadScope: true },
    { legacyDecisionScope: true, legacyPolicyStatus: "draft" }];
  const expected = {
    "7": ["2d4ad43373a42f5584f6b82db92700bf70b6b2e1bac7c9b78945f310dd4341a7", "2d4ad43373a42f5584f6b82db92700bf70b6b2e1bac7c9b78945f310dd4341a7",
      "eac31945f23e2e97fffec9bb5702c51b88b8b91b9c57ef9d6e706878217c5bc5", "58242d9a7010dbd2940fee37158d5fa44dd4e00b2d8b0218ef8b3594e87af0c1"],
    "12": ["c1754c752d40b1b2e4f87f35afbf5d49946e43267e84920a5fefd13ed83e8a15", "2cf0e8440d0ce302f72d1934873cc72a1abeb21ec0c5bf4807140946a209c01a",
      "4a6937d711d8580b6d92a2a437864d4c5a3c8d467f953fd568d7475410e30536", "8e809eb56fcc70ff283d46f2918f197d16d4b507278fd1e1423d0ca6fae33de9"]
  };
  const check = () => {
    for (const version of ["7", "12"]) {
      assert.deepEqual(modes.map((options) => applicabilityScopeRevision(controls[0], programs[0], resources, loadModel(version), options)),
        expected[version].map((digest) => `filegrc:applicability-scope:v1:sha256:${digest}`));
    }
  };
  check();
  withCalculationCache(new WeakMap(), check);
});

test("scaling workloads have deterministic counts, bounded Programs, and denser relationships", () => {
  for (const size of [10, 1000, 10000, 50000]) {
    const workload = createScalingWorkload(size, 4);
    assert.equal(workload.resources.length, size);
    assert.equal(new Set(workload.resources.map(({ id }) => id)).size, size);
    assert.ok(workload.programs.every(({ systemIds }) => systemIds.length <= 64));
    assert.ok(workload.controls.every(({ systemIds }) => systemIds.length === Math.min(4, workload.controls.length)));
    for (const [position, control] of workload.controls.entries()) {
      assert.ok(workload.programFor(position).controlIds.includes(control.id));
    }
  }
  assert.deepEqual(createScalingWorkload(100, 2).resources, createScalingWorkload(100, 2).resources);
});

test("scaling benchmark runs isolated cases and reports correctness digests", async () => {
  const run = () => promisify(execFile)(process.execPath, ["scripts/benchmark-state-scaling.mjs", "--sizes=100", "--density=2", "--history=1", "--samples=4"]);
  const first = JSON.parse((await run()).stdout);
  const second = JSON.parse((await run()).stdout);
  assert.equal(first.size, 100);
  assert.equal(first.sampledRecords, 4);
  assert.equal(first.historySnapshots, 1);
  assert.equal(first.checksum, second.checksum);
  for (const metric of ["cold", "warm", "oneRecordEdit", "historical", "snapshotClone"]) {
    assert.ok(Number.isFinite(first[metric].wallMs));
    assert.ok(Number.isFinite(first[metric].cpuMs));
  }
  assert.ok(first.peakRssBytes > 0);
  assert.ok(first.payloadBytes > 0);
  await assert.rejects(promisify(execFile)(process.execPath, ["scripts/benchmark-state-scaling.mjs", "--sizes=-1"]));
});
