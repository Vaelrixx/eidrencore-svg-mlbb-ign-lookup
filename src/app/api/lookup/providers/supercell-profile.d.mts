import type { LookupAttempt, SupercellGame } from "./supercell-expansion.mjs";
import type { LookupAttempt, SupercellGame } from "./supercell.mjs";

export type SupercellProfile = {
  name: string;
  tag: string;
  trophies: number | null;
  level: number | null;
  wins: number | null;
  club: { name: string | null; tag: string | null } | null;
  highestTrophies?: number | null;
  brawlerCount?: number | null;
  starPowerCount?: number | null;
  gadgetCount?: number | null;
  townHallLevel?: number | null;
  warStars?: number | null;
  troopCount?: number | null;
  heroCount?: number | null;
  achievementCount?: number | null;
  challengeCardsWon?: number | null;
  tournamentCardsWon?: number | null;
  cardCount?: number | null;
};

export type ProfileLookupAttempt =
  | { kind: "success"; profile: SupercellProfile; source: string; cached?: boolean }
  | { kind: "not_found" }
  | { kind: "rate_limited"; diagnostic?: { reason: string; statusCode?: number } }
  | { kind: "unavailable"; diagnostic?: { reason: string; statusCode?: number } };

export type ProfileProviderOptions = {
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
};

export declare const PROFILE_CACHE_TTL_SECONDS: number;

export declare function classifyProfileResponse(
  httpStatus: number,
  payload: unknown,
  source: string,
): LookupAttempt;

export declare function lookupSupercellProfile(
  game: SupercellGame,
  tag: string,
  options?: ProfileProviderOptions,
): Promise<ProfileLookupAttempt>;
