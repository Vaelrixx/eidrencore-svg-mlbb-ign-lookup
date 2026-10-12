export type SupercellGame = "brawl-stars" | "clash-of-clans" | "clash-royale";

export type LookupAttempt =
  | { kind: "success"; nickname: string; source: string }
  | { kind: "not_found" }
  | { kind: "rate_limited"; diagnostic?: { reason: string; statusCode?: number } }
  | { kind: "unavailable"; diagnostic?: { reason: string; statusCode?: number } };

export function normalizeSupercellTag(value: unknown): string;
export function classifySupercellResponse(
  httpStatus: number,
  payload: unknown,
  source: string,
): LookupAttempt;
export function lookupSupercellPlayer(
  game: SupercellGame,
  tag: string,
  options?: {
    fetchImpl?: typeof fetch;
    env?: NodeJS.ProcessEnv;
  },
): Promise<LookupAttempt>;
