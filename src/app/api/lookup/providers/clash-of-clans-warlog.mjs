import {
  fetchSupercellPath,
  normalizeSupercellTag,
} from "./supercell.mjs";

/**
 * Clash of Clans clan war log via the official Clash of Clans API
 * (`GET /v1/clans/{clanTag}/warlog`), through the RoyaleAPI community proxy.
 *
 * Returns a bounded list of recent wars with opponent names, results, and
 * end times. War records are part of the clan history the caller asked for;
 * credentials, URLs, and raw payloads stay server-side.
 */

const MAX_WARS = 25;

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function summarizeWar(entry) {
  const root = record(entry);
  if (!root) return null;
  return {
    result: text(root.result) || null,
    endTime: text(root.endTime) || null,
    teamSize: Number.isInteger(root.teamSize) && root.teamSize > 0 ? root.teamSize : null,
    opponent: text(record(root.opponent)?.name) || null,
    clanStars: Number.isInteger(record(root.clan)?.stars) ? root.clan.stars : null,
    opponentStars: Number.isInteger(record(root.opponent)?.stars) ? root.opponent.stars : null,
  };
}

export function classifyWarlogResponse(httpStatus, payload, source) {
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
    // A private war log returns 200 with an empty items list; a missing
    // `items` key entirely means the contract changed.
    return { kind: "unavailable", diagnostic: { reason: "unrecognized_response", statusCode: httpStatus } };
  }
  const wars = items
    .map(summarizeWar)
    .filter(Boolean)
    .slice(0, MAX_WARS);
  return { kind: "success", wars, source };
}

export async function lookupClashOfClansWarlog(tag, options = {}) {
  const normalized = normalizeSupercellTag(tag);
  if (!normalized) return { kind: "unavailable", diagnostic: { reason: "provider_error" } };
  const fetched = await fetchSupercellPath(
    "clash-of-clans",
    `/v1/clans/${encodeURIComponent(normalized)}/warlog`,
    options,
  );
  if (!fetched.ok) return fetched.attempt;
  return classifyWarlogResponse(fetched.status, fetched.payload, fetched.source);
}
