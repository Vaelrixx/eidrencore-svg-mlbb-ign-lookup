import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyGameResponseShape,
  classifyRapidApiGameResponse,
} from "../src/app/api/lookup/providers/rapidapi.mjs";
import { lookupRapidApiGame } from "../src/app/api/lookup/providers/rapidapi-games.mjs";
import { confirmedNickname } from "../src/app/api/lookup/nickname-validation.mjs";
import { observeProvider } from "../src/app/api/lookup/observability.mjs";

test("error variants with not-found wording resolve as 404 regardless of embedded status", () => {
  const variants = [
    { error: true, status: 200, msg: "id_not_found", data: {} },
    { error: true, status: 500, msg: "ID NOT FOUND", data: {} },
    { error: true, msg: "player does not exist", data: {} },
    { error: true, status: 404, message: "account not found", data: {} },
    { success: false, status: 200, msg: "user-not-found", data: {} },
    { error: true, status: 200, msg: "invalid player id", data: {} },
    { error: false, status: 200, msg: "id_found", data: { valid: false, message: "nickname not found" } },
  ];

  for (const payload of variants) {
    assert.deepEqual(classifyRapidApiGameResponse(200, payload), { kind: "not_found" });
  }
});

test("embedded 404 with an unfamiliar message stays unavailable", () => {
  const result = classifyRapidApiGameResponse(200, {
    error: true,
    status: 404,
    msg: "hok_lookup_failed",
    data: {},
  });

  assert.equal(result.kind, "unavailable");
  assert.equal(result.diagnostic.providerStatusCode, 404);
  assert.equal(result.diagnostic.reason, "unrecognized_response");
});

test("empty or unavailable nickname wording alone does not confirm a missing player", () => {
  for (const msg of ["nickname empty", "nickname unavailable"]) {
    const result = classifyRapidApiGameResponse(200, {
      error: true,
      status: 404,
      msg,
      data: {},
    });

    assert.equal(result.kind, "unavailable");
    assert.equal(result.diagnostic.providerStatusCode, 404);
  }
});

test("degraded upstream envelopes stay unavailable and keep their provider reason", () => {
  const degraded = classifyRapidApiGameResponse(200, {
    error: true,
    status: 200,
    msg: "no_content_0",
    data: {},
  });
  assert.equal(degraded.kind, "unavailable");
  assert.equal(degraded.diagnostic.reason, "provider_error");
  assert.equal(degraded.diagnostic.responseKind, "id_game_checker_schema");

  const maintenance = classifyRapidApiGameResponse(200, {
    error: true,
    status: 503,
    msg: "temporary upstream maintenance",
    data: {},
  });
  assert.equal(maintenance.kind, "unavailable");
  assert.equal(maintenance.diagnostic.reason, "provider_error");
});

test("success envelopes accept nested profile, player, and alternate nickname fields", () => {
  const payloads = [
    { error: false, status: 200, msg: "id_found", data: { profile: { displayName: "HonorPlayer" } } },
    { error: false, status: 200, msg: "id_found", data: { player: { nickname: "Traveler" } } },
    { error: false, status: 200, msg: "id_found", data: { user: { accountName: "GenshinPlayer" } } },
    { error: false, status: 200, msg: "id_found", result: { characterName: "ValorantPlayer" } },
  ];

  for (const payload of payloads) {
    const result = classifyRapidApiGameResponse(200, payload);
    assert.equal(result.kind, "success");
    assert.equal(typeof result.nickname, "string");
  }

  assert.equal(
    confirmedNickname({ error: false, status: 200, msg: "id_found", data: { profile: { displayName: "HonorPlayer" } } }),
    "HonorPlayer",
  );
});

test("CODM rejects a nickname that exactly echoes the requested player ID", async () => {
  const playerId = "8370310025568788000";
  const result = await lookupRapidApiGame("cod-mobile-garena", { playerId }, {
    apiKey: "test-key",
    fetchImpl: async () => new Response(JSON.stringify({
      error: false,
      status: 200,
      msg: "id_found",
      data: { username: playerId },
    }), { status: 200, headers: { "Content-Type": "application/json" } }),
  });

  assert.deepEqual(result, { kind: "unavailable", diagnostic: { reason: "identity_echo" } });
  assert.equal(JSON.stringify(result).includes(playerId), false);
});

test("every keyed game rejects a nickname that echoes the requested identity", async () => {
  // Live 2026-10-18: dfm-garena + speed-drifters returned the queried ID
  // verbatim for any input including bogus IDs. Exact echoes are
  // unverified on all games now, never success.
  const cases = [
    { game: "delta-force-garena", input: { playerId: "999999999999" }, echo: "999999999999" },
    { game: "speed-drifters", input: { playerId: "999999999999" }, echo: "999999999999" },
    { game: "honor-of-kings", input: { playerId: "17960996468644334037" }, echo: "17960996468644334037" },
    { game: "valorant", input: { name: "TestPlayer", tag: "1234" }, echo: "TestPlayer" },
  ];
  for (const { game, input, echo } of cases) {
    const result = await lookupRapidApiGame(game, input, {
      apiKey: "test-key",
      fetchImpl: async () => new Response(JSON.stringify({
        error: false,
        status: 200,
        msg: "id_found",
        data: { username: echo },
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    });
    assert.deepEqual(result, { kind: "unavailable", diagnostic: { reason: "identity_echo" } }, game);
  }
});

test("distinct numeric nicknames still resolve (echo guard needs an exact match)", async () => {
  const result = await lookupRapidApiGame("honor-of-kings", { playerId: "17960996468644334037" }, {
    apiKey: "test-key",
    fetchImpl: async () => new Response(JSON.stringify({
      error: false,
      status: 200,
      msg: "id_found",
      data: { username: "HonorPlayer88" },
    }), { status: 200, headers: { "Content-Type": "application/json" } }),
  });
  assert.equal(result.kind, "success");
  assert.equal(result.nickname, "HonorPlayer88");
});

test("shape labels expose structure without player values", () => {
  const label = classifyGameResponseShape({
    error: false,
    status: 200,
    msg: "id_found",
    data: { id: "17960996468644334037", username: "SECRET_PLAYER" },
  });
  assert.match(label, /^envelope:/);
  assert.equal(label.includes("17960996468644334037"), false);
  assert.equal(label.includes("SECRET_PLAYER"), false);
  assert.equal(label.includes("username"), true);
});

test("unlisted data keys collapse to a bounded unknown shape label", () => {
  const label = classifyGameResponseShape({
    error: true,
    status: 200,
    msg: "changed_schema",
    data: { brandNewSecretField: "SECRET_VALUE" },
  });
  assert.equal(label.includes("SECRET_VALUE"), false);
  assert.equal(label.includes("brandNewSecretField"), false);
  assert.match(label, /data:object:unlisted_keys/);
});

test("shape telemetry passes through the games adapter without leaking values", async () => {
  const secretNickname = "SECRET_PLAYER_VALUE";
  const result = await lookupRapidApiGame("honor-of-kings", { playerId: "17960996468644334037" }, {
    apiKey: "test-key",
    fetchImpl: async () => new Response(JSON.stringify({
      error: false,
      status: 200,
      msg: "id_found",
      data: { unexpected: secretNickname },
    }), { status: 200, headers: { "Content-Type": "application/json" } }),
  });

  assert.equal(result.kind, "unavailable");
  assert.equal(result.diagnostic.reason, "unrecognized_response");
  assert.equal(typeof result.diagnostic.responseShape, "string");
  assert.equal(JSON.stringify(result).includes(secretNickname), false);

  const lines = [];
  await observeProvider({
    requestId: "req-shape-test",
    provider: "rapidapi_id_game_checker_honor_of_kings",
    lookup: async () => result,
    logger: (line) => lines.push(line),
  });
  const event = JSON.parse(lines[0]);
  assert.equal(event.providerResponseShape, result.diagnostic.responseShape);
  assert.equal(lines[0].includes(secretNickname), false);
});

test("transient transport failures retry once before reporting unavailable", async () => {
  let calls = 0;
  let sleptMs = 0;
  const result = await lookupRapidApiGame("honor-of-kings", { playerId: "17960996468644334037" }, {
    apiKey: "test-key",
    sleepImpl: async (ms) => { sleptMs += ms; },
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw new Error("simulated timeout");
      return new Response(JSON.stringify({
        error: false,
        status: 200,
        msg: "id_found",
        data: { username: "HonorPlayer" },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });

  assert.equal(calls, 2);
  assert.equal(sleptMs > 0, true);
  assert.deepEqual(result, { kind: "success", nickname: "HonorPlayer", source: "rapidapi_id_game_checker" });
});

test("persistent transport failures stay unavailable after the retry budget", async () => {
  let calls = 0;
  const result = await lookupRapidApiGame("genshin-impact", { playerId: "844335555", server: "asia" }, {
    apiKey: "test-key",
    sleepImpl: async () => {},
    fetchImpl: async () => {
      calls += 1;
      throw new Error("simulated timeout");
    },
  });

  assert.equal(calls, 2);
  assert.deepEqual(result, { kind: "unavailable", diagnostic: { reason: "network_or_timeout" } });
});

test("degraded responses carry an allowlisted message code without payload text", () => {
  const degraded = classifyRapidApiGameResponse(200, {
    error: true,
    status: 200,
    msg: "no_content_0",
    data: { id: "844335555", server: "asia", username: "SECRET_PLAYER" },
  });
  assert.equal(degraded.kind, "unavailable");
  assert.equal(degraded.diagnostic.reason, "provider_error");
  assert.equal(degraded.diagnostic.messageCode, "no_content_n");
  assert.equal(JSON.stringify(degraded).includes("SECRET_PLAYER"), false);
});

test("unfamiliar provider codes collapse to unlisted and still emit safely", async () => {
  const result = classifyRapidApiGameResponse(200, {
    error: true,
    status: 200,
    msg: "brand_new_secret_code",
    data: { username: "SECRET_PLAYER" },
  });
  assert.equal(result.diagnostic.messageCode, "unlisted");
  assert.equal(JSON.stringify(result).includes("brand_new_secret_code"), false);

  const lines = [];
  await observeProvider({
    requestId: "req-message-code-test",
    provider: "rapidapi_id_game_checker_genshin_impact",
    lookup: async () => result,
    logger: (line) => lines.push(line),
  });
  const event = JSON.parse(lines[0]);
  assert.equal(event.providerMessageCode, "unlisted");
  assert.equal(lines[0].includes("SECRET_PLAYER"), false);
  assert.equal(lines[0].includes("brand_new_secret_code"), false);
});

test("live Genshin no_content_5 envelope stays degraded, never unrecognized", () => {
  // Exact live shape from E-002 (probe deploy f2b4d66a), values redacted.
  const result = classifyRapidApiGameResponse(200, {
    error: false,
    status: 204,
    msg: "no_content_5",
    data: { id: "REDACTED_ID", server: "asia", username: "" },
  });
  assert.equal(result.kind, "unavailable");
  assert.equal(result.diagnostic.reason, "provider_error");
  assert.equal(result.diagnostic.statusCode, 200);
  assert.equal(result.diagnostic.responseKind, "id_game_checker_schema");
  assert.equal(result.diagnostic.messageCode, "no_content_n");
  assert.equal(result.diagnostic.responseShape, "envelope:data,error,msg,status|data:object:id,server,username");
});

test("live HoK no_content_2 envelope stays degraded with ban-flag shape", () => {
  // Exact live shape from E-002 (probe deploy f2b4d66a), values redacted.
  const result = classifyRapidApiGameResponse(200, {
    error: false,
    status: 204,
    msg: "no_content_2",
    data: { id: "REDACTED_ID", is_ban: false, username: "" },
  });
  assert.equal(result.kind, "unavailable");
  assert.equal(result.diagnostic.reason, "provider_error");
  assert.equal(result.diagnostic.messageCode, "no_content_n");
  assert.equal(result.diagnostic.responseShape, "envelope:data,error,msg,status|data:object:id,is_ban,username");
});

test("no-content message without embedded status still degrades when nickname is empty", () => {
  const result = classifyRapidApiGameResponse(200, {
    error: false,
    status: 200,
    msg: "no_content_9",
    data: { username: "" },
  });
  assert.equal(result.kind, "unavailable");
  assert.equal(result.diagnostic.reason, "provider_error");
  assert.equal(result.diagnostic.messageCode, "no_content_n");
});

test("no-content message with a usable nickname still succeeds", () => {
  const result = classifyRapidApiGameResponse(200, {
    error: false,
    status: 200,
    msg: "no_content_9",
    data: { username: "RealPlayer" },
  });
  assert.equal(result.kind, "success");
  assert.equal(result.nickname, "RealPlayer");
});

test("live HoK id_found envelope with ban flag resolves to success", () => {
  // Live shape from E-003 hok-alt-sample (probe deploy c1bc0efc): embedded
  // status 200, msg id_found, non-empty username alongside is_ban:false.
  const result = classifyRapidApiGameResponse(200, {
    error: false,
    status: 200,
    msg: "id_found",
    data: { id: "REDACTED_ID", is_ban: false, username: "0123456789" },
  });
  assert.equal(result.kind, "success");
  assert.equal(result.nickname, "0123456789");
  assert.equal(result.source, "rapidapi_id_game_checker");
});
