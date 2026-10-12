import { createClanLookupHandler } from "../../clan-route";
import { lookupBrawlStarsClub } from "../../providers/brawl-stars-club.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Resolve a Brawl Stars club name and roster summary from a club tag.
 * Authentication, quota, telemetry, and error codes mirror /api/lookup.
 */
const { POST, GET } = createClanLookupHandler({
  endpoint: "/api/lookup/brawl-stars/club",
  gameLabel: "Brawl Stars",
  groupLabel: "club",
  tagExample: "#2PP",
  provider: "brawl_stars_official_api",
  logSource: "brawl_stars_official_api",
  notFoundCode: "BS_CLUB_NOT_FOUND",
  lookup: (tag) => lookupBrawlStarsClub(tag),
});

export { POST, GET };
