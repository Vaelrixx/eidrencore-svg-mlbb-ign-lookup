import { createProfileLookupHandler } from "../../profile-route";
import { lookupSupercellProfile } from "../../providers/supercell-profile.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Full Brawl Stars player profile for a tag (for example #2PP).
 * Authentication, quota, telemetry, and error codes mirror /api/lookup.
 */
const { POST, GET } = createProfileLookupHandler({
  endpoint: "/api/lookup/brawl-stars/profile",
  gameLabel: "Brawl Stars",
  tagExample: "#2PP",
  provider: "brawl_stars_official_api",
  logSource: "brawl_stars_official_api",
  notFoundCode: "BS_PROFILE_NOT_FOUND",
  lookup: (tag) => lookupSupercellProfile("brawl-stars", tag),
});

export { POST, GET };
