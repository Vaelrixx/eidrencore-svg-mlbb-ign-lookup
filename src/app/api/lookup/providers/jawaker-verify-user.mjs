import { confirmedNickname } from "../nickname-validation.mjs";

const JAWAKER_OFFERS_URL = "https://shop.jawaker.com/en/offers";
const JAWAKER_VERIFY_URL = "https://shop.jawaker.com/en/offers/verify_user";
const JAWAKER_USER_AGENT = "Mozilla/5.0 (compatible; EidrenMLBBLookup/1.0)";
const SESSION_TIMEOUT_MS = 7000;
const VERIFY_TIMEOUT_MS = 10000;

/**
 * Jawaker via the official webshop's own player-validation endpoint (the
 * same verify_user call the checkout page makes before selling tokens).
 * Contract reverse-engineered from the shop's public JS bundle and verified
 * live 2026-10-13 (re-verified at build time):
 * - GET /en/offers -> session cookie + <meta name="csrf-token"> (both keyless)
 * - POST /en/offers/verify_user {"player_number"} + cookie + X-CSRF-Token
 * - docs sample 1473084005 -> 200 {"user":{"login":"abdom6","level":54,...}}
 * - bogus 0000000001 -> HTTP 404, empty body (explicit not-found)
 * Read-only player check: no offer ID, no checkout, no purchase. Session or
 * CSRF failures degrade honestly (never false not-found). Nickname comes
 * from the raw user.login field.
 */
function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function responseKind(payload) {
  if (payload === null || payload === undefined) return "empty_or_non_json";
  if (typeof payload !== "object" || Array.isArray(payload)) return "empty_or_non_json";
  const root = record(payload);
  const user = record(root?.user);
  if (typeof user?.login === "string") return "jawaker_user_schema";
  return "other_json_object";
}

export function classifyJawakerVerifyResponse(httpStatus, payload) {
  if (httpStatus === 429) {
    return {
      kind: "rate_limited",
      diagnostic: { reason: "http_error", statusCode: 429, responseKind: responseKind(payload) },
    };
  }

  // Explicit not-found: the shop answers unknown player numbers with a bare
  // HTTP 404 (empty body). Gate strictly on the status.
  if (httpStatus === 404) {
    return { kind: "not_found" };
  }

  if (!Number.isInteger(httpStatus) || httpStatus < 200 || httpStatus >= 300) {
    return {
      kind: "unavailable",
      diagnostic: { reason: "http_error", statusCode: Number.isInteger(httpStatus) ? httpStatus : 502, responseKind: responseKind(payload) },
    };
  }

  const user = record(record(payload)?.user);
  if (user && typeof user.login === "string") {
    const nickname = confirmedNickname({ message: "Success", data: { username: user.login } });
    if (nickname) return { kind: "success", nickname, source: "jawaker_shop_validation" };
  }

  return {
    kind: "unavailable",
    diagnostic: {
      reason: "unrecognized_response",
      statusCode: httpStatus,
      responseKind: responseKind(payload),
    },
  };
}

function extractCsrfToken(html) {
  if (typeof html !== "string") return "";
  const match = html.match(/<meta\s+name="csrf-token"\s+content="([^"]+)"/i);
  return match ? match[1] : "";
}

function mergeCookies(stored, setCookieHeaders) {
  const jar = new Map(stored);
  for (const header of setCookieHeaders) {
    const pair = String(header).split(";")[0];
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  return jar;
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

export async function lookupJawakerVerifyUser(playerId, options = {}) {
  if (typeof playerId !== "string" || !/^\d{3,24}$/.test(playerId.trim())) {
    return { kind: "unavailable", diagnostic: { reason: "invalid_input" } };
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    // Leg 1: session cookie + CSRF token from the public offers page.
    const sessionRes = await fetchImpl(JAWAKER_OFFERS_URL, {
      method: "GET",
      headers: { Accept: "text/html", "User-Agent": JAWAKER_USER_AGENT },
      cache: "no-store",
      signal: AbortSignal.timeout(SESSION_TIMEOUT_MS),
    });
    if (!sessionRes.ok) {
      return { kind: "unavailable", diagnostic: { reason: "network_or_timeout", responseKind: "session_fetch_failed" } };
    }
    const jar = mergeCookies(new Map(), sessionRes.headers.getSetCookie?.() ?? []);
    const csrf = extractCsrfToken(await sessionRes.text().catch(() => ""));
    if (!csrf) {
      return { kind: "unavailable", diagnostic: { reason: "unrecognized_response", responseKind: "session_csrf_missing" } };
    }

    // Leg 2: read-only player check (no offer ID, no checkout).
    const upstream = await fetchImpl(JAWAKER_VERIFY_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": JAWAKER_USER_AGENT,
        "X-CSRF-Token": csrf,
        ...(jar.size ? { Cookie: cookieHeader(jar) } : {}),
      },
      body: JSON.stringify({ player_number: playerId.trim() }),
      cache: "no-store",
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    const text = await upstream.text().catch(() => "");
    const payload = text ? (() => { try { return JSON.parse(text); } catch { return null; } })() : null;
    return classifyJawakerVerifyResponse(upstream.status, payload);
  } catch {
    return { kind: "unavailable", diagnostic: { reason: "network_or_timeout" } };
  }
}
