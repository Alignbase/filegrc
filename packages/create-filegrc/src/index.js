import { execFile } from "node:child_process";
import { cp, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createInterface } from "node:readline/promises";
import { baselineRecordPaths, writeBaselineRecords } from "./defaults.js";

const execute = promisify(execFile);
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const textExtensions = new Set(["", ".json", ".md", ".txt", ".yml", ".yaml", ".gitignore"]);

export async function createFileGRC(options = {}) {
  const parameterConfig = JSON.parse(await readFile(join(packageRoot, "template-parameters.json"), "utf8"));
  const target = resolve(options.target ?? "filegrc-program");
  await assertWritableTarget(target, Boolean(options.force));
  if (options.force) await assertNoTemplateCollisions(target);

  const prompted = await resolvePromptValues(parameterConfig.parameters, options);
  const engineVersion = await resolveFileGRCVersion(options.filegrcVersion);
  const values = {
    ...prompted,
    effective_date: options.effectiveDate ?? new Date().toISOString().slice(0, 10),
    project_name: normalizePackageName(basename(target)),
    filegrc_version: engineVersion,
    filegrc_version_range: `^${engineVersion}`
  };

  await mkdir(target, { recursive: true });
  await copyTemplate(target);
  await renderTemplate(target, parameterConfig, values);
  await writeBaselineRecords(target, values.effective_date);

  const installed = options.install !== false;
  if (installed) {
    await run("npm", ["install", "--ignore-scripts"], target);
  } else {
    await writeMinimalLockfile(target, values.project_name, values.filegrc_version_range);
  }
  const joinedExistingWorktree = await isInsideGitWorktree(target);
  if (!joinedExistingWorktree) await run("git", ["init"], target);
  return {
    target,
    values,
    engineVersion,
    install: installed ? "installed" : "skipped",
    gitMode: joinedExistingWorktree ? "existing-worktree" : "initialized"
  };
}

export async function resolveFileGRCVersion(explicitVersion) {
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

async function resolvePromptValues(parameters, options) {
  const mapped = {
    company_name: options.companyName,
    policy_owner_name: options.policyOwnerName,
    security_contact_email: options.securityContactEmail
  };
  if (options.yes) {
    mapped.company_name ??= "Example Company";
    mapped.policy_owner_name ??= "Security Owner";
    mapped.security_contact_email ??= "security@example.com";
  }
  for (const key of Object.keys(mapped)) {
    if (mapped[key] !== undefined && mapped[key] !== null) mapped[key] = String(mapped[key]).trim();
  }
  const missing = parameters.filter(({ key, required }) => required && !mapped[key]);
  if (missing.length) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error(`Missing required values: ${missing.map(({ key }) => key).join(", ")}`);
    }
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try {
      for (const parameter of missing) {
        let value = "";
        while (!value) value = (await prompt.question(`${parameter.prompt}: `)).trim();
        mapped[parameter.key] = value;
      }
    } finally {
      prompt.close();
    }
  }
  for (const key of ["company_name", "policy_owner_name"]) {
    if (/[\u0000-\u001f\u007f]/.test(mapped[key])) {
      throw new Error(`${key} must be a single line without control characters.`);
    }
    if (mapped[key].length > 200) throw new Error(`${key} must be 200 characters or fewer.`);
    if (/\{\{[a-z0-9_]+\}\}/.test(mapped[key])) {
      throw new Error(`${key} cannot contain template token syntax.`);
    }
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mapped.security_contact_email)) {
    throw new Error("Security contact email must be a valid email address.");
  }
  return mapped;
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

async function assertNoTemplateCollisions(target) {
  const collisions = [];
  for (const destinationPath of [...await templateDestinationPaths(), ...baselineRecordPaths()]) {
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

async function renderTemplate(target, parameterConfig, values) {
  const declared = new Set([
    ...parameterConfig.parameters.map(({ key }) => key),
    ...parameterConfig.generated.map(({ key }) => key)
  ]);
  const files = (await templateDestinationPaths()).map((path) => join(target, path));
  for (const path of files) {
    if (!textExtensions.has(extname(path)) && basename(path) !== ".gitignore") continue;
    let source = await readFile(path, "utf8");
    const jsonFile = extname(path) === ".json";
    source = source.replace(/\{\{([a-z0-9_]+)\}\}/g, (match, token) => {
      if (!declared.has(token)) throw new Error(`Unknown template token "{{${token}}}" in ${path}`);
      if (values[token] === undefined) throw new Error(`No value resolved for template token "{{${token}}}"`);
      return jsonFile ? jsonStringContents(values[token]) : String(values[token]);
    });
    const unresolved = /\{\{([a-z0-9_]+)\}\}/.exec(source);
    if (unresolved) throw new Error(`Unresolved template token "{{${unresolved[1]}}}" in ${path}`);
    await writeFile(path, source, "utf8");
  }
}

async function templateDestinationPaths() {
  const template = join(packageRoot, "template");
  return (await collectFiles(template)).flatMap((source) => {
    const templatePath = relative(template, source);
    if (templatePath === "README.md") return [];
    if (templatePath === "WORKSPACE.md") return ["README.md"];
    return [templatePath === "gitignore" ? ".gitignore" : templatePath];
  });
}

async function copyTemplate(target) {
  const template = join(packageRoot, "template");
  for (const source of await collectFiles(template)) {
    const templatePath = relative(template, source);
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

async function collectFiles(directory) {
  const result = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) result.push(...await collectFiles(path));
    else if (item.isFile()) result.push(path);
  }
  return result;
}

async function writeMinimalLockfile(target, name, versionRange) {
  const lock = {
    name,
    version: "0.1.0",
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": {
        name,
        version: "0.1.0",
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
    throw new Error(`Could not resolve a valid FileGRC version from "${value}".`);
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
