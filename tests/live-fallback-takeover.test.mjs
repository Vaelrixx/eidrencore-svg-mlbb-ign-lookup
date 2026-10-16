import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { isUsableNickname } from "../src/app/api/lookup/nickname-validation.mjs";
import { resolveLookupWithFallbacks } from "../src/app/api/lookup/resolve-lookup.mjs";
import { lookupCodashopDirect } from "../src/app/api/lookup/providers/codashop-direct.mjs";
import { lookupGoPayGames } from "../src/app/api/lookup/providers/gopay-games.mjs";

const playerId = process.env.LIVE_LOOKUP_PLAYER_ID ?? "1114917746";
const zoneId = process.env.LIVE_LOOKUP_ZONE_ID ?? "13486";

test("self-reliant primary resolves live, keyless GoPay leg backs it up", async () => {
  const startedAt = performance.now();
  let primaryCalls = 0;
  let secondaryCalls = 0;

  const resolution = await resolveLookupWithFallbacks(
    async () => {
      primaryCalls += 1;
      // Same self-reliant primary wired into route.ts: the store's own
      // validation endpoint, called directly with our request shape.
      return lookupCodashopDirect("mobile-legends", playerId, zoneId);
    },
    [
      async () => {
        secondaryCalls += 1;
        // Keyless GoPay leg from the same chain.
        return lookupGoPayGames(playerId, zoneId);
      },
    ],
  );

  assert.equal(primaryCalls, 1, "the self-reliant primary should be attempted once");
  assert.equal(resolution.primary.kind, "success", "live CodaShop direct primary did not return a usable IGN");
  assert.equal(resolution.confirmed?.kind, "success");
  assert.equal(resolution.confirmed?.source, "codashop_direct");
  assert.ok(isUsableNickname(resolution.confirmed?.nickname), "primary returned an unusable/placeholder nickname");

  // Keep live-test telemetry useful without logging player identifiers or nicknames.
  console.log(JSON.stringify({
    test: "self-reliant-primary-live",
    primary: resolution.primary.kind,
    secondaryCalls,
    selectedSource: resolution.confirmed.source,
    elapsedMs: Math.round(performance.now() - startedAt),
    passed: true,
  }));
});
