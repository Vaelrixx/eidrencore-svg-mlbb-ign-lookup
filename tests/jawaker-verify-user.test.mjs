import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyJawakerVerifyResponse,
  lookupJawakerVerifyUser,
} from "../src/app/api/lookup/providers/jawaker-verify-user.mjs";

// Live-verified 2026-10-13 (re-verified at build): docs sample resolves.
const valid = { user: { id: 23611298, login: "abdom6", level: 54 } };

function sessionFetch(verifyImpl) {
  return async (url, init) => {
    if (String(url).endsWith("/en/offers")) {
      const headers = new Headers();
      headers.append("Set-Cookie", "session=abc123; Path=/");
      return new Response('<html><meta name="csrf-token" content="csrf-token-xyz"></html>', { status: 200, headers });
    }
    return verifyImpl(url, init);
  };
}

test("user.login schema resolves the live-verified nickname", () => {
  assert.deepEqual(classifyJawakerVerifyResponse(200, valid), {
    kind: "success",
    nickname: "abdom6",
    source: "jawaker_shop_validation",
  });
});

test("bare HTTP 404 is not-found; other errors degrade", () => {
  assert.deepEqual(classifyJawakerVerifyResponse(404, null), { kind: "not_found" });
  assert.equal(classifyJawakerVerifyResponse(429, null).kind, "rate_limited");
  assert.equal(classifyJawakerVerifyResponse(500, null).kind, "unavailable");
  assert.equal(classifyJawakerVerifyResponse(200, { user: null }).kind, "unavailable");
  assert.equal(classifyJawakerVerifyResponse(200, null).kind, "unavailable");
});

test("lookup fetches session then posts player_number with CSRF + cookie", async () => {
  let verifyRequest;
  const result = await lookupJawakerVerifyUser("1473084005", {
    fetchImpl: sessionFetch(async (url, init) => {
      verifyRequest = { url: String(url), init };
      return new Response(JSON.stringify(valid), { status: 200 });
    }),
  });
  assert.equal(verifyRequest.url, "https://shop.jawaker.com/en/offers/verify_user");
  const body = JSON.parse(verifyRequest.init.body);
  assert.deepEqual(body, { player_number: "1473084005" });
  assert.equal(verifyRequest.init.headers["X-CSRF-Token"], "csrf-token-xyz");
  assert.ok(String(verifyRequest.init.headers.Cookie).includes("session=abc123"));
  assert.equal("Authorization" in verifyRequest.init.headers, false);
  assert.equal(result.kind, "success");
});

test("bogus numbers surface not-found through the full session flow", async () => {
  const result = await lookupJawakerVerifyUser("0000000001", {
    fetchImpl: sessionFetch(async () => new Response("", { status: 404 })),
  });
  assert.deepEqual(result, { kind: "not_found" });
});

test("session failures and bad inputs degrade without leaking details", async () => {
  const noSession = await lookupJawakerVerifyUser("1473084005", {
    fetchImpl: async () => new Response("down", { status: 503 }),
  });
  assert.equal(noSession.kind, "unavailable");

  const noCsrf = await lookupJawakerVerifyUser("1473084005", {
    fetchImpl: async () => new Response("<html>no token</html>", { status: 200 }),
  });
  assert.equal(noCsrf.kind, "unavailable");

  assert.deepEqual((await lookupJawakerVerifyUser("abc", { fetchImpl: async () => { throw new Error("x"); } })).kind, "unavailable");
  const net = await lookupJawakerVerifyUser("1473084005", {
    fetchImpl: async (url) => {
      if (String(url).endsWith("/en/offers")) throw new Error("private socket detail");
      throw new Error("unreachable");
    },
  });
  assert.deepEqual(net, { kind: "unavailable", diagnostic: { reason: "network_or_timeout" } });
  assert.equal(JSON.stringify(net).includes("private socket"), false);
});
