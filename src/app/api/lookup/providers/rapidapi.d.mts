export type RapidApiDiagnostic = {
  reason: "missing_config" | "http_error" | "network_or_timeout" | "unrecognized_response" | "provider_error";
  statusCode?: number;
};

export type RapidApiAttempt =
  | { kind: "success"; nickname: string; source: "rapidapi_id_game_checker" }
  | { kind: "not_found" }
  | { kind: "rate_limited"; diagnostic?: RapidApiDiagnostic }
  | { kind: "unavailable"; diagnostic?: RapidApiDiagnostic };

export function classifyRapidApiResponse(httpStatus: number, payload: unknown): RapidApiAttempt;
export function lookupRapidApi(playerId: string, zoneId: string): Promise<RapidApiAttempt>;
