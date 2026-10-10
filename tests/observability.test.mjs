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
  assert.equal(lines[0].includes("nickname"), false);
});
