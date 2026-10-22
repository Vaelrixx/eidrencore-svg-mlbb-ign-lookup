import { confirmedNickname } from "../nickname-validation.mjs";

const VOLSEVER_MLBB_ENDPOINT = "https://gate.volsever.com/proxy/api/game/mobile-legends";

export function classifyVolseverResponse(httpStatus, payload, playerId) {
  const root = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
  if (httpStatus === 429) {
    // Re-probe 2026-10-22: the key carries a 45 req/day service cap whose
    // envelope is {error:"SERVICE_LIMIT_EXCEEDED", limitType:"daily"},
    // distinct from the 15 req/min anti-spam 429. Surface the daily-cap
    // state so ops reads it as degraded-fallback, not provider outage.
    if (root?.error === "SERVICE_LIMIT_EXCEEDED" && root?.limitType === "daily") {
      return { kind: "rate_limited", diagnostic: { reason: "quota_exhausted", statusCode: 429 } };
    }
    return { kind: "rate_limited", diagnostic: { reason: "http_error", statusCode: 429 } };
  }
  // Live-verified 2026-10-19: bogus MLBB IDs return exactly
  // {status:false, code:404, message:"ID not found"} (distinct from the
  // docs' "Game not found" route error, which stays unavailable).
  if (root?.status === false && root?.code === 404 && root?.message === "ID not found") {
    return { kind: "not_found" };
  }
  if (httpStatus === 200 && root?.status === true && root?.code === 200) {
    const nickname = confirmedNickname(root);
    if (nickname && nickname !== playerId) {
      return { kind: "success", nickname, source: "volsever_game_checker" };
    }
  }
  // The public docs do not distinguish a missing player from a bad game route
  // on 400/404, so only confirmed usernames may count as success.
  return {
    kind: "unavailable",
    diagnostic: {
      reason: "unrecognized_response",
      statusCode: Number.isInteger(httpStatus) ? httpStatus : 502,
    },
  };
}

export async function lookupVolseverMlbb(playerId, zoneId, options = {}) {
  const apiKey = options.apiKey ?? process.env.VOLSEVER_API_KEY?.trim();
  if (!apiKey) return { kind: "unavailable", diagnostic: { reason: "missing_config" } };
  if (typeof playerId !== "string" || !/^\d{4,20}$/.test(playerId) || typeof zoneId !== "string" || !/^\d{1,10}$/.test(zoneId)) {
    return { kind: "unavailable", diagnostic: { reason: "invalid_input" } };
  }
  const endpoint = new URL(VOLSEVER_MLBB_ENDPOINT);
  endpoint.searchParams.set("id", playerId);
  endpoint.searchParams.set("zone", zoneId);
  try {
    const response = await (options.fetchImpl ?? fetch)(endpoint, {
      method: "GET",
      headers: { Accept: "application/json", "X-API-KEY": apiKey },
      cache: "no-store",
      signal: AbortSignal.timeout(7000),
    });
    const payload = await response.json().catch(() => null);
    return classifyVolseverResponse(response.status, payload, playerId);
  } catch {
    return { kind: "unavailable", diagnostic: { reason: "network_or_timeout" } };
  }
}
