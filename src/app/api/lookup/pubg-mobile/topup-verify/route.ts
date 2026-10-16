import { createMetaLookupHandler } from "../../meta-route";
import { lookupMidasbuyPlayer } from "../../providers/midasbuy-pubg.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUBG Mobile top-up verification helper: confirm a Character ID resolves
 * to the expected nickname BEFORE paying on a top-up store. Backed by the
 * Midasbuy store lookup (server-side key, 7-day cache).
 * Authentication, quota, telemetry, and error codes mirror /api/lookup.
 * Unofficial fan tool, not affiliated with Tencent/KRAFTON.
 */
const { POST, GET } = createMetaLookupHandler({
  endpoint: "/api/lookup/pubg-mobile/topup-verify",
  resourceLabel: "PUBG Mobile top-up verification",
  provider: "midasbuy_api",
  logSource: "midasbuy_api",
  notFoundCode: "PUBG_VERIFY_NOT_FOUND",
  identifierKey: "playerId",
  identifierExample: "5204837417",
  lookup: async (playerId) => {
    const attempt = await lookupMidasbuyPlayer(playerId);
    if (attempt.kind !== "success") return attempt;
    return {
      kind: "success",
      data: { playerId, nickname: attempt.nickname },
      source: attempt.source,
      cached: attempt.cached,
    };
  },
});

export { POST, GET };
