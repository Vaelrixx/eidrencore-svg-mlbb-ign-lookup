import { confirmedNickname } from "../nickname-validation.mjs";

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function responseKind(payload) {
  const root = record(payload);
  if (!payload || typeof payload !== "object") return "empty_or_non_json";
  if (Array.isArray(payload)) return "json_array";
  if (["error", "status", "msg"].every((key) => key in root)) return "id_game_checker_schema";
  if (
    root.status && typeof root.status === "object" && !Array.isArray(root.status) &&
    typeof root.status.message === "string"
  ) return "nested_status_error";
  if (typeof root.message === "string") return "gateway_message_json";
  return "other_json_object";
}

function diagnosticForStatus(httpStatus, payload) {
  return {
    reason: "http_error",
    statusCode: httpStatus,
    responseKind: responseKind(payload),
  };
}

/**
 * ID Game Checker documents three important response states:
 * - error:false, status:200, msg:id_found with data.username: verified name
 * - error:false, status:204, msg:no_content_0: upstream source could not be read
 * - error:true, status:404, msg:id_not_found: an explicit missing-ID result
 *
 * Do not treat an HTTP 404 alone as proof the ID is absent: gateways and
 * provider versions may return a different body. No raw provider body is logged.
 */
export function classifyRapidApiResponse(httpStatus, payload) {
  const root = record(payload);
  const providerStatus = Number(root?.status);
  const message = typeof root?.msg === "string" ? root.msg.trim().toLowerCase() : "";

  if (httpStatus === 429) {
    return {
      kind: "rate_limited",
      diagnostic: diagnosticForStatus(429, payload),
    };
  }

  if (root?.error === true && providerStatus === 404 && message === "id_not_found") {
    return { kind: "not_found" };
  }

  if (
    httpStatus === 204 ||
    (providerStatus === 204 && message === "no_content_0")
  ) {
    return {
      kind: "unavailable",
      diagnostic: {
        reason: "provider_error",
        statusCode: Number.isInteger(httpStatus) ? httpStatus : 204,
        responseKind: responseKind(payload),
      },
    };
  }

  if (!Number.isInteger(httpStatus) || httpStatus < 200 || httpStatus >= 300) {
    return {
      kind: "unavailable",
      diagnostic: diagnosticForStatus(httpStatus, payload),
    };
  }

  const nickname = confirmedNickname(payload);
  if (nickname) {
    return { kind: "success", nickname, source: "rapidapi_id_game_checker" };
  }

  // Retain conservative handling for older response versions with an
  // explicit not-found message, but never treat an empty/unreadable body as 404.
  const nested = record(root?.data);
  const notFoundMessage = [
    root?.msg,
    root?.message,
    root?.reason,
    nested?.msg,
    nested?.message,
    nested?.reason,
  ].filter((value) => typeof value === "string").join(" ");
  if (
    (root?.error === true || root?.success === false || root?.valid === false || nested?.valid === false) &&
    /not found|does not exist|invalid (player|user|game)?\s*id|cannot find|can't find|no such account/i.test(notFoundMessage)
  ) {
    return { kind: "not_found" };
  }

  return {
    kind: "unavailable",
    diagnostic: {
      reason: "unrecognized_response",
      statusCode: httpStatus,
      responseKind: responseKind(payload),
    },
  };
}

// Generic "can't find username" text can also mean upstream rate limiting;
// require an explicit identity-specific signal before returning not-found.
const NOT_FOUND_MESSAGE_PATTERN = /\b(?:id|uid|(?:player|user|account)\s+id)\s+(?:was\s+)?(?:not found|does not exist|doesn't exist|is invalid|invalid)\b|\b(?:player|user|account|character)\s+(?:was\s+)?(?:not found|does not exist|doesn't exist|is invalid|invalid)\b|\b(?:invalid|unknown)\s+(?:(?:player|user|account|character|uid)\s+)?id\b|\bno such\s+(?:account|player|user|id)\b|\bnickname\s+not found\b/i;

const DEGRADED_MESSAGE_PATTERN = /no[\s_-]*content|temporar|try again|maintenance|upstream|timeout|timed out|rate[\s_-]*limit|too many|service unavailable|internal error|server error|bad gateway|gateway/i;

const DATA_SHAPE_PATTERNS = [
  /^data:object:(avatar|id|uid|userId|playerId|username|nickname|name|ign|gameName|playerName|roleName)(,(avatar|id|uid|userId|playerId|username|nickname|name|ign|gameName|playerName|roleName|game|server|region|zone|avatarUrl|profilePicture|level|rank|title|is_ban|isBan|banned))*$/,
  /^data:(missing|array|string|number|boolean|null|empty)$/,
  /^data:object:unlisted_keys$/,
];

function normalizeProviderText(value) {
  if (typeof value !== "string") return "";
  return value.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

function collectProviderMessages(payload) {
  const root = record(payload);
  const data = record(root?.data);
  const result = record(root?.result);
  const messages = [];
  for (const candidate of [root, data, result]) {
    for (const key of ["msg", "message", "reason", "errorMessage", "error_message", "detail", "details", "description"]) {
      const value = candidate?.[key];
      if (typeof value === "string" && value.trim()) messages.push(value);
    }
  }
  return messages;
}

function providerErrorFlag(payload) {
  const root = record(payload);
  const data = record(root?.data);
  const result = record(root?.result);
  return (
    root?.error === true ||
    data?.error === true ||
    result?.error === true ||
    root?.success === false ||
    data?.success === false ||
    result?.success === false ||
    root?.valid === false ||
    data?.valid === false ||
    result?.valid === false ||
    root?.ok === false ||
    data?.ok === false
  );
}

const MESSAGE_CODE_ALLOWLIST = new Set([
  "id_found",
  "id_not_found",
  "no_content_0",
  "no_content",
  "not_found",
  "invalid_id",
  "invalid_player_id",
  "invalid_user_id",
  "invalid_uid",
  "user_not_found",
  "player_not_found",
  "account_not_found",
  "success",
  "error",
  "failed",
  "timeout",
  "timed_out",
  "rate_limit",
  "rate_limited",
  "too_many_requests",
  "service_unavailable",
  "internal_error",
  "server_error",
  "bad_gateway",
  "gateway_timeout",
  "maintenance",
  "temporarily_unavailable",
  "try_again",
]);

function messageCodeLabel(payload) {
  const root = record(payload);
  const data = record(root?.data);
  const result = record(root?.result);
  const candidates = [];
  for (const candidate of [root, data, result]) {
    for (const key of ["msg", "code", "errorCode", "error_code", "reason", "statusText", "status_text"]) {
      const value = candidate?.[key];
      if ((typeof value === "string" && value.trim()) || typeof value === "number") candidates.push(String(value));
    }
  }
  for (const raw of candidates) {
    const normalized = raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
    // The provider emits per-game/per-reason no-content variants (no_content_0,
    // no_content_2, no_content_5, ...). Collapse them to one label so telemetry
    // stays stable without allowlisting every numeric suffix.
    if (/^no_content(_\d+)?$/.test(normalized)) return "no_content_n";
    if (MESSAGE_CODE_ALLOWLIST.has(normalized)) return normalized;
  }
  if (!candidates.length) return "absent";
  return "unlisted";
}

function dataShapeLabel(payload) {
  const root = record(payload);
  if (!root) return "root:non_object";
  const data = root.data;
  if (data === undefined) return "data:missing";
  if (data === null) return "data:null";
  if (Array.isArray(data)) return "data:array";
  if (typeof data !== "object") return `data:${typeof data}`;
  const keys = Object.keys(data).sort();
  if (!keys.length) return "data:empty";
  const allowlisted = new Set([
    "avatar", "avatarUrl", "game", "gameName", "id", "ign", "level",
    "name", "nickname", "playerId", "playerName", "profilePicture", "rank",
    "region", "roleName", "server", "title", "uid", "userId", "username", "zone",
    // Observed live on the HoK route (E-002): data carries a ban flag.
    "is_ban", "isBan", "banned",
  ]);
  const unknown = keys.some((key) => !allowlisted.has(key));
  if (unknown) return "data:object:unlisted_keys";
  return `data:object:${keys.join(",")}`;
}

/**
 * Classify structure only. Labels carry no IDs, names, URLs, or payload text.
 */
export function classifyGameResponseShape(payload) {
  const root = record(payload);
  if (!payload || typeof payload !== "object") return "empty_or_non_json";
  if (Array.isArray(payload)) return "envelope:array";
  const envelope = ["error", "status", "msg", "message", "success", "valid", "ok", "data", "result", "code", "reason"]
    .filter((key) => key in root)
    .sort()
    .join(",");
  const shape = dataShapeLabel(payload);
  if (DATA_SHAPE_PATTERNS.every((pattern) => !pattern.test(shape))) return "envelope:unrecognized";
  return envelope ? `envelope:${envelope}|${shape}` : `envelope:other|${shape}`;
}

function classifyIdGameCheckerEnvelope(httpStatus, payload) {
  const root = record(payload);
  const nested = record(root?.data);
  const messages = collectProviderMessages(payload);
  const normalized = normalizeProviderText(messages.join(" | "));
  const providerStatus = Number(root?.status ?? nested?.status);
  const providerStatusDiagnostic = Number.isInteger(providerStatus) && providerStatus >= 100 && providerStatus <= 599
    ? { providerStatusCode: providerStatus }
    : {};
  const errorFlag = providerErrorFlag(payload);
  const responseKindLabel = responseKind(payload);
  const messageCode = messageCodeLabel(payload);

  if (httpStatus === 429 || /rate[\s_-]*limit|too many/.test(normalized)) {
    return {
      kind: "rate_limited",
      diagnostic: {
        reason: "http_error",
        statusCode: Number.isInteger(httpStatus) ? httpStatus : 429,
        responseKind: responseKindLabel,
        ...providerStatusDiagnostic,
      },
    };
  }

  if (errorFlag && NOT_FOUND_MESSAGE_PATTERN.test(normalized)) {
    return { kind: "not_found" };
  }

  if (
    httpStatus === 204 ||
    providerStatus === 204 ||
    (errorFlag && DEGRADED_MESSAGE_PATTERN.test(normalized)) ||
    // Live HoK/Genshin evidence (E-002): the provider returns error:false with
    // embedded 204 already covered above, but some no_content_N variants may
    // arrive without the embedded status. A no-content message plus an empty
    // nickname is degraded, never a missing account and never unrecognized.
    (DEGRADED_MESSAGE_PATTERN.test(normalized) && !confirmedNickname(payload))
  ) {
    return {
      kind: "unavailable",
      diagnostic: {
        reason: "provider_error",
        statusCode: Number.isInteger(httpStatus) ? httpStatus : 502,
        responseKind: responseKindLabel,
        responseShape: classifyGameResponseShape(payload),
        messageCode,
        ...providerStatusDiagnostic,
      },
    };
  }

  if (!Number.isInteger(httpStatus) || httpStatus < 200 || httpStatus >= 300) {
    return {
      kind: "unavailable",
      diagnostic: { ...diagnosticForStatus(httpStatus, payload), ...providerStatusDiagnostic },
    };
  }

  const nickname = confirmedNickname(payload);
  if (nickname && !errorFlag) {
    return { kind: "success", nickname, source: "rapidapi_id_game_checker" };
  }

  return {
    kind: "unavailable",
    diagnostic: {
      reason: "unrecognized_response",
      statusCode: httpStatus,
      responseKind: responseKindLabel,
      responseShape: classifyGameResponseShape(payload),
      messageCode,
      ...providerStatusDiagnostic,
    },
  };
}

export function classifyRapidApiGameResponse(httpStatus, payload) {
  return classifyIdGameCheckerEnvelope(httpStatus, payload);
}

export async function lookupRapidApi(playerId, zoneId) {
  const apiKey = process.env.RAPIDAPI_KEY?.trim() || process.env.RAPIDAPI_APP_TOKEN?.trim();
  if (!apiKey) {
    return { kind: "unavailable", diagnostic: { reason: "missing_config" } };
  }

  const endpoint =
    "https://id-game-checker.p.rapidapi.com/mobile-legends/" +
    encodeURIComponent(playerId) +
    "/" +
    encodeURIComponent(zoneId);

  try {
    const upstream = await fetch(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "x-rapidapi-host": "id-game-checker.p.rapidapi.com",
        "x-rapidapi-key": apiKey,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(7000),
    });

    // Read JSON even for HTTP 404 because this provider documents a structured
    // id_not_found body. Parsing failures are swallowed and sanitized below.
    const payload = await upstream.json().catch(() => null);
    return classifyRapidApiResponse(upstream.status, payload);
  } catch {
    return { kind: "unavailable", diagnostic: { reason: "network_or_timeout" } };
  }
}
