import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CODASHOP_ENDPOINT = "https://order-sg.codashop.com/initPayment.action";
const PLAYER_ID_PATTERN = /^\d{4,20}$/;
const ZONE_ID_PATTERN = /^\d{1,10}$/;

function jsonError(message: string, status: number, code: string) {
  return NextResponse.json(
    { success: false, error: message, code },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Uses Codashop's account-validation flow to resolve a real nickname.
 * This is not an official Moonton API and its upstream contract can change.
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

  const form = new URLSearchParams({
    "voucherPricePoint.id": "4150",
    "voucherPricePoint.price": "1579.0",
    "voucherPricePoint.variablePrice": "0",
    "user.userId": playerId,
    "user.zoneId": zoneId,
    "voucherTypeName": "MOBILE_LEGENDS",
    "shopLang": "id_ID",
    "voucherTypeId": "1",
    "gvtId": "1",
  });

  try {
    const upstream = await fetch(CODASHOP_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        Origin: "https://www.codashop.com",
        Referer: "https://www.codashop.com/",
        "User-Agent": "Mozilla/5.0 (compatible; NexusMLBBLookup/1.0)",
      },
      body: form.toString(),
      cache: "no-store",
      signal: AbortSignal.timeout(9000),
    });

    if (upstream.status === 429) {
      return jsonError("Account validation is rate-limited upstream. Try again shortly.", 429, "UPSTREAM_RATE_LIMIT");
    }
    if (!upstream.ok) {
      return jsonError("Account validation is temporarily unavailable.", 502, "UPSTREAM_UNAVAILABLE");
    }

    let payload: unknown;
    try {
      payload = await upstream.json();
    } catch {
      return jsonError("The account-validation endpoint returned an unreadable response.", 502, "UPSTREAM_BAD_RESPONSE");
    }

    if (!payload || typeof payload !== "object") {
      return jsonError("The account-validation endpoint returned an unexpected response.", 502, "UPSTREAM_BAD_RESPONSE");
    }

    const response = payload as Record<string, unknown>;
    if (response.success !== true) {
      return jsonError("No valid MLBB account was confirmed for that Player ID and Zone ID.", 404, "PLAYER_NOT_FOUND");
    }

    const confirmation = response.confirmationFields && typeof response.confirmationFields === "object"
      ? response.confirmationFields as Record<string, unknown>
      : null;
    const nickname = confirmation && typeof confirmation.username === "string"
      ? confirmation.username.trim()
      : "";

    if (!nickname) {
      return jsonError("The upstream response did not include a verified nickname.", 502, "NICKNAME_MISSING");
    }

    return NextResponse.json(
      { success: true, data: { nickname, playerId, zoneId, source: "account_validation" } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return jsonError("Account validation timed out. Try again.", 504, "UPSTREAM_TIMEOUT");
    }
    return jsonError("Could not connect to the account-validation endpoint.", 502, "UPSTREAM_CONNECTION_FAILED");
  }
}
