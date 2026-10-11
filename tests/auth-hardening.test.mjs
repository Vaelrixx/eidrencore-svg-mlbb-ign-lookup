import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTH_RECOVERY_MAX_REQUESTS,
  AUTH_RECOVERY_WINDOW_SECONDS,
  AUTH_SIGNIN_MAX_REQUESTS,
  AUTH_SIGNIN_WINDOW_SECONDS,
  AUTH_SIGNUP_MAX_REQUESTS,
  AUTH_SIGNUP_WINDOW_SECONDS,
  consumeAuthAttempt,
} from "../src/app/api/auth/rate-limit.mjs";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  checkPasswordStrength,
  passwordErrorMessage,
} from "../src/lib/password-policy.mjs";

function request(headers = {}) {
  return { headers: new Headers(headers) };
}

const baseEnv = {
  SUPABASE_URL: "https://example.supabase.co/",
  SUPABASE_SERVICE_ROLE_KEY: "server-only-test-key",
  LOOKUP_RATE_LIMIT_SECRET: "test-hmac-secret",
};

test("password policy requires length, variety, and rejects common passwords", () => {
  assert.equal(PASSWORD_MIN_LENGTH, 12);
  assert.equal(PASSWORD_MAX_LENGTH, 128);

  assert.equal(passwordErrorMessage("short1!", "user@example.com") !== null, true);
  assert.equal(passwordErrorMessage("alllowercaseletters", "user@example.com") !== null, true);
  assert.equal(passwordErrorMessage("Password123", "user@example.com") !== null, true);
  assert.equal(passwordErrorMessage("user@example.com-Secure!1", "user@example.com") !== null, true);
  assert.equal(passwordErrorMessage("Correct-Horse-9-Battery!", "user@example.com"), null);

  const weak = checkPasswordStrength("password123", "someone@example.com");
  assert.equal(weak.ok, false);
  assert.ok(weak.reasons.length >= 1);

  const strong = checkPasswordStrength("Correct-Horse-9-Battery!", "someone@example.com");
  assert.equal(strong.ok, true);
  assert.ok(strong.score >= 3);
});

test("auth limiter uses scoped HMAC buckets with strict windows", async () => {
  assert.equal(AUTH_SIGNIN_WINDOW_SECONDS, 900);
  assert.equal(AUTH_SIGNIN_MAX_REQUESTS, 20);
  assert.equal(AUTH_SIGNUP_WINDOW_SECONDS, 3600);
  assert.equal(AUTH_SIGNUP_MAX_REQUESTS, 10);
  assert.equal(AUTH_RECOVERY_WINDOW_SECONDS, 3600);
  assert.equal(AUTH_RECOVERY_MAX_REQUESTS, 5);

  let captured;
  const result = await consumeAuthAttempt(request({ "x-forwarded-for": "spoofed, 203.0.113.9" }), "auth:signin", {
    env: baseEnv,
    windowSeconds: AUTH_SIGNIN_WINDOW_SECONDS,
    maxRequests: AUTH_SIGNIN_MAX_REQUESTS,
    fetchImpl: async (url, init) => {
      captured = { url, init, body: JSON.parse(init.body) };
      return Response.json([{ allowed: true, remaining: 19, reset_at: "2026-10-12T00:15:00Z" }]);
    },
    logger: () => {},
  });

  assert.equal(result.allowed, true);
  assert.equal(result.remaining, 19);
  assert.equal(captured.url, "https://example.supabase.co/rest/v1/rpc/consume_lookup_limit");
  assert.equal(captured.body.p_client_hash.length, 64);
  assert.equal(captured.body.p_client_hash.includes("203.0.113.9"), false);
  assert.equal(captured.body.p_window_seconds, 900);
  assert.equal(captured.body.p_max_requests, 20);
});

test("auth limiter blocks with Retry-After and fails closed when degraded", async () => {
  const blocked = await consumeAuthAttempt(request({ "x-real-ip": "203.0.113.10" }), "auth:signup", {
    env: baseEnv,
    windowSeconds: AUTH_SIGNUP_WINDOW_SECONDS,
    maxRequests: AUTH_SIGNUP_MAX_REQUESTS,
    fetchImpl: async () => Response.json([{ allowed: false, remaining: 0, reset_at: new Date(Date.now() + 8000).toISOString() }]),
    logger: () => {},
  });
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds >= 1 && blocked.retryAfterSeconds <= 3600);

  const lines = [];
  const degraded = await consumeAuthAttempt(request({ "x-real-ip": "203.0.113.10" }), "auth:signin", {
    env: baseEnv,
    windowSeconds: AUTH_SIGNIN_WINDOW_SECONDS,
    maxRequests: AUTH_SIGNIN_MAX_REQUESTS,
    fetchImpl: async () => { throw new Error("sensitive database error"); },
    logger: (line) => lines.push(line),
  });
  // Auth must fail closed: a configured-but-unreachable limiter blocks guessing.
  assert.equal(degraded.allowed, false);
  assert.equal(degraded.degraded, true);
  assert.ok(degraded.retryAfterSeconds >= 1);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].includes("sensitive"), false);
});

test("auth limiter stays out of the way when limiter secrets are missing", async () => {
  const result = await consumeAuthAttempt(request({ "x-real-ip": "203.0.113.11" }), "auth:recovery", {
    env: {},
    windowSeconds: AUTH_RECOVERY_WINDOW_SECONDS,
    maxRequests: AUTH_RECOVERY_MAX_REQUESTS,
    logger: () => {},
  });
  assert.deepEqual(result, { enabled: false, allowed: true, retryAfterSeconds: 0 });
});
