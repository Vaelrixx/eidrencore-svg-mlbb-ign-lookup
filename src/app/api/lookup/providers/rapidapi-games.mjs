import { confirmedNickname } from "../nickname-validation.mjs";
import { classifyRapidApiResponse } from "./rapidapi.mjs";

const RAPIDAPI_HOST = "id-game-checker.p.rapidapi.com";
const GENSHIN_SERVERS = new Set(["asia", "america", "europa", "china"]);

/**
 * Game route contracts verified against published endpoint snippets.
 * Numeric-looking identity values remain strings throughout URL construction;
 * never coerce them to Number, because IDs may exceed Number.MAX_SAFE_INTEGER.
 */
export const RAPIDAPI_GAME_ROUTES = Object.freeze({
  "pubg-mobile": Object.freeze({ slug: "pubgm-global", fields: ["playerId"] }),
  "cod-mobile-garena": Object.freeze({ slug: "cod-mobile", fields: ["playerId"] }),
  valorant: Object.freeze({ slug: "valorant", fields: ["name", "tag"] }),
  "genshin-impact": Object.freeze({ slug: "genshin", fields: ["playerId", "server"] }),
  "honor-of-kings": Object.freeze({ slug: "honor-of-kings", fields: ["playerId"] }),
});

function routePath(game, input) {
  const config = RAPIDAPI_GAME_ROUTES[game];
  if (!config || !input || typeof input !== "object") return null;
  if (game === "genshin-impact" && !GENSHIN_SERVERS.has(input.server)) return null;
  const segments = [config.slug, ...config.fields.map((field) => input[field])];
  if (segments.some((segment) => typeof segment !== "string" || !segment.trim())) return null;
  return `/${segments.map((segment) => encodeURIComponent(segment.trim())).join("/")}`;
}

function classifyGameResponse(httpStatus, payload) {
  const attempt = classifyRapidApiResponse(httpStatus, payload);
  if (attempt.kind !== "success") return attempt;
  const nickname = confirmedNickname(payload);
  if (!nickname) return { kind: "unavailable", diagnostic: { reason: "unrecognized_response", statusCode: httpStatus } };
  return { ...attempt, nickname, source: attempt.source };
}

export async function lookupRapidApiGame(game, input, options = {}) {
  const apiKey = options.apiKey ?? process.env.RAPIDAPI_KEY?.trim() ?? process.env.RAPIDAPI_APP_TOKEN?.trim();
  if (!apiKey) return { kind: "unavailable", diagnostic: { reason: "missing_config" } };
  const path = routePath(game, input);
  if (!path) return { kind: "unavailable", diagnostic: { reason: "invalid_input" } };

  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const upstream = await fetchImpl(`https://${RAPIDAPI_HOST}${path}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "x-rapidapi-host": RAPIDAPI_HOST,
        "x-rapidapi-key": apiKey,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(7000),
    });
    const payload = await upstream.json().catch(() => null);
    return classifyGameResponse(upstream.status, payload);
  } catch {
    return { kind: "unavailable", diagnostic: { reason: "network_or_timeout" } };
  }
}

export { routePath as rapidApiGamePath };
