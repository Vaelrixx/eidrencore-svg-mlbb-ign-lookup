import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOOKUP_ENDPOINT = "https://mlbb-api.isan.eu.org/find";
const CODASHOP_ENDPOINT = "https://order-sg.codashop.com/initPayment.action";
const PLAYER_ID_PATTERN = /^\d{4,20}$/;
const ZONE_ID_PATTERN = /^\d{1,10}$/;

type LookupAttempt =
  | { kind: "success"; nickname: string; country?: string; source: string }
  | { kind: "not_found" }
  | { kind: "rate_limited" }
  | { kind: "unavailable" };

function jsonError(message: string, status: number, code: string) {
  return NextResponse.json(
    { success: false, error: message, code },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function cleanNickname(value: string) {
  const normalized = value.replaceAll("+", "%20");
  try {
    return decodeURIComponent(normalized).trim();
  } catch {
    return value.trim();
  }
}

const GENERIC_NICKNAMES = new Set([
  "null", "undefined", "not found", "invalid id", "invalid user",
  "invalid player", "unknown", "unknown user", "error", "success",
  "ok", "true", "false", "n/a", "none",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringField(source: Record<string, unknown> | null, keys: string[]): string {
  if (!source) return "";
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function confirmedNickname(payload: unknown): string {
  const root = record(payload);
  if (!root) return "";

  // Error-shaped responses must never be mistaken for a player's nickname.
  const data = record(root.data);
  if (
    root.success === false ||
    root.error === true ||
    root.status === false ||
    root.valid === false ||
    data?.valid === false
  ) return "";
  const result = record(root.result);
  const nested = record(data?.data);
  const candidates = [root, data, result, nested];

  for (const candidate of candidates) {
    const value = stringField(candidate, [
      "username", "nickname", "name", "ign", "gameName", "playerName", "roleName",
    ]);
    if (!value) continue;
    const cleaned = cleanNickname(value);
    if (
      cleaned.length > 0 &&
      cleaned.length <= 64 &&
      !GENERIC_NICKNAMES.has(cleaned.toLowerCase()) &&
      !/^(error|failed|invalid|not found)\b/i.test(cleaned)
    ) return cleaned;
  }
  return "";
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

    if (upstream.status === 429) return { kind: "rate_limited" };
    if (upstream.status === 404) return { kind: "not_found" };
    if (!upstream.ok) return { kind: "unavailable" };

    const payload: unknown = await upstream.json().catch(() => null);
    if (!payload || typeof payload !== "object") return { kind: "unavailable" };

    const data = payload as Record<string, unknown>;
    if (data.success !== true) {
      return data.success === false || data.message === "Not found"
        ? { kind: "not_found" }
        : { kind: "unavailable" };
    }

    const nickname = confirmedNickname(payload);
    if (!nickname) return { kind: "unavailable" };

    return {
      kind: "success",
      nickname,
      country: typeof data.countryName === "string" ? data.countryName : undefined,
      source: "community_lookup",
    };
  } catch {
    return { kind: "unavailable" };
  }
}

/**
 * Secondary provider: RapidAPI's ID Game Checker endpoint.
 * The API key is read only on the server and is never returned to callers.
 */
async function lookupRapidApi(playerId: string, zoneId: string): Promise<LookupAttempt> {
  const apiKey = process.env.RAPIDAPI_KEY?.trim() || process.env.RAPIDAPI_APP_TOKEN?.trim();
  if (!apiKey) return { kind: "unavailable" };

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

    if (upstream.status === 429) return { kind: "rate_limited" };
    if (upstream.status === 404 || upstream.status === 400) return { kind: "unavailable" };
    if (!upstream.ok) return { kind: "unavailable" };

    const payload: unknown = await upstream.json().catch(() => null);
    const nickname = confirmedNickname(payload);
    if (nickname) {
      return { kind: "success", nickname, source: "rapidapi_id_game_checker" };
    }
    if (explicitlyNotFound(payload)) return { kind: "not_found" };
    return { kind: "unavailable" };

  } catch {
    return { kind: "unavailable" };
  }
}

/**
 * Public community nickname endpoint. Kept as a separate host/path fallback in
 * case the primary community deployment is unavailable.
 */
async function lookupIsan(playerId: string, zoneId: string): Promise<LookupAttempt> {
  const query = new URLSearchParams({
    id: playerId,
    server: zoneId,
    decode: "false",
  });

  try {
    const upstream = await fetch(`https://api.isan.eu.org/nickname/ml?${query.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json", "User-Agent": "EidrenMLBBLookup/1.0" },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });

    if (upstream.status === 429) return { kind: "rate_limited" };
    if (upstream.status === 404 || upstream.status === 400) return { kind: "unavailable" };
    if (!upstream.ok) return { kind: "unavailable" };

    const payload: unknown = await upstream.json().catch(() => null);
    const data = record(payload);
    const nickname = confirmedNickname(payload);
    if (data?.success === true && nickname) {
      return { kind: "success", nickname, source: "isan_nickname_api" };
    }
    if (explicitlyNotFound(payload)) return { kind: "not_found" };
    return { kind: "unavailable" };

  } catch {
    return { kind: "unavailable" };
  }
}

/**
 * EliteDias public role-check endpoint. This is an unofficial integration and
 * is treated as best-effort; it never submits an order or payment.
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

    if (upstream.status === 429) return { kind: "rate_limited" };
    if (upstream.status === 404 || upstream.status === 400) return { kind: "unavailable" };
    if (!upstream.ok) return { kind: "unavailable" };

    const payload: unknown = await upstream.json().catch(() => null);
    const nickname = confirmedNickname(payload);
    if (nickname) return { kind: "success", nickname, source: "elitedias_role_check" };
    if (explicitlyNotFound(payload)) return { kind: "not_found" };
    return { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}

/**
 * Smile.One's public MLBB role-check endpoint. Best-effort only; no top-up is
 * submitted. It may change its request contract without notice.
 */
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

    if (upstream.status === 429) return { kind: "rate_limited" };
    if (upstream.status === 404 || upstream.status === 400) return { kind: "unavailable" };
    if (!upstream.ok) return { kind: "unavailable" };

    const payload: unknown = await upstream.json().catch(() => null);
    const nickname = confirmedNickname(payload);
    if (nickname) return { kind: "success", nickname, source: "smileone_role_check" };
    if (explicitlyNotFound(payload)) return { kind: "not_found" };
    return { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}

/**
 * Dunia Games inquiry endpoint. It is used only to ask for identity/role
 * confirmation, not to purchase anything.
 */
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

    if (upstream.status === 429) return { kind: "rate_limited" };
    if (upstream.status === 404 || upstream.status === 400) return { kind: "unavailable" };
    if (!upstream.ok) return { kind: "unavailable" };

    const payload: unknown = await upstream.json().catch(() => null);
    const nickname = confirmedNickname(payload);
    if (nickname) return { kind: "success", nickname, source: "duniagames_role_check" };
    if (explicitlyNotFound(payload)) return { kind: "not_found" };
    return { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}

/**
 * Fallback provider: Codashop's public initPayment identity-validation flow.
 * Parameters follow a published, reverse-engineered implementation. No payment
 * is submitted; this calls only the validation/init endpoint, not checkout.
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

    if (upstream.status === 429) return { kind: "rate_limited" };
    if (!upstream.ok) return { kind: "unavailable" };

    const payload: unknown = await upstream.json().catch(() => null);
    if (!payload || typeof payload !== "object") return { kind: "unavailable" };

    const data = payload as Record<string, unknown>;
    if (String(data.RESULT_CODE ?? "") === "10001") return { kind: "rate_limited" };
    if (String(data.errorCode ?? "") === "-200") return { kind: "unavailable" };

    if (data.success !== true || Boolean(data.errorMsg)) {
      return { kind: "not_found" };
    }

    const fields = record(data.confirmationFields);
    const rawName = fields && typeof fields.username === "string" ? fields.username : "";
    const nickname = cleanNickname(rawName);
    if (!nickname || GENERIC_NICKNAMES.has(nickname.toLowerCase())) return { kind: "not_found" };

    return { kind: "success", nickname, source: "codashop_fallback" };
  } catch {
    return { kind: "unavailable" };
  }
}

/**
 * Resolve an MLBB nickname without collecting a password or requiring a game login.
 * Providers are unofficial third-party integrations and may change or fail independently.
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

  // Query independent providers concurrently. A success must include a plausible
  // nickname from a recognized response field; an HTTP error alone never proves
  // that an account does not exist.
  const attempts = await Promise.all([
    lookupPrimary(playerId, zoneId),
    lookupRapidApi(playerId, zoneId),
    lookupIsan(playerId, zoneId),
    lookupEliteDias(playerId, zoneId),
    lookupSmileOne(playerId, zoneId),
    lookupDuniaGames(playerId, zoneId),
    lookupCodashopFallback(playerId, zoneId),
  ]);

  // Stable provider priority keeps results predictable when providers disagree.
  const confirmed = attempts.find((attempt) => attempt.kind === "success");
  if (confirmed && confirmed.kind === "success") {
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
        getExample: `${url.origin}/api/lookup?playerId=1114917746&zoneId=13486`,
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
