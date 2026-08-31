import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { assessAuditPreparation } from "./audit-preparation.js";
import { assessCollectionReviews } from "./collection-review.js";
import { getBrowserRepositoryState, getRepositorySnapshot, getWorkspaceHistories } from "./git.js";
import { renderMarkdown } from "./markdown.js";
import { planObligations } from "./obligations.js";
import { planReconciliation } from "./reconciliation.js";
import { resolveDataPath, resolveWorkspaceRoot } from "./paths.js";
import { assessProgramReadiness } from "./program-readiness.js";
import { markdownEntries } from "./resource-markdown.js";
import { resolveProgram } from "./program.js";
import { currentCalendarDate } from "./time.js";
import { serializeWorkspaceMutation } from "./mutation.js";
import { fingerprintWorkspace, validateWorkspace } from "./validate.js";
import { assessWorkflow } from "./workflow.js";
import { measureTiming } from "./timing.js";
import { soc2RequirementApplicabilityConstraint } from "./soc2.js";
import { modelSupports } from "../model/index.js";

const renderedMarkdownCache = new Map();
const MAX_RENDERED_MARKDOWN_CACHE_ENTRIES = 1_000;
const appStatePromises = new Map();

export async function createAppState(input = process.cwd(), options = {}) {
  const key = JSON.stringify([
    resolveWorkspaceRoot(input),
    options.readOnly === true,
    options.allowNonAuthoritativeWrites === true,
    options.includeDetails !== false,
    options.asOf ?? null,
    options.now ?? null,
    options.programId ?? null
  ]);
  if (!options.validationProof && appStatePromises.has(key)) return appStatePromises.get(key);
  const promise = serializeWorkspaceMutation(input, (root) => createAppStateUnlocked(root, options)).finally(() => {
    if (appStatePromises.get(key) === promise) appStatePromises.delete(key);
  });
  if (!options.validationProof) appStatePromises.set(key, promise);
  return promise;
}

export async function createAppBootstrap(input = process.cwd(), options = {}) {
  const loaded = input?.entries && input?.root ? input : await loadWorkspace(input);
  const workspace = loaded.workspace ?? {
    dataModelVersion: loaded.model.modelVersion,
    id: "workspace",
    type: "workspace",
    title: "filegrc workspace",
    organizationName: "Workspace configuration unavailable",
    timezone: "UTC"
  };
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const programs = loaded.resources.filter((record) => record.type === "program" && record.status !== "retired");
  const selectedProgram = options.programId
    ? resolveProgram(loaded, options.programId)
    : programs[0] || null;
  return {
    generatedAt,
    asOf: options.asOf ?? currentCalendarDate(workspace.timezone),
    readOnly: true,
    repository: {
      loading: true,
      mode: null,
      status: "loading",
      label: "Checking Git",
      writesAllowed: false
    },
    workspace,
    selectedProgramId: selectedProgram?.id || null,
    model: loaded.model,
    resources: loaded.entries.map((entry) => ({
      record: structuredClone(entry.record),
      relativePath: `data/${entry.relativePath}`,
      revision: contentRevision(entry.source),
      content: {},
      history: undefined,
      detailsLoaded: false
    })),
    validation: {
      loading: true,
      ok: null,
      counts: { errors: 0, warnings: 0 },
      diagnostics: []
    },
    reconciliation: { contractVersion: 1, gitRevision: null, changedPaths: [], candidates: [] },
    obligations: { loading: true, items: [], triggers: [], counts: {} },
    collectionReviews: {},
    applicabilityConstraints: {},
    programReadiness: null,
    auditPreparations: {},
    workflow: { loading: true, findings: [], workItems: [], assessments: {} },
    git: {
      loading: true,
      available: false,
      clean: null,
      changes: [],
      branch: null,
      shortCommit: "checking"
    },
    sections: {
      repository: "loading",
      program: "idle",
      obligations: "idle",
      audits: "idle",
      workflow: "idle"
    }
  };
}

export async function createAppStateSection(input, section, options = {}) {
  const loaded = input?.entries && input?.root ? input : await loadWorkspace(input);
  const workspace = loaded.workspace;
  const asOf = options.asOf ?? currentCalendarDate(workspace?.timezone || "UTC");
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  if (section === "repository") {
    const [validation, snapshot] = await Promise.all([
      validateWorkspace(loaded),
      measureTiming("state-repository-snapshot", () => getRepositorySnapshot(loaded.root))
    ]);
    const reconciliation = validation.reconciliation
      ?? await measureTiming("state-reconciliation", () => planReconciliation(loaded));
    const git = { ...snapshot };
    delete git.root;
    const repository = await measureTiming("state-repository", () => getBrowserRepositoryState(loaded, {
      readOnly: options.readOnly,
      allowNonAuthoritativeWrites: options.allowNonAuthoritativeWrites,
      repositorySnapshot: git
    }));
    return {
      generatedAt,
      readOnly: Boolean(options.readOnly || (repository.mode === "trunk" && !repository.writesAllowed)),
      repository,
      git,
      reconciliation,
      validation: {
        ok: validation.ok,
        counts: validation.counts,
        diagnostics: validation.diagnostics
      }
    };
  }
  if (section === "program") {
    const programReadiness = options.programReadiness ?? await assessProgramReadiness(loaded, { programId: options.programId, asOf, generatedAt });
    const activeProgram = resolveProgram(loaded, options.programId);
    return {
      generatedAt,
      asOf,
      programReadiness,
      collectionReviews: Object.fromEntries(
        assessCollectionReviews(loaded, { programId: activeProgram.id }).map((assessment) => [
          assessment.resourceType,
          {
            resourceType: assessment.resourceType,
            configuration: assessment.configuration,
            recordCount: assessment.recordCount,
            review: assessment.review,
            reviewRevision: assessment.reviewRevision,
            collectionRevision: assessment.collectionRevision,
            status: assessment.status,
            complete: assessment.complete,
            message: assessment.message
          }
        ])
      ),
      applicabilityConstraints: Object.fromEntries(loaded.resources.flatMap((record) => {
        const constraint = soc2RequirementApplicabilityConstraint(record, activeProgram, loaded.model.modelVersion);
        return constraint ? [[record.id, constraint]] : [];
      }))
    };
  }
  if (section === "obligations") {
    const activeProgram = resolveProgram(loaded, options.programId);
    return {
      generatedAt,
      asOf,
      obligations: planObligations(loaded.resources, {
        programId: activeProgram.id,
        asOf,
        now: options.now ?? generatedAt,
        model: loaded.model
      })
    };
  }
  if (section === "audits") {
    const programReadiness = options.programReadiness;
    const activeProgram = resolveProgram(loaded, options.programId);
    const audits = loaded.resources.filter((record) => (
      record.type === "audit"
      && (!modelSupports(loaded.model, "program-scope") || record.programId === activeProgram.id)
    ));
    return {
      generatedAt,
      asOf,
      auditPreparations: Object.fromEntries(await Promise.all(
        (audits.length ? audits : [null]).map(async (audit) => [
          audit?.id || "none",
          await assessAuditPreparation(loaded, {
            auditId: audit?.id,
            programId: audit?.programId || options.programId,
            asOf,
            generatedAt,
            ...(audit || !programReadiness ? {} : { programReadiness })
          })
        ])
      ))
    };
  }
  if (section === "workflow") {
    return {
      generatedAt,
      asOf,
      workflow: await assessWorkflow(loaded, {
        programId: options.programId,
        asOf,
        evaluatedAt: generatedAt,
        programReadiness: options.programReadiness,
        auditPreparations: options.auditPreparations,
        obligations: options.obligations,
        git: options.git,
        validation: options.validation,
        strictHistory: options.strictHistory
      })
    };
  }
  throw new Error(`Unknown app-state section "${section}".`);
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

  await measureTiming("state-entries", async () => {
    for (const entry of loaded.entries) {
      entries.push(await createStateEntry(loaded, entry, {
        includeDetails,
        history: histories.get(`data/${entry.relativePath}`) ?? []
      }));
    }
  });

  const git = { ...await measureTiming("state-repository-snapshot", () => getRepositorySnapshot(loaded.root)) };
  delete git.root;
  const repository = await measureTiming("state-repository", () => getBrowserRepositoryState(loaded, {
    readOnly: options.readOnly,
    allowNonAuthoritativeWrites: options.allowNonAuthoritativeWrites,
    repositorySnapshot: git
  }));
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
  const programReadiness = await measureTiming("state-program-readiness", () => assessProgramReadiness(loaded, {
    programId: options.programId,
    asOf,
    generatedAt
  }));
  const activeProgram = resolveProgram(loaded, options.programId);
  const applicabilityConstraints = Object.fromEntries(loaded.resources.flatMap((record) => {
    const constraint = soc2RequirementApplicabilityConstraint(record, activeProgram, loaded.model.modelVersion);
    return constraint ? [[record.id, constraint]] : [];
  }));
  const audits = loaded.resources.filter((record) => (
    record.type === "audit"
    && (!modelSupports(loaded.model, "program-scope") || record.programId === activeProgram.id)
  ));
  const auditPreparations = await measureTiming("state-audit-preparation", async () => Object.fromEntries(await Promise.all(
    (audits.length ? audits : [null]).map(async (audit) => {
      const preparation = await assessAuditPreparation(loaded, {
        auditId: audit?.id,
        asOf,
        generatedAt,
        ...(audit ? {} : { programReadiness })
      });
      return [audit?.id || "none", preparation];
    })
  )));
  const obligations = planObligations(entries, {
    programId: activeProgram.id,
    asOf,
    now: options.now ?? generatedAt,
    model: loaded.model
  });
  const reconciliation = validation.reconciliation
    ?? await measureTiming("state-reconciliation", () => planReconciliation(loaded));
  const workflow = await measureTiming("state-workflow", () => assessWorkflow(loaded, {
    programId: activeProgram.id,
    asOf,
    evaluatedAt: generatedAt,
    programReadiness,
    auditPreparations: Object.fromEntries(
      Object.entries(auditPreparations).filter(([id]) => id !== "none")
    ),
    obligations,
    reconciliation,
    git,
    validation
  }));
  const collectionReviews = Object.fromEntries(
    assessCollectionReviews(loaded, { programId: activeProgram.id }).map((assessment) => [
      assessment.resourceType,
      {
        resourceType: assessment.resourceType,
        configuration: assessment.configuration,
        recordCount: assessment.recordCount,
        review: assessment.review,
        reviewRevision: assessment.reviewRevision,
        collectionRevision: assessment.collectionRevision,
        status: assessment.status,
        complete: assessment.complete,
        message: assessment.message
      }
    ])
  );
  return {
    generatedAt,
    asOf,
    readOnly: Boolean(options.readOnly || (repository.mode === "trunk" && !repository.writesAllowed)),
    repository,
    workspace,
    selectedProgramId: activeProgram.id,
    model: loaded.model,
    resources: entries,
    validation: {
      ok: validation.ok,
      counts: validation.counts,
      diagnostics: validation.diagnostics
    },
    obligations,
    reconciliation,
    collectionReviews,
    applicabilityConstraints,
    programReadiness,
    auditPreparations,
    workflow,
    git
  };
}

export async function createResourceDetail(input, type, id, options = {}) {
  if (input?.entries && input?.root) return createResourceDetailFromLoaded(input, type, id, options);
  return serializeWorkspaceMutation(input, async (root) => {
    const validation = await validateWorkspace(root);
    return createResourceDetailFromLoaded(validation.loaded, type, id, options);
  });
}

async function createResourceDetailFromLoaded(loaded, type, id, options) {
  const entry = loaded.entries.find(({ record }) => record.type === type && record.id === id);
  if (!entry) return null;
  const relativePath = `data/${entry.relativePath}`;
  const includeHistory = options.includeHistory !== false;
  const histories = includeHistory
    ? getWorkspaceHistories(loaded.root, [relativePath], 12, {
        deadlineAt: options.historyDeadlineAt
      })
    : new Map();
  return createStateEntry(loaded, entry, {
    includeDetails: true,
    includeHistory,
    history: includeHistory ? histories.get(relativePath) ?? [] : undefined
  });
}

export async function createResourceHistory(input, type, id, options = {}) {
  if (input?.entries && input?.root) return createResourceHistoryFromLoaded(input, type, id, options);
  return serializeWorkspaceMutation(input, async (root) => {
    const validation = await validateWorkspace(root);
    return createResourceHistoryFromLoaded(validation.loaded, type, id, options);
  });
}

function createResourceHistoryFromLoaded(loaded, type, id, options) {
  const entry = loaded.entries.find(({ record }) => record.type === type && record.id === id);
  if (!entry) return null;
  const relativePath = `data/${entry.relativePath}`;
  return {
    history: getWorkspaceHistories(loaded.root, [relativePath], 12, {
      deadlineAt: options.historyDeadlineAt
    }).get(relativePath) ?? [],
    historyLoaded: true
  };
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
    history: options.includeDetails && options.includeHistory !== false ? options.history : undefined,
    historyLoaded: options.includeDetails ? options.includeHistory !== false : false,
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
