export type GenshinServer = "asia" | "america" | "europa" | "china";

export type RapidApiGame =
  | "pubg-mobile"
  | "cod-mobile-garena"
  | "valorant"
  | "genshin-impact"
  | "honor-of-kings"
  | "arena-of-valor"
  | "pubg-lite"
  | "teen-patti-gold"
  | "jawaker"
  | "fc-mobile"
  | "bigo-live"
  | "higgs-domino"
  | "free-fire"
  | "free-fire-global"
  | "arena-breakout"
  | "blood-strike"
  | "delta-force-garena"
  | "eggy-party"
  | "ace-racer"
  | "dragon-raja"
  | "metal-slug"
  | "lifeafter"
  | "one-punch-man"
  | "pokemon-unite"
  | "whiteout-survival"
  | "hay-day"
  | "magic-chess"
  | "speed-drifters"
  | "point-blank";

export type RapidApiGameInput =
  | { playerId: string }
  | { playerId: string; server: GenshinServer }
  | { playerId: string; server: string }
  | { name: string; tag: string };

export type RapidApiGameAttempt =
  | { kind: "success"; nickname: string; source: string }
  | { kind: "not_found" }
  | { kind: "rate_limited"; diagnostic?: { reason: string; statusCode?: number; providerStatusCode?: number } }
  | { kind: "unavailable"; diagnostic?: { reason: string; statusCode?: number; providerStatusCode?: number; responseKind?: string; responseShape?: string; messageCode?: string } };

export const RAPIDAPI_GAME_ROUTES: Readonly<Record<RapidApiGame, { slug: string; fields: readonly string[] }>>;
export function rapidApiGamePath(game: RapidApiGame, input: RapidApiGameInput): string | null;
export function lookupRapidApiGame(
  game: RapidApiGame,
  input: RapidApiGameInput,
  options?: { apiKey?: string; fetchImpl?: typeof fetch; sleepImpl?: (ms: number) => Promise<void> },
): Promise<RapidApiGameAttempt>;
