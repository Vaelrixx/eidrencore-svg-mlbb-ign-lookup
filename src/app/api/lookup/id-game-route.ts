import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { RapidApiGameAttempt } from "./providers/rapidapi-games.mjs";
import { logLookupSummary, observeProvider } from "./observability.mjs";
import { enforceLookupRateLimit, enforcePlaygroundLimit, persistLookupLog } from "./persistence.mjs";
import { parseBoundedJson, RequestBodyTooLargeError } from "./limited-json.mjs";
import { ledgerPlayerKey, readIdentityLedger, recordIdentityLedgerHit, writeIdentityLedger } from "./identity-ledger.mjs";
import { getUserFromRequest, getUserFromSession, requireUser } from "@/lib/platform";
import { recordDeveloperRequest } from "@/lib/developer-events";

export type IdentityFieldConfig = {
  key: string;
  label: string;
  example: string;
  minLength: number;
  maxLength: number;
  pattern: RegExp;
};

export type IdGameLookupConfig = {
  endpoint: string;
  gameLabel: string;
  publicSource: string;
  notFoundCode: string;
  fields: readonly IdentityFieldConfig[];
  internalProvider: string;
  lookup: (input: Record<string, string>) => Promise<RapidApiGameAttempt>;
};

function errorResponse(message: string, status: number, code: string, requestId?: string, extraHeaders: Record<string, string> = {}) {
  return NextResponse.json({ success: false, error: message, code }, {
    status,
    headers: { "Cache-Control": "no-store", ...(requestId ? { "X-Lookup-Request-Id": requestId } : {}), ...extraHeaders },
  });
}

async function loggedError(
  config: IdGameLookupConfig,
  message: string,
  status: number,
  code: string,
  requestId: string,
  startedAt: number,
  logStatus: "invalid_input" | "not_found" | "upstream_error" | "rate_limited",
  extraHeaders: Record<string, string> = {},
  failureReason?: string,
) {
  void persistLookupLog({ status: logStatus, responseMs: Date.now() - startedAt, source: config.publicSource, failureReason });
  return errorResponse(message, status, code, requestId, extraHeaders);
}

export function createIdGameLookupHandler(config: IdGameLookupConfig) {
  async function POST(request: NextRequest) {
    const requestId = randomUUID();
    const requestStartedAt = Date.now();
    const rateLimit = await enforceLookupRateLimit(request);
    if (!rateLimit.allowed) {
      return loggedError(config, "Too many lookup requests. Please wait before trying again.", 429, "RATE_LIMITED", requestId, requestStartedAt, "rate_limited", {
        "Retry-After": String(Math.max(1, rateLimit.retryAfterSeconds)),
      });
    }

    const usesApiKey = (request.headers.get("authorization") || "").startsWith("Bearer eid_");
    let sessionUserId: string | null = null;
    if (!usesApiKey) {
      const { user } = await requireUser().catch(() => ({ user: null }));
      if (!user) {
        return errorResponse("Sign in or create an API key to run lookups.", 401, "AUTH_REQUIRED", requestId, {
          "WWW-Authenticate": 'Bearer realm="eidren"',
        });
      }
      sessionUserId = user.id;
    }

    let rawBody: unknown;
    try {
      rawBody = await parseBoundedJson(request, 4096);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return loggedError(config, "Request body is too large.", 413, "PAYLOAD_TOO_LARGE", requestId, requestStartedAt, "invalid_input");
      }
      return loggedError(config, "Request body must be valid JSON.", 400, "INVALID_JSON", requestId, requestStartedAt, "invalid_input");
    }
    if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
      return loggedError(config, "Send the required player identity fields as strings.", 400, "INVALID_INPUT", requestId, requestStartedAt, "invalid_input");
    }

    const body = rawBody as Record<string, unknown>;
    // Keep IDs as strings end to end; Number coercion can corrupt 20-digit IDs.
    const input: Record<string, string> = {};
    for (const field of config.fields) {
      const value = typeof body[field.key] === "string" ? (body[field.key] as string).trim() : "";
      if (value.length < field.minLength || value.length > field.maxLength || !field.pattern.test(value)) {
        const example = config.fields.map((item) => `${item.key}: "${item.example}"`).join(", ");
        return loggedError(config, `Enter valid ${config.gameLabel} lookup fields (${example}).`, 400, "INVALID_INPUT", requestId, requestStartedAt, "invalid_input");
      }
      input[field.key] = value;
    }

    let developerAuth: { userId: string; apiKeyId: string; workspaceId: string | null };
    if (sessionUserId) {
      const playground = await enforcePlaygroundLimit(sessionUserId);
      if (!playground.allowed) {
        return errorResponse("Daily playground limit reached. Create an API key to keep integrating.", 429, "PLAYGROUND_LIMIT", requestId, {
          "Retry-After": String(Math.max(1, playground.retryAfterSeconds)),
        });
      }
      const sessionAuth = await getUserFromSession(sessionUserId);
      if (!sessionAuth || "error" in sessionAuth) {
        const status = sessionAuth && typeof sessionAuth.status === "number" ? sessionAuth.status : 503;
        return errorResponse(
          status === 429 ? "Monthly request quota reached. Upgrade your plan to continue." : "Playground is temporarily unavailable.",
          status,
          status === 429 ? "API_QUOTA_EXCEEDED" : "QUOTA_UNAVAILABLE",
          requestId,
        );
      }
      developerAuth = { userId: sessionAuth.userId, apiKeyId: sessionAuth.keyId, workspaceId: sessionAuth.workspaceId };
    } else {
      const keyAuth = await getUserFromRequest(request);
      if (!keyAuth) return errorResponse("Invalid API key.", 401, "INVALID_API_KEY", requestId);
      if ("error" in keyAuth) {
        const status = typeof keyAuth.status === "number" ? keyAuth.status : 401;
        const code = status === 429 ? "API_QUOTA_EXCEEDED" : status === 503 ? "QUOTA_UNAVAILABLE" : "INVALID_API_KEY";
        return errorResponse(typeof keyAuth.error === "string" ? keyAuth.error : "API key rejected.", status, code, requestId);
      }
      developerAuth = { userId: keyAuth.userId, apiKeyId: keyAuth.keyId, workspaceId: keyAuth.workspaceId };
    }

    const lookupStartedAt = Date.now();
    // Owned answer layer: serve repeat identities from our ledger before
    // touching any upstream. Misses fall through to the provider chain.
    const playerKey = ledgerPlayerKey(input);
    const ledgerHit = await readIdentityLedger(config.publicSource, playerKey);
    if (ledgerHit) {
      await recordDeveloperRequest({ ...developerAuth, endpoint: config.endpoint, requestId, status: 200, responseMs: Date.now() - requestStartedAt });
      void persistLookupLog({ status: "success", responseMs: Date.now() - requestStartedAt, source: "eidren_identity_ledger" });
      void recordIdentityLedgerHit(config.publicSource, playerKey);
      return NextResponse.json({
        success: true,
        data: { nickname: ledgerHit.nickname, ...input, source: config.publicSource },
        meta: { servedFrom: "eidren_identity_ledger" },
      }, { headers: { "Cache-Control": "no-store", "X-Lookup-Request-Id": requestId } });
    }
    const attempt = await observeProvider({
      requestId,
      provider: config.internalProvider,
      lookup: () => config.lookup(input),
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
      void persistLookupLog({ status: "success", responseMs: Date.now() - requestStartedAt, source: config.publicSource });
      void writeIdentityLedger(config.publicSource, playerKey, attempt.nickname, config.publicSource);
      return NextResponse.json({
        success: true,
        data: { nickname: attempt.nickname, ...input, source: config.publicSource },
      }, { headers: { "Cache-Control": "no-store", "X-Lookup-Request-Id": requestId } });
    }

    if (attempt.kind === "not_found") {
      await recordDeveloperRequest({ ...developerAuth, endpoint: config.endpoint, requestId, status: 404, responseMs: Date.now() - requestStartedAt });
      return loggedError(config, `No ${config.gameLabel} account was found for those lookup details.`, 404, config.notFoundCode, requestId, requestStartedAt, "not_found", {}, attempt.diagnostic?.reason);
    }
    if (attempt.kind === "rate_limited") {
      await recordDeveloperRequest({ ...developerAuth, endpoint: config.endpoint, requestId, status: 429, responseMs: Date.now() - requestStartedAt });
      return loggedError(config, `Eidren is rate-limiting ${config.gameLabel} requests right now. Try again shortly.`, 429, "SERVICE_RATE_LIMIT", requestId, requestStartedAt, "rate_limited", { "Retry-After": "30" }, attempt.diagnostic?.reason);
    }

    await recordDeveloperRequest({ ...developerAuth, endpoint: config.endpoint, requestId, status: 502, responseMs: Date.now() - requestStartedAt });
    return loggedError(config, `Eidren couldn't verify this ${config.gameLabel} identity right now. Please retry shortly.`, 502, "SERVICE_UNAVAILABLE", requestId, requestStartedAt, "upstream_error", {}, attempt.diagnostic?.reason);
  }

  async function GET() {
    const example = Object.fromEntries(config.fields.map((field) => [field.key, field.example]));
    return NextResponse.json({
      success: true,
      service: `Eidren ${config.gameLabel} Lookup API`,
      status: "online",
      message: "This endpoint is an API. Authenticate with an Eidren API key (Authorization: Bearer eid_...).",
      auth: "Required. Create a key in the console after signing up.",
      methods: ["POST"],
      postExample: { url: config.endpoint, method: "POST", body: example },
      note: "Nickname lookup is served by the Eidren identity network.",
    }, { headers: { "Cache-Control": "no-store" } });
  }

  return { POST, GET };
}
