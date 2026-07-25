import { execFile } from "node:child_process";
import { cp, lstat, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createInterface } from "node:readline/promises";

const execute = promisify(execFile);
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const textExtensions = new Set(["", ".json", ".md", ".txt", ".yml", ".yaml", ".gitignore"]);

export async function createSoc2(options = {}) {
  const parameterConfig = JSON.parse(await readFile(join(packageRoot, "template-parameters.json"), "utf8"));
  const target = resolve(options.target ?? "soc2-program");
  await assertWritableTarget(target, Boolean(options.force));
  if (options.force) await assertNoTemplateCollisions(target);

  const prompted = await resolvePromptValues(parameterConfig.parameters, options);
  const engineVersion = await resolveSoc2Version(options.soc2Version);
  const values = {
    ...prompted,
    effective_date: options.effectiveDate ?? new Date().toISOString().slice(0, 10),
    project_name: normalizePackageName(basename(target)),
    soc2_version_range: `^${engineVersion}`
  };

  await mkdir(target, { recursive: true });
  await cp(join(packageRoot, "template"), target, {
    recursive: true,
    force: false,
    errorOnExist: true,
    preserveTimestamps: false
  });
  await rename(join(target, "gitignore"), join(target, ".gitignore"));
  await renderTemplate(target, parameterConfig, values);

  if (options.install !== false) {
    await run("npm", ["install", "--ignore-scripts"], target);
  } else {
    await writeMinimalLockfile(target, values.project_name, values.soc2_version_range);
  }
  if (!await isInsideGitWorktree(target)) await run("git", ["init"], target);
  return { target, values, engineVersion };
}

export async function resolveSoc2Version(explicitVersion) {
  if (explicitVersion) return cleanVersion(explicitVersion);
  try {
    const { stdout } = await execute("npm", ["view", "soc2", "version", "--json"], {
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
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mapped.security_contact_email)) {
    throw new Error("Security contact email must be a valid email address.");
  }
  return mapped;
}

async function assertWritableTarget(target, force) {
  try {
    const items = await readdir(target);
    if (items.length && !force) {
      throw new Error(`Target directory is not empty: ${target}. Pass --force to add files without overwriting existing paths.`);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function assertNoTemplateCollisions(target) {
  const template = join(packageRoot, "template");
  const collisions = [];
  for (const source of await collectFiles(template)) {
    const templatePath = relative(template, source);
    const destinationPath = templatePath === "gitignore" ? ".gitignore" : templatePath;
    try {
      await lstat(join(target, destinationPath));
      collisions.push(destinationPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (collisions.length) {
    throw new Error(`Target contains files create-soc2 would overwrite: ${collisions.slice(0, 5).join(", ")}.`);
  }
}

async function renderTemplate(target, parameterConfig, values) {
  const declared = new Set([
    ...parameterConfig.parameters.map(({ key }) => key),
    ...parameterConfig.generated.map(({ key }) => key)
  ]);
  const files = await collectFiles(target);
  for (const path of files) {
    if (!textExtensions.has(extname(path)) && basename(path) !== ".gitignore") continue;
    let source = await readFile(path, "utf8");
    const jsonFile = extname(path) === ".json";
    const tokens = [...source.matchAll(/\{\{([a-z0-9_]+)\}\}/g)].map((match) => match[1]);
    for (const token of tokens) {
      if (!declared.has(token)) throw new Error(`Unknown template token "{{${token}}}" in ${path}`);
      if (values[token] === undefined) throw new Error(`No value resolved for template token "{{${token}}}"`);
      const replacement = jsonFile ? jsonStringContents(values[token]) : String(values[token]);
      source = source.replaceAll(`{{${token}}}`, replacement);
    }
    const unresolved = /\{\{([a-z0-9_]+)\}\}/.exec(source);
    if (unresolved) throw new Error(`Unresolved template token "{{${unresolved[1]}}}" in ${path}`);
    await writeFile(path, source, "utf8");
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
        dependencies: { soc2: versionRange }
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
    throw new Error(`Could not resolve a valid soc2 version from "${value}".`);
  }
  return version;
}

function normalizePackageName(value) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "soc2-program";
}

function jsonStringContents(value) {
  return JSON.stringify(String(value)).slice(1, -1);
}
