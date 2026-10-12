const ENKA_UID_ENDPOINT = "https://enka.network/api/uid/";
const ENKA_USER_AGENT = "EidrenIdentityLookup/1.0";
const ENKA_FETCH_TIMEOUT_MS = 10000;

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function responseKind(payload) {
  if (payload === null || payload === undefined) return "empty_or_non_json";
  if (typeof payload !== "object" || Array.isArray(payload)) return "empty_or_non_json";
  const root = record(payload);
  const playerInfo = record(root?.playerInfo);
  if (typeof playerInfo?.nickname === "string") return "enka_player_schema";
  if (typeof root?.message === "string") return "enka_error_schema";
  return "other_json_object";
}

/**
 * Classify only the observed Enka contract (verified live 2026-10-13):
 * HTTP 200 + playerInfo.nickname string -> success; HTTP 404 -> not_found;
 * HTTP 400 (wrong_uid) -> invalid_input; 429 -> rate_limited; 424/5xx and
 * unknown shapes -> unavailable. Never infer not-found from HTTP alone
 * outside the explicit 404 gate.
 */
export function classifyEnkaGenshinResponse(httpStatus, payload) {
  const root = record(payload);
  const playerInfo = record(root?.playerInfo);
  const kind = responseKind(payload);

  if (httpStatus === 429) {
    return {
      kind: "rate_limited",
      diagnostic: { reason: "http_error", statusCode: 429, responseKind: kind },
    };
  }

  if (httpStatus === 404) {
    return { kind: "not_found" };
  }

  if (httpStatus === 400) {
    return {
      kind: "unavailable",
      diagnostic: { reason: "invalid_input", statusCode: 400, responseKind: kind },
    };
  }

  if (!Number.isInteger(httpStatus) || httpStatus < 200 || httpStatus >= 300) {
    return {
      kind: "unavailable",
      diagnostic: {
        reason: "http_error",
        statusCode: Number.isInteger(httpStatus) ? httpStatus : 502,
        responseKind: kind,
      },
    };
  }

  const nickname = typeof playerInfo?.nickname === "string" ? playerInfo.nickname.trim() : "";
  if (nickname) {
    return { kind: "success", nickname, source: "enka_showcase_lookup" };
  }

  return {
    kind: "unavailable",
    diagnostic: { reason: "unrecognized_response", statusCode: httpStatus, responseKind: kind },
  };
}

export async function lookupEnkaGenshin(playerId, options = {}) {
  if (typeof playerId !== "string" || !/^\d{3,24}$/.test(playerId.trim())) {
    return { kind: "unavailable", diagnostic: { reason: "invalid_input" } };
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const upstream = await fetchImpl(`${ENKA_UID_ENDPOINT}${encodeURIComponent(playerId.trim())}/?info`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": ENKA_USER_AGENT,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(ENKA_FETCH_TIMEOUT_MS),
    });
    const payload = await upstream.json().catch(() => null);
    return classifyEnkaGenshinResponse(upstream.status, payload);
  } catch {
    return { kind: "unavailable", diagnostic: { reason: "network_or_timeout" } };
  }
}
