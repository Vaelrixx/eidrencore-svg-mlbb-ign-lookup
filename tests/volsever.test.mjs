import test from "node:test";
import assert from "node:assert/strict";
import { VOLSEVER_GAME_ROUTES, classifyVolseverResponse, lookupVolseverGame, lookupVolseverMlbb } from "../src/app/api/lookup/providers/volsever.mjs";

test("classifies only Volsever's documented confirmed MLBB envelope as success", () => {
  assert.deepEqual(classifyVolseverResponse(200, {
    status: true,
    code: 200,
    message: "ID Found",
    data: { game: "Mobile Legends Indonesia", username: "Bagus Player", user_id: "12345678", zone: "2001" },
  }, "12345678"), {
    kind: "success",
    nickname: "Bagus Player",
    source: "volsever_game_checker",
  });
});

test("does not call a 404 or an echoed ID a verified missing/success verdict", () => {
  assert.equal(classifyVolseverResponse(404, { status: false, code: 404, message: "Game not found" }, "12345678").kind, "unavailable");
  assert.deepEqual(classifyVolseverResponse(404, { status: false, code: 404, message: "ID not found" }, "12345678"), { kind: "not_found" });
  assert.equal(classifyVolseverResponse(200, {
    status: true, code: 200, data: { username: "12345678" },
  }, "12345678").kind, "unavailable");
});

test("distinguishes daily-quota exhaustion from anti-spam rate limiting", () => {
  assert.deepEqual(classifyVolseverResponse(429, {
    status: false, code: 429, error: "SERVICE_LIMIT_EXCEEDED", limitType: "daily",
    message: "Service daily limit exceeded for Game ID Checker (45 requests/daily)",
  }, "12345678"), {
    kind: "rate_limited", diagnostic: { reason: "quota_exhausted", statusCode: 429 },
  });
  assert.deepEqual(classifyVolseverResponse(429, {
    status: false, code: 429, error: "ANTI_SPAM_LIMIT_EXCEEDED",
    message: "Anti-spam limit exceeded (15 req/minute)",
  }, "12345678"), {
    kind: "rate_limited", diagnostic: { reason: "http_error", statusCode: 429 },
  });
});

test("sends MLBB player and zone values with the documented X-API-KEY header", async () => {
  let capturedUrl;
  let capturedInit;
  const result = await lookupVolseverMlbb("12345678", "2001", {
    apiKey: "test-volsever-key",
    fetchImpl: async (url, init) => {
      capturedUrl = new URL(String(url));
      capturedInit = init;
      return new Response(JSON.stringify({ status: true, code: 200, data: { username: "Bagus Player" } }), { status: 200 });
    },
  });
  assert.equal(capturedUrl.origin, "https://gate.volsever.com");
  assert.equal(capturedUrl.pathname, "/proxy/api/game/mobile-legends");
  assert.equal(capturedUrl.searchParams.get("id"), "12345678");
  assert.equal(capturedUrl.searchParams.get("zone"), "2001");
  assert.equal(capturedInit.headers["X-API-KEY"], "test-volsever-key");
  assert.deepEqual(result, { kind: "success", nickname: "Bagus Player", source: "volsever_game_checker" });
  assert.equal(JSON.stringify(result).includes("test-volsever-key"), false);
});

test("returns missing_config without a Volsever key and rejects malformed IDs before fetch", async () => {
  const previousKey = process.env.VOLSEVER_API_KEY;
  delete process.env.VOLSEVER_API_KEY;
  let fetchCalled = false;
  try {
    assert.deepEqual(await lookupVolseverMlbb("12345678", "2001", { fetchImpl: async () => { fetchCalled = true; } }), {
      kind: "unavailable", diagnostic: { reason: "missing_config" },
    });
    assert.deepEqual(await lookupVolseverMlbb("x", "2001", { apiKey: "test", fetchImpl: async () => { fetchCalled = true; } }), {
      kind: "unavailable", diagnostic: { reason: "invalid_input" },
    });
    assert.equal(fetchCalled, false);
  } finally {
    if (previousKey === undefined) delete process.env.VOLSEVER_API_KEY;
    else process.env.VOLSEVER_API_KEY = previousKey;
  }
});

test("generic leg calls the registered gateway slug without a zone by default", async () => {
  let capturedUrl;
  const result = await lookupVolseverGame("pubg-mobile", "5920831844", {
    apiKey: "test-volsever-key",
    fetchImpl: async (url) => {
      capturedUrl = new URL(String(url));
      return new Response(JSON.stringify({
        status: true, code: 200, message: "ID Found",
        data: { game: "PUBG Mobile 3 (Global)", username: "PubgPlayer", user_id: "5920831844", zone: null },
      }), { status: 200 });
    },
  });
  assert.equal(capturedUrl.pathname, "/proxy/api/game/pubg-mobile-global");
  assert.equal(capturedUrl.searchParams.get("id"), "5920831844");
  assert.equal(capturedUrl.searchParams.has("zone"), false);
  assert.deepEqual(result, { kind: "success", nickname: "PubgPlayer", source: "volsever_game_checker" });
});

test("generic leg rejects unregistered games and bad inputs before any fetch", async () => {
  let fetchCalled = false;
  const spy = async () => { fetchCalled = true; throw new Error("must not fetch"); };
  assert.deepEqual(await lookupVolseverGame("teen-patti-gold", "100439992784", { apiKey: "t", fetchImpl: spy }), {
    kind: "unavailable", diagnostic: { reason: "invalid_input" },
  });
  assert.deepEqual(await lookupVolseverGame("pubg-mobile", "  ", { apiKey: "t", fetchImpl: spy }), {
    kind: "unavailable", diagnostic: { reason: "invalid_input" },
  });
  assert.equal(fetchCalled, false);
});

test("registry covers only live-probed gateway routes", () => {
  assert.equal(VOLSEVER_GAME_ROUTES["pubg-mobile"].slug, "pubg-mobile-global");
  assert.equal(VOLSEVER_GAME_ROUTES["call-of-duty-mobile"].slug, "codm-garena");
  assert.equal(VOLSEVER_GAME_ROUTES["free-fire"].slug, "freefire");
  assert.ok(!("teen-patti-gold" in VOLSEVER_GAME_ROUTES));
  assert.ok(!("fc-mobile" in VOLSEVER_GAME_ROUTES));
  assert.ok(!("metal-slug" in VOLSEVER_GAME_ROUTES));
});
