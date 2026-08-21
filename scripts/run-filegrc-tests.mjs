import { readdir } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { run } from "node:test";
import { spec } from "node:test/reporters";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const testRoot = join(root, "packages", "filegrc", "test");
const fullOnly = new Set([
  "agent.test.js",
  "cli-process.test.js",
  "evidence-packet.test.js",
  "git.test.js",
  "setup.test.js"
]);
const fast = process.argv.includes("--fast");
const nodeMajor = Number(process.versions.node.split(".")[0]);
const concurrency = Number(process.env.FILEGRC_TEST_CONCURRENCY || (nodeMajor >= 25 ? 1 : 4));
if (!Number.isInteger(concurrency) || concurrency < 1) {
  throw new Error("FILEGRC_TEST_CONCURRENCY must be a positive integer.");
}
const isolation = nodeMajor >= 25 ? "none" : "process";
const files = (await discoverTests(testRoot))
  .filter((path) => !fast || !fullOnly.has(relative(testRoot, path).split(sep).join("/")))
  .sort();

process.chdir(join(root, "packages", "filegrc"));
const stream = run({ files, concurrency, isolation });
let failed = false;
stream.on("test:fail", () => { failed = true; });
stream.compose(spec()).pipe(process.stdout);
stream.on("end", () => { process.exitCode = failed ? 1 : 0; });

async function discoverTests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return discoverTests(path);
    return entry.isFile() && entry.name.endsWith(".test.js") ? [path] : [];
  }));
  return paths.flat();
}
