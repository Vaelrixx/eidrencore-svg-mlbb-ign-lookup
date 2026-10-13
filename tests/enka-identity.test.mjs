import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyEnkaIdentityResponse, lookupEnkaIdentity } from "../src/app/api/lookup/providers/enka-identity.mjs";

const cases = [
  { game: "hsr", uid: "800333000", payload: { detailInfo: { nickname: "Trailblazer" } }, expectedUrl: "https://enka.network/api/hsr/uid/800333000/?info" },
  { game: "zzz", uid: "1317572318", payload: { PlayerInfo: { SocialDetail: { ProfileDetail: { Nickname: "Proxy" } } } }, expectedUrl: "https://enka.network/api/zzz/uid/1317572318/?info" },
];

describe("Enka identity classifiers", () => {
  for (const entry of cases) {
    it(`${entry.game} resolves only its contracted nickname shape`, () => {
      const result = classifyEnkaIdentityResponse(entry.game, 200, entry.payload);
      assert.equal(result.kind, "success");
      assert.equal(typeof result.nickname, "string");
      assert.ok(result.nickname.length > 0);
    });
  }

  it("gates not-found strictly on HTTP 404", () => {
    assert.equal(classifyEnkaIdentityResponse("hsr", 404, { message: "not found" }).kind, "not_found");
    assert.equal(classifyEnkaIdentityResponse("zzz", 200, { message: "not found" }).kind, "unavailable");
  });

  it("treats throttling, invalid UID, and upstream failures conservatively", () => {
    assert.equal(classifyEnkaIdentityResponse("hsr", 429, null).kind, "rate_limited");
    assert.equal(classifyEnkaIdentityResponse("zzz", 400, { code: "wrong_uid" }).kind, "unavailable");
    for (const status of [424, 500, 503]) assert.equal(classifyEnkaIdentityResponse("hsr", status, null).kind, "unavailable");
  });

  it("rejects empty and malformed success payloads", () => {
    assert.equal(classifyEnkaIdentityResponse("hsr", 200, { detailInfo: { nickname: " " } }).kind, "unavailable");
    assert.equal(classifyEnkaIdentityResponse("zzz", 200, { PlayerInfo: {} }).kind, "unavailable");
    assert.equal(classifyEnkaIdentityResponse("bogus", 200, {}).kind, "unavailable");
  });
});

describe("Enka identity requests", () => {
  for (const entry of cases) {
    it(`${entry.game} calls the info-only endpoint with string-safe UID`, async () => {
      const calls = [];
      const result = await lookupEnkaIdentity(entry.game, entry.uid, {
        fetchImpl: async (url, init) => {
          calls.push({ url, init });
          return { status: 200, json: async () => entry.payload };
        },
      });
      assert.equal(result.kind, "success");
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, entry.expectedUrl);
      assert.equal(calls[0].init.headers["User-Agent"], "EidrenIdentityLookup/1.0");
    });
  }

  it("rejects numeric and malformed IDs without network access", async () => {
    let called = false;
    for (const uid of [800333000, "12", "not-a-uid", "1".repeat(25)]) {
      const result = await lookupEnkaIdentity("hsr", uid, { fetchImpl: async () => { called = true; throw new Error("must not fetch"); } });
      assert.equal(result.kind, "unavailable");
      assert.equal(result.diagnostic.reason, "invalid_input");
    }
    assert.equal(called, false);
  });

  it("maps transport failures to unavailable without leaking details", async () => {
    const result = await lookupEnkaIdentity("zzz", "1317572318", { fetchImpl: async () => { throw new Error("sensitive transport detail"); } });
    assert.equal(result.kind, "unavailable");
    assert.equal(result.diagnostic.reason, "network_or_timeout");
    assert.equal(JSON.stringify(result).includes("sensitive"), false);
  });
});
