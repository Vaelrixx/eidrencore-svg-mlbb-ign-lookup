import type { RapidApiGameAttempt } from "./rapidapi-games.mjs";

export function classifyFcMobileResponse(
  httpStatus: number,
  payload: unknown,
): RapidApiGameAttempt;

export function lookupFcMobile(
  playerId: string,
  options?: { fetchImpl?: typeof fetch; cache?: { getOrLoad: (key: string, ttlSeconds: number, loader: () => Promise<unknown>) => Promise<{ value: unknown; cached: boolean }> } },
): Promise<RapidApiGameAttempt>;
