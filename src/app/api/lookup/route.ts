import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { confirmedNickname } from "./nickname-validation.mjs";
import { resolveLookupWithFallbacks } from "./resolve-lookup.mjs";
import { lookupIsan } from "./providers/isan.mjs";
import { lookupRapidApi } from "./providers/rapidapi.mjs";
import { lookupWhoPlays } from "./providers/whoplays.mjs";
import { logLookupSummary, observeProvider } from "./observability.mjs";
import { enforceLookupRateLimit, enforcePlaygroundLimit, persistLookupLog } from "./persistence.mjs";
import { getUserFromRequest, getUserFromSession, requireUser } from "@/lib/platform";
import { recordDeveloperRequest } from "@/lib/developer-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOOKUP_ENDPOINT = "https://mlbb-api.isan.eu.org/find";
const PLAYER_ID_PATTERN = /^\d{4,20}$/;
const ZONE_ID_PATTERN = /^\d{1,10}$/;

type LookupDiagnostic = {
  reason: "missing_config" | "http_error" | "network_or_timeout" | "unrecognized_response" | "provider_error";
  statusCode?: number;
};

type LookupAttempt =
  | { kind: "success"; nickname: string; country?: string; source: string }
  | { kind: "not_found" }
  | { kind: "rate_limited"; diagnostic?: LookupDiagnostic }
  | { kind: "unavailable"; diagnostic?: LookupDiagnostic };

function jsonError(
  message: string,
  status: number,
  code: string,
  requestId?: string,
  extraHeaders: Record<string, string> = {},
) {
  return NextResponse.json(
    { success: false, error: message, code },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        ...(requestId ? { "X-Lookup-Request-Id": requestId } : {}),
        ...extraHeaders,
      },
    },
  );
}

async function loggedError(
  message: string,
  status: number,
  code: string,
  requestId: string,
  startedAt: number,
  logStatus: "invalid_input" | "not_found" | "upstream_error" | "rate_limited",
  extraHeaders: Record<string, string> = {},
) {
  // Best-effort background write: persistLookupLog never throws, and a slow
  // database must not delay the response.
  void persistLookupLog({
    status: logStatus,
    responseMs: Date.now() - startedAt,
    source: "mlbb_lookup_api",
  });
  return jsonError(message, status, code, requestId, extraHeaders);
}

function jsonSuccess(
  confirmed: Extract<LookupAttempt, { kind: "success" }>,
  playerId: string,
  zoneId: string,
  requestId: string,
) {
  return NextResponse.json(
    {
      success: true,
      data: {
        nickname: confirmed.nickname,
        playerId,
        zoneId,
        ...(confirmed.country ? { country: confirmed.country } : {}),
        source: confirmed.source,
      },
    },
    {
      headers: {
        "Cache-Control": "no-store",
        "X-Lookup-Request-Id": requestId,
      },
    },
  );
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function explicitlyNotFound(payload: unknown): boolean {
  const root = record(payload);
  if (!root) return false;
  const data = record(root.data);
  const message = [
    root.message, root.msg, root.error, root.reason,
    data?.message, data?.msg, data?.error, data?.reason,
  ].filter((value): value is string => typeof value === "string").join(" ");
  return root.success === false || root.valid === false || data?.valid === false
    ? /not found|does not exist|invalid|cannot find|can't find|no such|wrong (player|user|game)?\s*id/i.test(message)
    : /not found|does not exist|invalid (player|user|game)?\s*id|cannot find|can't find|no such account/i.test(message);
}

/**
 * Primary provider: public community-run MLBB identity endpoint.
 * Its contract and availability are outside our control.
 */
async function lookupPrimary(playerId: string, zoneId: string): Promise<LookupAttempt> {
  const query = new URLSearchParams({ id: playerId, zone: zoneId });
  try {
    const upstream = await fetch(`${LOOKUP_ENDPOINT}?${query.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json", "User-Agent": "EidrenMLBBLookup/1.0" },
      cache: "no-store",
      signal: AbortSignal.timeout(7000),
    });

    if (upstream.status === 429) return { kind: "rate_limited", diagnostic: { reason: "http_error", statusCode: 429 } };
    if (upstream.status === 404) return { kind: "unavailable", diagnostic: { reason: "http_error", statusCode: 404 } };
    if (!upstream.ok) return { kind: "unavailable", diagnostic: { reason: "http_error", statusCode: upstream.status } };

    const payload: unknown = await upstream.json().catch(() => null);
    if (!payload || typeof payload !== "object") return { kind: "unavailable", diagnostic: { reason: "unrecognized_response", statusCode: upstream.status } };

    const data = payload as Record<string, unknown>;
    if (data.success !== true) {
      return explicitlyNotFound(payload)
        ? { kind: "not_found" }
        : { kind: "unavailable", diagnostic: { reason: "unrecognized_response", statusCode: upstream.status } };
    }

    const nickname = confirmedNickname(payload);
    if (!nickname) return { kind: "unavailable", diagnostic: { reason: "unrecognized_response", statusCode: upstream.status } };

    return {
      kind: "success",
      nickname,
      country: typeof data.countryName === "string" ? data.countryName : undefined,
      source: "community_lookup",
    };
  } catch {
    return { kind: "unavailable", diagnostic: { reason: "network_or_timeout" } };
  }
}

/**
 * Resolve an MLBB nickname without a password or game login. Provider
 * integrations are unofficial and may change or fail independently.
 */
export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  const requestStartedAt = Date.now();

  // Shared fixed-window rate limiting is enabled only when its server-side
  // Supabase and HMAC secrets are configured. A database outage fails open.
  const rateLimit = await enforceLookupRateLimit(request);
  if (!rateLimit.allowed) {
    const retryAfter = Math.max(1, rateLimit.retryAfterSeconds);
    return loggedError(
      "Too many lookup requests. Please wait before trying again.",
      429,
      "RATE_LIMITED",
      requestId,
      requestStartedAt,
      "rate_limited",
      { "Retry-After": String(retryAfter) },
    );
  }

  // Every lookup needs an account: either an Eidren API key (Bearer eid_...)
  // or a signed-in session (the playground). Checked before reading the body
  // so anonymous callers learn nothing about input validation.
  const usesApiKey = (request.headers.get("authorization") || "").startsWith("Bearer eid_");
  let sessionUserId: string | null = null;
  if (!usesApiKey) {
    const { user } = await requireUser().catch(() => ({ user: null }));
    if (!user) {
      return jsonError(
        "Sign in or create an API key to run lookups.",
        401,
        "AUTH_REQUIRED",
        requestId,
        { "WWW-Authenticate": 'Bearer realm="eidren"' },
      );
    }
    sessionUserId = user.id;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return loggedError("Request body must be valid JSON.", 400, "INVALID_JSON", requestId, requestStartedAt, "invalid_input");
  }

  if (!body || typeof body !== "object") {
    return loggedError("Send playerId and zoneId as strings.", 400, "INVALID_INPUT", requestId, requestStartedAt, "invalid_input");
  }

  const input = body as Record<string, unknown>;
  const playerId = typeof input.playerId === "string" ? input.playerId.trim() : "";
  const zoneId = typeof input.zoneId === "string" ? input.zoneId.trim() : "";

  if (!PLAYER_ID_PATTERN.test(playerId) || !ZONE_ID_PATTERN.test(zoneId)) {
    return loggedError(
      "Enter a numeric Player ID (4–20 digits) and Zone ID (1–10 digits).",
      400,
      "INVALID_ID",
      requestId,
      requestStartedAt,
      "invalid_input",
    );
  }

  let developerAuth: { userId: string; apiKeyId: string; workspaceId: string | null };

  // API keys must validate and pass their plan's monthly quota. Session
  // (playground) callers get a separate daily per-account allowance.
  if (sessionUserId) {
    const playground = await enforcePlaygroundLimit(sessionUserId);
    if (!playground.allowed) {
      return jsonError(
        "Daily playground limit reached. Create an API key to keep integrating.",
        429,
        "PLAYGROUND_LIMIT",
        requestId,
        { "Retry-After": String(Math.max(1, playground.retryAfterSeconds)) },
      );
    }
    const sessionAuth = await getUserFromSession(sessionUserId);
    if (!sessionAuth || "error" in sessionAuth) {
      const status = sessionAuth && typeof sessionAuth.status === "number" ? sessionAuth.status : 503;
      return jsonError(
        status === 429 ? "Monthly request quota reached. Upgrade your plan to continue." : "Playground is temporarily unavailable.",
        status,
        status === 429 ? "API_QUOTA_EXCEEDED" : "QUOTA_UNAVAILABLE",
        requestId,
      );
    }
    developerAuth = { userId: sessionAuth.userId, apiKeyId: sessionAuth.keyId, workspaceId: sessionAuth.workspaceId };
  } else {
    const keyAuth = await getUserFromRequest(request);
    if (!keyAuth) return jsonError("Invalid API key.", 401, "INVALID_API_KEY", requestId);
    if ("error" in keyAuth) {
      const status = typeof keyAuth.status === "number" ? keyAuth.status : 401;
      const code = status === 429 ? "API_QUOTA_EXCEEDED" : status === 503 ? "QUOTA_UNAVAILABLE" : "INVALID_API_KEY";
      return jsonError(typeof keyAuth.error === "string" ? keyAuth.error : "API key rejected.", status, code, requestId);
    } else {
      developerAuth = { userId: keyAuth.userId, apiKeyId: keyAuth.keyId, workspaceId: keyAuth.workspaceId };
    }
  }

  // Structured telemetry deliberately excludes player IDs, zone IDs, nicknames,
  // upstream payloads, headers, and credentials.
  const lookupStartedAt = Date.now();

  // Primary-first lookup with deterministic, concurrent fallback takeover.
  const resolution = await resolveLookupWithFallbacks(
    () => observeProvider({
      requestId,
      provider: "isan_find",
      lookup: () => lookupPrimary(playerId, zoneId),
    }),
    [
      // Keep only the fallback adapters that passed the live provider sweep.
      () => observeProvider({ requestId, provider: "rapidapi_id_game_checker", lookup: () => lookupRapidApi(playerId, zoneId) }),
      () => observeProvider({ requestId, provider: "isan_nickname_api", lookup: () => lookupIsan(playerId, zoneId) }),
      () => observeProvider({ requestId, provider: "whoplays_check", lookup: () => lookupWhoPlays(playerId, zoneId) }),
    ],
  );
  const { primary, fallbacks, confirmed, pendingFallbacks } = resolution;
  logLookupSummary({
    requestId,
    durationMs: Date.now() - lookupStartedAt,
    primary,
    fallbacks,
    confirmed,
    pendingFallbacks,
  });

  if (confirmed?.kind === "success") {
    await recordDeveloperRequest({ ...developerAuth, requestId, status: 200, responseMs: Date.now() - requestStartedAt });
    void persistLookupLog({
      status: "success",
      responseMs: Date.now() - requestStartedAt,
      source: confirmed.source,
    });
    return jsonSuccess(confirmed, playerId, zoneId, requestId);
  }

  const attempts: LookupAttempt[] = [primary, ...fallbacks];

  if (attempts.every((attempt) => attempt.kind === "not_found")) {
    await recordDeveloperRequest({ ...developerAuth, requestId, status: 404, responseMs: Date.now() - requestStartedAt });
    return loggedError(
      "No provider found an MLBB account for that Player ID and Zone ID.",
      404,
      "PLAYER_NOT_FOUND",
      requestId,
      requestStartedAt,
      "not_found",
    );
  }

  if (attempts.every((attempt) => attempt.kind === "rate_limited")) {
    await recordDeveloperRequest({ ...developerAuth, requestId, status: 429, responseMs: Date.now() - requestStartedAt });
    return loggedError(
      "All lookup providers are rate-limiting requests. Try again shortly.",
      429,
      "UPSTREAM_RATE_LIMIT",
      requestId,
      requestStartedAt,
      "rate_limited",
    );
  }

  await recordDeveloperRequest({ ...developerAuth, requestId, status: 502, responseMs: Date.now() - requestStartedAt });
  return loggedError(
    "We couldn't verify this ID right now because lookup providers are unavailable. Please retry shortly.",
    502,
    "UPSTREAM_UNAVAILABLE",
    requestId,
    requestStartedAt,
    "upstream_error",
  );
}

/**
 * Browser-friendly GET interface:
 * - No query parameters: return concise endpoint usage information.
 * - With playerId and zoneId: run the same validation/provider flow as POST.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const hasLookupInput = url.searchParams.has("playerId") || url.searchParams.has("zoneId");

  if (!hasLookupInput) {
    return NextResponse.json(
      {
        success: true,
        service: "Eidren MLBB IGN Lookup API",
        status: "online",
        message: "This endpoint is an API. Authenticate with an Eidren API key (Authorization: Bearer eid_...).",
        auth: "Required. Create a key in the console after signing up.",
        methods: ["GET", "POST"],
        getExample: "/api/lookup?playerId=1114917746&zoneId=13486",
        postExample: {
          url: "/api/lookup",
          method: "POST",
          body: { playerId: "1114917746", zoneId: "13486" },
        },
        note: "Nickname lookup depends on unofficial third-party providers and their availability.",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const body = JSON.stringify({
    playerId: url.searchParams.get("playerId") ?? "",
    zoneId: url.searchParams.get("zoneId") ?? "",
  });
  const forwardedHeaders = new Headers({ "Content-Type": "application/json" });
  for (const name of ["x-real-ip", "x-forwarded-for", "authorization", "cookie"]) {
    const value = request.headers.get(name);
    if (value) forwardedHeaders.set(name, value);
  }
  const postRequest = new NextRequest(request.url, {
    method: "POST",
    headers: forwardedHeaders,
    body,
  });
  return POST(postRequest);
}
