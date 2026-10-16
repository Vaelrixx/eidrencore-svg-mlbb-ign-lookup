/**
 * Hardened Supercell fallback chain: official direct API → RoyaleAPI proxy.
 *
 * Today every Supercell adapter calls one base URL (default: the RoyaleAPI
 * community proxy). This module adds a primary/secondary chain so a proxy
 * outage or a key/allowlist problem on one host fails over to the other
 * without changing the public route contract:
 *
 * - Primary: official per-game host (`https://api.brawlstars.com` etc.)
 *   using the same per-game key. Works when the operator allowlists the
 *   backend egress IP on the Supercell developer portal.
 * - Secondary: the RoyaleAPI community proxy (existing behavior), which
 *   needs the key to allowlist `45.79.218.79` instead.
 *
 * Failover triggers: transport/timeout failures, HTTP 5xx, and HTTP 403
 * (key/IP mismatch on one host often succeeds on the other). HTTP 429 is
 * NOT failed over — hammering a second host while rate-limited would burn
 * quota twice; it propagates as `rate_limited` with `Retry-After` handled
 * by the route. HTTP 404 / `notFound` short-circuits as `not_found`.
 *
 * Env (all server-only, per game `brawl-stars` | `clash-of-clans` | `clash-royale`):
 * - `<GAME>_API_KEY` (existing) — bearer key for both hosts.
 * - `<GAME>_API_BASE` (existing) — explicit override for the PRIMARY base.
 * - `<GAME>_API_FALLBACK_BASE` (new) — explicit override for the secondary
 *   base. Defaults to the RoyaleAPI proxy when the primary is official, and
 *   to the official host when the primary is the proxy.
 *
 * Privacy: adapters never log or return tags, payloads, URLs, headers, or
 * credentials. Only LookupAttempt shapes leave here.
 */

import { fetchSupercellPath } from "./supercell.mjs";

const OFFICIAL_BASES = {
  "brawl-stars": "https://api.brawlstars.com",
  "clash-of-clans": "https://api.clashofclans.com",
  "clash-royale": "https://api.clashroyale.com",
};

const PROXY_BASES = {
  "brawl-stars": "https://bsproxy.royaleapi.dev",
  "clash-of-clans": "https://cocproxy.royaleapi.dev",
  "clash-royale": "https://proxy.royaleapi.dev",
};

const ENV_PREFIX = {
  "brawl-stars": "BRAWL_STARS",
  "clash-of-clans": "CLASH_OF_CLANS",
  "clash-royale": "CLASH_ROYALE",
};

function cleanBase(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\/+$/, "");
}

/**
 * Resolve the ordered [primary, secondary] base URLs for a game. Pure and
 * exported for tests and the health endpoint.
 */
export function supercellBasesFor(game, env = process.env) {
  const prefix = ENV_PREFIX[game];
  const official = OFFICIAL_BASES[game];
  const proxy = PROXY_BASES[game];
  if (!prefix || !official || !proxy) return null;
  const primary = cleanBase(env[`${prefix}_API_BASE`]) || official;
  let secondary = cleanBase(env[`${prefix}_API_FALLBACK_BASE`]);
  if (!secondary) {
    secondary = primary === proxy ? official : proxy;
  }
  if (secondary === primary) return [primary];
  return [primary, secondary];
}

function shouldFailOver(fetched) {
  if (!fetched.ok) {
    // Missing config must not fail over (the key is shared by both hosts).
    return fetched.attempt?.diagnostic?.reason !== "missing_config";
  }
  return fetched.status === 403 || (Number.isInteger(fetched.status) && fetched.status >= 500);
}

/**
 * GET a path trying the primary base first, then the secondary base when the
 * primary failure is failover-eligible. Returns the fetch result plus
 * `attempts` (1 or 2) and `failedOver` for observability.
 */
export async function fetchSupercellPathWithFallback(game, path, {
  fetchImpl = fetch,
  env = process.env,
} = {}) {
  const bases = supercellBasesFor(game, env);
  if (!bases) {
    return {
      ok: false,
      attempts: 0,
      failedOver: false,
      attempt: { kind: "unavailable", diagnostic: { reason: "provider_error" } },
    };
  }
  const prefix = ENV_PREFIX[game];
  const [primary, secondary] = bases;
  const primaryEnv = { ...env, [`${prefix}_API_BASE`]: primary };
  const first = await fetchSupercellPath(game, path, { fetchImpl, env: primaryEnv });
  if (!secondary || !shouldFailOver(first)) {
    return { ...first, attempts: 1, failedOver: false };
  }
  const secondaryEnv = { ...env, [`${prefix}_API_BASE`]: secondary };
  const second = await fetchSupercellPath(game, path, { fetchImpl, env: secondaryEnv });
  return { ...second, attempts: 2, failedOver: true };
}
