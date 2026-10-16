import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { logLookupSummary, observeProvider } from "./observability.mjs";
import { enforceLookupRateLimit, enforcePlaygroundLimit, persistLookupLog } from "./persistence.mjs";
import { getUserFromRequest, getUserFromSession, requireUser } from "@/lib/platform";
import { recordDeveloperRequest } from "@/lib/developer-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type MetaAttempt =
  | { kind: "success"; data: Record<string, unknown>; source: string; cached?: boolean }
  | { kind: "not_found" }
  | { kind: "rate_limited"; diagnostic?: { reason: string; statusCode?: number } }
  | { kind: "unavailable"; diagnostic?: { reason: string; statusCode?: number } };

export type MetaLookupConfig = {
  /** URL path used in request logs, e.g. "/api/lookup/mlbb/meta/heroes". */
  endpoint: string;
  /** Human label used in user-facing messages, e.g. "MLBB hero list". */
  resourceLabel: string;
  /** Provider label for telemetry, e.g. "rone_arena_api". */
  provider: string;
  /** Log source label, e.g. "rone_arena_api". */
  logSource: string;
  /** Error code when the resource is missing, e.g. "MLBB_HERO_NOT_FOUND". */
  notFoundCode: string;
  /** Optional query/body key carrying the resource identifier (e.g. "hero"). */
  identifierKey?: string;
  /** Example identifier shown in validation errors. */
  identifierExample?: string;
  /** Performs the upstream lookup; receives the identifier or "". */
  lookup: (identifier: string) => Promise<MetaAttempt>;
};

type LogStatus = "success" | "invalid_input" | "not_found" | "upstream_error" | "rate_limited";

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
  config: MetaLookupConfig,
  message: string,
  status: number,
  code: string,
  requestId: string,
  startedAt: number,
  logStatus: LogStatus,
  extraHeaders: Record<string, string> = {},
) {
  void persistLookupLog({
    status: logStatus,
    responseMs: Date.now() - startedAt,
    source: config.logSource,
  });
  return jsonError(message, status, code, requestId, extraHeaders);
}

/**
 * Meta/static-data handler factory. Auth, quota, telemetry, and error codes
 * mirror createGameLookupHandler; the only differences are the identifier
 * handling (optional single key instead of a player tag) and the generic
 * success payload. Meta data is public game data — no player identity flows
 * through here.
 */
export function createMetaLookupHandler(config: MetaLookupConfig) {
  function identifierFrom(value: unknown): string {
    if (!config.identifierKey) return "";
    return typeof value === "string" ? value.trim() : "";
  }

  async function runLookup(request: NextRequest, identifier: string) {
    const requestId = randomUUID();
    const requestStartedAt = Date.now();
    const rateLimit = await enforceLookupRateLimit(request);
    if (!rateLimit.allowed) {
      const retryAfter = Math.max(1, rateLimit.retryAfterSeconds);
      return loggedError(
        config,
        "Too many lookup requests. Please wait before trying again.",
        429,
        "RATE_LIMITED",
        requestId,
        requestStartedAt,
        "rate_limited",
        { "Retry-After": String(retryAfter) },
      );
    }
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
    let developerAuth: { userId: string; apiKeyId: string; workspaceId: string | null };
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
    const lookupStartedAt = Date.now();
    const attempt = await observeProvider({
      requestId,
      provider: config.provider,
      lookup: () => config.lookup(identifier),
    });
    logLookupSummary({
      requestId,
      durationMs: Date.now() - lookupStartedAt,
      primary: attempt,
      fallbacks: [],
      confirmed: attempt.kind === "success" ? attempt : null,
      pendingFallbacks: 0,
    });
    if (attempt.kind === "success") {
      await recordDeveloperRequest({ ...developerAuth, endpoint: config.endpoint, requestId, status: 200, responseMs: Date.now() - requestStartedAt });
      void persistLookupLog({
        status: "success",
        responseMs: Date.now() - requestStartedAt,
        source: config.logSource,
      });
      return NextResponse.json(
        {
          success: true,
          data: attempt.data,
          meta: { source: config.provider, cached: attempt.cached === true },
          requestId,
        },
        { headers: { "Cache-Control": "no-store", "X-Lookup-Request-Id": requestId } },
      );
    }
    if (attempt.kind === "not_found") {
      await recordDeveloperRequest({ ...developerAuth, endpoint: config.endpoint, requestId, status: 404, responseMs: Date.now() - requestStartedAt });
      return loggedError(
        config,
        `No ${config.resourceLabel} was found for that request.`,
        404,
        config.notFoundCode,
        requestId,
        requestStartedAt,
        "not_found",
      );
    }
    if (attempt.kind === "rate_limited") {
      const retryAfter = Math.max(1, 30);
      await recordDeveloperRequest({ ...developerAuth, endpoint: config.endpoint, requestId, status: 429, responseMs: Date.now() - requestStartedAt });
      return loggedError(
        config,
        `Eidren is rate-limiting ${config.resourceLabel} requests right now. Try again shortly.`,
        429,
        "SERVICE_RATE_LIMIT",
        requestId,
        requestStartedAt,
        "rate_limited",
        { "Retry-After": String(retryAfter) },
      );
    }
    await recordDeveloperRequest({ ...developerAuth, endpoint: config.endpoint, requestId, status: 502, responseMs: Date.now() - requestStartedAt });
    return loggedError(
      config,
      `Eidren couldn't load this ${config.resourceLabel} right now. Please retry shortly.`,
      502,
      "SERVICE_UNAVAILABLE",
      requestId,
      requestStartedAt,
      "upstream_error",
    );
  }

  async function POST(request: NextRequest) {
    if (config.identifierKey) {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        const requestId = randomUUID();
        return loggedError(config, "Request body must be valid JSON.", 400, "INVALID_JSON", requestId, Date.now(), "invalid_input");
      }
      if (!body || typeof body !== "object") {
        const requestId = randomUUID();
        return loggedError(config, "Send the resource identifier as a string.", 400, "INVALID_INPUT", requestId, Date.now(), "invalid_input");
      }
      const identifier = identifierFrom((body as Record<string, unknown>)[config.identifierKey]);
      if (!identifier) {
        const requestId = randomUUID();
        return loggedError(
          config,
          `Enter a valid ${config.resourceLabel} identifier (for example ${config.identifierExample ?? "..."}).`,
          400,
          "INVALID_INPUT",
          requestId,
          Date.now(),
          "invalid_input",
        );
      }
      return runLookup(request, identifier);
    }
    return runLookup(request, "");
  }

  async function GET(request: NextRequest) {
    const url = new URL(request.url);
    if (config.identifierKey && !url.searchParams.has(config.identifierKey)) {
      return NextResponse.json(
        {
          success: true,
          status: "online",
          message: "This endpoint is an API. Authenticate with an Eidren API key (Authorization: Bearer eid_...).",
          auth: "Required. Create a key in the console after signing up.",
          methods: ["GET", "POST"],
          getExample: `${config.endpoint}?${config.identifierKey}=${encodeURIComponent(config.identifierExample ?? "")}`,
          postExample: {
            url: config.endpoint,
            method: "POST",
            body: { [config.identifierKey]: config.identifierExample ?? "" },
          },
          note: "Meta data is served by the Eidren identity network.",
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (config.identifierKey) {
      return runLookup(request, url.searchParams.get(config.identifierKey) ?? "");
    }
    return runLookup(request, "");
  }

  return { POST, GET };
}
