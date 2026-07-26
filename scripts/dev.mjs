import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSoc2 } from "../packages/create-soc2/src/index.js";
import { serveWorkspace } from "../packages/soc2/src/index.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = join(repositoryRoot, ".soc2", "dev-workspace");
const workspaceConfig = join(workspaceRoot, "data", "workspace.json");
const enginePackage = JSON.parse(await readFile(join(repositoryRoot, "packages", "soc2", "package.json"), "utf8"));
const port = parsePort(process.env.SOC2_DEV_PORT);

if (!await exists(workspaceConfig)) {
  await createSoc2({
    target: workspaceRoot,
    yes: true,
    install: false,
    soc2Version: enginePackage.version
  });
  console.log(`Created development workspace at ${workspaceRoot}`);
}

const { url } = await serveWorkspace(workspaceRoot, { port });
console.log(`SOC 2 development app: ${url}`);
console.log(`Data: ${join(workspaceRoot, "data")}`);
console.log("Delete .soc2/dev-workspace to reset the starter data.");

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
    throw new Error("SOC2_DEV_PORT must be an integer from 0 through 65535.");
  }
  return parsed;
}
