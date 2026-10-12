import { performance } from "node:perf_hooks";

const OUTCOMES = new Set(["success", "not_found", "rate_limited", "unavailable"]);
const DIAGNOSTIC_REASONS = new Set(["missing_config", "http_error", "network_or_timeout", "unrecognized_response", "provider_error"]);
const RESPONSE_KINDS = new Set(["id_game_checker_schema", "nested_status_error", "gateway_message_json", "other_json_object", "json_array", "empty_or_non_json"]);
const MESSAGE_CODES = new Set([
  "absent", "unlisted", "id_found", "id_not_found", "no_content_0", "no_content",
  "not_found", "invalid_id", "invalid_player_id", "invalid_user_id", "invalid_uid",
  "user_not_found", "player_not_found", "account_not_found", "success", "error",
  "failed", "timeout", "timed_out", "rate_limit", "rate_limited", "too_many_requests",
  "service_unavailable", "internal_error", "server_error", "bad_gateway",
  "gateway_timeout", "maintenance", "temporarily_unavailable", "try_again",
]);
const SHAPE_ENVELOPE_KEYS = new Set(["error", "status", "msg", "message", "success", "valid", "ok", "data", "result", "code", "reason"]);
const SHAPE_DATA_KEYS = new Set([
  "avatar", "avatarUrl", "game", "gameName", "id", "ign", "level", "name", "nickname",
  "playerId", "playerName", "profilePicture", "rank", "region", "roleName", "server",
  "title", "uid", "userId", "username", "zone",
]);
const SHAPE_SIMPLE_DATA = new Set(["missing", "null", "array", "string", "number", "boolean", "empty"]);

function isAllowlistedResponseShape(value) {
  if (typeof value !== "string" || !value || value.length > 256) return false;
  if (value === "empty_or_non_json") return true;
  if (value === "envelope:array" || value === "envelope:unrecognized") return true;
  const parts = value.split("|");
  if (parts.length !== 2) return false;
  const [envelope, shape] = parts;
  if (!envelope.startsWith("envelope:")) return false;
  const envelopeKeys = envelope.slice("envelope:".length);
  if (envelopeKeys !== "other") {
    if (!envelopeKeys) return false;
    const keys = envelopeKeys.split(",");
    const sorted = [...keys].sort();
    if (keys.some((key) => !SHAPE_ENVELOPE_KEYS.has(key))) return false;
    if (keys.join(",") !== sorted.join(",")) return false;
    if (new Set(keys).size !== keys.length) return false;
  }
  if (shape === "root:non_object") return true;
  if (!shape.startsWith("data:")) return false;
  const dataPart = shape.slice("data:".length);
  if (SHAPE_SIMPLE_DATA.has(dataPart)) return true;
  if (dataPart === "object:unlisted_keys") return true;
  if (!dataPart.startsWith("object:")) return false;
  const keys = dataPart.slice("object:".length).split(",");
  const sorted = [...keys].sort();
  if (keys.some((key) => !SHAPE_DATA_KEYS.has(key))) return false;
  if (keys.join(",") !== sorted.join(",")) return false;
  return new Set(keys).size === keys.length;
}

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
    ...(isAllowlistedResponseShape(result?.diagnostic?.responseShape)
      ? { providerResponseShape: result.diagnostic.responseShape }
      : {}),
    ...(typeof result?.diagnostic?.messageCode === "string" && MESSAGE_CODES.has(result.diagnostic.messageCode)
      ? { providerMessageCode: result.diagnostic.messageCode }
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

export function logLookupSummary({ requestId, durationMs, primary, fallbacks, confirmed, pendingFallbacks = 0, logger = undefined }) {
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
    providerCount: fallbacks.length + pendingFallbacks + 1,
    ...(pendingFallbacks > 0 ? { pendingFallbackCount: pendingFallbacks } : {}),
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
