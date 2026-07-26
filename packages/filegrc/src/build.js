import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FAVICON_PNG } from "./favicon.js";
import { resolveWorkspacePath, resolveWorkspaceRoot } from "./paths.js";
import { createAppState } from "./state.js";
import { APP_SCRIPT, APP_STYLES, renderIndex } from "./web.js";

export async function buildWorkspace(input = process.cwd(), options = {}) {
  const root = resolveWorkspaceRoot(input);
  const outputOption = options.output ?? ".filegrc/site";
  const output = resolveWorkspacePath(root, outputOption);
  const paths = {
    html: resolveWorkspacePath(root, join(outputOption, "index.html")),
    favicon: resolveWorkspacePath(root, join(outputOption, "favicon.png")),
    script: resolveWorkspacePath(root, join(outputOption, "filegrc-app.js")),
    styles: resolveWorkspacePath(root, join(outputOption, "filegrc.css"))
  };
  const state = await createAppState(root, { readOnly: true });
  await mkdir(output, { recursive: true });
  await Promise.all([
    writeFile(paths.html, renderIndex(state), "utf8"),
    writeFile(paths.favicon, FAVICON_PNG),
    writeFile(paths.script, APP_SCRIPT, "utf8"),
    writeFile(paths.styles, APP_STYLES, "utf8")
  ]);
  return { output, state };
}
