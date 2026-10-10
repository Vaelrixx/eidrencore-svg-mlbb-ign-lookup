import { performance } from "node:perf_hooks";

const OUTCOMES = new Set(["success", "not_found", "rate_limited", "unavailable"]);
const DIAGNOSTIC_REASONS = new Set(["missing_config", "http_error", "network_or_timeout", "unrecognized_response", "provider_error"]);
const RESPONSE_KINDS = new Set(["id_game_checker_schema", "nested_status_error", "gateway_message_json", "other_json_object", "json_array", "empty_or_non_json"]);

/**
 * Emit low-cardinality provider telemetry. Never log IDs, nicknames, payloads,
 * URLs, request headers, or credentials. Logging must not affect lookup results.
 */
export async function observeProvider({ requestId, provider, lookup, logger = undefined, clock = () => performance.now() }) {
  const startedAt = clock();
  let result;
  try {
    result = await lookup();
  } catch {
    result = { kind: "unavailable" };
  }

  const outcome = OUTCOMES.has(result?.kind) ? result.kind : "unavailable";
  const durationMs = Math.max(0, Math.round(clock() - startedAt));
  const event = {
    event: "lookup.provider",
    requestId,
    provider,
    outcome,
    durationMs,
    ...(outcome === "success" && typeof result.source === "string" ? { source: result.source } : {}),
    ...(DIAGNOSTIC_REASONS.has(result?.diagnostic?.reason) ? { failureReason: result.diagnostic.reason } : {}),
    ...(Number.isInteger(result?.diagnostic?.statusCode) && result.diagnostic.statusCode >= 100 && result.diagnostic.statusCode <= 599
      ? { upstreamStatus: result.diagnostic.statusCode }
      : {}),
    ...(RESPONSE_KINDS.has(result?.diagnostic?.responseKind)
      ? { providerResponseKind: result.diagnostic.responseKind }
      : {}),
  };

  try {
    const line = JSON.stringify(event);
    if (logger) {
      logger(line);
    } else if (outcome === "unavailable" || outcome === "rate_limited") {
      console.warn(line);
    } else {
      console.info(line);
    }
  } catch {
    // Observability is best-effort and must never break a lookup.
  }

  return OUTCOMES.has(result?.kind) ? result : { kind: "unavailable" };
}

export function logLookupSummary({ requestId, durationMs, primary, fallbacks, confirmed, logger = undefined }) {
  const event = {
    event: "lookup.summary",
    requestId,
    durationMs: Math.max(0, Math.round(durationMs)),
    outcome: confirmed?.kind === "success"
      ? "success"
      : (primary?.kind === "rate_limited" && fallbacks.every((item) => item?.kind === "rate_limited")
        ? "rate_limited"
        : (primary?.kind === "not_found" && fallbacks.every((item) => item?.kind === "not_found")
          ? "not_found"
          : "unavailable")),
    primaryOutcome: OUTCOMES.has(primary?.kind) ? primary.kind : "unavailable",
    fallbackOutcomes: fallbacks.map((item) => OUTCOMES.has(item?.kind) ? item.kind : "unavailable"),
    providerCount: fallbacks.length + 1,
    ...(confirmed?.kind === "success" && typeof confirmed.source === "string" ? { selectedSource: confirmed.source } : {}),
  };

  try {
    const line = JSON.stringify(event);
    if (logger) {
      logger(line);
    } else if (event.outcome === "unavailable" || event.outcome === "rate_limited") {
      console.warn(line);
    } else {
      console.info(line);
    }
  } catch {
    // Do not allow a logging sink failure to affect the response.
  }
}
