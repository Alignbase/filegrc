import { createServer as createHttpServer } from "node:http";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { getResourceDefinition } from "../model/index.js";
import { prepareAuditWorkspace } from "./audit-preparation.js";
import { createNextAuditCycle, planNextAuditCycle } from "./audit-transition.js";
import { applyApplicabilityReviewWithContext, planApplicabilityReview } from "./batch-review.js";
import { applyCollectionReview, planCollectionReview } from "./collection-review.js";
import { generateEvidencePacket, prepareEvidencePacket } from "./evidence-packet.js";
import { FAVICON_PNG, LOGO_MARK_PNG } from "./favicon.js";
import {
  addEvidenceAttachment,
  createResource,
  deleteResource,
  removeEvidenceAttachment,
  updateContent,
  updateResource
} from "./files.js";
import {
  BROWSER_VALIDATION,
  commitAndPushWorkspace,
  getBrowserRepositoryState,
  getFileHistory,
  getRepositorySnapshot,
  prefetchBrowserRemote,
  pullWorkspace,
  pushWorkspace,
  retryBrowserSync,
  runBrowserMutation
} from "./git.js";
import { normalizeResourceMutation, serializeWorkspaceMutation } from "./mutation.js";
import {
  completeObligationAction,
  completeObligationEvent,
  completeObligationOccurrence,
  createObligationEvent,
  planObligations
} from "./obligations.js";
import {
  planExternalReviewerGovernance,
  setupExternalReviewerGovernance
} from "./external-reviewer.js";
import { isWithin, relativeToWorkspace, resolveWorkspacePath } from "./paths.js";
import { applyReconciliation, planReconciliation } from "./reconciliation.js";
import { createAppState, createResourceDetail } from "./state.js";
import { setupWorkspace } from "./setup.js";
import { collectTimings, measureTiming, timingEnabled } from "./timing.js";
import {
  assessWorkflow,
  buildWorkflowDelta,
  previewWorkflowMutation,
  workflowForResource
} from "./workflow.js";
import { loadWorkspace } from "./workspace.js";
import { APP_SCRIPT, APP_STYLES, renderIndex } from "./web.js";

export function createFilegrcServer(input = process.cwd(), options = {}) {
  return createHttpServer(async (request, response) => {
    const requestStarted = performance.now();
    if (timingEnabled()) {
      response.once("finish", () => {
        console.error(`[filegrc timing] ${JSON.stringify({
          operation: "http-request",
          method: request.method,
          path: request.url?.split("?")[0],
          status: response.statusCode,
          durationMs: performance.now() - requestStarted
        })}`);
      });
    }
    try {
      if (!expectedHost(request, options.allowedHosts)) {
        return json(response, 403, { error: "The request host is not allowed." });
      }
      const url = new URL(request.url, "http://localhost");
      if (["POST", "PUT", "DELETE"].includes(request.method) && !sameOrigin(request)) {
        return json(response, 403, { error: "Cross-origin writes are not allowed." });
      }
      if (request.method === "GET" && url.pathname === "/api/state") {
        if (timingEnabled()) {
          const { result, timings } = await collectTimings(() => measureTiming("state", () => createAppState(input, {
            allowNonAuthoritativeWrites: options.allowNonAuthoritativeWrites,
            includeDetails: false
          })));
          console.error(`[filegrc timing] ${JSON.stringify({ operation: "state", ...timings })}`);
          return json(response, 200, result);
        }
        return json(response, 200, await createAppState(input, {
          allowNonAuthoritativeWrites: options.allowNonAuthoritativeWrites,
          includeDetails: false
        }));
      }
      if (request.method === "GET" && url.pathname === "/api/history") {
        const path = url.searchParams.get("path");
        if (!path || path.includes("..") || !path.startsWith("data/")) return json(response, 400, { error: "A safe data path is required." });
        return json(response, 200, getFileHistory(input, path));
      }
      if (request.method === "GET" && url.pathname === "/api/obligations") {
        const loaded = await loadWorkspace(input);
        return json(response, 200, planObligations(loaded.resources, {
          asOf: url.searchParams.get("asOf") || undefined,
          from: url.searchParams.get("from") || undefined,
          through: url.searchParams.get("through") || undefined,
          now: url.searchParams.get("now") || undefined,
          includeComplete: url.searchParams.get("includeComplete") === "true",
          model: loaded.model
        }));
      }
      if (request.method === "GET" && url.pathname === "/api/workflow") {
        const start = url.searchParams.get("start");
        const end = url.searchParams.get("end");
        return json(response, 200, await assessWorkflow(input, {
          auditId: url.searchParams.get("auditId") || undefined,
          programId: url.searchParams.get("programId") || undefined,
          asOf: url.searchParams.get("asOf") || undefined,
          through: url.searchParams.get("through") || undefined,
          coverage: start || end ? { kind: "range", startsOn: start, endsOn: end } : undefined,
          includeComplete: url.searchParams.get("includeComplete") === "true"
        }));
      }
      if (request.method === "POST" && url.pathname === "/api/git/prefetch") {
        return json(response, 200, await prefetchBrowserRemote(input, {
          allowNonAuthoritativeWrites: options.allowNonAuthoritativeWrites
        }));
      }
      if (request.method === "POST" && url.pathname === "/api/workflow/preview") {
        return json(response, 200, await previewWorkflowMutation(input, await readJson(request)));
      }
      if (request.method === "GET" && url.pathname === "/api/reconciliation") {
        return json(response, 200, await planReconciliation(input));
      }
      if (request.method === "POST" && url.pathname === "/api/reconciliation") {
        const payload = await readJson(request);
        return json(response, 201, await browserMutation(input, options, {
          message: (result) => `Reconcile policy event: ${result.event?.title || payload.candidateId}`
        }, () => applyReconciliation(input, {
          ...payload,
          confirmed: payload.confirmed === true
        })));
      }
      if (request.method === "POST" && url.pathname === "/api/external-reviewer-governance/preview") {
        return json(response, 200, await planExternalReviewerGovernance(input, await readJson(request)));
      }
      if (request.method === "POST" && url.pathname === "/api/external-reviewer-governance") {
        const payload = await readJson(request);
        return json(response, 201, await browserMutation(input, options, {
          message: (result) => `Assign external independent reviewer: ${result.reviewerId}`
        }, () => setupExternalReviewerGovernance(input, {
          ...payload,
          confirmed: payload.confirmed === true
        })));
      }
      if (request.method === "POST" && url.pathname === "/api/audit-cycle/preview") {
        return json(response, 200, await planNextAuditCycle(input, await readJson(request)));
      }
      if (request.method === "POST" && url.pathname === "/api/audit-cycle") {
        const payload = await readJson(request);
        return json(response, 201, await browserMutation(input, options, {
          message: (result) => `Create next audit cycle: ${result.audit?.title || payload.priorAuditId}`
        }, () => createNextAuditCycle(input, {
          ...payload,
          confirmed: payload.confirmed === true
        })));
      }
      if (request.method === "POST" && url.pathname === "/api/applicability-review/preview") {
        return json(response, 200, await planApplicabilityReview(input, await readJson(request)));
      }
      if (request.method === "POST" && url.pathname === "/api/applicability-review") {
        const payload = await readJson(request);
        const { prefetchToken, ...reviewPayload } = payload;
        return json(response, 201, await browserMutation(input, options, {
          message: (result) => `Record ${result.reviewedIds?.length || 0} applicability decisions`,
          fastResponse: prefersFastMutation(request),
          prefetchToken
        }, (_root, mutationContext) => applyApplicabilityReviewWithContext(input, {
          ...reviewPayload,
          confirmed: payload.confirmed === true
        }, {
          repositorySnapshot: mutationContext?.repositorySnapshot
        })));
      }
      if (request.method === "POST" && url.pathname === "/api/collection-review/preview") {
        return json(response, 200, await planCollectionReview(input, await readJson(request)));
      }
      if (request.method === "POST" && url.pathname === "/api/collection-review") {
        const payload = await readJson(request);
        const { prefetchToken, ...reviewPayload } = payload;
        return json(response, 201, await browserMutation(input, options, {
          message: (result) => `Confirm ${result.assessment?.configuration?.title || payload.resourceType}`,
          fastResponse: prefersFastMutation(request),
          prefetchToken
        }, (_root, mutationContext) => applyCollectionReview(input, {
          ...reviewPayload,
          scopeRevision: mutationContext?.repositorySnapshot?.currentCommit,
          confirmed: payload.confirmed === true
        })));
      }
      if (request.method === "POST" && url.pathname === "/api/obligation-events") {
        const payload = await readJson(request);
        return json(response, 201, await browserMutation(input, options, {
          message: (result) => `Create policy event: ${result.event?.title || payload.title || payload.eventType}`
        }, () => createObligationEvent(input, payload)));
      }
      if (request.method === "POST" && url.pathname === "/api/obligation-completions") {
        const payload = await readJson(request);
        if (!safeSegment(payload.obligationId)) return json(response, 400, { error: "A safe obligation ID is required." });
        const result = await browserMutation(input, options, {
          message: () => `Complete ${resourceTypeLabel(payload.record?.type)}: ${payload.record?.title || payload.obligationId}`
        }, () => completeObligationOccurrence(input, {
          obligationId: payload.obligationId,
          record: payload.record,
          content: payload.content,
          expectedRevision: requireRevision(payload.revision, `obligation/${payload.obligationId}`)
        }));
        return json(response, 201, result);
      }
      if (request.method === "POST" && url.pathname === "/api/action-completions") {
        const payload = await readJson(request);
        if (!safeSegment(payload.actionItemId)) {
          return json(response, 400, { error: "A safe Action Item ID is required." });
        }
        const result = await browserMutation(input, options, {
          message: () => `Complete action item: ${payload.actionItemId}`
        }, () => completeObligationAction(input, {
          actionItemId: payload.actionItemId,
          completedOn: payload.completedOn,
          record: payload.record,
          content: payload.content,
          expectedRevision: requireRevision(payload.revision, `action-item/${payload.actionItemId}`)
        }));
        return json(response, 201, result);
      }
      if (request.method === "POST" && url.pathname === "/api/obligation-event-completions") {
        const payload = await readJson(request);
        if (!safeSegment(payload.eventId)) {
          return json(response, 400, { error: "A safe Policy Event ID is required." });
        }
        const result = await browserMutation(input, options, {
          message: () => `Complete policy event: ${payload.eventId}`
        }, () => completeObligationEvent(input, {
          eventId: payload.eventId,
          completedOn: payload.completedOn,
          expectedRevision: requireRevision(payload.revision, `obligation-event/${payload.eventId}`)
        }));
        return json(response, 200, result);
      }
      const attachmentMatch = /^\/api\/evidence-attachments\/([^/]+)\/([^/]+)$/.exec(url.pathname);
      if (attachmentMatch && request.method === "POST") {
        const evidenceId = decodeURIComponent(attachmentMatch[1]);
        const attachment = decodeURIComponent(attachmentMatch[2]);
        if (!safeSegment(evidenceId) || !safeAttachmentName(attachment)) {
          return json(response, 400, { error: "Safe Evidence and attachment identifiers are required." });
        }
        const revision = requireRevision(url.searchParams.get("revision"), `evidence/${evidenceId}`);
        const temporaryDirectory = await mkdtemp(join(tmpdir(), "filegrc-evidence-upload-"));
        try {
          const temporaryPath = join(temporaryDirectory, attachment);
          await writeFile(temporaryPath, await readBytes(request));
          const result = await browserMutation(input, options, {
            message: () => `Attach evidence file: ${attachment}`
          }, () => addEvidenceAttachment(input, evidenceId, temporaryPath, {
            name: attachment,
            expectedRevision: revision
          }));
          return json(response, 201, result);
        } finally {
          await rm(temporaryDirectory, { recursive: true, force: true });
        }
      }
      if (attachmentMatch && request.method === "DELETE") {
        const evidenceId = decodeURIComponent(attachmentMatch[1]);
        const attachment = decodeURIComponent(attachmentMatch[2]);
        if (!safeSegment(evidenceId) || !safeAttachmentName(attachment)) {
          return json(response, 400, { error: "Safe Evidence and attachment identifiers are required." });
        }
        const revision = requireRevision(url.searchParams.get("revision"), `evidence/${evidenceId}`);
        const result = await browserMutation(input, options, {
          message: () => `Remove evidence file: ${attachment}`
        }, () => removeEvidenceAttachment(input, evidenceId, attachment, {
          expectedRevision: revision
        }));
        return json(response, 200, result);
      }
      if (request.method === "GET" && url.pathname === "/api/evidence-packet") {
        return json(response, 200, await prepareEvidencePacket(input, {
          start: url.searchParams.get("start"),
          end: url.searchParams.get("end"),
          auditId: url.searchParams.get("auditId") || undefined
        }));
      }
      if (request.method === "POST" && url.pathname === "/api/evidence-packet") {
        const payload = await readJson(request);
        const { packet, output: writtenOutput, files } = await generateEvidencePacket(input, payload);
        const output = relativeToWorkspace(input, writtenOutput);
        const outputSegments = output.split("/");
        const packetUrl = outputSegments.length === 3
          && outputSegments[0] === ".filegrc"
          && outputSegments[1] === "evidence-packets"
          ? `/packet/${outputSegments.map(encodeURIComponent).join("/")}/index.html`
          : null;
        return json(response, 201, {
          packet,
          output,
          packetUrl,
          files
        });
      }
      if (request.method === "POST" && url.pathname === "/api/audit-preparation") {
        const payload = await readJson(request);
        return json(response, 201, await browserMutation(input, options, {
          message: () => `Prepare audit: ${payload.auditId || "engagement"}`
        }, () => prepareAuditWorkspace(input, payload)));
      }
      if (request.method === "POST" && url.pathname === "/api/setup") {
        const payload = await readJson(request);
        const completeSetup = async () => {
          return browserMutation(input, options, {
            message: (setupResult) => `${payload.draft === true ? "Save onboarding draft" : "Complete onboarding"} for ${setupResult.workspace.organizationName}`
          }, () => setupWorkspace(input, payload));
        };
        return json(response, 200, await completeSetup());
      }
      if (request.method === "POST" && url.pathname === "/api/resources") {
        const payload = normalizeResourceMutation(await readJson(request));
        const { record } = payload;
        const result = await browserMutation(input, options, {
          message: () => `Create ${resourceTypeLabel(record.type)}: ${record.title || record.id}`
        }, () => createResource(input, record, { content: payload.content }));
        return json(response, 201, result);
      }
      if (request.method === "POST" && url.pathname === "/api/commit") {
        await requireManualBrowserGit(input, options);
        const payload = await readJson(request);
        return json(response, 201, await manualGitResultWithState(input, options, () => commitAndPushWorkspace(input, payload.message)));
      }
      if (request.method === "POST" && url.pathname === "/api/git/pull") {
        await requireManualBrowserGit(input, options);
        return json(response, 200, await manualGitResultWithState(input, options, () => pullWorkspace(input)));
      }
      if (request.method === "POST" && url.pathname === "/api/git/push") {
        await requireManualBrowserGit(input, options);
        return json(response, 200, await manualGitResultWithState(input, options, () => pushWorkspace(input)));
      }
      if (request.method === "POST" && url.pathname === "/api/git/retry-sync") {
        const result = await retryBrowserSync(input, {
          allowNonAuthoritativeWrites: options.allowNonAuthoritativeWrites
        });
        const state = await createAppState(input, {
          allowNonAuthoritativeWrites: options.allowNonAuthoritativeWrites,
          includeDetails: false
        });
        return json(response, 200, { ...result, state });
      }
      if (request.method === "GET" && url.pathname === "/api/git/sync-status") {
        const git = { ...await getRepositorySnapshot(input) };
        const repository = await getBrowserRepositoryState(input, {
          allowNonAuthoritativeWrites: options.allowNonAuthoritativeWrites,
          repositorySnapshot: git
        });
        delete git.root;
        return json(response, 200, {
          repository,
          git,
          readOnly: repository.mode === "trunk" && !repository.writesAllowed
        });
      }
      if (request.method === "PUT" && url.pathname === "/api/content") {
        const payload = await readJson(request);
        const result = await browserMutation(input, options, {
          message: () => `Update content: ${payload.path}`
        }, () => updateContent(input, payload.path, payload.source, {
          expectedRevision: requireRevision(payload.revision, `content/${payload.path}`)
        }));
        return json(response, 200, result);
      }
      const match = /^\/api\/resource\/([^/]+)\/([^/]+)$/.exec(url.pathname);
      if (match) {
        const type = decodeURIComponent(match[1]);
        const id = decodeURIComponent(match[2]);
        if (!safeSegment(type) || !safeSegment(id)) return json(response, 400, { error: "Unsafe resource identifier." });
        if (request.method === "GET") {
          const entry = await createResourceDetail(input, type, id);
          if (!entry) return json(response, 404, { error: "Resource not found." });
          if (url.searchParams.get("workflow") === "true") {
            const workflow = await assessWorkflow(input);
            entry.workflow = workflowForResource(workflow, type, id);
          }
          return json(response, 200, entry);
        }
        if (request.method === "PUT") {
          const payload = normalizeResourceMutation(await readJson(request), { requireRevision: true });
          const { record } = payload;
          const result = await browserMutation(input, options, {
            message: () => `Update ${resourceTypeLabel(type)}: ${record.title || id}`
          }, () => updateResource(input, type, id, record, {
            content: payload.content,
            expectedRevision: payload.revision,
            expectedContentRevisions: payload.contentRevisions,
            requireExpectedContentRevisions: true
          }));
          return json(response, 200, result);
        }
        if (request.method === "DELETE") {
          const revision = requireRevision(url.searchParams.get("revision"), `${type}/${id}`);
          const result = await browserMutation(input, options, {
            message: () => `Delete ${resourceTypeLabel(type)}: ${id}`
          }, () => deleteResource(input, type, id, { expectedRevision: revision }));
          return json(response, 200, {
            deleted: true,
            type,
            id,
            deletedContent: result.deletedContent,
            synchronization: result.synchronization,
            workflowDelta: result.workflowDelta,
            state: result.state
          });
        }
      }
      if (request.method === "GET" && url.pathname === "/favicon.png") return text(response, 200, FAVICON_PNG, "image/png");
      if (request.method === "GET" && url.pathname === "/logo-mark-white.png") return text(response, 200, LOGO_MARK_PNG, "image/png");
      if (request.method === "GET" && url.pathname === "/filegrc-app.js") return text(response, 200, APP_SCRIPT, "text/javascript; charset=utf-8");
      if (request.method === "GET" && url.pathname === "/filegrc.css") return text(response, 200, APP_STYLES, "text/css; charset=utf-8");
      if (request.method === "GET" && url.pathname.startsWith("/packet/")) {
        const segments = url.pathname.slice("/packet/".length).split("/").map(decodeURIComponent);
        if (
          segments.some((segment) => (
            !segment
            || segment === "."
            || segment === ".."
            || segment.includes("/")
            || segment.includes("\\")
            || segment.includes("\0")
          ))
          || segments[0] !== ".filegrc"
          || segments[1] !== "evidence-packets"
        ) {
          return json(response, 400, { error: "A generated evidence-packet path is required." });
        }
        const relativePath = segments.join("/");
        const path = resolveWorkspacePath(input, relativePath);
        const packetRoot = resolveWorkspacePath(input, ".filegrc/evidence-packets");
        if (!isWithin(packetRoot, path)) return json(response, 400, { error: "A generated evidence-packet path is required." });
        const [realPacketRoot, realPath] = await Promise.all([realpath(packetRoot), realpath(path)]);
        if (realPacketRoot !== resolve(packetRoot) || !isWithin(realPacketRoot, realPath)) {
          return json(response, 400, { error: "A generated evidence-packet path is required." });
        }
        const isPacketIndex = segments.length === 4 && segments.at(-1) === "index.html";
        return text(response, 200, await readFile(path), packetContentType(path, isPacketIndex));
      }
      if (request.method === "GET" && !url.pathname.startsWith("/api/")) return text(response, 200, renderIndex(), "text/html; charset=utf-8");
      json(response, 404, { error: "Not found." });
    } catch (error) {
      const status = statusFor(error);
      json(response, status, { error: publicErrorMessage(error, status) });
    }
  });
}

export async function serveWorkspace(input = process.cwd(), options = {}) {
  const host = String(options.host ?? "127.0.0.1").trim();
  const port = Number(options.port ?? 8787);
  if (!host) throw new Error("The server host must be a non-empty string.");
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("The server port must be an integer from 0 through 65535.");
  }
  const loaded = await loadWorkspace(input);
  getResourceDefinition(loaded.model, "workspace");
  const server = createFilegrcServer(loaded.root, {
    allowedHosts: [host],
    allowNonAuthoritativeWrites: options.allowNonAuthoritativeWrites === true,
    backgroundPushDelayMs: options.backgroundPushDelayMs
  });
  let usedFallbackPort = false;
  try {
    await listen(server, port, host);
  } catch (error) {
    if (
      error.code !== "EADDRINUSE"
      || port === 0
      || options.fallbackToAvailablePort !== true
    ) {
      throw error;
    }
    await listen(server, 0, host);
    usedFallbackPort = true;
  }
  return {
    server,
    root: loaded.root,
    address: server.address(),
    url: `http://${urlHost(host)}:${server.address().port}`,
    requestedPort: port,
    usedFallbackPort
  };
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function browserMutation(input, options, mutationOptions, task) {
  const run = () => serializeWorkspaceMutation(input, async (root) => {
    const fastResponse = mutationOptions.fastResponse === true;
    const workflowBefore = fastResponse
      ? null
      : await measureTiming("workflow-before", () => assessWorkflow(root));
    const result = await measureTiming("mutation", () => runBrowserMutation(root, {
      ...mutationOptions,
      allowNonAuthoritativeWrites: options.allowNonAuthoritativeWrites === true,
      backgroundPushDelayMs: options.backgroundPushDelayMs,
      includeValidationProof: !fastResponse
    }, task));
    if (fastResponse) {
      return {
        ...result,
        stateRefresh: true
      };
    }
    const state = await measureTiming("state", () => createAppState(root, {
      allowNonAuthoritativeWrites: options.allowNonAuthoritativeWrites,
      includeDetails: false,
      validationProof: result?.[BROWSER_VALIDATION]
    }));
    if (result?.synchronization?.status === "syncing" && state.repository.status !== "syncing") {
      result.synchronization = {
        ...result.synchronization,
        status: state.repository.status === "synced" ? "synced" : "not-synced",
        synchronizedAt: state.repository.lastSuccessfulSynchronization ?? null,
        pushError: state.repository.backgroundSyncError ?? null
      };
    }
    return {
      ...result,
      workflowDelta: buildWorkflowDelta(workflowBefore, state.workflow),
      state
    };
  });
  if (!timingEnabled()) return run();
  return collectTimings(run).then(({ result, timings }) => {
    console.error(`[filegrc timing] ${JSON.stringify({ operation: "browser-mutation", ...timings })}`);
    return result;
  });
}

function prefersFastMutation(request) {
  return String(request.headers.prefer || "")
    .split(",")
    .some((value) => value.trim().toLowerCase() === "respond-async");
}

async function requireManualBrowserGit(input, options) {
  const repository = await getBrowserRepositoryState(input, {
    allowNonAuthoritativeWrites: options.allowNonAuthoritativeWrites
  });
  if (repository.mode === "trunk") {
    throw new Error("Browser commit, pull, and push controls are disabled in trunk mode. Saved changes synchronize automatically.");
  }
}

async function manualGitResultWithState(input, options, task) {
  const result = await task();
  const state = await createAppState(input, {
    allowNonAuthoritativeWrites: options.allowNonAuthoritativeWrites,
    includeDetails: false
  });
  return { ...result, state };
}

function resourceTypeLabel(value) {
  return String(value || "record").replaceAll("-", " ");
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 2_000_000) throw new Error("Request body exceeds 2 MB.");
    chunks.push(chunk);
  }
  const source = Buffer.concat(chunks).toString("utf8");
  if (!source) throw new Error("A JSON request body is required.");
  const value = JSON.parse(source);
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error("The JSON request body must be an object.");
  }
  return value;
}

async function readBytes(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 25_000_000) throw new Error("Attachment exceeds 25 MB.");
    chunks.push(chunk);
  }
  if (size === 0) throw new Error("An attachment body is required.");
  return Buffer.concat(chunks);
}

function json(response, status, value) {
  text(response, status, `${JSON.stringify(value, null, 2)}\n`, "application/json; charset=utf-8");
}

function text(response, status, value, contentType) {
  response.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), geolocation=(), microphone=()",
    "cross-origin-resource-policy": "same-origin",
    "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
  });
  response.end(value);
}

function packetContentType(path, isPacketIndex = false) {
  if (isPacketIndex) return "text/html; charset=utf-8";
  return {
    ".json": "application/json; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".csv": "text/csv; charset=utf-8"
  }[extname(path).toLowerCase()] || "application/octet-stream";
}

function safeSegment(value) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function safeAttachmentName(value) {
  return typeof value === "string"
    && value.length > 0
    && value === value.split(/[\\/]/).at(-1)
    && !value.startsWith(".");
}

function requireRevision(value, target) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`A revision is required when changing ${target}. Reload the resource and try again.`);
  }
  return value;
}

function sameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const expectedProtocol = request.socket.encrypted ? "https:" : "http:";
    return new URL(origin).origin === `${expectedProtocol}//${request.headers.host}`;
  } catch {
    return false;
  }
}

function expectedHost(request, allowedHosts = []) {
  const host = request.headers.host;
  const localAddress = normalizeAddress(request.socket.localAddress);
  if (typeof host !== "string" || !host || !localAddress) return false;
  try {
    const requested = normalizeAddress(new URL(`http://${host}`).hostname);
    const allowed = new Set(allowedHosts.map(normalizeAddress));
    return allowed.has(requested)
      || requested === localAddress
      || (isLoopback(localAddress) && (requested === "localhost" || isLoopback(requested)));
  } catch {
    return false;
  }
}

function normalizeAddress(value) {
  return String(value ?? "").replace(/^\[|\]$/g, "").replace(/^::ffff:/, "").toLowerCase();
}

function isLoopback(value) {
  return value === "::1" || /^127(?:\.\d{1,3}){3}$/.test(value);
}

function urlHost(host) {
  const normalized = normalizeAddress(host);
  const display = normalized === "0.0.0.0" ? "127.0.0.1" : normalized === "::" ? "::1" : host;
  return display.includes(":") && !display.startsWith("[") ? `[${display}]` : display;
}

function statusFor(error) {
  if (error instanceof SyntaxError || error instanceof URIError) return 400;
  if (/exceeds 2 MB/i.test(error.message)) return 413;
  if (/exceeds 25 MB/i.test(error.message)) return 413;
  if (/changed after you opened|source changed|revision changed/i.test(error.message)) return 409;
  if (/already exists|target file already exists/i.test(error.message)) return 409;
  if (/Git could not|Git is unavailable|Git timed out|upstream branch|multiple remotes|no Git remote|configured repository remote|safe Git name|check out a branch|before trying to (?:pull|push)|authoritative branch|not synchronized|not synced|diverged|waiting to be pushed|Retry sync|background push|outside this FileGRC workspace|worktree has uncommitted changes|development write override|browser commit, pull, and push/i.test(error.message)) return 409;
  if (/not found|ENOENT/i.test(error.message)) return 404;
  if (/invalid|required|unsafe|match|workspace|singleton|commit message|no changes|git history|git user|unknown resource type|must use|must be|content path|data path|path leaves|valid .*date|not found|no active obligations|end date|through date|already exists|EEXIST/i.test(error.message)) return 400;
  return 500;
}

function publicErrorMessage(error, status) {
  if (error?.code === "ENOENT") return "The requested file was not found.";
  if (status === 500) return "The server could not complete the request.";
  return error.message;
}
