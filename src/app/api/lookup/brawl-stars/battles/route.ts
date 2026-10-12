import { createHistoryLookupHandler } from "../../history-route";
import { lookupBrawlStarsBattlelog } from "../../providers/brawl-stars-battles.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Recent Brawl Stars battles for a player tag.
 * Authentication, quota, telemetry, and error codes mirror /api/lookup.
 */
const { POST, GET } = createHistoryLookupHandler({
  endpoint: "/api/lookup/brawl-stars/battles",
  gameLabel: "Brawl Stars",
  historyLabel: "battles",
  historyKey: "battles",
  tagExample: "#2PP",
  provider: "brawl_stars_official_api",
  logSource: "brawl_stars_official_api",
  notFoundCode: "BS_PLAYER_NOT_FOUND",
  lookup: (tag) => lookupBrawlStarsBattlelog(tag),
});

export { POST, GET };
