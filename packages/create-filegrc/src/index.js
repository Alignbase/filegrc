import { execFile } from "node:child_process";
import { cp, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createInterface } from "node:readline/promises";
import { baselineRecordFiles, baselineRecordPaths, writeBaselineRecords } from "./defaults.js";

const execute = promisify(execFile);
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const textExtensions = new Set(["", ".json", ".md", ".txt", ".yml", ".yaml", ".gitignore"]);
const STARTER_PROFILES = new Set(["foundation", "security"]);
const SECURITY_TEMPLATE_COLLECTIONS = new Set(["collection-reviews", "documents", "policies", "reporting-route-sets", "training"]);

export async function createFilegrc(options = {}) {
  const parameterConfig = JSON.parse(await readFile(join(packageRoot, "template-parameters.json"), "utf8"));
  const target = resolve(options.target ?? "filegrc-program");
  const starter = normalizeStarterProfile(options.starter);
  const repository = normalizeRepositoryOptions(options);
  if (options.setup && options.install === false) {
    throw new Error("Combined service setup requires installation. Remove --no-install or run filegrc setup after npm install.");
  }
  validateCombinedSetup(options.setup);
  await assertWritableTarget(target, Boolean(options.force));
  if (options.force) await assertNoTemplateCollisions(target, starter);

  const prompted = await resolvePromptValues(parameterConfig.parameters, options);
  const engine = await resolveEngine(options);
  const starterText = starterTemplateText(starter, prompted.company_name);
  const values = {
    ...prompted,
    effective_date: options.effectiveDate ?? calendarDateInTimezone(prompted.timezone),
    project_name: normalizePackageName(basename(target)),
    filegrc_version: engine.version,
    filegrc_version_range: engine.dependency,
    ...starterText
  };

  await mkdir(target, { recursive: true });
  await copyTemplate(target, starter);
  await renderTemplate(target, parameterConfig, values, starter);
  await writeRendererRepositorySettings(target, repository);
  await writeBaselineRecords(target, values.effective_date, starter);
  await applyStarterScope(target, starter, values.effective_date);
  const initialResourceCounts = await summarizeResources(target);

  const installed = options.install !== false;
  if (installed) {
    await run("npm", ["install", "--ignore-scripts"], target);
  } else {
    await writeMinimalLockfile(target, values.project_name, values.filegrc_version_range);
  }
  const joinedExistingWorktree = await isInsideGitWorktree(target);
  if (!joinedExistingWorktree) await run("git", ["init", `--initial-branch=${repository.authoritativeBranch}`], target);
  const gitHead = await inspectGitHead(target);
  const setup = options.setup ? await runCombinedSetup(target, options.setup) : null;
  const resourceCounts = setup ? await summarizeResources(target) : initialResourceCounts;
  return {
    target,
    values,
    starter,
    engineVersion: engine.version,
    engineSource: engine.localPath ? "local" : "registry",
    enginePackage: engine.localPath || null,
    dependency: engine.dependency,
    stages: starterStages(starter, initialResourceCounts),
    resourceCounts,
    setup,
    install: installed ? "installed" : "skipped",
    gitMode: joinedExistingWorktree ? "existing-worktree" : "initialized",
    gitBranch: gitHead.branch,
    gitDetached: gitHead.detached,
    repository
  };
}

function calendarDateInTimezone(timezone, date = new Date()) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date).map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function normalizeStarterProfile(value = "security") {
  const profile = String(value || "security").trim().toLowerCase();
  const normalized = profile === "empty" ? "foundation" : profile === "soc2-security" ? "security" : profile;
  if (!STARTER_PROFILES.has(normalized)) {
    throw new Error(`Starter profile must be one of ${[...STARTER_PROFILES].join(", ")}.`);
  }
  return normalized;
}

function normalizeRepositoryOptions(options) {
  const mode = String(options.repositoryMode ?? "trunk").trim();
  if (!["trunk", "manual"].includes(mode)) {
    throw new Error("Repository mode must be trunk or manual.");
  }
  return {
    mode,
    authoritativeBranch: normalizeGitSetting(options.authoritativeBranch, "main", "authoritative branch"),
    remote: normalizeGitSetting(options.repositoryRemote, "origin", "repository remote")
  };
}

function normalizeGitSetting(value, fallback, label) {
  const result = String(value ?? fallback).trim();
  if (!safeGitName(result)) {
    throw new Error(`${label} must be a safe Git name.`);
  }
  return result;
}

function safeGitName(value) {
  const segments = value.split("/");
  return Boolean(value)
    && value !== "@"
    && value !== "HEAD"
    && !value.startsWith("-")
    && !value.includes("..")
    && !value.includes("@{")
    && !/[\s~^:?*[\]\\\u0000-\u001f\u007f]/.test(value)
    && segments.every((segment) => (
      segment
      && !segment.startsWith(".")
      && !segment.endsWith(".")
      && !segment.endsWith(".lock")
    ));
}

async function writeRendererRepositorySettings(target, repository) {
  const path = join(target, "data", "renderer.json");
  const renderer = JSON.parse(await readFile(path, "utf8"));
  await writeFile(path, `${JSON.stringify({
    ...renderer,
    repositoryMode: repository.mode,
    authoritativeBranch: repository.authoritativeBranch,
    repositoryRemote: repository.remote
  }, null, 2)}\n`, "utf8");
}

export async function resolveFilegrcVersion(explicitVersion) {
  if (explicitVersion) return cleanVersion(explicitVersion);
  try {
    const { stdout } = await execute("npm", ["view", "filegrc", "version", "--json"], {
      timeout: 15_000,
      maxBuffer: 100_000
    });
    const parsed = JSON.parse(stdout);
    return cleanVersion(Array.isArray(parsed) ? parsed.at(-1) : parsed);
  } catch {
    const ownPackage = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
    return cleanVersion(ownPackage.version);
  }
}

async function resolveEngine(options) {
  if (options.filegrcVersion && options.filegrcPackage) {
    throw new Error("Use either filegrcVersion or filegrcPackage, not both.");
  }
  if (!options.filegrcPackage) {
    const version = await resolveFilegrcVersion(options.filegrcVersion);
    return { version, dependency: `^${version}`, localPath: null };
  }
  const localPath = resolve(String(options.filegrcPackage));
  let packageJson;
  try {
    packageJson = JSON.parse(await readFile(join(localPath, "package.json"), "utf8"));
  } catch (error) {
    throw new Error(`Could not read a local filegrc package at ${localPath}: ${error.message}`);
  }
  if (packageJson.name !== "filegrc") {
    throw new Error(`Local package at ${localPath} is named "${packageJson.name || ""}", expected "filegrc".`);
  }
  const version = cleanVersion(packageJson.version);
  return { version, dependency: `file:${localPath.replaceAll("\\", "/")}`, localPath };
}

async function resolvePromptValues(parameters, options) {
  const mapped = {
    company_name: options.companyName,
    policy_owner_name: options.policyOwnerName,
    policy_owner_job_title: options.policyOwnerJobTitle,
    policy_owner_email: options.policyOwnerEmail,
    security_contact_email: options.securityContactEmail,
    timezone: options.timezone
  };
  if (options.yes) {
    mapped.company_name ??= "Example Company";
    mapped.policy_owner_name ??= "Security Owner";
    mapped.policy_owner_job_title ??= "Chief Executive Officer";
    mapped.security_contact_email ??= "security@example.com";
  }
  for (const key of Object.keys(mapped)) {
    if (mapped[key] !== undefined && mapped[key] !== null) mapped[key] = String(mapped[key]).trim();
  }
  if (process.stdin.isTTY && process.stdout.isTTY) {
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try {
      for (const parameter of parameters.filter(({ required, key }) => required && !mapped[key])) {
        const defaultValue = parameterDefault(parameter, mapped);
        const suffix = defaultValue ? ` [${defaultValue}]` : "";
        let value = "";
        while (!value) {
          value = (await prompt.question(`${parameter.prompt}${suffix}: `)).trim() || defaultValue;
        }
        mapped[parameter.key] = value;
      }
    } finally {
      prompt.close();
    }
  } else {
    for (const parameter of parameters.filter(({ required, key }) => required && !mapped[key])) {
      mapped[parameter.key] = parameterDefault(parameter, mapped);
    }
  }
  const missing = parameters.filter(({ key, required }) => required && !mapped[key]);
  if (missing.length) {
    throw new Error(`Missing required values: ${missing.map(({ key }) => key).join(", ")}`);
  }
  for (const key of ["company_name", "policy_owner_name", "policy_owner_job_title"]) {
    if (/[\u0000-\u001f\u007f]/.test(mapped[key])) {
      throw new Error(`${key} must be a single line without control characters.`);
    }
    if (mapped[key].length > 200) throw new Error(`${key} must be 200 characters or fewer.`);
    if (/\{\{[a-z0-9_]+\}\}/.test(mapped[key])) {
      throw new Error(`${key} cannot contain template token syntax.`);
    }
  }
  for (const [key, label] of [
    ["policy_owner_email", "Policy owner email"],
    ["security_contact_email", "Security contact email"]
  ]) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mapped[key])) {
      throw new Error(`${label} must be a valid email address.`);
    }
  }
  if (!isTimezone(mapped.timezone)) throw new Error("Program timezone must be a valid IANA time zone.");
  return mapped;
}

function parameterDefault(parameter, mapped) {
  if (parameter.defaultFrom) return mapped[parameter.defaultFrom] || "";
  if (parameter.defaultSource === "local-timezone") return localTimezone();
  return "";
}

function localTimezone() {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return isTimezone(timezone) ? timezone : "UTC";
}

function isTimezone(value) {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

async function assertWritableTarget(target, force) {
  try {
    if ((await lstat(target)).isSymbolicLink()) {
      throw new Error(`Target directory must not be a symbolic link: ${target}.`);
    }
    const items = await readdir(target);
    if (items.length && !force) {
      throw new Error(`Target directory is not empty: ${target}. Pass --force to add files without overwriting existing paths.`);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function assertNoTemplateCollisions(target, starter) {
  const collisions = [];
  for (const destinationPath of [...await templateDestinationPaths(starter), ...baselineRecordPaths(starter)]) {
    await assertNoSymlinkComponents(target, destinationPath);
    try {
      await lstat(join(target, destinationPath));
      collisions.push(destinationPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (collisions.length) {
    throw new Error(`Target contains files create-filegrc would overwrite: ${collisions.slice(0, 5).join(", ")}.`);
  }
}

async function assertNoSymlinkComponents(target, relativePath) {
  let current = target;
  for (const segment of relativePath.split(/[\\/]/).filter(Boolean)) {
    current = join(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new Error(`Target contains a symbolic link at ${relative(target, current)}.`);
      }
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
  }
}

async function renderTemplate(target, parameterConfig, values, starter) {
  const declared = new Set([
    ...parameterConfig.parameters.map(({ key }) => key),
    ...parameterConfig.generated.map(({ key }) => key)
  ]);
  const files = (await templateDestinationPaths(starter)).map((path) => join(target, path));
  for (const path of files) {
    if (!textExtensions.has(extname(path)) && basename(path) !== ".gitignore") continue;
    let source = await readFile(path, "utf8");
    const jsonFile = extname(path) === ".json";
    source = source.replace(/\{\{([a-z0-9_]+)\}\}(\.)?/g, (match, token, sentencePeriod = "") => {
      if (!declared.has(token)) throw new Error(`Unknown template token "{{${token}}}" in ${path}`);
      if (values[token] === undefined) throw new Error(`No value resolved for template token "{{${token}}}"`);
      const value = jsonFile ? jsonStringContents(values[token]) : String(values[token]);
      const punctuation = !jsonFile && sentencePeriod && /[.!?]$/u.test(value) ? "" : sentencePeriod;
      return value + punctuation;
    });
    const unresolved = /\{\{([a-z0-9_]+)\}\}/.exec(source);
    if (unresolved) throw new Error(`Unresolved template token "{{${unresolved[1]}}}" in ${path}`);
    await writeFile(path, source, "utf8");
  }
}

async function templateDestinationPaths(starter = "security") {
  const template = join(packageRoot, "template");
  return (await collectFiles(template)).flatMap((source) => {
    const templatePath = relative(template, source);
    if (!includeTemplatePath(templatePath, starter)) return [];
    if (templatePath === "README.md") return [];
    if (templatePath === "WORKSPACE.md") return ["README.md"];
    return [templatePath === "gitignore" ? ".gitignore" : templatePath];
  });
}

async function copyTemplate(target, starter = "security") {
  const template = join(packageRoot, "template");
  for (const source of await collectFiles(template)) {
    const templatePath = relative(template, source);
    if (!includeTemplatePath(templatePath, starter)) continue;
    if (templatePath === "README.md") continue;
    const destinationPath = templatePath === "WORKSPACE.md"
      ? "README.md"
      : templatePath === "gitignore" ? ".gitignore" : templatePath;
    const destination = join(target, destinationPath);
    await assertNoSymlinkComponents(target, destinationPath);
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination, {
      force: false,
      errorOnExist: true,
      preserveTimestamps: false
    });
  }
}

function includeTemplatePath(templatePath, starter) {
  if (starter === "security") return true;
  const segments = templatePath.split(/[\\/]/);
  if (segments[0] !== "data" || !SECURITY_TEMPLATE_COLLECTIONS.has(segments[1])) return true;
  return segments.at(-1) === "AGENTS.md";
}

async function collectFiles(directory) {
  const result = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) result.push(...await collectFiles(path));
    else if (item.isFile()) result.push(path);
  }
  return result;
}

async function summarizeResources(target) {
  const counts = {};
  let total = 0;
  for (const path of await collectFiles(join(target, "data"))) {
    if (extname(path) !== ".json") continue;
    const record = JSON.parse(await readFile(path, "utf8"));
    if (!record?.id || !record?.type) continue;
    total += 1;
    counts[record.type] = (counts[record.type] || 0) + 1;
  }
  return { total, byType: counts };
}

async function applyStarterScope(target, starter, effectiveDate) {
  if (starter !== "security") return;
  const records = baselineRecordFiles(effectiveDate, starter).map(({ record }) => record);
  const workspacePath = join(target, "data", "workspace.json");
  const workspace = JSON.parse(await readFile(workspacePath, "utf8"));
  const ids = (type) => records.filter((record) => record.type === type).map((record) => record.id);
  await writeFile(workspacePath, `${JSON.stringify(workspace, null, 2)}\n`, "utf8");
  const programPath = join(target, "data", "programs", "program-soc-2.json");
  const program = JSON.parse(await readFile(programPath, "utf8"));
  await writeFile(programPath, `${JSON.stringify({
    ...program,
    frameworkIds: ids("framework"),
    requirementApplicability: ids("requirement").map((requirementId) => ({
      requirementId,
      decision: "undetermined"
    })),
    controlIds: ids("control")
  }, null, 2)}\n`, "utf8");
}

function starterStages(starter, counts) {
  const foundationTypes = new Set(["workspace", "program", "renderer-settings", "person", "appointment", "team", "system", "component", "classification", "information-type"]);
  const foundation = Object.entries(counts.byType)
    .filter(([type]) => foundationTypes.has(type))
    .reduce((total, [, count]) => total + count, 0);
  return [
    { id: "foundation", status: "created", records: foundation },
    {
      id: "soc2-security",
      status: starter === "security" ? "created" : "skipped",
      records: starter === "security" ? counts.total - foundation : 0
    }
  ];
}

function starterTemplateText(starter, companyName) {
  if (starter === "foundation") {
    return {
      program_title: `${companyName} GRC Program`,
      program_description: "Governance, risk, and compliance workspace without a preselected framework.",
      program_summary: `This private workspace holds ${companyName}'s governance, risk, compliance, and audit-evidence records. JSON under \`data/\` stores structured records, Markdown stores long-form work, and Git records reviewed changes.`,
      agent_title: "filegrc Workspace Instructions",
      agent_purpose: `This repository is ${companyName}’s foundation filegrc workspace. Engineers and agents maintain the source records under \`data/\`. The \`filegrc\` package validates, searches, edits, and renders those files. No framework or assurance program has been selected yet.`,
      starter_baseline: `## Foundation baseline

The generated workspace starts with foundational program records:

- Workspace and renderer settings
- The initial active owner
- The two core Appointment records: an active Policy Owner plus a planned Independent Policy Reviewer assignment. Create another Appointment only when the company actually delegates a named responsibility.
- A planned security and risk oversight team that still needs an independent chair
- The filegrc Git repository as a governance system of record
- A default 5x5 risk method and Public, Internal, Confidential, and Restricted data classifications

This profile does not include framework requirements, policies, governed documents, training, controls, obligations, or audit-management templates. Add and review those records for the selected framework before treating Program Readiness or Audit Readiness as meaningful. Do not infer that an absent control, policy, or schedule is unnecessary.`,
      audit_preparation_guidance: "The foundation profile does not include the local SOC 2 management-document templates used by `prepare-audit`. Add reviewed templates and program scope before initializing audit work. Audit preparation must not invent missing policy, control, or evidence facts.",
      starter_setup: `## Start the program

This foundation profile contains the workspace, initial owner, core Appointments, oversight team, renderer settings, and filegrc system of record. It does not select a framework or create proposed policies, controls, obligations, or evidence.

1. Run \`npx filegrc setup\` for guided service and goal setup, or use browser onboarding.
2. Use \`npx filegrc guide --json\` before creating framework requirements, policies, controls, obligations, and evidence sources.
3. Run \`npx filegrc validate\`, review the Git diff, and commit each reviewed program layer.`
    };
  }
  return {
    program_title: `${companyName} SOC 2 Program`,
    program_description: "SOC 2 Security program based on the AICPA Trust Services Criteria.",
    program_summary: `This private workspace holds ${companyName}'s SOC 2 program records and audit evidence. JSON under \`data/\` stores structured records, Markdown stores long-form work, and Git records reviewed changes.`,
    agent_title: "filegrc SOC 2 Workspace Instructions",
    agent_purpose: `This repository is ${companyName}’s filegrc workspace for its SOC 2 program. Engineers and agents maintain the source records under \`data/\`. The \`filegrc\` package validates, searches, edits, and renders those files.`,
    starter_baseline: `## Starter baseline

The generated workspace starts with the SOC 2 Security category:

- Active framework records for the 2017 Trust Services Criteria with revised points of focus (2022) and the 2018 SOC 2 Description Criteria with revised implementation guidance (2022)
- The 33 Common Criteria reference IDs from CC1.1 through CC9.2, without the licensed criteria text
- The nine Description Criteria reference IDs from DC1 through DC9, without the licensed criteria text
- Planned controls mapped to those references and one required Information Security Policy
- The two core Appointment records. Policy Owner starts active; Independent Policy Reviewer remains Ready until assigned. The Policy Owner coordinates incident, recovery, executive, communications, audit, insurance, privacy, and legal input unless the company delegates a function through a custom Appointment. FileGRC does not require in-house counsel or a standing legal retainer.
- A security and risk oversight team chaired by an independent reviewer who may be internal or external
- One Security Awareness Training record and proposed recurring obligations for reviews, scans, tests, training, and meetings
- One combined Security Incident and Recovery Plan plus a focused Data Retention Schedule
- A default 5x5 risk method and Public, Internal, Confidential, and Restricted data classifications

Treat every planned Control as a proposal until its owner, actual procedure in Record Markdown, System scope, cadence, authoritative evidence sources, implementation date, and mappings match actual practice. FileGRC does not infer implementation from Policy prose. Enable the applicable Work Queue schedules during implementation; they remain dormant until the Policy is active and effective. Add Availability, Processing Integrity, Confidentiality, Privacy, employment, anti-bribery, or other broader GRC records only when the company chooses to expand the scope.

The recurring Obligations contain reviewable starter defaults. They remain proposed until the company confirms their scope, owner, cadence, and proof. Enabling a schedule accepts those operational facts but does not start occurrences until the Information Security Policy is active and effective. Create separate completion records, such as meetings, reviews, scans, tests, exercises, and attestations, for each period.`,
    audit_preparation_guidance: "Preparation creates a separate system description, management assertion, and management representation document for the engagement from the local starter templates. Type 2 preparation also creates a period completeness statement and one `audit-population` record for each standard population. It is safe to run again and does not approve documents, mark controls implemented, or create evidence. Do not reuse one completed management document across engagements.",
    starter_setup: `## Finish initial setup

The starter Policy, Controls, plan, schedule, training, and Obligations are proposals. They do not state that ${companyName} operates the described Controls.

1. Run \`npx filegrc setup\` for guided service and goal setup, or use browser onboarding. Then finish Step 1 by adding the real reviewers and operators, finishing the oversight team, and confirming applicable criteria, commitments, material vendors, and in-scope systems.
2. Tailor the Information Security Policy and have someone other than its owner approve it. Approval accepts the Policy but does not mean the Controls are implemented.
3. Review the starter Control set, combined Security Incident and Recovery Plan, Data Retention Schedule, Security Awareness Training, and proposed Obligations. Implement each applicable Control with its actual procedure, scope, cadence, Components, and authoritative evidence sources. Enable the applicable schedules, review the Policy activation assessment, then activate the Policy at the real implementation cutover.
4. Run \`npx filegrc program-readiness --require-ready\`, record the management candidate period start when reliable evidence collection begins, maintain risk assessments and risks, update controls when needed, use Work Queue for scheduled work, and trigger Policy Events when changes create required actions.
5. Engage a CPA firm, record the separate firm-agreed period in an audit record, review filegrc Evidence and External Evidence, and prepare fieldwork.`
  };
}

function validateCombinedSetup(setup) {
  if (!setup) return;
  if (Array.isArray(setup) || typeof setup !== "object") throw new Error("setup must be a JSON object.");
  const required = ["serviceName", "boundary", "criticality", "classificationId", "internetExposed"];
  const missing = required.filter((name) => setup[name] === undefined || setup[name] === "");
  if (missing.length) throw new Error(`Combined setup is missing: ${missing.join(", ")}.`);
}

async function runCombinedSetup(target, input) {
  const setup = { programGoal: "none", ownerId: "person-program-lead", ...input };
  const args = [
    join(target, "node_modules", "filegrc", "bin", "filegrc.js"),
    "setup",
    "--service-name", String(setup.serviceName),
    "--boundary", String(setup.boundary),
    "--owner", String(setup.ownerId),
    "--criticality", String(setup.criticality),
    "--classification", String(setup.classificationId),
    "--internet-exposed", String(setup.internetExposed),
    "--program-goal", String(setup.programGoal),
    "--summary",
    "--json"
  ];
  if (setup.draft === true) args.push("--draft");
  const result = await run(process.execPath, args, target);
  return JSON.parse(result.stdout);
}

async function writeMinimalLockfile(target, name, versionRange) {
  const lock = {
    name,
    version: "0.11.1",
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": {
        name,
        version: "0.11.1",
        dependencies: { filegrc: versionRange }
      }
    }
  };
  await writeFile(join(target, "package-lock.json"), `${JSON.stringify(lock, null, 2)}\n`, "utf8");
}

async function isInsideGitWorktree(target) {
  try {
    await execute("git", ["rev-parse", "--is-inside-work-tree"], { cwd: target });
    return true;
  } catch {
    return false;
  }
}

async function inspectGitHead(target) {
  try {
    const { stdout } = await execute("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd: target });
    return { branch: stdout.trim() || null, detached: false };
  } catch {
    try {
      await execute("git", ["rev-parse", "--verify", "HEAD"], { cwd: target });
      return { branch: null, detached: true };
    } catch {
      return { branch: null, detached: false };
    }
  }
}

async function run(command, args, cwd) {
  try {
    return await execute(command, args, { cwd, maxBuffer: 10_000_000 });
  } catch (error) {
    const detail = error.stderr?.trim() || error.stdout?.trim() || error.message;
    throw new Error(`${command} ${args.join(" ")} failed: ${detail}`);
  }
}

function cleanVersion(value) {
  const version = String(value ?? "").trim().replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Could not resolve a valid filegrc version from "${value}".`);
  }
  return version;
}

function normalizePackageName(value) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "filegrc-program";
}

function jsonStringContents(value) {
  return JSON.stringify(String(value)).slice(1, -1);
}
