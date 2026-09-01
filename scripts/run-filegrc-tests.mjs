import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverTestFiles, runTestSuite } from "./test-scheduler.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packageRoot = join(root, "packages", "filegrc");
const testRoot = join(packageRoot, "test");
const unitFiles = new Set([
  "applicability-scope.test.js",
  "favicon.test.js",
  "git-adapter.test.js",
  "id.test.js",
  "model.test.js",
  "parties.test.js",
  "recurrence.test.js",
  "source-coverage.test.js",
  "time.test.js",
]);
const tierArgument = argumentValue("--tier");
const tier =
  tierArgument || (process.argv.includes("--fast") ? "unit" : "integration");
if (!new Set(["unit", "integration"]).has(tier)) {
  throw new Error("FileGRC test tier must be unit or integration.");
}
const discovered = await discoverTestFiles(testRoot);
const files = discovered.filter(
  (path) =>
    tier === "integration" ||
    unitFiles.has(relative(testRoot, path).split(sep).join("/")),
);

await runTestSuite({
  name: `filegrc ${tier}`,
  cwd: packageRoot,
  files,
  toolchainCommands: tier === "integration" ? ["git"] : [],
  inputPaths: [
    join(packageRoot, "src"),
    join(packageRoot, "model"),
    join(packageRoot, "bin"),
    testRoot,
    join(root, "packages", "create-filegrc", "src"),
    join(root, "packages", "create-filegrc", "template"),
    join(root, "packages", "create-filegrc", "template-parameters.json"),
    join(root, "packages", "create-filegrc", "package.json"),
    join(root, "docs", "data-model.md"),
    join(packageRoot, "package.json"),
    join(root, "package.json"),
    join(root, "package-lock.json"),
    join(root, "scripts", "dev.mjs"),
    join(root, "scripts", "run-filegrc-tests.mjs"),
  ],
});

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}
