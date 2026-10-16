export type FreeFireProfile = {
  nickname: string;
  uid: string | null;
  level: number | null;
  likes: number | null;
  region: string | null;
  clan: { name: string | null; id: string | null } | null;
};

export type FreeFireModeStats = {
  games: number | null;
  wins: number | null;
  kills: number | null;
  damage: number | null;
};

export type FreeFireStats = {
  modes: Record<string, FreeFireModeStats>;
};

export type FreeFireCache = {
  getOrLoad: <T>(key: string, ttlSeconds: number, loader: () => Promise<T>) => Promise<{ value: T; cached: boolean }>;
};

export type FreeFireProviderOptions = {
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  cache?: FreeFireCache;
};

export type FreeFireProfileAttempt =
  | { kind: "success"; profile: FreeFireProfile; source: string; cached?: boolean }
  | { kind: "not_found" }
  | { kind: "rate_limited"; diagnostic?: { reason: string; statusCode?: number } }
  | { kind: "unavailable"; diagnostic?: { reason: string; statusCode?: number } };

export type FreeFireStatsAttempt =
  | { kind: "success"; stats: FreeFireStats; source: string; cached?: boolean }
  | { kind: "not_found" }
  | { kind: "rate_limited"; diagnostic?: { reason: string; statusCode?: number } }
  | { kind: "unavailable"; diagnostic?: { reason: string; statusCode?: number } };

export declare const FREEFIRE_PROFILE_CACHE_TTL_SECONDS: number;
export declare const FREEFIRE_STATS_CACHE_TTL_SECONDS: number;

export declare function normalizeFreeFireUid(value: unknown): string;

export declare function lookupFreeFireProfile(
  uid: string,
  options?: FreeFireProviderOptions,
): Promise<FreeFireProfileAttempt>;

export declare function lookupFreeFireStats(
  uid: string,
  options?: FreeFireProviderOptions,
): Promise<FreeFireStatsAttempt>;
