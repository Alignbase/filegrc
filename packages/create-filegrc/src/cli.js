import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createFilegrc } from "./index.js";

export async function runCli(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);
  const config = parsed.options.config ? await readConfig(parsed.options.config) : {};
  const organization = config.organization && typeof config.organization === "object"
    ? config.organization
    : {};
  const options = {
    ...organization,
    ...config,
    ...parsed.options,
    setup: {
      ...(config.setup || {}),
      ...parsed.setup
    }
  };
  delete options.organization;
  delete options.config;
  delete options.target;
  if (!Object.keys(options.setup).length) delete options.setup;
  const target = parsed.target ?? config.target ?? "filegrc-program";
  if (options.help) return printHelp();
  if (options.version) return printVersion();
  const result = await createFilegrc({ target, ...options });
  console.log(`Created ${result.target}`);
  console.log(
    `filegrc ${result.engineVersion}${result.enginePackage ? ` from ${result.enginePackage}` : ""}: ` +
    `${result.install === "installed" ? "installed" : "installation skipped"}`
  );
  console.log(`Git: ${result.gitMode === "existing-worktree" ? "joined existing worktree" : "initialized new repository"}`);
  console.log(`Timezone: ${result.values.timezone}`);
  for (const stage of result.stages) {
    console.log(`Stage ${stage.id}: ${stage.status}${stage.status === "created" ? ` (${stage.records} records)` : ""}`);
  }
  console.log(
    `${result.setup ? "Workspace after setup" : "Program baseline"}: ${result.resourceCounts.total} records, including ` +
    `${result.resourceCounts.byType.requirement || 0} requirements, ` +
    `${result.resourceCounts.byType.control || 0} controls, and ` +
    `${result.resourceCounts.byType.obligation || 0} obligations.`
  );
  console.log("");
  console.log(`  cd ${shellQuote(result.target)}`);
  if (options.install === false) console.log("  npm install");
  if (!result.setup) console.log("  npx filegrc setup");
  console.log("  npm run validate");
  console.log("  npm run serve");
  console.log("");
  if (result.setup) {
    console.log(`Service setup: ${result.setup.system.id} (${result.setup.system.status}), target ${result.setup.target.assuranceGoal}.`);
  }
  console.log("Review the generated records, then commit the approved baseline.");
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function parseArgs(argv) {
  let target;
  const options = {};
  const setup = {};
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
    else if (name === "config") options.config = next();
    else if (name === "company-name") options.companyName = next();
    else if (name === "policy-owner-name") options.policyOwnerName = next();
    else if (name === "policy-owner-email") options.policyOwnerEmail = next();
    else if (name === "security-contact-email") options.securityContactEmail = next();
    else if (name === "timezone") options.timezone = next();
    else if (name === "starter") options.starter = next();
    else if (name === "filegrc-version") options.filegrcVersion = next();
    else if (name === "filegrc-package") options.filegrcPackage = next();
    else if (name === "service-name") setup.serviceName = next();
    else if (name === "boundary") setup.boundary = next();
    else if (name === "service-owner") setup.ownerId = next();
    else if (name === "criticality") setup.criticality = next();
    else if (name === "classification") setup.dataClassification = next();
    else if (name === "internet-exposed") setup.internetExposed = booleanOption(next(), "internet-exposed");
    else if (name === "program-goal") setup.programGoal = next();
    else if (name === "setup-draft") setup.draft = true;
    else throw new Error(`Unknown option "${value}".`);
  }
  return { target, options, setup };
}

function printHelp() {
  console.log(`create-filegrc [directory] [options]

Create a filegrc workspace for a SOC 2 program.

Options:
  --config <json-file|->            Read creation and optional setup values
  --company-name <legal-name>       Legal organization name
  --policy-owner-name <name>        Initial policy owner
  --policy-owner-email <email>      Policy owner's email address
  --security-contact-email <email>  Security reporting address
  --timezone <iana-timezone>        Program timezone, such as America/Chicago
  --starter <profile>               security (default) or foundation
  --filegrc-version <version>       Override resolved engine version
  --filegrc-package <directory>     Install an unpublished local filegrc package
  --service-name <name>             Complete service setup after creation
  --boundary <description>          Initial service boundary
  --service-owner <person-id>       Defaults to person-policy-owner
  --criticality <level>             low, medium, high, or critical
  --classification <name>           Initial data classification
  --internet-exposed <bool>         true or false
  --program-goal <goal>             none, readiness, type-1, or type-2
  --setup-draft                     Save combined service setup as a draft
  --no-install                      Write files and a preliminary lockfile only
  --force                           Allow a non-empty target without overwriting files
  --yes                             Use generic prompt defaults
  --version                         Show the package version
  --help                            Show this help`);
}

async function printVersion() {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  console.log(packageJson.version);
}

async function readConfig(path) {
  const source = path === "-"
    ? await readStdin()
    : await readFile(resolve(String(path)), "utf8");
  const parsed = JSON.parse(source);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("Creation config must be a JSON object.");
  }
  return parsed;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function booleanOption(value, name) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`--${name} must be true or false.`);
}
