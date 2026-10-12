export type GoPayGamesDiagnostic = {
  reason: "http_error" | "network_or_timeout" | "unrecognized_response";
  statusCode?: number;
  responseKind?: "gopay_success_schema" | "gopay_error_schema" | "other_json_object" | "json_array" | "empty_or_non_json";
};

export type GoPayGamesAttempt =
  | { kind: "success"; nickname: string; source: "gopay_games_validation" }
  | { kind: "not_found" }
  | { kind: "rate_limited"; diagnostic?: GoPayGamesDiagnostic }
  | { kind: "unavailable"; diagnostic?: GoPayGamesDiagnostic };

export function classifyGoPayGamesResponse(httpStatus: number, payload: unknown): GoPayGamesAttempt;
export function lookupGoPayGames(playerId: string, zoneId: string): Promise<GoPayGamesAttempt>;
