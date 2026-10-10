import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { cleanNickname, confirmedNickname, isUsableNickname } from "./nickname-validation.mjs";
import { resolveLookupWithFallbacks } from "./resolve-lookup.mjs";
import { lookupIsan } from "./providers/isan.mjs";
import { logLookupSummary, observeProvider } from "./observability.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOOKUP_ENDPOINT = "https://mlbb-api.isan.eu.org/find";
const CODASHOP_ENDPOINT = "https://order-sg.codashop.com/initPayment.action";
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

function jsonError(message: string, status: number, code: string) {
  return NextResponse.json(
    { success: false, error: message, code },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function jsonSuccess(
  confirmed: Extract<LookupAttempt, { kind: "success" }>,
  playerId: string,
  zoneId: string,
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
    { headers: { "Cache-Control": "no-store" } },
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
 * Secondary provider: RapidAPI's ID Game Checker endpoint.
 * The API key is read only on the server and is never returned to callers.
 */
async function lookupRapidApi(playerId: string, zoneId: string): Promise<LookupAttempt> {
  const apiKey = process.env.RAPIDAPI_KEY?.trim() || process.env.RAPIDAPI_APP_TOKEN?.trim();
  if (!apiKey) return { kind: "unavailable", diagnostic: { reason: "missing_config" } };

  const endpoint =
    "https://id-game-checker.p.rapidapi.com/mlbb/" +
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

    if (upstream.status === 429) return { kind: "rate_limited", diagnostic: { reason: "http_error", statusCode: 429 } };
    if (upstream.status === 404 || upstream.status === 400) return { kind: "unavailable", diagnostic: { reason: "http_error", statusCode: upstream.status } };
    if (!upstream.ok) return { kind: "unavailable", diagnostic: { reason: "http_error", statusCode: upstream.status } };

    const payload: unknown = await upstream.json().catch(() => null);
    const nickname = confirmedNickname(payload);
    if (nickname) {
      return { kind: "success", nickname, source: "rapidapi_id_game_checker" };
    }
    if (explicitlyNotFound(payload)) return { kind: "not_found" };
    return { kind: "unavailable", diagnostic: { reason: "unrecognized_response", statusCode: upstream.status } };
  } catch {
    return { kind: "unavailable", diagnostic: { reason: "network_or_timeout" } };
  }
}

/**
 * EliteDias public role-check endpoint. Unofficial best-effort integration;
 * it never submits an order or payment.
 */
async function lookupEliteDias(playerId: string, zoneId: string): Promise<LookupAttempt> {
  try {
    const upstream = await fetch("https://api.elitedias.com/checkid", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json; charset=UTF-8",
        Origin: "https://elitedias.com",
        Referer: "https://elitedias.com/",
        "User-Agent": "Mozilla/5.0 (compatible; EidrenMLBBLookup/1.0)",
      },
      body: JSON.stringify({ userid: playerId, serverid: zoneId, game: "mlbb" }),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });

    if (upstream.status === 429) return { kind: "rate_limited", diagnostic: { reason: "http_error", statusCode: 429 } };
    if (upstream.status === 404 || upstream.status === 400) return { kind: "unavailable", diagnostic: { reason: "http_error", statusCode: upstream.status } };
    if (!upstream.ok) return { kind: "unavailable", diagnostic: { reason: "http_error", statusCode: upstream.status } };

    const payload: unknown = await upstream.json().catch(() => null);
    const nickname = confirmedNickname(payload);
    if (nickname) return { kind: "success", nickname, source: "elitedias_role_check" };
    if (explicitlyNotFound(payload)) return { kind: "not_found" };
    return { kind: "unavailable", diagnostic: { reason: "unrecognized_response", statusCode: upstream.status } };
  } catch {
    return { kind: "unavailable", diagnostic: { reason: "network_or_timeout" } };
  }
}

/** Smile.One public MLBB role-check endpoint. Best-effort only; no top-up. */
async function lookupSmileOne(playerId: string, zoneId: string): Promise<LookupAttempt> {
  const form = new URLSearchParams({
    user_id: playerId,
    zone_id: zoneId,
    pid: "216",
    checkrole: "1",
    pay_methond: "",
    channel_method: "",
  });

  try {
    const upstream = await fetch("https://www.smile.one/ph/merchant/mobilelegends/checkrole/", {
      method: "POST",
      headers: {
        Accept: "application/json, text/javascript, */*; q=0.01",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Origin: "https://www.smile.one",
        Referer: "https://www.smile.one/ph/merchant/mobilelegends?source=other",
        "User-Agent": "Mozilla/5.0 (compatible; EidrenMLBBLookup/1.0)",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: form.toString(),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });

    if (upstream.status === 429) return { kind: "rate_limited", diagnostic: { reason: "http_error", statusCode: 429 } };
    if (upstream.status === 404 || upstream.status === 400) return { kind: "unavailable", diagnostic: { reason: "http_error", statusCode: upstream.status } };
    if (!upstream.ok) return { kind: "unavailable", diagnostic: { reason: "http_error", statusCode: upstream.status } };

    const payload: unknown = await upstream.json().catch(() => null);
    const nickname = confirmedNickname(payload);
    if (nickname) return { kind: "success", nickname, source: "smileone_role_check" };
    if (explicitlyNotFound(payload)) return { kind: "not_found" };
    return { kind: "unavailable", diagnostic: { reason: "unrecognized_response", statusCode: upstream.status } };
  } catch {
    return { kind: "unavailable", diagnostic: { reason: "network_or_timeout" } };
  }
}

/** Dunia Games inquiry endpoint; only asks for identity/role confirmation. */
async function lookupDuniaGames(playerId: string, zoneId: string): Promise<LookupAttempt> {
  const form = new URLSearchParams({
    productId: "1",
    itemId: "2",
    catalogId: "57",
    paymentId: "352",
    gameId: playerId,
    zoneId,
    product_ref: "REG",
    product_ref_denom: "AE",
  });

  try {
    const upstream = await fetch("https://api.duniagames.co.id/api/transaction/v1/top-up/inquiry/store", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Origin: "https://www.duniagames.co.id",
        Referer: "https://www.duniagames.co.id/",
        "User-Agent": "Mozilla/5.0 (compatible; EidrenMLBBLookup/1.0)",
      },
      body: form.toString(),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });

    if (upstream.status === 429) return { kind: "rate_limited", diagnostic: { reason: "http_error", statusCode: 429 } };
    if (upstream.status === 404 || upstream.status === 400) return { kind: "unavailable", diagnostic: { reason: "http_error", statusCode: upstream.status } };
    if (!upstream.ok) return { kind: "unavailable", diagnostic: { reason: "http_error", statusCode: upstream.status } };

    const payload: unknown = await upstream.json().catch(() => null);
    const nickname = confirmedNickname(payload);
    if (nickname) return { kind: "success", nickname, source: "duniagames_role_check" };
    if (explicitlyNotFound(payload)) return { kind: "not_found" };
    return { kind: "unavailable", diagnostic: { reason: "unrecognized_response", statusCode: upstream.status } };
  } catch {
    return { kind: "unavailable", diagnostic: { reason: "network_or_timeout" } };
  }
}

/**
 * Codashop's public identity-validation/init flow. This does not submit a
 * payment. Its response parser uses the same strict placeholder guard.
 */
async function lookupCodashopFallback(playerId: string, zoneId: string): Promise<LookupAttempt> {
  const form = new URLSearchParams({
    "voucherPricePoint.id": "27684",
    "voucherPricePoint.price": "527250.0",
    "voucherPricePoint.variablePrice": "0",
    "user.userId": playerId,
    "user.zoneId": zoneId,
    voucherTypeName: "MOBILE_LEGENDS",
    lvtId: "",
    shopLang: "id_ID",
    dynamicSkuToken: "",
    pricePointDynamicSkuToken: "",
    voucherTypeId: "",
  });

  try {
    const upstream = await fetch(CODASHOP_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Origin: "https://www.codashop.com",
        Referer: "https://www.codashop.com/",
        "User-Agent": "Mozilla/5.0 (compatible; EidrenMLBBLookup/1.0)",
      },
      body: form.toString(),
      cache: "no-store",
      signal: AbortSignal.timeout(9000),
    });

    if (upstream.status === 429) return { kind: "rate_limited", diagnostic: { reason: "http_error", statusCode: 429 } };
    if (!upstream.ok) return { kind: "unavailable", diagnostic: { reason: "http_error", statusCode: upstream.status } };

    const payload: unknown = await upstream.json().catch(() => null);
    if (!payload || typeof payload !== "object") return { kind: "unavailable", diagnostic: { reason: "unrecognized_response", statusCode: upstream.status } };

    const data = payload as Record<string, unknown>;
    if (String(data.RESULT_CODE ?? "") === "10001") return { kind: "rate_limited", diagnostic: { reason: "provider_error", statusCode: upstream.status } };
    if (String(data.errorCode ?? "") === "-200") return { kind: "unavailable", diagnostic: { reason: "provider_error", statusCode: upstream.status } };

    // Provider error payloads are not proof that the player ID is absent.
    if (data.success !== true || Boolean(data.errorMsg)) {
      return explicitlyNotFound(payload) ? { kind: "not_found" } : { kind: "unavailable", diagnostic: { reason: "unrecognized_response", statusCode: upstream.status } };
    }

    const fields = record(data.confirmationFields);
    const rawName = fields && typeof fields.username === "string" ? fields.username : "";
    if (!isUsableNickname(rawName)) {
      return explicitlyNotFound(payload) ? { kind: "not_found" } : { kind: "unavailable", diagnostic: { reason: "unrecognized_response", statusCode: upstream.status } };
    }
    const nickname = cleanNickname(rawName);
    return { kind: "success", nickname, source: "codashop_fallback" };
  } catch {
    return { kind: "unavailable", diagnostic: { reason: "network_or_timeout" } };
  }
}

/**
 * Resolve an MLBB nickname without a password or game login. Provider
 * integrations are unofficial and may change or fail independently.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", 400, "INVALID_JSON");
  }

  if (!body || typeof body !== "object") {
    return jsonError("Send playerId and zoneId as strings.", 400, "INVALID_INPUT");
  }

  const input = body as Record<string, unknown>;
  const playerId = typeof input.playerId === "string" ? input.playerId.trim() : "";
  const zoneId = typeof input.zoneId === "string" ? input.zoneId.trim() : "";

  if (!PLAYER_ID_PATTERN.test(playerId) || !ZONE_ID_PATTERN.test(zoneId)) {
    return jsonError("Enter a numeric Player ID (4–20 digits) and Zone ID (1–10 digits).", 400, "INVALID_ID");
  }

  // Structured telemetry deliberately excludes player IDs, zone IDs, nicknames,
  // upstream payloads, headers, and credentials.
  const requestId = randomUUID();
  const lookupStartedAt = Date.now();

  // Primary-first lookup with deterministic, concurrent fallback takeover.
  // This orchestration is separately unit-tested with a simulated primary outage.
  const resolution = await resolveLookupWithFallbacks(
    () => observeProvider({
      requestId,
      provider: "isan_find",
      lookup: () => lookupPrimary(playerId, zoneId),
    }),
    [
      () => observeProvider({ requestId, provider: "rapidapi_id_game_checker", lookup: () => lookupRapidApi(playerId, zoneId) }),
      () => observeProvider({ requestId, provider: "isan_nickname_api", lookup: () => lookupIsan(playerId, zoneId) }),
      () => observeProvider({ requestId, provider: "elitedias_role_check", lookup: () => lookupEliteDias(playerId, zoneId) }),
      () => observeProvider({ requestId, provider: "smileone_role_check", lookup: () => lookupSmileOne(playerId, zoneId) }),
      () => observeProvider({ requestId, provider: "duniagames_role_check", lookup: () => lookupDuniaGames(playerId, zoneId) }),
      () => observeProvider({ requestId, provider: "codashop_fallback", lookup: () => lookupCodashopFallback(playerId, zoneId) }),
    ],
  );
  const { primary, fallbacks, confirmed } = resolution;
  logLookupSummary({
    requestId,
    durationMs: Date.now() - lookupStartedAt,
    primary,
    fallbacks,
    confirmed,
  });
  if (confirmed?.kind === "success") return jsonSuccess(confirmed, playerId, zoneId);
  const attempts: LookupAttempt[] = [primary, ...fallbacks];

  if (attempts.every((attempt) => attempt.kind === "not_found")) {
    return jsonError(
      "No provider found an MLBB account for that Player ID and Zone ID.",
      404,
      "PLAYER_NOT_FOUND",
    );
  }

  if (attempts.every((attempt) => attempt.kind === "rate_limited")) {
    return jsonError(
      "All lookup providers are rate-limiting requests. Try again shortly.",
      429,
      "UPSTREAM_RATE_LIMIT",
    );
  }

  return jsonError(
    "We couldn't verify this ID right now because lookup providers are unavailable. Please retry shortly.",
    502,
    "UPSTREAM_UNAVAILABLE",
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
        message: "This endpoint is an API, not a standalone lookup form.",
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
  const postRequest = new NextRequest(request.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  return POST(postRequest);
}
