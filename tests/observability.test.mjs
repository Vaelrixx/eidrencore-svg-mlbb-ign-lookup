import test from "node:test";
import assert from "node:assert/strict";
import { observeProvider, logLookupSummary } from "../src/app/api/lookup/observability.mjs";

test("provider telemetry records latency and outcome without player data", async () => {
  const lines = [];
  let tick = 10;
  const result = await observeProvider({
    requestId: "req-test-1",
    provider: "isan_nickname_api",
    lookup: async () => ({
      kind: "success",
      nickname: "SECRET_PLAYER_NICKNAME",
      playerId: "SECRET_PLAYER_ID",
      source: "isan_nickname_api",
    }),
    logger: (line) => lines.push(line),
    clock: () => (tick += 12),
  });

  assert.equal(result.nickname, "SECRET_PLAYER_NICKNAME");
  const event = JSON.parse(lines[0]);
  assert.deepEqual(event, {
    event: "lookup.provider",
    requestId: "req-test-1",
    provider: "isan_nickname_api",
    outcome: "success",
    durationMs: 12,
    source: "isan_nickname_api",
  });
  assert.equal(lines[0].includes("SECRET_PLAYER_NICKNAME"), false);
  assert.equal(lines[0].includes("SECRET_PLAYER_ID"), false);
});

test("provider telemetry converts thrown errors to unavailable and survives logger failure", async () => {
  const result = await observeProvider({
    requestId: "req-test-2",
    provider: "test_provider",
    lookup: async () => { throw new Error("sensitive upstream payload"); },
    logger: () => { throw new Error("log sink down"); },
  });
  assert.deepEqual(result, { kind: "unavailable" });
});

test("request summary logs aggregate outcomes without identity fields", () => {
  const lines = [];
  logLookupSummary({
    requestId: "req-test-3",
    durationMs: 123,
    primary: { kind: "unavailable" },
    fallbacks: [{ kind: "success", nickname: "SECRET_PLAYER_NICKNAME", source: "isan_nickname_api" }],
    confirmed: { kind: "success", nickname: "SECRET_PLAYER_NICKNAME", source: "isan_nickname_api" },
    logger: (line) => lines.push(line),
  });
  const event = JSON.parse(lines[0]);
  assert.equal(event.event, "lookup.summary");
  assert.equal(event.outcome, "success");
  assert.equal(event.primaryOutcome, "unavailable");
  assert.deepEqual(event.fallbackOutcomes, ["success"]);
  assert.equal(event.selectedSource, "isan_nickname_api");
  assert.equal(lines[0].includes("SECRET_PLAYER_NICKNAME"), false);
  assert.equal(lines[0].includes("SECRET_PLAYER_NICKNAME"), false);
});


test("provider failure telemetry exposes bounded diagnostics without raw payloads", async () => {
  const lines = [];
  const result = await observeProvider({
    requestId: "req-test-4",
    provider: "rapidapi_id_game_checker",
    lookup: async () => ({
      kind: "unavailable",
      diagnostic: {
        reason: "http_error",
        statusCode: 403,
        rawPayload: "SECRET_UPSTREAM_BODY",
        url: "https://private.example/?token=SECRET",
      },
    }),
    logger: (line) => lines.push(line),
  });

  assert.equal(result.kind, "unavailable");
  const event = JSON.parse(lines[0]);
  assert.equal(event.failureReason, "http_error");
  assert.equal(event.upstreamStatus, 403);
  assert.equal(lines[0].includes("SECRET_UPSTREAM_BODY"), false);
  assert.equal(lines[0].includes("private.example"), false);
  assert.equal(lines[0].includes("SECRET"), false);
});

test("unrecognized responses are logged as a bounded failure category", async () => {
  const lines = [];
  await observeProvider({
    requestId: "req-test-5",
    provider: "isan_nickname_api",
    lookup: async () => ({
      kind: "unavailable",
      diagnostic: { reason: "unrecognized_response", statusCode: 200 },
    }),
    logger: (line) => lines.push(line),
  });

  const event = JSON.parse(lines[0]);
  assert.equal(event.failureReason, "unrecognized_response");
  assert.equal(event.upstreamStatus, 200);
});

test("identity echo telemetry is allowlisted and excludes the compared player ID", async () => {
  const lines = [];
  const playerId = "SECRET_PLAYER_ID";
  await observeProvider({
    requestId: "req-identity-echo",
    provider: "rapidapi_id_game_checker_cod_mobile",
    lookup: async () => ({
      kind: "unavailable",
      diagnostic: { reason: "identity_echo", comparedValue: playerId },
    }),
    logger: (line) => lines.push(line),
  });

  const event = JSON.parse(lines[0]);
  assert.equal(event.failureReason, "identity_echo");
  assert.equal(lines[0].includes(playerId), false);
  assert.equal(lines[0].includes("comparedValue"), false);
});

test("quota exhaustion telemetry surfaces the daily-cap state", async () => {
  const lines = [];
  await observeProvider({
    requestId: "req-quota-exhausted",
    provider: "volsever_game_checker",
    lookup: async () => ({
      kind: "rate_limited",
      diagnostic: { reason: "quota_exhausted", statusCode: 429 },
    }),
    logger: (line) => lines.push(line),
  });

  const event = JSON.parse(lines[0]);
  assert.equal(event.outcome, "rate_limited");
  assert.equal(event.failureReason, "quota_exhausted");
  assert.equal(event.upstreamStatus, 429);
});

test("provider response kind telemetry logs only an allowlisted schema label", async () => {
  const lines = [];
  await observeProvider({
    requestId: "req-test-6",
    provider: "rapidapi_id_game_checker",
    lookup: async () => ({
      kind: "unavailable",
      diagnostic: {
        reason: "http_error",
        statusCode: 404,
        responseKind: "gateway_message_json",
        rawPayload: "SECRET_GATEWAY_MESSAGE",
      },
    }),
    logger: (line) => lines.push(line),
  });

  const event = JSON.parse(lines[0]);
  assert.equal(event.providerResponseKind, "gateway_message_json");
  assert.equal(event.upstreamStatus, 404);
  assert.equal(lines[0].includes("SECRET_GATEWAY_MESSAGE"), false);
  assert.equal(lines[0].includes("rawPayload"), false);
});

test("provider-reported status is a separate bounded telemetry field", async () => {
  const lines = [];
  await observeProvider({
    requestId: "req-test-7",
    provider: "rapidapi_id_game_checker",
    lookup: async () => ({
      kind: "unavailable",
      diagnostic: {
        reason: "unrecognized_response",
        statusCode: 200,
        providerStatusCode: 404,
        rawPayload: "SECRET_PLAYER_ID_AND_UPSTREAM_MESSAGE",
      },
    }),
    logger: (line) => lines.push(line),
  });

  const event = JSON.parse(lines[0]);
  assert.equal(event.upstreamStatus, 200);
  assert.equal(event.providerReportedStatus, 404);
  assert.equal(lines[0].includes("SECRET_PLAYER_ID_AND_UPSTREAM_MESSAGE"), false);
});

test("provider-reported status rejects values outside the HTTP status range", async () => {
  const lines = [];
  await observeProvider({
    requestId: "req-test-8",
    provider: "rapidapi_id_game_checker",
    lookup: async () => ({ kind: "unavailable", diagnostic: { reason: "provider_error", providerStatusCode: 999 } }),
    logger: (line) => lines.push(line),
  });

  assert.equal(Object.hasOwn(JSON.parse(lines[0]), "providerReportedStatus"), false);
});
