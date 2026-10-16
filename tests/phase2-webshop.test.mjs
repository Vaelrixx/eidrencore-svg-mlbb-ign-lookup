import test from "node:test";
import assert from "node:assert/strict";
import { createProviderCache } from "../src/app/api/lookup/providers/provider-cache.mjs";
import {
  classifyNeferbyteResponse,
  lookupNeferbyteMlbb,
} from "../src/app/api/lookup/providers/neferbyte-mlbb.mjs";
import {
  lookupRoneHeroes,
  lookupRoneHeroDetail,
  lookupRoneMetaRank,
  normalizeHeroIdentifier,
} from "../src/app/api/lookup/providers/rone-mlbb.mjs";
import {
  lookupFreeFireProfile,
  lookupFreeFireStats,
  normalizeFreeFireUid,
} from "../src/app/api/lookup/providers/freefire-community.mjs";
import {
  classifyMidasbuyResponse,
  lookupMidasbuyPlayer,
  normalizePubgPlayerId,
} from "../src/app/api/lookup/providers/midasbuy-pubg.mjs";

function jsonResponse(status, payload) {
  return { status, json: async () => payload };
}

// --- Neferbyte MLBB fallback ---

test("neferbyte success requires the documented envelope", () => {
  assert.deepEqual(
    classifyNeferbyteResponse(200, { success: true, data: { game: "Mobile Legends", userId: "1", username: "NeferKing" } }),
    { kind: "success", nickname: "NeferKing", source: "neferbyte_game_id_checker" },
  );
  assert.deepEqual(
    classifyNeferbyteResponse(200, { error: true, msg: "Authentication is required." }),
    { kind: "unavailable", diagnostic: { reason: "http_error", statusCode: 200 } },
  );
  assert.deepEqual(
    classifyNeferbyteResponse(200, { error: true, msg: "User not found" }),
    { kind: "not_found" },
  );
  assert.deepEqual(classifyNeferbyteResponse(429, {}), {
    kind: "rate_limited",
    diagnostic: { reason: "http_error", statusCode: 429 },
  });
});

test("neferbyte lookup sends x-api-key and fails closed without one", async () => {
  let seenUrl = "";
  let seenKey = "";
  const fetchImpl = async (url, init) => {
    seenUrl = String(url);
    seenKey = init.headers["x-api-key"];
    return jsonResponse(200, { success: true, data: { game: "Mobile Legends", userId: "1", username: "N" } });
  };
  const attempt = await lookupNeferbyteMlbb("1393323764", "15748", {
    fetchImpl,
    env: { NEFERBYTE_API_KEY: "unit-key" },
  });
  assert.equal(attempt.kind, "success");
  assert.equal(seenUrl, "https://api.neferbyte.com/game-id-checker/mobile-legends/1393323764/15748");
  assert.equal(seenKey, "unit-key");
  assert.ok(!JSON.stringify(attempt).includes("unit-key"));

  let fetchCalled = false;
  const missing = await lookupNeferbyteMlbb("1", "2", {
    fetchImpl: async () => {
      fetchCalled = true;
      return jsonResponse(200, {});
    },
    env: { NEFERBYTE_API_KEY: "" },
  });
  assert.deepEqual(missing, { kind: "unavailable", diagnostic: { reason: "missing_config" } });
  assert.equal(fetchCalled, false);
});

// --- Rone Arena MLBB meta ---

test("hero identifiers accept ids and slugs only", () => {
  assert.equal(normalizeHeroIdentifier(1), "1");
  assert.equal(normalizeHeroIdentifier("miya"), "miya");
  assert.equal(normalizeHeroIdentifier("  Ling-1 "), "Ling-1");
  assert.equal(normalizeHeroIdentifier("../etc"), "");
  assert.equal(normalizeHeroIdentifier("a/b"), "");
  assert.equal(normalizeHeroIdentifier(""), "");
  assert.equal(normalizeHeroIdentifier(null), "");
});

test("rone heroes list summarizes id and name and caches", async () => {
  let calls = 0;
  const cache = createProviderCache();
  const fetchImpl = async () => {
    calls += 1;
    return jsonResponse(200, {
      code: 0,
      message: "OK",
      data: {
        records: [
          { hero_id: 133, data: { hero: { data: { name: "Hirara" } } } },
          { hero_id: 1, data: { hero: { data: { name: "Miya" } } } },
          { nope: true },
        ],
      },
    });
  };
  const first = await lookupRoneHeroes({ fetchImpl, cache, env: {} });
  assert.equal(first.kind, "success");
  assert.deepEqual(first.heroes, [{ id: 133, name: "Hirara" }, { id: 1, name: "Miya" }]);
  assert.equal(first.cached, false);
  const second = await lookupRoneHeroes({ fetchImpl, cache, env: {} });
  assert.equal(second.cached, true);
  assert.equal(calls, 1);
});

test("rone hero detail degrades failed legs to empty lists", async () => {
  const fetchImpl = async (url) => {
    if (String(url).endsWith("/api/heroes/1")) {
      return jsonResponse(200, { code: 0, message: "OK", data: { records: [{ hero_id: 1, data: { hero: { data: { name: "Miya" } } } }] } });
    }
    if (String(url).endsWith("/counters")) {
      return jsonResponse(200, { code: 0, message: "OK", data: { records: [{ hero_id: 2, data: { hero: { data: { name: "Ling" } } } }] } });
    }
    return jsonResponse(500, { code: 1 });
  };
  const attempt = await lookupRoneHeroDetail("1", { fetchImpl, cache: createProviderCache(), env: {} });
  assert.equal(attempt.kind, "success");
  assert.deepEqual(attempt.hero, { id: 1, name: "Miya" });
  assert.deepEqual(attempt.counters, [{ id: 2, name: "Ling" }]);
  assert.deepEqual(attempt.teammates, []);

  const missing = await lookupRoneHeroDetail("999999", {
    fetchImpl: async () => jsonResponse(404, { code: 404 }),
    cache: createProviderCache(),
    env: {},
  });
  assert.equal(missing.kind, "not_found");
});

test("rone meta rank maps entries with ranks", async () => {
  const fetchImpl = async () => jsonResponse(200, {
    code: 0,
    message: "OK",
    data: { records: [{ rank: 1, hero_id: 1, data: { hero: { data: { name: "Miya" } } } }] },
  });
  const attempt = await lookupRoneMetaRank({ fetchImpl, cache: createProviderCache(), env: {} });
  assert.equal(attempt.kind, "success");
  assert.deepEqual(attempt.entries, [{ id: 1, name: "Miya", rank: 1 }]);
});

// --- Free Fire Community API ---

test("free fire uids accept digits only", () => {
  assert.equal(normalizeFreeFireUid("1958604115"), "1958604115");
  assert.equal(normalizeFreeFireUid(" 1234 "), "1234");
  assert.equal(normalizeFreeFireUid("abc"), "");
  assert.equal(normalizeFreeFireUid("12"), "");
  assert.equal(normalizeFreeFireUid(null), "");
});

test("free fire profile summarizes identity and clan", async () => {
  const fetchImpl = async (url, init) => {
    assert.equal(init.headers["x-api-key"], "ff-key");
    assert.ok(String(url).includes("/api/v1/info?uid=1958604115"));
    return jsonResponse(200, {
      data: { nickname: "FFPlayer", uid: "1958604115", level: 70, likes: 5000, region: "IND", clan: { name: "Guild", id: "G1" } },
    });
  };
  const attempt = await lookupFreeFireProfile("1958604115", {
    fetchImpl,
    env: { FREEFIRE_COMMUNITY_API_KEY: "ff-key" },
    cache: createProviderCache(),
  });
  assert.equal(attempt.kind, "success");
  assert.deepEqual(attempt.profile, {
    nickname: "FFPlayer",
    uid: "1958604115",
    level: 70,
    likes: 5000,
    region: "IND",
    clan: { name: "Guild", id: "G1" },
  });
  assert.ok(!JSON.stringify(attempt).includes("ff-key"));
});

test("free fire stats summarize per-mode tables", async () => {
  const fetchImpl = async () => jsonResponse(200, {
    data: {
      solo: { games: 100, wins: 10, kills: 300, damage: 50000 },
      duo: { games: 50, wins: 5, kills: 120, damage: 20000 },
    },
  });
  const attempt = await lookupFreeFireStats("1958604115", {
    fetchImpl,
    env: { FREEFIRE_COMMUNITY_API_KEY: "k" },
    cache: createProviderCache(),
  });
  assert.equal(attempt.kind, "success");
  assert.deepEqual(attempt.stats.modes.solo, { games: 100, wins: 10, kills: 300, damage: 50000 });
  assert.deepEqual(attempt.stats.modes.duo, { games: 50, wins: 5, kills: 120, damage: 20000 });
});

test("free fire lookup fails closed without a key and caches per uid", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return jsonResponse(200, { data: { nickname: "N" } });
  };
  const missing = await lookupFreeFireProfile("1234", { fetchImpl, env: {}, cache: createProviderCache() });
  assert.deepEqual(missing, { kind: "unavailable", diagnostic: { reason: "missing_config" } });
  assert.equal(calls, 0);

  const cache = createProviderCache();
  const env = { FREEFIRE_COMMUNITY_API_KEY: "k" };
  await lookupFreeFireProfile("1234", { fetchImpl, env, cache });
  await lookupFreeFireProfile("1234", { fetchImpl, env, cache });
  assert.equal(calls, 1);
});

// --- Midasbuy PUBG verification ---

test("pubg player ids accept digits only", () => {
  assert.equal(normalizePubgPlayerId("5204837417"), "5204837417");
  assert.equal(normalizePubgPlayerId("12"), "");
  assert.equal(normalizePubgPlayerId("abc"), "");
});

test("midasbuy classification requires a player name", () => {
  assert.deepEqual(
    classifyMidasbuyResponse(200, { player_name: "hoosnick", player_id: "1", status: "ok" }),
    { kind: "success", nickname: "hoosnick", source: "midasbuy_api" },
  );
  assert.deepEqual(classifyMidasbuyResponse(200, { status: "error", message: "Player not found" }), { kind: "not_found" });
  assert.deepEqual(classifyMidasbuyResponse(401, {}), {
    kind: "rate_limited",
    diagnostic: { reason: "http_error", statusCode: 401 },
  });
});

test("midasbuy verify posts player_id with X-Api-Key and caches", async () => {
  let calls = 0;
  const cache = createProviderCache();
  const fetchImpl = async (url, init) => {
    calls += 1;
    assert.equal(String(url), "https://midasbuy.night-apis.com/api/v1/pubg/getPlayer");
    assert.equal(init.method, "POST");
    assert.equal(init.headers["X-Api-Key"], "mb-key");
    assert.deepEqual(JSON.parse(init.body), { player_id: "5204837417" });
    return jsonResponse(200, { player_name: "Verified", player_id: "5204837417" });
  };
  const env = { MIDASBUY_API_KEY: "mb-key" };
  const first = await lookupMidasbuyPlayer("5204837417", { fetchImpl, env, cache });
  assert.equal(first.kind, "success");
  assert.equal(first.cached, false);
  const second = await lookupMidasbuyPlayer("5204837417", { fetchImpl, env, cache });
  assert.equal(second.cached, true);
  assert.equal(calls, 1);
  assert.ok(!JSON.stringify(second).includes("mb-key"));

  const missing = await lookupMidasbuyPlayer("5204837417", { fetchImpl, env: {}, cache: createProviderCache() });
  assert.deepEqual(missing, { kind: "unavailable", diagnostic: { reason: "missing_config" } });
});
