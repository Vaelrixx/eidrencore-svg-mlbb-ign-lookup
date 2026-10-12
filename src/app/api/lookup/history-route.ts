import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { normalizeSupercellTag } from "./providers/supercell.mjs";
import type {
  BattlelogLookupAttempt,
  WarlogLookupAttempt,
} from "./providers/supercell-expansion.mjs";
import { logLookupSummary, observeProvider } from "./observability.mjs";
import { enforceLookupRateLimit, enforcePlaygroundLimit, persistLookupLog } from "./persistence.mjs";
import { getUserFromRequest, getUserFromSession, requireUser } from "@/lib/platform";
import { recordDeveloperRequest } from "@/lib/developer-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HistoryAttempt = BattlelogLookupAttempt | WarlogLookupAttempt;

export type HistoryLookupConfig = {
  /** URL path used in request logs, e.g. "/api/lookup/clash-royale/battles". */
  endpoint: string;
  /** Human label used in user-facing messages, e.g. "Clash Royale". */
  gameLabel: string;
  /** History noun used in user-facing messages: "battles" or "wars". */
  historyLabel: "battles" | "wars";
  /** Key holding the history list on a success attempt. */
  historyKey: "battles" | "wars";
  /** Tag example shown in validation errors, e.g. "#C0G20PR2". */
  tagExample: string;
  /** Provider label for telemetry, e.g. "clash_royale_official_api". */
  provider: string;
  /** Log source label, e.g. "clash_royale_official_api". */
  logSource: string;
  /** Error code when no provider confirms the tag, e.g. "CR_PLAYER_NOT_FOUND". */
  notFoundCode: string;
  /** Performs the upstream lookup; receives the normalized tag. */
  lookup: (tag: string) => Promise<HistoryAttempt>;
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
  config: HistoryLookupConfig,
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

function historyList(
  config: HistoryLookupConfig,
  confirmed: Extract<HistoryAttempt, { kind: "success" }>,
): Array<Record<string, string | number | string[] | null>> {
  if (config.historyKey === "battles" && "battles" in confirmed) return confirmed.battles;
  if (config.historyKey === "wars" && "wars" in confirmed) {
    return confirmed.wars as Array<Record<string, string | number | string[] | null>>;
  }
  return [];
}

function jsonSuccess(
  config: HistoryLookupConfig,
  confirmed: Extract<HistoryAttempt, { kind: "success" }>,
  tag: string,
  requestId: string,
) {
  const items = historyList(config, confirmed);
  return NextResponse.json(
    {
      success: true,
      data: {
        tag,
        [config.historyKey]: items,
        count: items.length,
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

function summaryAttempt(attempt: HistoryAttempt) {
  if (attempt.kind === "success") {
    return { kind: "success" as const, nickname: "", source: "" };
  }
  return attempt;
}

/**
 * Shared handler for battle/war history lookups. Mirrors the player route's
 * auth, quota, telemetry, and error contract, but returns a bounded history
 * list instead of a single nickname.
 */
export function createHistoryLookupHandler(config: HistoryLookupConfig) {
  async function POST(request: NextRequest) {
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

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return loggedError(config, "Request body must be valid JSON.", 400, "INVALID_JSON", requestId, requestStartedAt, "invalid_input");
    }

    if (!body || typeof body !== "object") {
      return loggedError(config, "Send tag as a string.", 400, "INVALID_INPUT", requestId, requestStartedAt, "invalid_input");
    }

    const input = body as Record<string, unknown>;
    const rawTag = typeof input.tag === "string" ? input.tag : "";
    const tag = normalizeSupercellTag(rawTag);
    if (!tag) {
      return loggedError(
        config,
        `Enter a valid ${config.gameLabel} player tag (for example ${config.tagExample}).`,
        400,
        "INVALID_TAG",
        requestId,
        requestStartedAt,
        "invalid_input",
      );
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
      lookup: () => config.lookup(tag),
    });
    const summary = summaryAttempt(attempt);
    logLookupSummary({
      requestId,
      durationMs: Date.now() - lookupStartedAt,
      primary: summary,
      fallbacks: [],
      confirmed: summary.kind === "success" ? summary : null,
      pendingFallbacks: 0,
    });

    if (attempt.kind === "success") {
      await recordDeveloperRequest({ ...developerAuth, endpoint: config.endpoint, requestId, status: 200, responseMs: Date.now() - requestStartedAt });
      void persistLookupLog({
        status: "success",
        responseMs: Date.now() - requestStartedAt,
        source: config.logSource,
      });
      return jsonSuccess(config, attempt, tag, requestId);
    }

    if (attempt.kind === "not_found") {
      await recordDeveloperRequest({ ...developerAuth, endpoint: config.endpoint, requestId, status: 404, responseMs: Date.now() - requestStartedAt });
      return loggedError(
        config,
        `No recent ${config.historyLabel} were found for that ${config.gameLabel} tag.`,
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
        `The ${config.gameLabel} provider is rate-limiting requests. Try again shortly.`,
        429,
        "UPSTREAM_RATE_LIMIT",
        requestId,
        requestStartedAt,
        "rate_limited",
        { "Retry-After": String(retryAfter) },
      );
    }

    if (attempt.diagnostic?.reason === "missing_config") {
      await recordDeveloperRequest({ ...developerAuth, endpoint: config.endpoint, requestId, status: 503, responseMs: Date.now() - requestStartedAt });
      return loggedError(
        config,
        `The ${config.gameLabel} lookup is not configured yet. Please try again later.`,
        503,
        "GAME_NOT_CONFIGURED",
        requestId,
        requestStartedAt,
        "upstream_error",
      );
    }

    await recordDeveloperRequest({ ...developerAuth, endpoint: config.endpoint, requestId, status: 502, responseMs: Date.now() - requestStartedAt });
    return loggedError(
      config,
      `We couldn't verify this tag right now because the ${config.gameLabel} provider is unavailable. Please retry shortly.`,
      502,
      "UPSTREAM_UNAVAILABLE",
      requestId,
      requestStartedAt,
      "upstream_error",
    );
  }

  async function GET(request: NextRequest) {
    const url = new URL(request.url);
    if (!url.searchParams.has("tag")) {
      return NextResponse.json(
        {
          success: true,
          service: `Eidren ${config.gameLabel} ${config.historyLabel === "wars" ? "War Log" : "Battlelog"} API`,
          status: "online",
          message: "This endpoint is an API. Authenticate with an Eidren API key (Authorization: Bearer eid_...).",
          auth: "Required. Create a key in the console after signing up.",
          methods: ["GET", "POST"],
          getExample: `${config.endpoint}?tag=${encodeURIComponent(config.tagExample)}`,
          postExample: {
            url: config.endpoint,
            method: "POST",
            body: { tag: config.tagExample },
          },
          note: `Recent ${config.historyLabel} depend on the official game provider and its availability.`,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const body = JSON.stringify({ tag: url.searchParams.get("tag") ?? "" });
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

  return { POST, GET };
}
