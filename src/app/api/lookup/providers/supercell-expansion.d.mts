import type { LookupAttempt, SupercellGame } from "./supercell.mjs";

export type ProviderOptions = {
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
};

export type ClanLookupAttempt =
  | {
      kind: "success";
      clan: {
        name: string;
        tag: string;
        memberCount: number | null;
        score?: number | null;
        warTrophies?: number | null;
        clanPoints?: number | null;
        clanLevel?: number | null;
        warWins?: number | null;
        location: string | null;
      };
      source: string;
    }
  | { kind: "not_found" }
  | { kind: "rate_limited"; diagnostic?: { reason: string; statusCode?: number } }
  | { kind: "unavailable"; diagnostic?: { reason: string; statusCode?: number } };

export type ClubLookupAttempt =
  | {
      kind: "success";
      club: {
        name: string;
        tag: string;
        memberCount: number | null;
        trophies: number | null;
        type: string | null;
        description: string | null;
      };
      source: string;
    }
  | { kind: "not_found" }
  | { kind: "rate_limited"; diagnostic?: { reason: string; statusCode?: number } }
  | { kind: "unavailable"; diagnostic?: { reason: string; statusCode?: number } };

export type BattlelogLookupAttempt =
  | {
      kind: "success";
      battles: Array<Record<string, string | number | string[] | null>>;
      source: string;
    }
  | { kind: "not_found" }
  | { kind: "rate_limited"; diagnostic?: { reason: string; statusCode?: number } }
  | { kind: "unavailable"; diagnostic?: { reason: string; statusCode?: number } };

export type WarlogLookupAttempt =
  | {
      kind: "success";
      wars: Array<Record<string, string | number | null>>;
      source: string;
    }
  | { kind: "not_found" }
  | { kind: "rate_limited"; diagnostic?: { reason: string; statusCode?: number } }
  | { kind: "unavailable"; diagnostic?: { reason: string; statusCode?: number } };

export type RankingsLookupAttempt =
  | {
      kind: "success";
      entries: Array<Record<string, string | number | null>>;
      source: string;
    }
  | { kind: "not_found" }
  | { kind: "rate_limited"; diagnostic?: { reason: string; statusCode?: number } }
  | { kind: "unavailable"; diagnostic?: { reason: string; statusCode?: number } };

export type { LookupAttempt, SupercellGame };
