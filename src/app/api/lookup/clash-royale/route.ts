import { createGameLookupHandler } from "../game-route";
import { lookupClashRoyale } from "../providers/clash-royale.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Resolve a Clash Royale player name from a player tag (for example #C0G20PR2).
 * Authentication, quota, telemetry, and error codes mirror /api/lookup.
 */
const { POST, GET } = createGameLookupHandler({
  endpoint: "/api/lookup/clash-royale",
  gameLabel: "Clash Royale",
  tagExample: "#C0G20PR2",
  provider: "clash_royale_official_api",
  logSource: "clash_royale_official_api",
  notFoundCode: "CR_PLAYER_NOT_FOUND",
  lookup: (tag) => lookupClashRoyale(tag),
});

export { POST, GET };
