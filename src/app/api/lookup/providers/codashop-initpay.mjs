/**
 * Self-reliant nickname lookup via the CodaShop store's own order-init
 * endpoint — no third-party aggregator, no API key.
 *
 * Some Coda-carried games do not answer the /validate endpoint (verified
 * live 2026-10-18: SUPER_SUS returns {} there) but validate through the
 * store's form-encoded initPayment flow, which the public top-up pages use
 * before payment. Contract verified live 2026-10-18:
 * - `POST https://order-sg.codashop.com/initPayment.action`
 *   form-encoded `voucherPricePoint.id/price/variablePrice + user.userId
 *   [+ user.zoneId] + voucherTypeName + shopLang`
 * - valid 8BP `12345` -> 200 `errorCode:""` + confirmationFields.username
 *   (URL-encoded masked nickname)
 * - bogus 8BP -> 200 `errorCode:"-100", errorMsg:"User Not Found"`
 * - Auto Chess bogus -> 200 `errorCode:"-100", errorMsg:"account info not found"`
 * - Azur Lane bogus -> 200 `errorCode:"-100", errorMsg:"User name not found"`
 *
 * Only games verified live with distinct valid/bogus responses are enabled
 * (see INITPAY_GAMES). Price-point IDs come from the game's public top-up
 * page; they select the cheapest denomination and no order is ever placed.
 * Nicknames arrive URL-encoded and masked by the store (e.g. B****t%20A);
 * decode but never unmask.
 *
 * Privacy: never logs or returns IDs, nicknames, payloads, URLs, headers.
 * Only LookupAttempt shapes leave here.
 */
import { confirmedNickname } from "../nickname-validation.mjs";
import { providerCache } from "./provider-cache.mjs";

const INITPAY_TIMEOUT_MS = 8000;
const INITPAY_CACHE_TTL_SECONDS = 300;

class TransientUpstreamError extends Error {
  constructor(attempt) {
    super("transient upstream outcome");
    this.attempt = attempt;
  }
}

/**
 * Verified game table. Each entry needs the voucherTypeName from the
 * game's store page plus a price-point id/price from its cheapest
 * denomination. Azur Lane servers map to the store's zone IDs.
 */
export const INITPAY_GAMES = Object.freeze({
  "8-ball-pool": Object.freeze({
    voucherTypeName: "EIGHT_BALL_POOL",
    pricePointId: "272564",
    pricePointPrice: "14000.0000",
    requiresZone: false,
    source: "codashop_initpay",
  }),
});

const NOT_FOUND_MESSAGE_PATTERN = /(user\s*not\s*found|account\s*info\s*not\s*found|user\s*name\s*not\s*found|not\s*found|unknown\s*(user|player)|invalid\s*(user|player|id|zone))/i;

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function baseFor(env = process.env) {
  const region = (env.CODASHOP_REGION?.trim() || "sg").toLowerCase().replace(/[^a-z]/g, "") || "sg";
  return `https://order-${region}.codashop.com`;
}

export function classifyInitpayResponse(httpStatus, payload) {
  if (httpStatus === 429) {
    return { kind: "rate_limited", diagnostic: { reason: "http_error", statusCode: 429 } };
  }
  const root = record(payload);
  if (!Number.isInteger(httpStatus) || httpStatus < 200 || httpStatus >= 300 || !root) {
    return { kind: "unavailable", diagnostic: { reason: "http_error", statusCode: Number.isInteger(httpStatus) ? httpStatus : 502 } };
  }
  // Success: errorCode present and empty string, username in confirmationFields.
  if (root.errorCode === "") {
    const confirmation = record(root.confirmationFields);
    const rawName = typeof confirmation?.username === "string" ? confirmation.username : "";
    let nickname;
    try { nickname = decodeURIComponent(rawName); } catch { nickname = rawName; }
    const confirmed = confirmedNickname({ name: nickname });
    if (confirmed) return { kind: "success", nickname: confirmed, source: "codashop_initpay" };
    return { kind: "unavailable", diagnostic: { reason: "unrecognized_response", statusCode: httpStatus } };
  }
  if (typeof root.errorCode === "string" && root.errorCode !== "") {
    const message = typeof root.errorMsg === "string" ? root.errorMsg : "";
    if (NOT_FOUND_MESSAGE_PATTERN.test(message)) return { kind: "not_found" };
    return { kind: "unavailable", diagnostic: { reason: "http_error", statusCode: httpStatus } };
  }
  return { kind: "unavailable", diagnostic: { reason: "unrecognized_response", statusCode: httpStatus } };
}

export async function lookupCodashopInitpay(game, playerId, zoneId = "", {
  fetchImpl = fetch,
  env = process.env,
  cache = providerCache,
} = {}) {
  const config = INITPAY_GAMES[game];
  if (!config) return { kind: "unavailable", diagnostic: { reason: "provider_error" } };
  if (typeof playerId !== "string" || !playerId.trim()) {
    return { kind: "unavailable", diagnostic: { reason: "provider_error" } };
  }
  if (config.requiresZone && (typeof zoneId !== "string" || !zoneId.trim())) {
    return { kind: "unavailable", diagnostic: { reason: "provider_error" } };
  }
  const cacheKey = `initpay:${game}:${playerId.trim()}:${config.requiresZone ? zoneId.trim() : ""}`;
  try {
    const { value } = await cache.getOrLoad(cacheKey, INITPAY_CACHE_TTL_SECONDS, async () => {
      const form = new URLSearchParams({
        "voucherPricePoint.id": config.pricePointId,
        "voucherPricePoint.price": config.pricePointPrice,
        "voucherPricePoint.variablePrice": "0",
        "user.userId": playerId.trim(),
        voucherTypeName: config.voucherTypeName,
        shopLang: "id_ID",
      });
      if (config.requiresZone) form.set("user.zoneId", zoneId.trim());
      let attempt;
      try {
        const upstream = await fetchImpl(`${baseFor(env)}/initPayment.action`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "Mozilla/5.0 (compatible; EidrenIdentityLookup/1.0)",
          },
          body: form.toString(),
          cache: "no-store",
          signal: AbortSignal.timeout(INITPAY_TIMEOUT_MS),
        });
        const payload = await upstream.json().catch(() => null);
        attempt = classifyInitpayResponse(upstream.status, payload);
      } catch {
        attempt = { kind: "unavailable", diagnostic: { reason: "network_or_timeout" } };
      }
      if (attempt?.kind === "unavailable") throw new TransientUpstreamError(attempt);
      return attempt;
    });
    return value;
  } catch (error) {
    if (error instanceof TransientUpstreamError) return error.attempt;
    return { kind: "unavailable", diagnostic: { reason: "network_or_timeout" } };
  }
}
