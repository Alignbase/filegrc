import { adoptWorkflowRuntime } from "./fixtures/workflow-runtime.js";
import { copyFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { makeComprehensiveWorkspace } from "./fixtures.js";
import { initializeExistingModel12Workspace, commitWorkspaceFiles, writeJson } from "./helpers.js";
import { loadWorkspace } from "../src/workspace.js";
import { scaffoldCollectionReview, applyCollectionReview } from "../src/collection-review.js";
import { createResource } from "../src/files.js";
import { scaffoldObligationRuleActivation, activateObligationRule } from "../src/obligations.js";
import { scaffoldObligationRuleWithdrawal, withdrawObligationRule } from "../src/obligation-rule-withdrawal.js";
import { currentCalendarDate } from "../src/time.js";

export async function makeScheduleReviewFixture(root, count = 57) {
  await makeComprehensiveWorkspace(root, "13");
  await adoptWorkflowRuntime(root);
  let loaded = await loadWorkspace(root);
  const obligation = loaded.entries.find(({ record }) => record.type === "obligation");
  const rule = loaded.entries.find(({ record }) => record.type === "obligation-rule");
  const renderer = loaded.entries.find(({ record }) => record.type === "renderer-settings");
  await writeJson(renderer.path, { ...renderer.record, showOnboarding: false });
  for (let index = 1; index < count; index++) {
    const id = `obligation-periodic-${index}`, ruleId = `obligation-rule-periodic-${index}`;
    await writeJson(join(root, "data", dirname(obligation.relativePath), `${id}.json`), { ...obligation.record,
      id, title: `Periodic review ${index}`, activityType: "log-review", scopeResourceIds: ["system-example"], ruleIds: [ruleId], activeRuleId: ruleId });
    await writeJson(join(root, "data", dirname(rule.relativePath), `${ruleId}.json`), { ...rule.record,
      id: ruleId, title: `Periodic review ${index} rule`, obligationId: id,
      recurrence: { mode: "calendar", unit: "month", interval: 3, anchorDate: "2026-08-05" }, window: undefined });
    for (const [entry, nextId] of [[obligation, id], [rule, ruleId]]) {
      try { await copyFile(entry.path.replace(/\.json$/, ".md"), join(root, "data", dirname(entry.relativePath), `${nextId}.md`)); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }
  const excludedId = "obligation-rule-unused-proposal";
  const proposal = { ...rule.record, id: excludedId, title: "Unused alternative event rule", status: "proposed" };
  for (const field of ["approvedByIds", "approvedOn", "effectiveAt"]) delete proposal[field];
  await writeJson(join(root, "data/obligation-rules", `${excludedId}.json`), proposal);
  await writeFile(join(root, "data/obligation-rules", `${excludedId}.md`), "# Unused alternative\n\nManagement retained the existing event rule instead of this proposal.\n");
  await writeJson(obligation.path, { ...obligation.record, ruleIds: [...obligation.record.ruleIds, excludedId] });
  await initializeExistingModel12Workspace(root);
  loaded = await loadWorkspace(root);
  const today = currentCalendarDate(loaded.workspace.timezone);
  const prior = await scaffoldCollectionReview(root, { resourceType: "obligation", includeOperatingPreview: false });
  await applyCollectionReview(root, { ...prior, rationale: "Historical review of the complete fixture schedule set; the alternative remains proposed and excluded.",
    reviewedByIds: ["person-independent-approver-example"], reviewedOn: today,
    scheduleDecisions: prior.scheduleDecisions.map((decision) => ({ ...decision, disposition: "adopted", rationale: "Historical disposition, not a fresh reviewer statement.",
      ...(decision.obligationId === obligation.record.id ? { excludedRuleIds: [excludedId] } : {}) })), confirmed: true, includeOperatingPreview: false });
  await commitWorkspaceFiles(root, "Record the original schedule review");
  const activationFacts = JSON.stringify((await loadWorkspace(root)).resources.filter(({ type }) => ["policy", "document", "training"].includes(type)));
  for (let index = 1; index <= Math.min(3, count - 1); index++) {
    loaded = await loadWorkspace(root);
    const predecessor = loaded.resources.find(({ id }) => id === `obligation-rule-periodic-${index}`);
    const successor = { ...predecessor, id: `${predecessor.id}-calendar`, status: "proposed", title: `Calendar review ${index} rule`,
      timezone: index === 1 ? "UTC" : predecessor.timezone,
      recurrence: { ...predecessor.recurrence, anchorDate: `${new Date().getUTCFullYear() + 1}-01-01` },
      rationale: "Management chose calendar-quarter alignment, with no rewrite of previously recorded work." };
    for (const field of ["approvedByIds", "approvedOn", "effectiveAt"]) delete successor[field];
    await createResource(root, successor);
    const activation = await scaffoldObligationRuleActivation(root, { ruleId: successor.id });
    const at = new Date().toISOString();
    await activateObligationRule(root, { ...activation.payload, confirmedRevision: activation.review.revision,
      approvedByIds: ["person-example"], approvedOn: today, effectiveAt: at, effectiveLocal: undefined, now: at, timezone: successor.timezone, cutoverDecision: "new-windows-only" });
    await commitWorkspaceFiles(root, `Adopt calendar review ${index}`);
  }
  const withdrawal = await scaffoldObligationRuleWithdrawal(root, { ruleId: excludedId });
  await withdrawObligationRule(root, { ...withdrawal, withdrawnByIds: ["person-example"], withdrawnOn: today,
    withdrawalReason: "Management withdrew this unused alternative while keeping the original adopted rule." });
  await commitWorkspaceFiles(root, "Withdraw the excluded alternative");
  return { root, activationFacts, today, excludedId };
}
