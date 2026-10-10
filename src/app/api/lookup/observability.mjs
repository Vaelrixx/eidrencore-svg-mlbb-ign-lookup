import { performance } from "node:perf_hooks";

const OUTCOMES = new Set(["success", "not_found", "rate_limited", "unavailable"]);
const DIAGNOSTIC_REASONS = new Set(["missing_config", "http_error", "network_or_timeout", "unrecognized_response", "provider_error"]);

/**
 * Emit low-cardinality provider telemetry. Never log IDs, nicknames, payloads,
 * URLs, request headers, or credentials. Logging must not affect lookup results.
 */
export async function observeProvider({ requestId, provider, lookup, logger = console.info, clock = () => performance.now() }) {
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
  };

  try {
    logger(JSON.stringify(event));
  } catch {
    // Observability is best-effort and must never break a lookup.
  }

  return OUTCOMES.has(result?.kind) ? result : { kind: "unavailable" };
}

export function logLookupSummary({ requestId, durationMs, primary, fallbacks, confirmed, logger = console.info }) {
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
    logger(JSON.stringify(event));
  } catch {
    // Do not allow a logging sink failure to affect the response.
  }
}
