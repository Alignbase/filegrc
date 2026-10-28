import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function adoptWorkflowRuntime(root, version = "0.21.6") {
  const dependencies = { filegrc: `^${version}` };
  await writeFile(join(root, "package.json"), JSON.stringify({ private: true, dependencies }, null, 2) + "\n");
  await writeFile(join(root, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: {
    "": { dependencies }, "node_modules/filegrc": { version }
  } }, null, 2) + "\n");
}
