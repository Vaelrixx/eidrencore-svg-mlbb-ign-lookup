/**
 * Bulk verification game registry.
 *
 * Each entry mirrors its single-lookup route's validation contract and
 * provider chain exactly (same patterns, same lookup functions, same
 * public source labels), so bulk results match single results item for
 * item. Single routes stay the canonical contract; this registry only
 * reuses their provider legs for batch calls.
 */
import { normalizeSupercellTag } from "./providers/supercell.mjs";
import { lookupBrawlStars } from "./providers/brawl-stars.mjs";
import { lookupClashOfClans } from "./providers/clash-of-clans.mjs";
import { lookupClashRoyale } from "./providers/clash-royale.mjs";
import { lookupRapidApiGame } from "./providers/rapidapi-games.mjs";
import { lookupEnkaGenshin } from "./providers/enka-genshin.mjs";
import { lookupEnkaIdentity } from "./providers/enka-identity.mjs";
import { lookupGoPayGameFallback } from "./providers/gopay-game-fallback.mjs";
import { lookupFcMobile } from "./providers/gopay-fc-mobile.mjs";
import { lookupGoPayFreeFire } from "./providers/gopay-free-fire.mjs";
import { lookupJawakerVerifyUser } from "./providers/jawaker-verify-user.mjs";
import { lookupCodashopDirect } from "./providers/codashop-direct.mjs";
import { lookupCodashopInitpay } from "./providers/codashop-initpay.mjs";
import { lookupRapidApi } from "./providers/rapidapi.mjs";
import { lookupIsan } from "./providers/isan.mjs";
import { lookupWhoPlays } from "./providers/whoplays.mjs";
import { lookupGoPayGames } from "./providers/gopay-games.mjs";
import { resolveLookupWithFallbacks, selectLookupVerdict } from "./resolve-lookup.mjs";
import { CODM_IDENTITY_PATTERN, classifyCodmInput } from "./providers/codm-input.mjs";

const numericId = /^\d{3,24}$/;
const riotName = /^[\p{L}\p{N} _.'-]{3,16}$/u;
const riotTag = /^[A-Za-z0-9]{3,5}$/;
const genshinServer = /^(asia|america|europa|china)$/;
const providerServer = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,31}$/;
const mlbbPlayerId = /^\d{4,20}$/;
const mlbbZoneId = /^\d{1,10}$/;
const supercellTag = /^#?[0289PYLQGRJCUV]{3,20}$/i;
const uniteTrainerId = /^[A-Za-z0-9]{5,12}$/;
const pointBlankId = /^[A-Za-z0-9][A-Za-z0-9_.@-]{2,31}$/;

function stringField(value, minLength, maxLength, pattern) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length < minLength || trimmed.length > maxLength || !pattern.test(trimmed)) return null;
  return trimmed;
}

function numericField(value) {
  return stringField(value, 3, 24, numericId);
}

function validateFields(item, fields) {
  const input = {};
  for (const field of fields) {
    const value = field.validate(item[field.key]);
    if (value === null) return null;
    input[field.key] = value;
  }
  return input;
}

function terminalOrFallback(primary, fallback) {
  if (primary.kind === "success" || primary.kind === "not_found" || primary.kind === "rate_limited") {
    return primary;
  }
  if (fallback.kind === "success" || fallback.kind === "not_found" || fallback.kind === "rate_limited") {
    return fallback;
  }
  return primary;
}

async function keyedWithGoPayFallback(game, input, gopayCode) {
  const primary = await lookupRapidApiGame(game, input);
  if (primary.kind === "success" || primary.kind === "not_found" || primary.kind === "rate_limited") return primary;
  const playerId = "playerId" in input ? input.playerId : "";
  return terminalOrFallback(primary, await lookupGoPayGameFallback(gopayCode, playerId));
}

// Mirrors the single route: Enka primary, GoPay four-server sweep only
// when Enka is degraded. Unanimous invalid-credentials sweep = not_found.
const ZZZ_GOPAY_SERVERS = ["prod_gf_us", "prod_gf_eu", "prod_gf_jp", "prod_gf_sg"];

async function lookupZzz(input) {
  const primary = await lookupEnkaIdentity("zzz", input.playerId);
  if (primary.kind === "success" || primary.kind === "not_found" || primary.kind === "rate_limited") return primary;
  const sweep = await Promise.all(
    ZZZ_GOPAY_SERVERS.map((zoneId) =>
      lookupGoPayGameFallback("ZENLESS_ZONE_ZERO", input.playerId, { zoneId }).catch(() => ({ kind: "unavailable" })),
    ),
  );
  const hit = sweep.find((attempt) => attempt.kind === "success");
  if (hit) return hit;
  const limited = sweep.find((attempt) => attempt.kind === "rate_limited");
  if (limited) return limited;
  if (sweep.every((attempt) => attempt.kind === "not_found")) return { kind: "not_found" };
  return primary;
}

// Mirrors POST /api/lookup: CodaShop direct primary, then the four
// live-swept fallbacks with the same verdict selection.
async function lookupMlbb(input) {
  const primary = await lookupCodashopDirect("mobile-legends", input.playerId, input.zoneId)
    .then((attempt) => attempt.kind === "success"
      ? { kind: "success", nickname: attempt.nickname, source: "codashop_direct" }
      : attempt)
    .catch(() => ({ kind: "unavailable" }));
  const resolution = await resolveLookupWithFallbacks(
    () => Promise.resolve(primary),
    [
      () => lookupRapidApi(input.playerId, input.zoneId).catch(() => ({ kind: "unavailable" })),
      () => lookupIsan(input.playerId, input.zoneId).catch(() => ({ kind: "unavailable" })),
      () => lookupWhoPlays(input.playerId, input.zoneId).catch(() => ({ kind: "unavailable" })),
      () => lookupGoPayGames(input.playerId, input.zoneId).catch(() => ({ kind: "unavailable" })),
    ],
  );
  const verdict = selectLookupVerdict(resolution.primary, resolution.fallbacks, resolution.confirmed);
  if (verdict === "success" && resolution.confirmed?.kind === "success") return resolution.confirmed;
  if (verdict === "not_found") return { kind: "not_found" };
  if (verdict === "rate_limited") return { kind: "rate_limited" };
  return { kind: "unavailable" };
}

const identityGame = (config) => ({
  kind: "identity",
  ...config,
});

const supercellGame = (lookup, label, notFoundCode) => ({
  kind: "tag",
  gameLabel: label,
  publicSource: `eidren_${label.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
  notFoundCode,
  fields: [{ key: "tag", label: "Player tag", example: "#2PP" }],
  validate: (item) => {
    const tag = normalizeSupercellTag(typeof item?.tag === "string" ? item.tag : "");
    return tag ? { tag } : null;
  },
  lookup: async (input) => lookup(input.tag),
});

export const BULK_MAX_ITEMS = 100;
export const BULK_MAX_BYTES = 131072;
export const BULK_CONCURRENCY = 10;

export const BULK_GAMES = {
  mlbb: {
    kind: "identity",
    gameLabel: "Mobile Legends: Bang Bang",
    publicSource: "eidren_mlbb",
    notFoundCode: "PLAYER_NOT_FOUND",
    fields: [
      { key: "playerId", label: "Player ID", example: "1114917746" },
      { key: "zoneId", label: "Zone ID", example: "13486" },
    ],
    validate: (item) => {
      const playerId = stringField(item?.playerId, 4, 20, mlbbPlayerId);
      const zoneId = stringField(item?.zoneId, 1, 10, mlbbZoneId);
      return playerId && zoneId ? { playerId, zoneId } : null;
    },
    lookup: lookupMlbb,
  },
  "pubg-mobile": identityGame({
    gameLabel: "PUBG Mobile Global",
    publicSource: "eidren_pubg_mobile",
    notFoundCode: "PUBG_PLAYER_NOT_FOUND",
    fields: [{ key: "playerId", label: "Character ID", example: "5204837417" }],
    validate: (item) => validateFields(item, [{ key: "playerId", validate: numericField }]),
    lookup: async (input) => lookupGoPayGameFallback("PUBGM", input.playerId),
  }),
  "call-of-duty-mobile": identityGame({
    gameLabel: "Call of Duty: Mobile (Garena)",
    publicSource: "eidren_call_of_duty_mobile",
    notFoundCode: "CODM_PLAYER_NOT_FOUND",
    fields: [{ key: "playerId", label: "Player ID or nickname", example: "ShadowHex" }],
    validate: (item) => validateFields(item, [{
      key: "playerId",
      validate: (value) => stringField(value, 3, 24, CODM_IDENTITY_PATTERN),
    }]),
    lookup: async (input) => (classifyCodmInput(input.playerId) !== "direct"
      ? lookupRapidApiGame("cod-mobile-garena", input)
      : lookupCodashopDirect("call-of-duty-mobile", input.playerId, "")),
  }),
  valorant: identityGame({
    gameLabel: "VALORANT",
    publicSource: "eidren_valorant",
    notFoundCode: "VALORANT_PLAYER_NOT_FOUND",
    fields: [
      { key: "name", label: "Riot ID name", example: "ucup" },
      { key: "tag", label: "Riot ID tag", example: "123" },
    ],
    validate: (item) => validateFields(item, [
      { key: "name", validate: (value) => stringField(value, 3, 16, riotName) },
      { key: "tag", validate: (value) => stringField(value, 3, 5, riotTag) },
    ]),
    lookup: async (input) => lookupRapidApiGame("valorant", input),
  }),
  "genshin-impact": identityGame({
    gameLabel: "Genshin Impact",
    publicSource: "eidren_genshin_impact",
    notFoundCode: "GENSHIN_PLAYER_NOT_FOUND",
    fields: [
      { key: "playerId", label: "UID", example: "844335555" },
      { key: "server", label: "Server", example: "asia" },
    ],
    validate: (item) => validateFields(item, [
      { key: "playerId", validate: numericField },
      { key: "server", validate: (value) => stringField(value, 4, 7, genshinServer) },
    ]),
    lookup: async (input) => {
      const primary = await lookupRapidApiGame("genshin-impact", input);
      if (primary.kind === "success" || primary.kind === "not_found" || primary.kind === "rate_limited") return primary;
      return terminalOrFallback(primary, await lookupEnkaGenshin(input.playerId));
    },
  }),
  "honkai-star-rail": identityGame({
    gameLabel: "Honkai: Star Rail",
    publicSource: "eidren_honkai_star_rail",
    notFoundCode: "HONKAI_STAR_RAIL_PLAYER_NOT_FOUND",
    fields: [{ key: "playerId", label: "UID", example: "800333000" }],
    validate: (item) => validateFields(item, [{ key: "playerId", validate: numericField }]),
    lookup: async (input) => lookupEnkaIdentity("hsr", input.playerId),
  }),
  "zenless-zone-zero": identityGame({
    gameLabel: "Zenless Zone Zero",
    publicSource: "eidren_zenless_zone_zero",
    notFoundCode: "ZENLESS_ZONE_ZERO_PLAYER_NOT_FOUND",
    fields: [{ key: "playerId", label: "UID", example: "1317572318" }],
    validate: (item) => validateFields(item, [{ key: "playerId", validate: numericField }]),
    lookup: lookupZzz,
  }),
  "honor-of-kings": identityGame({
    gameLabel: "Honor of Kings",
    publicSource: "eidren_honor_of_kings",
    notFoundCode: "HONOR_OF_KINGS_PLAYER_NOT_FOUND",
    fields: [{ key: "playerId", label: "Player ID", example: "17960996468644334037" }],
    validate: (item) => validateFields(item, [{ key: "playerId", validate: numericField }]),
    lookup: async (input) => lookupRapidApiGame("honor-of-kings", input),
  }),
  "arena-of-valor": identityGame({
    gameLabel: "Arena of Valor",
    publicSource: "eidren_arena_of_valor",
    notFoundCode: "ARENA_OF_VALOR_PLAYER_NOT_FOUND",
    fields: [{ key: "playerId", label: "Player ID", example: "195293573153949" }],
    validate: (item) => validateFields(item, [{ key: "playerId", validate: numericField }]),
    lookup: async (input) => keyedWithGoPayFallback("arena-of-valor", input, "AOV"),
  }),
  "pubg-lite": identityGame({
    gameLabel: "PUBG Mobile Lite",
    publicSource: "eidren_pubg_lite",
    notFoundCode: "PUBG_LITE_PLAYER_NOT_FOUND",
    fields: [{ key: "playerId", label: "Character ID", example: "7228395004" }],
    validate: (item) => validateFields(item, [{ key: "playerId", validate: numericField }]),
    lookup: async (input) => keyedWithGoPayFallback("pubg-lite", input, "PUBG_ID"),
  }),
  "teen-patti-gold": identityGame({
    gameLabel: "Teen Patti Gold",
    publicSource: "eidren_teen_patti_gold",
    notFoundCode: "TEEN_PATTI_GOLD_PLAYER_NOT_FOUND",
    fields: [{ key: "playerId", label: "Player ID", example: "100439992784" }],
    validate: (item) => validateFields(item, [{ key: "playerId", validate: numericField }]),
    lookup: async (input) => lookupRapidApiGame("teen-patti-gold", input),
  }),
  jawaker: identityGame({
    gameLabel: "Jawaker",
    publicSource: "eidren_jawaker",
    notFoundCode: "JAWAKER_PLAYER_NOT_FOUND",
    fields: [{ key: "playerId", label: "Player ID", example: "1473084005" }],
    validate: (item) => validateFields(item, [{ key: "playerId", validate: numericField }]),
    lookup: async (input) => {
      const primary = await lookupRapidApiGame("jawaker", input);
      if (primary.kind === "success" || primary.kind === "not_found" || primary.kind === "rate_limited") return primary;
      return terminalOrFallback(primary, await lookupJawakerVerifyUser(input.playerId));
    },
  }),
  "fc-mobile": identityGame({
    gameLabel: "FC Mobile",
    publicSource: "eidren_fc_mobile",
    notFoundCode: "FC_MOBILE_PLAYER_NOT_FOUND",
    fields: [{ key: "playerId", label: "UID", example: "1856150661662899105" }],
    validate: (item) => validateFields(item, [{ key: "playerId", validate: numericField }]),
    lookup: async (input) => lookupFcMobile(input.playerId),
  }),
  "free-fire": identityGame({
    gameLabel: "Free Fire",
    publicSource: "eidren_free_fire",
    notFoundCode: "FREE_FIRE_PLAYER_NOT_FOUND",
    fields: [{ key: "playerId", label: "UID", example: "1958604115" }],
    validate: (item) => validateFields(item, [{ key: "playerId", validate: numericField }]),
    lookup: async (input) => lookupGoPayFreeFire(input.playerId),
  }),
  "free-fire-global": identityGame({
    gameLabel: "Free Fire Global",
    publicSource: "eidren_free_fire_global",
    notFoundCode: "FREE_FIRE_GLOBAL_PLAYER_NOT_FOUND",
    fields: [{ key: "playerId", label: "UID", example: "12341234" }],
    validate: (item) => validateFields(item, [{ key: "playerId", validate: numericField }]),
    lookup: async (input) => lookupGoPayFreeFire(input.playerId),
  }),
  "bigo-live": identityGame({
    gameLabel: "Bigo Live",
    publicSource: "eidren_bigo_live",
    notFoundCode: "BIGO_LIVE_USER_NOT_FOUND",
    fields: [{ key: "playerId", label: "BIGO ID", example: "901234567" }],
    validate: (item) => validateFields(item, [{ key: "playerId", validate: numericField }]),
    lookup: async (input) => lookupRapidApiGame("bigo-live", input),
  }),
  "higgs-domino": identityGame({
    gameLabel: "Higgs Domino",
    publicSource: "eidren_higgs_domino",
    notFoundCode: "HIGGS_DOMINO_PLAYER_NOT_FOUND",
    fields: [{ key: "playerId", label: "Player ID", example: "55666" }],
    validate: (item) => validateFields(item, [{ key: "playerId", validate: numericField }]),
    lookup: async (input) => lookupRapidApiGame("higgs-domino", input),
  }),
  "brawl-stars": supercellGame(lookupBrawlStars, "Brawl Stars", "BS_PLAYER_NOT_FOUND"),
  "clash-of-clans": supercellGame(lookupClashOfClans, "Clash of Clans", "COC_PLAYER_NOT_FOUND"),
  "clash-royale": supercellGame(lookupClashRoyale, "Clash Royale", "CR_PLAYER_NOT_FOUND"),
  "8-ball-pool": identityGame({
    gameLabel: "8 Ball Pool",
    publicSource: "eidren_8_ball_pool",
    notFoundCode: "EIGHT_BALL_POOL_PLAYER_NOT_FOUND",
    fields: [{ key: "playerId", label: "Player ID", example: "12345" }],
    validate: (item) => validateFields(item, [{ key: "playerId", validate: numericField }]),
    lookup: async (input) => lookupCodashopInitpay("8-ball-pool", input.playerId),
  }),
  "arena-breakout": identityGame({
    gameLabel: "Arena Breakout",
    publicSource: "eidren_arena_breakout",
    notFoundCode: "ARENA_BREAKOUT_PLAYER_NOT_FOUND",
    fields: [{ key: "playerId", label: "Player ID", example: "123456789" }],
    validate: (item) => validateFields(item, [{ key: "playerId", validate: numericField }]),
    lookup: async (input) => lookupRapidApiGame("arena-breakout", input),
  }),
  "blood-strike": identityGame({
    gameLabel: "Blood Strike",
    publicSource: "eidren_blood_strike",
    notFoundCode: "BLOOD_STRIKE_PLAYER_NOT_FOUND",
    fields: [{ key: "playerId", label: "Player ID", example: "123456789" }],
    validate: (item) => validateFields(item, [{ key: "playerId", validate: numericField }]),
    lookup: async (input) => lookupRapidApiGame("blood-strike", input),
  }),
  "delta-force-garena": identityGame({
    gameLabel: "Delta Force (Garena)",
    publicSource: "eidren_delta_force_garena",
    notFoundCode: "DELTA_FORCE_GARENA_PLAYER_NOT_FOUND",
    fields: [{ key: "playerId", label: "Player ID", example: "123456789" }],
    validate: (item) => validateFields(item, [{ key: "playerId", validate: numericField }]),
    lookup: async (input) => lookupRapidApiGame("delta-force-garena", input),
  }),
  "eggy-party": identityGame({
    gameLabel: "Eggy Party",
    publicSource: "eidren_eggy_party",
    notFoundCode: "EGGY_PARTY_PLAYER_NOT_FOUND",
    fields: [
      { key: "playerId", label: "Player ID", example: "123456789" },
      { key: "server", label: "Server", example: "asia" },
    ],
    validate: (item) => validateFields(item, [
      { key: "playerId", validate: numericField },
      { key: "server", validate: (value) => stringField(value, 1, 32, providerServer) },
    ]),
    lookup: async (input) => lookupRapidApiGame("eggy-party", input),
  }),
  "ace-racer": identityGame({
    gameLabel: "Ace Racer",
    publicSource: "eidren_ace_racer",
    notFoundCode: "ACE_RACER_PLAYER_NOT_FOUND",
    fields: [
      { key: "playerId", label: "Player ID", example: "123456789" },
      { key: "server", label: "Server", example: "asia" },
    ],
    validate: (item) => validateFields(item, [
      { key: "playerId", validate: numericField },
      { key: "server", validate: (value) => stringField(value, 1, 32, providerServer) },
    ]),
    lookup: async (input) => lookupRapidApiGame("ace-racer", input),
  }),
  "dragon-raja": identityGame({
    gameLabel: "Dragon Raja",
    publicSource: "eidren_dragon_raja",
    notFoundCode: "DRAGON_RAJA_PLAYER_NOT_FOUND",
    fields: [{ key: "playerId", label: "Player ID", example: "123456789" }],
    validate: (item) => validateFields(item, [{ key: "playerId", validate: numericField }]),
    lookup: async (input) => lookupRapidApiGame("dragon-raja", input),
  }),
  "metal-slug": identityGame({
    gameLabel: "Metal Slug",
    publicSource: "eidren_metal_slug",
    notFoundCode: "METAL_SLUG_PLAYER_NOT_FOUND",
    fields: [{ key: "playerId", label: "Player ID", example: "123456789" }],
    validate: (item) => validateFields(item, [{ key: "playerId", validate: numericField }]),
    lookup: async (input) => lookupRapidApiGame("metal-slug", input),
  }),
  lifeafter: identityGame({
    gameLabel: "LifeAfter",
    publicSource: "eidren_lifeafter",
    notFoundCode: "LIFEAFTER_PLAYER_NOT_FOUND",
    fields: [
      { key: "playerId", label: "Account ID", example: "11043723" },
      { key: "server", label: "Server", example: "NancyCity" },
    ],
    validate: (item) => validateFields(item, [
      { key: "playerId", validate: numericField },
      { key: "server", validate: (value) => stringField(value, 1, 32, providerServer) },
    ]),
    lookup: async (input) => lookupRapidApiGame("lifeafter", input),
  }),
  "one-punch-man": identityGame({
    gameLabel: "One Punch Man: The Strongest",
    publicSource: "eidren_one_punch_man",
    notFoundCode: "ONE_PUNCH_MAN_PLAYER_NOT_FOUND",
    fields: [
      { key: "playerId", label: "Player ID", example: "123456789" },
      { key: "server", label: "Zone ID", example: "1" },
    ],
    validate: (item) => validateFields(item, [
      { key: "playerId", validate: numericField },
      { key: "server", validate: (value) => stringField(value, 1, 32, providerServer) },
    ]),
    lookup: async (input) => lookupRapidApiGame("one-punch-man", input),
  }),
  "pokemon-unite": identityGame({
    gameLabel: "Pokémon UNITE",
    publicSource: "eidren_pokemon_unite",
    notFoundCode: "POKEMON_UNITE_PLAYER_NOT_FOUND",
    fields: [{ key: "playerId", label: "Trainer ID", example: "LYK85AP" }],
    validate: (item) => validateFields(item, [{ key: "playerId", validate: (value) => stringField(value, 5, 12, uniteTrainerId) }]),
    lookup: async (input) => lookupRapidApiGame("pokemon-unite", input),
  }),
  "whiteout-survival": identityGame({
    gameLabel: "Whiteout Survival",
    publicSource: "eidren_whiteout_survival",
    notFoundCode: "WHITEOUT_SURVIVAL_PLAYER_NOT_FOUND",
    fields: [{ key: "playerId", label: "Player ID", example: "123456789" }],
    validate: (item) => validateFields(item, [{ key: "playerId", validate: numericField }]),
    lookup: async (input) => lookupRapidApiGame("whiteout-survival", input),
  }),
  "hay-day": identityGame({
    gameLabel: "Hay Day",
    publicSource: "eidren_hay_day",
    notFoundCode: "HAY_DAY_PLAYER_NOT_FOUND",
    fields: [{ key: "playerId", label: "Farm tag", example: "PURC098R2" }],
    validate: (item) => validateFields(item, [{ key: "playerId", validate: (value) => stringField(value, 3, 21, supercellTag) }]),
    lookup: async (input) => lookupRapidApiGame("hay-day", input),
  }),
  "magic-chess": identityGame({
    gameLabel: "Magic Chess: Go Go",
    publicSource: "eidren_magic_chess",
    notFoundCode: "MAGIC_CHESS_PLAYER_NOT_FOUND",
    fields: [
      { key: "playerId", label: "User ID", example: "12345678" },
      { key: "server", label: "Zone ID", example: "1234" },
    ],
    validate: (item) => validateFields(item, [
      { key: "playerId", validate: numericField },
      { key: "server", validate: (value) => stringField(value, 1, 32, providerServer) },
    ]),
    lookup: async (input) => lookupRapidApiGame("magic-chess", input),
  }),
  "speed-drifters": identityGame({
    gameLabel: "Speed Drifters",
    publicSource: "eidren_speed_drifters",
    notFoundCode: "SPEED_DRIFTERS_PLAYER_NOT_FOUND",
    fields: [{ key: "playerId", label: "Player ID", example: "123456789" }],
    validate: (item) => validateFields(item, [{ key: "playerId", validate: numericField }]),
    lookup: async (input) => lookupRapidApiGame("speed-drifters", input),
  }),
  "super-sus": identityGame({
    gameLabel: "Super Sus",
    publicSource: "eidren_super_sus",
    notFoundCode: "SUPER_SUS_PLAYER_NOT_FOUND",
    fields: [{ key: "playerId", label: "Space ID", example: "163588582" }],
    validate: (item) => validateFields(item, [{ key: "playerId", validate: numericField }]),
    lookup: async (input) => lookupCodashopInitpay("super-sus", input.playerId),
  }),
  "point-blank": identityGame({
    gameLabel: "Point Blank",
    publicSource: "eidren_point_blank",
    notFoundCode: "POINT_BLANK_PLAYER_NOT_FOUND",
    fields: [{ key: "playerId", label: "Zepetto ID", example: "123456789" }],
    validate: (item) => validateFields(item, [{ key: "playerId", validate: (value) => stringField(value, 3, 32, pointBlankId) }]),
    lookup: async (input) => lookupRapidApiGame("point-blank", input),
  }),
};

export function bulkGameSlugs() {
  return Object.keys(BULK_GAMES);
}
