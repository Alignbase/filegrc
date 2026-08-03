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
import { serializeWorkspaceMutation } from "./mutation.js";
import { fingerprintWorkspace, validateWorkspace } from "./validate.js";

const renderedMarkdownCache = new Map();
const MAX_RENDERED_MARKDOWN_CACHE_ENTRIES = 1_000;

export async function createAppState(input = process.cwd(), options = {}) {
  return serializeWorkspaceMutation(input, (root) => createAppStateUnlocked(root, options));
}

async function createAppStateUnlocked(input, options) {
  let validation;
  if (options.validationProof) {
    const current = await fingerprintWorkspace(input);
    validation = current.fingerprint === options.validationProof.fingerprint
      ? { ...options.validationProof.validation, loaded: current.loaded }
      : await validateWorkspace(current.loaded);
  } else {
    validation = await validateWorkspace(input);
  }
  const { loaded } = validation;
  const entries = [];
  const includeDetails = options.includeDetails !== false;
  const histories = includeDetails
    ? getWorkspaceHistories(loaded.root, loaded.entries.map((entry) => `data/${entry.relativePath}`), 12)
    : new Map();

  for (const entry of loaded.entries) {
    entries.push(await createStateEntry(loaded, entry, {
      includeDetails,
      history: histories.get(`data/${entry.relativePath}`) ?? []
    }));
  }

  const git = getGitSummary(loaded.root);
  delete git.root;
  const repository = await getBrowserRepositoryState(loaded.root, {
    readOnly: options.readOnly,
    allowNonAuthoritativeWrites: options.allowNonAuthoritativeWrites
  });
  const workspace = loaded.workspace ?? {
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
    asOf,
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
    obligations: planObligations(entries, { asOf, now: options.now ?? generatedAt, model: loaded.model }),
    programReadiness,
    auditPreparations,
    git
  };
}

export async function createResourceDetail(input, type, id) {
  return serializeWorkspaceMutation(input, async (root) => {
    const validation = await validateWorkspace(root);
    const entry = validation.loaded.entries.find(({ record }) => record.type === type && record.id === id);
    if (!entry) return null;
    const relativePath = `data/${entry.relativePath}`;
    const histories = getWorkspaceHistories(validation.loaded.root, [relativePath], 12);
    return createStateEntry(validation.loaded, entry, {
      includeDetails: true,
      history: histories.get(relativePath) ?? []
    });
  });
}

async function createStateEntry(loaded, entry, options) {
  const record = structuredClone(entry.record);
  const content = {};
  if (loaded.model.resources[record.type]) {
    for (const item of markdownEntries(loaded.model, record)) {
      try {
        const path = resolveDataPath(loaded.root, item.path);
        const source = await readFile(path, "utf8");
        content[item.name] = {
          source,
          ...(options.includeDetails ? { html: renderMarkdownCached(source) } : {}),
          path: item.path,
          revision: contentRevision(source)
        };
      } catch {
        // Validation reports missing required Markdown.
      }
    }
  }
  return {
    record,
    relativePath: `data/${entry.relativePath}`,
    revision: contentRevision(entry.source),
    content,
    history: options.includeDetails ? options.history : undefined,
    detailsLoaded: options.includeDetails
  };
}

function renderMarkdownCached(source) {
  const revision = contentRevision(source);
  const cached = renderedMarkdownCache.get(revision);
  if (cached !== undefined) {
    renderedMarkdownCache.delete(revision);
    renderedMarkdownCache.set(revision, cached);
    return cached;
  }
  const html = renderMarkdown(source);
  renderedMarkdownCache.set(revision, html);
  if (renderedMarkdownCache.size > MAX_RENDERED_MARKDOWN_CACHE_ENTRIES) {
    renderedMarkdownCache.delete(renderedMarkdownCache.keys().next().value);
  }
  return html;
}

function contentRevision(source) {
  return createHash("sha256").update(source).digest("hex");
}
