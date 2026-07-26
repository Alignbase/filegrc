import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { getGitSummary, getWorkspaceHistories } from "./git.js";
import { renderMarkdown } from "./markdown.js";
import { planObligations } from "./obligations.js";
import { resolveContentPath } from "./paths.js";
import { currentCalendarDate } from "./time.js";
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
          const source = await readFile(resolveContentPath(loaded.root, record[name]), "utf8");
          content[name] = { source, html: renderMarkdown(source), path: record[name], revision: contentRevision(source) };
        } catch {
          // Validation reports the missing file.
        }
      }
    }
    entries.push({
      record,
      relativePath: `data/${entry.relativePath}`,
      revision: contentRevision(entry.source),
      content,
      history: histories.get(`data/${entry.relativePath}`) ?? []
    });
  }

  const git = getGitSummary(loaded.root);
  delete git.root;
  const workspace = loaded.workspace ?? {
    schemaVersion: 1,
    dataModelVersion: loaded.model.modelVersion,
    id: "workspace",
    type: "workspace",
    title: "FileGRC workspace",
    organizationName: "Workspace configuration unavailable",
    timezone: "UTC"
  };
  const asOf = options.asOf ?? currentCalendarDate(workspace.timezone);
  const generatedAt = new Date().toISOString();
  return {
    generatedAt,
    readOnly: Boolean(options.readOnly),
    workspace,
    model: loaded.model,
    resources: entries,
    validation: {
      ok: validation.ok,
      counts: validation.counts,
      diagnostics: validation.diagnostics
    },
    obligations: planObligations(entries, { asOf, now: options.now ?? generatedAt }),
    git
  };
}

function contentRevision(source) {
  return createHash("sha256").update(source).digest("hex");
}
