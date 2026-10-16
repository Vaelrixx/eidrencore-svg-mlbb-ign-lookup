import { createMetaLookupHandler } from "../../meta-route";
import { lookupFreeFireStats } from "../../providers/freefire-community.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Free Fire career stats (Solo/Duo/Squad) by UID via the Free Fire
 * Community API.
 * Authentication, quota, telemetry, and error codes mirror /api/lookup.
 * Unofficial fan data, not affiliated with Garena.
 */
const { POST, GET } = createMetaLookupHandler({
  endpoint: "/api/lookup/free-fire/stats",
  resourceLabel: "Free Fire stats",
  provider: "freefire_community_api",
  logSource: "freefire_community_api",
  notFoundCode: "FF_STATS_NOT_FOUND",
  identifierKey: "uid",
  identifierExample: "1958604115",
  lookup: async (uid) => {
    const attempt = await lookupFreeFireStats(uid);
    if (attempt.kind !== "success") return attempt;
    return {
      kind: "success",
      data: { uid, stats: attempt.stats },
      source: attempt.source,
      cached: attempt.cached,
    };
  },
});

export { POST, GET };
