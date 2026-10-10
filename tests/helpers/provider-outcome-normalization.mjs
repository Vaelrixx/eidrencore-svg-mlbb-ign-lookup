const CANONICAL_OUTCOMES = new Set([
  "success",
  "not_found",
  "rate_limited",
  "unavailable",
  "skipped_missing_ci_secret",
]);

const SAFE_REASONS = new Set([
  "missing_config",
  "http_error",
  "network_or_timeout",
  "provider_error",
  "unrecognized_response",
  "unknown_outcome",
]);

const LEGACY_OUTCOMES = Object.freeze({
  upstream_unavailable: { outcome: "unavailable", reason: "provider_error" },
  http_error: { outcome: "unavailable", reason: "http_error" },
  network_or_timeout: { outcome: "unavailable", reason: "network_or_timeout" },
  unrecognized_response: { outcome: "unavailable", reason: "unrecognized_response" },
});

/**
 * Normalize live-probe results to the same four outcome kinds used by provider
 * adapters. Keep the reason as a small, allowlisted diagnostic value.
 */
export function normalizeProviderOutcome(rawOutcome, reason) {
  if (Object.hasOwn(LEGACY_OUTCOMES, rawOutcome)) {
    return { ...LEGACY_OUTCOMES[rawOutcome] };
  }

  if (!CANONICAL_OUTCOMES.has(rawOutcome)) {
    return { outcome: "unavailable", reason: "unknown_outcome" };
  }

  if (typeof reason === "string" && SAFE_REASONS.has(reason)) {
    return { outcome: rawOutcome, reason };
  }

  return { outcome: rawOutcome };
}
