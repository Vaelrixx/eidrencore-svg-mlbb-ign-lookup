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

test("embedded 404 with an error flag is not-found even when the message is unfamiliar", () => {
  assert.deepEqual(
    classifyRapidApiGameResponse(200, { error: true, status: 404, msg: "hok_lookup_failed", data: {} }),
    { kind: "not_found" },
  );
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

test("shape labels expose structure without player values", () => {
  const label = classifyGameResponseShape({
    error: false,
    status: 200,
    msg: "id_found",
    data: { id: "17960996468644334000", username: "SECRET_PLAYER" },
  });
  assert.match(label, /^envelope:/);
  assert.equal(label.includes("17960996468644334000"), false);
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
  const result = await lookupRapidApiGame("honor-of-kings", { playerId: "17960996468644334000" }, {
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
