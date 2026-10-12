import {
  fetchSupercellPath,
  normalizeSupercellTag,
} from "./supercell.mjs";

/**
 * Brawl Stars player battlelog via the official Brawl Stars API
 * (`GET /v1/players/{playerTag}/battlelog`), through the RoyaleAPI
 * community proxy.
 *
 * Returns a bounded list of recent battles with mode, result, and
 * timestamps. Battle records are part of the player history the caller asked
 * for; credentials, URLs, and raw payloads stay server-side.
 */

const MAX_BATTLES = 25;

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function summarizeBattle(entry) {
  const root = record(entry);
  if (!root) return null;
  const battle = record(root.battle) ?? {};
  const event = record(root.event) ?? {};
  return {
    mode: text(battle.mode) || null,
    type: text(battle.type) || null,
    result: text(battle.result) || null,
    duration: Number.isInteger(battle.duration) && battle.duration >= 0 ? battle.duration : null,
    rank: Number.isInteger(battle.rank) && battle.rank > 0 ? battle.rank : null,
    battleTime: text(root.battleTime) || null,
    event: text(event.mode) || text(event.map) || null,
  };
}

export function classifyBattlelogResponse(httpStatus, payload, source) {
  if (httpStatus === 429 || httpStatus === 403) {
    return { kind: "rate_limited", diagnostic: { reason: "http_error", statusCode: httpStatus } };
  }
  const root = record(payload);
  const reason = typeof root?.reason === "string" ? root.reason.trim().toLowerCase() : "";
  if (httpStatus === 404 || (Number.isInteger(httpStatus) && httpStatus >= 400 && httpStatus < 500 && reason === "notfound")) {
    return { kind: "not_found" };
  }
  if (!Number.isInteger(httpStatus) || httpStatus < 200 || httpStatus >= 300) {
    return { kind: "unavailable", diagnostic: { reason: "http_error", statusCode: httpStatus } };
  }
  const items = Array.isArray(root?.items) ? root.items : null;
  if (!items) {
    return { kind: "unavailable", diagnostic: { reason: "unrecognized_response", statusCode: httpStatus } };
  }
  const battles = items
    .map(summarizeBattle)
    .filter(Boolean)
    .slice(0, MAX_BATTLES);
  return { kind: "success", battles, source };
}

export async function lookupBrawlStarsBattlelog(tag, options = {}) {
  const normalized = normalizeSupercellTag(tag);
  if (!normalized) return { kind: "unavailable", diagnostic: { reason: "provider_error" } };
  const fetched = await fetchSupercellPath(
    "brawl-stars",
    `/v1/players/${encodeURIComponent(normalized)}/battlelog`,
    options,
  );
  if (!fetched.ok) return fetched.attempt;
  return classifyBattlelogResponse(fetched.status, fetched.payload, fetched.source);
}
