import { confirmedNickname } from "../nickname-validation.mjs";

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function responseKind(payload) {
  const root = record(payload);
  if (!payload || typeof payload !== "object") return "empty_or_non_json";
  if (Array.isArray(payload)) return "json_array";
  if (["error", "status", "msg"].every((key) => key in root)) return "id_game_checker_schema";
  if (
    root.status && typeof root.status === "object" && !Array.isArray(root.status) &&
    typeof root.status.message === "string"
  ) return "nested_status_error";
  if (typeof root.message === "string") return "gateway_message_json";
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
 * ID Game Checker documents three important response states:
 * - error:false, status:200, msg:id_found with data.username: verified name
 * - error:false, status:204, msg:no_content_0: upstream source could not be read
 * - error:true, status:404, msg:id_not_found: an explicit missing-ID result
 *
 * Do not treat an HTTP 404 alone as proof the ID is absent: gateways and
 * provider versions may return a different body. No raw provider body is logged.
 */
export function classifyRapidApiResponse(httpStatus, payload) {
  const root = record(payload);
  const providerStatus = Number(root?.status);
  const message = typeof root?.msg === "string" ? root.msg.trim().toLowerCase() : "";

  if (httpStatus === 429) {
    return {
      kind: "rate_limited",
      diagnostic: diagnosticForStatus(429, payload),
    };
  }

  if (root?.error === true && providerStatus === 404 && message === "id_not_found") {
    return { kind: "not_found" };
  }

  if (
    httpStatus === 204 ||
    (providerStatus === 204 && message === "no_content_0")
  ) {
    return {
      kind: "unavailable",
      diagnostic: {
        reason: "provider_error",
        statusCode: Number.isInteger(httpStatus) ? httpStatus : 204,
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

  const nickname = confirmedNickname(payload);
  if (nickname) {
    return { kind: "success", nickname, source: "rapidapi_id_game_checker" };
  }

  // Retain conservative handling for older response versions with an
  // explicit not-found message, but never treat an empty/unreadable body as 404.
  const nested = record(root?.data);
  const notFoundMessage = [
    root?.msg,
    root?.message,
    root?.reason,
    nested?.msg,
    nested?.message,
    nested?.reason,
  ].filter((value) => typeof value === "string").join(" ");
  if (
    (root?.error === true || root?.success === false || root?.valid === false || nested?.valid === false) &&
    /not found|does not exist|invalid (player|user|game)?\s*id|cannot find|can't find|no such account/i.test(notFoundMessage)
  ) {
    return { kind: "not_found" };
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

export async function lookupRapidApi(playerId, zoneId) {
  const apiKey = process.env.RAPIDAPI_KEY?.trim() || process.env.RAPIDAPI_APP_TOKEN?.trim();
  if (!apiKey) {
    return { kind: "unavailable", diagnostic: { reason: "missing_config" } };
  }

  const endpoint =
    "https://id-game-checker.p.rapidapi.com/mobile-legends/" +
    encodeURIComponent(playerId) +
    "/" +
    encodeURIComponent(zoneId);

  try {
    const upstream = await fetch(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "x-rapidapi-host": "id-game-checker.p.rapidapi.com",
        "x-rapidapi-key": apiKey,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(7000),
    });

    // Read JSON even for HTTP 404 because this provider documents a structured
    // id_not_found body. Parsing failures are swallowed and sanitized below.
    const payload = await upstream.json().catch(() => null);
    return classifyRapidApiResponse(upstream.status, payload);
  } catch {
    return { kind: "unavailable", diagnostic: { reason: "network_or_timeout" } };
  }
}
