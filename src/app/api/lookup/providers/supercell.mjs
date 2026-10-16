import { confirmedNickname } from "../nickname-validation.mjs";
import { fetchSupercellPathWithFallback } from "./supercell-fallback.mjs";

/**
 * Shared core for Supercell player lookups (Brawl Stars, Clash of Clans,
 * Clash Royale) via the official per-game APIs with a hardened
 * primary/secondary chain (official direct first, RoyaleAPI community proxy
 * as failover). See supercell-fallback.mjs for the chain and triggers.
 *
 * Community proxy note: the Isan community proxy is MLBB-only, and ID Game
 * Checker's own listing marks its Supercell category "not available", so
 * Supercell failover traffic goes through the RoyaleAPI community proxy
 * hosts below.
 * Supercell developer keys are free; each game has its own developer portal
 * and key. For the default chain, allowlist BOTH the Railway backend egress
 * IP (primary: official host) and the RoyaleAPI proxy IP 45.79.218.79
 * (secondary) on each key. Per-game base URLs can still be overridden with
 * BRAWL_STARS_API_BASE / CLASH_OF_CLANS_API_BASE / CLASH_ROYALE_API_BASE
 * (primary) and the matching *_API_FALLBACK_BASE (secondary).
 *
 * Privacy: adapters never log or return tags, nicknames, payloads, URLs,
 * headers, or credentials. Only the shared LookupAttempt shape leaves here.
 */

const TAG_PATTERN = /^#?[0289PYLQGRJCUV]{3,20}$/i;
const REQUEST_TIMEOUT_MS = 7000;

/**
 * Normalize a Supercell player tag: strip whitespace, force a leading `#`,
 * uppercase. Returns "" when the tag uses characters outside Supercell's
 * 0289PYLQGRJCUV alphabet.
 */
export function normalizeSupercellTag(value) {
  if (typeof value !== "string") return "";
  const compact = value.trim().toUpperCase().replace(/^#+/, "");
  if (!compact || compact.length > 20) return "";
  if (!TAG_PATTERN.test(`#${compact}`)) return "";
  return `#${compact}`;
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

/**
 * Classify an official Supercell `/players/{tag}` response.
 * - 200 + usable `name`: success
 * - 404, or 4xx with a notFound reason: not_found
 * - 403 invalid key / 429: rate_limited (caller should retry/provision)
 * - anything else: unavailable
 */
export function classifySupercellResponse(httpStatus, payload, source) {
  if (httpStatus === 429) {
    return { kind: "rate_limited", diagnostic: { reason: "http_error", statusCode: 429 } };
  }
  if (httpStatus === 403) {
    return { kind: "rate_limited", diagnostic: { reason: "http_error", statusCode: 403 } };
  }

  const root = record(payload);
  const reason = typeof root?.reason === "string" ? root.reason.trim().toLowerCase() : "";

  if (httpStatus === 404 || (Number.isInteger(httpStatus) && httpStatus >= 400 && httpStatus < 500 && reason === "notfound")) {
    return { kind: "not_found" };
  }

  if (!Number.isInteger(httpStatus) || httpStatus < 200 || httpStatus >= 300) {
    return { kind: "unavailable", diagnostic: { reason: "http_error", statusCode: httpStatus } };
  }

  const nickname = confirmedNickname(payload);
  if (nickname) return { kind: "success", nickname, source };
  if (root?.name === null || reason === "notfound") return { kind: "not_found" };
  return { kind: "unavailable", diagnostic: { reason: "unrecognized_response", statusCode: httpStatus } };
}

function configFor(game, env = process.env) {
  const table = {
    "brawl-stars": {
      key: env.BRAWL_STARS_API_KEY?.trim() || "",
      base: (env.BRAWL_STARS_API_BASE?.trim() || "https://bsproxy.royaleapi.dev").replace(/\/+$/, ""),
      source: "brawl_stars_official_api",
    },
    "clash-of-clans": {
      key: env.CLASH_OF_CLANS_API_KEY?.trim() || "",
      base: (env.CLASH_OF_CLANS_API_BASE?.trim() || "https://cocproxy.royaleapi.dev").replace(/\/+$/, ""),
      source: "clash_of_clans_official_api",
    },
    "clash-royale": {
      key: env.CLASH_ROYALE_API_KEY?.trim() || "",
      base: (env.CLASH_ROYALE_API_BASE?.trim() || "https://proxy.royaleapi.dev").replace(/\/+$/, ""),
      source: "clash_royale_official_api",
    },
  };
  return table[game] || null;
}

/** Resolve a game's proxy config without performing network I/O. */
export function supercellConfigFor(game, env = process.env) {
  return configFor(game, env);
}

/**
 * GET a path on a game's official API through the community proxy.
 * Single-host primitive kept for the fallback chain internals and the
 * clan/battle/ranking adapters (which fail over at their own layer later).
 *
 * Returns a tagged result so clan/battle/ranking adapters can classify the
 * upstream response themselves: `{ ok: true, status, payload }` on any
 * completed HTTP response, `{ ok: false, attempt }` on missing config or
 * network failure. Never throws for upstream conditions.
 */
export async function fetchSupercellPath(game, path, {
  fetchImpl = fetch,
  env = process.env,
} = {}) {
  const config = configFor(game, env);
  if (!config) {
    return { ok: false, attempt: { kind: "unavailable", diagnostic: { reason: "provider_error" } } };
  }
  if (!config.key) {
    return { ok: false, attempt: { kind: "unavailable", diagnostic: { reason: "missing_config" } } };
  }
  try {
    const upstream = await fetchImpl(`${config.base}${path}`, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${config.key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const payload = await upstream.json().catch(() => null);
    return { ok: true, status: upstream.status, payload, source: config.source };
  } catch {
    return { ok: false, attempt: { kind: "unavailable", diagnostic: { reason: "network_or_timeout" } } };
  }
}

/**
 * Look up a Supercell player by tag against the official per-game API via
 * the hardened primary/secondary chain. Returns missing_config when the
 * game's key is not set, so routes degrade to a clear 503 instead of
 * calling upstream without credentials.
 */
export async function lookupSupercellPlayer(game, tag, {
  fetchImpl = fetch,
  env = process.env,
} = {}) {
  const normalized = normalizeSupercellTag(tag);
  if (!normalized) return { kind: "unavailable", diagnostic: { reason: "provider_error" } };

  const fetched = await fetchSupercellPathWithFallback(game, `/v1/players/${encodeURIComponent(normalized)}`, { fetchImpl, env });
  if (!fetched.ok) return fetched.attempt;
  return classifySupercellResponse(fetched.status, fetched.payload, fetched.source);
}
