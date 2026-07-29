import assert from "node:assert/strict";
import { lstat, readFile } from "node:fs/promises";

const screenshots = ["filegrc-social-preview.png", "filegrc-home.png", "filegrc-audit.png"];
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

assert.deepEqual(
  await readFile(new URL("../docs/filegrc-social-preview.png", import.meta.url)),
  await readFile(new URL("../site/public/og-image.png", import.meta.url)),
  "The root README social preview must match the site Open Graph image"
);

assert.deepEqual(
  await readFile(new URL("../site/public/favicon.png", import.meta.url)),
  await readFile(new URL("../packages/filegrc/src/favicon.png", import.meta.url)),
  "The marketing site and FileGRC engine must use the same favicon"
);

assert.deepEqual(
  await readFile(new URL("../site/public/logo-mark-white.png", import.meta.url)),
  await readFile(new URL("../packages/filegrc/src/logo-mark-white.png", import.meta.url)),
  "The marketing site and FileGRC engine must use the same transparent logo mark"
);

console.log("Root README images and FileGRC logo assets match.");
