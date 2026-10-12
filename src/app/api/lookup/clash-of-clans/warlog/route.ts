import { createHistoryLookupHandler } from "../../history-route";
import { lookupClashOfClansWarlog } from "../../providers/clash-of-clans-warlog.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Recent Clash of Clans wars for a clan tag.
 * Authentication, quota, telemetry, and error codes mirror /api/lookup.
 */
const { POST, GET } = createHistoryLookupHandler({
  endpoint: "/api/lookup/clash-of-clans/warlog",
  gameLabel: "Clash of Clans",
  historyLabel: "wars",
  historyKey: "wars",
  tagExample: "#2PP",
  provider: "clash_of_clans_official_api",
  logSource: "clash_of_clans_official_api",
  notFoundCode: "COC_CLAN_NOT_FOUND",
  lookup: (tag) => lookupClashOfClansWarlog(tag),
});

export { POST, GET };
