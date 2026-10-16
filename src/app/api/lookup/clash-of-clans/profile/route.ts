import { createProfileLookupHandler } from "../../profile-route";
import { lookupSupercellProfile } from "../../providers/supercell-profile.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Full Clash of Clans player profile for a tag (for example #2PP).
 * Authentication, quota, telemetry, and error codes mirror /api/lookup.
 */
const { POST, GET } = createProfileLookupHandler({
  endpoint: "/api/lookup/clash-of-clans/profile",
  gameLabel: "Clash of Clans",
  tagExample: "#2PP",
  provider: "clash_of_clans_official_api",
  logSource: "clash_of_clans_official_api",
  notFoundCode: "COC_PROFILE_NOT_FOUND",
  lookup: (tag) => lookupSupercellProfile("clash-of-clans", tag),
});

export { POST, GET };
