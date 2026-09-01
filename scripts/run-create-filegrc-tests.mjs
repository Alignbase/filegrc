import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverTestFiles, runTestSuite } from "./test-scheduler.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packageRoot = join(root, "packages", "create-filegrc");
const testRoot = join(packageRoot, "test");
const files = await discoverTestFiles(testRoot);

await runTestSuite({
  name: "create-filegrc integration",
  cwd: packageRoot,
  files,
  toolchainCommands: ["git"],
  inputPaths: [
    join(root, "packages", "filegrc", "src"),
    join(root, "packages", "filegrc", "model"),
    join(root, "packages", "filegrc", "bin"),
    join(root, "packages", "filegrc", "package.json"),
    join(packageRoot, "bin"),
    join(packageRoot, "README.md"),
    join(packageRoot, "src"),
    join(packageRoot, "template"),
    join(packageRoot, "template-parameters.json"),
    testRoot,
    join(packageRoot, "package.json"),
    join(root, "package.json"),
    join(root, "package-lock.json"),
    join(root, "scripts", "run-create-filegrc-tests.mjs"),
  ],
});
