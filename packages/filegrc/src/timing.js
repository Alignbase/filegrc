import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";

const timingContext = new AsyncLocalStorage();

export async function collectTimings(task) {
  const timings = new Map();
  const result = await timingContext.run(timings, task);
  return { result, timings: Object.fromEntries(timings) };
}

export async function measureTiming(name, task) {
  const started = performance.now();
  try {
    return await task();
  } finally {
    recordTiming(name, performance.now() - started);
  }
}

export function measureTimingSync(name, task) {
  const started = performance.now();
  try {
    return task();
  } finally {
    recordTiming(name, performance.now() - started);
  }
}

export function recordTiming(name, durationMs) {
  const timings = timingContext.getStore();
  if (!timings) return;
  const current = timings.get(name) ?? { count: 0, durationMs: 0 };
  current.count += 1;
  current.durationMs += durationMs;
  timings.set(name, current);
}

export function timingEnabled() {
  return process.env.FILEGRC_TIMING === "1";
}
