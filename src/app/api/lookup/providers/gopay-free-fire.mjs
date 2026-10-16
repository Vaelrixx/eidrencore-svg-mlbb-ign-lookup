import { confirmedNickname } from "../nickname-validation.mjs";
import { providerCache } from "./provider-cache.mjs";

const GOPAY_ENDPOINT = "https://gopay.co.id/games/v1/order/user-account";
const GOPAY_FETCH_TIMEOUT_MS = 7000;
export const GOPAY_IDENTITY_CACHE_TTL_SECONDS = 300;

/** Sentinel: thrown to keep transient misses out of the cache (rejections are never cached). */
class TransientUpstreamError extends Error {
  constructor(attempt) {
    super("transient upstream outcome");
    this.attempt = attempt;
  }
}

/**
 * Free Fire via keyless GoPay Games (code FREEFIRE). Wired as the fallback
 * leg behind the keyed primary on both FF routes. Contract verified live
 * 2026-10-13 (re-verified at build time):
 * - docs sample 1958604115 -> 200 Success + real nickname
 * - bogus 000000000000001 -> 404 {"statusCode":404,"message":"Unknown User"}
 * Not-found keys ONLY on the explicit unknown-user envelope; every other
 * non-2xx shape degrades honestly. IDs stay strings.
 */
const NOT_FOUND_MESSAGE_PATTERN = /^Unknown User/i;

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function responseKind(payload) {
  if (!payload || typeof payload !== "object") return "empty_or_non_json";
  if (Array.isArray(payload)) return "json_array";
  const root = record(payload);
  const data = record(root?.data);
  if (typeof root?.message === "string" && typeof data?.username === "string") return "gopay_success_schema";
  if (typeof root?.error === "string" && typeof root?.message === "string") return "gopay_error_schema";
  return "other_json_object";
}

/**
 * Classify the GoPay FREEFIRE contract. Includes the echo guard: GoPay
 * echoes the queried ID back as `username` when the game code carries no
 * data for it (observed live 2026-10-17). Echoed identities degrade to
 * unavailable, never success.
 */
export function classifyFreeFireResponse(httpStatus, payload, requestIdentity = "") {
  const root = record(payload);
  const data = record(root?.data);

  if (httpStatus === 429) {
    return {
      kind: "rate_limited",
      diagnostic: { reason: "http_error", statusCode: 429, responseKind: responseKind(payload) },
    };
  }

  const message = typeof root?.message === "string" ? root.message : "";
  if (
    httpStatus === 404 &&
    root?.statusCode === 404 &&
    root?.error === "Not Found" &&
    NOT_FOUND_MESSAGE_PATTERN.test(message)
  ) {
    return { kind: "not_found" };
  }

  if (!Number.isInteger(httpStatus) || httpStatus < 200 || httpStatus >= 300) {
    return {
      kind: "unavailable",
      diagnostic: { reason: "http_error", statusCode: Number.isInteger(httpStatus) ? httpStatus : 502, responseKind: responseKind(payload) },
    };
  }

  if (root?.message === "Success" && typeof data?.username === "string") {
    if (isEchoedIdentity(data.username, requestIdentity)) {
      return {
        kind: "unavailable",
        diagnostic: { reason: "unrecognized_response", statusCode: httpStatus, responseKind: responseKind(payload) },
      };
    }
    const nickname = confirmedNickname(payload);
    if (nickname) return { kind: "success", nickname, source: "gopay_games_validation" };
  }

  return {
    kind: "unavailable",
    diagnostic: {
      reason: "unrecognized_response",
      statusCode: httpStatus,
      responseKind: responseKind(payload),
    },
  };
}

/**
 * True when the returned username merely repeats the queried identity.
 * Comparison strips separators so formatted echoes still match.
 */
export function isEchoedIdentity(username, requestIdentity) {
  if (typeof username !== "string" || typeof requestIdentity !== "string") return false;
  const compactUsername = username.replace(/[\s+\-_.]/g, "");
  const compactIdentity = requestIdentity.replace(/[\s+\-_.]/g, "");
  if (!compactUsername || !compactIdentity) return false;
  return compactUsername === compactIdentity;
}

export async function lookupGoPayFreeFire(playerId, options = {}) {
  if (typeof playerId !== "string" || !/^\d{3,24}$/.test(playerId.trim())) {
    return { kind: "unavailable", diagnostic: { reason: "invalid_input" } };
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const cache = options.cache ?? providerCache;
  const cacheKey = `gopay:identity:FREEFIRE:${playerId.trim()}`;
  try {
    const { value, cached } = await cache.getOrLoad(cacheKey, GOPAY_IDENTITY_CACHE_TTL_SECONDS, async () => {
      let attempt;
      try {
        const upstream = await fetchImpl(GOPAY_ENDPOINT, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (compatible; EidrenMLBBLookup/1.0)",
          },
          body: JSON.stringify({
            code: "FREEFIRE",
            data: { userId: playerId.trim(), zoneId: "" },
          }),
          cache: "no-store",
          signal: AbortSignal.timeout(GOPAY_FETCH_TIMEOUT_MS),
        });
        const payload = await upstream.json().catch(() => null);
        attempt = classifyFreeFireResponse(upstream.status, payload, playerId.trim());
      } catch {
        attempt = { kind: "unavailable", diagnostic: { reason: "network_or_timeout" } };
      }
      // Cache stable verdicts only; transient misses always re-fetch.
      if (attempt?.kind === "unavailable") throw new TransientUpstreamError(attempt);
      return attempt;
    });
    if (value?.kind === "success") return { ...value, cached };
    return value;
  } catch (error) {
    if (error instanceof TransientUpstreamError) return error.attempt;
    return { kind: "unavailable", diagnostic: { reason: "network_or_timeout" } };
  }
}
