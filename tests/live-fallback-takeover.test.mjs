import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { isUsableNickname } from "../src/app/api/lookup/nickname-validation.mjs";
import { resolveLookupWithFallbacks } from "../src/app/api/lookup/resolve-lookup.mjs";
import { lookupIsan } from "../src/app/api/lookup/providers/isan.mjs";

const playerId = process.env.LIVE_LOOKUP_PLAYER_ID ?? "1114917746";
const zoneId = process.env.LIVE_LOOKUP_ZONE_ID ?? "13486";

test("real Isan secondary takes over after a simulated primary outage", async () => {
  const startedAt = performance.now();
  let primaryCalls = 0;
  let secondaryCalls = 0;

  const resolution = await resolveLookupWithFallbacks(
    async () => {
      primaryCalls += 1;
      // Controlled fault injection: simulate the primary returning unavailable.
      return { kind: "unavailable" };
    },
    [
      async () => {
        secondaryCalls += 1;
        // This is the same live provider adapter wired into route.ts.
        return lookupIsan(playerId, zoneId);
      },
    ],
  );

  assert.equal(primaryCalls, 1, "the simulated primary should be attempted once");
  assert.equal(resolution.primary.kind, "unavailable");
  assert.equal(secondaryCalls, 1, "the real secondary adapter should be called once");
  assert.equal(resolution.fallbacks.length, 1);
  assert.equal(resolution.fallbacks[0]?.kind, "success", "live secondary provider did not return a usable IGN");
  assert.equal(resolution.confirmed?.kind, "success");
  assert.equal(resolution.confirmed?.source, "isan_nickname_api");
  assert.ok(isUsableNickname(resolution.confirmed?.nickname), "secondary returned an unusable/placeholder nickname");

  console.log(JSON.stringify({
    test: "real-secondary-takeover",
    simulatedPrimary: resolution.primary.kind,
    selectedSource: resolution.confirmed.source,
    nickname: resolution.confirmed.nickname,
    playerId,
    zoneId,
    elapsedMs: Math.round(performance.now() - startedAt),
    passed: true,
  }));
});
