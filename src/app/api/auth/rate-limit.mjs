import { createHmac } from "node:crypto";
import { isIP } from "node:net";

/**
 * Brute-force guard for authentication endpoints.
 *
 * Reuses the shared atomic Postgres limiter (`consume_lookup_limit`) already
 * used by the lookup API so auth attempts are counted per client address
 * without storing raw IPs. Auth limits are intentionally stricter and fail
 * closed: if the limiter is configured but the database cannot be reached,
 * the request is rejected rather than allowing unlimited password guessing.
 */

export const AUTH_SIGNIN_WINDOW_SECONDS = 900;
export const AUTH_SIGNIN_MAX_REQUESTS = 20;
export const AUTH_SIGNUP_WINDOW_SECONDS = 3600;
export const AUTH_SIGNUP_MAX_REQUESTS = 10;
export const AUTH_RECOVERY_WINDOW_SECONDS = 3600;
export const AUTH_RECOVERY_MAX_REQUESTS = 5;

const REQUEST_TIMEOUT_MS = 1200;

function configuration(env = process.env) {
  const url = typeof env.SUPABASE_URL === "string" ? env.SUPABASE_URL.replace(/\/+$/, "") : "";
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "";
  return url && key ? { url, key } : null;
}

function authHeaders(key) {
  const headers = { apikey: key, "Content-Type": "application/json" };
  // New Supabase secret keys are not JWTs and must not be sent as Bearer tokens.
  if (!key.startsWith("sb_secret_")) headers.Authorization = `Bearer ${key}`;
  return headers;
}

function clientAddress(request) {
  // Railway ingress overwrites X-Real-IP with the connecting client address,
  // its documented single source of truth. Client-supplied X-Forwarded-For is
  // stripped at the edge, and Railway may append an internal hop, so the final
  // XFF entry is not a reliable per-client key. Trusted only behind the
  // configured Railway ingress.
  const realIp = request?.headers?.get?.("x-real-ip");
  if (!realIp) return null;
  const address = realIp.split(",").map((entry) => entry.trim()).filter(Boolean).at(-1);
  return address && isIP(address) ? address : null;
}

function clientHash(scope, address, secret) {
  return createHmac("sha256", secret).update(`${scope}:${address}`).digest("hex");
}

/**
 * Consume one auth-attempt slot. Returns `{ allowed, retryAfterSeconds }`.
 * When the limiter is not configured (missing Supabase/HMAC secret or client
 * address), auth continues — Supabase's own edge rate limits still apply.
 * When configured but the database call fails, auth fails closed.
 */
export async function consumeAuthAttempt(request, scope, {
  fetchImpl = fetch,
  env = process.env,
  logger = console.warn,
  windowSeconds,
  maxRequests,
} = {}) {
  const config = configuration(env);
  const secret = env.LOOKUP_RATE_LIMIT_SECRET;
  const address = clientAddress(request);
  if (!config || !secret || !address) {
    return { enabled: false, allowed: true, retryAfterSeconds: 0 };
  }

  let row = null;
  try {
    const response = await fetchImpl(`${config.url}/rest/v1/rpc/consume_lookup_limit`, {
      method: "POST",
      headers: authHeaders(config.key),
      body: JSON.stringify({
        p_client_hash: clientHash(scope, address, secret),
        p_window_seconds: windowSeconds,
        p_max_requests: maxRequests,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.ok) {
      const data = await response.json().catch(() => null);
      row = Array.isArray(data) ? data[0] : data;
    }
  } catch {
    row = null;
  }

  if (!row || typeof row.allowed !== "boolean") {
    try { logger(JSON.stringify({ event: "auth.rate_limit_unavailable", scope })); } catch { /* best effort */ }
    return { enabled: true, allowed: false, retryAfterSeconds: windowSeconds, degraded: true };
  }

  const resetAt = typeof row.reset_at === "string" ? Date.parse(row.reset_at) : NaN;
  return {
    enabled: true,
    allowed: row.allowed,
    retryAfterSeconds: row.allowed ? 0 : Math.max(1, Number.isFinite(resetAt) ? Math.ceil((resetAt - Date.now()) / 1000) : windowSeconds),
    remaining: Number.isInteger(row.remaining) ? Math.max(0, row.remaining) : undefined,
  };
}
