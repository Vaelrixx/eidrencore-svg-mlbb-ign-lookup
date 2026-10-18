import { createIdGameLookupHandler, type IdGameLookupConfig } from "./id-game-route";
import { lookupRapidApiGame, type RapidApiGame, type RapidApiGameInput } from "./providers/rapidapi-games.mjs";
import { lookupEnkaGenshin } from "./providers/enka-genshin.mjs";
import { lookupEnkaIdentity } from "./providers/enka-identity.mjs";
import { lookupGoPayGameFallback } from "./providers/gopay-game-fallback.mjs";
import { lookupFcMobile } from "./providers/gopay-fc-mobile.mjs";
import { lookupGoPayFreeFire } from "./providers/gopay-free-fire.mjs";
import { lookupJawakerVerifyUser } from "./providers/jawaker-verify-user.mjs";
import { lookupCodashopDirect } from "./providers/codashop-direct.mjs";
import { lookupCodashopInitpay } from "./providers/codashop-initpay.mjs";
import { CODM_IDENTITY_PATTERN, classifyCodmInput } from "./providers/codm-input.mjs";

const numericId = /^\d{3,24}$/;
const riotName = /^[\p{L}\p{N} _.'-]{3,16}$/u;
const riotTag = /^[A-Za-z0-9]{3,5}$/;
const genshinServer = /^(asia|america|europa|china)$/;
const providerServer = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,31}$/;
// Hay Day: Supercell farm tag, same alphabet as the official tag pattern.
const supercellTag = /^#?[0289PYLQGRJCUV]{3,20}$/i;
// Pokémon UNITE: 7-char alphanumeric trainer code (e.g. LYK85AP).
const uniteTrainerId = /^[A-Za-z0-9]{5,12}$/;
// Point Blank: Zepetto account username (top-up sites label it "ID Zepetto").
const pointBlankId = /^[A-Za-z0-9][A-Za-z0-9_.@-]{2,31}$/;

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
 * Arena of Valor: keyed primary, then our own CodaShop initPayment leg,
 * then GoPay. Additive: the broker stays; the direct leg adds balance.
 * Live-verified 2026-10-18 (roles[0].role nickname, 12 = miss).
 */
async function lookupAovWithDirectLegs(
  input: RapidApiGameInput,
) {
  const primary = await lookupRapidApiGame("arena-of-valor", input);
  if (primary.kind === "success" || primary.kind === "not_found" || primary.kind === "rate_limited") {
    return primary;
  }
  const playerId = "playerId" in input ? input.playerId : "";
  const direct = await lookupCodashopInitpay("arena-of-valor", playerId);
  if (direct.kind === "success" || direct.kind === "not_found" || direct.kind === "rate_limited") {
    return direct;
  }
  const fallback = await lookupGoPayGameFallback("AOV", playerId);
  if (fallback.kind === "success" || fallback.kind === "not_found" || fallback.kind === "rate_limited") {
    return fallback;
  }
  return primary;
}

/** Dragon Raja: RapidAPI stays primary; the provisional Coda leg is flag-gated. */
async function lookupDragonRajaWithDirectLeg(input: RapidApiGameInput) {
  const primary = await lookupRapidApiGame("dragon-raja", input);
  if (primary.kind === "success" || primary.kind === "not_found" || primary.kind === "rate_limited") {
    return primary;
  }
  const playerId = "playerId" in input ? input.playerId : "";
  const direct = await lookupCodashopInitpay("dragon-raja", playerId);
  if (direct.kind === "success" || direct.kind === "not_found" || direct.kind === "rate_limited") {
    return direct;
  }
  return primary;
}

/** Point Blank: RapidAPI stays primary; Coda tries tuple B, then tuple A. */
async function lookupPointBlankWithDirectLeg(input: RapidApiGameInput) {
  const primary = await lookupRapidApiGame("point-blank", input);
  if (primary.kind === "success" || primary.kind === "not_found" || primary.kind === "rate_limited") {
    return primary;
  }
  const playerId = "playerId" in input ? input.playerId : "";
  const direct = await lookupCodashopInitpay("point-blank", playerId);
  if (direct.kind === "success" || direct.kind === "not_found" || direct.kind === "rate_limited") {
    return direct;
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
  if (classifyCodmInput(playerId) !== "direct") {
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

/**
 * ZZZ chain: Enka (global, serverless) primary, GoPay server sweep
 * secondary. The route stays UID-only: no server field, no breaking
 * change. GoPay needs a store zone, so the secondary sweeps all four
 * ZZZ servers in parallel — but only when Enka itself is degraded
 * (Enka success/not_found/rate_limited are terminal). First success
 * wins; not_found requires a unanimous invalid-credentials sweep
 * (a UID lives on exactly one server, so one server's miss proves
 * nothing); anything else degrades honestly to the Enka outcome.
 * Live-verified 2026-10-18: 1317572318 resolves on prod_gf_jp,
 * bogus IDs 404 on every zone.
 */
const ZZZ_GOPAY_SERVERS = ["prod_gf_us", "prod_gf_eu", "prod_gf_jp", "prod_gf_sg"] as const;

async function lookupZzzWithFallback(playerId: string) {
  const primary = await lookupEnkaIdentity("zzz", playerId);
  if (primary.kind === "success" || primary.kind === "not_found" || primary.kind === "rate_limited") {
    return primary;
  }
  const sweep = await Promise.all(
    ZZZ_GOPAY_SERVERS.map((zoneId) =>
      lookupGoPayGameFallback("ZENLESS_ZONE_ZERO", playerId, { zoneId }).catch(() => ({ kind: "unavailable" as const })),
    ),
  );
  const hit = sweep.find((attempt) => attempt.kind === "success");
  if (hit) return hit;
  const limited = sweep.find((attempt) => attempt.kind === "rate_limited");
  if (limited) return limited;
  if (sweep.every((attempt) => attempt.kind === "not_found")) return { kind: "not_found" as const };
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
      fields: [{ key: "playerId", label: "Player ID or nickname", example: "ShadowHex", minLength: 3, maxLength: 24, pattern: CODM_IDENTITY_PATTERN }],
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
  // 8 Ball Pool: Coda initPayment direct leg only (self-reliant: zero
  // third-party runtime). Live-verified 2026-10-18: 12345 resolves to a
  // masked store nickname, bogus IDs give the explicit -100 User Not
  // Found that gates not-found. No keyed leg on the current key.
  "8-ball-pool": {
    config: {
      endpoint: "/api/lookup/8-ball-pool",
      gameLabel: "8 Ball Pool",
      publicSource: "eidren_8_ball_pool",
      notFoundCode: "EIGHT_BALL_POOL_PLAYER_NOT_FOUND",
      internalProvider: "eidren_8_ball_pool_direct",
      fields: [{ key: "playerId", label: "Player ID", example: "12345", minLength: 3, maxLength: 24, pattern: numericId }],
    },
  },
  // Super Sus: Coda initPayment direct leg only (self-reliant: zero
  // third-party runtime). Live-verified 2026-10-18: Space ID 163588582
  // resolves to a real nickname, bogus IDs give the explicit -100
  // account-error gate. /validate returns {} for this game.
  "super-sus": {
    config: {
      endpoint: "/api/lookup/super-sus",
      gameLabel: "Super Sus",
      publicSource: "eidren_super_sus",
      notFoundCode: "SUPER_SUS_PLAYER_NOT_FOUND",
      internalProvider: "eidren_super_sus_direct",
      fields: [{ key: "playerId", label: "Space ID", example: "163588582", minLength: 3, maxLength: 24, pattern: numericId }],
    },
  },
  // Wave 1 expansion (primary-only: slugs from the key's published
  // endpoint list, verified live 2026-10-18; honest degraded when the
  // keyed feed misses). Server-suffixed games pass the provider's
  // {server} segment straight through.
  "arena-breakout": {
    providerGame: "arena-breakout",
    config: {
      endpoint: "/api/lookup/arena-breakout",
      gameLabel: "Arena Breakout",
      publicSource: "eidren_arena_breakout",
      notFoundCode: "ARENA_BREAKOUT_PLAYER_NOT_FOUND",
      internalProvider: "rapidapi_id_game_checker_arena_breakout",
      fields: [{ key: "playerId", label: "Player ID", example: "123456789", minLength: 3, maxLength: 24, pattern: numericId }],
    },
  },
  "blood-strike": {
    providerGame: "blood-strike",
    config: {
      endpoint: "/api/lookup/blood-strike",
      gameLabel: "Blood Strike",
      publicSource: "eidren_blood_strike",
      notFoundCode: "BLOOD_STRIKE_PLAYER_NOT_FOUND",
      internalProvider: "rapidapi_id_game_checker_blood_strike",
      fields: [{ key: "playerId", label: "Player ID", example: "123456789", minLength: 3, maxLength: 24, pattern: numericId }],
    },
  },
  // Delta Force pulled 2026-10-18: two player-documented real UIDs plus
  // baseline probes all 502d, never a nickname — the keyed upstream
  // carries no data for this game.
  "delta-force-garena": {
    providerGame: "delta-force-garena",
    config: {
      endpoint: "/api/lookup/delta-force-garena",
      gameLabel: "Delta Force (Garena)",
      publicSource: "eidren_delta_force_garena",
      notFoundCode: "DELTA_FORCE_GARENA_PLAYER_NOT_FOUND",
      internalProvider: "rapidapi_id_game_checker_delta_force_garena",
      fields: [{ key: "playerId", label: "Player ID", example: "123456789", minLength: 3, maxLength: 24, pattern: numericId }],
    },
  },
  "eggy-party": {
    providerGame: "eggy-party",
    config: {
      endpoint: "/api/lookup/eggy-party",
      gameLabel: "Eggy Party",
      publicSource: "eidren_eggy_party",
      notFoundCode: "EGGY_PARTY_PLAYER_NOT_FOUND",
      internalProvider: "rapidapi_id_game_checker_eggy_party",
      fields: [
        { key: "playerId", label: "Player ID", example: "123456789", minLength: 3, maxLength: 24, pattern: numericId },
        { key: "server", label: "Server", example: "asia", minLength: 1, maxLength: 32, pattern: providerServer },
      ],
    },
  },
  "ace-racer": {
    providerGame: "ace-racer",
    config: {
      endpoint: "/api/lookup/ace-racer",
      gameLabel: "Ace Racer",
      publicSource: "eidren_ace_racer",
      notFoundCode: "ACE_RACER_PLAYER_NOT_FOUND",
      internalProvider: "rapidapi_id_game_checker_ace_racer",
      fields: [
        { key: "playerId", label: "Player ID", example: "123456789", minLength: 3, maxLength: 24, pattern: numericId },
        { key: "server", label: "Server", example: "asia", minLength: 1, maxLength: 32, pattern: providerServer },
      ],
    },
  },
  "dragon-raja": {
    providerGame: "dragon-raja",
    config: {
      endpoint: "/api/lookup/dragon-raja",
      gameLabel: "Dragon Raja",
      publicSource: "eidren_dragon_raja",
      notFoundCode: "DRAGON_RAJA_PLAYER_NOT_FOUND",
      internalProvider: "rapidapi_id_game_checker_dragon_raja",
      fields: [{ key: "playerId", label: "Player ID", example: "123456789", minLength: 3, maxLength: 24, pattern: numericId }],
    },
  },
  "metal-slug": {
    providerGame: "metal-slug",
    config: {
      endpoint: "/api/lookup/metal-slug",
      gameLabel: "Metal Slug",
      publicSource: "eidren_metal_slug",
      notFoundCode: "METAL_SLUG_PLAYER_NOT_FOUND",
      internalProvider: "rapidapi_id_game_checker_metal_slug",
      fields: [{ key: "playerId", label: "Player ID", example: "123456789", minLength: 3, maxLength: 24, pattern: numericId }],
    },
  },
  lifeafter: {
    providerGame: "lifeafter",
    config: {
      endpoint: "/api/lookup/lifeafter",
      gameLabel: "LifeAfter",
      publicSource: "eidren_lifeafter",
      notFoundCode: "LIFEAFTER_PLAYER_NOT_FOUND",
      internalProvider: "rapidapi_id_game_checker_lifeafter",
      fields: [
        { key: "playerId", label: "Account ID", example: "11043723", minLength: 3, maxLength: 24, pattern: numericId },
        { key: "server", label: "Server", example: "NancyCity", minLength: 1, maxLength: 32, pattern: providerServer },
      ],
    },
  },
  "one-punch-man": {
    providerGame: "one-punch-man",
    config: {
      endpoint: "/api/lookup/one-punch-man",
      gameLabel: "One Punch Man: The Strongest",
      publicSource: "eidren_one_punch_man",
      notFoundCode: "ONE_PUNCH_MAN_PLAYER_NOT_FOUND",
      internalProvider: "rapidapi_id_game_checker_one_punch_man",
      fields: [
        { key: "playerId", label: "Player ID", example: "123456789", minLength: 3, maxLength: 24, pattern: numericId },
        { key: "server", label: "Zone ID", example: "1", minLength: 1, maxLength: 32, pattern: providerServer },
      ],
    },
  },
  "pokemon-unite": {
    providerGame: "pokemon-unite",
    config: {
      endpoint: "/api/lookup/pokemon-unite",
      gameLabel: "Pokémon UNITE",
      publicSource: "eidren_pokemon_unite",
      notFoundCode: "POKEMON_UNITE_PLAYER_NOT_FOUND",
      internalProvider: "rapidapi_id_game_checker_pokemon_unite",
      fields: [{ key: "playerId", label: "Trainer ID", example: "LYK85AP", minLength: 5, maxLength: 12, pattern: uniteTrainerId }],
    },
  },
  "whiteout-survival": {
    providerGame: "whiteout-survival",
    config: {
      endpoint: "/api/lookup/whiteout-survival",
      gameLabel: "Whiteout Survival",
      publicSource: "eidren_whiteout_survival",
      notFoundCode: "WHITEOUT_SURVIVAL_PLAYER_NOT_FOUND",
      internalProvider: "rapidapi_id_game_checker_whiteout_survival",
      fields: [{ key: "playerId", label: "Player ID", example: "123456789", minLength: 3, maxLength: 24, pattern: numericId }],
    },
  },
  "hay-day": {
    providerGame: "hay-day",
    config: {
      endpoint: "/api/lookup/hay-day",
      gameLabel: "Hay Day",
      publicSource: "eidren_hay_day",
      notFoundCode: "HAY_DAY_PLAYER_NOT_FOUND",
      internalProvider: "rapidapi_id_game_checker_hay_day",
      fields: [{ key: "playerId", label: "Farm tag", example: "PURC098R2", minLength: 3, maxLength: 21, pattern: supercellTag }],
    },
  },
  "magic-chess": {
    providerGame: "magic-chess",
    config: {
      endpoint: "/api/lookup/magic-chess",
      gameLabel: "Magic Chess: Go Go",
      publicSource: "eidren_magic_chess",
      notFoundCode: "MAGIC_CHESS_PLAYER_NOT_FOUND",
      internalProvider: "rapidapi_id_game_checker_magic_chess",
      fields: [
        { key: "playerId", label: "User ID", example: "12345678", minLength: 3, maxLength: 24, pattern: numericId },
        { key: "server", label: "Zone ID", example: "1234", minLength: 1, maxLength: 32, pattern: providerServer },
      ],
    },
  },
  "speed-drifters": {
    providerGame: "speed-drifters",
    config: {
      endpoint: "/api/lookup/speed-drifters",
      gameLabel: "Speed Drifters",
      publicSource: "eidren_speed_drifters",
      notFoundCode: "SPEED_DRIFTERS_PLAYER_NOT_FOUND",
      internalProvider: "rapidapi_id_game_checker_speed_drifters",
      fields: [{ key: "playerId", label: "Player ID", example: "123456789", minLength: 3, maxLength: 24, pattern: numericId }],
    },
  },
  // Undawn pulled 2026-10-18: even a documented real UID 502d across
  // 8 probes, never a nickname — the keyed upstream carries no data.
  // Point Blank: keyed primary-only. No keyless leg: Coda initPayment
  // echoes short IDs (verified live 2026-10-18), GoPay has no PB code.
  // Top-up sites ask for the Zepetto account username, so the route
  // accepts account strings as well as numeric IDs.
  "point-blank": {
    providerGame: "point-blank",
    config: {
      endpoint: "/api/lookup/point-blank",
      gameLabel: "Point Blank",
      publicSource: "eidren_point_blank",
      notFoundCode: "POINT_BLANK_PLAYER_NOT_FOUND",
      internalProvider: "rapidapi_id_game_checker_point_blank",
      fields: [{ key: "playerId", label: "Zepetto ID", example: "123456789", minLength: 3, maxLength: 32, pattern: pointBlankId }],
    },
  },
};

export function createRapidApiGameHandler(game: keyof typeof configs) {
  const entry = configs[game];
  const config: IdGameLookupConfig = {
    ...entry.config,
    lookup: async (input) => {
      if (game === "honkai-star-rail") {
        return lookupEnkaIdentity("hsr", (input as { playerId: string }).playerId);
      }
      if (game === "zenless-zone-zero") {
        return lookupZzzWithFallback((input as { playerId: string }).playerId);
      }
      if (game === "8-ball-pool") {
        const playerId = "playerId" in input ? (input as { playerId: string }).playerId : "";
        return lookupCodashopInitpay("8-ball-pool", playerId);
      }
      if (game === "super-sus") {
        const playerId = "playerId" in input ? (input as { playerId: string }).playerId : "";
        return lookupCodashopInitpay("super-sus", playerId);
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
        return lookupAovWithDirectLegs(input as RapidApiGameInput);
      }
      if (providerGame === "pubg-mobile") {
        return lookupPubgMobileDirect(input as RapidApiGameInput);
      }
      if (providerGame === "dragon-raja") {
        return lookupDragonRajaWithDirectLeg(input as RapidApiGameInput);
      }
      if (providerGame === "point-blank") {
        return lookupPointBlankWithDirectLeg(input as RapidApiGameInput);
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
