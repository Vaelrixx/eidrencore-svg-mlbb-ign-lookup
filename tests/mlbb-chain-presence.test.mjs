import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Additive-motto guard: the MLBB chain must keep every verified and new leg.
// Catches accidental removal of any leg (especially the RapidAPI broker)
// from either the single route or its bulk mirror.
const routeSrc = readFileSync(
  new URL("../src/app/api/lookup/route.ts", import.meta.url),
  "utf8",
);
const bulkSrc = readFileSync(
  new URL("../src/app/api/lookup/bulk-games.mjs", import.meta.url),
  "utf8",
);

function lookupMlbbRegion() {
  const start = bulkSrc.indexOf("async function lookupMlbb");
  assert.notEqual(start, -1, "bulk mirror must keep lookupMlbb");
  const end = bulkSrc.indexOf("const identityGame", start);
  assert.ok(end > start, "lookupMlbb region must be bounded");
  return bulkSrc.slice(start, end);
}

test("single route keeps the RapidAPI broker leg in the MLBB fallback pool", () => {
  assert.ok(
    routeSrc.includes("lookupRapidApi(playerId, zoneId)"),
    "route.ts must still call lookupRapidApi(playerId, zoneId) for MLBB",
  );
  assert.ok(
    routeSrc.includes("rapidapi_id_game_checker"),
    "route.ts must still label the RapidAPI broker provider",
  );
});

test("single route keeps the full additive MLBB chain", () => {
  for (const leg of [
    'lookupCodashopDirect("mobile-legends"',
    "lookupRapidApi(playerId, zoneId)",
    "lookupVolseverMlbb(playerId, zoneId)",
    "lookupIsan(playerId, zoneId)",
    "lookupWhoPlays(playerId, zoneId)",
    "lookupGoPayGames(playerId, zoneId)",
  ]) {
    assert.ok(routeSrc.includes(leg), `route.ts is missing MLBB leg: ${leg}`);
  }
});

test("bulk mirror keeps the RapidAPI broker leg for MLBB", () => {
  const region = lookupMlbbRegion();
  assert.ok(
    region.includes("lookupRapidApi(input.playerId, input.zoneId)"),
    "bulk lookupMlbb must still call the RapidAPI broker leg",
  );
});

test("bulk mirror keeps the full additive MLBB chain", () => {
  const region = lookupMlbbRegion();
  for (const leg of [
    'lookupCodashopDirect("mobile-legends"',
    "lookupRapidApi(input.playerId, input.zoneId)",
    "lookupVolseverMlbb(input.playerId, input.zoneId)",
    "lookupIsan(input.playerId, input.zoneId)",
    "lookupWhoPlays(input.playerId, input.zoneId)",
    "lookupGoPayGames(input.playerId, input.zoneId)",
  ]) {
    assert.ok(region.includes(leg), `bulk lookupMlbb is missing MLBB leg: ${leg}`);
  }
});
