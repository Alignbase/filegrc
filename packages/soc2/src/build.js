import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { resolveWorkspaceRoot } from "./paths.js";
import { createAppState } from "./state.js";
import { APP_SCRIPT, APP_STYLES, renderIndex } from "./web.js";

export async function buildWorkspace(input = process.cwd(), options = {}) {
  const root = resolveWorkspaceRoot(input);
  const output = isAbsolute(options.output ?? "") ? options.output : resolve(root, options.output ?? ".soc2/site");
  const state = await createAppState(root, { readOnly: true });
  await mkdir(output, { recursive: true });
  await Promise.all([
    writeFile(join(output, "index.html"), renderIndex(state), "utf8"),
    writeFile(join(output, "soc2-app.js"), APP_SCRIPT, "utf8"),
    writeFile(join(output, "soc2.css"), APP_STYLES, "utf8")
  ]);
  return { output, state };
}
