import { confirmedNickname } from "../nickname-validation.mjs";

const GOPAY_ENDPOINT = "https://gopay.co.id/games/v1/order/user-account";
const GOPAY_FETCH_TIMEOUT_MS = 7000;

/**
 * GoPay Games keyless fallback for Arena of Valor (code AOV) and PUBG-family
 * IDs (codes PUBGM for Global, PUBG_ID for Lite). Contract verified live
 * 2026-10-13, PUBGM re-verified 2026-10-17:
 * - AOV + docs sample 195293573153949 -> 200 Success + username "creature.6's"
 * - AOV + bogus 000000000000001 -> 404 {"statusCode":404,"message":"Unknown User"}
 * - PUBGM + Global sample 5204837417 -> 200 Success + real nickname
 * - PUBG_ID + Global sample 5204837417 -> 200 Success + real nickname
 * - PUBG_ID + Lite sample 7228395004 -> 404 Invalid user account (Lite pool
 *   not carried: partial coverage only, degrade honestly)
 * - PUBG_ID + banned sample -> 404 "User account banned" (ban state, NOT
 *   not-found: degrade, never false not-found)
 * Not-found verdict keys ONLY on the explicit unknown-user message.
 * NOTE: PUBG_MOBILE (with underscore) echoes the ID back instead of
 * resolving — never use it. The echo guard also catches such codes.
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
 * Classify the shared GoPay fallback contract. Includes the echo guard:
 * GoPay echoes the queried ID back as `username` when the game code is
 * wrong or carries no data (observed live 2026-10-17 across PUBG_MOBILE,
 * CODM, HONOR_OF_KINGS, and other codes). Echoed identities degrade to
 * unavailable, never success.
 */
export function classifyGoPayGameFallbackResponse(httpStatus, payload, requestIdentity = "") {
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

export async function lookupGoPayGameFallback(gameCode, playerId, options = {}) {
  if (typeof gameCode !== "string" || !gameCode.trim()) {
    return { kind: "unavailable", diagnostic: { reason: "invalid_input" } };
  }
  if (typeof playerId !== "string" || !/^\d{3,24}$/.test(playerId.trim())) {
    return { kind: "unavailable", diagnostic: { reason: "invalid_input" } };
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const upstream = await fetchImpl(GOPAY_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; EidrenMLBBLookup/1.0)",
      },
      body: JSON.stringify({
        code: gameCode.trim(),
        data: { userId: playerId.trim(), zoneId: "" },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(GOPAY_FETCH_TIMEOUT_MS),
    });
    const payload = await upstream.json().catch(() => null);
    return classifyGoPayGameFallbackResponse(upstream.status, payload, playerId.trim());
  } catch {
    return { kind: "unavailable", diagnostic: { reason: "network_or_timeout" } };
  }
}
