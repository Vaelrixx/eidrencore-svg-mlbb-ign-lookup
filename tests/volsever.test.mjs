import test from "node:test";
import assert from "node:assert/strict";
import { classifyVolseverResponse, lookupVolseverMlbb } from "../src/app/api/lookup/providers/volsever.mjs";

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
