import test from "node:test";
import assert from "node:assert/strict";
import {
  classifySupercellResponse,
  lookupSupercellPlayer,
  normalizeSupercellTag,
} from "../src/app/api/lookup/providers/supercell.mjs";
import { lookupBrawlStars } from "../src/app/api/lookup/providers/brawl-stars.mjs";
import { lookupClashOfClans } from "../src/app/api/lookup/providers/clash-of-clans.mjs";
import { lookupClashRoyale } from "../src/app/api/lookup/providers/clash-royale.mjs";

test("player tags normalize to uppercase with a leading hash", () => {
  assert.equal(normalizeSupercellTag("#2pp"), "#2PP");
  assert.equal(normalizeSupercellTag("2pp"), "#2PP");
  assert.equal(normalizeSupercellTag("  ##2pp  "), "#2PP");
  assert.equal(normalizeSupercellTag("#C0G20PR2"), "#C0G20PR2");
});

test("tags outside the Supercell alphabet are rejected", () => {
  assert.equal(normalizeSupercellTag("ABC123!"), "");
  assert.equal(normalizeSupercellTag("has space"), "");
  assert.equal(normalizeSupercellTag(""), "");
  assert.equal(normalizeSupercellTag(null), "");
  assert.equal(normalizeSupercellTag("#"), "");
  assert.equal(normalizeSupercellTag(`#${"2".repeat(21)}`), "");
});

test("a 200 with a usable name is a success", () => {
  assert.deepEqual(
    classifySupercellResponse(200, { tag: "#2PP", name: "ValidNickname" }, "brawl_stars_official_api"),
    { kind: "success", nickname: "ValidNickname", source: "brawl_stars_official_api" },
  );
});

test("404 and notFound reasons are not_found", () => {
  assert.deepEqual(
    classifySupercellResponse(404, { reason: "notFound", message: "Not found." }, "clash_royale_official_api"),
    { kind: "not_found" },
  );
  assert.deepEqual(
    classifySupercellResponse(400, { reason: "notFound" }, "clash_of_clans_official_api"),
    { kind: "not_found" },
  );
});

test("403 and 429 are rate limited, other errors are unavailable", () => {
  assert.deepEqual(
    classifySupercellResponse(429, { reason: "throttled" }, "brawl_stars_official_api"),
    { kind: "rate_limited", diagnostic: { reason: "http_error", statusCode: 429 } },
  );
  assert.deepEqual(
    classifySupercellResponse(403, { reason: "accessDenied" }, "brawl_stars_official_api"),
    { kind: "rate_limited", diagnostic: { reason: "http_error", statusCode: 403 } },
  );
  assert.deepEqual(
    classifySupercellResponse(500, null, "brawl_stars_official_api"),
    { kind: "unavailable", diagnostic: { reason: "http_error", statusCode: 500 } },
  );
  assert.deepEqual(
    classifySupercellResponse(200, { tag: "#2PP", name: "error" }, "brawl_stars_official_api").kind,
    "unavailable",
  );
});

test("missing game keys fail closed without fetching", async () => {
  let fetchCalled = false;
  const env = { BRAWL_STARS_API_KEY: "", CLASH_OF_CLANS_API_KEY: "", CLASH_ROYALE_API_KEY: "" };
  const fetchImpl = async () => {
    fetchCalled = true;
    throw new Error("unexpected fetch");
  };
  assert.deepEqual(
    await lookupSupercellPlayer("brawl-stars", "#2PP", { env, fetchImpl }),
    { kind: "unavailable", diagnostic: { reason: "missing_config" } },
  );
  assert.equal(fetchCalled, false);
});

test("each game adapter hits its own official host with a bearer key", async () => {
  const cases = [
    { lookup: lookupBrawlStars, envKey: "BRAWL_STARS_API_KEY", host: "https://api.brawlstars.com" },
    { lookup: lookupClashOfClans, envKey: "CLASH_OF_CLANS_API_KEY", host: "https://api.clashofclans.com" },
    { lookup: lookupClashRoyale, envKey: "CLASH_ROYALE_API_KEY", host: "https://api.clashroyale.com" },
  ];
  const previousFetch = globalThis.fetch;
  for (const { lookup, envKey, host } of cases) {
    let requestedUrl = "";
    let requestedAuth = "";
    const result = await lookup("2pp", {
      env: { [envKey]: "unit-test-key" },
      fetchImpl: async (url, init) => {
        requestedUrl = String(url);
        requestedAuth = init?.headers?.Authorization ?? "";
        return new Response(JSON.stringify({ tag: "#2PP", name: "ValidNickname" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });
    assert.equal(result.kind, "success");
    assert.equal(requestedUrl, `${host}/v1/players/%232PP`);
    assert.equal(requestedAuth, "Bearer unit-test-key");
    assert.equal(JSON.stringify(result).includes("unit-test-key"), false);
  }
  globalThis.fetch = previousFetch;
});

test("network failures are unavailable and never leak credentials", async () => {
  const result = await lookupSupercellPlayer("clash-royale", "#2PP", {
    env: { CLASH_ROYALE_API_KEY: "unit-test-key" },
    fetchImpl: async () => { throw new Error("sensitive network failure"); },
  });
  assert.deepEqual(result, { kind: "unavailable", diagnostic: { reason: "network_or_timeout" } });
  assert.equal(JSON.stringify(result).includes("unit-test-key"), false);
});
