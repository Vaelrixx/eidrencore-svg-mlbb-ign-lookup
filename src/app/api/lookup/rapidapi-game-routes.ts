import { createIdGameLookupHandler, type IdGameLookupConfig } from "./id-game-route";
import { lookupRapidApiGame, type RapidApiGame, type RapidApiGameInput } from "./providers/rapidapi-games.mjs";
import { lookupEnkaGenshin } from "./providers/enka-genshin.mjs";

const numericId = /^\d{3,24}$/;
const riotName = /^[\p{L}\p{N} _.'-]{3,16}$/u;
const riotTag = /^[A-Za-z0-9]{3,5}$/;
const genshinServer = /^(asia|america|europa|china)$/;

/**
 * Genshin chain: keyed primary first, then the keyless showcase fallback.
 * The primary returns empty no_content envelopes for UIDs its data feed does
 * not carry (WI-011); the fallback resolves those same UIDs from live
 * showcase data. Not-found and rate-limit verdicts are terminal; only
 * degraded/unavailable primary outcomes fall through. The public source stays
 * white-labeled either way.
 */
async function lookupGenshinWithFallback(input: RapidApiGameInput) {
  const primary = await lookupRapidApiGame("genshin-impact", input);
  if (primary.kind === "success" || primary.kind === "not_found" || primary.kind === "rate_limited") {
    return primary;
  }
  const playerId = "playerId" in input ? input.playerId : "";
  const fallback = await lookupEnkaGenshin(playerId);
  if (fallback.kind === "success" || fallback.kind === "not_found" || fallback.kind === "rate_limited") {
    return fallback;
  }
  return primary;
}

const configs: Record<string, { providerGame: RapidApiGame; config: Omit<IdGameLookupConfig, "lookup"> }> = {
  "pubg-mobile": {
    providerGame: "pubg-mobile",
    config: {
      endpoint: "/api/lookup/pubg-mobile",
      gameLabel: "PUBG Mobile Global",
      publicSource: "eidren_pubg_mobile",
      notFoundCode: "PUBG_PLAYER_NOT_FOUND",
      internalProvider: "rapidapi_id_game_checker_pubg_mobile",
      fields: [{ key: "playerId", label: "Character ID", example: "5204837417", minLength: 3, maxLength: 24, pattern: numericId }],
    },
  },
  "call-of-duty-mobile": {
    providerGame: "cod-mobile-garena",
    config: {
      endpoint: "/api/lookup/call-of-duty-mobile",
      gameLabel: "Call of Duty: Mobile (Garena)",
      publicSource: "eidren_call_of_duty_mobile",
      notFoundCode: "CODM_PLAYER_NOT_FOUND",
      internalProvider: "rapidapi_id_game_checker_cod_mobile",
      fields: [{ key: "playerId", label: "Player ID", example: "8370310025568788000", minLength: 3, maxLength: 24, pattern: numericId }],
    },
  },
  valorant: {
    providerGame: "valorant",
    config: {
      endpoint: "/api/lookup/valorant",
      gameLabel: "VALORANT",
      publicSource: "eidren_valorant",
      notFoundCode: "VALORANT_PLAYER_NOT_FOUND",
      internalProvider: "rapidapi_id_game_checker_valorant",
      fields: [
        { key: "name", label: "Riot ID name", example: "ucup", minLength: 3, maxLength: 16, pattern: riotName },
        { key: "tag", label: "Riot ID tag", example: "123", minLength: 3, maxLength: 5, pattern: riotTag },
      ],
    },
  },
  "genshin-impact": {
    providerGame: "genshin-impact",
    config: {
      endpoint: "/api/lookup/genshin-impact",
      gameLabel: "Genshin Impact",
      publicSource: "eidren_genshin_impact",
      notFoundCode: "GENSHIN_PLAYER_NOT_FOUND",
      internalProvider: "eidren_genshin_chain",
      fields: [
        { key: "playerId", label: "UID", example: "844335555", minLength: 3, maxLength: 24, pattern: numericId },
        { key: "server", label: "Server", example: "asia", minLength: 4, maxLength: 7, pattern: genshinServer },
      ],
    },
  },
  "honor-of-kings": {
    providerGame: "honor-of-kings",
    config: {
      endpoint: "/api/lookup/honor-of-kings",
      gameLabel: "Honor of Kings",
      publicSource: "eidren_honor_of_kings",
      notFoundCode: "HONOR_OF_KINGS_PLAYER_NOT_FOUND",
      internalProvider: "rapidapi_id_game_checker_honor_of_kings",
      fields: [{ key: "playerId", label: "Player ID", example: "17960996468644334037", minLength: 3, maxLength: 24, pattern: numericId }],
    },
  },
  // Free Fire key-ready (case 20261013-ffown): primary answers once a direct
  // provider key (or a live keyless fallback) is wired into the chain below.
  // Until then the route validates input and returns honest 502 degraded,
  // never a false not-found. Samples are the provider's documented examples.
  "free-fire": {
    providerGame: "free-fire",
    config: {
      endpoint: "/api/lookup/free-fire",
      gameLabel: "Free Fire",
      publicSource: "eidren_free_fire",
      notFoundCode: "FREE_FIRE_PLAYER_NOT_FOUND",
      internalProvider: "eidren_free_fire_chain",
      fields: [{ key: "playerId", label: "UID", example: "1958604115", minLength: 3, maxLength: 24, pattern: numericId }],
    },
  },
  "free-fire-global": {
    providerGame: "free-fire-global",
    config: {
      endpoint: "/api/lookup/free-fire-global",
      gameLabel: "Free Fire Global",
      publicSource: "eidren_free_fire_global",
      notFoundCode: "FREE_FIRE_GLOBAL_PLAYER_NOT_FOUND",
      internalProvider: "eidren_free_fire_global_chain",
      fields: [{ key: "playerId", label: "UID", example: "12341234", minLength: 3, maxLength: 24, pattern: numericId }],
    },
  },
};

export function createRapidApiGameHandler(game: keyof typeof configs) {
  const entry = configs[game];
  const config: IdGameLookupConfig = {
    ...entry.config,
    lookup: async (input) => {
      // Free Fire chain slot: direct key first when provisioned, own proxy /
      // keyless fallback second. No fallback is wired yet, so the primary
      // attempt is returned as-is (honest degraded, never false not-found).
      if (entry.providerGame === "free-fire" || entry.providerGame === "free-fire-global") {
        return lookupRapidApiGame(entry.providerGame, input as RapidApiGameInput);
      }
      if (entry.providerGame === "genshin-impact") {
        return lookupGenshinWithFallback(input as RapidApiGameInput);
      }
      return lookupRapidApiGame(entry.providerGame, input as RapidApiGameInput);
    },
  };
  return createIdGameLookupHandler(config);
}
