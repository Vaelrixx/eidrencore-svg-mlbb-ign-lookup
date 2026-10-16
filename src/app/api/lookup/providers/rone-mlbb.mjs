/**
 * MLBB hero/meta explorer via the Rone Arena community API (arena.rone.dev).
 *
 * Rone is the most battle-tested MLBB community API (BSD-3-Clause, OpenAPI
 * at `/api/openapi.json`, no auth needed for hero/academy reads — verified
 * live 2026-10-17: `/api/heroes?limit=2` → 200, `/api/heroes/rank` → 200).
 * Only the `/api/user/*` group needs VC login; this adapter never touches
 * it (no credentials, no verification-code flows).
 *
 * Endpoints used:
 * - `GET /api/heroes?limit=N` — hero list (names, ids, relations)
 * - `GET /api/heroes/{id|slug}` — hero detail
 * - `GET /api/heroes/{id|slug}/counters` — counter picks
 * - `GET /api/heroes/{id|slug}/compatibility` — teammate synergy
 * - `GET /api/heroes/rank` — ranked meta standings
 *
 * Envelope: `{code:0,message:"OK",data:{records:[...]}}`. Non-zero codes
 * and non-2xx statuses degrade honestly. Results cache with a daily TTL
 * (meta shifts per patch, not per minute).
 *
 * Env (server-only, all optional): `RONE_API_BASE`
 * (default `https://arena.rone.dev`).
 *
 * Privacy: hero/meta data is public game data. This adapter never sends or
 * logs player IDs, credentials, or user content.
 */

import { providerCache } from "./provider-cache.mjs";

const DEFAULT_BASE = "https://arena.rone.dev";
const REQUEST_TIMEOUT_MS = 8000;
const MAX_HEROES = 200;
const MAX_RELATED = 25;

export const RONE_META_CACHE_TTL_SECONDS = 86400;

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function baseFor(env = process.env) {
  return (env.RONE_API_BASE?.trim() || DEFAULT_BASE).replace(/\/+$/, "");
}

/** Normalize a hero identifier (numeric id or slug). Returns "" when invalid. */
export function normalizeHeroIdentifier(value) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return String(value);
  if (typeof value !== "string") return "";
  const compact = value.trim();
  if (!IDENTIFIER_PATTERN.test(compact)) return "";
  return compact;
}

function summarizeHero(entry) {
  const root = record(entry);
  if (!root) return null;
  const data = record(root.data) ?? {};
  const heroData = record(record(data.hero)?.data) ?? {};
  const name = text(heroData.name);
  const heroId = root.hero_id ?? data.hero_id ?? heroData.heroid ?? null;
  if (!name) return null;
  return {
    id: Number.isInteger(heroId) ? heroId : typeof heroId === "string" && heroId.trim() ? heroId.trim() : null,
    name,
  };
}

function recordsOf(payload) {
  const data = record(record(payload)?.data);
  const records = data?.records;
  return Array.isArray(records) ? records : null;
}

export function classifyRoneResponse(httpStatus, payload) {
  if (httpStatus === 429) {
    return { kind: "rate_limited", diagnostic: { reason: "http_error", statusCode: 429 } };
  }
  if (httpStatus === 404) {
    return { kind: "not_found" };
  }
  if (!Number.isInteger(httpStatus) || httpStatus < 200 || httpStatus >= 300) {
    return { kind: "unavailable", diagnostic: { reason: "http_error", statusCode: httpStatus } };
  }
  const root = record(payload);
  if (!root || root.code !== 0) {
    return { kind: "unavailable", diagnostic: { reason: "unrecognized_response", statusCode: httpStatus } };
  }
  const records = recordsOf(payload);
  if (!records) {
    return { kind: "unavailable", diagnostic: { reason: "unrecognized_response", statusCode: httpStatus } };
  }
  return { kind: "success", records };
}

async function fetchRone(path, { fetchImpl = fetch, env = process.env } = {}) {
  try {
    const upstream = await fetchImpl(`${baseFor(env)}${path}`, {
      method: "GET",
      headers: { Accept: "application/json", "User-Agent": "Eidren-Meta-Explorer/1.0 (unofficial fan tool)" },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const payload = await upstream.json().catch(() => null);
    return classifyRoneResponse(upstream.status, payload);
  } catch {
    return { kind: "unavailable", diagnostic: { reason: "network_or_timeout" } };
  }
}

/**
 * List MLBB heroes (id + name). Cached daily; single-flight coalesced.
 */
export async function lookupRoneHeroes({ fetchImpl = fetch, env = process.env, cache = providerCache } = {}) {
  const { value, cached } = await cache.getOrLoad("rone:heroes", RONE_META_CACHE_TTL_SECONDS, async () => {
    const fetched = await fetchRone(`/api/heroes?limit=${MAX_HEROES}`, { fetchImpl, env });
    if (fetched.kind !== "success") return fetched;
    const heroes = fetched.records.map(summarizeHero).filter(Boolean).slice(0, MAX_HEROES);
    return { kind: "success", heroes, source: "rone_arena_api" };
  });
  if (value?.kind === "success") return { ...value, cached };
  return value;
}

/**
 * Hero detail: counters + compatible teammates + rank snapshot. Each leg is
 * fetched independently; a failed leg degrades to an empty list while the
 * others still serve.
 */
export async function lookupRoneHeroDetail(identifier, { fetchImpl = fetch, env = process.env, cache = providerCache } = {}) {
  const normalized = normalizeHeroIdentifier(identifier);
  if (!normalized) return { kind: "unavailable", diagnostic: { reason: "provider_error" } };
  const encoded = encodeURIComponent(normalized);
  const cacheKey = `rone:hero:${normalized.toLowerCase()}`;
  const { value, cached } = await cache.getOrLoad(cacheKey, RONE_META_CACHE_TTL_SECONDS, async () => {
    const [detail, counters, compatibility] = await Promise.all([
      fetchRone(`/api/heroes/${encoded}`, { fetchImpl, env }),
      fetchRone(`/api/heroes/${encoded}/counters`, { fetchImpl, env }),
      fetchRone(`/api/heroes/${encoded}/compatibility`, { fetchImpl, env }),
    ]);
    if (detail.kind === "not_found") return { kind: "not_found" };
    if (detail.kind !== "success") return detail;
    const heroes = detail.records.map(summarizeHero).filter(Boolean);
    const hero = heroes[0] ?? null;
    if (!hero) return { kind: "not_found" };
    const summarizeRelated = (result) => (result.kind === "success"
      ? result.records.map(summarizeHero).filter(Boolean).slice(0, MAX_RELATED)
      : []);
    return {
      kind: "success",
      hero,
      counters: summarizeRelated(counters),
      teammates: summarizeRelated(compatibility),
      source: "rone_arena_api",
    };
  });
  if (value?.kind === "success") return { ...value, cached };
  return value;
}

/**
 * Ranked meta snapshot from `/api/heroes/rank`. Cached daily.
 */
export async function lookupRoneMetaRank({ fetchImpl = fetch, env = process.env, cache = providerCache } = {}) {
  const { value, cached } = await cache.getOrLoad("rone:meta-rank", RONE_META_CACHE_TTL_SECONDS, async () => {
    const fetched = await fetchRone("/api/heroes/rank", { fetchImpl, env });
    if (fetched.kind !== "success") return fetched;
    const entries = fetched.records
      .map((entry) => {
        const hero = summarizeHero(entry);
        if (!hero) return null;
        const root = record(entry) ?? {};
        const rank = Number.isInteger(root.rank) ? root.rank : Number.isInteger(root.position) ? root.position : null;
        return { ...hero, rank };
      })
      .filter(Boolean)
      .slice(0, MAX_RELATED);
    return { kind: "success", entries, source: "rone_arena_api" };
  });
  if (value?.kind === "success") return { ...value, cached };
  return value;
}
