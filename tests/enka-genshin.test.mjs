import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyEnkaGenshinResponse,
  lookupEnkaGenshin,
} from "../src/app/api/lookup/providers/enka-genshin.mjs";

describe("enka genshin classifier", () => {
  it("resolves playerInfo.nickname to success", () => {
    const result = classifyEnkaGenshinResponse(200, {
      playerInfo: { nickname: "Verin" },
      uid: "844335555",
    });
    assert.equal(result.kind, "success");
    assert.equal(result.nickname, "Verin");
  });

  it("gates not-found strictly on HTTP 404", () => {
    const result = classifyEnkaGenshinResponse(404, {
      message: "Player not found.",
      code: "not_found",
    });
    assert.equal(result.kind, "not_found");
  });

  it("treats HTTP 400 wrong_uid as invalid input, never not-found", () => {
    const result = classifyEnkaGenshinResponse(400, {
      message: "The UID is not valid for this game.",
      code: "wrong_uid",
    });
    assert.equal(result.kind, "unavailable");
    assert.equal(result.diagnostic.reason, "invalid_input");
  });

  it("treats 429 as rate limited", () => {
    const result = classifyEnkaGenshinResponse(429, null);
    assert.equal(result.kind, "rate_limited");
  });

  it("treats maintenance and server errors as degraded", () => {
    for (const status of [424, 500, 503]) {
      const result = classifyEnkaGenshinResponse(status, null);
      assert.equal(result.kind, "unavailable");
      assert.equal(result.diagnostic.reason, "http_error");
    }
  });

  it("never succeeds on empty or whitespace nicknames", () => {
    for (const nickname of ["", "   "]) {
      const result = classifyEnkaGenshinResponse(200, { playerInfo: { nickname } });
      assert.equal(result.kind, "unavailable");
      assert.equal(result.diagnostic.reason, "unrecognized_response");
    }
  });
});

describe("enka genshin fetch", () => {
  it("hits the info-only UID endpoint with the contracted user agent", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return {
        status: 200,
        json: async () => ({ playerInfo: { nickname: "Verin" } }),
      };
    };
    const result = await lookupEnkaGenshin("844335555", { fetchImpl });
    assert.equal(result.kind, "success");
    assert.equal(result.nickname, "Verin");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://enka.network/api/uid/844335555/?info");
    assert.equal(calls[0].init.headers["User-Agent"], "EidrenIdentityLookup/1.0");
  });

  it("rejects non-numeric IDs without a network call", async () => {
    let called = false;
    const result = await lookupEnkaGenshin("not-a-uid", {
      fetchImpl: async () => {
        called = true;
        throw new Error("must not fetch");
      },
    });
    assert.equal(result.kind, "unavailable");
    assert.equal(result.diagnostic.reason, "invalid_input");
    assert.equal(called, false);
  });

  it("degrades transport failures to network_or_timeout", async () => {
    const result = await lookupEnkaGenshin("844335555", {
      fetchImpl: async () => {
        throw new Error("boom");
      },
    });
    assert.equal(result.kind, "unavailable");
    assert.equal(result.diagnostic.reason, "network_or_timeout");
  });
});
