import type { RapidApiGameAttempt } from "./rapidapi-games.mjs";

export type EnkaGenshinOptions = {
  fetchImpl?: typeof fetch;
};

export declare function classifyEnkaGenshinResponse(
  httpStatus: number,
  payload: unknown,
): RapidApiGameAttempt;

export declare function lookupEnkaGenshin(
  playerId: string,
  options?: EnkaGenshinOptions,
): Promise<RapidApiGameAttempt>;
