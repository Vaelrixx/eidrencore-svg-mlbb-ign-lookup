import { createProfileLookupHandler } from "../../profile-route";
import { lookupSupercellProfile } from "../../providers/supercell-profile.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Full Clash Royale player profile for a tag (for example #2PP).
 * Authentication, quota, telemetry, and error codes mirror /api/lookup.
 */
const { POST, GET } = createProfileLookupHandler({
  endpoint: "/api/lookup/clash-royale/profile",
  gameLabel: "Clash Royale",
  tagExample: "#2PP",
  provider: "clash_royale_official_api",
  logSource: "clash_royale_official_api",
  notFoundCode: "CR_PROFILE_NOT_FOUND",
  lookup: (tag) => lookupSupercellProfile("clash-royale", tag),
});

export { POST, GET };
