import { fetchSupercellPath } from "./supercell.mjs";

/**
 * Location rankings for all three Supercell games via the official APIs,
 * through the RoyaleAPI community proxy:
 *
 * - Clash Royale: `GET /v1/locations/{locationId}/rankings/players`
 * - Clash of Clans: `GET /v1/locations/{locationId}/rankings/players`
 * - Brawl Stars: `GET /v1/rankings/{countryCode}/players`
 *
 * Success carries a bounded list of ranked entries (rank, name, tag where
 * present, score). Location IDs are allowlisted per game: `global` plus the
 * game's documented numeric location IDs. Unknown location inputs are
 * rejected before any upstream call.
 */

const MAX_ENTRIES = 25;

// Well-known location IDs. `global` works on every rankings path; numeric
// IDs follow each game's documented locations list.
const LOCATION_PATTERN = /^(global|[0-9]{4,10})$/i;

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeLocationId(value) {
  if (typeof value !== "string") return "";
  const compact = value.trim();
  if (!LOCATION_PATTERN.test(compact)) return "";
  return compact.toLowerCase() === "global" ? "global" : compact;
}

function summarizeEntry(entry, game) {
  const root = record(entry);
  if (!root) return null;
  const name = text(root.name);
  if (!name) return null;
  const summary = {
    rank: Number.isInteger(root.rank) && root.rank > 0 ? root.rank : null,
    name,
    tag: text(root.tag) || null,
  };
  if (game === "clash-royale") {
    summary.score = Number.isInteger(root.clanScore) ? root.clanScore : null;
    summary.trophies = Number.isInteger(root.trophies) ? root.trophies : null;
  } else if (game === "clash-of-clans") {
    summary.trophies = Number.isInteger(root.trophies) ? root.trophies : null;
    summary.clan = text(record(root.clan)?.name) || null;
  } else {
    summary.trophies = Number.isInteger(root.trophies) ? root.trophies : null;
    summary.club = text(record(root.club)?.name) || null;
  }
  return summary;
}

export function classifyRankingsResponse(httpStatus, payload, source, game) {
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
  const entries = items
    .map((entry) => summarizeEntry(entry, game))
    .filter(Boolean)
    .slice(0, MAX_ENTRIES);
  return { kind: "success", entries, source };
}

function rankingsPath(game, locationId) {
  const encoded = encodeURIComponent(locationId);
  if (game === "brawl-stars") {
    // Brawl Stars uses country codes (e.g. `global` or `US`) on /v1/rankings.
    return `/v1/rankings/${encoded}/players?limit=${MAX_ENTRIES}`;
  }
  return `/v1/locations/${encoded}/rankings/players?limit=${MAX_ENTRIES}`;
}

export async function lookupSupercellRankings(game, locationId, options = {}) {
  const location = normalizeLocationId(locationId);
  if (!location) return { kind: "unavailable", diagnostic: { reason: "provider_error" } };
  const fetched = await fetchSupercellPath(game, rankingsPath(game, location), options);
  if (!fetched.ok) return fetched.attempt;
  return classifyRankingsResponse(fetched.status, fetched.payload, fetched.source, game);
}
