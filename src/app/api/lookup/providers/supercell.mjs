import { confirmedNickname } from "../nickname-validation.mjs";

/**
 * Shared core for Supercell player lookups (Brawl Stars, Clash of Clans,
 * Clash Royale) via the official per-game APIs through the RoyaleAPI
 * community proxy.
 *
 * Community proxy note: the Isan community proxy is MLBB-only, and ID Game
 * Checker's own listing marks its Supercell category "not available", so
 * Supercell traffic goes through the RoyaleAPI community proxy hosts below.
 * Supercell developer keys are free; each game has its own developer portal
 * and key. When creating each key, allowlist the RoyaleAPI proxy IP
 * 45.79.218.79, then call the proxy host with the key as a Bearer token —
 * no Fixie/other egress proxy is used. Per-game base URLs can still be
 * overridden with BRAWL_STARS_API_BASE / CLASH_OF_CLANS_API_BASE /
 * CLASH_ROYALE_API_BASE (e.g. to point at the official hosts directly).
 *
 * Privacy: adapters never log or return tags, nicknames, payloads, URLs,
 * headers, or credentials. Only the shared LookupAttempt shape leaves here.
 */

const TAG_PATTERN = /^#?[0289PYLQGRJCUV]{3,20}$/i;
const REQUEST_TIMEOUT_MS = 7000;
// RoyaleAPI community proxy IP that must be allowlisted on each Supercell key.
// Source: https://docs.royaleapi.com/proxy.html
const ROYALEAPI_PROXY_IP = "45.79.218.79";

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

/**
 * Look up a Supercell player by tag against the official per-game API.
 * Returns missing_config when the game's key is not set, so routes degrade
 * to a clear 503 instead of calling upstream without credentials.
 */
export async function lookupSupercellPlayer(game, tag, {
  fetchImpl = fetch,
  env = process.env,
} = {}) {
  const config = configFor(game, env);
  if (!config) return { kind: "unavailable", diagnostic: { reason: "provider_error" } };
  if (!config.key) {
    return { kind: "unavailable", diagnostic: { reason: "missing_config" } };
  }

  const normalized = normalizeSupercellTag(tag);
  if (!normalized) return { kind: "unavailable", diagnostic: { reason: "provider_error" } };

  try {
    const upstream = await fetchImpl(`${config.base}/v1/players/${encodeURIComponent(normalized)}`, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${config.key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const payload = await upstream.json().catch(() => null);
    return classifySupercellResponse(upstream.status, payload, config.source);
  } catch {
    return { kind: "unavailable", diagnostic: { reason: "network_or_timeout" } };
  }
}
