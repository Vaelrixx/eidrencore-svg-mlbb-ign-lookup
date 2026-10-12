import test from "node:test";
import assert from "node:assert/strict";
import { lookupRapidApiGame, rapidApiGamePath } from "../src/app/api/lookup/providers/rapidapi-games.mjs";

const largeHonorOfKingsId = "17960996468644334000";
const fixtures = [
  ["pubg-mobile", { playerId: "5204837417" }, "/pubgm-global/5204837417"],
  ["cod-mobile-garena", { playerId: "8370310025568788000" }, "/cod-mobile/8370310025568788000"],
  ["valorant", { name: "ucup", tag: "123" }, "/valorant/ucup/123"],
  ["genshin-impact", { playerId: "844335555", server: "asia" }, "/genshin/844335555/asia"],
  ["honor-of-kings", { playerId: largeHonorOfKingsId }, `/honor-of-kings/${largeHonorOfKingsId}`],
];

test("builds paths for the five confirmed game operations in documented field order", () => {
  for (const [game, input, expected] of fixtures) {
    assert.equal(rapidApiGamePath(game, input), expected, game);
  }
});

test("keeps large account IDs byte-for-byte as strings and rejects numeric inputs", () => {
  assert.equal(
    rapidApiGamePath("honor-of-kings", { playerId: largeHonorOfKingsId }),
    `/honor-of-kings/${largeHonorOfKingsId}`,
  );
  assert.equal(
    rapidApiGamePath("honor-of-kings", { playerId: Number(largeHonorOfKingsId) }),
    null,
  );
  assert.equal(
    rapidApiGamePath("cod-mobile-garena", { playerId: "8370310025568788000" }),
    "/cod-mobile/8370310025568788000",
  );
});

test("encodes every variable path segment", () => {
  assert.equal(rapidApiGamePath("valorant", { name: "My Name", tag: "A B" }), "/valorant/My%20Name/A%20B");
});

test("rejects unsupported games and incomplete inputs before any fetch", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; throw new Error("unexpected fetch"); };
  assert.equal(rapidApiGamePath("free-fire", { playerId: "1958604115" }), null);
  assert.equal(rapidApiGamePath("unknown", { playerId: "1234" }), null);
  assert.equal(rapidApiGamePath("genshin-impact", { playerId: "844335555" }), null);
  assert.equal(rapidApiGamePath("genshin-impact", { playerId: "844335555", server: "mars" }), null);
  assert.deepEqual(await lookupRapidApiGame("genshin-impact", { playerId: "844335555" }, { apiKey: "test-key", fetchImpl }), {
    kind: "unavailable",
    diagnostic: { reason: "invalid_input" },
  });
  assert.deepEqual(await lookupRapidApiGame("valorant", { name: "ucup" }, { apiKey: "test-key", fetchImpl }), {
    kind: "unavailable",
    diagnostic: { reason: "invalid_input" },
  });
  assert.equal(calls, 0);
});

test("normalizes the documented PUBG and Honor of Kings success examples", async () => {
  const calls = [];
  const responses = [
    {
      game: "pubg-mobile",
      input: { playerId: "5204837417" },
      body: { success: true, data: { game: "PUBG Mobile", userId: "5204837417", username: "PubgPlayer" } },
      expectedUrl: "https://id-game-checker.p.rapidapi.com/pubgm-global/5204837417",
      nickname: "PubgPlayer",
    },
    {
      game: "honor-of-kings",
      input: { playerId: largeHonorOfKingsId },
      body: { error: false, status: 200, msg: "id_found", data: { id: largeHonorOfKingsId, username: "HonorPlayer" } },
      expectedUrl: `https://id-game-checker.p.rapidapi.com/honor-of-kings/${largeHonorOfKingsId}`,
      nickname: "HonorPlayer",
    },
  ];

  for (const fixture of responses) {
    const result = await lookupRapidApiGame(fixture.game, fixture.input, {
      apiKey: "test-key",
      fetchImpl: async (url, options) => {
        calls.push({ url: String(url), options });
        return new Response(JSON.stringify(fixture.body), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    });
    assert.deepEqual(result, { kind: "success", nickname: fixture.nickname, source: "rapidapi_id_game_checker" });
    const request = calls.at(-1);
    assert.equal(request.url, fixture.expectedUrl);
    assert.equal(request.options.headers["x-rapidapi-host"], "id-game-checker.p.rapidapi.com");
    assert.equal(request.options.headers["x-rapidapi-key"], "test-key");
    assert.equal(request.options.method, "GET");
  }
});

test("passes the required Genshin region and preserves its UID in the generated URL", async () => {
  let capturedUrl;
  const result = await lookupRapidApiGame("genshin-impact", { playerId: "844335555", server: "asia" }, {
    apiKey: "test-key",
    fetchImpl: async (url) => {
      capturedUrl = String(url);
      // Generic shared-envelope fixture only; the public Genshin page has no static response example.
      return new Response(JSON.stringify({ error: false, status: 200, msg: "id_found", data: { username: "Traveler" } }), { status: 200 });
    },
  });
  assert.equal(capturedUrl, "https://id-game-checker.p.rapidapi.com/genshin/844335555/asia");
  assert.deepEqual(result, { kind: "success", nickname: "Traveler", source: "rapidapi_id_game_checker" });
});

test("does not infer not-found from an unstructured HTTP 404", async () => {
  const response = (payload, status = 404) => async () => new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
  const explicitMissing = await lookupRapidApiGame("pubg-mobile", { playerId: "5204837417" }, {
    apiKey: "test-key",
    fetchImpl: response({ error: true, status: 404, msg: "id_not_found" }),
  });
  assert.deepEqual(explicitMissing, { kind: "not_found" });

  const gateway404 = await lookupRapidApiGame("pubg-mobile", { playerId: "5204837417" }, {
    apiKey: "test-key",
    fetchImpl: response({ message: "not found" }),
  });
  assert.equal(gateway404.kind, "unavailable");
});

test("maps rate limits and provider/network errors to sanitized attempts", async () => {
  const rateLimited = await lookupRapidApiGame("valorant", { name: "ucup", tag: "123" }, {
    apiKey: "secret-test-key",
    fetchImpl: async () => new Response(JSON.stringify({ error: true, msg: "rate limit" }), { status: 429 }),
  });
  assert.equal(rateLimited.kind, "rate_limited");
  assert.equal(JSON.stringify(rateLimited).includes("secret-test-key"), false);

  const timeout = await lookupRapidApiGame("genshin-impact", { playerId: "844335555", server: "asia" }, {
    apiKey: "secret-test-key",
    fetchImpl: async () => { throw new Error("transport details"); },
  });
  assert.deepEqual(timeout, { kind: "unavailable", diagnostic: { reason: "network_or_timeout" } });
});
