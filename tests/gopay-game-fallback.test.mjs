import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyGoPayGameFallbackResponse,
  lookupGoPayGameFallback,
} from "../src/app/api/lookup/providers/gopay-game-fallback.mjs";

// Live-observed 2026-10-13: AOV + docs sample -> real nickname.
const aovSuccess = {
  message: "Success",
  data: { countryOrigin: "ID", username: "creature.6's" },
};
// Live-observed: AOV + bogus UID -> explicit unknown-user 404.
const aovMissing = {
  statusCode: 404,
  message: "Unknown User",
  error: "Not Found",
};
// Live-observed: PUBG_ID + Lite-pool/banned IDs -> non-not-found 404s.
const litePoolMiss = {
  statusCode: 404,
  message: "Invalid user account",
  error: "Not Found",
};
const bannedAccount = {
  statusCode: 404,
  message: "User account banned",
  error: "Not Found",
};

test("AOV success schema resolves the live-verified nickname", () => {
  assert.deepEqual(classifyGoPayGameFallbackResponse(200, aovSuccess), {
    kind: "success",
    nickname: "creature.6's",
    source: "gopay_games_validation",
  });
});

test("only the explicit unknown-user 404 is not-found; ban and pool misses degrade", () => {
  assert.deepEqual(classifyGoPayGameFallbackResponse(404, aovMissing, "", "AOV"), { kind: "not_found" });
  assert.equal(classifyGoPayGameFallbackResponse(404, litePoolMiss, "", "PUBG_ID").kind, "unavailable");
  assert.equal(classifyGoPayGameFallbackResponse(404, bannedAccount, "", "PUBG_ID").kind, "unavailable");
  assert.equal(classifyGoPayGameFallbackResponse(404, null, "", "AOV").kind, "unavailable");
});

test("PUBGM invalid-account 404 is not-found (live-verified 2026-10-17)", () => {
  assert.deepEqual(classifyGoPayGameFallbackResponse(404, litePoolMiss, "", "PUBGM"), { kind: "not_found" });
  // Same envelope on other codes never reports not-found: PUBG_ID pool
  // misses include real Lite IDs, and AOV uses the unknown-user envelope.
  assert.equal(classifyGoPayGameFallbackResponse(404, litePoolMiss, "", "AOV").kind, "unavailable");
  assert.equal(classifyGoPayGameFallbackResponse(404, aovMissing, "", "PUBGM").kind, "unavailable");
});

test("rate limits and malformed bodies never become not-found", () => {
  assert.equal(classifyGoPayGameFallbackResponse(429, { message: "slow" }).kind, "rate_limited");
  assert.equal(classifyGoPayGameFallbackResponse(503, { message: "down" }).kind, "unavailable");
  assert.equal(classifyGoPayGameFallbackResponse(200, { message: "Success", data: { username: "N/A" } }).kind, "unavailable");
});

test("lookup sends the game code with no credentials", async () => {
  let requestBody;
  const result = await lookupGoPayGameFallback("AOV", "195293573153949", {
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return new Response(JSON.stringify(aovSuccess), { status: 200 });
    },
  });
  assert.deepEqual(requestBody, { code: "AOV", data: { userId: "195293573153949", zoneId: "" } });
  assert.equal(result.kind, "success");
});

// Phase 2 lock-in (live-verified 2026-10-17 on production): PUBGM valid
// sample resolves, bogus IDs report not-found, and Lite-pool IDs miss on
// the Global code while degrading (never false not-found) on PUBG_ID.
const pubgmSuccess = {
  message: "Success",
  data: { countryOrigin: "", username: "Agus๛haji" },
};

test("PUBGM lookup resolves the valid sample and 404s bogus IDs", async () => {
  const fetchImpl = (payload, status) => async () => new Response(JSON.stringify(payload), { status });
  const ok = await lookupGoPayGameFallback("PUBGM", "5204837417", {
    fetchImpl: fetchImpl(pubgmSuccess, 200),
  });
  assert.deepEqual(ok, { kind: "success", nickname: "Agus๛haji", source: "gopay_games_validation" });
  const bogus = await lookupGoPayGameFallback("PUBGM", "000000000000001", {
    fetchImpl: fetchImpl(litePoolMiss, 404),
  });
  assert.deepEqual(bogus, { kind: "not_found" });
});

test("Lite-pool IDs miss on PUBGM but never false not-found on PUBG_ID", async () => {
  const fetchImpl = async () => new Response(JSON.stringify(litePoolMiss), { status: 404 });
  // Live: 7228395004 is a real Lite account; the Global pool has no such
  // account, so the Global route 404s while the Lite route resolves it.
  assert.deepEqual(
    await lookupGoPayGameFallback("PUBGM", "7228395004", { fetchImpl }),
    { kind: "not_found" },
  );
  assert.equal(
    (await lookupGoPayGameFallback("PUBG_ID", "7228395004", { fetchImpl })).kind,
    "unavailable",
  );
});

test("invalid inputs and network failures degrade without leaking details", async () => {
  assert.deepEqual((await lookupGoPayGameFallback("", "123", { fetchImpl: async () => { throw new Error("x"); } })).kind, "unavailable");
  assert.deepEqual((await lookupGoPayGameFallback("AOV", "abc", { fetchImpl: async () => { throw new Error("x"); } })).kind, "unavailable");
  const net = await lookupGoPayGameFallback("AOV", "195293573153949", {
    fetchImpl: async () => { throw new Error("private socket detail"); },
  });
  assert.deepEqual(net, { kind: "unavailable", diagnostic: { reason: "network_or_timeout" } });
  assert.equal(JSON.stringify(net).includes("private socket"), false);
});
