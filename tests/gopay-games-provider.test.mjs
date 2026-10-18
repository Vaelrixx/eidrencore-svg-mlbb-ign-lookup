import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyGoPayGamesResponse,
  lookupGoPayGames,
} from "../src/app/api/lookup/providers/gopay-games.mjs";

const valid = {
  message: "Success",
  data: { countryOrigin: "id", username: "Outrageous+Dominance" },
};
const missing = {
  statusCode: 404,
  message: "Invalid User Account: The user account is not recognized. Please confirm your account information.",
  error: "Not Found",
};

test("documented success schema resolves a nickname", () => {
  assert.deepEqual(classifyGoPayGamesResponse(200, valid), {
    kind: "success",
    nickname: "Outrageous Dominance",
    source: "gopay_games_validation",
  });
});

test("only the exact observed HTTP 404 invalid-account envelope is not-found", () => {
  assert.deepEqual(classifyGoPayGamesResponse(404, missing), { kind: "not_found" });
  assert.equal(classifyGoPayGamesResponse(404, { ...missing, error: "Internal Error" }).kind, "unavailable");
  assert.equal(classifyGoPayGamesResponse(404, { ...missing, message: "Unexpected failure" }).kind, "unavailable");
  assert.equal(classifyGoPayGamesResponse(404, null).kind, "unavailable");
});

test("live MLBB shapes 2026-10-18: HTTP 201 Success resolves, echo degrades, strict miss gate holds", () => {
  // Valid pair returned HTTP 201 (not 200) with a real nickname.
  assert.deepEqual(classifyGoPayGamesResponse(201, valid, "111491774613486"), {
    kind: "success",
    nickname: "Outrageous Dominance",
    source: "gopay_games_validation",
  });
  // Echo guard: a username that merely repeats the queried identity is
  // unavailable, never a confirmed nickname.
  assert.equal(
    classifyGoPayGamesResponse(200, { message: "Success", data: { username: "111491774613486" } }, "111491774613486").kind,
    "unavailable",
  );
  assert.equal(
    classifyGoPayGamesResponse(201, { message: "Success", data: { username: "1114917746 13486" } }, "111491774613486").kind,
    "unavailable",
  );
});

test("rate limits, malformed bodies, and upstream errors are not treated as missing players", () => {
  assert.equal(classifyGoPayGamesResponse(429, { message: "slow down" }).kind, "rate_limited");
  assert.equal(classifyGoPayGamesResponse(503, { message: "maintenance" }).kind, "unavailable");
  assert.equal(classifyGoPayGamesResponse(200, { message: "Success", data: { username: "N/A" } }).kind, "unavailable");
  assert.equal(classifyGoPayGamesResponse(200, "not json").kind, "unavailable");
});

test("lookup sends the observed JSON request and no credentials", async () => {
  const previousFetch = globalThis.fetch;
  let requestUrl = "";
  let requestHeaders;
  let requestBody;
  globalThis.fetch = async (url, init) => {
    requestUrl = String(url);
    requestHeaders = init.headers;
    requestBody = JSON.parse(init.body);
    return new Response(JSON.stringify(valid), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const result = await lookupGoPayGames("1114917746", "13486");
    assert.equal(requestUrl, "https://gopay.co.id/games/v1/order/user-account");
    assert.deepEqual(requestBody, {
      code: "MOBILE_LEGENDS",
      data: { userId: "1114917746", zoneId: "13486" },
    });
    assert.equal(requestHeaders.Accept, "application/json");
    assert.equal(requestHeaders["Content-Type"], "application/json");
    assert.equal("Authorization" in requestHeaders, false);
    assert.equal(result.kind, "success");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("network failures are sanitized", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("private socket detail"); };
  try {
    const result = await lookupGoPayGames("1114917746", "13486");
    assert.deepEqual(result, { kind: "unavailable", diagnostic: { reason: "network_or_timeout" } });
    assert.equal(JSON.stringify(result).includes("private socket detail"), false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
