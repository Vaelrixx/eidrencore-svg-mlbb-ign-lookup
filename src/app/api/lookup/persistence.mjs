import { createHmac } from "node:crypto";
import { isIP } from "node:net";

const DEFAULT_WINDOW_SECONDS = 60;
const DEFAULT_MAX_REQUESTS = 30;
const REQUEST_TIMEOUT_MS = 1200;
// Log inserts run in the background, so they can afford a timeout that covers
// cross-region latency (e.g. Railway iad -> Supabase ap-northeast-1).
const LOG_TIMEOUT_MS = 1500;
const LOG_STATUSES = new Set(["success", "invalid_input", "not_found", "upstream_error", "rate_limited"]);
const LOG_SOURCES = new Set([
  "mlbb_lookup_api",
  "community_lookup",
  "isan_nickname_api",
  "rapidapi_id_game_checker",
  "brawl_stars_official_api",
  "clash_of_clans_official_api",
  "clash_royale_official_api",
  "eidren_pubg_mobile",
  "eidren_call_of_duty_mobile",
  "eidren_valorant",
  "eidren_genshin_impact",
  "eidren_honor_of_kings",
  "eidren_arena_of_valor",
  "eidren_pubg_lite",
  "eidren_teen_patti_gold",
  "eidren_jawaker",
  "eidren_fc_mobile",
  "eidren_bigo_live",
  "eidren_higgs_domino",
  "eidren_free_fire",
  "eidren_free_fire_global",
]);

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
  const realIp = request?.headers?.get?.("x-real-ip")?.trim();
  // Only trust X-Real-IP when it is a single IP literal. A hostname or a
  // comma-joined list is caller-controlled on unmanaged ingress, so treat it
  // as absent and fall through to the last X-Forwarded-For entry.
  if (realIp && isIP(realIp)) return realIp;
  // Railway's ingress appends the connecting client address to X-Forwarded-For.
  // Use the final entry rather than a caller-controlled leftmost value.
  const forwarded = request?.headers?.get?.("x-forwarded-for");
  if (!forwarded) return null;
  const entries = forwarded.split(",").map((entry) => entry.trim()).filter(Boolean);
  const address = entries.at(-1);
  return address && isIP(address) ? address : null;
}

function clientHash(address, secret) {
  return createHmac("sha256", secret).update(address).digest("hex");
}

async function requestSupabase(path, payload, { fetchImpl = fetch, env = process.env, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const config = configuration(env);
  if (!config) return { configured: false, ok: false, data: null };
  try {
    const response = await fetchImpl(`${config.url}/rest/v1/${path}`, {
      method: "POST",
      headers: { ...authHeaders(config.key), ...(!path.startsWith("rpc/") ? { Prefer: "return=minimal" } : {}) },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return { configured: true, ok: false, data: null };
    if (path.startsWith("rpc/")) {
      const data = await response.json().catch(() => null);
      return { configured: true, ok: true, data };
    }
    return { configured: true, ok: true, data: null };
  } catch {
    return { configured: true, ok: false, data: null };
  }
}

/**
 * Consume a shared, atomic fixed-window slot in Postgres.
 * Missing configuration, missing trusted client address, and database errors
 * fail open so an observability dependency cannot take the lookup API offline.
 */
export async function enforceLookupRateLimit(request, {
  fetchImpl = fetch,
  env = process.env,
  logger = console.warn,
  maxRequests = DEFAULT_MAX_REQUESTS,
  windowSeconds = DEFAULT_WINDOW_SECONDS,
} = {}) {
  const config = configuration(env);
  const secret = env.LOOKUP_RATE_LIMIT_SECRET;
  const address = clientAddress(request);
  if (!config || !secret || !address) {
    return { enabled: false, allowed: true, retryAfterSeconds: 0 };
  }

  const result = await requestSupabase("rpc/consume_lookup_limit", {
    p_client_hash: clientHash(address, secret),
    p_window_seconds: windowSeconds,
    p_max_requests: maxRequests,
  }, { fetchImpl, env });

  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!result.ok || !row || typeof row.allowed !== "boolean") {
    try { logger(JSON.stringify({ event: "lookup.rate_limit_unavailable" })); } catch { /* best effort */ }
    return { enabled: true, allowed: true, retryAfterSeconds: 0, degraded: true };
  }

  const resetAt = typeof row.reset_at === "string" ? Date.parse(row.reset_at) : NaN;
  return {
    enabled: true,
    allowed: row.allowed,
    retryAfterSeconds: row.allowed ? 0 : Math.max(1, Number.isFinite(resetAt) ? Math.ceil((resetAt - Date.now()) / 1000) : windowSeconds),
    remaining: Number.isInteger(row.remaining) ? Math.max(0, row.remaining) : undefined,
  };
}

const PLAYGROUND_WINDOW_SECONDS = 86_400;
const PLAYGROUND_MAX_REQUESTS = 50;

/**
 * Daily per-account allowance for signed-in (cookie session) lookups made from
 * the playground. API-key requests are metered by their plan quota instead.
 * Only an HMAC of the account id is stored. Fails open like the IP limiter.
 */
export async function enforcePlaygroundLimit(userId, {
  fetchImpl = fetch,
  env = process.env,
  logger = console.warn,
  maxRequests = PLAYGROUND_MAX_REQUESTS,
  windowSeconds = PLAYGROUND_WINDOW_SECONDS,
} = {}) {
  const secret = env.LOOKUP_RATE_LIMIT_SECRET;
  if (!configuration(env) || !secret || typeof userId !== "string" || !userId) {
    return { enabled: false, allowed: true, retryAfterSeconds: 0 };
  }
  const result = await requestSupabase("rpc/consume_lookup_limit", {
    p_client_hash: clientHash(`playground:${userId}`, secret),
    p_window_seconds: windowSeconds,
    p_max_requests: maxRequests,
  }, { fetchImpl, env });
  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!result.ok || !row || typeof row.allowed !== "boolean") {
    try { logger(JSON.stringify({ event: "lookup.playground_limit_unavailable" })); } catch { /* best effort */ }
    return { enabled: true, allowed: true, retryAfterSeconds: 0, degraded: true };
  }
  const resetAt = typeof row.reset_at === "string" ? Date.parse(row.reset_at) : NaN;
  return {
    enabled: true,
    allowed: row.allowed,
    retryAfterSeconds: row.allowed ? 0 : Math.max(1, Number.isFinite(resetAt) ? Math.ceil((resetAt - Date.now()) / 1000) : windowSeconds),
    remaining: Number.isInteger(row.remaining) ? Math.max(0, row.remaining) : undefined,
  };
}

/**
 * Store only the bounded outcome, latency and source label. Never pass request
 * IDs, client hashes, player IDs, zone IDs, nicknames, URLs or provider payloads.
 */
export async function persistLookupLog({ status, responseMs, source = "mlbb_lookup_api" }, options = {}) {
  if (!LOG_STATUSES.has(status)) return { persisted: false, reason: "invalid_status" };
  const payload = {
    status,
    response_ms: Number.isFinite(responseMs) ? Math.max(0, Math.min(2_147_483_647, Math.round(responseMs))) : null,
    source: LOG_SOURCES.has(source) ? source : "mlbb_lookup_api",
  };
  const result = await requestSupabase("lookup_logs", payload, { timeoutMs: LOG_TIMEOUT_MS, ...options });
  return { persisted: result.configured && result.ok, configured: result.configured };
}
