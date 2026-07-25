import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateWorkspace } from "../../soc2/src/index.js";
import { createSoc2 } from "../src/index.js";

test("creates a complete generic repository with one dependency", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "create-soc2-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(parent, { recursive: true, force: true })));
  const target = join(parent, "security-program");
  const result = await createSoc2({
    target,
    companyName: "Example \"Engineering\"",
    policyOwnerName: "Example Owner",
    securityContactEmail: "security@example.test",
    soc2Version: "1.2.3",
    install: false,
    effectiveDate: "2026-07-25"
  });
  assert.equal(result.engineVersion, "1.2.3");
  const packageJson = JSON.parse(await readFile(join(target, "package.json"), "utf8"));
  assert.deepEqual(packageJson.dependencies, { soc2: "^1.2.3" });
  assert.equal(packageJson.private, true);
  assert.equal((await readFile(join(target, "README.md"), "utf8")).includes("{{"), false);
  const workspace = JSON.parse(await readFile(join(target, "data", "workspace.json"), "utf8"));
  assert.equal(workspace.organizationName, "Example \"Engineering\"");
  await access(join(target, "package-lock.json"));
  await access(join(target, ".gitignore"));
  await access(join(target, ".git"));
  const validation = await validateWorkspace(target);
  assert.deepEqual(validation.counts, { resources: 15, errors: 0, warnings: 0 });
});

test("refuses a non-empty target by default", async (context) => {
  const target = await mkdtemp(join(tmpdir(), "create-soc2-nonempty-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(target, { recursive: true, force: true })));
  await writeFile(join(target, "keep.txt"), "keep", "utf8");
  await assert.rejects(createSoc2({
    target,
    yes: true,
    soc2Version: "1.2.3",
    install: false
  }), /not empty/);
});
