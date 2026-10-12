import test from "node:test";
import assert from "node:assert/strict";
import { fetchSupercellPath } from "../src/app/api/lookup/providers/supercell.mjs";
import {
  classifyClanResponse as classifyCrClan,
  lookupClashRoyaleClan,
} from "../src/app/api/lookup/providers/clash-royale-clan.mjs";
import {
  classifyBattlelogResponse as classifyCrBattles,
  lookupClashRoyaleBattlelog,
} from "../src/app/api/lookup/providers/clash-royale-battles.mjs";
import {
  classifyClanResponse as classifyCocClan,
  lookupClashOfClansClan,
} from "../src/app/api/lookup/providers/clash-of-clans-clan.mjs";
import {
  classifyWarlogResponse,
  lookupClashOfClansWarlog,
} from "../src/app/api/lookup/providers/clash-of-clans-warlog.mjs";
import {
  classifyClubResponse,
  lookupBrawlStarsClub,
} from "../src/app/api/lookup/providers/brawl-stars-club.mjs";
import {
  classifyBattlelogResponse as classifyBsBattles,
  lookupBrawlStarsBattlelog,
} from "../src/app/api/lookup/providers/brawl-stars-battles.mjs";
import {
  classifyRankingsResponse,
  lookupSupercellRankings,
  normalizeLocationId,
} from "../src/app/api/lookup/providers/supercell-rankings.mjs";

test("shared fetch core returns missing_config without fetching", async () => {
  let fetchCalled = false;
  const result = await fetchSupercellPath("clash-royale", "/v1/clans/%232PP", {
    env: { CLASH_ROYALE_API_KEY: "" },
    fetchImpl: async () => {
      fetchCalled = true;
      throw new Error("unexpected fetch");
    },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.attempt, { kind: "unavailable", diagnostic: { reason: "missing_config" } });
  assert.equal(fetchCalled, false);
});

test("shared fetch core returns network failures as unavailable", async () => {
  const result = await fetchSupercellPath("brawl-stars", "/v1/clubs/%232PP", {
    env: { BRAWL_STARS_API_KEY: "unit-test-key" },
    fetchImpl: async () => { throw new Error("boom"); },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.attempt, { kind: "unavailable", diagnostic: { reason: "network_or_timeout" } });
});

test("clan adapters hit the right upstream path with a bearer key", async () => {
  const cases = [
    { lookup: lookupClashRoyaleClan, envKey: "CLASH_ROYALE_API_KEY", host: "https://proxy.royaleapi.dev", path: "/v1/clans/%232PP" },
    { lookup: lookupClashOfClansClan, envKey: "CLASH_OF_CLANS_API_KEY", host: "https://cocproxy.royaleapi.dev", path: "/v1/clans/%232PP" },
    { lookup: lookupBrawlStarsClub, envKey: "BRAWL_STARS_API_KEY", host: "https://bsproxy.royaleapi.dev", path: "/v1/clubs/%232PP" },
  ];
  for (const { lookup, envKey, host, path } of cases) {
    let requestedUrl = "";
    let requestedAuth = "";
    const result = await lookup("#2pp", {
      env: { [envKey]: "unit-test-key" },
      fetchImpl: async (url, init) => {
        requestedUrl = String(url);
        requestedAuth = init?.headers?.Authorization ?? "";
        return new Response(JSON.stringify({ tag: "#2PP", name: "Test Group", members: 12 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });
    assert.equal(result.kind, "success");
    assert.equal(requestedUrl, `${host}${path}`);
    assert.equal(requestedAuth, "Bearer unit-test-key");
    assert.equal(JSON.stringify(result).includes("unit-test-key"), false);
  }
});

test("clan classification accepts names and rejects nameless payloads", () => {
  const good = { tag: "#2PP", name: "Test Clan", members: 30, clanScore: 50000 };
  assert.equal(classifyCrClan(200, good, "clash_royale_official_api").kind, "success");
  assert.equal(classifyCocClan(200, good, "clash_of_clans_official_api").kind, "success");
  assert.equal(classifyClubResponse(200, good, "brawl_stars_official_api").kind, "success");
  assert.deepEqual(
    classifyCrClan(404, { reason: "notFound" }, "clash_royale_official_api"),
    { kind: "not_found" },
  );
  assert.equal(
    classifyCocClan(200, { tag: "#2PP", name: "" }, "clash_of_clans_official_api").kind,
    "unavailable",
  );
  assert.deepEqual(
    classifyClubResponse(429, {}, "brawl_stars_official_api"),
    { kind: "rate_limited", diagnostic: { reason: "http_error", statusCode: 429 } },
  );
});

test("battle and war history adapters hit the right upstream paths", async () => {
  const battle = { type: "PvP", battleTime: "20240101T000000.000Z", team: [{ name: "A" }], opponent: [{ name: "B" }], teamCrowns: 3, opponentCrowns: 1 };
  const cr = await lookupClashRoyaleBattlelog("#C0G20PR2", {
    env: { CLASH_ROYALE_API_KEY: "unit-test-key" },
    fetchImpl: async (url) => {
      assert.equal(String(url), "https://proxy.royaleapi.dev/v1/players/%23C0G20PR2/battlelog");
      return new Response(JSON.stringify([battle]), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  assert.equal(cr.kind, "success");
  assert.equal(cr.battles.length, 1);
  assert.equal(cr.battles[0].teamCrowns, 3);

  const bs = await lookupBrawlStarsBattlelog("#2PP", {
    env: { BRAWL_STARS_API_KEY: "unit-test-key" },
    fetchImpl: async (url) => {
      assert.equal(String(url), "https://bsproxy.royaleapi.dev/v1/players/%232PP/battlelog");
      return new Response(JSON.stringify({ items: [{ battleTime: "t", battle: { mode: "Gem Grab", result: "victory" }, event: { map: "Hard Rock Mine" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  assert.equal(bs.kind, "success");
  assert.equal(bs.battles[0].result, "victory");

  const coc = await lookupClashOfClansWarlog("#2PP", {
    env: { CLASH_OF_CLANS_API_KEY: "unit-test-key" },
    fetchImpl: async (url) => {
      assert.equal(String(url), "https://cocproxy.royaleapi.dev/v1/clans/%232PP/warlog");
      return new Response(JSON.stringify({ items: [{ result: "win", endTime: "t", opponent: { name: "Foe", stars: 10 }, clan: { stars: 30 } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  assert.equal(coc.kind, "success");
  assert.equal(coc.wars[0].result, "win");
});

test("history classification bounds lists and handles not-found", () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ type: "PvP", battleTime: `t${i}`, team: [], opponent: [] }));
  const cr = classifyCrBattles(200, many, "clash_royale_official_api");
  assert.equal(cr.kind, "success");
  assert.equal(cr.battles.length, 25);
  assert.deepEqual(
    classifyCrBattles(404, { reason: "notFound" }, "clash_royale_official_api"),
    { kind: "not_found" },
  );
  assert.equal(
    classifyBsBattles(200, { nope: true }, "brawl_stars_official_api").kind,
    "unavailable",
  );
  assert.equal(
    classifyWarlogResponse(200, { items: [] }, "clash_of_clans_official_api").wars.length,
    0,
  );
});

test("location IDs normalize and reject unsafe input", () => {
  assert.equal(normalizeLocationId("global"), "global");
  assert.equal(normalizeLocationId("  GLOBAL "), "global");
  assert.equal(normalizeLocationId("57000000"), "57000000");
  assert.equal(normalizeLocationId(""), "");
  assert.equal(normalizeLocationId("../etc"), "");
  assert.equal(normalizeLocationId("global?x=1"), "");
  assert.equal(normalizeLocationId(null), "");
});

test("rankings adapters hit per-game paths with bounded limits", async () => {
  const cases = [
    { game: "clash-royale", host: "https://proxy.royaleapi.dev", path: "/v1/locations/global/rankings/players?limit=25", envKey: "CLASH_ROYALE_API_KEY" },
    { game: "clash-of-clans", host: "https://cocproxy.royaleapi.dev", path: "/v1/locations/global/rankings/players?limit=25", envKey: "CLASH_OF_CLANS_API_KEY" },
    { game: "brawl-stars", host: "https://bsproxy.royaleapi.dev", path: "/v1/rankings/global/players?limit=25", envKey: "BRAWL_STARS_API_KEY" },
  ];
  for (const { game, host, path, envKey } of cases) {
    const result = await lookupSupercellRankings(game, "global", {
      env: { [envKey]: "unit-test-key" },
      fetchImpl: async (url, init) => {
        assert.equal(String(url), `${host}${path}`);
        assert.equal(init?.headers?.Authorization, "Bearer unit-test-key");
        return new Response(JSON.stringify({ items: [{ rank: 1, name: "Top", tag: "#AAA", trophies: 9000 }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });
    assert.equal(result.kind, "success");
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].name, "Top");
    assert.equal(JSON.stringify(result).includes("unit-test-key"), false);
  }
});

test("rankings classification bounds entries and handles errors", () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ rank: i + 1, name: `P${i}` }));
  const ok = classifyRankingsResponse(200, { items: many }, "x", "clash-royale");
  assert.equal(ok.kind, "success");
  assert.equal(ok.entries.length, 25);
  assert.deepEqual(
    classifyRankingsResponse(404, { reason: "notFound" }, "x", "clash-royale"),
    { kind: "not_found" },
  );
  assert.deepEqual(
    classifyRankingsResponse(403, {}, "x", "brawl-stars"),
    { kind: "rate_limited", diagnostic: { reason: "http_error", statusCode: 403 } },
  );
  assert.equal(
    classifyRankingsResponse(200, { items: "nope" }, "x", "clash-of-clans").kind,
    "unavailable",
  );
});

test("expansion adapters never leak credentials in results", async () => {
  const result = await lookupSupercellRankings("clash-royale", "global", {
    env: { CLASH_ROYALE_API_KEY: "unit-test-key" },
    fetchImpl: async () => { throw new Error("sensitive"); },
  });
  assert.deepEqual(result, { kind: "unavailable", diagnostic: { reason: "network_or_timeout" } });
  assert.equal(JSON.stringify(result).includes("unit-test-key"), false);
});
