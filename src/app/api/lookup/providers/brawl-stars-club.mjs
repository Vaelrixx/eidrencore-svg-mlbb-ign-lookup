import {
  fetchSupercellPath,
  normalizeSupercellTag,
} from "./supercell.mjs";

/**
 * Brawl Stars club lookup by tag via the official Brawl Stars API
 * (`GET /v1/clubs/{clubTag}`), through the RoyaleAPI community proxy.
 *
 * Success carries the club's display fields; the route maps them into the
 * stable response envelope. Same privacy rules as player lookups: no tags,
 * payloads, URLs, headers, or credentials are logged or echoed in errors.
 */

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function count(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

export function classifyClubResponse(httpStatus, payload, source) {
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
  const name = text(root?.name);
  const tag = text(root?.tag);
  if (!name || !normalizeSupercellTag(tag)) {
    if (root?.name === null || reason === "notfound") return { kind: "not_found" };
    return { kind: "unavailable", diagnostic: { reason: "unrecognized_response", statusCode: httpStatus } };
  }
  const members = Array.isArray(root?.members) ? root.members.length : count(root?.members);
  return {
    kind: "success",
    club: {
      name,
      tag: normalizeSupercellTag(tag),
      memberCount: members,
      trophies: count(root?.trophies),
      type: text(root?.type) || null,
      description: text(root?.description) || null,
    },
    source,
  };
}

export async function lookupBrawlStarsClub(tag, options = {}) {
  const normalized = normalizeSupercellTag(tag);
  if (!normalized) return { kind: "unavailable", diagnostic: { reason: "provider_error" } };
  const fetched = await fetchSupercellPath(
    "brawl-stars",
    `/v1/clubs/${encodeURIComponent(normalized)}`,
    options,
  );
  if (!fetched.ok) return fetched.attempt;
  return classifyClubResponse(fetched.status, fetched.payload, fetched.source);
}
