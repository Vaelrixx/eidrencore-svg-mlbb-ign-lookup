import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { enforceLookupRateLimit, enforcePlaygroundLimit, persistLookupLog } from "../src/app/api/lookup/persistence.mjs";

const baseEnv = {
  SUPABASE_URL: "https://example.supabase.co/",
  SUPABASE_SERVICE_ROLE_KEY: "server-only-test-key",
  LOOKUP_RATE_LIMIT_SECRET: "test-hmac-secret",
};

function request(headers = {}) {
  return { headers: new Headers(headers) };
}

test("rate limiter sends only an HMAC and handles an allowed atomic slot", async () => {
  let captured;
  const result = await enforceLookupRateLimit(request({ "x-real-ip": "198.51.100.77", "x-forwarded-for": "spoofed, 203.0.113.9" }), {
    env: baseEnv,
    fetchImpl: async (url, init) => {
      captured = { url, init, body: JSON.parse(init.body) };
      return Response.json([{ allowed: true, remaining: 29, reset_at: "2026-10-10T12:01:00Z" }]);
    },
    logger: () => {},
  });
  assert.equal(result.allowed, true);
  assert.equal(result.remaining, 29);
  assert.equal(captured.url, "https://example.supabase.co/rest/v1/rpc/consume_lookup_limit");
  assert.equal(captured.body.p_client_hash.length, 64);
  assert.equal(captured.body.p_client_hash, createHmac("sha256", "test-hmac-secret").update("203.0.113.9").digest("hex"));
  assert.equal(captured.body.p_client_hash.includes("203.0.113.9"), false);
  assert.equal(captured.body.p_max_requests, 30);
  assert.equal("Prefer" in captured.init.headers, false);
  assert.equal(captured.init.headers.Authorization, "Bearer server-only-test-key");
});

test("lookup limiter ignores caller-supplied X-Real-IP without Railway X-Forwarded-For", async () => {
  const result = await enforceLookupRateLimit(request({ "x-real-ip": "203.0.113.14" }), { env: baseEnv });
  assert.deepEqual(result, { enabled: false, allowed: true, retryAfterSeconds: 0 });
});

test("blocked requests return a bounded retry delay", async () => {
  const result = await enforceLookupRateLimit(request({ "x-forwarded-for": "203.0.113.10" }), {
    env: baseEnv,
    fetchImpl: async () => Response.json([{ allowed: false, remaining: 0, reset_at: new Date(Date.now() + 8000).toISOString() }]),
    logger: () => {},
  });
  assert.equal(result.allowed, false);
  assert.ok(result.retryAfterSeconds >= 1 && result.retryAfterSeconds <= 9);
});

test("modern Supabase secret keys are sent only in the apikey header", async () => {
  let headers;
  await enforceLookupRateLimit(request({ "x-forwarded-for": "203.0.113.11" }), {
    env: { SUPABASE_URL: baseEnv.SUPABASE_URL, SUPABASE_SECRET_KEY: "sb_secret_test", LOOKUP_RATE_LIMIT_SECRET: "secret" },
    fetchImpl: async (_url, init) => {
      headers = init.headers;
      return Response.json([{ allowed: true, remaining: 29, reset_at: new Date(Date.now() + 60000).toISOString() }]);
    },
    logger: () => {},
  });
  assert.equal(headers.apikey, "sb_secret_test");
  assert.equal("Authorization" in headers, false);
});

test("rate limiter fails open when configuration or the database is unavailable", async () => {
  const noConfig = await enforceLookupRateLimit(request({ "x-forwarded-for": "203.0.113.12" }), { env: {} });
  assert.deepEqual(noConfig, { enabled: false, allowed: true, retryAfterSeconds: 0 });

  const lines = [];
  const degraded = await enforceLookupRateLimit(request({ "x-forwarded-for": "203.0.113.12" }), {
    env: baseEnv,
    fetchImpl: async () => { throw new Error("sensitive database error"); },
    logger: (line) => lines.push(line),
  });
  assert.equal(degraded.allowed, true);
  assert.equal(degraded.degraded, true);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].includes("sensitive"), false);
});

test("lookup log persists only bounded status, latency and source", async () => {
  let captured;
  const result = await persistLookupLog({
    status: "success",
    responseMs: 12.6,
    source: "isan_nickname_api",
    playerId: "SECRET_PLAYER_ID",
    nickname: "SECRET_NICKNAME",
  }, {
    env: baseEnv,
    fetchImpl: async (url, init) => {
      captured = { url, init, body: JSON.parse(init.body) };
      return new Response(null, { status: 201 });
    },
  });
  assert.equal(result.persisted, true);
  assert.equal(captured.url, "https://example.supabase.co/rest/v1/lookup_logs");
  assert.deepEqual(captured.body, { status: "success", response_ms: 13, source: "isan_nickname_api" });
  assert.equal(captured.init.headers.Prefer, "return=minimal");
  assert.equal(JSON.stringify(captured.body).includes("SECRET"), false);
});

test("Eidren identity-game source labels persist without fallback", async () => {
  const sources = [
    "eidren_pubg_mobile",
    "eidren_call_of_duty_mobile",
    "eidren_valorant",
    "eidren_genshin_impact",
    "eidren_honkai_star_rail",
    "eidren_zenless_zone_zero",
    "eidren_honor_of_kings",
  ];
  for (const source of sources) {
    let captured;
    const result = await persistLookupLog({ status: "success", responseMs: 1, source }, {
      env: baseEnv,
      fetchImpl: async (_url, init) => {
        captured = JSON.parse(init.body);
        return new Response(null, { status: 201 });
      },
    });
    assert.equal(result.persisted, true, source);
    assert.deepEqual(captured, { status: "success", response_ms: 1, source }, source);
  }
});

test("unknown log statuses and sources cannot inject arbitrary values", async () => {
  let captured;
  const result = await persistLookupLog({ status: "SECRET", responseMs: -10, source: "SECRET" }, {
    env: baseEnv,
    fetchImpl: async (_url, init) => {
      captured = JSON.parse(init.body);
      return new Response(null, { status: 201 });
    },
  });
  assert.deepEqual(result, { persisted: false, reason: "invalid_status" });
  assert.equal(captured, undefined);
});

test("playground limiter stores only an HMAC of the account and uses a daily window", async () => {
  let body;
  const result = await enforcePlaygroundLimit("11111111-2222-3333-4444-555555555555", {
    env: baseEnv,
    fetchImpl: async (_url, init) => { body = JSON.parse(init.body); return Response.json([{ allowed: true, remaining: 49, reset_at: "2026-10-12T00:00:00Z" }]); },
    logger: () => {},
  });
  assert.equal(result.allowed, true);
  assert.equal(body.p_client_hash.length, 64);
  assert.equal(body.p_client_hash.includes("11111111"), false);
  assert.equal(body.p_window_seconds, 86400);
  assert.equal(body.p_max_requests, 50);
});

test("playground limiter blocks with a retry delay and fails open when the database is down", async () => {
  const blocked = await enforcePlaygroundLimit("user-1", {
    env: baseEnv,
    fetchImpl: async () => Response.json([{ allowed: false, remaining: 0, reset_at: new Date(Date.now() + 5000).toISOString() }]),
    logger: () => {},
  });
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds >= 1);
  const open = await enforcePlaygroundLimit("user-1", { env: baseEnv, fetchImpl: async () => { throw new Error("down"); }, logger: () => {} });
  assert.equal(open.allowed, true);
  assert.equal(open.degraded, true);
});
