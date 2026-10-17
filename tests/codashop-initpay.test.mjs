import test from "node:test";
import assert from "node:assert/strict";
import { classifyInitpayResponse, INITPAY_GAMES, lookupCodashopInitpay } from "../src/app/api/lookup/providers/codashop-initpay.mjs";

// Shapes captured live 2026-10-18 against order-sg.codashop.com/initPayment.action.
test("empty errorCode with a username resolves as success and decodes the name", () => {
  const result = classifyInitpayResponse(200, {
    errorCode: "",
    confirmationFields: { username: "B****t%20A*****e", userId: "12345" },
  });
  assert.equal(result.kind, "success");
  assert.equal(result.nickname, "B****t A*****e");
  assert.equal(result.source, "codashop_initpay");
});

test("explicit miss messages resolve as not-found", () => {
  for (const errorMsg of ["User Not Found", "account info not found", "User name not found"]) {
    assert.deepEqual(classifyInitpayResponse(200, { errorCode: "-100", errorMsg }), { kind: "not_found" });
  }
});

test("unfamiliar errors and empty payloads stay unavailable", () => {
  assert.equal(classifyInitpayResponse(200, { errorCode: "-1", errorMsg: "something else" }).kind, "unavailable");
  assert.equal(classifyInitpayResponse(200, {}).kind, "unavailable");
  assert.equal(classifyInitpayResponse(200, { errorCode: "" }).kind, "unavailable");
  assert.equal(classifyInitpayResponse(429, {}).kind, "rate_limited");
});

test("only live-verified games are enabled", () => {
  assert.deepEqual(Object.keys(INITPAY_GAMES), ["8-ball-pool"]);
  assert.equal(INITPAY_GAMES["8-ball-pool"].voucherTypeName, "EIGHT_BALL_POOL");
});

test("lookup posts the form-encoded initPayment shape", async () => {
  let captured;
  const result = await lookupCodashopInitpay("8-ball-pool", "12345", "", {
    fetchImpl: async (url, options) => {
      captured = { url: String(url), options };
      return new Response(JSON.stringify({ errorCode: "", confirmationFields: { username: "Test%20Player" } }), { status: 200 });
    },
    cache: { getOrLoad: async (_key, _ttl, loader) => ({ value: await loader(), cached: false }) },
  });
  assert.deepEqual(result, { kind: "success", nickname: "Test Player", source: "codashop_initpay" });
  assert.equal(captured.url, "https://order-sg.codashop.com/initPayment.action");
  assert.equal(captured.options.method, "POST");
  const form = new URLSearchParams(captured.options.body);
  assert.equal(form.get("voucherTypeName"), "EIGHT_BALL_POOL");
  assert.equal(form.get("user.userId"), "12345");
  assert.equal(form.get("voucherPricePoint.id"), "272564");
});

test("unknown games and blank IDs fail closed without a network call", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return new Response("{}", { status: 200 }); };
  assert.equal((await lookupCodashopInitpay("nope", "12345", "", { fetchImpl })).diagnostic.reason, "provider_error");
  assert.equal((await lookupCodashopInitpay("8-ball-pool", " ", "", { fetchImpl })).diagnostic.reason, "provider_error");
  assert.equal(calls, 0);
});
