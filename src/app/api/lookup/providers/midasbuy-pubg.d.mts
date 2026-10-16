export type MidasbuyCache = {
  getOrLoad: <T>(key: string, ttlSeconds: number, loader: () => Promise<T>) => Promise<{ value: T; cached: boolean }>;
};

export type MidasbuyProviderOptions = {
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  cache?: MidasbuyCache;
};

export type MidasbuyVerifyAttempt =
  | { kind: "success"; nickname: string; source: string; cached?: boolean }
  | { kind: "not_found" }
  | { kind: "rate_limited"; diagnostic?: { reason: string; statusCode?: number } }
  | { kind: "unavailable"; diagnostic?: { reason: string; statusCode?: number } };

export declare const MIDASBUY_VERIFY_CACHE_TTL_SECONDS: number;

export declare function normalizePubgPlayerId(value: unknown): string;

export declare function classifyMidasbuyResponse(
  httpStatus: number,
  payload: unknown,
): MidasbuyVerifyAttempt;

export declare function lookupMidasbuyPlayer(
  playerId: string,
  options?: MidasbuyProviderOptions,
): Promise<MidasbuyVerifyAttempt>;
