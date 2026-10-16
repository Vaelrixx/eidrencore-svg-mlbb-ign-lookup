import { createMetaLookupHandler } from "../../../meta-route";
import { lookupRoneHeroes } from "../../../providers/rone-mlbb.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MLBB hero list (id + name) via the Rone Arena community API.
 * Authentication, quota, telemetry, and error codes mirror /api/lookup.
 * Unofficial fan data, not affiliated with Moonton.
 */
const { POST, GET } = createMetaLookupHandler({
  endpoint: "/api/lookup/mlbb/meta/heroes",
  resourceLabel: "MLBB hero list",
  provider: "rone_arena_api",
  logSource: "rone_arena_api",
  notFoundCode: "MLBB_HEROES_UNAVAILABLE",
  lookup: async () => {
    const attempt = await lookupRoneHeroes();
    if (attempt.kind !== "success") return attempt;
    return { kind: "success", data: { heroes: attempt.heroes }, source: attempt.source, cached: attempt.cached };
  },
});

export { POST, GET };
