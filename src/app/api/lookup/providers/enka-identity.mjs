const ENKA_PROFILE_ENDPOINTS = Object.freeze({
  hsr: "https://enka.network/api/hsr/uid/",
  zzz: "https://enka.network/api/zzz/uid/",
});
const ENKA_USER_AGENT = "EidrenIdentityLookup/1.0";
const ENKA_FETCH_TIMEOUT_MS = 10000;
const UID_PATTERN = /^\d{3,24}$/;

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function nicknameFor(game, payload) {
  const root = record(payload);
  if (game === "hsr") {
    const detailInfo = record(root?.detailInfo);
    return typeof detailInfo?.nickname === "string" ? detailInfo.nickname.trim() : "";
  }
  const playerInfo = record(root?.PlayerInfo);
  const socialDetail = record(playerInfo?.SocialDetail);
  const profileDetail = record(socialDetail?.ProfileDetail);
  return typeof profileDetail?.Nickname === "string" ? profileDetail.Nickname.trim() : "";
}

function responseKind(payload) {
  if (payload === null || payload === undefined) return "empty_or_non_json";
  if (!record(payload)) return "empty_or_non_json";
  return "json_object";
}

export function classifyEnkaIdentityResponse(game, httpStatus, payload) {
  if (!Object.hasOwn(ENKA_PROFILE_ENDPOINTS, game)) {
    return { kind: "unavailable", diagnostic: { reason: "invalid_game" } };
  }
  const kind = responseKind(payload);
  if (httpStatus === 429) {
    return { kind: "rate_limited", diagnostic: { reason: "http_error", statusCode: 429, responseKind: kind } };
  }
  if (httpStatus === 404) return { kind: "not_found" };
  if (httpStatus === 400) {
    return { kind: "unavailable", diagnostic: { reason: "invalid_input", statusCode: 400, responseKind: kind } };
  }
  if (!Number.isInteger(httpStatus) || httpStatus < 200 || httpStatus >= 300) {
    return {
      kind: "unavailable",
      diagnostic: { reason: "http_error", statusCode: Number.isInteger(httpStatus) ? httpStatus : 502, responseKind: kind },
    };
  }
  const nickname = nicknameFor(game, payload);
  if (nickname) return { kind: "success", nickname, source: game === "hsr" ? "enka_hsr_profile" : "enka_zzz_profile" };
  return { kind: "unavailable", diagnostic: { reason: "unrecognized_response", statusCode: httpStatus, responseKind: kind } };
}

export async function lookupEnkaIdentity(game, playerId, options = {}) {
  if (!Object.hasOwn(ENKA_PROFILE_ENDPOINTS, game) || typeof playerId !== "string" || !UID_PATTERN.test(playerId.trim())) {
    return { kind: "unavailable", diagnostic: { reason: "invalid_input" } };
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const upstream = await fetchImpl(`${ENKA_PROFILE_ENDPOINTS[game]}${encodeURIComponent(playerId.trim())}/?info`, {
      method: "GET",
      headers: { Accept: "application/json", "User-Agent": ENKA_USER_AGENT },
      cache: "no-store",
      signal: AbortSignal.timeout(ENKA_FETCH_TIMEOUT_MS),
    });
    const payload = await upstream.json().catch(() => null);
    return classifyEnkaIdentityResponse(game, upstream.status, payload);
  } catch {
    return { kind: "unavailable", diagnostic: { reason: "network_or_timeout" } };
  }
}
