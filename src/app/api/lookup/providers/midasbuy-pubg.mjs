/**
 * PUBG Mobile top-up verification via the MidasbuyAPI proxy
 * (NightsSoftware/MidasbuyAPI, docs at midasbuy.night-apis.com).
 *
 * Midasbuy is Tencent's official recharge store; its `getPlayer` backend
 * resolves a Character ID to the linked nickname — the same primitive Eidren
 * checkers use, repackaged here as a pre-purchase verification helper:
 * confirm (ID → nickname) BEFORE paying, so resellers catch typos.
 *
 * Contract (per the wrapper docs, verified docs-site live 2026-10-17):
 * - `POST {base}/api/v1/pubg/getPlayer` with `{player_id}` + `X-Api-Key`
 *   → `{player_name, player_id, status, message}`
 * - unknown IDs return an error status/message (no player_name)
 *
 * Classification is conservative: success requires a non-empty player_name;
 * explicit unknown-user messages map to not_found; auth/quota failures
 * degrade as unavailable/rate_limited. Results cache for 7 days (nicknames
 * change rarely) with single-flight coalescing.
 *
 * Env (server-only): `MIDASBUY_API_KEY` (issued via the developer's
 * Telegram), optional `MIDASBUY_API_BASE` (default
 * `https://midasbuy.night-apis.com`).
 *
 * Privacy: callers receive the nickname they asked to verify; credentials,
 * URLs, headers, and raw upstream payloads stay server-side.
 */

import { providerCache } from "./provider-cache.mjs";
import { confirmedNickname } from "../nickname-validation.mjs";

const DEFAULT_BASE = "https://midasbuy.night-apis.com";
const REQUEST_TIMEOUT_MS = 8000;

export const MIDASBUY_VERIFY_CACHE_TTL_SECONDS = 604800;

const PLAYER_ID_PATTERN = /^\d{3,24}$/;
const NOT_FOUND_MESSAGE_PATTERN = /(not\s*found|unknown\s*(user|player|id)|invalid\s*(player[\s_-]?id|id|user|player)|no\s*(user|player|result)|player\s*(not\s*exist|does\s*not\s*exist))/i;

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function baseFor(env = process.env) {
  return (env.MIDASBUY_API_BASE?.trim() || DEFAULT_BASE).replace(/\/+$/, "");
}

/** Normalize a PUBG Mobile Character ID (digits only). Returns "" when invalid. */
export function normalizePubgPlayerId(value) {
  if (typeof value !== "string") return "";
  const compact = value.trim();
  return PLAYER_ID_PATTERN.test(compact) ? compact : "";
}

export function classifyMidasbuyResponse(httpStatus, payload) {
  if (httpStatus === 429) {
    return { kind: "rate_limited", diagnostic: { reason: "http_error", statusCode: 429 } };
  }
  if (httpStatus === 401 || httpStatus === 403) {
    return { kind: "rate_limited", diagnostic: { reason: "http_error", statusCode: httpStatus } };
  }
  const root = record(payload);
  const message = text(root?.message);
  const nickname = confirmedNickname({ name: root?.player_name ?? root?.playerName ?? root?.nickname });
  if (nickname) {
    return { kind: "success", nickname, source: "midasbuy_api" };
  }
  if (httpStatus === 404 || NOT_FOUND_MESSAGE_PATTERN.test(message)) {
    return { kind: "not_found" };
  }
  if (!Number.isInteger(httpStatus) || httpStatus < 200 || httpStatus >= 300) {
    return { kind: "unavailable", diagnostic: { reason: "http_error", statusCode: httpStatus } };
  }
  return { kind: "unavailable", diagnostic: { reason: "unrecognized_response", statusCode: httpStatus } };
}

/**
 * Verify a PUBG Mobile Character ID resolves to a nickname. Cached 7 days,
 * single-flight coalesced. Returns missing_config when no key is set.
 */
export async function lookupMidasbuyPlayer(playerId, {
  fetchImpl = fetch,
  env = process.env,
  cache = providerCache,
} = {}) {
  const normalized = normalizePubgPlayerId(playerId);
  if (!normalized) return { kind: "unavailable", diagnostic: { reason: "provider_error" } };
  const key = env.MIDASBUY_API_KEY?.trim() || "";
  if (!key) {
    return { kind: "unavailable", diagnostic: { reason: "missing_config" } };
  }
  const { value, cached } = await cache.getOrLoad(
    `midasbuy:verify:${normalized}`,
    MIDASBUY_VERIFY_CACHE_TTL_SECONDS,
    async () => {
      try {
        const upstream = await fetchImpl(`${baseFor(env)}/api/v1/pubg/getPlayer`, {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json", "X-Api-Key": key },
          body: JSON.stringify({ player_id: normalized }),
          cache: "no-store",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        const payload = await upstream.json().catch(() => null);
        return classifyMidasbuyResponse(upstream.status, payload);
      } catch {
        return { kind: "unavailable", diagnostic: { reason: "network_or_timeout" } };
      }
    },
  );
  if (value?.kind === "success") return { ...value, cached };
  return value;
}
