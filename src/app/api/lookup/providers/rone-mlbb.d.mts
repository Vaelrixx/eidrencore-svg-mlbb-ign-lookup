export type RoneHero = {
  id: number | string | null;
  name: string;
};

export type RoneCache = {
  getOrLoad: <T>(key: string, ttlSeconds: number, loader: () => Promise<T>) => Promise<{ value: T; cached: boolean }>;
};

export type RoneProviderOptions = {
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  cache?: RoneCache;
};

export type RoneListAttempt =
  | { kind: "success"; heroes: RoneHero[]; source: string; cached?: boolean }
  | { kind: "not_found" }
  | { kind: "rate_limited"; diagnostic?: { reason: string; statusCode?: number } }
  | { kind: "unavailable"; diagnostic?: { reason: string; statusCode?: number } };

export type RoneHeroDetailAttempt =
  | {
      kind: "success";
      hero: RoneHero;
      counters: RoneHero[];
      teammates: RoneHero[];
      source: string;
      cached?: boolean;
    }
  | { kind: "not_found" }
  | { kind: "rate_limited"; diagnostic?: { reason: string; statusCode?: number } }
  | { kind: "unavailable"; diagnostic?: { reason: string; statusCode?: number } };

export type RoneMetaRankAttempt =
  | {
      kind: "success";
      entries: Array<RoneHero & { rank: number | null }>;
      source: string;
      cached?: boolean;
    }
  | { kind: "not_found" }
  | { kind: "rate_limited"; diagnostic?: { reason: string; statusCode?: number } }
  | { kind: "unavailable"; diagnostic?: { reason: string; statusCode?: number } };

export declare const RONE_META_CACHE_TTL_SECONDS: number;

export declare function normalizeHeroIdentifier(value: unknown): string;

export declare function lookupRoneHeroes(options?: RoneProviderOptions): Promise<RoneListAttempt>;

export declare function lookupRoneHeroDetail(
  identifier: unknown,
  options?: RoneProviderOptions,
): Promise<RoneHeroDetailAttempt>;

export declare function lookupRoneMetaRank(options?: RoneProviderOptions): Promise<RoneMetaRankAttempt>;
