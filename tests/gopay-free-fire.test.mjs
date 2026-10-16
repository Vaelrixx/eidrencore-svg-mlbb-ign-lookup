import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyFreeFireResponse,
  lookupGoPayFreeFire,
} from "../src/app/api/lookup/providers/gopay-free-fire.mjs";
import { createProviderCache } from "../src/app/api/lookup/providers/provider-cache.mjs";

// Live-verified 2026-10-13, re-verified 2026-10-17 (docs sample 1958604115
// resolves to a real nickname; bogus IDs give the unknown-user 404 below).
const valid = {
  message: "Success",
  data: { countryOrigin: "ID", username: "ᴀᴢᴛㅤ~ㅤPUSPAॐ" },
};
// Live-verified: bogus UID -> explicit unknown-user 404.
const missing = {
  statusCode: 404,
  message: "Unknown User",
  error: "Not Found",
};

test("success schema resolves a nickname", () => {
  assert.deepEqual(classifyFreeFireResponse(200, valid), {
    kind: "success",
    nickname: "ᴀᴢᴛㅤ~ㅤPUSPAॐ",
    source: "gopay_games_validation",
  });
});

test("only the explicit unknown-user 404 is not-found", () => {
  assert.deepEqual(classifyFreeFireResponse(404, missing), { kind: "not_found" });
  assert.equal(classifyFreeFireResponse(404, { ...missing, message: "Invalid User Account" }).kind, "unavailable");
  assert.equal(classifyFreeFireResponse(404, null).kind, "unavailable");
});

test("rate limits and junk degrade without false verdicts", () => {
  assert.equal(classifyFreeFireResponse(429, { message: "slow" }).kind, "rate_limited");
  assert.equal(classifyFreeFireResponse(200, { message: "Success", data: { username: "N/A" } }).kind, "unavailable");
});

test("lookup sends FREEFIRE code with string IDs and no credentials", async () => {
  let requestBody;
  let requestHeaders;
  const result = await lookupGoPayFreeFire("1958604115", {
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(init.body);
      requestHeaders = init.headers;
      return new Response(JSON.stringify(valid), { status: 200 });
    },
  });
  assert.deepEqual(requestBody, { code: "FREEFIRE", data: { userId: "1958604115", zoneId: "" } });
  assert.equal("Authorization" in requestHeaders, false);
  assert.equal(result.kind, "success");
});

test("FREEFIRE lookup 404s bogus IDs on the unknown-user envelope (live-verified 2026-10-17)", async () => {
  const bogus = await lookupGoPayFreeFire("000000000000001", {
    fetchImpl: async () => new Response(JSON.stringify(missing), { status: 404 }),
  });
  assert.deepEqual(bogus, { kind: "not_found" });
});

test("stable verdicts cache; transient misses always re-fetch", async () => {
  const cache = createProviderCache();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(JSON.stringify(valid), { status: 200 });
  };
  const first = await lookupGoPayFreeFire("1958604115", { fetchImpl, cache });
  assert.equal(first.cached, false);
  const second = await lookupGoPayFreeFire("1958604115", { fetchImpl, cache });
  assert.equal(second.cached, true);
  assert.equal(calls, 1);
  assert.equal(second.nickname, first.nickname);
  // Unavailable outcomes never stick: every call re-fetches.
  let misses = 0;
  const missImpl = async () => {
    misses += 1;
    return new Response(JSON.stringify({ message: "down" }), { status: 503 });
  };
  await lookupGoPayFreeFire("1958604116", { fetchImpl: missImpl, cache });
  await lookupGoPayFreeFire("1958604116", { fetchImpl: missImpl, cache });
  assert.equal(misses, 2);
});

test("invalid inputs and network failures degrade without leaking details", async () => {
  assert.deepEqual((await lookupGoPayFreeFire("abc", { fetchImpl: async () => { throw new Error("x"); } })).kind, "unavailable");
  const net = await lookupGoPayFreeFire("1958604115", {
    fetchImpl: async () => { throw new Error("private socket detail"); },
    cache: createProviderCache(),
  });
  assert.deepEqual(net, { kind: "unavailable", diagnostic: { reason: "network_or_timeout" } });
  assert.equal(JSON.stringify(net).includes("private socket"), false);
});
