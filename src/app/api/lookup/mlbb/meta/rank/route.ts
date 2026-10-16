import { createMetaLookupHandler } from "../../../meta-route";
import { lookupRoneMetaRank } from "../../../providers/rone-mlbb.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MLBB ranked meta snapshot via the Rone Arena community API.
 * Authentication, quota, telemetry, and error codes mirror /api/lookup.
 * Unofficial fan data, not affiliated with Moonton.
 */
const { POST, GET } = createMetaLookupHandler({
  endpoint: "/api/lookup/mlbb/meta/rank",
  resourceLabel: "MLBB meta ranking",
  provider: "rone_arena_api",
  logSource: "rone_arena_api",
  notFoundCode: "MLBB_META_RANK_UNAVAILABLE",
  lookup: async () => {
    const attempt = await lookupRoneMetaRank();
    if (attempt.kind !== "success") return attempt;
    return { kind: "success", data: { entries: attempt.entries }, source: attempt.source, cached: attempt.cached };
  },
});

export { POST, GET };
