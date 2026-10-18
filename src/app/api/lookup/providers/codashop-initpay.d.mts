export type InitpayAttempt =
  | { kind: "success"; nickname: string; source: string }
  | { kind: "not_found" }
  | { kind: "rate_limited"; diagnostic?: { reason: string; statusCode?: number } }
  | { kind: "unavailable"; diagnostic?: { reason: string; statusCode?: number } };
export declare const INITPAY_GAMES: Readonly<Record<string, {
  voucherTypeName: string;
  pricePointId: string;
  pricePointPrice: string;
  requiresZone: boolean;
  nicknameFrom?: string;
  source: string;
}>>;
export declare function classifyInitpayResponse(httpStatus: number, payload: unknown, options?: { nicknameFrom?: string }): InitpayAttempt;
export declare function lookupCodashopInitpay(
  game: string,
  playerId: string,
  zoneId?: string,
  options?: { fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv; cache?: unknown },
): Promise<InitpayAttempt>;
