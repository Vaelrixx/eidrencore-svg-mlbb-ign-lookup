import { createRankingsHandler } from "../../rankings-route";
import { lookupSupercellRankings } from "../../providers/supercell-rankings.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Top Clash Royale players for a location (`global` or a numeric location ID).
 * Authentication, quota, telemetry, and error codes mirror /api/lookup.
 */
const { POST, GET } = createRankingsHandler({
  endpoint: "/api/lookup/clash-royale/rankings",
  gameLabel: "Clash Royale",
  provider: "clash_royale_official_api",
  logSource: "clash_royale_official_api",
  lookup: (locationId) => lookupSupercellRankings("clash-royale", locationId),
});

export { POST, GET };
