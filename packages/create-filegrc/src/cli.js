import { readFile } from "node:fs/promises";
import { createFileGRC } from "./index.js";

export async function runCli(argv = process.argv.slice(2)) {
  const { target, options } = parseArgs(argv);
  if (options.help) return printHelp();
  if (options.version) return printVersion();
  const result = await createFileGRC({ target, ...options });
  console.log(`Created ${result.target}`);
  console.log(`FileGRC ${result.engineVersion}: ${result.install === "installed" ? "installed" : "installation skipped"}`);
  console.log(`Git: ${result.gitMode === "existing-worktree" ? "joined existing worktree" : "initialized new repository"}`);
  console.log("");
  console.log(`  cd ${result.target}`);
  if (options.install === false) console.log("  npm install");
  console.log("  npm run validate");
  console.log("  npm run serve");
  console.log("");
  console.log("Review the starter drafts, then commit the approved baseline.");
}

function parseArgs(argv) {
  let target;
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("-") && !target) {
      target = value;
      continue;
    }
    const [name, inline] = value.replace(/^--?/, "").split("=", 2);
    const next = () => inline ?? argv[++index];
    if (name === "help" || name === "h") options.help = true;
    else if (name === "version" || name === "v") options.version = true;
    else if (name === "yes" || name === "y") options.yes = true;
    else if (name === "force") options.force = true;
    else if (name === "no-install") options.install = false;
    else if (name === "company-name") options.companyName = next();
    else if (name === "policy-owner-name") options.policyOwnerName = next();
    else if (name === "security-contact-email") options.securityContactEmail = next();
    else if (name === "filegrc-version") options.filegrcVersion = next();
    else throw new Error(`Unknown option "${value}".`);
  }
  return { target: target ?? "filegrc-program", options };
}

function printHelp() {
  console.log(`create-filegrc [directory] [options]

Create a FileGRC workspace for a SOC 2 program.

Options:
  --company-name <name>
  --policy-owner-name <name>
  --security-contact-email <email>
  --filegrc-version <version>       Override resolved engine version
  --no-install                   Write files and a preliminary lockfile only
  --force                        Allow a non-empty target without overwriting files
  --yes                          Use generic prompt defaults
  --version                      Show the package version
  --help                         Show this help`);
}

async function printVersion() {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  console.log(packageJson.version);
}
