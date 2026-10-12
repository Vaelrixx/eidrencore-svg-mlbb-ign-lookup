import { classifyRapidApiGameResponse } from "./rapidapi.mjs";

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
  // Free Fire key-ready (case 20261013-ffown): slugs docs-verified on the
  // provider's own docs; primary ships when a direct key lands in Railway.
  "free-fire": Object.freeze({ slug: "free-fire", fields: ["playerId"] }),
  "free-fire-global": Object.freeze({ slug: "ff-global", fields: ["playerId"] }),
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
  return classifyRapidApiGameResponse(httpStatus, payload);
}

const GAME_FETCH_TIMEOUT_MS = 15000;
const GAME_FETCH_MAX_ATTEMPTS = 2;
const GAME_FETCH_RETRY_DELAY_MS = 800;

function delay(ms, sleepImpl) {
  if (ms <= 0) return Promise.resolve();
  if (typeof sleepImpl === "function") return sleepImpl(ms);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, init, fetchImpl, sleepImpl) {
  let lastError;
  for (let attempt = 1; attempt <= GAME_FETCH_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(GAME_FETCH_TIMEOUT_MS) });
    } catch (error) {
      lastError = error;
      if (attempt < GAME_FETCH_MAX_ATTEMPTS) await delay(GAME_FETCH_RETRY_DELAY_MS, sleepImpl);
    }
  }
  throw lastError;
}

export async function lookupRapidApiGame(game, input, options = {}) {
  const apiKey = options.apiKey ?? process.env.RAPIDAPI_KEY?.trim() ?? process.env.RAPIDAPI_APP_TOKEN?.trim();
  if (!apiKey) return { kind: "unavailable", diagnostic: { reason: "missing_config" } };
  const path = routePath(game, input);
  if (!path) return { kind: "unavailable", diagnostic: { reason: "invalid_input" } };

  const fetchImpl = options.fetchImpl ?? fetch;
  const sleepImpl = options.sleepImpl;
  try {
    const upstream = await fetchWithRetry(`https://${RAPIDAPI_HOST}${path}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "x-rapidapi-host": RAPIDAPI_HOST,
        "x-rapidapi-key": apiKey,
      },
      cache: "no-store",
    }, fetchImpl, sleepImpl);
    const payload = await upstream.json().catch(() => null);
    return classifyGameResponse(upstream.status, payload);
  } catch {
    return { kind: "unavailable", diagnostic: { reason: "network_or_timeout" } };
  }
}

export { routePath as rapidApiGamePath };
