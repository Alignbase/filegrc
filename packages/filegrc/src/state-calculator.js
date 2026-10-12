import { reportCalculationSubprocess } from "./git.js";
import { Worker } from "node:worker_threads";

// One calculation lane per server keeps CPU-heavy read checks off the HTTP
// event loop. Mutations and repository synchronization remain on the server.
export function createStateCalculator() {
  let worker;
  let sequence = 0;
  let closed = false;
  const pending = new Map();
  const registered = new Set();
  const fail = (error, expectedWorker) => {
    if (expectedWorker && worker !== expectedWorker) return;
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
    registered.clear();
    worker = null;
  };
  return {
    calculate(snapshotId, loaded, section, options, deadlineAt) {
      if (closed) return Promise.reject(new Error("The FileGRC server stopped."));
      if (!worker) {
        worker = new Worker(new URL("./state-calculator-worker.js", import.meta.url));
        worker.on("message", ({ id, result, error, subprocess }) => {
          if (subprocess) { reportCalculationSubprocess(subprocess); return; }
          const job = pending.get(id);
          if (!job) return;
          pending.delete(id);
          if (error) job.reject(Object.assign(new Error(error.message), error));
          else job.resolve(result);
        });
        const startedWorker = worker;
        worker.on("error", (error) => fail(error, startedWorker));
        worker.on("exit", () => fail(new Error("The state calculation worker stopped."), startedWorker));
      }
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try {
          // Worker snapshots use the same insertion-order, two-snapshot bound.
          // Message ordering guarantees registration precedes subsequent jobs.
          const register = !registered.has(snapshotId);
          worker.postMessage({ id, snapshotId, ...(register ? { loaded } : {}), section, options, deadlineAt });
          if (register) {
            registered.add(snapshotId);
            if (registered.size > 2) registered.delete(registered.values().next().value);
          }
        }
        catch (error) { pending.delete(id); reject(error); }
      });
    },
    close() {
      closed = true;
      const current = worker;
      fail(new Error("The FileGRC server stopped."));
      return current?.terminate();
    }
  };
}
