export type GenshinServer = "asia" | "america" | "europa" | "china";

export type RapidApiGame =
  | "pubg-mobile"
  | "cod-mobile-garena"
  | "valorant"
  | "genshin-impact"
  | "honor-of-kings";

export type RapidApiGameInput =
  | { playerId: string }
  | { playerId: string; server: GenshinServer }
  | { name: string; tag: string };

export type RapidApiGameAttempt =
  | { kind: "success"; nickname: string; source: string }
  | { kind: "not_found" }
  | { kind: "rate_limited"; diagnostic?: { reason: string; statusCode?: number } }
  | { kind: "unavailable"; diagnostic?: { reason: string; statusCode?: number; responseKind?: string; responseShape?: string } };

export const RAPIDAPI_GAME_ROUTES: Readonly<Record<RapidApiGame, { slug: string; fields: readonly string[] }>>;
export function rapidApiGamePath(game: RapidApiGame, input: RapidApiGameInput): string | null;
export function lookupRapidApiGame(
  game: RapidApiGame,
  input: RapidApiGameInput,
  options?: { apiKey?: string; fetchImpl?: typeof fetch },
): Promise<RapidApiGameAttempt>;
