import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Additive-motto guard: the Genshin chain must keep its keyed broker leg
// and its Enka leg. Catches accidental removal of either leg (especially
// the RapidAPI broker) from the single route or its bulk mirror. The
// CodaShop initpay leg was probed live 2026-10-18 and SKIPPED (no honest
// valid-vs-bogus gate: valid and bogus UIDs both return {"RESULT_CODE":239}),
// so the chain stays keyed -> Enka.
const routesSrc = readFileSync(
  new URL("../src/app/api/lookup/rapidapi-game-routes.ts", import.meta.url),
  "utf8",
);
const bulkSrc = readFileSync(
  new URL("../src/app/api/lookup/bulk-games.mjs", import.meta.url),
  "utf8",
);

function genshinRegion() {
  const start = bulkSrc.indexOf('"genshin-impact"');
  assert.notEqual(start, -1, "bulk mirror must keep the genshin-impact entry");
  const end = bulkSrc.indexOf('"honkai-star-rail"', start);
  assert.ok(end > start, "genshin-impact region must be bounded");
  return bulkSrc.slice(start, end);
}

test("single route keeps the RapidAPI broker leg for Genshin", () => {
  assert.ok(
    routesSrc.includes('lookupRapidApiGame("genshin-impact"'),
    "rapidapi-game-routes.ts must still call lookupRapidApiGame for genshin-impact",
  );
});

test("single route keeps the Enka fallback leg for Genshin", () => {
  assert.ok(
    routesSrc.includes("lookupGenshinWithFallback"),
    "rapidapi-game-routes.ts must still wire lookupGenshinWithFallback",
  );
  assert.ok(
    routesSrc.includes("lookupEnkaGenshin(playerId)"),
    "lookupGenshinWithFallback must still fall back to lookupEnkaGenshin",
  );
});

test("bulk mirror keeps the RapidAPI broker leg for Genshin", () => {
  const region = genshinRegion();
  assert.ok(
    region.includes('lookupRapidApiGame("genshin-impact"'),
    "bulk genshin-impact must still call the RapidAPI broker leg",
  );
});

test("bulk mirror keeps the Enka fallback leg for Genshin", () => {
  const region = genshinRegion();
  assert.ok(
    region.includes("lookupEnkaGenshin(input.playerId)"),
    "bulk genshin-impact must still fall back to lookupEnkaGenshin",
  );
});
