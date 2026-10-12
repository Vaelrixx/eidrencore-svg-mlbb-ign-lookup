import {
  fetchSupercellPath,
  normalizeSupercellTag,
} from "./supercell.mjs";

/**
 * Clash Royale player battlelog via the official Clash Royale API
 * (`GET /v1/players/{playerTag}/battlelog`), through the RoyaleAPI
 * community proxy.
 *
 * Returns a bounded list of recent battles with team/opponent names, crowns,
 * and timestamps. Timestamps and opponent tags are part of the game record
 * the caller asked for; credentials, URLs, and raw payloads stay server-side.
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

function nonNegativeInt(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function summarizeBattle(entry) {
  const root = record(entry);
  if (!root) return null;
  const team = Array.isArray(root.team) ? root.team : [];
  const opponent = Array.isArray(root.opponent) ? root.opponent : [];
  const names = (side) =>
    side
      .map((member) => text(record(member)?.name))
      .filter(Boolean)
      .slice(0, 2);
  return {
    type: text(root.type) || null,
    battleTime: text(root.battleTime) || null,
    team: names(team),
    opponent: names(opponent),
    teamCrowns: nonNegativeInt(root.teamCrowns),
    opponentCrowns: nonNegativeInt(root.opponentCrowns),
    deckSelection: text(root.deckSelection) || null,
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
  if (!Array.isArray(payload)) {
    return { kind: "unavailable", diagnostic: { reason: "unrecognized_response", statusCode: httpStatus } };
  }
  const battles = payload
    .map(summarizeBattle)
    .filter(Boolean)
    .slice(0, MAX_BATTLES);
  return { kind: "success", battles, source };
}

export async function lookupClashRoyaleBattlelog(tag, options = {}) {
  const normalized = normalizeSupercellTag(tag);
  if (!normalized) return { kind: "unavailable", diagnostic: { reason: "provider_error" } };
  const fetched = await fetchSupercellPath(
    "clash-royale",
    `/v1/players/${encodeURIComponent(normalized)}/battlelog`,
    options,
  );
  if (!fetched.ok) return fetched.attempt;
  return classifyBattlelogResponse(fetched.status, fetched.payload, fetched.source);
}
