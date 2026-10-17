import test from "node:test";
import assert from "node:assert/strict";
import { BULK_CONCURRENCY, BULK_GAMES, BULK_MAX_BYTES, BULK_MAX_ITEMS, bulkGameSlugs } from "../src/app/api/lookup/bulk-games.mjs";

test("bulk registry covers every live lookup route", () => {
  const slugs = bulkGameSlugs();
  assert.equal(slugs.length, 37);
  for (const slug of ["mlbb", "pubg-mobile", "call-of-duty-mobile", "valorant", "genshin-impact",
    "honkai-star-rail", "zenless-zone-zero", "honor-of-kings", "arena-of-valor", "pubg-lite",
    "teen-patti-gold", "jawaker", "fc-mobile", "free-fire", "free-fire-global", "bigo-live",
    "higgs-domino", "brawl-stars", "clash-of-clans", "clash-royale",
    "8-ball-pool", "arena-breakout", "blood-strike", "delta-force", "delta-force-garena",
    "eggy-party", "ace-racer", "dragon-raja", "metal-slug", "lifeafter", "one-punch-man",
    "pokemon-unite", "whiteout-survival", "hay-day", "magic-chess", "speed-drifters", "undawn"]) {
    assert.ok(slugs.includes(slug), `missing bulk game: ${slug}`);
  }
});

test("bulk limits protect upstream providers", () => {
  assert.equal(BULK_MAX_ITEMS, 100);
  assert.equal(BULK_MAX_BYTES, 131072);
  assert.equal(BULK_CONCURRENCY, 10);
});

test("every bulk entry mirrors its single-route contract", () => {
  for (const [slug, entry] of Object.entries(BULK_GAMES)) {
    assert.equal(typeof entry.gameLabel, "string", slug);
    assert.equal(typeof entry.publicSource, "string", slug);
    assert.equal(typeof entry.notFoundCode, "string", slug);
    assert.ok(Array.isArray(entry.fields) && entry.fields.length >= 1, slug);
    assert.equal(typeof entry.validate, "function", slug);
    assert.equal(typeof entry.lookup, "function", slug);
  }
});

test("bulk validators accept documented samples and reject junk", () => {
  assert.deepEqual(BULK_GAMES.mlbb.validate({ playerId: "1114917746", zoneId: "13486" }), { playerId: "1114917746", zoneId: "13486" });
  assert.equal(BULK_GAMES.mlbb.validate({ playerId: "abc", zoneId: "13486" }), null);
  assert.equal(BULK_GAMES.mlbb.validate({ playerId: "1114917746" }), null);
  assert.deepEqual(BULK_GAMES.valorant.validate({ name: "ucup", tag: "123" }), { name: "ucup", tag: "123" });
  assert.equal(BULK_GAMES.valorant.validate({ name: "x", tag: "123" }), null);
  assert.deepEqual(BULK_GAMES["genshin-impact"].validate({ playerId: "844335555", server: "asia" }), { playerId: "844335555", server: "asia" });
  assert.equal(BULK_GAMES["genshin-impact"].validate({ playerId: "844335555", server: "mars" }), null);
  assert.deepEqual(BULK_GAMES["brawl-stars"].validate({ tag: "#2PP" }), { tag: "#2PP" });
  assert.deepEqual(BULK_GAMES["brawl-stars"].validate({ tag: "2pp" }), { tag: "#2PP" });
  assert.equal(BULK_GAMES["brawl-stars"].validate({ tag: "!!!" }), null);
  assert.deepEqual(BULK_GAMES["free-fire"].validate({ playerId: "1958604115" }), { playerId: "1958604115" });
  assert.equal(BULK_GAMES["free-fire"].validate({ playerId: "12" }), null);
  assert.deepEqual(BULK_GAMES["call-of-duty-mobile"].validate({ playerId: "ShadowHex" }), { playerId: "ShadowHex" });
});
