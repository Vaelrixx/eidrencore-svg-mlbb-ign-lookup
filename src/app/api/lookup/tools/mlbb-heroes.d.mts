export type HeroSummary = {
  id: number;
  name: string;
  slug: string;
};

export type HeroDetail = HeroSummary & {
  counters: HeroSummary[];
  strongAgainst: HeroSummary[];
  teammates: HeroSummary[];
};

export type HeroDatasetMeta = {
  game?: string;
  source?: string;
  attribution?: string;
  count?: number;
  refresh?: string;
};

export declare function datasetMeta(): HeroDatasetMeta;

export declare function listHeroes(): HeroSummary[];

export declare function normalizeHeroIdentifier(value: unknown): number | string | null;

export declare function heroDetail(identifier: unknown): HeroDetail | null;

export declare function searchHeroes(query: string): HeroSummary[];
