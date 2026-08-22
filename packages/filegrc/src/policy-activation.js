import { applyResourceBatch, contentRevision } from "./files.js";
import { serializeWorkspaceMutation } from "./mutation.js";
import { assessProgramReadiness } from "./program-readiness.js";
import { currentCalendarDate } from "./time.js";
import { loadWorkspace } from "./workspace.js";

export async function scaffoldPolicyActivation(input = process.cwd(), options = {}) {
  const loaded = await loadWorkspace(input);
  const readiness = await assessProgramReadiness(loaded, { programId: options.programId });
  const approved = readiness.policyActivations.filter(({ state }) => (
    ["approved-implementation-pending", "ready-to-activate"].includes(state)
  ));
  const revisionById = new Map(loaded.entries.map((entry) => [entry.record.id, contentRevision(entry.source)]));
  return {
    available: approved.length > 0,
    message: approved.length
      ? `${approved.length} approved ${approved.length === 1 ? "Policy is" : "Policies are"} available for the Step 3 cutover.`
      : "No Policy is ready for activation. Finish Step 2 approval, then resolve its Step 3 implementation gaps.",
    nextCommand: approved.length ? null : "npx filegrc program-path --next --json",
    policyIds: approved.map(({ policyId }) => policyId),
    effectiveOn: currentCalendarDate(loaded.workspace.timezone),
    expectedRevisions: Object.fromEntries(approved.map(({ policyId }) => [policyId, revisionById.get(policyId)])),
    confirmed: false
  };
}

export async function planPolicyActivation(input = process.cwd(), options = {}) {
  const loaded = await loadWorkspace(input);
  const policyIds = [...new Set((options.policyIds || []).map(String))];
  if (!policyIds.length) throw new Error("Policy activation needs at least one approved Policy.");
  const effectiveOn = String(options.effectiveOn || "").trim();
  if (!isCalendarDate(effectiveOn)) throw new Error("Policy activation needs a real effective date in YYYY-MM-DD format.");
  const today = currentCalendarDate(loaded.workspace.timezone);
  if (effectiveOn < today) {
    throw new Error(`The effective date ${effectiveOn} has passed. Choose ${today} or a future date; do not backdate adoption.`);
  }
  const expectedRevisions = options.expectedRevisions || {};
  if (Array.isArray(expectedRevisions) || !expectedRevisions || typeof expectedRevisions !== "object") {
    throw new Error("Policy activation expected revisions must be keyed by Policy ID.");
  }
  const entryById = new Map(loaded.entries.map((entry) => [entry.record.id, entry]));
  const update = policyIds.map((policyId) => {
    const entry = entryById.get(policyId);
    if (!entry || entry.record.type !== "policy") throw new Error(`Policy "${policyId}" was not found.`);
    if (entry.record.status !== "approved") {
      throw new Error(`Policy "${policyId}" must be approved and inactive before the Step 3 cutover.`);
    }
    if (!/^[a-f0-9]{64}$/.test(expectedRevisions[policyId] || "")) {
      throw new Error(`Policy activation needs the current revision for "${policyId}". Regenerate the cutover review and try again.`);
    }
    const record = { ...entry.record, status: "active", effectiveOn };
    delete record.proposedEffectiveOn;
    return record;
  });
  return {
    operation: "policy-activation",
    policyIds,
    effectiveOn,
    changes: {
      update,
      expectedRevisions: Object.fromEntries(policyIds.map((policyId) => [
        policyId,
        expectedRevisions[policyId]
      ])),
      validateWholeWorkspace: true
    }
  };
}

export async function activatePolicies(input = process.cwd(), options = {}) {
  if (options.confirmed !== true) throw new Error("Review the Policy activation cutover and confirm the write.");
  return serializeWorkspaceMutation(input, async (root) => {
    const plan = await planPolicyActivation(root, options);
    const result = await applyResourceBatch(root, plan.changes);
    return { ...plan, result };
  });
}

function isCalendarDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}
