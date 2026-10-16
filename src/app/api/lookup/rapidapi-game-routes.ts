import { createIdGameLookupHandler, type IdGameLookupConfig } from "./id-game-route";
import { lookupRapidApiGame, type RapidApiGame, type RapidApiGameInput } from "./providers/rapidapi-games.mjs";
import { lookupEnkaGenshin } from "./providers/enka-genshin.mjs";
import { lookupEnkaIdentity, type EnkaIdentityGame } from "./providers/enka-identity.mjs";
import { lookupGoPayGameFallback } from "./providers/gopay-game-fallback.mjs";
import { lookupFcMobile } from "./providers/gopay-fc-mobile.mjs";
import { lookupGoPayFreeFire } from "./providers/gopay-free-fire.mjs";
import { lookupJawakerVerifyUser } from "./providers/jawaker-verify-user.mjs";
import { lookupCodashopDirect } from "./providers/codashop-direct.mjs";

const numericId = /^\d{3,24}$/;
const codmIdentity = /^[\p{L}\p{N} _.'-]{3,24}$/u;
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

/**
 * Keyed primary first, then the keyless GoPay fallback. Not-found and
 * rate-limit verdicts are terminal on either leg; only degraded/unavailable
 * primary outcomes fall through. The public source stays white-labeled.
 */
async function lookupWithGoPayFallback(
  game: RapidApiGame,
  input: RapidApiGameInput,
  gopayCode: string,
) {
  const primary = await lookupRapidApiGame(game, input);
  if (primary.kind === "success" || primary.kind === "not_found" || primary.kind === "rate_limited") {
    return primary;
  }
  const playerId = "playerId" in input ? input.playerId : "";
  const fallback = await lookupGoPayGameFallback(gopayCode, playerId);
  if (fallback.kind === "success" || fallback.kind === "not_found" || fallback.kind === "rate_limited") {
    return fallback;
  }
  return primary;
}

/**
 * Free Fire direct leg: keyless GoPay FREEFIRE only, no keyed leg in front
 * (self-reliant: zero third-party runtime). Live-verified 2026-10-13 and
 * re-verified 2026-10-17 (docs sample 1958604115 resolves; bogus IDs give
 * the explicit Unknown User 404 that gates not-found).
 */
async function lookupFreeFireDirect(input: RapidApiGameInput) {
  const playerId = "playerId" in input ? input.playerId : "";
  return lookupGoPayFreeFire(playerId);
}

/**
 * PUBG Mobile direct leg: keyless GoPay PUBGM only, no keyed leg in front
 * (self-reliant: zero third-party runtime). Live-verified 2026-10-17
 * (Global sample 5204837417 resolves to "Agus๛haji"; bogus IDs give the
 * explicit Invalid user account 404 that gates not-found). Never use the
 * PUBG_MOBILE code (echoes the ID); the echo guard catches it anyway.
 */
async function lookupPubgMobileDirect(input: RapidApiGameInput) {
  const playerId = "playerId" in input ? input.playerId : "";
  return lookupGoPayGameFallback("PUBGM", playerId);
}

/**
 * CODM split leg: numeric IDs stay on the keyed provider; nicknames and
 * shortIds go direct to the Coda white-label voucher (self-reliant: zero
 * third-party runtime). The WL endpoint rejects long numeric UIDs with
 * "UID invalid", so sniffing on all-digits keeps both modes honest.
 * Live-verified 2026-10-17 (ShadowHex → BG redirect → profile; bogus
 * nicknames give the explicit No-openId 404 that gates not-found).
 */
async function lookupCodmSplit(input: RapidApiGameInput) {
  const playerId = "playerId" in input ? input.playerId : "";
  if (/^\d+$/.test(playerId)) {
    return lookupRapidApiGame("cod-mobile-garena", input);
  }
  return lookupCodashopDirect("call-of-duty-mobile", playerId, "");
}

/**
 * Jawaker chain: keyed primary first, then the official webshop verify_user
 * fallback (live-verified 2026-10-13: docs sample resolves to login+level,
 * bogus numbers give explicit HTTP 404). Same terminal-verdict discipline.
 */
async function lookupJawakerWithFallback(
  input: RapidApiGameInput,
) {
  const primary = await lookupRapidApiGame("jawaker", input);
  if (primary.kind === "success" || primary.kind === "not_found" || primary.kind === "rate_limited") {
    return primary;
  }
  const playerId = "playerId" in input ? input.playerId : "";
  const fallback = await lookupJawakerVerifyUser(playerId);
  if (fallback.kind === "success" || fallback.kind === "not_found" || fallback.kind === "rate_limited") {
    return fallback;
  }
  return primary;
}

const configs: Record<string, { providerGame?: RapidApiGame; config: Omit<IdGameLookupConfig, "lookup"> }> = {
  "pubg-mobile": {
    providerGame: "pubg-mobile",
    config: {
      endpoint: "/api/lookup/pubg-mobile",
      gameLabel: "PUBG Mobile Global",
      publicSource: "eidren_pubg_mobile",
      notFoundCode: "PUBG_PLAYER_NOT_FOUND",
      internalProvider: "eidren_pubg_mobile_direct",
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
      internalProvider: "eidren_codm_split",
      fields: [{ key: "playerId", label: "Player ID or nickname", example: "ShadowHex", minLength: 3, maxLength: 24, pattern: codmIdentity }],
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
  "honkai-star-rail": {
    config: {
      endpoint: "/api/lookup/honkai-star-rail",
      gameLabel: "Honkai: Star Rail",
      publicSource: "eidren_honkai_star_rail",
      notFoundCode: "HONKAI_STAR_RAIL_PLAYER_NOT_FOUND",
      internalProvider: "eidren_honkai_star_rail_chain",
      fields: [{ key: "playerId", label: "UID", example: "800333000", minLength: 3, maxLength: 24, pattern: numericId }],
    },
  },
  "zenless-zone-zero": {
    config: {
      endpoint: "/api/lookup/zenless-zone-zero",
      gameLabel: "Zenless Zone Zero",
      publicSource: "eidren_zenless_zone_zero",
      notFoundCode: "ZENLESS_ZONE_ZERO_PLAYER_NOT_FOUND",
      internalProvider: "eidren_zenless_zone_zero_chain",
      fields: [{ key: "playerId", label: "UID", example: "1317572318", minLength: 3, maxLength: 24, pattern: numericId }],
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
  // Lane A expansion: Arena of Valor ships with a live-verified keyless GoPay
  // (AOV) fallback; PUBG Lite ships with partial PUBG_ID fallback coverage
  // (Lite-pool IDs degrade honestly when neither leg carries them).
  "arena-of-valor": {
    providerGame: "arena-of-valor",
    config: {
      endpoint: "/api/lookup/arena-of-valor",
      gameLabel: "Arena of Valor",
      publicSource: "eidren_arena_of_valor",
      notFoundCode: "ARENA_OF_VALOR_PLAYER_NOT_FOUND",
      internalProvider: "eidren_arena_of_valor_chain",
      fields: [{ key: "playerId", label: "Player ID", example: "195293573153949", minLength: 3, maxLength: 24, pattern: numericId }],
    },
  },
  "pubg-lite": {
    providerGame: "pubg-lite",
    config: {
      endpoint: "/api/lookup/pubg-lite",
      gameLabel: "PUBG Mobile Lite",
      publicSource: "eidren_pubg_lite",
      notFoundCode: "PUBG_LITE_PLAYER_NOT_FOUND",
      internalProvider: "eidren_pubg_lite_chain",
      fields: [{ key: "playerId", label: "Character ID", example: "7228395004", minLength: 3, maxLength: 24, pattern: numericId }],
    },
  },
  // Card vertical (primary-only: no keyless fallback found; honest degraded
  // when the keyed feed misses). Samples are the provider's documented
  // examples: TPG 100439992784, Jawaker 1473084005.
  "teen-patti-gold": {
    providerGame: "teen-patti-gold",
    config: {
      endpoint: "/api/lookup/teen-patti-gold",
      gameLabel: "Teen Patti Gold",
      publicSource: "eidren_teen_patti_gold",
      notFoundCode: "TEEN_PATTI_GOLD_PLAYER_NOT_FOUND",
      internalProvider: "rapidapi_id_game_checker_teen_patti_gold",
      fields: [{ key: "playerId", label: "Player ID", example: "100439992784", minLength: 3, maxLength: 24, pattern: numericId }],
    },
  },
  jawaker: {
    providerGame: "jawaker",
    config: {
      endpoint: "/api/lookup/jawaker",
      gameLabel: "Jawaker",
      publicSource: "eidren_jawaker",
      notFoundCode: "JAWAKER_PLAYER_NOT_FOUND",
      internalProvider: "eidren_jawaker_chain",
      fields: [{ key: "playerId", label: "Player ID", example: "1473084005", minLength: 3, maxLength: 24, pattern: numericId }],
    },
  },
  // FC Mobile: no RapidAPI slug on the current key, so the keyless GoPay
  // FC_MOBILE leg is the primary. The 19-digit UID sample below is a
  // real-format ID; the playground default stays until a known-good UID is
  // confirmed live via a signed-in sample run.
  "fc-mobile": {
    providerGame: "fc-mobile",
    config: {
      endpoint: "/api/lookup/fc-mobile",
      gameLabel: "FC Mobile",
      publicSource: "eidren_fc_mobile",
      notFoundCode: "FC_MOBILE_PLAYER_NOT_FOUND",
      internalProvider: "eidren_fc_mobile_chain",
      fields: [{ key: "playerId", label: "UID", example: "1856150661662899105", minLength: 3, maxLength: 24, pattern: numericId }],
    },
  },
  // Free Fire direct legs (self-reliant): keyless GoPay FREEFIRE only, no
  // keyed primary. Samples are the documented examples both legs resolve.
  "free-fire": {
    providerGame: "free-fire",
    config: {
      endpoint: "/api/lookup/free-fire",
      gameLabel: "Free Fire",
      publicSource: "eidren_free_fire",
      notFoundCode: "FREE_FIRE_PLAYER_NOT_FOUND",
      internalProvider: "eidren_free_fire_direct",
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
      internalProvider: "eidren_free_fire_global_direct",
      fields: [{ key: "playerId", label: "UID", example: "12341234", minLength: 3, maxLength: 24, pattern: numericId }],
    },
  },
  // Live/social + board verticals. Bigo/Higgs run primary-only (no keyless
  // fallback found; honest degraded). Jawaker runs keyed primary + official
  // webshop verify_user fallback. Samples are the provider's documented
  // examples: Bigo 901234567, Higgs 55666.
  "bigo-live": {
    providerGame: "bigo-live",
    config: {
      endpoint: "/api/lookup/bigo-live",
      gameLabel: "Bigo Live",
      publicSource: "eidren_bigo_live",
      notFoundCode: "BIGO_LIVE_USER_NOT_FOUND",
      internalProvider: "rapidapi_id_game_checker_bigo_live",
      fields: [{ key: "playerId", label: "BIGO ID", example: "901234567", minLength: 3, maxLength: 24, pattern: numericId }],
    },
  },
  "higgs-domino": {
    providerGame: "higgs-domino",
    config: {
      endpoint: "/api/lookup/higgs-domino",
      gameLabel: "Higgs Domino",
      publicSource: "eidren_higgs_domino",
      notFoundCode: "HIGGS_DOMINO_PLAYER_NOT_FOUND",
      internalProvider: "rapidapi_id_game_checker_higgs_domino",
      fields: [{ key: "playerId", label: "Player ID", example: "55666", minLength: 3, maxLength: 24, pattern: numericId }],
    },
  },
};

export function createRapidApiGameHandler(game: keyof typeof configs) {
  const entry = configs[game];
  const config: IdGameLookupConfig = {
    ...entry.config,
    lookup: async (input) => {
      if (game === "honkai-star-rail" || game === "zenless-zone-zero") {
        const enkaGame: EnkaIdentityGame = game === "honkai-star-rail" ? "hsr" : "zzz";
        return lookupEnkaIdentity(enkaGame, (input as { playerId: string }).playerId);
      }
      const providerGame = entry.providerGame;
      if (!providerGame) return { kind: "unavailable", diagnostic: { reason: "missing_route_config" } };
      // Free Fire + PUBG Mobile: direct keyless GoPay legs, no keyed primary
      // (self-reliant: zero third-party runtime). Same FC Mobile precedent.
      if (providerGame === "free-fire" || providerGame === "free-fire-global") {
        return lookupFreeFireDirect(input as RapidApiGameInput);
      }
      if (providerGame === "genshin-impact") {
        return lookupGenshinWithFallback(input as RapidApiGameInput);
      }
      if (providerGame === "arena-of-valor") {
        return lookupWithGoPayFallback("arena-of-valor", input as RapidApiGameInput, "AOV");
      }
      if (providerGame === "pubg-mobile") {
        return lookupPubgMobileDirect(input as RapidApiGameInput);
      }
      if (providerGame === "pubg-lite") {
        return lookupWithGoPayFallback("pubg-lite", input as RapidApiGameInput, "PUBG_ID");
      }
      if (providerGame === "jawaker") {
        return lookupJawakerWithFallback(input as RapidApiGameInput);
      }
      if (providerGame === "fc-mobile") {
        const playerId = "playerId" in input ? (input as { playerId: string }).playerId : "";
        return lookupFcMobile(playerId);
      }
      if (providerGame === "cod-mobile-garena") {
        return lookupCodmSplit(input as RapidApiGameInput);
      }
      return lookupRapidApiGame(providerGame, input as RapidApiGameInput);
    },
  };
  return createIdGameLookupHandler(config);
}
