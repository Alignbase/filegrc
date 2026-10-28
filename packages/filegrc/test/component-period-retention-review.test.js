import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeRetentionApplicationWorkspace } from "./fixtures/retention-applications.js";
import { commitWorkspaceFiles, writeJson } from "./helpers.js";
import { loadWorkspace } from "../src/workspace.js";
import { getWorkspaceHistories } from "../src/git.js";
import { markdownEntries, resourceDataPath } from "../src/resource-markdown.js";
import { scaffoldRetentionApplication, saveRetentionApplication, retentionApplicationIssues } from "../src/retention-applications.js";
import { assessPeriodImpact } from "../src/period-impact.js";
import { currentCalendarDate } from "../src/time.js";

test("current exact owner data-use application covers supporting inventory changes without waiving other changes", async context => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-component-period-fit-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeRetentionApplicationWorkspace(root);
  let loaded = await loadWorkspace(root);
  const source = loaded.resources.find(record => record.id === "component-example");
  const component = { ...source, id: "component-business-service", title: "Business working-record service", vendorId: "vendor-example",
    systemUses: [{ systemId: "system-example", roles: ["supporting-operations"], rationale: "Ordinary business administration." }],
    informationUses: [{ informationTypeId: "information-type-example", processingOperations: ["store"] }] };
  delete component.evidenceSourceKinds; delete component.evidenceOwnerIds;
  const path = join(root, "data", resourceDataPath(loaded.model, component));
  await writeJson(path, component);
  const slots = markdownEntries(loaded.model, component);
  for (const slot of slots) { await mkdir(join(root, "data", slot.path, ".."), { recursive: true }); await writeFile(join(root, "data", slot.path), "# Business use\n\nOrdinary working records under the approved rule.\n"); }
  await commitWorkspaceFiles(root, "Catalog supporting business service");
  component.informationUses[0].processingOperations.push("use");
  await writeJson(path, component); await commitWorkspaceFiles(root, "Record working-record data use");
  const payload = await scaffoldRetentionApplication(root, "retention-schedule-item-example");
  Object.assign(payload.record, { scopeResourceIds: [component.id], informationTypeIds: ["information-type-example"], reviewedById: "person-example", authorityAppointmentId: "appointment-example", purpose: "Ordinary working business records.", rationale: "Same approved category, purpose, cutoff, period and holds.", disposalImplementation: "Owner deletes expired working records through the provider and checks holds." });
  Object.keys(payload.record.confirmations).forEach(key => payload.record.confirmations[key] = true);
  payload.record.reviewedScopeRevisions = Object.fromEntries(payload.scopeCandidates.map(({ id, revision }) => [id, revision]));
  await saveRetentionApplication(root, payload, { confirmed: true });
  await commitWorkspaceFiles(root, "Record owner data-use decision");
  const assess = async () => {
    loaded = await loadWorkspace(root);
    const record = loaded.resources.find(item => item.id === component.id);
    const paths = [`data/${resourceDataPath(loaded.model, record)}`, ...markdownEntries(loaded.model, record).map(slot => `data/${slot.path}`)];
    const asOf = currentCalendarDate(loaded.workspace.timezone);
    return assessPeriodImpact(loaded, record, getWorkspaceHistories(root, paths, 100), { start: `${asOf.slice(0, 4)}-01-01`, end: `${asOf.slice(0, 4)}-12-31` }, asOf);
  };
  let impact = await assess();
  assert.equal(impact.state, "complete"); assert.match(impact.message, /owner retention applicability review/);
  component.internetExposed = !component.internetExposed;
  await writeJson(path, component);
  assert.equal((await assess()).state, "ready", "data-use approval cannot waive exposure changes");
  component.internetExposed = source.internetExposed;
  await writeJson(path, component);
  assert.equal((await assess()).state, "complete");
  component.informationUses[0].processingOperations = ["store"];
  await writeJson(path, component); await commitWorkspaceFiles(root, "Change actual data use");
  component.informationUses[0].processingOperations.push("use");
  await writeJson(path, component); await commitWorkspaceFiles(root, "Repeat old data-use state");
  loaded = await loadWorkspace(root);
  assert.deepEqual(retentionApplicationIssues(loaded, loaded.resources.find(record => record.id === payload.record.id)), []);
  assert.equal((await assess()).state, "ready", "equal current scope hash cannot waive an intervening unreviewed change");
});
