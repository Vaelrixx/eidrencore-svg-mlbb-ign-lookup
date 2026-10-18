import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyRapidApiResponse,
  lookupRapidApi,
} from "../src/app/api/lookup/providers/rapidapi.mjs";

test("RapidAPI structured id_not_found body is the only confirmed 404 case", () => {
  assert.deepEqual(
    classifyRapidApiResponse(404, {
      error: true,
      status: 404,
      msg: "id_not_found",
    }),
    { kind: "not_found" },
  );
});

test("an HTTP 404 without the documented body remains unavailable", () => {
  assert.deepEqual(
    classifyRapidApiResponse(404, null),
    {
      kind: "unavailable",
      diagnostic: { reason: "http_error", statusCode: 404, responseKind: "empty_or_non_json" },
    },
  );

  assert.deepEqual(
    classifyRapidApiResponse(404, {
      error: true,
      status: 404,
      msg: "gateway_not_found",
    }),
    {
      kind: "unavailable",
      diagnostic: { reason: "http_error", statusCode: 404, responseKind: "id_game_checker_schema" },
    },
  );
});

test("provider no_content_0 is unavailable, not a missing player", () => {
  assert.deepEqual(
    classifyRapidApiResponse(200, {
      error: false,
      status: 204,
      msg: "no_content_0",
      data: { id: "1234", avatar: "", username: "" },
    }),
    {
      kind: "unavailable",
      diagnostic: { reason: "provider_error", statusCode: 200, responseKind: "id_game_checker_schema" },
    },
  );

  assert.deepEqual(
    classifyRapidApiResponse(204, null),
    {
      kind: "unavailable",
      diagnostic: { reason: "provider_error", statusCode: 204, responseKind: "empty_or_non_json" },
    },
  );
});

test("new documented id_found schema resolves data.username", () => {
  assert.deepEqual(
    classifyRapidApiResponse(200, {
      error: false,
      status: 200,
      msg: "id_found",
      data: { id: "1234", avatar: "avatar.jpg", username: "ValidNickname" },
    }),
    {
      kind: "success",
      nickname: "ValidNickname",
      source: "rapidapi_id_game_checker",
    },
  );
});

test("HTTP 429 remains rate limited", () => {
  assert.deepEqual(
    classifyRapidApiResponse(429, { error: true, msg: "rate limit" }),
    {
      kind: "rate_limited",
      diagnostic: { reason: "http_error", statusCode: 429, responseKind: "other_json_object" },
    },
  );
});

test("lookupRapidApi parses a structured 404 body rather than discarding it", async () => {
  const previousNewKey = process.env.RAPIDAPI_KEY_NEW;
  const previousKey = process.env.RAPIDAPI_KEY;
  const previousToken = process.env.RAPIDAPI_APP_TOKEN;
  const previousFetch = globalThis.fetch;
  let requestedUrl = "";
  let requestedKey = "";

  delete process.env.RAPIDAPI_KEY_NEW;
  process.env.RAPIDAPI_KEY = "unit-test-key";
  delete process.env.RAPIDAPI_APP_TOKEN;
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedKey = init?.headers?.["x-rapidapi-key"] ?? "";
    return new Response(JSON.stringify({
      error: true,
      status: 404,
      msg: "id_not_found",
    }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const result = await lookupRapidApi("1114917746", "13486");
    assert.deepEqual(result, { kind: "not_found" });
    assert.match(requestedUrl, /\/mobile-legends\/1114917746\/13486$/);
    assert.equal(requestedKey, "unit-test-key");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousNewKey === undefined) delete process.env.RAPIDAPI_KEY_NEW;
    else process.env.RAPIDAPI_KEY_NEW = previousNewKey;
    if (previousKey === undefined) delete process.env.RAPIDAPI_KEY;
    else process.env.RAPIDAPI_KEY = previousKey;
    if (previousToken === undefined) delete process.env.RAPIDAPI_APP_TOKEN;
    else process.env.RAPIDAPI_APP_TOKEN = previousToken;
  }
});

test("lookupRapidApi does not return an upstream body on failures", async () => {
  const previousNewKey = process.env.RAPIDAPI_KEY_NEW;
  const previousKey = process.env.RAPIDAPI_KEY;
  const previousToken = process.env.RAPIDAPI_APP_TOKEN;
  const previousFetch = globalThis.fetch;

  delete process.env.RAPIDAPI_KEY_NEW;
  process.env.RAPIDAPI_KEY = "unit-test-key";
  delete process.env.RAPIDAPI_APP_TOKEN;
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: false,
    status: 204,
    msg: "no_content_0",
    data: { username: "" },
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

  try {
    const result = await lookupRapidApi("1114917746", "13486");
    assert.deepEqual(result, {
      kind: "unavailable",
      diagnostic: { reason: "provider_error", statusCode: 200, responseKind: "id_game_checker_schema" },
    });
    assert.equal(JSON.stringify(result).includes("unit-test-key"), false);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousNewKey === undefined) delete process.env.RAPIDAPI_KEY_NEW;
    else process.env.RAPIDAPI_KEY_NEW = previousNewKey;
    if (previousKey === undefined) delete process.env.RAPIDAPI_KEY;
    else process.env.RAPIDAPI_KEY = previousKey;
    if (previousToken === undefined) delete process.env.RAPIDAPI_APP_TOKEN;
    else process.env.RAPIDAPI_APP_TOKEN = previousToken;
  }
});

test("RapidAPI lookup reports missing configuration without fetching", async () => {
  const previousNewKey = process.env.RAPIDAPI_KEY_NEW;
  const previousKey = process.env.RAPIDAPI_KEY;
  const previousToken = process.env.RAPIDAPI_APP_TOKEN;
  const previousFetch = globalThis.fetch;
  delete process.env.RAPIDAPI_KEY_NEW;
  delete process.env.RAPIDAPI_KEY;
  delete process.env.RAPIDAPI_APP_TOKEN;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error("unexpected fetch");
  };

  try {
    assert.deepEqual(
      await lookupRapidApi("1114917746", "13486"),
      { kind: "unavailable", diagnostic: { reason: "missing_config" } },
    );
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousNewKey === undefined) delete process.env.RAPIDAPI_KEY_NEW;
    else process.env.RAPIDAPI_KEY_NEW = previousNewKey;
    if (previousKey === undefined) delete process.env.RAPIDAPI_KEY;
    else process.env.RAPIDAPI_KEY = previousKey;
    if (previousToken === undefined) delete process.env.RAPIDAPI_APP_TOKEN;
    else process.env.RAPIDAPI_APP_TOKEN = previousToken;
  }
});
