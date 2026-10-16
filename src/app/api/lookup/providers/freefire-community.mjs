/**
 * Free Fire profile + stats via the Free Fire Community API
 * (developers.freefirecommunity.com, keyed, 100 req/hour free tier).
 *
 * Endpoints used (all `GET`, `x-api-key` header or `?key=`):
 * - `/api/v1/info?uid={uid}` — profile (nickname, level, rank, clan, likes)
 * - `/api/v1/stats?uid={uid}` — Solo/Duo/Squad career stats
 * - `/api/v1/bancheck?uid={uid}` — ban status
 *
 * Classification is conservative: success requires a 2xx response with a
 * recognized profile/stats payload; unknown-user shapes map to not_found;
 * auth/quota failures degrade as unavailable/rate_limited without leaking
 * key state. Results cache per uid (profiles change slowly; stats hourly).
 *
 * Env (server-only): `FREEFIRE_COMMUNITY_API_KEY`, optional
 * `FREEFIRE_COMMUNITY_API_BASE` (default
 * `https://developers.freefirecommunity.com`).
 *
 * Privacy: callers receive the profile they asked for; credentials, URLs,
 * headers, and raw upstream payloads stay server-side.
 */

import { providerCache } from "./provider-cache.mjs";

const DEFAULT_BASE = "https://developers.freefirecommunity.com";
const REQUEST_TIMEOUT_MS = 8000;

export const FREEFIRE_PROFILE_CACHE_TTL_SECONDS = 3600;
export const FREEFIRE_STATS_CACHE_TTL_SECONDS = 3600;

const UID_PATTERN = /^\d{4,20}$/;
const NOT_FOUND_MESSAGE_PATTERN = /(not\s*found|unknown\s*(user|player|uid)|invalid\s*(uid|id|user|player)|no\s*(user|player|result)|user\s*not\s*exist)/i;

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function nonNegativeInt(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function baseFor(env = process.env) {
  return (env.FREEFIRE_COMMUNITY_API_BASE?.trim() || DEFAULT_BASE).replace(/\/+$/, "");
}

/** Normalize a Free Fire UID (digits only). Returns "" when invalid. */
export function normalizeFreeFireUid(value) {
  if (typeof value !== "string") return "";
  const compact = value.trim();
  return UID_PATTERN.test(compact) ? compact : "";
}

function messageOf(payload) {
  const root = record(payload);
  if (!root) return "";
  for (const key of ["message", "msg", "error"]) {
    if (typeof root[key] === "string") return root[key];
  }
  return "";
}

export function classifyFreeFireCommunityResponse(httpStatus, payload) {
  if (httpStatus === 429) {
    return { kind: "rate_limited", diagnostic: { reason: "http_error", statusCode: 429 } };
  }
  if (httpStatus === 401 || httpStatus === 403) {
    return { kind: "rate_limited", diagnostic: { reason: "http_error", statusCode: httpStatus } };
  }
  if (httpStatus === 404 || NOT_FOUND_MESSAGE_PATTERN.test(messageOf(payload))) {
    return { kind: "not_found" };
  }
  if (!Number.isInteger(httpStatus) || httpStatus < 200 || httpStatus >= 300) {
    return { kind: "unavailable", diagnostic: { reason: "http_error", statusCode: httpStatus } };
  }
  const root = record(payload);
  if (!root) {
    return { kind: "unavailable", diagnostic: { reason: "unrecognized_response", statusCode: httpStatus } };
  }
  return { kind: "success", payload: root };
}

function summarizeProfile(payload) {
  const root = record(payload) ?? {};
  const data = record(root.data) ?? root;
  const nickname = text(data.nickname ?? data.name ?? data.username);
  const uid = text(data.uid ?? data.playerId ?? data.id);
  if (!nickname) return null;
  const clan = record(data.clan ?? data.guild) ?? null;
  return {
    nickname,
    uid: uid || null,
    level: nonNegativeInt(data.level ?? data.accountLevel),
    likes: nonNegativeInt(data.likes ?? data.likeCount),
    region: text(data.region ?? data.server) || null,
    clan: clan ? { name: text(clan.name) || null, id: text(clan.id ?? clan.guildId) || null } : null,
  };
}

function summarizeStats(payload) {
  const root = record(payload) ?? {};
  const data = record(root.data) ?? root;
  const modes = {};
  for (const mode of ["solo", "duo", "squad"]) {
    const section = record(data[mode] ?? data[`${mode}Stats`] ?? data[mode.toUpperCase()]) ?? null;
    if (!section) continue;
    modes[mode] = {
      games: nonNegativeInt(section.games ?? section.matches ?? section.totalGames),
      wins: nonNegativeInt(section.wins ?? section.booyahs ?? section.topFinishes),
      kills: nonNegativeInt(section.kills),
      damage: nonNegativeInt(section.damage),
    };
  }
  if (Object.keys(modes).length === 0) return null;
  return { modes };
}

async function fetchCommunity(path, uid, { fetchImpl = fetch, env = process.env } = {}) {
  const key = env.FREEFIRE_COMMUNITY_API_KEY?.trim() || "";
  if (!key) {
    return { kind: "unavailable", diagnostic: { reason: "missing_config" } };
  }
  try {
    const upstream = await fetchImpl(`${baseFor(env)}${path}?uid=${encodeURIComponent(uid)}`, {
      method: "GET",
      headers: { Accept: "application/json", "x-api-key": key },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const payload = await upstream.json().catch(() => null);
    return classifyFreeFireCommunityResponse(upstream.status, payload);
  } catch {
    return { kind: "unavailable", diagnostic: { reason: "network_or_timeout" } };
  }
}

/**
 * Free Fire profile by UID. Cached hourly, single-flight coalesced.
 */
export async function lookupFreeFireProfile(uid, { fetchImpl = fetch, env = process.env, cache = providerCache } = {}) {
  const normalized = normalizeFreeFireUid(uid);
  if (!normalized) return { kind: "unavailable", diagnostic: { reason: "provider_error" } };
  const { value, cached } = await cache.getOrLoad(
    `freefire:profile:${normalized}`,
    FREEFIRE_PROFILE_CACHE_TTL_SECONDS,
    async () => {
      const fetched = await fetchCommunity("/api/v1/info", normalized, { fetchImpl, env });
      if (fetched.kind !== "success") return fetched;
      const profile = summarizeProfile(fetched.payload);
      if (!profile) {
        return { kind: "unavailable", diagnostic: { reason: "unrecognized_response", statusCode: 200 } };
      }
      return { kind: "success", profile, source: "freefire_community_api" };
    },
  );
  if (value?.kind === "success") return { ...value, cached };
  return value;
}

/**
 * Free Fire career stats by UID. Cached hourly, single-flight coalesced.
 */
export async function lookupFreeFireStats(uid, { fetchImpl = fetch, env = process.env, cache = providerCache } = {}) {
  const normalized = normalizeFreeFireUid(uid);
  if (!normalized) return { kind: "unavailable", diagnostic: { reason: "provider_error" } };
  const { value, cached } = await cache.getOrLoad(
    `freefire:stats:${normalized}`,
    FREEFIRE_STATS_CACHE_TTL_SECONDS,
    async () => {
      const fetched = await fetchCommunity("/api/v1/stats", normalized, { fetchImpl, env });
      if (fetched.kind !== "success") return fetched;
      const stats = summarizeStats(fetched.payload);
      if (!stats) {
        return { kind: "unavailable", diagnostic: { reason: "unrecognized_response", statusCode: 200 } };
      }
      return { kind: "success", stats, source: "freefire_community_api" };
    },
  );
  if (value?.kind === "success") return { ...value, cached };
  return value;
}
