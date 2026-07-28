import { createResources } from "./files.js";
import { createResourceId } from "./id.js";
import { selectedControlFamilies } from "./program-readiness.js";
import { loadWorkspace } from "./workspace.js";

const TEST_EVIDENCE_KINDS = new Set(["test-export", "test-capture"]);

export function planEvidenceTestDrafts(loaded) {
  const workspace = loaded.workspace;
  const selectedIds = new Set(workspace.controlIds || []);
  const controls = loaded.resources.filter((record) => (
    record.type === "control"
    && (!selectedIds.size || selectedIds.has(record.id))
    && !["not-applicable", "retired"].includes(record.status)
  ));
  const families = selectedControlFamilies(controls, loaded.model)
    .filter((family) => family.collectionTestRequired !== false);
  const evidence = loaded.resources.filter((record) => (
    record.type === "evidence" && TEST_EVIDENCE_KINDS.has(record.evidenceKind)
  ));
  return families.map((family) => {
    const familyControlIds = new Set(family.controls.map((control) => control.id));
    const existing = evidence.find((record) => record.collectionTestFamilyId === family.id)
      || evidence.find((record) => (
        (record.controlIds || []).some((id) => familyControlIds.has(id))
      ));
    return {
      familyId: family.id,
      title: family.title,
      testEvidenceKind: family.testEvidenceKind,
      testPrompt: family.testPrompt,
      controlIds: [...familyControlIds],
      existing
    };
  });
}

export async function ensureEvidenceTestDrafts(input = process.cwd()) {
  const loaded = await loadWorkspace(input);
  const plan = planEvidenceTestDrafts(loaded);
  const created = [];
  const usedIds = loaded.resources.map((record) => record.id);
  for (const item of plan.filter(({ existing }) => !existing)) {
    const id = createResourceId(
      "evidence",
      `${item.title} Collection Test`,
      usedIds
    );
    usedIds.push(id);
    const record = {
      schemaVersion: 1,
      id,
      type: "evidence",
      title: `${item.title} Evidence Collection Test`,
      status: "draft",
      evidenceKind: item.testEvidenceKind,
      collectionTestFamilyId: item.familyId,
      collectionTestPrompt: item.testPrompt,
      controlIds: item.controlIds
    };
    created.push(record);
  }
  if (created.length) await createResources(loaded.root, created);
  return {
    created,
    existing: plan.filter(({ existing }) => existing).map(({ existing }) => existing),
    total: plan.length
  };
}
