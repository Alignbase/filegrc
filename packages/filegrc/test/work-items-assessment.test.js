import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assessWorkflow, assessWorkItems, getWorkItems, loadWorkspace, validateWorkspace } from "../src/index.js";
import { makeComprehensiveWorkspace } from "./fixtures.js";

test("validated queue matches the complete workflow across supported models and options", async (context) => {
  for (const model of ["11", "12", "13"]) {
    const root = await mkdtemp(join(tmpdir(), "filegrc-queue-assessment-"));
    context.after(() => rm(root, { recursive: true, force: true }));
    await makeComprehensiveWorkspace(root, model);
    const loaded = await loadWorkspace(root);
    const validation = await validateWorkspace(loaded);
    for (const includeComplete of [false, true]) {
      const options = { asOf: "2026-11-24", now: "2026-11-24T20:30:00Z", includeComplete };
      const full = await assessWorkflow(loaded, { ...options, validation });
      assert.deepEqual(await getWorkItems(loaded, { ...options, validation }), full.workItems);
      const stages = [];
      const result = await assessWorkItems(loaded, { ...options, onStage: stage => stages.push(stage) });
      assert.deepEqual(result.validation, validation);
      assert.equal(result.contractVersion, full.contractVersion);
      assert.equal(result.dataModelVersion, full.dataModelVersion);
      assert.deepEqual(result.workItems, validation.ok ? full.workItems : null);
      assert.deepEqual(stages, validation.ok ? ["validation", "assessment"] : ["validation"]);
    }
    loaded.diagnostics.push({ severity: "error", code: "invalid-fixture", message: "Invalid source" });
    const invalid = await assessWorkItems(loaded, { validation: { ok: true, diagnostics: [] } });
    assert.equal(invalid.validation.ok, false);
    assert.equal(invalid.workItems, null);
  }
});
