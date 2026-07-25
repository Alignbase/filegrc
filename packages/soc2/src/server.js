import { createServer as createHttpServer } from "node:http";
import { getResourceDefinition } from "../model/index.js";
import { createResource, deleteResource, updateContent, updateResource } from "./files.js";
import { getFileHistory } from "./git.js";
import { createAppState } from "./state.js";
import { loadWorkspace } from "./workspace.js";
import { APP_SCRIPT, APP_STYLES, renderIndex } from "./web.js";

export function createSoc2Server(input = process.cwd()) {
  return createHttpServer(async (request, response) => {
    try {
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
      if (request.method === "POST" && url.pathname === "/api/resources") {
        const payload = await readJson(request);
        const record = payload.record ?? payload;
        const result = await createResource(input, record, { content: payload.record ? payload.content : undefined });
        return json(response, 201, { record: result.record });
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
      if (request.method === "GET" && url.pathname === "/soc2-app.js") return text(response, 200, APP_SCRIPT, "text/javascript; charset=utf-8");
      if (request.method === "GET" && url.pathname === "/soc2.css") return text(response, 200, APP_STYLES, "text/css; charset=utf-8");
      if (request.method === "GET" && !url.pathname.startsWith("/api/")) return text(response, 200, renderIndex(), "text/html; charset=utf-8");
      json(response, 404, { error: "Not found." });
    } catch (error) {
      json(response, statusFor(error), { error: error.message });
    }
  });
}

export async function serveWorkspace(input = process.cwd(), options = {}) {
  const host = options.host ?? "127.0.0.1";
  const port = Number(options.port ?? 8787);
  const loaded = await loadWorkspace(input);
  getResourceDefinition(loaded.model, "workspace");
  const server = createSoc2Server(loaded.root);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  return {
    server,
    root: loaded.root,
    address: server.address(),
    url: `http://${host}:${server.address().port}`
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
  return JSON.parse(source);
}

function json(response, status, value) {
  text(response, status, `${JSON.stringify(value, null, 2)}\n`, "application/json; charset=utf-8");
}

function text(response, status, value, contentType) {
  response.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
  });
  response.end(value);
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

function statusFor(error) {
  if (error instanceof SyntaxError) return 400;
  if (/exceeds 2 MB/i.test(error.message)) return 413;
  if (/changed after you opened/i.test(error.message)) return 409;
  if (/already exists|target file already exists/i.test(error.message)) return 409;
  if (/not found|ENOENT/i.test(error.message)) return 404;
  if (/invalid|required|unsafe|match|workspace|unknown resource type|must use|must be|content path|data path|path leaves/i.test(error.message)) return 400;
  return 500;
}
