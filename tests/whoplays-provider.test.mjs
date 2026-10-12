import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyWhoPlaysResponse,
  lookupWhoPlays,
} from "../src/app/api/lookup/providers/whoplays.mjs";

test("WhoPlays not_found error kind is the only confirmed 404 case", () => {
  assert.deepEqual(
    classifyWhoPlaysResponse(422, {
      ok: false,
      error: "not_found",
      message: "Couldn't find that player.",
    }),
    { kind: "not_found" },
  );
});

test("an HTTP 404 without the documented error kind remains unavailable", () => {
  assert.deepEqual(
    classifyWhoPlaysResponse(404, null),
    {
      kind: "unavailable",
      diagnostic: { reason: "http_error", statusCode: 404, responseKind: "empty_or_non_json" },
    },
  );

  assert.deepEqual(
    classifyWhoPlaysResponse(404, {
      ok: false,
      error: "unknown_game",
      message: "That game value isn't supported.",
    }),
    {
      kind: "unavailable",
      diagnostic: { reason: "provider_error", statusCode: 404, responseKind: "whoplays_error_schema" },
    },
  );
});

test("documented success schema resolves username", () => {
  assert.deepEqual(
    classifyWhoPlaysResponse(200, {
      ok: true,
      game: "mobile-legends",
      username: "ValidNickname",
    }),
    {
      kind: "success",
      nickname: "ValidNickname",
      source: "whoplays_check",
    },
  );
});

test("placeholder usernames are rejected, not returned", () => {
  assert.deepEqual(
    classifyWhoPlaysResponse(200, {
      ok: true,
      game: "mobile-legends",
      username: "na",
    }),
    {
      kind: "unavailable",
      diagnostic: { reason: "unrecognized_response", statusCode: 200, responseKind: "whoplays_success_schema" },
    },
  );
});

test("upstream degradation errors are unavailable, not a missing player", () => {
  for (const error of ["parse", "upstream"]) {
    assert.deepEqual(
      classifyWhoPlaysResponse(502, {
        ok: false,
        error,
        message: "The game's servers gave us an error.",
      }),
      {
        kind: "unavailable",
        diagnostic: { reason: "provider_error", statusCode: 502, responseKind: "whoplays_error_schema" },
      },
    );
  }
});

test("server-side key failures are unavailable, never not-found", () => {
  assert.deepEqual(
    classifyWhoPlaysResponse(401, {
      ok: false,
      error: "unauthorized",
      message: "Your key is missing or wrong.",
    }),
    {
      kind: "unavailable",
      diagnostic: { reason: "provider_error", statusCode: 401, responseKind: "whoplays_error_schema" },
    },
  );
});

test("HTTP 429 and rate_limited error kind remain rate limited", () => {
  assert.deepEqual(
    classifyWhoPlaysResponse(429, {
      ok: false,
      error: "rate_limited",
      message: "You hit the cap.",
    }),
    {
      kind: "rate_limited",
      diagnostic: { reason: "http_error", statusCode: 429, responseKind: "whoplays_error_schema" },
    },
  );
});

test("lookupWhoPlays posts the documented game and input body", async () => {
  const previousKey = process.env.WHOPLAYS_API_KEY;
  const previousFetch = globalThis.fetch;
  let requestedUrl = "";
  let requestedAuth = "";
  let requestedBody = "";

  process.env.WHOPLAYS_API_KEY = "unit-test-key";
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedAuth = init?.headers?.Authorization ?? "";
    requestedBody = String(init?.body ?? "");
    return new Response(JSON.stringify({
      ok: true,
      game: "mobile-legends",
      username: "ValidNickname",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const result = await lookupWhoPlays("1114917746", "13486");
    assert.deepEqual(result, {
      kind: "success",
      nickname: "ValidNickname",
      source: "whoplays_check",
    });
    assert.equal(requestedUrl, "https://whoplays.doedja.com/api/check");
    assert.equal(requestedAuth, "Bearer unit-test-key");
    assert.deepEqual(JSON.parse(requestedBody), {
      game: "mobile-legends",
      input: { userId: "1114917746", zoneId: "13486" },
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.WHOPLAYS_API_KEY;
    else process.env.WHOPLAYS_API_KEY = previousKey;
  }
});

test("lookupWhoPlays never leaks the key in results", async () => {
  const previousKey = process.env.WHOPLAYS_API_KEY;
  const previousFetch = globalThis.fetch;

  process.env.WHOPLAYS_API_KEY = "unit-test-key";
  globalThis.fetch = async () => new Response(JSON.stringify({
    ok: false,
    error: "upstream",
    message: "The game's servers gave us an error.",
  }), {
    status: 502,
    headers: { "Content-Type": "application/json" },
  });

  try {
    const result = await lookupWhoPlays("1114917746", "13486");
    assert.deepEqual(result, {
      kind: "unavailable",
      diagnostic: { reason: "provider_error", statusCode: 502, responseKind: "whoplays_error_schema" },
    });
    assert.equal(JSON.stringify(result).includes("unit-test-key"), false);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.WHOPLAYS_API_KEY;
    else process.env.WHOPLAYS_API_KEY = previousKey;
  }
});

test("WhoPlays lookup reports missing configuration without fetching", async () => {
  const previousKey = process.env.WHOPLAYS_API_KEY;
  const previousFetch = globalThis.fetch;
  let fetchCalled = false;

  delete process.env.WHOPLAYS_API_KEY;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error("unexpected fetch");
  };

  try {
    const result = await lookupWhoPlays("1114917746", "13486");
    assert.deepEqual(result, { kind: "unavailable", diagnostic: { reason: "missing_config" } });
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.WHOPLAYS_API_KEY;
    else process.env.WHOPLAYS_API_KEY = previousKey;
  }
});
