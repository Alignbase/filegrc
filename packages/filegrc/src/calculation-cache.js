import { AsyncLocalStorage } from "node:async_hooks";

const calculations = new AsyncLocalStorage();
const sizes = new WeakMap();
const MAX_RESULTS = 200_000;
const limits = new WeakMap();

// Only explicit, verified read snapshots may retain results between calls.
// Ordinary assessments share work within one invocation, then discard it.
export function withAssessmentCache(callback) {
  return hasCalculationCache() ? callback() : withCalculationCache(new WeakMap(), callback);
}

export function withCalculationCache(cache, callback, { maxResults = MAX_RESULTS } = {}) {
  limits.set(cache, maxResults);
  return calculations.run(cache, callback);
}

export function hasCalculationCache() {
  return Boolean(calculations.getStore());
}

export function calculationMemo(owner, operation, keys, calculate) {
  const cache = calculations.getStore();
  if (!cache) return calculate();
  const room = (sizes.get(cache) || 0) < (limits.get(cache) ?? MAX_RESULTS);
  let operations = cache.get(owner);
  if (!operations) {
    if (!room) return calculate();
    cache.set(owner, operations = new Map());
  }
  let entries = operations.get(operation);
  if (!entries) {
    if (!room) return calculate();
    operations.set(operation, entries = new Map());
  }
  for (const key of keys) {
    let next = entries.get(key);
    if (!next) {
      if (!room) return calculate();
      entries.set(key, next = new Map());
    }
    entries = next;
  }
  if (entries.has(calculationMemo)) return entries.get(calculationMemo);
  if (!room) return calculate();
  const value = calculate();
  if ((sizes.get(cache) || 0) < (limits.get(cache) ?? MAX_RESULTS)) {
    entries.set(calculationMemo, value);
    sizes.set(cache, (sizes.get(cache) || 0) + 1);
  }
  return value;
}
