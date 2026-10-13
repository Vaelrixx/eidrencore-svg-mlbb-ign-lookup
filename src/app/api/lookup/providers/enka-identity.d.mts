import type { RapidApiGameAttempt } from "./rapidapi-games.mjs";

export type EnkaIdentityGame = "hsr" | "zzz";
export type EnkaIdentityOptions = { fetchImpl?: typeof fetch };

export declare function classifyEnkaIdentityResponse(
  game: EnkaIdentityGame,
  httpStatus: number,
  payload: unknown,
): RapidApiGameAttempt;

export declare function lookupEnkaIdentity(
  game: EnkaIdentityGame,
  playerId: string,
  options?: EnkaIdentityOptions,
): Promise<RapidApiGameAttempt>;
