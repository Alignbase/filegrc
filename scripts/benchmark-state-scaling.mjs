import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createScalingWorkload } from "./scaling-workload.mjs";

const { values } = parseArgs({ options: {
  sizes: { type: "string", default: "1000,10000,50000" }, density: { type: "string", default: "1,4" },
  history: { type: "string", default: "0,10" }, samples: { type: "string", default: "64" },
  source: { type: "string", default: resolve(dirname(fileURLToPath(import.meta.url)), "../packages/filegrc") },
  output: { type: "string" }, case: { type: "string" }
} });

const integers = (value, minimum) => value.split(",").map((part) => {
  if (!/^\d+$/.test(part) || Number(part) < minimum || !Number.isSafeInteger(Number(part))) throw new Error(`Invalid benchmark value: ${part}`);
  return Number(part);
});

if (values.case) {
  const { size, density, history } = JSON.parse(values.case);
  const samples = integers(values.samples, 1)[0];
  const moduleAt = (path) => import(pathToFileURL(resolve(values.source, path)).href);
  const [{ applicabilityScopeRevision }, { withCalculationCache }, { loadModel }, { recordBelongsToProgram }] = await Promise.all([
    moduleAt("src/applicability-scope.js"), moduleAt("src/calculation-cache.js"), moduleAt("model/index.js"), moduleAt("src/program.js")
  ]);
  const model = loadModel("12");
  const workload = createScalingWorkload(size, density);
  const selected = Array.from({ length: Math.min(samples, workload.controls.length) }, (_, i) => (
    Math.floor(i * workload.controls.length / Math.min(samples, workload.controls.length))
  ));
  const checksums = createHash("sha256");
  const measure = (callback) => {
    const cpu = process.cpuUsage();
    const start = performance.now();
    callback();
    const elapsed = performance.now() - start;
    const usage = process.cpuUsage(cpu);
    return { wallMs: elapsed, cpuMs: (usage.user + usage.system) / 1000 };
  };
  const revisions = (resources, cache) => withCalculationCache(cache, () => {
    for (const position of selected) for (const options of [{}, { legacyDecisionScope: true }]) {
      checksums.update(applicabilityScopeRevision(workload.controls[position], workload.programFor(position), resources, model, options));
    }
  });
  const cache = new WeakMap();
  const byId = new Map(workload.resources.map((record) => [record.id, record]));
  const broadProgram = { id: "large-program", type: "program", controlIds: workload.controls.map(({ id }) => id) };
  const programMembership = measure(() => withCalculationCache(cache, () => {
    for (const position of selected) checksums.update(String(recordBelongsToProgram(workload.controls[position], broadProgram, byId, model)));
  }));
  const cold = measure(() => revisions(workload.resources, cache));
  const warm = measure(() => revisions(workload.resources, cache));
  const edited = workload.resources.map((record, i) => i === 0 ? { ...record, purpose: "Changed service boundary" } : record);
  const oneRecordEdit = measure(() => revisions(edited, new WeakMap()));
  // Prior arrays emulate immutable historical snapshots, excluding Git/disk.
  const historical = measure(() => {
    for (let i = 0; i < history; i += 1) {
      revisions(workload.resources.map((record, position) => position === 0 ? { ...record, purpose: `Prior boundary ${i}` } : record), new WeakMap());
    }
  });
  const snapshotClone = measure(() => structuredClone(workload.resources));
  const payloadBytes = Buffer.byteLength(JSON.stringify(workload.resources));
  process.send({ size: workload.resources.length, density, historySnapshots: history, sampledRecords: selected.length,
    revisionsPerSample: 2, programMembership, cold, warm, oneRecordEdit, historical, snapshotClone, payloadBytes,
    heapUsedBytes: process.memoryUsage().heapUsed, peakRssBytes: process.resourceUsage().maxRSS * 1024,
    checksum: checksums.digest("hex") });
} else {
  const results = [];
  for (const size of integers(values.sizes, 10)) for (const density of integers(values.density, 1)) for (const history of integers(values.history, 0)) {
    const row = await new Promise((resolveCase, reject) => {
      const child = fork(fileURLToPath(import.meta.url), ["--case", JSON.stringify({ size, density, history }),
        "--source", values.source, "--samples", values.samples], { stdio: ["ignore", "inherit", "inherit", "ipc"] });
      let result;
      child.on("message", (message) => { result = message; });
      child.on("error", reject);
      child.on("exit", (code) => code === 0 && result ? resolveCase(result) : reject(new Error(`Benchmark process exited ${code}`)));
    });
    results.push(row);
    console.log(JSON.stringify(row));
  }
  const report = { nodeVersion: process.version,
    methodology: "Isolated process per case. Generic scope records, bounded Programs, and evenly sampled current and legacy scope revisions. Cold snapshot, retained snapshot, one-record edit with fresh cache, and independent historical arrays. Memory includes workload and caches. Clone and payload metrics cover raw resource arrays. This is a calculation benchmark, not a whole-page, concurrent-user, or Git-history benchmark.", results };
  if (values.output) await writeFile(values.output, `${JSON.stringify(report, null, 2)}\n`);
}
