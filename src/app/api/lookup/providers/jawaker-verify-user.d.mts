import type { RapidApiGameAttempt } from "./rapidapi-games.mjs";

export function classifyJawakerVerifyResponse(
  httpStatus: number,
  payload: unknown,
): RapidApiGameAttempt;

export function lookupJawakerVerifyUser(
  playerId: string,
  options?: { fetchImpl?: typeof fetch },
): Promise<RapidApiGameAttempt>;
