import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOOKUP_ENDPOINT = "https://mlbb-api.isan.eu.org/find";
const CODASHOP_ENDPOINT = "https://order-sg.codashop.com/initPayment.action";
const PLAYER_ID_PATTERN = /^\d{4,20}$/;
const ZONE_ID_PATTERN = /^\\d{1,10}$/;

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

/**
 * Primary provider: public community-run MLBB identity endpoint.
 * Its contract and availability are outside our control.
 */
async function lookupPrimary(playerId: string, zoneId: string): Promise<LookupAttempt> {
  const query = new URLSearchParams({ id: playerId, zone: zoneId });
  try {
    const upstream = await fetch(`${LOOKUP_ENDPOINT}?${query.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json", "User-Agent": "NexusMLBBLookup/1.0" },
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

    const rawName = typeof data.name === "string" ? data.name : "";
    const nickname = cleanNickname(rawName);
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
        "User-Agent": "Mozilla/5.0 (compatible; NexusMLBBLookup/1.0)",
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

    const fields = data.confirmationFields && typeof data.confirmationFields === "object"
      ? data.confirmationFields as Record<string, unknown>
      : null;
    const rawName = fields && typeof fields.username === "string" ? fields.username : "";
    const nickname = cleanNickname(rawName);
    if (!nickname) return { kind: "not_found" };

    return { kind: "success", nickname, source: "codashop_fallback" };
  } catch {
    return { kind: "unavailable" };
  }
}

/**
 * Resolve an MLBB nickname without collecting a password or requiring a game login.
 * Neither provider is an official Moonton API; upstream behaviour may change.
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

  // Only accept identity data when at least one upstream positively confirms a nickname.
  const primary = await lookupPrimary(playerId, zoneId);
  if (primary.kind === "success") {
    return NextResponse.json(
      {
        success: true,
        data: {
          nickname: primary.nickname,
          playerId,
          zoneId,
          ...(primary.country ? { country: primary.country } : {}),
          source: primary.source,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const fallback = await lookupCodashopFallback(playerId, zoneId);
  if (fallback.kind === "success") {
    return NextResponse.json(
      {
        success: true,
        data: {
          nickname: fallback.nickname,
          playerId,
          zoneId,
          source: fallback.source,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  if (primary.kind === "not_found" && fallback.kind === "not_found") {
    return jsonError("Neither provider found an MLBB account for that Player ID and Zone ID.", 404, "PLAYER_NOT_FOUND");
  }

  if (primary.kind === "rate_limited" && fallback.kind === "rate_limited") {
    return jsonError("Both lookup providers are rate-limiting requests. Try again shortly.", 429, "UPSTREAM_RATE_LIMIT");
  }

  return jsonError(
    "We couldn't verify this ID right now because a lookup provider is unavailable. Please retry shortly.",
    502,
    "UPSTREAM_UNAVAILABLE",
  );
}
