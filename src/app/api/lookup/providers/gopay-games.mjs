import { confirmedNickname } from "../nickname-validation.mjs";

const GOPAY_ENDPOINT = "https://gopay.co.id/games/v1/order/user-account";

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
 * Classify only the observed structured contract. An HTTP 404 alone is not a
 * missing-player verdict: require the explicit account-not-recognized message
 * and matching error envelope. Unknown or changed responses stay unavailable.
 */
export function classifyGoPayGamesResponse(httpStatus, payload) {
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
    /^Invalid User Account:/i.test(message)
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

export async function lookupGoPayGames(playerId, zoneId) {
  try {
    const upstream = await fetch(GOPAY_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; EidrenMLBBLookup/1.0)",
      },
      body: JSON.stringify({
        code: "MOBILE_LEGENDS",
        data: { userId: playerId, zoneId },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(7000),
    });

    const payload = await upstream.json().catch(() => null);
    return classifyGoPayGamesResponse(upstream.status, payload);
  } catch {
    return { kind: "unavailable", diagnostic: { reason: "network_or_timeout" } };
  }
}
