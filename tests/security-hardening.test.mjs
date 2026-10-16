import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isSameOriginRequest, requiresSameOriginProtection } from "../src/lib/security/csrf.mjs";
import { safeNextPath } from "../src/lib/security/safe-next-path.mjs";
import { createPinnedLookup, postHttpsJsonPinned } from "../src/lib/security/pinned-https.mjs";
import { isSafeWebhookUrl, resolveSafeWebhookTarget } from "../src/lib/security/webhook-url.mjs";

const APP_ORIGIN = "https://eidrencore-ui.vercel.app";

test("cookie-backed unsafe API methods require same-origin validation", () => {
  assert.equal(requiresSameOriginProtection("POST", "/api/keys"), true);
  assert.equal(requiresSameOriginProtection("DELETE", "/api/keys/abc"), true);
  assert.equal(requiresSameOriginProtection("GET", "/api/keys"), false);
  assert.equal(requiresSameOriginProtection("POST", "/dashboard", ""), false);
  assert.equal(requiresSameOriginProtection("POST", "/api/lookup", "Bearer eid_abc123"), false);
  assert.equal(requiresSameOriginProtection("POST", "/api/lookup/game", "Bearer eid_abc123"), false);
  assert.equal(requiresSameOriginProtection("POST", "/api/keys", "Bearer eid_abc123"), true);
  assert.equal(requiresSameOriginProtection("POST", "/api/billing/webhook"), false);
  assert.equal(requiresSameOriginProtection("POST", "/api/internal/webhooks/dispatch"), false);
});

test("same-origin validation accepts the configured origin and rejects missing, opaque, or foreign origins", () => {
  assert.equal(isSameOriginRequest(APP_ORIGIN, null, APP_ORIGIN), true);
  assert.equal(isSameOriginRequest(null, `${APP_ORIGIN}/dashboard`, APP_ORIGIN), true);
  assert.equal(isSameOriginRequest("https://attacker.example", `${APP_ORIGIN}/dashboard`, APP_ORIGIN), false);
  assert.equal(isSameOriginRequest("null", `${APP_ORIGIN}/dashboard`, APP_ORIGIN), false);
  assert.equal(isSameOriginRequest(null, null, APP_ORIGIN), false);
  assert.equal(isSameOriginRequest("not a URL", null, APP_ORIGIN), false);
  assert.equal(isSameOriginRequest(APP_ORIGIN, null, "javascript:alert(1)"), false);
});

test("safe post-login path accepts same-site paths and rejects ambiguous/external destinations", () => {
  assert.equal(safeNextPath("/dashboard?tab=keys"), "/dashboard?tab=keys");
  assert.equal(safeNextPath("/docs/reference#auth"), "/docs/reference#auth");
  for (const value of [
    "https://attacker.example",
    "//attacker.example",
    "/\\\\attacker.example",
    "/%252f%252fattacker.example",
    "/%5c%5cattacker.example",
    "/bad%zz",
    "/control\u0000path",
    "/" + "x".repeat(200),
    null,
  ]) assert.equal(safeNextPath(value), "/dashboard", `expected rejection for ${JSON.stringify(value)}`);
  assert.equal(safeNextPath("//attacker.example", "/"), "/");
});

test("webhook resolver rejects unsafe schemes, ports, literals, and mixed DNS answers", async () => {
  assert.equal(await isSafeWebhookUrl("http://hooks.example.test/path", async () => []), false);
  assert.equal(await isSafeWebhookUrl("https://user:pass@hooks.example.test/path", async () => []), false);
  assert.equal(await isSafeWebhookUrl("https://hooks.example.test:8443/path", async () => []), false);
  assert.equal(await isSafeWebhookUrl("https://localhost/path", async () => []), false);
  assert.equal(await isSafeWebhookUrl("https://127.0.0.1/path", async () => []), false);
  assert.equal(await isSafeWebhookUrl("https://169.254.169.254/latest/meta-data/", async () => []), false);
  assert.equal(await isSafeWebhookUrl("https://hooks.example.test/path", async () => [
    { address: "93.184.216.34", family: 4 },
    { address: "10.0.0.9", family: 4 },
  ]), false);
});

test("webhook resolver returns one validated public DNS answer to pin for delivery", async () => {
  let lookupCount = 0;
  const target = await resolveSafeWebhookTarget("https://hooks.example.test/events", async (host, options) => {
    lookupCount += 1;
    assert.equal(host, "hooks.example.test");
    assert.deepEqual(options, { all: true, verbatim: true });
    return [
      { address: "93.184.216.34", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ];
  });
  assert.deepEqual(target, { url: "https://hooks.example.test/events", address: "93.184.216.34", family: 4 });
  assert.equal(lookupCount, 1);

  const ipv6Target = await resolveSafeWebhookTarget("https://hooks-v6.example.test/events", async () => [
    { address: "2606:4700:4700::1111", family: 6 },
  ]);
  assert.equal(ipv6Target?.address, "2606:4700:4700::1111");
  assert.equal(await resolveSafeWebhookTarget("https://hooks-v6.example.test/events", async () => [
    { address: "fd00::1", family: 6 },
  ]), null);
  for (const [address, family] of [["192.0.0.8", 4], ["2002:7f00:1::1", 6], ["3fff::1", 6]]) {
    assert.equal(await resolveSafeWebhookTarget("https://special.example.test/events", async () => [
      { address, family },
    ]), null, `expected special-use address ${address} to be rejected`);
  }
});

test("pinned HTTPS request preserves hostname/SNI and only supplies the validated address to DNS lookup", async () => {
  let captured;
  const fakeRequest = (url, options, onResponse) => {
    captured = { url, options, body: null };
    const request = new EventEmitter();
    request.setTimeout = () => request;
    request.destroy = error => { if (error) request.emit("error", error); };
    request.end = body => {
      captured.body = body;
      onResponse({ statusCode: 202, on() {}, destroy() {} });
    };
    return request;
  };

  const target = { url: "https://hooks.example.test/events", address: "93.184.216.34", family: 4 };
  const result = await postHttpsJsonPinned(target, { "Content-Type": "application/json" }, "{}", 5000, fakeRequest);
  assert.deepEqual(result, { status: 202, ok: true });
  assert.equal(new URL(captured.url).hostname, "hooks.example.test");
  assert.equal(captured.options.agent, false);
  assert.equal(captured.options.headers["Content-Length"], "2");
  assert.equal(captured.body, "{}");

  const singleAnswer = await new Promise((resolve, reject) => {
    captured.options.lookup("hooks.example.test", {}, (error, address, family) => error ? reject(error) : resolve({ address, family }));
  });
  assert.deepEqual(singleAnswer, { address: "93.184.216.34", family: 4 });
  const allAnswers = await new Promise((resolve, reject) => {
    captured.options.lookup("hooks.example.test", { all: true }, (error, records) => error ? reject(error) : resolve(records));
  });
  assert.deepEqual(allAnswers, [{ address: "93.184.216.34", family: 4 }]);

  assert.throws(() => createPinnedLookup("127.0.0.1", 4), /validated public IPv4 or IPv6/);
});

test("API-key cap migration serializes count-and-insert and limits RPC access to service_role", () => {
  const migration = readFileSync(new URL("../supabase/migrations/20261016062256_atomic_api_key_cap.sql", import.meta.url), "utf8");
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /v_active_count\s*>=\s*10/);
  assert.match(migration, /return query\s+insert into public\.api_keys/s);
  assert.match(migration, /revoke all on function public\.create_developer_api_key[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.create_developer_api_key[\s\S]*to service_role/i);
});
