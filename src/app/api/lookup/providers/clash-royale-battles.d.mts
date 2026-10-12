import type { BattlelogLookupAttempt, ProviderOptions } from "./supercell-expansion.mjs";

export function classifyBattlelogResponse(
  httpStatus: number,
  payload: unknown,
  source: string,
): BattlelogLookupAttempt;
export function lookupClashRoyaleBattlelog(
  tag: string,
  options?: ProviderOptions,
): Promise<BattlelogLookupAttempt>;
