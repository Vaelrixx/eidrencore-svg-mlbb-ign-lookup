import type { ProviderOptions, WarlogLookupAttempt } from "./supercell-expansion.mjs";

export function classifyWarlogResponse(
  httpStatus: number,
  payload: unknown,
  source: string,
): WarlogLookupAttempt;
export function lookupClashOfClansWarlog(
  tag: string,
  options?: ProviderOptions,
): Promise<WarlogLookupAttempt>;
