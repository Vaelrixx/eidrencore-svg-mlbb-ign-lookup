/**
 * Eidren identity ledger: our own answer layer.
 *
 * Every confirmed nickname is recorded in Postgres. Repeat lookups of the
 * same identity are served from the ledger without touching any upstream,
 * so the hot head of traffic (top-up stores re-verifying the same buyers)
 * survives third-party outages and quota exhaustion. Ledger misses fall
 * through to the normal provider chain.
 *
 * Same contract as persistence.mjs: missing config or a database outage
 * fails open and never breaks a lookup.
 */

const READ_TIMEOUT_MS = 1200;
const WRITE_TIMEOUT_MS = 1500;

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

/**
 * Canonical identity key: sorted field pairs, so {playerId, zoneId} and any
 * future field order always hash to the same row. Values are already
 * validated at the trust boundary before this is called.
 */
export function ledgerPlayerKey(input) {
  return Object.keys(input)
    .sort()
    .map((key) => `${key}=${input[key]}`)
    .join("&");
}

/**
 * Read a confirmed nickname from the ledger. Returns the row or null on
 * miss, misconfiguration, or any database failure (fails open).
 */
export async function readIdentityLedger(game, playerKey, { fetchImpl = fetch, env = process.env } = {}) {
  const config = configuration(env);
  if (!config || typeof game !== "string" || !game || typeof playerKey !== "string" || !playerKey) {
    return null;
  }
  try {
    const params = new URLSearchParams({
      game: `eq.${game}`,
      player_key: `eq.${playerKey}`,
      select: "nickname,source,verified_at",
      limit: "1",
    });
    const response = await fetchImpl(`${config.url}/rest/v1/identity_ledger?${params}`, {
      method: "GET",
      headers: authHeaders(config.key),
      cache: "no-store",
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const rows = await response.json().catch(() => null);
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row || typeof row.nickname !== "string" || !row.nickname) return null;
    return { nickname: row.nickname, source: typeof row.source === "string" ? row.source : "eidren_identity_ledger" };
  } catch {
    return null;
  }
}

/**
 * Record a confirmed nickname. Fire-and-forget safe: never throws, resolves
 * false when unconfigured or the write fails. Only call on confirmed
 * provider success, never on echoes, guesses, or errors.
 */
export async function writeIdentityLedger(game, playerKey, nickname, source, { fetchImpl = fetch, env = process.env } = {}) {
  const config = configuration(env);
  if (!config || typeof game !== "string" || !game || typeof playerKey !== "string" || !playerKey
    || typeof nickname !== "string" || !nickname || typeof source !== "string" || !source) {
    return false;
  }
  try {
    const response = await fetchImpl(`${config.url}/rest/v1/rpc/upsert_identity_ledger`, {
      method: "POST",
      headers: authHeaders(config.key),
      body: JSON.stringify({ p_game: game, p_player_key: playerKey, p_nickname: nickname, p_source: source }),
      cache: "no-store",
      signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Best-effort hit counter for served-from-ledger lookups. Never throws.
 */
export async function recordIdentityLedgerHit(game, playerKey, { fetchImpl = fetch, env = process.env } = {}) {
  const config = configuration(env);
  if (!config || typeof game !== "string" || !game || typeof playerKey !== "string" || !playerKey) {
    return false;
  }
  try {
    const response = await fetchImpl(`${config.url}/rest/v1/rpc/record_identity_ledger_hit`, {
      method: "POST",
      headers: authHeaders(config.key),
      body: JSON.stringify({ p_game: game, p_player_key: playerKey }),
      cache: "no-store",
      signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}
