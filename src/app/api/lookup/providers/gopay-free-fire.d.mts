import type { RapidApiGameAttempt } from "./rapidapi-games.mjs";

export function classifyFreeFireResponse(
  httpStatus: number,
  payload: unknown,
): RapidApiGameAttempt;

export function lookupGoPayFreeFire(
  playerId: string,
  options?: { fetchImpl?: typeof fetch; cache?: { getOrLoad: (key: string, ttlSeconds: number, loader: () => Promise<unknown>) => Promise<{ value: unknown; cached: boolean }> } },
): Promise<RapidApiGameAttempt>;
