import test from "node:test";
import assert from "node:assert/strict";
import { cleanNickname, confirmedNickname, isUsableNickname } from "../src/app/api/lookup/nickname-validation.mjs";

test("accepts plausible player nicknames", () => {
  assert.equal(confirmedNickname({ success: true, name: "Outrageous Dominance" }), "Outrageous Dominance");
  assert.equal(confirmedNickname({ success: true, data: { nickname: "NightOwl_77" } }), "NightOwl_77");
  assert.equal(confirmedNickname({ success: true, result: { roleName: "月影" } }), "月影");
});

test("rejects placeholder nicknames, including the production bug value", () => {
  for (const value of ["na", "NA", "n.a.", "N/A", "n-a", "not available", "unavailable", "null", "undefined", "none", "nil", "unknown", "error", "player not found", "-", "--", "0"]) {
    assert.equal(isUsableNickname(value), false, `should reject ${JSON.stringify(value)}`);
    assert.equal(confirmedNickname({ success: true, nickname: value }), "");
  }
});

test("rejects malformed, empty, overlong, and error-shaped payloads", () => {
  assert.equal(confirmedNickname(null), "");
  assert.equal(confirmedNickname({ success: false, name: "ActuallyReal" }), "");
  assert.equal(confirmedNickname({ success: true, error: "player not found", name: "ActuallyReal" }), "");
  assert.equal(confirmedNickname({ success: true, data: { valid: false, name: "ActuallyReal" } }), "");
  assert.equal(confirmedNickname({ success: true, nickname: "x".repeat(65) }), "");
  assert.equal(isUsableNickname(""), false);
  assert.equal(isUsableNickname("  "), false);
});

test("decodes provider nickname strings safely", () => {
  assert.equal(cleanNickname("Player+One"), "Player One");
  assert.equal(cleanNickname("Player%20One"), "Player One");
  assert.equal(cleanNickname("%E0%A4%A"), "%E0%A4%A");
});


import { resolveLookupWithFallbacks } from "../src/app/api/lookup/resolve-lookup.mjs";

test("fallback takes over when primary is unavailable", async () => {
  let primaryCalls = 0;
  let secondaryCalls = 0;
  const result = await resolveLookupWithFallbacks(
    async () => {
      primaryCalls += 1;
      return { kind: "unavailable" };
    },
    [
      async () => {
        secondaryCalls += 1;
        return { kind: "success", nickname: "Outrageous Dominance", source: "isan_nickname_api" };
      },
      async () => ({ kind: "unavailable" }),
    ],
  );

  assert.equal(primaryCalls, 1);
  assert.equal(secondaryCalls, 1);
  assert.equal(result.confirmed?.source, "isan_nickname_api");
  assert.equal(result.confirmed?.nickname, "Outrageous Dominance");
  assert.equal(result.fallbacks.length, 2);
});

test("fallback providers are not called when primary succeeds", async () => {
  let fallbackCalls = 0;
  const result = await resolveLookupWithFallbacks(
    async () => ({ kind: "success", nickname: "Primary IGN", source: "community_lookup" }),
    [async () => { fallbackCalls += 1; return { kind: "unavailable" }; }],
  );
  assert.equal(result.confirmed?.source, "community_lookup");
  assert.equal(fallbackCalls, 0);
  assert.equal(result.fallbacks.length, 0);
});

test("fallback priority is deterministic when multiple providers succeed", async () => {
  const result = await resolveLookupWithFallbacks(
    async () => ({ kind: "unavailable" }),
    [
      async () => ({ kind: "success", nickname: "First", source: "rapidapi_id_game_checker" }),
      async () => ({ kind: "success", nickname: "Second", source: "isan_nickname_api" }),
    ],
  );
  assert.equal(result.confirmed?.nickname, "First");
});
