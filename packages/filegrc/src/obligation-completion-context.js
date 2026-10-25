import { reviewHistoryContext, reviewHistoricalWorkspace, reviewHistoryCommits } from "./historical-workspace.js";

// Reassess a committed reconciliation against the source facts that were
// committed with it, so later provider or grant changes do not reopen history.
// New or edited reconciliations and completion records use current facts.
export function occurrenceCompletionContext(root, occurrence, completion, model, resources, timezone) {
  const current = { model, resources, workspace: { timezone } };
  if (!root || !["reconciled", "superseded"].includes(occurrence.status) || completion.type !== "access-review") return current;
  const context = reviewHistoryContext(root, resources);
  const history = context.index?.available
    ? context.index.historiesById.get(occurrence.id) || []
    : reviewHistoryCommits(context).map((commit) => ({ commit }));
  for (const { commit } of [...history].reverse()) {
    const loaded = reviewHistoricalWorkspace(context, commit);
    const prior = loaded?.byId.get(occurrence.id);
    const priorCompletion = loaded?.byId.get(completion.id);
    if (prior?.status === "reconciled" && JSON.stringify(prior) === JSON.stringify({ ...occurrence, status: "reconciled" })
      && JSON.stringify(priorCompletion) === JSON.stringify(completion)) return loaded;
  }
  return current;
}
