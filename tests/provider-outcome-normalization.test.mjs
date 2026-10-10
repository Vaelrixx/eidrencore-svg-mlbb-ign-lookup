import test from "node:test";
import assert from "node:assert/strict";
import { normalizeProviderOutcome } from "./helpers/provider-outcome-normalization.mjs";

test("canonical provider outcomes remain unchanged", () => {
  for (const outcome of ["success", "not_found", "rate_limited", "unavailable", "skipped_missing_ci_secret"]) {
    assert.deepEqual(normalizeProviderOutcome(outcome), { outcome });
  }
});

test("legacy diagnostic labels normalize to the shared unavailable outcome", () => {
  assert.deepEqual(normalizeProviderOutcome("upstream_unavailable"), {
    outcome: "unavailable",
    reason: "provider_error",
  });
  assert.deepEqual(normalizeProviderOutcome("http_error"), {
    outcome: "unavailable",
    reason: "http_error",
  });
  assert.deepEqual(normalizeProviderOutcome("network_or_timeout"), {
    outcome: "unavailable",
    reason: "network_or_timeout",
  });
  assert.deepEqual(normalizeProviderOutcome("unrecognized_response"), {
    outcome: "unavailable",
    reason: "unrecognized_response",
  });
});

test("only allowlisted diagnostic reasons are retained", () => {
  assert.deepEqual(normalizeProviderOutcome("unavailable", "http_error"), {
    outcome: "unavailable",
    reason: "http_error",
  });
  assert.deepEqual(normalizeProviderOutcome("unavailable", "unexpected raw message"), {
    outcome: "unavailable",
  });
});

test("unknown labels fail closed to unavailable without carrying raw text", () => {
  assert.deepEqual(normalizeProviderOutcome("provider echoed private response"), {
    outcome: "unavailable",
    reason: "unknown_outcome",
  });
});
