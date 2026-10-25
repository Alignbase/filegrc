import { getDataRecordHistoryIndex, isDataHistoryAncestor } from "./git.js";
import { reviewHistoryContext, reviewHistoricalWorkspace } from "./historical-workspace.js";
import { currentCalendarDate, isRfc3339Timestamp } from "./time.js";
import { personWasActiveOn } from "./soc2.js";

const VERIFICATION_FIELDS = new Set(["status", "verifiedOn", "verifiedAt", "verifierIds"]);
const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

// Finalized decisions bind the observation. A later first independent
// verification may add only its own metadata, which then becomes immutable.
export function evidenceObservationMatches(original, current, loaded = null, reliedOnCommit = null) {
  if (!original || !current) return false;
  const index = loaded ? getDataRecordHistoryIndex(loaded.root) : null;
  if (loaded && original.status === "collected" && !index.available) return false;
  let verificationCommit = null, verificationTimestamp = null;
  if (original.status === "collected" && loaded && reliedOnCommit) {
    for (const version of [...(index.historiesById.get(original.id) || [])].reverse()) {
      if (!isDataHistoryAncestor(loaded, reliedOnCommit, version.commit)) continue;
      const record = index.recordsByCommit.get(version.commit)?.get(original.id)?.record;
      if (record?.status === "verified") {
        if (!same(record, current)) return false;
        verificationCommit = version.commit;
        verificationTimestamp = version.timestamp;
        break;
      }
    }
  }
  if (same(original, current)) return true;
  if (original.type !== "evidence" || current.type !== "evidence"
    || original.status !== "collected" || current.status !== "verified") return false;
  if (![...new Set([...Object.keys(original), ...Object.keys(current)])]
    .every((key) => VERIFICATION_FIELDS.has(key) || same(original[key], current[key]))) return false;
  // Existing metadata is never replaced, even on a collected observation.
  for (const key of ["verifiedOn", "verifiedAt", "verifierIds"]) {
    const prior = original[key];
    const empty = prior === undefined || prior === null || (key === "verifierIds" && Array.isArray(prior) && !prior.length);
    if (!empty && !same(prior, current[key])) return false;
  }
  if (!loaded) return true;
  const context = verificationCommit
    ? reviewHistoricalWorkspace(reviewHistoryContext(loaded.root, loaded), verificationCommit) : loaded;
  if (!context) return false;
  const timezone = context.workspace.timezone;
  // Git records whole seconds; allow the subsecond part of that same instant.
  const now = verificationTimestamp ? new Date(new Date(verificationTimestamp).getTime() + 999) : new Date();
  const today = currentCalendarDate(timezone, now);
  const verifiers = current.verifierIds;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(current.verifiedOn || "")
    || current.verifiedOn < original.collectedOn || current.verifiedOn > today
    || !Array.isArray(verifiers) || !verifiers.length
    || verifiers.some((id) => (original.collectorIds || []).includes(id)
      || !personWasActiveOn(context.resources.find((record) => record.id === id), current.verifiedOn))) return false;
  if (current.verifiedAt && (!isRfc3339Timestamp(current.verifiedAt)
    || new Date(current.verifiedAt) > now
    || currentCalendarDate(timezone, new Date(current.verifiedAt)) !== current.verifiedOn
    || (original.collectedAt && new Date(current.verifiedAt) < new Date(original.collectedAt)))) return false;
  if (reliedOnCommit) {
    const reliedOn = index.changesByCommit.get(reliedOnCommit)?.[0]?.summary.timestamp;
    if (!reliedOn || current.verifiedOn < currentCalendarDate(timezone, new Date(reliedOn))
      || (current.verifiedAt && new Date(current.verifiedAt) < new Date(reliedOn))) return false;
  }
  return true;
}
