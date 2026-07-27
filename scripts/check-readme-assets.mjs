import assert from "node:assert/strict";
import { lstat, readFile } from "node:fs/promises";

const screenshots = ["filegrc-home.png", "filegrc-audit.png"];
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");

for (const screenshot of screenshots) {
  const rootPath = new URL(`../docs/${screenshot}`, import.meta.url);
  const templatePath = new URL(`../packages/create-filegrc/template/docs/${screenshot}`, import.meta.url);
  const rootStat = await lstat(rootPath);

  assert.equal(readme.includes(`](docs/${screenshot})`), true, `README.md must reference docs/${screenshot}`);
  assert.equal(rootStat.isFile(), true, `docs/${screenshot} must be a regular file so GitHub can render it`);
  assert.deepEqual(
    await readFile(rootPath),
    await readFile(templatePath),
    `docs/${screenshot} must match the generated workspace screenshot`
  );
}

console.log("Root README screenshots are regular files and match the generated workspace.");
