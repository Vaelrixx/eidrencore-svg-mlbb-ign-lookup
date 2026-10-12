export type WhoPlaysDiagnostic = {
  reason: "missing_config" | "http_error" | "network_or_timeout" | "unrecognized_response" | "provider_error";
  statusCode?: number;
  responseKind?: "whoplays_success_schema" | "whoplays_error_schema" | "other_json_object" | "json_array" | "empty_or_non_json";
};

export type WhoPlaysAttempt =
  | { kind: "success"; nickname: string; source: "whoplays_check" }
  | { kind: "not_found" }
  | { kind: "rate_limited"; diagnostic?: WhoPlaysDiagnostic }
  | { kind: "unavailable"; diagnostic?: WhoPlaysDiagnostic };

export function classifyWhoPlaysResponse(httpStatus: number, payload: unknown): WhoPlaysAttempt;
export function lookupWhoPlays(playerId: string, zoneId: string): Promise<WhoPlaysAttempt>;
