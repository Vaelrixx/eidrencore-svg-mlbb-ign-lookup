import type { ClanLookupAttempt, ProviderOptions } from "./supercell-expansion.mjs";

export function classifyClanResponse(
  httpStatus: number,
  payload: unknown,
  source: string,
): ClanLookupAttempt;
export function lookupClashOfClansClan(
  tag: string,
  options?: ProviderOptions,
): Promise<ClanLookupAttempt>;
