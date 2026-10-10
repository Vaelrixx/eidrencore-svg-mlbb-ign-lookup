import test from "node:test";
import assert from "node:assert/strict";
import { classifyRapidApiResponse, lookupRapidApi } from "../src/app/api/lookup/providers/rapidapi.mjs";
import { resolveLookupWithFallbacks } from "../src/app/api/lookup/resolve-lookup.mjs";

async function withRapidApiEnv(run, fetchImpl) {
  const previousKey = process.env.RAPIDAPI_KEY;
  const previousToken = process.env.RAPIDAPI_APP_TOKEN;
  const previousFetch = globalThis.fetch;
  process.env.RAPIDAPI_KEY = "unit-test-key";
  delete process.env.RAPIDAPI_APP_TOKEN;
  globalThis.fetch = fetchImpl;
  try {
    return await run();
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.RAPIDAPI_KEY;
    else process.env.RAPIDAPI_KEY = previousKey;
    if (previousToken === undefined) delete process.env.RAPIDAPI_APP_TOKEN;
    else process.env.RAPIDAPI_APP_TOKEN = previousToken;
  }
}

test("malformed JSON is unavailable and never leaks response content", async () => {
  const result = await withRapidApiEnv(
    () => lookupRapidApi("1114917746", "13486"),
    async () => new Response("PRIVATE_UPSTREAM_BODY", { status: 200 }),
  );
  assert.deepEqual(result, {
    kind: "unavailable",
    diagnostic: { reason: "unrecognized_response", statusCode: 200, responseKind: "empty_or_non_json" },
  });
  assert.equal(JSON.stringify(result).includes("PRIVATE_UPSTREAM_BODY"), false);
});

test("network failures are normalized to unavailable", async () => {
  const result = await withRapidApiEnv(
    () => lookupRapidApi("1114917746", "13486"),
    async () => { throw new Error("private transport detail"); },
  );
  assert.deepEqual(result, { kind: "unavailable", diagnostic: { reason: "network_or_timeout" } });
});

test("a live HTTP 429 is classified as rate limited", async () => {
  const result = await withRapidApiEnv(
    () => lookupRapidApi("1114917746", "13486"),
    async () => new Response(JSON.stringify({ error: true, msg: "rate limit" }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    }),
  );
  assert.equal(result.kind, "rate_limited");
  assert.equal(result.diagnostic.statusCode, 429);
});

test("resolver keeps a confirmed primary and ignores fallback successes", async () => {
  const confirmedPrimary = { kind: "success", nickname: "Primary IGN", source: "community_lookup" };
  let fallbackCalls = 0;
  const result = await resolveLookupWithFallbacks(
    async () => confirmedPrimary,
    [
      async () => { fallbackCalls += 1; return { kind: "success", nickname: "Different IGN", source: "rapidapi_id_game_checker" }; },
      async () => { fallbackCalls += 1; return { kind: "unavailable" }; },
    ],
  );
  assert.equal(result.confirmed, confirmedPrimary);
  assert.equal(fallbackCalls, 0);
  assert.deepEqual(result.fallbacks, []);
});

test("fallback resolver never treats unavailable or not-found as a nickname", async () => {
  const result = await resolveLookupWithFallbacks(
    async () => ({ kind: "unavailable" }),
    [
      async () => ({ kind: "not_found" }),
      async () => ({ kind: "unavailable", diagnostic: { reason: "network_or_timeout" } }),
    ],
  );
  assert.equal(result.confirmed, null);
  assert.equal(result.fallbacks.some((attempt) => attempt.kind === "success"), false);
});

test("invalid successful payloads remain unavailable", () => {
  assert.equal(classifyRapidApiResponse(200, {
    error: false, status: 200, msg: "id_found", data: { username: "N/A" },
  }).kind, "unavailable");
});
