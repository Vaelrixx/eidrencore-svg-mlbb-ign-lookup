import { createGameLookupHandler } from "../game-route";
import { lookupBrawlStars } from "../providers/brawl-stars.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Resolve a Brawl Stars player name from a player tag (for example #2PP).
 * Authentication, quota, telemetry, and error codes mirror /api/lookup.
 */
const { POST, GET } = createGameLookupHandler({
  endpoint: "/api/lookup/brawl-stars",
  gameLabel: "Brawl Stars",
  tagExample: "#2PP",
  provider: "brawl_stars_official_api",
  logSource: "brawl_stars_official_api",
  notFoundCode: "BS_PLAYER_NOT_FOUND",
  lookup: (tag) => lookupBrawlStars(tag),
});

export { POST, GET };
