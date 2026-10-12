import { createHistoryLookupHandler } from "../../history-route";
import { lookupClashRoyaleBattlelog } from "../../providers/clash-royale-battles.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Recent Clash Royale battles for a player tag.
 * Authentication, quota, telemetry, and error codes mirror /api/lookup.
 */
const { POST, GET } = createHistoryLookupHandler({
  endpoint: "/api/lookup/clash-royale/battles",
  gameLabel: "Clash Royale",
  historyLabel: "battles",
  historyKey: "battles",
  tagExample: "#C0G20PR2",
  provider: "clash_royale_official_api",
  logSource: "clash_royale_official_api",
  notFoundCode: "CR_PLAYER_NOT_FOUND",
  lookup: (tag) => lookupClashRoyaleBattlelog(tag),
});

export { POST, GET };
