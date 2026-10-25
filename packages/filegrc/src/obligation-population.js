import { currentCalendarDate } from "./time.js";
import { coverageStart } from "./coverage.js";
import { calculationMemo } from "./calculation-cache.js";
import { selectScopedCollectionRecords } from "./collection-scope.js";
import { getGitSummary, getRecordIdentityHistory, isDataHistoryAncestor } from "./git.js";
import { reviewHistoricalWorkspace, reviewHistoryCommits, reviewHistoryContext } from "./historical-workspace.js";

const IDENTITY = ["programId", "obligationId", "ruleId", "occurrenceKey", "membershipCutoffAt"];
const sameIds = (left, right) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
const sameWindow = (left, right) => left?.type === "obligation-occurrence"
  && IDENTITY.every((key) => left[key] === right[key])
  && JSON.stringify(left.coverage) === JSON.stringify(right.coverage);
const selectorKey = (selector) => JSON.stringify({ ...selector,
  ...(selector?.statuses ? { statuses: [...selector.statuses].sort() } : {}),
  ...(selector?.criticalities ? { criticalities: [...selector.criticalities].sort() } : {}) });

// Open windows accumulate actual reviewed membership. A later retirement must
// not erase that work, but merely writing an unrelated ID into a JSON file
// does not establish eligibility. Recover only valid same-window snapshots.
export function committedOccurrencePopulation(loaded, occurrence, selector, throughCommit = null) {
  if (!loaded.root || !occurrence || !selector) return { memberIds: [], established: false };
  return calculationMemo(loaded.resources, "committed-occurrence-population", [occurrence.id,
    JSON.stringify(IDENTITY.map((key) => occurrence[key])), JSON.stringify(occurrence.coverage), selectorKey(selector), throughCommit], () => {
    const bound = throughCommit || getGitSummary(loaded.root).commit;
    const context = reviewHistoryContext(loaded.root, loaded);
    const commits = reviewHistoryCommits(context);
    const identities = new Set();
    let basis = occurrence;
    while (sameWindow(basis, occurrence) && !identities.has(basis.id)) {
      identities.add(basis.id);
      basis = loaded.resources.find(({ id }) => id === basis.supersedesId);
    }
    const changed = new Map([...identities].flatMap((id) => (
      context.index?.available ? context.index.historiesById.get(id) || [] : getRecordIdentityHistory(loaded.root, id)
    )).map((summary) => [summary.commit, summary]));
    const members = new Set();
    let established = false;
    for (const commit of commits) {
      if (!changed.has(commit) || !isDataHistoryAncestor(loaded, commit, bound)) continue;
      const snapshot = reviewHistoricalWorkspace(context, commit);
      if (!snapshot) continue;
      const program = snapshot.resources.find(({ id }) => id === occurrence.programId);
      const rule = snapshot.resources.find(({ id }) => id === occurrence.ruleId);
      if (selectorKey(rule?.selector) !== selectorKey(selector)) continue;
      const recordedAt = new Date(changed.get(commit).timestamp);
      if (Number.isNaN(recordedAt.getTime())) continue;
      const recordedOn = currentCalendarDate(rule?.timezone || snapshot.workspace.timezone || "UTC", recordedAt);
      if (recordedOn < coverageStart(occurrence.coverage) || recordedOn > occurrence.membershipCutoffAt) continue;
      const eligible = new Set(selectScopedCollectionRecords(snapshot, selector, program).map(({ id }) => id));
      for (const prior of snapshot.resources.filter((item) => identities.has(item.id) && item.status === "open" && sameWindow(item, occurrence))) {
        const ids = (prior.members || []).map(({ resourceId }) => resourceId);
        if (new Set(ids).size !== ids.length || [...members].some((id) => !ids.includes(id))
          || ids.some((id) => !eligible.has(id) && !members.has(id))
          || !established && !sameIds(ids, eligible)) continue;
        established = true;
        ids.forEach((id) => members.add(id));
      }
    }
    return { memberIds: [...members].sort(), established };
  });
}

export function occurrenceSelectorPopulation(loaded, occurrence, selector, program, { selectedIds = null, throughCommit = null } = {}) {
  const currentIds = selectedIds || selectScopedCollectionRecords(loaded, selector, program).map(({ id }) => id);
  const committed = committedOccurrencePopulation(loaded, occurrence, selector, throughCommit);
  return { ...committed, currentIds: [...currentIds].sort(),
    expectedIds: [...new Set([...currentIds, ...committed.memberIds])].sort() };
}
