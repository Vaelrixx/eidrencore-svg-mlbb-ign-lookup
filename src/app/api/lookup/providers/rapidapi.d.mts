export type RapidApiDiagnostic = {
  reason: "missing_config" | "http_error" | "network_or_timeout" | "unrecognized_response" | "provider_error";
  statusCode?: number;
  responseKind?: "id_game_checker_schema" | "nested_status_error" | "gateway_message_json" | "other_json_object" | "json_array" | "empty_or_non_json";
  responseShape?: string;
  messageCode?: string;
};

export type RapidApiAttempt =
  | { kind: "success"; nickname: string; source: "rapidapi_id_game_checker" }
  | { kind: "not_found" }
  | { kind: "rate_limited"; diagnostic?: RapidApiDiagnostic }
  | { kind: "unavailable"; diagnostic?: RapidApiDiagnostic };

export function classifyRapidApiResponse(httpStatus: number, payload: unknown): RapidApiAttempt;
export function classifyRapidApiGameResponse(httpStatus: number, payload: unknown): RapidApiAttempt;
export function classifyGameResponseShape(payload: unknown): string;
export function lookupRapidApi(playerId: string, zoneId: string): Promise<RapidApiAttempt>;
