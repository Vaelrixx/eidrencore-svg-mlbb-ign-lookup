import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyFcMobileResponse,
  lookupFcMobile,
} from "../src/app/api/lookup/providers/gopay-fc-mobile.mjs";
import { createProviderCache } from "../src/app/api/lookup/providers/provider-cache.mjs";

// Live-observed 2026-10-13: bogus 19-digit UID -> explicit invalid-account 404.
const missing = {
  statusCode: 404,
  message: "Invalid User Account: The user account is not recognized. Please confirm your account information.",
  error: "Not Found",
};
const valid = {
  message: "Success",
  data: { countryOrigin: "", username: "FcPlayer" },
};

test("explicit invalid-account 404 is not-found; other 404s degrade", () => {
  assert.deepEqual(classifyFcMobileResponse(404, missing), { kind: "not_found" });
  assert.equal(classifyFcMobileResponse(404, { ...missing, message: "Unknown User" }).kind, "unavailable");
  assert.equal(classifyFcMobileResponse(404, null).kind, "unavailable");
});

test("success schema resolves a nickname; rate limits and junk degrade", () => {
  assert.deepEqual(classifyFcMobileResponse(200, valid), {
    kind: "success",
    nickname: "FcPlayer",
    source: "gopay_games_validation",
  });
  assert.equal(classifyFcMobileResponse(429, { message: "slow" }).kind, "rate_limited");
  assert.equal(classifyFcMobileResponse(200, { message: "Success", data: { username: "N/A" } }).kind, "unavailable");
});

test("lookup sends FC_MOBILE code with string IDs and no credentials", async () => {
  let requestBody;
  let requestHeaders;
  const result = await lookupFcMobile("1856150661662899105", {
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(init.body);
      requestHeaders = init.headers;
      return new Response(JSON.stringify(valid), { status: 200 });
    },
  });
  assert.deepEqual(requestBody, { code: "FC_MOBILE", data: { userId: "1856150661662899105", zoneId: "" } });
  assert.equal("Authorization" in requestHeaders, false);
  assert.equal(result.kind, "success");
});

test("non-string IDs and network failures degrade without leaking details", async () => {
  assert.deepEqual((await lookupFcMobile("abc", { fetchImpl: async () => { throw new Error("x"); } })).kind, "unavailable");
  const net = await lookupFcMobile("1856150661662899105", {
    fetchImpl: async () => { throw new Error("private socket detail"); },
    cache: createProviderCache(),
  });
  assert.deepEqual(net, { kind: "unavailable", diagnostic: { reason: "network_or_timeout" } });
  assert.equal(JSON.stringify(net).includes("private socket"), false);
});

test("rate-limited outcomes are returned but never cached", async () => {
  const cache = createProviderCache();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) return new Response(JSON.stringify({ message: "slow" }), { status: 429 });
    return new Response(JSON.stringify(valid), { status: 200 });
  };
  const first = await lookupFcMobile("1856150661662899105", { fetchImpl, cache });
  assert.equal(first.kind, "rate_limited");
  const second = await lookupFcMobile("1856150661662899105", { fetchImpl, cache });
  assert.equal(second.kind, "success");
  assert.equal(second.nickname, "FcPlayer");
  assert.equal(calls, 2);
});
