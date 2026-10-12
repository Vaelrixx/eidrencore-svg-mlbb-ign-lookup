import { createClanLookupHandler } from "../../clan-route";
import { lookupClashRoyaleClan } from "../../providers/clash-royale-clan.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Resolve a Clash Royale clan name and roster summary from a clan tag.
 * Authentication, quota, telemetry, and error codes mirror /api/lookup.
 */
const { POST, GET } = createClanLookupHandler({
  endpoint: "/api/lookup/clash-royale/clan",
  gameLabel: "Clash Royale",
  groupLabel: "clan",
  tagExample: "#C0G20PR2",
  provider: "clash_royale_official_api",
  logSource: "clash_royale_official_api",
  notFoundCode: "CR_CLAN_NOT_FOUND",
  lookup: (tag) => lookupClashRoyaleClan(tag),
});

export { POST, GET };
