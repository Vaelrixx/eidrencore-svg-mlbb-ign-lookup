import { createGameLookupHandler } from "../game-route";
import { lookupClashOfClans } from "../providers/clash-of-clans.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Resolve a Clash of Clans player name from a player tag (for example #2PP).
 * Authentication, quota, telemetry, and error codes mirror /api/lookup.
 */
const { POST, GET } = createGameLookupHandler({
  endpoint: "/api/lookup/clash-of-clans",
  gameLabel: "Clash of Clans",
  tagExample: "#2PP",
  provider: "clash_of_clans_official_api",
  logSource: "clash_of_clans_official_api",
  notFoundCode: "COC_PLAYER_NOT_FOUND",
  lookup: (tag) => lookupClashOfClans(tag),
});

export { POST, GET };
