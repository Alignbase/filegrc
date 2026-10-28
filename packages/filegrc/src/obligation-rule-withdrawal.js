import { loadWorkspace } from "./workspace.js";
import { applyResourceBatch, contentRevision, INTERNAL_WORKFLOW_CAPABILITIES } from "./files.js";
import { serializeWorkspaceMutation } from "./mutation.js";
import { revisionsMatch } from "./revisions.js";
import { currentCalendarDate } from "./time.js";
import { parseCalendarDate } from "./recurrence.js";
import { personWasActiveOn } from "./soc2.js";
import { assertWorkflowSourceRuntimeAdopted } from "./workflow-source-runtime.js";

export async function scaffoldObligationRuleWithdrawal(input, options = {}) {
  const loaded = await loadWorkspace(input);
  if (!loaded.model.resources["obligation-rule"]?.fields.status.values.includes("withdrawn")) {
    throw new Error("Obligation Rule withdrawal requires a model supporting the withdrawn status.");
  }
  assertWorkflowSourceRuntimeAdopted(loaded);
  const entry = loaded.entries.find(({ record }) => record.type === "obligation-rule" && record.id === options.ruleId);
  if (!entry) throw new Error(`Obligation rule "${options.ruleId || ""}" was not found.`);
  const rule = entry.record;
  if (!["proposed", "approved"].includes(rule.status) || rule.effectiveAt || rule.retiredOn
    || loaded.resources.some((record) => record.activeRuleId === rule.id || record.type === "obligation-occurrence" && record.ruleId === rule.id)) {
    throw new Error("Withdraw only a proposed or approved rule that never took effect or governed work. Preserve effective rules and use prospective activation and retirement.");
  }
  return {
    ruleId: rule.id,
    expectedRevision: contentRevision(entry.source),
    withdrawnByIds: [],
    withdrawnOn: null,
    withdrawalReason: null,
    instructions: "Record the people who actually made this decision, its actual date and reason. Preserve the rule and any prior approval. Withdrawal does not approve schedules or retire an effective rule."
  };
}

export async function previewObligationRuleWithdrawal(input, payload = {}) {
  const loaded = await loadWorkspace(input);
  const scaffold = await scaffoldObligationRuleWithdrawal(loaded.root, payload);
  if (!revisionsMatch("content", payload.expectedRevision, scaffold.expectedRevision)) {
    throw new Error("The Obligation Rule changed. Scaffold its withdrawal again.");
  }
  const rule = loaded.resources.find(({ id }) => id === payload.ruleId);
  if (!parseCalendarDate(payload.withdrawnOn)
    || payload.withdrawnOn > currentCalendarDate(loaded.workspace.timezone, new Date())
    || rule.approvedOn && payload.withdrawnOn < rule.approvedOn) {
    throw new Error("Record the actual withdrawal date, on or after any existing approval and no later than today.");
  }
  if (!Array.isArray(payload.withdrawnByIds) || !payload.withdrawnByIds.length
    || new Set(payload.withdrawnByIds).size !== payload.withdrawnByIds.length
    || payload.withdrawnByIds.some((id) => !personWasActiveOn(loaded.resources.find((record) => record.id === id), payload.withdrawnOn))) {
    throw new Error("Withdrawal needs the actual decision actors, each a Person active on the withdrawal date.");
  }
  if (typeof payload.withdrawalReason !== "string" || !payload.withdrawalReason.trim()) {
    throw new Error("A reason for withdrawing this rule is required.");
  }
  const record = { ...rule, status: "withdrawn", withdrawnByIds: payload.withdrawnByIds,
    withdrawnOn: payload.withdrawnOn, withdrawalReason: payload.withdrawalReason.trim() };
  return { ruleId: rule.id, previousStatus: rule.status, record, expectedRevision: scaffold.expectedRevision };
}

export async function withdrawObligationRule(input, payload = {}) {
  return serializeWorkspaceMutation(input, async (root) => {
    const preview = await previewObligationRuleWithdrawal(root, payload);
    await applyResourceBatch(root, {
      workflowCapability: INTERNAL_WORKFLOW_CAPABILITIES.obligationRuleWithdrawal,
      update: [preview.record],
      expectedRevisions: { [preview.ruleId]: preview.expectedRevision }
    });
    return preview;
  });
}
