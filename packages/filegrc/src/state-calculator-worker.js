import { parentPort } from "node:worker_threads";
import { withCalculationCache } from "./calculation-cache.js";
import { setGitSubprocessObserverForTests, withGitCommandCache, withGitCommandDeadline } from "./git.js";
import { createAppStateSection } from "./state.js";
import { validateWorkspace } from "./validate.js";

setGitSubprocessObserverForTests(({ kind, cwd, args }) => parentPort.postMessage({ subprocess: { kind, cwd, args } }));

const snapshots = new Map();
parentPort.on("message", async ({ id, snapshotId, loaded, section, options, deadlineAt }) => {
  try {
    let snapshot = snapshots.get(snapshotId);
    if (!snapshot) {
      if (!loaded) throw new Error("The calculation snapshot is not registered.");
      snapshot = { loaded, calculations: new WeakMap(), commands: new Map() };
      snapshots.set(snapshotId, snapshot);
      if (snapshots.size > 2) snapshots.delete(snapshots.keys().next().value);
    }
    const result = await withGitCommandDeadline(deadlineAt, () =>
      withCalculationCache(snapshot.calculations, () => withGitCommandCache(snapshot.commands, async () => {
        if (section !== "validation") return createAppStateSection(snapshot.loaded, section, options);
        const { ok, counts, diagnostics, reconciliation } = await validateWorkspace(snapshot.loaded);
        return { ok, counts, diagnostics, reconciliation };
      })), { commandTimeoutMs: 10_000 });
    parentPort.postMessage({ id, result });
  } catch (error) {
    parentPort.postMessage({ id, error: { message: error.message, code: error.code, source: error.source } });
  }
});
