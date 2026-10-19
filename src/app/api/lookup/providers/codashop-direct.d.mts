export type CodashopGameConfig = {
  voucherTypeName: string;
  country: string;
  requiresZone: boolean;
  source: string;
  whiteLabelId?: string;
  followCountryRedirect?: boolean;
  enabledEnv?: string;
};

export declare const CODASHOP_GAMES: Record<string, CodashopGameConfig>;

export type CodashopAttempt =
  | { kind: "success"; nickname: string; source: string }
  | { kind: "not_found" }
  | { kind: "rate_limited"; diagnostic?: { reason: string; statusCode?: number } }
  | { kind: "unavailable"; diagnostic?: { reason: string; statusCode?: number } };

export type CodashopLookupOptions = {
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
};

export declare function classifyCodashopResponse(
  httpStatus: number,
  payload: unknown,
): CodashopAttempt;

export declare function lookupCodashopDirect(
  game: string,
  playerId: string,
  zoneId?: string,
  options?: CodashopLookupOptions,
): Promise<CodashopAttempt>;
