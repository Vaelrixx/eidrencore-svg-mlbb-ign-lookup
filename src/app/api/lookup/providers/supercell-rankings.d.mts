import type {
  ProviderOptions,
  RankingsLookupAttempt,
  SupercellGame,
} from "./supercell-expansion.mjs";

export function normalizeLocationId(value: unknown): string;
export function classifyRankingsResponse(
  httpStatus: number,
  payload: unknown,
  source: string,
  game: SupercellGame,
): RankingsLookupAttempt;
export function lookupSupercellRankings(
  game: SupercellGame,
  locationId: string,
  options?: ProviderOptions,
): Promise<RankingsLookupAttempt>;
