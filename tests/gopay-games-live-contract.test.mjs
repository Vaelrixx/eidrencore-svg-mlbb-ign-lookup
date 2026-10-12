import test from "node:test";
import assert from "node:assert/strict";
import { lookupGoPayGames } from "../src/app/api/lookup/providers/gopay-games.mjs";

const enabled = process.env.RUN_LIVE_PROVIDER_CONTRACTS === "1";
const playerId = process.env.LIVE_LOOKUP_PLAYER_ID ?? "1114917746";
const zoneId = process.env.LIVE_LOOKUP_ZONE_ID ?? "13486";
const invalidPlayerId = process.env.LIVE_LOOKUP_INVALID_PLAYER_ID ?? "1000000000";
const invalidZoneId = process.env.LIVE_LOOKUP_INVALID_ZONE_ID ?? "10000";

test("live GoPay contract confirms a known-valid fixture", { skip: !enabled }, async () => {
  const result = await lookupGoPayGames(playerId, zoneId);
  assert.equal(result.kind, "success", "provider contract should confirm the known-valid fixture");
  assert.ok(result.nickname.length > 0);
  assert.notEqual(result.nickname.trim().toLowerCase(), "n/a");
});

test("live GoPay contract recognizes only the explicit invalid-account response", { skip: !enabled }, async () => {
  const result = await lookupGoPayGames(invalidPlayerId, invalidZoneId);
  assert.deepEqual(result, { kind: "not_found" });
});
