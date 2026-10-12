export type SupercellGame = "brawl-stars" | "clash-of-clans" | "clash-royale";

export type LookupAttempt =
  | { kind: "success"; nickname: string; source: string }
  | { kind: "not_found" }
  | { kind: "rate_limited"; diagnostic?: { reason: string; statusCode?: number } }
  | { kind: "unavailable"; diagnostic?: { reason: string; statusCode?: number } };

export function normalizeSupercellTag(value: unknown): string;
export const ROYALEAPI_PROXY_IP: string;
export type SupercellGameConfig = {
  key: string;
  base: string;
  source: string;
};
export function supercellConfigFor(
  game: SupercellGame,
  env?: NodeJS.ProcessEnv,
): SupercellGameConfig | null;
export type SupercellFetchResult =
  | { ok: true; status: number; payload: unknown; source: string }
  | { ok: false; attempt: LookupAttempt };
export function fetchSupercellPath(
  game: SupercellGame,
  path: string,
  options?: {
    fetchImpl?: typeof fetch;
    env?: NodeJS.ProcessEnv;
  },
): Promise<SupercellFetchResult>;
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
