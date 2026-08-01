import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { assessAuditPreparation } from "./audit-preparation.js";
import { getBrowserRepositoryState, getGitSummary, getWorkspaceHistories } from "./git.js";
import { renderMarkdown } from "./markdown.js";
import { planObligations } from "./obligations.js";
import { resolveDataPath } from "./paths.js";
import { assessProgramReadiness } from "./program-readiness.js";
import { markdownEntries } from "./resource-markdown.js";
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
    const content = {};
    if (loaded.model.resources[record.type]) {
      for (const item of markdownEntries(loaded.model, record)) {
        try {
          const path = resolveDataPath(loaded.root, item.path);
          const source = await readFile(path, "utf8");
          content[item.name] = { source, html: renderMarkdown(source), path: item.path, revision: contentRevision(source) };
        } catch {
          // Validation reports missing required Markdown.
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
  const repository = await getBrowserRepositoryState(loaded.root, {
    readOnly: options.readOnly,
    allowNonAuthoritativeWrites: options.allowNonAuthoritativeWrites
  });
  const workspace = loaded.workspace ?? {
    schemaVersion: 1,
    dataModelVersion: loaded.model.modelVersion,
    id: "workspace",
    type: "workspace",
    title: "filegrc workspace",
    organizationName: "Workspace configuration unavailable",
    timezone: "UTC"
  };
  const asOf = options.asOf ?? currentCalendarDate(workspace.timezone);
  const generatedAt = new Date().toISOString();
  const programReadiness = await assessProgramReadiness(loaded, {
    asOf,
    generatedAt
  });
  const audits = loaded.resources.filter((record) => record.type === "audit");
  const auditPreparations = Object.fromEntries(await Promise.all(
    (audits.length ? audits : [null]).map(async (audit) => {
      const preparation = await assessAuditPreparation(loaded, {
        auditId: audit?.id,
        generatedAt,
        programReadiness
      });
      return [audit?.id || "none", preparation];
    })
  ));
  return {
    generatedAt,
    readOnly: Boolean(options.readOnly || (repository.mode === "trunk" && !repository.writesAllowed)),
    repository,
    workspace,
    model: loaded.model,
    resources: entries,
    validation: {
      ok: validation.ok,
      counts: validation.counts,
      diagnostics: validation.diagnostics
    },
    obligations: planObligations(entries, { asOf, now: options.now ?? generatedAt }),
    programReadiness,
    auditPreparations,
    git
  };
}

function contentRevision(source) {
  return createHash("sha256").update(source).digest("hex");
}
