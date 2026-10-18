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
  for (const errorMsg of ["User Not Found", "account info not found", "User name not found", "账号错误"]) {
    assert.deepEqual(classifyInitpayResponse(200, { errorCode: "-100", errorMsg }), { kind: "not_found" });
  }
});

test("roles-style games read the nickname from roles[0].role (AoV, live 2026-10-18)", () => {
  const result = classifyInitpayResponse(200, {
    errorCode: "",
    confirmationFields: { roles: [{ role: "creature.6's", server: "Baratayuda" }] },
  }, { nicknameFrom: "roles" });
  assert.equal(result.kind, "success");
  assert.equal(result.nickname, "creature.6's");
  // Same payload without the roles flag has no username: unrecognized.
  assert.equal(classifyInitpayResponse(200, {
    errorCode: "",
    confirmationFields: { roles: [{ role: "creature.6's", server: "Baratayuda" }] },
  }).kind, "unavailable");
});

test("numeric miss codes gate honestly, other numeric codes stay transient (AoV, live 2026-10-18)", () => {
  assert.deepEqual(classifyInitpayResponse(200, { errorCode: 12, errorMsg: "Wrong player id" }), { kind: "not_found" });
  assert.equal(classifyInitpayResponse(200, { errorCode: 5, errorMsg: "Mismatched signature" }).kind, "unavailable");
});

test("unfamiliar errors and empty payloads stay unavailable", () => {
  assert.equal(classifyInitpayResponse(200, { errorCode: "-1", errorMsg: "something else" }).kind, "unavailable");
  assert.equal(classifyInitpayResponse(200, {}).kind, "unavailable");
  assert.equal(classifyInitpayResponse(200, { errorCode: "" }).kind, "unavailable");
  assert.equal(classifyInitpayResponse(429, {}).kind, "rate_limited");
});

test("MLBB probe envelopes stay unwired: opaque RESULT_CODE is transient, zone complaint is not a verdict (live 2026-10-18)", () => {
  // Valid pair (1114917746/13486), vpp 4150 and once-retried 5199: both
  // returned 200 {"RESULT_CODE":239} — no errorCode/errorMsg/nickname.
  assert.deepEqual(classifyInitpayResponse(200, { RESULT_CODE: 239 }), {
    kind: "unavailable",
    diagnostic: { reason: "unrecognized_response", statusCode: 200 },
  });
  // Bogus pair (1000000000/1000) returned numeric -100 Error_InvalidZoneId,
  // which the existing invalid-zone pattern already gates as a miss.
  assert.deepEqual(classifyInitpayResponse(200, {
    user: { userId: "1000000000", zoneId: "1000" },
    result: "",
    confirmation: false,
    success: false,
    errorCode: -100,
    isThirdPartyMerchant: true,
    errorMsg: "-100: Error_InvalidZoneId",
  }), { kind: "not_found" });
  // No MLBB leg: the valid pair never yields a nickname on either price
  // point, so there is no honest valid-vs-bogus gate to freeze into
  // INITPAY_GAMES.
  assert.equal("mobile-legends" in INITPAY_GAMES, false);
});

test("only live-verified games are enabled", () => {
  // MLBB stays out: probed 2026-10-18, no honest valid/bogus gate (see the
  // MLBB probe-envelopes test above).
  assert.deepEqual(Object.keys(INITPAY_GAMES), ["8-ball-pool", "arena-of-valor", "super-sus"]);
  assert.equal(INITPAY_GAMES["8-ball-pool"].voucherTypeName, "EIGHT_BALL_POOL");
  assert.equal(INITPAY_GAMES["arena-of-valor"].voucherTypeName, "AOV");
  assert.equal(INITPAY_GAMES["arena-of-valor"].pricePointId, "270294");
  assert.equal(INITPAY_GAMES["arena-of-valor"].nicknameFrom, "roles");
  assert.equal(INITPAY_GAMES["super-sus"].voucherTypeName, "SUPER_SUS");
  assert.equal(INITPAY_GAMES["super-sus"].pricePointId, "266079");
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

test("super-sus posts its own voucher and price point (live-verified 2026-10-18)", async () => {
  let captured;
  const result = await lookupCodashopInitpay("super-sus", "163588582", "", {
    fetchImpl: async (url, options) => {
      captured = { url: String(url), options };
      return new Response(JSON.stringify({ errorCode: "", confirmationFields: { username: "zoevii" } }), { status: 200 });
    },
    cache: { getOrLoad: async (_key, _ttl, loader) => ({ value: await loader(), cached: false }) },
  });
  assert.deepEqual(result, { kind: "success", nickname: "zoevii", source: "codashop_initpay" });
  const form = new URLSearchParams(captured.options.body);
  assert.equal(form.get("voucherTypeName"), "SUPER_SUS");
  assert.equal(form.get("user.userId"), "163588582");
  assert.equal(form.get("voucherPricePoint.id"), "266079");
});

test("unknown games and blank IDs fail closed without a network call", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return new Response("{}", { status: 200 }); };
  assert.equal((await lookupCodashopInitpay("nope", "12345", "", { fetchImpl })).diagnostic.reason, "provider_error");
  assert.equal((await lookupCodashopInitpay("8-ball-pool", " ", "", { fetchImpl })).diagnostic.reason, "provider_error");
  assert.equal(calls, 0);
});
