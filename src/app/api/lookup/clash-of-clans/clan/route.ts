import { createClanLookupHandler } from "../../clan-route";
import { lookupClashOfClansClan } from "../../providers/clash-of-clans-clan.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Resolve a Clash of Clans clan name and roster summary from a clan tag.
 * Authentication, quota, telemetry, and error codes mirror /api/lookup.
 */
const { POST, GET } = createClanLookupHandler({
  endpoint: "/api/lookup/clash-of-clans/clan",
  gameLabel: "Clash of Clans",
  groupLabel: "clan",
  tagExample: "#2PP",
  provider: "clash_of_clans_official_api",
  logSource: "clash_of_clans_official_api",
  notFoundCode: "COC_CLAN_NOT_FOUND",
  lookup: (tag) => lookupClashOfClansClan(tag),
});

export { POST, GET };
