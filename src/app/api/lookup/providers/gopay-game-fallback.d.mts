import type { RapidApiGameAttempt } from "./rapidapi-games.mjs";

export function classifyGoPayGameFallbackResponse(
  httpStatus: number,
  payload: unknown,
  requestIdentity?: string,
  gameCode?: string,
): RapidApiGameAttempt;

export function lookupGoPayGameFallback(
  gameCode: string,
  playerId: string,
  options?: { fetchImpl?: typeof fetch },
): Promise<RapidApiGameAttempt>;
