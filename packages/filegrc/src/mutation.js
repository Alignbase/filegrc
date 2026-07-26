import { resolveWorkspaceRoot } from "./paths.js";

const mutationQueues = new Map();

export function serializeWorkspaceMutation(input, task) {
  const root = resolveWorkspaceRoot(input);
  const previous = mutationQueues.get(root) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(() => task(root));
  let tracked;
  tracked = run.finally(() => {
    if (mutationQueues.get(root) === tracked) mutationQueues.delete(root);
  });
  mutationQueues.set(root, tracked);
  return tracked;
}
