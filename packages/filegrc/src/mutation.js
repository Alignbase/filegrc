import { AsyncLocalStorage } from "node:async_hooks";
import { resolveWorkspaceRoot } from "./paths.js";

const mutationQueues = new Map();
const activeMutation = new AsyncLocalStorage();
const deferredValidation = new AsyncLocalStorage();

export function serializeWorkspaceMutation(input, task) {
  const root = resolveWorkspaceRoot(input);
  if (activeMutation.getStore() === root) return task(root);
  const previous = mutationQueues.get(root) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(() => activeMutation.run(root, () => task(root)));
  let tracked;
  tracked = run.finally(() => {
    if (mutationQueues.get(root) === tracked) mutationQueues.delete(root);
  });
  mutationQueues.set(root, tracked);
  return tracked;
}

export function withDeferredWorkspaceValidation(task) {
  return deferredValidation.run(true, task);
}

export function workspaceValidationDeferred() {
  return deferredValidation.getStore() === true;
}

export function normalizeResourceMutation(value, options = {}) {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error("A { record, content, revision, contentRevisions } mutation object is required.");
  }
  if (!Object.hasOwn(value, "record")) {
    throw new Error("A mutation envelope with a record property is required.");
  }
  if (!value.record || Array.isArray(value.record) || typeof value.record !== "object") {
    throw new Error("Mutation record must be a JSON object.");
  }
  if (value.content !== undefined && (Array.isArray(value.content) || typeof value.content !== "object" || value.content === null)) {
    throw new Error("Mutation content must be an object keyed by Markdown slot.");
  }
  if (value.revision !== undefined && typeof value.revision !== "string") {
    throw new Error("Mutation revision must be a string.");
  }
  if (options.requireRevision && (typeof value.revision !== "string" || value.revision.length === 0)) {
    throw new Error("Mutation revision is required when updating a resource.");
  }
  if (
    value.contentRevisions !== undefined
    && (Array.isArray(value.contentRevisions) || typeof value.contentRevisions !== "object" || value.contentRevisions === null)
  ) {
    throw new Error("Mutation contentRevisions must be an object keyed by data-relative Markdown path.");
  }
  return {
    record: value.record,
    content: value.content,
    revision: value.revision,
    contentRevisions: value.contentRevisions
  };
}
