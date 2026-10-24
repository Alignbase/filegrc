import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { makeComprehensiveWorkspace } from "../fixtures.js";
import { writeJson } from "../helpers.js";
import { contentRevision } from "../../src/files.js";
import { loadWorkspace } from "../../src/index.js";

export async function trainingFixture(root, scopeResourceIds = ["training-example"]) {
  await makeComprehensiveWorkspace(root, "13");
  const loaded = await loadWorkspace(root);
  const obligationEntry = loaded.entries.find(({ record }) => record.type === "obligation");
  const ruleEntry = loaded.entries.find(({ record }) => record.type === "obligation-rule");
  const attestationEntry = loaded.entries.find(({ record }) => record.type === "attestation");
  const obligation = { ...obligationEntry.record, activityType: "training", scopeResourceIds, templateResourceId: "training-example" };
  const rule = { ...ruleEntry.record, recurrence: { mode: "calendar", unit: "month", interval: 1, anchorDate: "2026-01-01" },
    window: { precision: "date", startsAfter: 0, dueAfter: 20 }, effectiveAt: "2026-07-05T00:00:00-05:00" };
  delete rule.selector;
  await writeJson(obligationEntry.path, obligation);
  await writeJson(ruleEntry.path, rule);
  for (const entry of loaded.entries.filter(({ record }) => record.type === "obligation-occurrence")) await rm(entry.path);
  const attestation = { ...attestationEntry.record, completedOn: "2026-07-07", subjectResourceIds: ["policy-example", "training-example"],
    contentRevisions: { ...attestationEntry.record.contentRevisions,
      "training/training-example.md": contentRevision(await readFile(join(root, "data/training/training-example.md"), "utf8")) } };
  await writeJson(attestationEntry.path, attestation);
  return { root, obligation, rule, attestation, attestationEntry, obligationEntry };
}
