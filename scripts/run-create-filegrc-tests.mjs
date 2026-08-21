import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { run } from "node:test";
import { spec } from "node:test/reporters";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const testRoot = join(root, "packages", "create-filegrc", "test");
const files = (await discoverTests(testRoot)).sort();
process.chdir(join(root, "packages", "create-filegrc"));
const stream = run({
  files,
  concurrency: 1,
  isolation: "process"
});
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
