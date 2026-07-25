import { readFile } from "node:fs/promises";
import { getGitSummary, getWorkspaceHistories } from "./git.js";
import { renderMarkdown } from "./markdown.js";
import { resolveDataPath } from "./paths.js";
import { validateWorkspace } from "./validate.js";

export async function createAppState(input = process.cwd(), options = {}) {
  const validation = await validateWorkspace(input);
  const { loaded } = validation;
  const entries = [];
  const relativePaths = loaded.entries.map((entry) => `data/${entry.relativePath}`);
  const histories = getWorkspaceHistories(loaded.root, relativePaths, 12);

  for (const entry of loaded.entries) {
    const record = structuredClone(entry.record);
    const definition = loaded.model.resources[record.type];
    const content = {};
    if (definition) {
      const fields = { ...loaded.model.commonFields, ...definition.fields };
      for (const [name, field] of Object.entries(fields)) {
        if (!field.content || typeof record[name] !== "string") continue;
        try {
          const source = await readFile(resolveDataPath(loaded.root, record[name]), "utf8");
          content[name] = { source, html: renderMarkdown(source), path: record[name] };
        } catch {
          // Validation reports the missing file.
        }
      }
    }
    entries.push({
      record,
      relativePath: `data/${entry.relativePath}`,
      content,
      history: histories.get(`data/${entry.relativePath}`) ?? []
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    readOnly: Boolean(options.readOnly),
    workspace: loaded.workspace,
    model: loaded.model,
    resources: entries,
    validation: {
      ok: validation.ok,
      counts: validation.counts,
      diagnostics: validation.diagnostics
    },
    git: getGitSummary(loaded.root)
  };
}
