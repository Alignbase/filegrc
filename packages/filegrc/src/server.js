import { createServer as createHttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { getResourceDefinition } from "../model/index.js";
import { prepareAuditWorkspace } from "./audit-preparation.js";
import { saveAuditPopulation, scaffoldAuditPopulationCorrection } from "./audit-populations.js";
import { activateDocuments, activateGovernedContent } from "./document-activation.js";
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
  getRepositoryStateSignature,
  prefetchBrowserRemote,
  pullWorkspace,
  pushWorkspace,
  retryBrowserSync,
  runBrowserMutation,
  withGitCommandCache,
  withGitCommandDeadline
} from "./git.js";
import { normalizeResourceMutation, serializeWorkspaceMutation } from "./mutation.js";
import { renderMarkdown } from "./markdown.js";
import {
  approveReportingRouteSet,
  assessReportingRouteSets,
  cancelReportingRouteSet,
  proposeReportingRouteSet,
  scaffoldReportingRouteSet
} from "./reporting-route-sets.js";
import {
  activateObligationRule,
  completeObligationAction,
  completeObligationEvent,
  completeObligationOccurrence,
  createObligationEvent,
  planObligations,
  saveObligationOccurrence,
  scaffoldObligationOccurrence,
  scaffoldObligationRuleActivation
} from "./obligations.js";
import {
  planExternalReviewerGovernance,
  setupExternalReviewerGovernance
} from "./external-reviewer.js";
import { isWithin, relativeToWorkspace, resolveWorkspacePath } from "./paths.js";
import { activatePolicies } from "./policy-activation.js";
import { resolveProgram } from "./program.js";
import { applyReconciliation, dismissReconciliation, planReconciliation } from "./reconciliation.js";
import { resourceReviewRevisions } from "./retention.js";
import { createAppBootstrap, createAppState, createAppStateSection, createResourceDetail, createResourceHistory } from "./state.js";
import { setupWorkspace } from "./setup.js";
import { collectTimings, measureTiming, timingEnabled } from "./timing.js";
import { fingerprintWorkspace } from "./validate.js";
import {
  assessWorkflow,
  buildWorkflowDelta,
  previewWorkflowMutation,
  workflowForResource
} from "./workflow.js";
import { loadWorkspace } from "./workspace.js";
import { APP_SCRIPT, APP_STYLES, renderIndex } from "./web.js";

const STATE_SESSION_MAX_AGE_MS = 5 * 60_000;
const MAX_STATE_SESSIONS = 8;
const MAX_STATE_SESSION_PROMISES = 64;
const RESOURCE_DETAIL_GIT_DEADLINE_MS = 10_000;
const STATE_SECTION_GIT_DEADLINE_MS = 10_000;

export function createFilegrcServer(input = process.cwd(), options = {}) {
  const stateSessions = new Map();
  const fileDigestCache = new Map();
  let bootstrapSnapshotPromise = null;
  let stateInvalidationGeneration = 0;
  let activeStateMutations = 0;
  let stateMutationWaiters = [];
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
      const requestOptions = {
        ...options,
        programId: url.searchParams.get("programId") || undefined,
        fastResponse: prefersFastMutation(request),
        beginStateMutation: () => {
          stateInvalidationGeneration += 1;
          activeStateMutations += 1;
          invalidateStateSessions(stateSessions);
        },
        endStateMutation: () => {
          stateInvalidationGeneration += 1;
          activeStateMutations -= 1;
          invalidateStateSessions(stateSessions);
          if (activeStateMutations === 0) {
            const waiters = stateMutationWaiters;
            stateMutationWaiters = [];
            for (const resolve of waiters) resolve();
          }
        }
      };
      if (["POST", "PUT", "DELETE"].includes(request.method) && !sameOrigin(request)) {
        return json(response, 403, { error: "Cross-origin writes are not allowed." });
      }
      if (request.method === "GET" && url.pathname === "/api/state") {
        if (timingEnabled()) {
          const { result, timings } = await collectTimings(() => measureTiming("state", () => createAppState(input, {
            allowNonAuthoritativeWrites: options.allowNonAuthoritativeWrites,
            programId: requestOptions.programId,
            includeDetails: false
          })));
          console.error(`[filegrc timing] ${JSON.stringify({ operation: "state", ...timings })}`);
          return json(response, 200, result);
        }
        return json(response, 200, await createAppState(input, {
          allowNonAuthoritativeWrites: options.allowNonAuthoritativeWrites,
          programId: requestOptions.programId,
          includeDetails: false
        }));
      }
      if (request.method === "GET" && url.pathname === "/api/state/bootstrap") {
        if (!sameOriginBrowserRead(request)) {
          return json(response, 403, { error: "Cross-origin state requests are not allowed." });
        }
        const deadlineAt = performance.now() + STATE_SECTION_GIT_DEADLINE_MS;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          if (activeStateMutations > 0) {
            await awaitWithinDeadline(new Promise((resolve) => stateMutationWaiters.push(resolve)), deadlineAt);
          }
          const generation = stateInvalidationGeneration;
          if (!bootstrapSnapshotPromise) {
            bootstrapSnapshotPromise = withGitCommandDeadline(deadlineAt, () => stableStateSnapshot(input, {
              fileDigestCache,
              deadlineAt
            })).finally(() => {
              bootstrapSnapshotPromise = null;
            });
          }
          const [snapshot, repositorySignature] = await awaitWithinDeadline(bootstrapSnapshotPromise, deadlineAt);
          const loaded = snapshot.loaded;
          const token = randomUUID();
          const session = {
            loaded,
            fingerprint: snapshot.fingerprint,
            repositorySignature,
            fileDigestCache,
            generatedAt: new Date().toISOString(),
            expiresAt: Date.now() + STATE_SESSION_MAX_AGE_MS,
            revoked: false,
            promises: new Map(),
            verificationPromise: null,
            gitCommandCache: new Map()
          };
          const state = await createAppBootstrap(loaded, {
            generatedAt: session.generatedAt,
            programId: url.searchParams.get("programId") || undefined
          });
          if (activeStateMutations > 0 || generation !== stateInvalidationGeneration) continue;
          pruneStateSessions(stateSessions);
          stateSessions.set(token, session);
          while (stateSessions.size > MAX_STATE_SESSIONS) {
            const oldestToken = stateSessions.keys().next().value;
            const oldestSession = stateSessions.get(oldestToken);
            if (oldestSession) oldestSession.revoked = true;
            stateSessions.delete(oldestToken);
          }
          state.stateToken = token;
          return json(response, 200, state);
        }
        throw stateSessionExpiredError();
      }
      if (request.method === "GET" && url.pathname.startsWith("/api/state/")) {
        const section = url.pathname.slice("/api/state/".length);
        if (!["repository", "program", "obligations", "audits", "workflow"].includes(section)) {
          return json(response, 404, { error: "Unknown app-state section." });
        }
        const token = url.searchParams.get("token");
        pruneStateSessions(stateSessions);
        const session = stateSessions.get(token);
        if (!session) return json(response, 409, { error: "The workspace state expired. Reload it and try again." });
        const sectionDeadlineMs = Number.isFinite(options.stateSectionDeadlineMs)
          ? Math.max(0, options.stateSectionDeadlineMs)
          : STATE_SECTION_GIT_DEADLINE_MS;
        const deadlineAt = performance.now() + sectionDeadlineMs;
        const state = await withGitCommandDeadline(deadlineAt, () => (
          loadStateSessionSection(session, section, options, url.searchParams.get("programId") || undefined, null, deadlineAt)
        ));
        assertCurrentStateSession(session);
        return json(response, 200, { stateToken: token, section, state });
      }
      if (request.method === "GET" && url.pathname === "/api/history") {
        const path = url.searchParams.get("path");
        if (!path || path.includes("..") || !path.startsWith("data/")) return json(response, 400, { error: "A safe data path is required." });
        return json(response, 200, getFileHistory(input, path));
      }
      if (request.method === "GET" && url.pathname === "/api/obligations") {
        const loaded = await loadWorkspace(input);
        return json(response, 200, planObligations(loaded.resources, {
          programId: url.searchParams.get("programId") || undefined,
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
        return json(response, 201, await browserMutation(input, requestOptions, {
          message: (result) => `Reconcile policy event: ${result.event?.title || payload.candidateId}`
        }, () => applyReconciliation(input, {
          ...payload,
          programId: payload.programId || requestOptions.programId,
          confirmed: payload.confirmed === true
        })));
      }
      if (request.method === "POST" && url.pathname === "/api/reconciliation/dismissal") {
        const payload = await readJson(request);
        return json(response, 201, await browserMutation(input, requestOptions, {
          message: (result) => `Dismiss Git transition candidate: ${result.candidate?.eventType || payload.candidateId}`
        }, () => dismissReconciliation(input, {
          ...payload,
          confirmed: payload.confirmed === true
        })));
      }
      if (request.method === "POST" && url.pathname === "/api/external-reviewer-governance/preview") {
        return json(response, 200, await planExternalReviewerGovernance(input, await readJson(request)));
      }
      if (request.method === "POST" && url.pathname === "/api/external-reviewer-governance") {
        const payload = await readJson(request);
        return json(response, 201, await browserMutation(input, requestOptions, {
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
        return json(response, 201, await browserMutation(input, requestOptions, {
          message: (result) => `Create next audit cycle: ${result.audit?.title || payload.priorAuditId}`
        }, () => createNextAuditCycle(input, {
          ...payload,
          confirmed: payload.confirmed === true
        })));
      }
      if (request.method === "POST" && url.pathname === "/api/applicability-review/preview") {
        const payload = await readJson(request);
        return json(response, 200, await planApplicabilityReview(input, {
          ...payload,
          programId: url.searchParams.get("programId") || payload.programId
        }));
      }
      if (request.method === "POST" && url.pathname === "/api/applicability-review") {
        const payload = await readJson(request);
        const { prefetchToken, ...reviewPayload } = payload;
        return json(response, 201, await browserMutation(input, requestOptions, {
          message: (result) => `Record ${result.reviewedIds?.length || 0} applicability decisions`,
          fastResponse: prefersFastMutation(request),
          prefetchToken
        }, (_root, mutationContext) => applyApplicabilityReviewWithContext(input, {
          ...reviewPayload,
          programId: url.searchParams.get("programId") || reviewPayload.programId,
          confirmed: payload.confirmed === true
        }, {
          repositorySnapshot: mutationContext?.repositorySnapshot
        })));
      }
      if (request.method === "POST" && url.pathname === "/api/collection-review/preview") {
        const payload = await readJson(request);
        return json(response, 200, await planCollectionReview(input, {
          ...payload,
          programId: url.searchParams.get("programId") || payload.programId
        }));
      }
      if (request.method === "POST" && url.pathname === "/api/collection-review") {
        const payload = await readJson(request);
        const { prefetchToken, ...reviewPayload } = payload;
        return json(response, 201, await browserMutation(input, requestOptions, {
          message: (result) => `Confirm ${result.assessment?.configuration?.title || payload.resourceType}`,
          fastResponse: prefersFastMutation(request),
          prefetchToken
        }, (_root, mutationContext) => applyCollectionReview(input, {
          ...reviewPayload,
          programId: url.searchParams.get("programId") || reviewPayload.programId,
          scopeRevision: mutationContext?.repositorySnapshot?.currentCommit,
          confirmed: payload.confirmed === true
        })));
      }
      if (request.method === "POST" && url.pathname === "/api/obligation-events") {
        const payload = await readJson(request);
        return json(response, 201, await browserMutation(input, requestOptions, {
          message: (result) => `Create policy event: ${result.event?.title || payload.title || payload.eventType}`
        }, () => createObligationEvent(input, { ...payload, programId: payload.programId || requestOptions.programId })));
      }
      if (request.method === "GET" && url.pathname === "/api/reporting-route-sets") {
        return json(response, 200, await assessReportingRouteSets(input, {
          programId: url.searchParams.get("programId") || requestOptions.programId,
          at: url.searchParams.get("at") || undefined
        }));
      }
      if (request.method === "POST" && url.pathname === "/api/reporting-route-sets/scaffold") {
        return json(response, 200, scaffoldReportingRouteSet(await readJson(request)));
      }
      if (request.method === "POST" && url.pathname === "/api/reporting-route-sets/propose") {
        const payload = await readJson(request);
        if (!safeSegment(payload.routeSetId)) return json(response, 400, { error: "A safe Reporting Route Set ID is required." });
        return json(response, 200, await browserMutation(input, requestOptions, {
          message: () => `Propose reporting route set: ${payload.routeSetId}`
        }, () => proposeReportingRouteSet(input, payload)));
      }
      if (request.method === "POST" && url.pathname === "/api/reporting-route-sets/approve") {
        const payload = await readJson(request);
        if (!safeSegment(payload.routeSetId)) return json(response, 400, { error: "A safe Reporting Route Set ID is required." });
        return json(response, 200, await browserMutation(input, requestOptions, {
          message: () => `Approve reporting route set: ${payload.routeSetId}`
        }, () => approveReportingRouteSet(input, payload)));
      }
      if (request.method === "POST" && url.pathname === "/api/reporting-route-sets/cancel") {
        const payload = await readJson(request);
        if (!safeSegment(payload.routeSetId)) return json(response, 400, { error: "A safe Reporting Route Set ID is required." });
        return json(response, 200, await browserMutation(input, requestOptions, {
          message: () => `Cancel reporting route set: ${payload.routeSetId}`
        }, () => cancelReportingRouteSet(input, payload)));
      }
      if (request.method === "POST" && url.pathname === "/api/obligation-completions") {
        const payload = await readJson(request);
        if (!safeSegment(payload.obligationId)) return json(response, 400, { error: "A safe obligation ID is required." });
        const result = await browserMutation(input, requestOptions, {
          message: () => `Complete ${resourceTypeLabel(payload.record?.type)}: ${payload.record?.title || payload.obligationId}`
        }, () => completeObligationOccurrence(input, {
          obligationId: payload.obligationId,
          record: payload.record,
          content: payload.content,
          expectedRevision: requireRevision(payload.revision, `obligation/${payload.obligationId}`)
        }));
        return json(response, 201, result);
      }
      if (request.method === "POST" && url.pathname === "/api/obligation-occurrences/scaffold") {
        const payload = await readJson(request);
        if (!safeSegment(payload.obligationId)) return json(response, 400, { error: "A safe Obligation ID is required." });
        return json(response, 200, await scaffoldObligationOccurrence(input, { ...payload, programId: payload.programId || requestOptions.programId }));
      }
      if (request.method === "POST" && url.pathname === "/api/audit-population-corrections/scaffold") {
        const payload = await readJson(request);
        if (!safeSegment(payload.populationId)) return json(response, 400, { error: "A safe Audit Population ID is required." });
        return json(response, 200, await scaffoldAuditPopulationCorrection(input, payload));
      }
      if (request.method === "POST" && url.pathname === "/api/audit-population-corrections") {
        const payload = await readJson(request);
        if (!safeSegment(payload.record?.id)) return json(response, 400, { error: "A safe Audit Population correction ID is required." });
        return json(response, 201, await browserMutation(input, requestOptions, {
          message: () => `Correct audit population: ${payload.record.title || payload.record.id}`
        }, () => saveAuditPopulation(input, {
          record: payload.record,
          content: payload.content,
          expectedRevision: requireRevision(payload.revision, `audit-population/${payload.record.supersedesId}`)
        })));
      }
      if (request.method === "POST" && url.pathname === "/api/obligation-occurrences") {
        const payload = await readJson(request);
        if (!safeSegment(payload.record?.id)) return json(response, 400, { error: "A safe occurrence ID is required." });
        return json(response, 201, await browserMutation(input, requestOptions, {
          message: () => `Save obligation occurrence: ${payload.record.title || payload.record.id}`
        }, () => saveObligationOccurrence(input, {
          record: payload.record,
          programId: payload.programId || requestOptions.programId,
          content: payload.content,
          expectedRevision: payload.record?.supersedesId
            ? requireRevision(payload.revision, `obligation-occurrence/${payload.record.supersedesId}`)
            : payload.revision
        })));
      }
      if (request.method === "POST" && url.pathname === "/api/obligation-rule-activations/scaffold") {
        const payload = await readJson(request);
        if (!safeSegment(payload.ruleId)) return json(response, 400, { error: "A safe Obligation Rule ID is required." });
        return json(response, 200, await scaffoldObligationRuleActivation(input, payload));
      }
      if (request.method === "POST" && url.pathname === "/api/obligation-rule-activations") {
        const payload = await readJson(request);
        if (!safeSegment(payload.ruleId)) return json(response, 400, { error: "A safe Obligation Rule ID is required." });
        return json(response, 201, await browserMutation(input, requestOptions, {
          message: () => `Activate obligation rule: ${payload.ruleId}`
        }, () => activateObligationRule(input, payload)));
      }
      if (request.method === "POST" && url.pathname === "/api/action-completions") {
        const payload = await readJson(request);
        if (!safeSegment(payload.actionItemId)) {
          return json(response, 400, { error: "A safe Action Item ID is required." });
        }
        const result = await browserMutation(input, requestOptions, {
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
        const result = await browserMutation(input, requestOptions, {
          message: () => `Complete policy event: ${payload.eventId}`
        }, () => completeObligationEvent(input, {
          eventId: payload.eventId,
          programId: payload.programId || requestOptions.programId,
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
          const result = await browserMutation(input, requestOptions, {
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
        const result = await browserMutation(input, requestOptions, {
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
          auditId: url.searchParams.get("auditId") || undefined,
          programId: url.searchParams.get("programId") || undefined
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
        return json(response, 201, await browserMutation(input, requestOptions, {
          message: () => `Prepare audit: ${payload.auditId || "engagement"}`
        }, () => prepareAuditWorkspace(input, payload)));
      }
      if (request.method === "POST" && url.pathname === "/api/setup") {
        const payload = await readJson(request);
        const completeSetup = async () => {
          return browserMutation(input, requestOptions, {
            message: (setupResult) => `${payload.draft === true ? "Save onboarding draft" : "Complete onboarding"} for ${setupResult.workspace.organizationName}`,
            fastResponse: prefersFastMutation(request)
          }, () => setupWorkspace(input, payload));
        };
        return json(response, 200, await completeSetup());
      }
      if (request.method === "POST" && url.pathname === "/api/policy-activations") {
        const payload = await readJson(request);
        const result = await browserMutation(input, requestOptions, {
          message: (activation) => `Activate ${activation.policyIds.length} ${activation.policyIds.length === 1 ? "Policy" : "Policies"}`,
          prefetchToken: payload.prefetchToken
        }, () => activatePolicies(input, { ...payload, confirmed: true }));
        return json(response, 200, result);
      }
      if (request.method === "POST" && url.pathname === "/api/document-activations") {
        const payload = await readJson(request);
        const result = await browserMutation(input, requestOptions, {
          message: (activation) => `Activate ${activation.documentIds.length} governed ${activation.documentIds.length === 1 ? "Document" : "Documents"}`,
          prefetchToken: payload.prefetchToken
        }, () => activateDocuments(input, { ...payload, confirmed: true }));
        return json(response, 200, result);
      }
      if (request.method === "POST" && url.pathname === "/api/governed-content-activations") {
        const payload = await readJson(request);
        const result = await browserMutation(input, requestOptions, {
          message: (activation) => `Activate ${activation.resourceIds.length} governed-content ${activation.resourceIds.length === 1 ? "record" : "records"}`,
          prefetchToken: payload.prefetchToken
        }, () => activateGovernedContent(input, { ...payload, confirmed: true }));
        return json(response, 200, result);
      }
      if (request.method === "POST" && url.pathname === "/api/resources") {
        const requestPayload = await readJson(request);
        const payload = normalizeResourceMutation(requestPayload);
        const { record } = payload;
        const result = await browserMutation(input, requestOptions, {
          message: () => `Create ${resourceTypeLabel(record.type)}: ${record.title || record.id}`,
          fastResponse: prefersFastMutation(request),
          prefetchToken: requestPayload.prefetchToken
        }, () => createResource(input, record, { content: payload.content }));
        return json(response, 201, result);
      }
      if (request.method === "POST" && url.pathname === "/api/commit") {
        await requireManualBrowserGit(input, options);
        const payload = await readJson(request);
        return json(response, 201, await manualGitResultWithState(input, requestOptions, () => commitAndPushWorkspace(input, payload.message)));
      }
      if (request.method === "POST" && url.pathname === "/api/git/pull") {
        await requireManualBrowserGit(input, options);
        return json(response, 200, await manualGitResultWithState(input, requestOptions, () => pullWorkspace(input)));
      }
      if (request.method === "POST" && url.pathname === "/api/git/push") {
        await requireManualBrowserGit(input, options);
        return json(response, 200, await manualGitResultWithState(input, requestOptions, () => pushWorkspace(input)));
      }
      if (request.method === "POST" && url.pathname === "/api/git/retry-sync") {
        const result = await manualGitResultWithState(input, requestOptions, () => (
          retryBrowserSync(input, {
            allowNonAuthoritativeWrites: options.allowNonAuthoritativeWrites
          })
        ));
        return json(response, 200, result);
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
      if (request.method === "GET" && url.pathname === "/api/review-revisions") {
        const ids = [...new Set(url.searchParams.getAll("id"))];
        if (!ids.length || ids.some((id) => !safeSegment(id))) {
          return json(response, 400, { error: "Pass one or more safe resource IDs." });
        }
        const loaded = await loadWorkspace(input);
        const revisions = await resourceReviewRevisions(loaded, ids);
        const missing = ids.filter((id) => !revisions.has(id));
        if (missing.length) return json(response, 404, { error: `Resources not found: ${missing.join(", ")}.` });
        return json(response, 200, { revisions: Object.fromEntries(revisions) });
      }
      if (request.method === "PUT" && url.pathname === "/api/content") {
        const payload = await readJson(request);
        const result = await browserMutation(input, requestOptions, {
          message: () => `Update content: ${payload.path}`,
          fastResponse: prefersFastMutation(request),
          prefetchToken: payload.prefetchToken
        }, () => updateContent(input, payload.path, payload.source, {
          expectedRevision: requireRevision(payload.revision, `content/${payload.path}`)
        }));
        return json(response, 200, {
          ...result,
          ...(result.stateRefresh ? { html: renderMarkdown(result.source) } : {})
        });
      }
      const match = /^\/api\/resource\/([^/]+)\/([^/]+)$/.exec(url.pathname);
      if (match) {
        const type = decodeURIComponent(match[1]);
        const id = decodeURIComponent(match[2]);
        if (!safeSegment(type) || !safeSegment(id)) return json(response, 400, { error: "Unsafe resource identifier." });
        if (request.method === "GET") {
          const token = url.searchParams.get("token");
          pruneStateSessions(stateSessions);
          const session = token ? stateSessions.get(token) : null;
          if (token && !session) return json(response, 409, { error: "The workspace state expired. Reload it and try again." });
          const includeWorkflow = url.searchParams.get("workflow") === "true";
          const historyOnly = url.searchParams.get("history") === "only";
          if (historyOnly) {
            const history = session
              ? await loadStateSessionResourceHistory(session, token, type, id, options)
              : await createResourceHistory(input, type, id);
            if (!history) return json(response, 404, { error: "Resource not found." });
            return json(response, 200, history);
          }
          const entry = session
            ? await loadStateSessionResource(session, token, type, id, options, requestOptions.programId, includeWorkflow, url.searchParams.get("history") !== "false")
            : await createResourceDetail(input, type, id, { includeHistory: url.searchParams.get("history") !== "false" });
          if (!entry) return json(response, 404, { error: "Resource not found." });
          if (includeWorkflow && !session) {
            const workflow = await assessWorkflow(input, { programId: requestOptions.programId });
            entry.workflow = workflowForResource(workflow, type, id);
          }
          return json(response, 200, entry);
        }
        if (request.method === "PUT") {
          const requestPayload = await readJson(request);
          const payload = normalizeResourceMutation(requestPayload, { requireRevision: true });
          const { record } = payload;
          const result = await browserMutation(input, requestOptions, {
            message: () => `Update ${resourceTypeLabel(type)}: ${record.title || id}`,
            fastResponse: prefersFastMutation(request),
            prefetchToken: requestPayload.prefetchToken
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
          const result = await browserMutation(input, requestOptions, {
            message: () => `Delete ${resourceTypeLabel(type)}: ${id}`,
            prefetchToken: url.searchParams.get("prefetchToken") || undefined
          }, () => deleteResource(input, type, id, { expectedRevision: revision }));
          return json(response, 200, {
            deleted: true,
            type,
            id,
            deletedContent: result.deletedContent,
            synchronization: result.synchronization,
            workflowDelta: result.workflowDelta,
            state: result.state,
            stateRefresh: result.stateRefresh
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

async function stableStateSnapshot(input, options) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const first = await fingerprintWorkspace(input, {
      fileDigestCache: options.fileDigestCache,
      deadlineAt: options.deadlineAt
    });
    const firstRepositorySignature = await getRepositoryStateSignature(input, {
      timeoutMs: Math.max(1, Math.ceil(options.deadlineAt - performance.now()))
    });
    const second = await fingerprintWorkspace(input, {
      fileDigestCache: options.fileDigestCache,
      deadlineAt: options.deadlineAt
    });
    const secondRepositorySignature = await getRepositoryStateSignature(input, {
      timeoutMs: Math.max(1, Math.ceil(options.deadlineAt - performance.now()))
    });
    if (
      first.fingerprint === second.fingerprint
      && firstRepositorySignature === secondRepositorySignature
    ) return [second, secondRepositorySignature];
  }
  throw stateSessionExpiredError();
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
    backgroundPushDelayMs: options.backgroundPushDelayMs,
    stateSectionDeadlineMs: options.stateSectionDeadlineMs,
    resourceDetailDeadlineMs: options.resourceDetailDeadlineMs
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

function browserMutation(input, requestOptions, mutationOptions, task) {
  const run = () => serializeWorkspaceMutation(input, async (root) => {
    const fastResponse = mutationOptions.fastResponse ?? requestOptions.fastResponse;
    const workflowBefore = fastResponse
      ? null
      : await measureTiming("workflow-before", () => assessWorkflow(root, { programId: requestOptions.programId }));
    let result;
    requestOptions.beginStateMutation?.();
    try {
      result = await measureTiming("mutation", () => runBrowserMutation(root, {
        ...mutationOptions,
        allowNonAuthoritativeWrites: requestOptions.allowNonAuthoritativeWrites === true,
        backgroundPushDelayMs: requestOptions.backgroundPushDelayMs,
        includeValidationProof: !fastResponse
      }, task));
    } finally {
      requestOptions.endStateMutation?.();
    }
    if (fastResponse) {
      return {
        ...result,
        stateRefresh: true
      };
    }
    const state = await measureTiming("state", () => createAppState(root, {
      allowNonAuthoritativeWrites: requestOptions.allowNonAuthoritativeWrites,
      programId: requestOptions.programId,
      includeDetails: false,
      validationProof: result?.[BROWSER_VALIDATION]
    }));
    if (result?.synchronization) {
      result.synchronization = reconcileMutationSynchronization(result.synchronization, state.repository);
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

export function reconcileMutationSynchronization(synchronization, repository) {
  if (synchronization?.status !== "syncing" || repository.status === "syncing") return synchronization;
  const backgroundFailed = repository.backgroundSynchronization?.status === "failed";
  if (repository.status !== "synced" && !backgroundFailed) {
    // A repository snapshot can finish just before a fast background push while
    // its state is inspected just after the push. Keep the queued result until
    // a verified success or failure replaces it.
    return synchronization;
  }
  return {
    ...synchronization,
    status: repository.status === "synced" ? "synced" : "not-synced",
    synchronizedAt: repository.lastSuccessfulSynchronization ?? null,
    pushError: repository.backgroundSyncError
      ?? repository.backgroundSynchronization?.error
      ?? null
  };
}

async function loadStateSessionSection(session, section, serverOptions, programId, verificationContext = null, deadlineAt) {
  const requestStartedAt = performance.now();
  assertCurrentStateSession(session);
  const selectedProgramId = section === "repository"
    ? null
    : resolveProgram(session.loaded, programId).id;
  const cacheKey = section === "repository" ? section : `${section}:${selectedProgramId}`;
  const ownsVerification = verificationContext === null;
  const sharedVerification = verificationContext || {};
  let calculationEntry = session.promises.get(cacheKey);
  if (!calculationEntry) {
    makeStateSessionCalculationRoom(session);
    const dependencies = section === "workflow"
      ? Promise.all([
          loadStateSessionSection(session, "repository", serverOptions, programId, sharedVerification, deadlineAt),
          loadStateSessionSection(session, "program", serverOptions, programId, sharedVerification, deadlineAt),
          loadStateSessionSection(session, "obligations", serverOptions, programId, sharedVerification, deadlineAt),
          loadStateSessionSection(session, "audits", serverOptions, programId, sharedVerification, deadlineAt)
        ])
      : section === "audits"
        ? Promise.all([loadStateSessionSection(session, "program", serverOptions, programId, sharedVerification, deadlineAt)])
        : Promise.resolve([]);
    calculationEntry = { promise: null, completedAt: null, deadlineAt };
    calculationEntry.promise = dependencies.then((results) => {
      const repository = section === "workflow" ? results[0] : null;
      const program = section === "workflow" ? results[1] : section === "audits" ? results[0] : null;
      const obligations = section === "workflow" ? results[2] : null;
      const audits = section === "workflow" ? results[3] : null;
      return withGitCommandCache(session.gitCommandCache, () => createAppStateSection(session.loaded, section, {
        allowNonAuthoritativeWrites: serverOptions.allowNonAuthoritativeWrites,
        generatedAt: session.generatedAt,
        programReadiness: program?.programReadiness,
        auditPreparations: audits?.auditPreparations,
        obligations: obligations?.obligations,
        git: repository?.git,
        validation: repository?.validation,
        strictHistory: repository?.git?.available === true,
        programId: selectedProgramId || programId
      }));
    }).then((state) => {
      calculationEntry.completedAt = performance.now();
      return state;
    }).catch((error) => {
      if (session.promises.get(cacheKey) === calculationEntry) session.promises.delete(cacheKey);
      throw error;
    });
    session.promises.set(cacheKey, calculationEntry);
  } else if (calculationEntry.completedAt !== null) {
    session.promises.delete(cacheKey);
    session.promises.set(cacheKey, calculationEntry);
  }
  let state;
  try {
    state = await awaitWithinDeadline(calculationEntry.promise, deadlineAt);
  } catch (error) {
    if (error?.code === "FILEGRC_GIT_DEADLINE"
      && calculationEntry.deadlineAt !== deadlineAt
      && deadlineAt !== undefined
      && performance.now() < deadlineAt) {
      return loadStateSessionSection(
        session,
        section,
        serverOptions,
        programId,
        verificationContext,
        deadlineAt
      );
    }
    throw error;
  }
  if (ownsVerification) {
    await verifyStateSessionSnapshot(session, Math.max(requestStartedAt, calculationEntry.completedAt || 0), deadlineAt);
  }
  return state;
}

async function loadStateSessionResource(session, token, type, id, serverOptions, programId, includeWorkflow, includeHistory = true) {
  assertCurrentStateSession(session);
  const detailDeadlineMs = Number.isFinite(serverOptions.resourceDetailDeadlineMs)
    ? Math.max(0, serverOptions.resourceDetailDeadlineMs)
    : RESOURCE_DETAIL_GIT_DEADLINE_MS;
  const deadlineAt = performance.now() + detailDeadlineMs;
  return withGitCommandDeadline(deadlineAt, async () => {
    const detail = await withGitCommandCache(session.gitCommandCache, () => createResourceDetail(session.loaded, type, id, {
      historyDeadlineAt: deadlineAt,
      includeHistory
    }));
    if (detail && includeWorkflow) {
      const repository = await loadStateSessionSection(
        session,
        "repository",
        serverOptions,
        programId,
        {},
        deadlineAt
      );
      const workflow = await withGitCommandCache(session.gitCommandCache, () => assessWorkflow(session.loaded, {
        programId,
        historyDeadlineAt: deadlineAt,
        strictHistory: repository?.git?.available === true
      }));
      detail.workflow = workflowForResource(workflow, type, id);
    }
    await verifyStateSessionSnapshot(session, performance.now(), deadlineAt);
    assertCurrentStateSession(session);
    return detail ? { ...detail, stateToken: token } : null;
  });
}

async function loadStateSessionResourceHistory(session, token, type, id, serverOptions) {
  assertCurrentStateSession(session);
  const detailDeadlineMs = Number.isFinite(serverOptions.resourceDetailDeadlineMs)
    ? Math.max(0, serverOptions.resourceDetailDeadlineMs)
    : RESOURCE_DETAIL_GIT_DEADLINE_MS;
  const deadlineAt = performance.now() + detailDeadlineMs;
  return withGitCommandDeadline(deadlineAt, async () => {
    const history = await withGitCommandCache(session.gitCommandCache, () => createResourceHistory(session.loaded, type, id, {
      historyDeadlineAt: deadlineAt
    }));
    await verifyStateSessionSnapshot(session, performance.now(), deadlineAt);
    assertCurrentStateSession(session);
    return history ? { ...history, stateToken: token } : null;
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

async function manualGitResultWithState(input, requestOptions, task) {
  let result;
  requestOptions.beginStateMutation?.();
  try {
    result = await task();
  } finally {
    requestOptions.endStateMutation?.();
  }
  const state = await createAppState(input, {
    allowNonAuthoritativeWrites: requestOptions.allowNonAuthoritativeWrites,
    programId: requestOptions.programId,
    includeDetails: false
  });
  return { ...result, state };
}

function pruneStateSessions(stateSessions, now = Date.now()) {
  for (const [token, session] of stateSessions) {
    if (session.revoked || session.expiresAt <= now) {
      session.revoked = true;
      stateSessions.delete(token);
    }
  }
}

function invalidateStateSessions(stateSessions) {
  for (const session of stateSessions.values()) session.revoked = true;
  stateSessions.clear();
}

function assertCurrentStateSession(session) {
  if (session.revoked || session.expiresAt <= Date.now()) throw stateSessionExpiredError();
}

function stateSessionExpiredError() {
  const error = new Error("The workspace state expired. Reload it and try again.");
  error.code = "FILEGRC_STATE_EXPIRED";
  return error;
}

function stateSessionCapacityError() {
  const error = new Error("The workspace state has too many calculations in progress. Reload it and try again.");
  error.code = "FILEGRC_STATE_CAPACITY";
  return error;
}

function makeStateSessionCalculationRoom(session) {
  const pending = [...session.promises.values()].filter(({ completedAt }) => completedAt === null).length;
  if (pending >= MAX_STATE_SESSION_PROMISES) throw stateSessionCapacityError();
  while (session.promises.size >= MAX_STATE_SESSION_PROMISES) {
    const completedKey = [...session.promises].find(([, entry]) => entry.completedAt !== null)?.[0];
    if (completedKey === undefined) throw stateSessionCapacityError();
    session.promises.delete(completedKey);
  }
}

function assertStateSessionFingerprint(session, fingerprint) {
  if (fingerprint === session.fingerprint) return;
  session.revoked = true;
  throw stateSessionExpiredError();
}

async function verifyStateSessionSnapshot(session, notBefore = 0, deadlineAt) {
  assertCurrentStateSession(session);
  while (session.verificationPromise) {
    const current = session.verificationPromise;
    if (current.startedAt >= notBefore) {
      try {
        return await awaitWithinDeadline(current.promise, deadlineAt);
      } catch (error) {
        if (!replaceableVerificationError(error)
          || error.source === "caller-deadline"
          || current.deadlineAt === deadlineAt
          || deadlineAt === undefined
          || performance.now() >= deadlineAt) throw error;
        if (session.verificationPromise === current) session.verificationPromise = null;
        assertCurrentStateSession(session);
        continue;
      }
    }
    try {
      await awaitWithinDeadline(current.promise, deadlineAt);
      assertCurrentStateSession(session);
    } catch (error) {
      if (!replaceableVerificationError(error)
        || error.source === "caller-deadline"
        || current.deadlineAt === deadlineAt
        || deadlineAt === undefined
        || performance.now() >= deadlineAt) throw error;
      if (session.verificationPromise === current) session.verificationPromise = null;
      assertCurrentStateSession(session);
      continue;
    }
  }
  const verification = { startedAt: Number.POSITIVE_INFINITY, promise: null, deadlineAt };
  verification.promise = (async () => {
    // Let concurrent section requests join the same future verification. Once
    // file reads begin, callers whose calculation finishes later must wait for
    // a new pass.
    await new Promise((resolve) => setImmediate(resolve));
    verification.startedAt = performance.now();
    return Promise.all([
      fingerprintWorkspace(session.loaded.root, {
        fileDigestCache: session.fileDigestCache,
        deadlineAt
      }),
      getRepositoryStateSignature(session.loaded.root, {
        timeoutMs: deadlineAt === undefined ? undefined : Math.max(1, Math.ceil(deadlineAt - performance.now()))
      })
    ]);
  })().then(([snapshot, repositorySignature]) => {
    assertStateSessionFingerprint(session, snapshot.fingerprint);
    if (repositorySignature !== session.repositorySignature) {
      session.revoked = true;
      throw stateSessionExpiredError();
    }
    assertCurrentStateSession(session);
    return { ...snapshot, repositorySignature };
  }).finally(() => {
    if (session.verificationPromise === verification) session.verificationPromise = null;
  });
  session.verificationPromise = verification;
  return awaitWithinDeadline(verification.promise, deadlineAt);
}

function awaitWithinDeadline(promise, deadlineAt) {
  if (deadlineAt === undefined) return promise;
  const remaining = Math.ceil(deadlineAt - performance.now());
  if (remaining <= 0) {
    promise.catch(() => {});
    return Promise.reject(gitDeadlineError());
  }
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(gitDeadlineError()), remaining);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function gitDeadlineError() {
  const error = new Error("The shared Git request deadline expired.");
  error.code = "FILEGRC_GIT_DEADLINE";
  error.source = "caller-deadline";
  return error;
}

function replaceableVerificationError(error) {
  return ["FILEGRC_GIT_DEADLINE", "FILEGRC_FINGERPRINT_BUDGET"].includes(error?.code);
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
  const fetchSite = String(request.headers["sec-fetch-site"] || "").toLowerCase();
  if (fetchSite === "same-origin") return true;
  if (fetchSite && fetchSite !== "none") return false;
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const expectedProtocol = request.socket.encrypted ? "https:" : "http:";
    return new URL(origin).origin === `${expectedProtocol}//${request.headers.host}`;
  } catch {
    return false;
  }
}

function sameOriginBrowserRead(request) {
  const fetchSite = String(request.headers["sec-fetch-site"] || "").toLowerCase();
  if (fetchSite) return ["same-origin", "none"].includes(fetchSite);
  if (!sameOrigin(request)) return false;
  const referrer = request.headers.referer;
  if (!referrer) return true;
  try {
    return new URL(referrer).host === request.headers.host;
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
  if (error?.code === "FILEGRC_STATE_EXPIRED") return 409;
  if (error?.code === "FILEGRC_STATE_CAPACITY") return 429;
  if (error?.code === "FILEGRC_FINGERPRINT_BUDGET") return 503;
  if (error?.code === "FILEGRC_GIT_HISTORY_UNAVAILABLE") return 503;
  if (error?.code === "FILEGRC_GIT_DEADLINE") return 503;
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
