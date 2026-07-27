import { createServer as createHttpServer } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { getResourceDefinition } from "../model/index.js";
import { prepareAuditWorkspace } from "./audit-preparation.js";
import { generateEvidencePacket, prepareEvidencePacket } from "./evidence-packet.js";
import { FAVICON_PNG } from "./favicon.js";
import { createResource, deleteResource, updateContent, updateResource } from "./files.js";
import { commitAndPushWorkspace, getFileHistory, pullWorkspace, pushWorkspace } from "./git.js";
import { completeObligationOccurrence, createObligationEvent, planObligations } from "./obligations.js";
import { isWithin, relativeToWorkspace, resolveWorkspacePath } from "./paths.js";
import { createAppState } from "./state.js";
import { loadWorkspace } from "./workspace.js";
import { APP_SCRIPT, APP_STYLES, renderIndex } from "./web.js";

export function createFileGRCServer(input = process.cwd(), options = {}) {
  return createHttpServer(async (request, response) => {
    try {
      if (!expectedHost(request, options.allowedHosts)) {
        return json(response, 403, { error: "The request host is not allowed." });
      }
      const url = new URL(request.url, "http://localhost");
      if (["POST", "PUT", "DELETE"].includes(request.method) && !sameOrigin(request)) {
        return json(response, 403, { error: "Cross-origin writes are not allowed." });
      }
      if (request.method === "GET" && url.pathname === "/api/state") {
        return json(response, 200, await createAppState(input));
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
          includeComplete: url.searchParams.get("includeComplete") === "true"
        }));
      }
      if (request.method === "POST" && url.pathname === "/api/obligation-events") {
        return json(response, 201, await createObligationEvent(input, await readJson(request)));
      }
      if (request.method === "POST" && url.pathname === "/api/obligation-completions") {
        const payload = await readJson(request);
        if (!safeSegment(payload.obligationId)) return json(response, 400, { error: "A safe obligation ID is required." });
        const result = await completeObligationOccurrence(input, {
          obligationId: payload.obligationId,
          record: payload.record,
          content: payload.content,
          expectedRevision: payload.revision
        });
        return json(response, 201, result);
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
        return json(response, 201, await prepareAuditWorkspace(input, await readJson(request)));
      }
      if (request.method === "POST" && url.pathname === "/api/resources") {
        const payload = await readJson(request);
        const record = payload.record ?? payload;
        const result = await createResource(input, record, { content: payload.record ? payload.content : undefined });
        return json(response, 201, { record: result.record });
      }
      if (request.method === "POST" && url.pathname === "/api/commit") {
        const payload = await readJson(request);
        return json(response, 201, await commitAndPushWorkspace(input, payload.message));
      }
      if (request.method === "POST" && url.pathname === "/api/git/pull") {
        return json(response, 200, await pullWorkspace(input));
      }
      if (request.method === "POST" && url.pathname === "/api/git/push") {
        return json(response, 200, await pushWorkspace(input));
      }
      if (request.method === "PUT" && url.pathname === "/api/content") {
        const payload = await readJson(request);
        const result = await updateContent(input, payload.path, payload.source, { expectedRevision: payload.revision });
        return json(response, 200, { path: result.dataRelativePath });
      }
      const match = /^\/api\/resource\/([^/]+)\/([^/]+)$/.exec(url.pathname);
      if (match) {
        const type = decodeURIComponent(match[1]);
        const id = decodeURIComponent(match[2]);
        if (!safeSegment(type) || !safeSegment(id)) return json(response, 400, { error: "Unsafe resource identifier." });
        if (request.method === "GET") {
          const state = await createAppState(input);
          const entry = state.resources.find(({ record }) => record.type === type && record.id === id);
          return entry ? json(response, 200, entry) : json(response, 404, { error: "Resource not found." });
        }
        if (request.method === "PUT") {
          const payload = await readJson(request);
          const record = payload.record ?? payload;
          const result = await updateResource(input, type, id, record, {
            content: payload.record ? payload.content : undefined,
            expectedRevision: payload.revision,
            expectedContentRevisions: payload.contentRevisions
          });
          return json(response, 200, { record: result.record });
        }
        if (request.method === "DELETE") {
          const result = await deleteResource(input, type, id, { expectedRevision: url.searchParams.get("revision") });
          return json(response, 200, { deleted: true, type, id, deletedContent: result.deletedContent });
        }
      }
      if (request.method === "GET" && url.pathname === "/favicon.png") return text(response, 200, FAVICON_PNG, "image/png");
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
  const server = createFileGRCServer(loaded.root, { allowedHosts: [host] });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  return {
    server,
    root: loaded.root,
    address: server.address(),
    url: `http://${urlHost(host)}:${server.address().port}`
  };
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
  if (/changed after you opened|source changed|revision changed/i.test(error.message)) return 409;
  if (/already exists|target file already exists/i.test(error.message)) return 409;
  if (/Git could not (?:pull|push)|upstream branch|multiple remotes|no Git remote|check out a branch|before trying to (?:pull|push)/i.test(error.message)) return 409;
  if (/not found|ENOENT/i.test(error.message)) return 404;
  if (/invalid|required|unsafe|match|workspace|singleton|commit message|no changes|git history|git user|unknown resource type|must use|must be|content path|data path|path leaves|valid .*date|not found|no active obligations|end date|through date|already exists|EEXIST/i.test(error.message)) return 400;
  return 500;
}

function publicErrorMessage(error, status) {
  if (error?.code === "ENOENT") return "The requested file was not found.";
  if (status === 500) return "The server could not complete the request.";
  return error.message;
}
