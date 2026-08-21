import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { format } from "node:util";

export async function makeWorkspace(root) {
  await mkdir(join(root, "data", "people"), { recursive: true });
  await writeJson(join(root, "data", "workspace.json"), {
    dataModelVersion: "2",
    id: "workspace",
    type: "workspace",
    title: "Test SOC 2 Program",
    organizationName: "Test Organization",
    timezone: "UTC",
    classificationDefinitions: {
      public: "Approved for public release.",
      internal: "Internal business information.",
      confidential: "Sensitive business or customer information.",
      restricted: "Highly sensitive information."
    }
  });
  await writeJson(join(root, "data", "people", "person-owner.json"), {
    id: "person-owner",
    type: "person",
    title: "Program Owner",
    status: "active",
    affiliation: "internal",
    email: "security@example.com",
    jobTitle: "Chief Executive Officer"
  });
  await writeJson(join(root, "data", "people", "person-approver.json"), {
    id: "person-approver",
    type: "person",
    title: "Internal Reviewer",
    status: "active",
    affiliation: "internal",
    email: "approver@example.com",
    jobTitle: "Chief Operating Officer"
  });
}

export async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function captureCli(runCli, argv) {
  const stdout = [];
  const stderr = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalExitCode = process.exitCode;
  process.exitCode = undefined;
  console.log = (...args) => stdout.push(format(...args));
  console.error = (...args) => stderr.push(format(...args));
  try {
    const result = await runCli(argv);
    return {
      result,
      stdout: stdout.length ? `${stdout.join("\n")}\n` : "",
      stderr: stderr.length ? `${stderr.join("\n")}\n` : "",
      exitCode: process.exitCode ?? 0
    };
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.exitCode = originalExitCode;
  }
}

export async function executeCli(runCli, executable, args, options = {}) {
  if (
    executable !== process.execPath
    || basename(args[0] || "") !== "filegrc.js"
    || basename(dirname(args[0] || "")) !== "bin"
  ) {
    throw new Error("In-process FileGRC CLI tests must dispatch the filegrc binary through the current Node executable.");
  }
  const argv = args.slice(1);
  if (options.cwd && !argv.includes("--root")) argv.push("--root", options.cwd);
  const captured = await captureCli(runCli, argv);
  if (captured.exitCode) {
    const error = new Error(captured.stderr || captured.stdout || `FileGRC CLI exited with code ${captured.exitCode}.`);
    error.code = captured.exitCode;
    error.stdout = captured.stdout;
    error.stderr = captured.stderr;
    throw error;
  }
  return captured;
}
