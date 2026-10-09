import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOOKUP_ENDPOINT = "https://mlbb-api.isan.eu.org/find";
const PLAYER_ID_PATTERN = /^\d{4,20}$/;
const ZONE_ID_PATTERN = /^\d{1,10}$/;

function jsonError(message: string, status: number, code: string) {
  return NextResponse.json(
    { success: false, error: message, code },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Resolves an MLBB nickname through a public community-run lookup endpoint.
 * This is not an official Moonton API; the upstream service can change or rate-limit requests.
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

  const query = new URLSearchParams({ id: playerId, zone: zoneId });

  try {
    const upstream = await fetch(`${LOOKUP_ENDPOINT}?${query.toString()}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "NexusMLBBLookup/1.0",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(9000),
    });

    if (upstream.status === 429) {
      return jsonError("The lookup provider is rate-limiting requests. Try again shortly.", 429, "UPSTREAM_RATE_LIMIT");
    }
    if (upstream.status === 404) {
      return jsonError("No valid MLBB account was found for that Player ID and Zone ID.", 404, "PLAYER_NOT_FOUND");
    }
    if (!upstream.ok) {
      return jsonError("The lookup provider is temporarily unavailable. Try again shortly.", 502, "UPSTREAM_UNAVAILABLE");
    }

    let payload: unknown;
    try {
      payload = await upstream.json();
    } catch {
      return jsonError("The lookup provider returned an unreadable response.", 502, "UPSTREAM_BAD_RESPONSE");
    }

    if (!payload || typeof payload !== "object") {
      return jsonError("The lookup provider returned an unexpected response.", 502, "UPSTREAM_BAD_RESPONSE");
    }

    const response = payload as Record<string, unknown>;
    const nickname = typeof response.name === "string" ? response.name.trim() : "";

    if (response.success !== true || !nickname) {
      if (response.success === false || response.message === "Not found") {
        return jsonError("No valid MLBB account was found for that Player ID and Zone ID.", 404, "PLAYER_NOT_FOUND");
      }
      return jsonError("The lookup provider did not return a verified nickname.", 502, "NICKNAME_MISSING");
    }

    const country = typeof response.countryName === "string" ? response.countryName : undefined;

    return NextResponse.json(
      {
        success: true,
        data: {
          nickname,
          playerId,
          zoneId,
          ...(country ? { country } : {}),
          source: "mlbb_account_lookup",
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return jsonError("Account validation timed out. Try again.", 504, "UPSTREAM_TIMEOUT");
    }
    return jsonError("Could not connect to the lookup provider.", 502, "UPSTREAM_CONNECTION_FAILED");
  }
}
