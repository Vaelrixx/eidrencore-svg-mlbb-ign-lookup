import { createRankingsHandler } from "../../rankings-route";
import { lookupSupercellRankings } from "../../providers/supercell-rankings.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Top Brawl Stars players for a location (`global` or a country code).
 * Authentication, quota, telemetry, and error codes mirror /api/lookup.
 */
const { POST, GET } = createRankingsHandler({
  endpoint: "/api/lookup/brawl-stars/rankings",
  gameLabel: "Brawl Stars",
  provider: "brawl_stars_official_api",
  logSource: "brawl_stars_official_api",
  lookup: (locationId) => lookupSupercellRankings("brawl-stars", locationId),
});

export { POST, GET };
