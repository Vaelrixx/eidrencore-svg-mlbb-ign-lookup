/**
 * Self-reliant nickname lookup via the CodaShop store's own validation
 * endpoint — no third-party aggregator, no API key.
 *
 * Reverse-engineered from the store's public Nuxt frontend (verified live
 * 2026-10-17):
 * - `POST https://order-{REGION}.codashop.com/validate`
 *   `{country, voucherTypeName, whiteLabelId, deviceId, userId, zoneId}`
 * - valid MLBB → 200 `{result:{username:"Outrageous+Dominance",...}}`
 *   (plus-encoded; decode `+` → space)
 * - bogus user → 200 `{success:false,errorCode:"1003",errorMsg:"1003: Error_Role_Null"}`
 * - bogus zone → 200 `{success:false,errorCode:"-100",errorMsg:"-100: Error_InvalidZoneId"}`
 *
 * Only games verified live with distinct valid/bogus responses are enabled
 * (see CODASHOP_GAMES). Other games stay disabled until their voucher name +
 * response shape are confirmed with real samples — never shipped on guess.
 *
 * CODM uses a white-label voucher (shape via Harry260/codm-api, MIT) with a
 * country-redirect dance: a -200 error names the account's home country and
 * the lookup retries once there. Nickname/shortId input only — long numeric
 * UIDs are rejected upstream with "UID invalid".
 *
 * Privacy: never logs or returns IDs, nicknames, payloads, URLs, headers.
 * Only LookupAttempt shapes leave here.
 */

import { confirmedNickname } from "../nickname-validation.mjs";

const REQUEST_TIMEOUT_MS = 8000;
const DEFAULT_REGION = "sg";
const REDIRECT_CODE = "-200";

/**
 * Verified game table. Each entry needs: voucherTypeName from the game's
 * store page (`vouchertypename=` attribute), the country to validate as,
 * and whether a zoneId is required. White-label games set whiteLabelId and
 * follow one country redirect when the account lives elsewhere.
 */
export const CODASHOP_GAMES = Object.freeze({
  "mobile-legends": Object.freeze({
    voucherTypeName: "9177-MOBILE_LEGENDS",
    country: "PH",
    requiresZone: true,
    source: "codashop_direct",
  }),
  "call-of-duty-mobile": Object.freeze({
    voucherTypeName: "CALL_OF_DUTY_MOBILE_WL",
    whiteLabelId: "1",
    country: "IN",
    requiresZone: false,
    followCountryRedirect: true,
    source: "codashop_direct",
  }),
  // Bogus-only live probe confirmed the -100 "Invalid PID" gate on SG+US;
  // keep disabled until one consenting valid PID proves nickname success.
  "teen-patti-gold": Object.freeze({
    voucherTypeName: "TEEN_PATTI",
    country: "SG",
    requiresZone: false,
    enabledEnv: "CODASHOP_TEEN_PATTI_ENABLED",
    source: "codashop_direct",
  }),
});

const NOT_FOUND_CODE_PATTERN = /^(1003|-100)$/;
const NOT_FOUND_MESSAGE_PATTERN = /(Error_Role_Null|Error_InvalidZoneId|No openId for nickname|UID invalid|not\s*found|unknown\s*(user|player)|invalid\s*(user|player|id|zone))/i;

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function baseFor(env = process.env) {
  const region = (env.CODASHOP_REGION?.trim() || DEFAULT_REGION).toLowerCase().replace(/[^a-z]/g, "") || DEFAULT_REGION;
  return `https://order-${region}.codashop.com`;
}

function deviceIdFor(env = process.env) {
  return env.CODASHOP_DEVICE_ID?.trim() || "eidren-server-001";
}

export function classifyCodashopResponse(httpStatus, payload) {
  const root = record(payload);
  if (httpStatus === 429) {
    return { kind: "rate_limited", diagnostic: { reason: "http_error", statusCode: 429 } };
  }
  if (!Number.isInteger(httpStatus) || httpStatus < 200 || httpStatus >= 300) {
    return { kind: "unavailable", diagnostic: { reason: "http_error", statusCode: httpStatus } };
  }
  if (!root) {
    return { kind: "unavailable", diagnostic: { reason: "unrecognized_response", statusCode: httpStatus } };
  }
  const result = record(root.result);
  // MLBB answers username; the CODM white-label answers nickname.
  const rawName = result ? (result.username ?? result.nickname) : null;
  if (typeof rawName === "string" && rawName.trim()) {
    const nickname = confirmedNickname({ name: rawName });
    if (nickname) return { kind: "success", nickname, source: "codashop_direct" };
  }
  if (root.success === false) {
    const code = String(root.errorCode ?? "").trim();
    const message = typeof root.errorMsg === "string" ? root.errorMsg : "";
    // Country redirect (CODM white-label): the account lives in another
    // store country. Surfaced so the lookup can retry once there.
    if (code === REDIRECT_CODE && typeof root.homeBaseCountry2Name === "string" && /^[A-Z]{2}$/.test(root.homeBaseCountry2Name.trim())) {
      return { kind: "unavailable", diagnostic: { reason: "country_redirect", redirectCountry: root.homeBaseCountry2Name.trim() } };
    }
    if (NOT_FOUND_CODE_PATTERN.test(code) || NOT_FOUND_MESSAGE_PATTERN.test(message)) {
      return { kind: "not_found" };
    }
    return { kind: "unavailable", diagnostic: { reason: "http_error", statusCode: httpStatus } };
  }
  return { kind: "unavailable", diagnostic: { reason: "unrecognized_response", statusCode: httpStatus } };
}

/**
 * Look up a nickname via CodaShop direct validation. IDs stay strings.
 * Returns provider_error for unknown/unverified games.
 * White-label games with followCountryRedirect retry once in the account's
 * home country when the store answers -200.
 */
export async function lookupCodashopDirect(game, playerId, zoneId = "", {
  fetchImpl = fetch,
  env = process.env,
} = {}) {
  const config = CODASHOP_GAMES[game];
  if (!config) {
    return { kind: "unavailable", diagnostic: { reason: "provider_error" } };
  }
  if (config.enabledEnv && env[config.enabledEnv] !== "true") {
    return { kind: "unavailable", diagnostic: { reason: "feature_disabled" } };
  }
  if (typeof playerId !== "string" || !playerId.trim()) {
    return { kind: "unavailable", diagnostic: { reason: "provider_error" } };
  }
  if (config.requiresZone && (typeof zoneId !== "string" || !zoneId.trim())) {
    return { kind: "unavailable", diagnostic: { reason: "provider_error" } };
  }
  async function attempt(country) {
    const body = {
      country,
      voucherTypeName: config.voucherTypeName,
      whiteLabelId: config.whiteLabelId ?? "",
      deviceId: deviceIdFor(env),
      userId: playerId.trim(),
      zoneId: config.requiresZone ? zoneId.trim() : "",
    };
    try {
      const upstream = await fetchImpl(`${baseFor(env)}/validate`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; EidrenIdentityLookup/1.0)",
        },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const payload = await upstream.json().catch(() => null);
      return classifyCodashopResponse(upstream.status, payload);
    } catch {
      return { kind: "unavailable", diagnostic: { reason: "network_or_timeout" } };
    }
  }
  const first = await attempt(config.country);
  // One redirect max: a second -200 degrades rather than looping.
  if (config.followCountryRedirect && first.kind === "unavailable" && first.diagnostic?.reason === "country_redirect" && first.diagnostic.redirectCountry !== config.country) {
    return attempt(first.diagnostic.redirectCountry);
  }
  if (first.kind === "unavailable" && first.diagnostic?.reason === "country_redirect") {
    return { kind: "unavailable", diagnostic: { reason: "unrecognized_response" } };
  }
  return first;
}
