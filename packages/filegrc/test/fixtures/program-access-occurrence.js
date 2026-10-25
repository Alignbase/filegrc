import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { makeComprehensiveWorkspace } from "../fixtures.js";
import { writeJson } from "../helpers.js";
import { resourceDataPath } from "../../src/resource-markdown.js";
import { loadWorkspace } from "../../src/index.js";

export async function programAccessFixture(root) {
  await makeComprehensiveWorkspace(root, "13");
  const loaded = await loadWorkspace(root);
  const entry = (type) => loaded.entries.find(({ record }) => record.type === type);
  const save = async (record) => {
    const path = loaded.entries.find((entry) => entry.record.id === record.id)?.path || join(root, "data", resourceDataPath(loaded.model, record));
    await mkdir(dirname(path), { recursive: true });
    await writeJson(path, record);
  };
  const obligation = { ...entry("obligation").record, activityType: "access-review", scopeResourceIds: [] };
  const rule = { ...entry("obligation-rule").record, recurrence: { mode: "calendar", unit: "month", interval: 1, anchorDate: "2026-01-01" },
    window: { precision: "date", startsAfter: 0, dueAfter: 20 }, effectiveAt: "2026-07-05T00:00:00-05:00" };
  delete rule.selector;
  await save(obligation); await save(rule);
  for (const current of loaded.entries.filter(({ record }) => record.type === "obligation-occurrence")) await rm(current.path);
  const component = { ...entry("component").record, id: "component-secondary", title: "Secondary identity boundary" };
  await save(component);
  const proof = { ...entry("evidence").record, artifactKind: "population-export", sourceKind: "component", sourceComponentId: "component-example",
    collectedOn: "2026-07-07", verifiedOn: "2026-07-07", generatedAt: "2026-07-07T10:00:00Z", timezone: "UTC",
    queryDescription: "All human and service accounts in the provider", populationCount: 1,
    completenessValidation: "Compared all account classes with provider totals", accuracyValidation: "Checked account identifiers and permissions",
    coverage: { kind: "range", startsOn: "2026-07-07", endsOn: "2026-07-07" } };
  delete proof.filePaths;
  const secondaryProof = { ...proof, id: "evidence-secondary", title: "Secondary provider population", sourceComponentId: component.id, componentIds: [component.id], populationCount: 0 };
  await save(proof); await save(secondaryProof);
  const review = { ...entry("access-review").record, componentIds: ["component-example", component.id],
    completedOn: "2026-07-07", approvedOn: "2026-07-07", populationCount: 1, exceptionCount: 0,
    grantDecisions: [{ accessGrantId: entry("access-grant").record.id, decision: "retain" }],
    evidenceIds: [proof.id, secondaryProof.id], coverage: { kind: "range", startsOn: "2026-07-05", endsOn: "2026-07-07" } };
  await save(review);
  return { root, obligation, rule, review, component, proof, secondaryProof, save };
}
