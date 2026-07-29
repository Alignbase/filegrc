import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createFilegrc } from "../packages/create-filegrc/src/index.js";
import { serveWorkspace } from "../packages/filegrc/src/index.js";
import { printGithubStarMessage } from "../packages/filegrc/src/startup.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = join(repositoryRoot, ".filegrc", "dev-workspace");
const workspaceConfig = join(workspaceRoot, "data", "workspace.json");
const enginePackage = JSON.parse(await readFile(join(repositoryRoot, "packages", "filegrc", "package.json"), "utf8"));
const port = parsePort(process.env.FILEGRC_DEV_PORT);

if (!await exists(workspaceConfig)) {
  await createFilegrc({
    target: workspaceRoot,
    yes: true,
    install: false,
    filegrcVersion: enginePackage.version
  });
  console.log(`Created development workspace at ${workspaceRoot}`);
}

const { url } = await serveWorkspace(workspaceRoot, { port });
console.log(`filegrc development app: ${url}`);
console.log(`Data: ${join(workspaceRoot, "data")}`);
console.log("Delete .filegrc/dev-workspace to reset the starter data.");
printGithubStarMessage();

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function parsePort(value) {
  if (value === undefined) return 8787;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new Error("FILEGRC_DEV_PORT must be an integer from 0 through 65535.");
  }
  return parsed;
}
