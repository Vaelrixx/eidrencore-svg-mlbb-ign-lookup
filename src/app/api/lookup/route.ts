import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { resolveLookupWithFallbacks, selectLookupVerdict } from "./resolve-lookup.mjs";
import { lookupRapidApi } from "./providers/rapidapi.mjs";
import { lookupVolseverMlbb } from "./providers/volsever.mjs";
import { lookupIsan } from "./providers/isan.mjs";
import { lookupWhoPlays } from "./providers/whoplays.mjs";
import { lookupGoPayGames } from "./providers/gopay-games.mjs";
import { lookupCodashopDirect } from "./providers/codashop-direct.mjs";
import { logLookupSummary, observeProvider } from "./observability.mjs";
import { enforceLookupRateLimit, enforcePlaygroundLimit, persistLookupLog } from "./persistence.mjs";
import { ledgerPlayerKey, readIdentityLedger, recordIdentityLedgerHit, writeIdentityLedger } from "./identity-ledger.mjs";
import { getUserFromRequest, getUserFromSession, requireUser } from "@/lib/platform";
import { recordDeveloperRequest } from "@/lib/developer-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
        source: "eidren_mlbb",
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

/**
 * Primary provider: the CodaShop store's own validation endpoint, called
 * directly with our own request shape (no aggregator, no key). Contract
 * verified live 2026-10-17; see providers/codashop-direct.mjs.
 */
async function lookupPrimary(playerId: string, zoneId: string): Promise<LookupAttempt> {
  const attempt = await lookupCodashopDirect("mobile-legends", playerId, zoneId);
  if (attempt.kind === "success") {
    return { kind: "success", nickname: attempt.nickname, source: "codashop_direct" };
  }
  return attempt as LookupAttempt;
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

  // Owned answer layer: serve repeat identities from our ledger before
  // touching any upstream. Misses fall through to the provider chain.
  const playerKey = ledgerPlayerKey({ playerId, zoneId });
  const ledgerHit = await readIdentityLedger("eidren_mlbb", playerKey);
  if (ledgerHit) {
    await recordDeveloperRequest({ ...developerAuth, requestId, status: 200, responseMs: Date.now() - requestStartedAt });
    void persistLookupLog({
      status: "success",
      responseMs: Date.now() - requestStartedAt,
      source: "mlbb_lookup_api",
    });
    void recordIdentityLedgerHit("eidren_mlbb", playerKey);
    return NextResponse.json(
      {
        success: true,
        data: {
          nickname: ledgerHit.nickname,
          playerId,
          zoneId,
          source: "eidren_mlbb",
        },
        meta: { servedFrom: "eidren_identity_ledger" },
      },
      {
        headers: {
          "Cache-Control": "no-store",
          "X-Lookup-Request-Id": requestId,
        },
      },
    );
  }

  // Primary-first lookup with deterministic, concurrent fallback takeover.
  const resolution = await resolveLookupWithFallbacks(
    () => observeProvider({
      requestId,
      provider: "codashop_direct",
      lookup: () => lookupPrimary(playerId, zoneId),
    }),
    [
      // Keep only the fallback adapters that passed the live provider sweep.
      // Additive motto: community mirrors stay as extra legs for balance.
      () => observeProvider({ requestId, provider: "rapidapi_id_game_checker", lookup: () => lookupRapidApi(playerId, zoneId) }),
      () => observeProvider({ requestId, provider: "volsever_game_checker", lookup: () => lookupVolseverMlbb(playerId, zoneId) }),
      () => observeProvider({ requestId, provider: "isan_nickname_api", lookup: () => lookupIsan(playerId, zoneId) }),
      () => observeProvider({ requestId, provider: "whoplays_check", lookup: () => lookupWhoPlays(playerId, zoneId) }),
      () => observeProvider({ requestId, provider: "gopay_games_validation", lookup: () => lookupGoPayGames(playerId, zoneId) }),
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

  const verdict = selectLookupVerdict(primary, fallbacks, confirmed);
  if (verdict === "success" && confirmed?.kind === "success") {
    await recordDeveloperRequest({ ...developerAuth, requestId, status: 200, responseMs: Date.now() - requestStartedAt });
    void persistLookupLog({
      status: "success",
      responseMs: Date.now() - requestStartedAt,
      source: confirmed.source,
    });
    void writeIdentityLedger("eidren_mlbb", playerKey, confirmed.nickname, confirmed.source);
    return jsonSuccess(confirmed, playerId, zoneId, requestId);
  }

  if (verdict === "not_found") {
    await recordDeveloperRequest({ ...developerAuth, requestId, status: 404, responseMs: Date.now() - requestStartedAt });
    return loggedError(
      "No MLBB account was found for that Player ID and Zone ID.",
      404,
      "PLAYER_NOT_FOUND",
      requestId,
      requestStartedAt,
      "not_found",
    );
  }

  if (verdict === "rate_limited") {
    await recordDeveloperRequest({ ...developerAuth, requestId, status: 429, responseMs: Date.now() - requestStartedAt });
    return loggedError(
      "Eidren is rate-limiting requests right now. Try again shortly.",
      429,
      "SERVICE_RATE_LIMIT",
      requestId,
      requestStartedAt,
      "rate_limited",
    );
  }

  await recordDeveloperRequest({ ...developerAuth, requestId, status: 502, responseMs: Date.now() - requestStartedAt });
  return loggedError(
    "Eidren couldn't verify this ID right now. Please retry shortly.",
    502,
    "SERVICE_UNAVAILABLE",
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
        note: "Nickname lookup is served by the Eidren identity network.",
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
