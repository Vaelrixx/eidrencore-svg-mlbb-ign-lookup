import { createIdGameLookupHandler, type IdGameLookupConfig } from "./id-game-route";
import { lookupRapidApiGame, type RapidApiGame, type RapidApiGameInput } from "./providers/rapidapi-games.mjs";

const numericId = /^\d{3,24}$/;
const riotName = /^[\p{L}\p{N} _.'-]{3,16}$/u;
const riotTag = /^[A-Za-z0-9]{3,5}$/;
const genshinServer = /^(asia|america|europa|china)$/;

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
      internalProvider: "rapidapi_id_game_checker_genshin_impact",
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
};

export function createRapidApiGameHandler(game: keyof typeof configs) {
  const entry = configs[game];
  const config: IdGameLookupConfig = {
    ...entry.config,
    lookup: (input) => lookupRapidApiGame(entry.providerGame, input as RapidApiGameInput),
  };
  return createIdGameLookupHandler(config);
}
