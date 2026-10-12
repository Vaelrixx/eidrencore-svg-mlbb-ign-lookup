import type { ClubLookupAttempt, ProviderOptions } from "./supercell-expansion.mjs";

export function classifyClubResponse(
  httpStatus: number,
  payload: unknown,
  source: string,
): ClubLookupAttempt;
export function lookupBrawlStarsClub(
  tag: string,
  options?: ProviderOptions,
): Promise<ClubLookupAttempt>;
