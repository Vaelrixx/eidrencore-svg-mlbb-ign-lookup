/**
 * MLBB nickname lookup via the Neferbyte Game ID Checker API.
 *
 * Wired as an additional fallback leg behind the existing MLBB chain
 * (Isan → RapidAPI → WhoPlays → GoPay). Contract observed live 2026-10-17:
 * - `GET {base}/game-id-checker/mobile-legends/{id}/{server}` with
 *   `x-api-key` header → 200 `{success:true,data:{game,userId,username}}`
 * - no key → 200 `{error:true,msg:"Authentication is required."}`
 * - unknown user → 200 `{error:true,msg:"..."}` (message varies)
 *
 * Classification is conservative: only the documented success shape counts
 * as success; only explicit unknown-user messages count as not_found;
 * auth/quota messages degrade as unavailable (missing_config when no key is
 * set, so the chain keeps working without one).
 *
 * Env (server-only): `NEFERBYTE_API_KEY`, optional `NEFERBYTE_API_BASE`
 * (default `https://api.neferbyte.com`).
 *
 * Privacy: never logs or returns IDs, nicknames, payloads, URLs, headers,
 * or credentials. Only LookupAttempt shapes leave here.
 */

import { confirmedNickname } from "../nickname-validation.mjs";

const DEFAULT_BASE = "https://api.neferbyte.com";
const REQUEST_TIMEOUT_MS = 7000;
const NOT_FOUND_MESSAGE_PATTERN = /(not\s*found|unknown\s*(user|player)|invalid\s*(id|user|player)|no\s*(user|player|result)|user\s*not\s*exist)/i;
const AUTH_MESSAGE_PATTERN = /(auth|api[\s_-]?key|token|quota|limit|forbidden|unauthori[sz]ed)/i;

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function baseFor(env = process.env) {
  return (env.NEFERBYTE_API_BASE?.trim() || DEFAULT_BASE).replace(/\/+$/, "");
}

export function classifyNeferbyteResponse(httpStatus, payload) {
  const root = record(payload);
  const data = record(root?.data);
  const message = typeof root?.msg === "string" ? root.msg : typeof root?.message === "string" ? root.message : "";

  if (httpStatus === 429) {
    return { kind: "rate_limited", diagnostic: { reason: "http_error", statusCode: 429 } };
  }
  // Neferbyte answers auth failures as HTTP 200 with an error envelope.
  if (root?.success === true && data && confirmedNickname({ name: data.username })) {
    return { kind: "success", nickname: data.username.trim(), source: "neferbyte_game_id_checker" };
  }
  if (root?.error === true || root?.success === false) {
    if (AUTH_MESSAGE_PATTERN.test(message)) {
      return { kind: "unavailable", diagnostic: { reason: "http_error", statusCode: 200 } };
    }
    if (NOT_FOUND_MESSAGE_PATTERN.test(message)) return { kind: "not_found" };
    return { kind: "unavailable", diagnostic: { reason: "unrecognized_response", statusCode: httpStatus } };
  }
  if (httpStatus === 404) return { kind: "not_found" };
  if (!Number.isInteger(httpStatus) || httpStatus < 200 || httpStatus >= 300) {
    return { kind: "unavailable", diagnostic: { reason: "http_error", statusCode: httpStatus } };
  }
  return { kind: "unavailable", diagnostic: { reason: "unrecognized_response", statusCode: httpStatus } };
}

/**
 * Look up an MLBB nickname by (playerId, zoneId). IDs stay strings.
 * Returns missing_config when no key is set so the chain degrades cleanly.
 */
export async function lookupNeferbyteMlbb(playerId, zoneId, {
  fetchImpl = fetch,
  env = process.env,
} = {}) {
  if (typeof playerId !== "string" || !playerId.trim() || typeof zoneId !== "string" || !zoneId.trim()) {
    return { kind: "unavailable", diagnostic: { reason: "provider_error" } };
  }
  const key = env.NEFERBYTE_API_KEY?.trim() || "";
  if (!key) {
    return { kind: "unavailable", diagnostic: { reason: "missing_config" } };
  }
  const url = `${baseFor(env)}/game-id-checker/mobile-legends/${encodeURIComponent(playerId.trim())}/${encodeURIComponent(zoneId.trim())}`;
  try {
    const upstream = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json", "x-api-key": key },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const payload = await upstream.json().catch(() => null);
    return classifyNeferbyteResponse(upstream.status, payload);
  } catch {
    return { kind: "unavailable", diagnostic: { reason: "network_or_timeout" } };
  }
}
