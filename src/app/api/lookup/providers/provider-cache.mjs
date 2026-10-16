/**
 * Tiny TTL cache with single-flight coalescing for provider adapters.
 *
 * Phase 1 (Supercell) needs caching to respect unpublished per-key quotas:
 * profiles cache for minutes, static catalogs pin to the game version, and
 * concurrent lookups for the same key collapse into one upstream request.
 *
 * Privacy: cache keys are caller-supplied opaque strings (already-normalized
 * tags/locations). Values are adapter-level LookupAttempt shapes. This module
 * never logs keys or values.
 */

const DEFAULT_MAX_ENTRIES = 500;

function now(clock) {
  return typeof clock === "function" ? clock() : Date.now();
}

/**
 * Create an isolated TTL cache. `clock` is injectable for tests.
 */
export function createProviderCache({ clock = () => Date.now(), maxEntries = DEFAULT_MAX_ENTRIES } = {}) {
  const entries = new Map();
  const inflight = new Map();

  function prune(currentTime) {
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= currentTime) entries.delete(key);
    }
    if (entries.size <= maxEntries) return;
    // Evict oldest-expiring first (Map preserves insertion order; TTLs make
    // this a good-enough approximation of LRU for bounded memory).
    const overflow = entries.size - maxEntries;
    let removed = 0;
    for (const key of entries.keys()) {
      entries.delete(key);
      removed += 1;
      if (removed >= overflow) break;
    }
  }

  function get(key) {
    const entry = entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now(clock)) {
      entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  function set(key, value, ttlSeconds) {
    const ttlMs = Math.max(0, Number(ttlSeconds) * 1000);
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) return;
    entries.set(key, { value, expiresAt: now(clock) + ttlMs });
    prune(now(clock));
  }

  /**
   * Return the cached value, or run `loader` once and cache its result.
   * Concurrent callers with the same key share the same in-flight promise.
   * Only successful loader results are cached; rejections propagate and are
   * not cached.
   */
  async function getOrLoad(key, ttlSeconds, loader) {
    const cached = get(key);
    if (cached !== undefined) return { value: cached, cached: true };
    const pending = inflight.get(key);
    if (pending) {
      const value = await pending;
      return { value, cached: true };
    }
    const task = Promise.resolve()
      .then(loader)
      .then((value) => {
        set(key, value, ttlSeconds);
        return value;
      })
      .finally(() => {
        if (inflight.get(key) === task) inflight.delete(key);
      });
    inflight.set(key, task);
    const value = await task;
    return { value, cached: false };
  }

  function stats() {
    return { entries: entries.size, inflight: inflight.size };
  }

  return { get, set, getOrLoad, stats };
}

/** Shared process-level cache used by Supercell adapters. */
export const providerCache = createProviderCache();
