import { confirmedNickname } from "../nickname-validation.mjs";

const VOLSEVER_GATEWAY = "https://gate.volsever.com/proxy/api/game";

/**
 * Volsever gateway slugs confirmed live on the production key 2026-10-22
 * via ID-less route probes (HTTP 400 param-validation = route exists).
 * Slugs returning 403 ENDPOINT_NOT_ALLOWED are deliberately absent.
 * zone: null means the route takes no zone param; otherwise the default zone.
 */
export const VOLSEVER_GAME_ROUTES = Object.freeze({
  "pubg-mobile": Object.freeze({ slug: "pubg-mobile-global", zone: null }),
  "call-of-duty-mobile": Object.freeze({ slug: "codm-garena", zone: null }),
  "free-fire": Object.freeze({ slug: "freefire", zone: null }),
  "free-fire-global": Object.freeze({ slug: "free-fire-global", zone: null }),
  "genshin-impact": Object.freeze({ slug: "genshin-impact", zone: null }),
  "honkai-star-rail": Object.freeze({ slug: "honkai-star-rail", zone: null }),
  "zenless-zone-zero": Object.freeze({ slug: "zenless-zone-zero", zone: null }),
  "honor-of-kings": Object.freeze({ slug: "honor-of-kings", zone: null }),
  "arena-of-valor": Object.freeze({ slug: "arena-of-valor", zone: null }),
  "pubg-lite": Object.freeze({ slug: "pubg-mobile-lite", zone: null }),
  jawaker: Object.freeze({ slug: "jawaker", zone: null }),
  "bigo-live": Object.freeze({ slug: "bigo-live", zone: null }),
  "brawl-stars": Object.freeze({ slug: "brawl-stars", zone: null }),
  "clash-of-clans": Object.freeze({ slug: "clash-of-clans", zone: null }),
  "8-ball-pool": Object.freeze({ slug: "8-ball-pool", zone: null }),
  "arena-breakout": Object.freeze({ slug: "arena-breakout", zone: null }),
  "blood-strike": Object.freeze({ slug: "blood-strike", zone: null }),
  "delta-force-garena": Object.freeze({ slug: "delta-force", zone: null }),
  "eggy-party": Object.freeze({ slug: "eggy-party", zone: null }),
  "ace-racer": Object.freeze({ slug: "ace-racer", zone: null }),
  "dragon-raja": Object.freeze({ slug: "dragon-raja", zone: null }),
  lifeafter: Object.freeze({ slug: "lifeafter", zone: null }),
  "pokemon-unite": Object.freeze({ slug: "pokemon-unite", zone: null }),
  "whiteout-survival": Object.freeze({ slug: "whiteout-survival", zone: null }),
  "speed-drifters": Object.freeze({ slug: "speed-drifters", zone: null }),
  "super-sus": Object.freeze({ slug: "super-sus", zone: null }),
  "point-blank": Object.freeze({ slug: "point-blank", zone: null }),
  valorant: Object.freeze({ slug: "valorant", zone: null }),
});

export function classifyVolseverResponse(httpStatus, payload, playerId) {
  const root = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
  if (httpStatus === 429) {
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
  const endpoint = new URL(`${VOLSEVER_GATEWAY}/mobile-legends`);
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

/**
 * Generic Volsever leg for any registered game. Same envelope + echo guard
 * as the MLBB leg; only registered slugs may be called, so a bad game name
 * degrades without a network call. Zone-capable routes pass the input zone
 * when the caller supplies one.
 */
export async function lookupVolseverGame(game, playerId, options = {}) {
  const route = VOLSEVER_GAME_ROUTES[game];
  if (!route) return { kind: "unavailable", diagnostic: { reason: "invalid_input" } };
  const apiKey = options.apiKey ?? process.env.VOLSEVER_API_KEY?.trim();
  if (!apiKey) return { kind: "unavailable", diagnostic: { reason: "missing_config" } };
  if (typeof playerId !== "string" || !playerId.trim() || playerId.trim().length > 64) {
    return { kind: "unavailable", diagnostic: { reason: "invalid_input" } };
  }
  const endpoint = new URL(`${VOLSEVER_GATEWAY}/${route.slug}`);
  endpoint.searchParams.set("id", playerId.trim());
  const zone = typeof options.zone === "string" && options.zone.trim() ? options.zone.trim() : route.zone;
  if (zone) endpoint.searchParams.set("zone", zone);
  try {
    const response = await (options.fetchImpl ?? fetch)(endpoint, {
      method: "GET",
      headers: { Accept: "application/json", "X-API-KEY": apiKey },
      cache: "no-store",
      signal: AbortSignal.timeout(7000),
    });
    const payload = await response.json().catch(() => null);
    return classifyVolseverResponse(response.status, payload, playerId.trim());
  } catch {
    return { kind: "unavailable", diagnostic: { reason: "network_or_timeout" } };
  }
}
