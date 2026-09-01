import { execFile, spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  appendFile,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readlink,
  readdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { format, promisify } from "node:util";

const execute = promisify(execFile);

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
      restricted: "Highly sensitive information.",
    },
  });
  await writeJson(join(root, "data", "people", "person-owner.json"), {
    id: "person-owner",
    type: "person",
    title: "Program Owner",
    status: "active",
    affiliation: "internal",
    email: "security@example.com",
    jobTitle: "Chief Executive Officer",
  });
  await writeJson(join(root, "data", "people", "person-approver.json"), {
    id: "person-approver",
    type: "person",
    title: "Internal Reviewer",
    status: "active",
    affiliation: "internal",
    email: "approver@example.com",
    jobTitle: "Chief Operating Officer",
  });
}

export async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function cloneFixture(source, target) {
  await mkdir(target, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const sourcePath = join(source, entry.name);
      const targetPath = join(target, entry.name);
      if (entry.isDirectory()) return cloneFixture(sourcePath, targetPath);
      if (entry.isSymbolicLink())
        return symlink(await readlink(sourcePath), targetPath);
      if (entry.isFile())
        return copyFile(sourcePath, targetPath, constants.COPYFILE_FICLONE);
      const details = await lstat(sourcePath);
      throw new Error(
        `Cannot clone fixture entry ${relative(source, sourcePath)} (${details.mode}).`,
      );
    }),
  );
}

export async function initializeGitWorkspace(
  root,
  { message = "Create test workspace" } = {},
) {
  await execute("git", ["init", "--initial-branch=main"], { cwd: root });
  await appendFile(
    join(root, ".git", "config"),
    [
      "[user]",
      "\tname = FileGRC Tests",
      "\temail = tests@filegrc.dev",
      "[commit]",
      "\tgpgSign = false",
      "",
    ].join("\n"),
  );
  await commitWorkspaceFiles(root, message);
}

export async function commitWorkspaceFiles(root, message) {
  await execute("git", ["add", "."], { cwd: root });
  await execute(
    "git",
    ["-c", "commit.gpgSign=false", "commit", "--quiet", "-m", message],
    { cwd: root },
  );
}

export async function createGitHistory(root, commits) {
  if (!Array.isArray(commits) || !commits.length)
    throw new Error("Git history fixtures require at least one commit.");
  await execute("git", ["init", "--initial-branch=main"], { cwd: root });
  await appendFile(
    join(root, ".git", "config"),
    [
      "[user]",
      "\tname = FileGRC Tests",
      "\temail = tests@filegrc.dev",
      "[commit]",
      "\tgpgSign = false",
      "",
    ].join("\n"),
  );
  const initialFiles = await fixtureFiles(root);
  const chunks = [];
  for (const [index, commit] of commits.entries()) {
    const mark = index + 1;
    const timestamp = 1_767_225_600 + index;
    appendText(chunks, "commit refs/heads/main\n");
    appendText(chunks, `mark :${mark}\n`);
    appendText(
      chunks,
      `author FileGRC Tests <tests@filegrc.dev> ${timestamp} +0000\n`,
    );
    appendText(
      chunks,
      `committer FileGRC Tests <tests@filegrc.dev> ${timestamp} +0000\n`,
    );
    appendData(chunks, Buffer.from(commit.message || `Fixture commit ${mark}`));
    if (index > 0) appendText(chunks, `from :${index}\n`);
    if (index === 0) {
      appendText(chunks, "deleteall\n");
      for (const [path, content] of initialFiles)
        appendFileCommand(chunks, path, content);
    }
    for (const [path, content] of Object.entries(commit.changes || {})) {
      if (content === null)
        appendText(chunks, `D ${quoteFastImportPath(path)}\n`);
      else
        appendFileCommand(
          chunks,
          path,
          Buffer.isBuffer(content) ? content : Buffer.from(String(content)),
        );
    }
    appendText(chunks, "\n");
  }
  appendText(chunks, "done\n");
  await runGitWithInput(
    root,
    ["fast-import", "--quiet"],
    Buffer.concat(chunks),
  );
  await execute("git", ["reset", "--hard", "main"], { cwd: root });
}

async function fixtureFiles(root, directory = root) {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (directory === root && entry.name === ".git") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await fixtureFiles(root, path)));
    else if (entry.isFile())
      files.push([
        relative(root, path).split("\\").join("/"),
        await readFile(path),
      ]);
  }
  return files;
}

function appendFileCommand(chunks, path, content) {
  appendText(chunks, `M 100644 inline ${quoteFastImportPath(path)}\n`);
  appendData(chunks, content);
}

function appendData(chunks, content) {
  appendText(chunks, `data ${content.length}\n`);
  chunks.push(content, Buffer.from("\n"));
}

function appendText(chunks, text) {
  chunks.push(Buffer.from(text));
}

function quoteFastImportPath(path) {
  if (!path || path.includes("\0") || path.includes("\n"))
    throw new Error(`Invalid Git fixture path: ${path}`);
  return JSON.stringify(path);
}

function runGitWithInput(cwd, args, input) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn("git", args, {
      cwd,
      stdio: ["pipe", "ignore", "pipe"],
    });
    const stderr = [];
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", rejectRun);
    child.once("close", (code) => {
      if (code === 0) resolveRun();
      else
        rejectRun(
          new Error(
            Buffer.concat(stderr).toString("utf8").trim() ||
              `Git exited with status ${code}.`,
          ),
        );
    });
    child.stdin.end(input);
  });
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
      exitCode: process.exitCode ?? 0,
    };
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.exitCode = originalExitCode;
  }
}

export async function executeCli(runCli, executable, args, options = {}) {
  if (
    executable !== process.execPath ||
    basename(args[0] || "") !== "filegrc.js" ||
    basename(dirname(args[0] || "")) !== "bin"
  ) {
    throw new Error(
      "In-process FileGRC CLI tests must dispatch the filegrc binary through the current Node executable.",
    );
  }
  const argv = args.slice(1);
  if (options.cwd && !argv.includes("--root")) argv.push("--root", options.cwd);
  const captured = await captureCli(runCli, argv);
  if (captured.exitCode) {
    const error = new Error(
      captured.stderr ||
        captured.stdout ||
        `FileGRC CLI exited with code ${captured.exitCode}.`,
    );
    error.code = captured.exitCode;
    error.stdout = captured.stdout;
    error.stderr = captured.stderr;
    throw error;
  }
  return captured;
}
