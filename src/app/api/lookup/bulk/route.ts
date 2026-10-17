import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { BULK_CONCURRENCY, BULK_GAMES, BULK_MAX_BYTES, BULK_MAX_ITEMS, bulkGameSlugs } from "../bulk-games.mjs";
import { logLookupSummary, observeProvider } from "../observability.mjs";
import { enforceLookupRateLimit, enforcePlaygroundLimit, persistLookupLog } from "../persistence.mjs";
import { parseBoundedJson, RequestBodyTooLargeError } from "../limited-json.mjs";
import { getUserFromRequest, getUserFromSession, requireUser } from "@/lib/platform";
import { emitDeveloperEvent, recordDeveloperRequest } from "@/lib/developer-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BulkItemInput = { game?: unknown; nickname?: unknown; [key: string]: unknown };
type BulkItemResult =
  | { index: number; game: string; status: "verified"; nickname: string; input: Record<string, string>; nicknameMatch: boolean | null; source: string }
  | { index: number; game: string; status: "not_found" | "invalid" | "unavailable" | "rate_limited"; code: string; error: string };

function jsonError(message: string, status: number, code: string, requestId: string, extraHeaders: Record<string, string> = {}) {
  return NextResponse.json(
    { success: false, error: message, code },
    { status, headers: { "Cache-Control": "no-store", "X-Lookup-Request-Id": requestId, ...extraHeaders } },
  );
}

async function resolveItem(game: string, raw: BulkItemInput, index: number, requestId: string): Promise<BulkItemResult> {
  const entry = BULK_GAMES[game as keyof typeof BULK_GAMES] as
    | { gameLabel: string; publicSource: string; notFoundCode: string; fields: Array<{ key: string; label: string; example: string }>; validate: (item: unknown) => Record<string, string> | null; lookup: (input: Record<string, string>) => Promise<{ kind: string; nickname?: string }> }
    | undefined;
  if (!entry) {
    return { index, game, status: "invalid", code: "UNKNOWN_GAME", error: `Unknown game "${game}". Supported games: ${bulkGameSlugs().join(", ")}.` };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { index, game, status: "invalid", code: "INVALID_INPUT", error: `Item ${index} must be an object with ${entry.gameLabel} lookup fields.` };
  }
  const input = entry.validate(raw);
  if (!input) {
    const example = entry.fields.map((field) => `${field.key}: "${field.example}"`).join(", ");
    return { index, game, status: "invalid", code: "INVALID_INPUT", error: `Item ${index} needs valid ${entry.gameLabel} lookup fields (${example}).` };
  }
  const claimed = typeof raw.nickname === "string" && raw.nickname.trim() ? raw.nickname.trim() : null;

  const lookupStartedAt = Date.now();
  const attempt = await observeProvider({
    requestId: `${requestId}:bulk:${index}`,
    provider: entry.publicSource,
    lookup: () => entry.lookup(input),
  }).catch(() => ({ kind: "unavailable" as const }));
  logLookupSummary({
    requestId: `${requestId}:bulk:${index}`,
    durationMs: Date.now() - lookupStartedAt,
    primary: attempt,
    fallbacks: [],
    confirmed: attempt.kind === "success" ? attempt : null,
    pendingFallbacks: 0,
  });

  if (attempt.kind === "success" && typeof attempt.nickname === "string") {
    void persistLookupLog({ status: "success", responseMs: Date.now() - lookupStartedAt, source: entry.publicSource });
    return {
      index, game, status: "verified", nickname: attempt.nickname, input,
      nicknameMatch: claimed === null ? null : claimed.toLowerCase() === attempt.nickname.toLowerCase(),
      source: entry.publicSource,
    };
  }
  if (attempt.kind === "not_found") {
    void persistLookupLog({ status: "not_found", responseMs: Date.now() - lookupStartedAt, source: entry.publicSource });
    return { index, game, status: "not_found", code: entry.notFoundCode, error: `No ${entry.gameLabel} account was found for item ${index}.` };
  }
  if (attempt.kind === "rate_limited") {
    void persistLookupLog({ status: "rate_limited", responseMs: Date.now() - lookupStartedAt, source: entry.publicSource });
    return { index, game, status: "rate_limited", code: "SERVICE_RATE_LIMIT", error: `Eidren is rate-limiting ${entry.gameLabel} requests right now. Retry item ${index} shortly.` };
  }
  void persistLookupLog({ status: "upstream_error", responseMs: Date.now() - lookupStartedAt, source: entry.publicSource });
  return { index, game, status: "unavailable", code: "SERVICE_UNAVAILABLE", error: `Eidren couldn't verify item ${index} (${entry.gameLabel}) right now. Please retry shortly.` };
}

async function resolveInPools(items: Array<{ game: string; raw: BulkItemInput; index: number }>, requestId: string): Promise<BulkItemResult[]> {
  const results: BulkItemResult[] = new Array(items.length);
  for (let start = 0; start < items.length; start += BULK_CONCURRENCY) {
    const pool = items.slice(start, start + BULK_CONCURRENCY);
    const settled = await Promise.all(pool.map((item) => resolveItem(item.game, item.raw, item.index, requestId)));
    for (let offset = 0; offset < settled.length; offset += 1) results[start + offset] = settled[offset];
  }
  return results;
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  const requestStartedAt = Date.now();

  const rateLimit = await enforceLookupRateLimit(request);
  if (!rateLimit.allowed) {
    return jsonError("Too many lookup requests. Please wait before trying again.", 429, "RATE_LIMITED", requestId, {
      "Retry-After": String(Math.max(1, rateLimit.retryAfterSeconds)),
    });
  }

  const usesApiKey = (request.headers.get("authorization") || "").startsWith("Bearer eid_");
  let sessionUserId: string | null = null;
  if (!usesApiKey) {
    const { user } = await requireUser().catch(() => ({ user: null }));
    if (!user) {
      return jsonError("Sign in or create an API key to run lookups.", 401, "AUTH_REQUIRED", requestId, {
        "WWW-Authenticate": 'Bearer realm="eidren"',
      });
    }
    sessionUserId = user.id;
  }

  let rawBody: unknown;
  try {
    rawBody = await parseBoundedJson(request, BULK_MAX_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return jsonError(`Request body is too large (max ${BULK_MAX_BYTES} bytes).`, 413, "PAYLOAD_TOO_LARGE", requestId);
    }
    return jsonError("Request body must be valid JSON.", 400, "INVALID_JSON", requestId);
  }
  const items = (rawBody as { items?: unknown } | null)?.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > BULK_MAX_ITEMS) {
    return jsonError(`Send items as an array of 1 to ${BULK_MAX_ITEMS} lookups.`, 400, "INVALID_INPUT", requestId);
  }
  const normalized = items.map((raw, index) => ({
    game: typeof (raw as BulkItemInput | null)?.game === "string" ? String((raw as BulkItemInput).game).trim().toLowerCase() : "",
    raw: (raw ?? {}) as BulkItemInput,
    index,
  }));

  let developerAuth: { userId: string; apiKeyId: string; workspaceId: string | null };
  if (sessionUserId) {
    const playground = await enforcePlaygroundLimit(sessionUserId);
    if (!playground.allowed) {
      return jsonError("Daily playground limit reached. Create an API key to keep integrating.", 429, "PLAYGROUND_LIMIT", requestId, {
        "Retry-After": String(Math.max(1, playground.retryAfterSeconds)),
      });
    }
    const sessionAuth = await getUserFromSession(sessionUserId, items.length);
    if (!sessionAuth || "error" in sessionAuth) {
      const status = sessionAuth && typeof sessionAuth.status === "number" ? sessionAuth.status : 503;
      return jsonError(
        status === 429 ? `Monthly request quota reached. This batch needs ${items.length} calls but fewer remain. Upgrade your plan to continue.` : "Playground is temporarily unavailable.",
        status,
        status === 429 ? "API_QUOTA_EXCEEDED" : "QUOTA_UNAVAILABLE",
        requestId,
      );
    }
    developerAuth = { userId: sessionAuth.userId, apiKeyId: sessionAuth.keyId, workspaceId: sessionAuth.workspaceId };
  } else {
    const keyAuth = await getUserFromRequest(request, items.length);
    if (!keyAuth) return jsonError("Invalid API key.", 401, "INVALID_API_KEY", requestId);
    if ("error" in keyAuth) {
      const status = typeof keyAuth.status === "number" ? keyAuth.status : 401;
      const code = status === 429 ? "API_QUOTA_EXCEEDED" : status === 503 ? "QUOTA_UNAVAILABLE" : "INVALID_API_KEY";
      const message = status === 429
        ? `Monthly request quota reached. This batch needs ${items.length} calls but fewer remain. Upgrade your plan to continue.`
        : typeof keyAuth.error === "string" ? keyAuth.error : "API key rejected.";
      return jsonError(message, status, code, requestId);
    }
    developerAuth = { userId: keyAuth.userId, apiKeyId: keyAuth.keyId, workspaceId: keyAuth.workspaceId };
  }

  const results = await resolveInPools(normalized, requestId);
  const summary = {
    total: results.length,
    verified: results.filter((result) => result.status === "verified").length,
    notFound: results.filter((result) => result.status === "not_found").length,
    invalid: results.filter((result) => result.status === "invalid").length,
    unavailable: results.filter((result) => result.status === "unavailable").length,
    rateLimited: results.filter((result) => result.status === "rate_limited").length,
  };

  await recordDeveloperRequest({ ...developerAuth, endpoint: "/api/lookup/bulk", requestId, status: 200, responseMs: Date.now() - requestStartedAt });
  void emitDeveloperEvent({
    userId: developerAuth.userId,
    workspaceId: developerAuth.workspaceId,
    type: "lookup.bulk.completed",
    data: { requestId, endpoint: "/api/lookup/bulk", summary, quotaUnits: items.length },
  });

  return NextResponse.json(
    { success: true, requestId, summary, results },
    { headers: { "Cache-Control": "no-store", "X-Lookup-Request-Id": requestId } },
  );
}

export async function GET() {
  const games = bulkGameSlugs();
  return NextResponse.json(
    {
      success: true,
      service: "Eidren Bulk Verification API",
      status: "online",
      message: "This endpoint is an API. Authenticate with an Eidren API key (Authorization: Bearer eid_...).",
      auth: "Required. Create a key in the console after signing up.",
      methods: ["POST"],
      limits: { maxItems: BULK_MAX_ITEMS, maxBytes: BULK_MAX_BYTES, quota: "Each item consumes one monthly quota unit." },
      games,
      postExample: {
        url: "/api/lookup/bulk",
        method: "POST",
        body: {
          items: [
            { game: "mlbb", playerId: "1114917746", zoneId: "13486", nickname: "claimed nickname (optional)" },
            { game: "free-fire", playerId: "1958604115" },
          ],
        },
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
