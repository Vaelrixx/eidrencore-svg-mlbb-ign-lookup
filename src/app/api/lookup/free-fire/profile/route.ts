import { createMetaLookupHandler } from "../../meta-route";
import { lookupFreeFireProfile } from "../../providers/freefire-community.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Free Fire player profile by UID via the Free Fire Community API.
 * Authentication, quota, telemetry, and error codes mirror /api/lookup.
 * Unofficial fan data, not affiliated with Garena.
 */
const { POST, GET } = createMetaLookupHandler({
  endpoint: "/api/lookup/free-fire/profile",
  resourceLabel: "Free Fire profile",
  provider: "freefire_community_api",
  logSource: "freefire_community_api",
  notFoundCode: "FF_PROFILE_NOT_FOUND",
  identifierKey: "uid",
  identifierExample: "1958604115",
  lookup: async (uid) => {
    const attempt = await lookupFreeFireProfile(uid);
    if (attempt.kind !== "success") return attempt;
    return {
      kind: "success",
      data: { uid, profile: attempt.profile },
      source: attempt.source,
      cached: attempt.cached,
    };
  },
});

export { POST, GET };
