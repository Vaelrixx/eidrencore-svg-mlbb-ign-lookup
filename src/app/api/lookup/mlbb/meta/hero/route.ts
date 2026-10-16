import { createMetaLookupHandler } from "../../../meta-route";
import { lookupRoneHeroDetail } from "../../../providers/rone-mlbb.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MLBB hero detail (counters + teammate synergy) via the Rone Arena
 * community API. `hero` accepts a numeric id or slug.
 * Authentication, quota, telemetry, and error codes mirror /api/lookup.
 * Unofficial fan data, not affiliated with Moonton.
 */
const { POST, GET } = createMetaLookupHandler({
  endpoint: "/api/lookup/mlbb/meta/hero",
  resourceLabel: "MLBB hero",
  provider: "rone_arena_api",
  logSource: "rone_arena_api",
  notFoundCode: "MLBB_HERO_NOT_FOUND",
  identifierKey: "hero",
  identifierExample: "1",
  lookup: async (hero) => {
    const attempt = await lookupRoneHeroDetail(hero);
    if (attempt.kind !== "success") return attempt;
    return {
      kind: "success",
      data: { hero: attempt.hero, counters: attempt.counters, teammates: attempt.teammates },
      source: attempt.source,
      cached: attempt.cached,
    };
  },
});

export { POST, GET };
