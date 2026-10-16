/**
 * Supercell player-profile adapter: full profile summaries for Brawl Stars,
 * Clash of Clans, and Clash Royale via the official `/v1/players/{tag}`
 * endpoint (through the hardened primary/secondary chain).
 *
 * Success carries a bounded, game-shaped profile: identity (name/tag),
 * progression (trophies, level, wins), and a small club/clan pointer. Full
 * collections (brawlers, troops, cards, achievements) are summarized as
 * counts so responses stay small and quota-friendly; detail endpoints can
 * expose them later.
 *
 * Responses are cached per game+tag with a short TTL (profiles change with
 * every battle) and concurrent lookups collapse into one upstream request.
 *
 * Privacy: callers receive the profile they asked for; credentials, URLs,
 * headers, and raw upstream payloads stay server-side.
 */

import { normalizeSupercellTag } from "./supercell.mjs";
import { fetchSupercellPathWithFallback } from "./supercell-fallback.mjs";
import { providerCache } from "./provider-cache.mjs";

export const PROFILE_CACHE_TTL_SECONDS = 300;

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function countOf(value) {
  return Array.isArray(value) ? value.length : null;
}

function nonNegativeInt(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function summarizeProfile(game, payload) {
  const root = record(payload);
  const name = text(root?.name);
  const tag = text(root?.tag);
  if (!root || !name || !tag) return null;
  const club = record(root.club) ?? record(root.clan) ?? null;
  const profile = {
    name,
    tag,
    trophies: nonNegativeInt(root.trophies),
    level: nonNegativeInt(root.expLevel ?? root.level),
    wins:
      nonNegativeInt(root["3vs3Victories"] ?? root.soloVictories ?? root.warStars ?? root.wins) ??
      null,
    club: club ? { name: text(club.name) || null, tag: text(club.tag) || null } : null,
  };
  if (game === "brawl-stars") {
    profile.highestTrophies = nonNegativeInt(root.highestTrophies);
    profile.brawlerCount = countOf(root.brawlers);
    profile.starPowerCount = countOf(root.starPowers);
    profile.gadgetCount = countOf(root.gadgets);
  } else if (game === "clash-of-clans") {
    profile.townHallLevel = nonNegativeInt(root.townHallLevel);
    profile.warStars = nonNegativeInt(root.warStars);
    profile.troopCount = countOf(root.troops);
    profile.heroCount = countOf(root.heroes);
    profile.achievementCount = countOf(root.achievements);
  } else {
    profile.challengeCardsWon = nonNegativeInt(root.challengeCardsWon);
    profile.tournamentCardsWon = nonNegativeInt(root.tournamentCardsWon);
    profile.cardCount = countOf(root.cards);
    profile.achievementCount = countOf(root.achievements);
  }
  return profile;
}

export function classifyProfileResponse(httpStatus, payload, source) {
  if (httpStatus === 429 || httpStatus === 403) {
    return { kind: "rate_limited", diagnostic: { reason: "http_error", statusCode: httpStatus } };
  }
  const root = record(payload);
  const reason = typeof root?.reason === "string" ? root.reason.trim().toLowerCase() : "";
  if (
    httpStatus === 404 ||
    (Number.isInteger(httpStatus) && httpStatus >= 400 && httpStatus < 500 && reason === "notfound")
  ) {
    return { kind: "not_found" };
  }
  if (!Number.isInteger(httpStatus) || httpStatus < 200 || httpStatus >= 300) {
    return { kind: "unavailable", diagnostic: { reason: "http_error", statusCode: httpStatus } };
  }
  const nickname = text(root?.name);
  if (!nickname) {
    if (root?.name === null || reason === "notfound") return { kind: "not_found" };
    return { kind: "unavailable", diagnostic: { reason: "unrecognized_response", statusCode: httpStatus } };
  }
  return { kind: "success", nickname, source };
}

/**
 * Look up a full player profile by tag. Returns `{ kind: "success", profile,
 * source, cached }` on success; LookupAttempt shapes otherwise.
 */
export async function lookupSupercellProfile(game, tag, {
  fetchImpl = fetch,
  env = process.env,
  cache = providerCache,
} = {}) {
  const normalized = normalizeSupercellTag(tag);
  if (!normalized) return { kind: "unavailable", diagnostic: { reason: "provider_error" } };
  const cacheKey = `supercell:profile:${game}:${normalized}`;
  const { value, cached } = await cache.getOrLoad(cacheKey, PROFILE_CACHE_TTL_SECONDS, async () => {
    const fetched = await fetchSupercellPathWithFallback(
      game,
      `/v1/players/${encodeURIComponent(normalized)}`,
      { fetchImpl, env },
    );
    if (!fetched.ok) return fetched.attempt;
    const classified = classifyProfileResponse(fetched.status, fetched.payload, fetched.source);
    if (classified.kind !== "success") return classified;
    const profile = summarizeProfile(game, fetched.payload);
    if (!profile) {
      return {
        kind: "unavailable",
        diagnostic: { reason: "unrecognized_response", statusCode: fetched.status },
      };
    }
    return { kind: "success", profile, source: classified.source };
  });
  if (value?.kind === "success") return { ...value, cached };
  return value;
}
