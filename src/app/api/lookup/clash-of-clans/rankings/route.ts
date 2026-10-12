import { createRankingsHandler } from "../../rankings-route";
import { lookupSupercellRankings } from "../../providers/supercell-rankings.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Top Clash of Clans players for a location (`global` or a numeric location ID).
 * Authentication, quota, telemetry, and error codes mirror /api/lookup.
 */
const { POST, GET } = createRankingsHandler({
  endpoint: "/api/lookup/clash-of-clans/rankings",
  gameLabel: "Clash of Clans",
  provider: "clash_of_clans_official_api",
  logSource: "clash_of_clans_official_api",
  lookup: (locationId) => lookupSupercellRankings("clash-of-clans", locationId),
});

export { POST, GET };
