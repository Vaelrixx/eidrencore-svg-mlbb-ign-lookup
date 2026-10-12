import { confirmedNickname } from "../nickname-validation.mjs";

const WHOPLAYS_ENDPOINT = "https://whoplays.doedja.com/api/check";

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function responseKind(payload) {
  if (!payload || typeof payload !== "object") return "empty_or_non_json";
  if (Array.isArray(payload)) return "json_array";
  const root = record(payload);
  if (typeof root?.ok === "boolean" && typeof root?.error === "string") return "whoplays_error_schema";
  if (root?.ok === true && typeof root?.username === "string") return "whoplays_success_schema";
  return "other_json_object";
}

function diagnosticForStatus(httpStatus, payload) {
  return {
    reason: "http_error",
    statusCode: httpStatus,
    responseKind: responseKind(payload),
  };
}

/**
 * WhoPlays documents a stable envelope: `{ ok, game, username }` on success
 * and `{ ok: false, error, message, code? }` on failure. Gate each outcome on
 * the documented `error` kind — never on HTTP status or message text alone:
 * - error:"not_found" (HTTP 422): an explicit missing-player result
 * - error:"rate_limited" (HTTP 429): caller hit the per-minute cap
 * - error:"unauthorized": the server-side key is wrong — a config failure,
 *   reported as unavailable so it never poisons the all-not-found verdict
 * - error:"parse"/"upstream": upstream degradation, not proof of absence
 *
 * No raw provider body, key, or player data is logged.
 */
export function classifyWhoPlaysResponse(httpStatus, payload) {
  const root = record(payload);
  const errorKind = typeof root?.error === "string" ? root.error.trim().toLowerCase() : "";

  if (httpStatus === 429 || errorKind === "rate_limited") {
    return {
      kind: "rate_limited",
      diagnostic: {
        reason: "http_error",
        statusCode: Number.isInteger(httpStatus) ? httpStatus : 429,
        responseKind: responseKind(payload),
      },
    };
  }

  if (errorKind === "not_found") {
    return { kind: "not_found" };
  }

  if (
    errorKind === "unauthorized" ||
    errorKind === "unknown_game" ||
    errorKind === "validation" ||
    errorKind === "parse" ||
    errorKind === "upstream"
  ) {
    return {
      kind: "unavailable",
      diagnostic: {
        reason: "provider_error",
        statusCode: Number.isInteger(httpStatus) ? httpStatus : 502,
        responseKind: responseKind(payload),
      },
    };
  }

  if (!Number.isInteger(httpStatus) || httpStatus < 200 || httpStatus >= 300) {
    return {
      kind: "unavailable",
      diagnostic: diagnosticForStatus(httpStatus, payload),
    };
  }

  // Success requires the documented ok:true envelope plus a usable nickname.
  if (root?.ok === true) {
    const nickname = confirmedNickname(payload);
    if (nickname) {
      return { kind: "success", nickname, source: "whoplays_check" };
    }
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

export async function lookupWhoPlays(playerId, zoneId) {
  const apiKey = process.env.WHOPLAYS_API_KEY?.trim();
  if (!apiKey) {
    return { kind: "unavailable", diagnostic: { reason: "missing_config" } };
  }

  try {
    const upstream = await fetch(WHOPLAYS_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        game: "mobile-legends",
        input: { userId: playerId, zoneId },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(7000),
    });

    // Read JSON even for error statuses because WhoPlays documents a
    // structured error envelope. Parsing failures are sanitized below.
    const payload = await upstream.json().catch(() => null);
    return classifyWhoPlaysResponse(upstream.status, payload);
  } catch {
    return { kind: "unavailable", diagnostic: { reason: "network_or_timeout" } };
  }
}
