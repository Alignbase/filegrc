import { AsyncLocalStorage } from "node:async_hooks";
import { resolveWorkspaceRoot } from "./paths.js";

const mutationQueues = new Map();
const activeMutation = new AsyncLocalStorage();

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
