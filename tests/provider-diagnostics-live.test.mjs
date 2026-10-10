import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { confirmedNickname } from "../src/app/api/lookup/nickname-validation.mjs";
import { lookupIsan } from "../src/app/api/lookup/providers/isan.mjs";

const playerId = process.env.LIVE_LOOKUP_PLAYER_ID ?? "1114917746";
const zoneId = process.env.LIVE_LOOKUP_ZONE_ID ?? "13486";
const timeoutMs = 6000;

function classify(provider, response, payload) {
  if (response.status === 429) return "rate_limited";

  // ID Game Checker publishes this response as its explicit ID-not-found case.
  // Require the provider's structured body; do not infer not-found from HTTP 404 alone.
  if (
    provider === "rapidapi_id_game_checker" &&
    Number(payload?.status) === 404 &&
    payload?.msg === "id_not_found"
  ) return "not_found";

  // The provider documents 204/no_content_0 as source data being unavailable.
  if (provider === "rapidapi_id_game_checker" && Number(payload?.status) === 204) {
    return "upstream_unavailable";
  }

  if (response.ok && confirmedNickname(payload)) return "success";
  if (!response.ok) return "http_error";
  return "unrecognized_response";
}

async function probeHttp({ provider, url, init }) {
  const startedAt = performance.now();
  try {
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload = await response.json().catch(() => null);
    return {
      provider,
      outcome: classify(provider, response, payload),
      upstreamStatus: response.status,
      responseShape: safePayloadShape(payload, response.headers.get("content-type")),
      durationMs: Math.round(performance.now() - startedAt),
    };
  } catch {
    return {
      provider,
      outcome: "network_or_timeout",
      durationMs: Math.round(performance.now() - startedAt),
    };
  }
}


function safePayloadShape(payload, rawContentType) {
  const payloadType = payload === null
    ? "null"
    : Array.isArray(payload)
      ? "array"
      : typeof payload;
  const safeKeys = (value) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value).filter((key) => /^[A-Za-z0-9_.-]{1,40}$/.test(key)).sort().slice(0, 30)
    : [];
  const contentType = (rawContentType ?? "unknown").split(";")[0].trim().slice(0, 80);
  const nestedKeys = {};
  for (const name of ["data", "result", "confirmationFields", "status"]) {
    if (payload && typeof payload === "object" && payload[name] && typeof payload[name] === "object") {
      nestedKeys[name] = safeKeys(payload[name]);
    }
  }
  return { contentType, payloadType, topLevelKeys: safeKeys(payload), nestedKeys };
}

function standardHeaders(origin, referer, contentType) {
  return {
    Accept: "application/json",
    ...(contentType ? { "Content-Type": contentType } : {}),
    Origin: origin,
    Referer: referer,
    "User-Agent": "Mozilla/5.0 (compatible; EidrenMLBBLookup/1.0)",
  };
}

test("live provider sweep reports sanitized status for a known-valid test account", async () => {
  const results = [];

  // This is the exact secondary adapter used by production. Never print its nickname.
  const isanStartedAt = performance.now();
  const isan = await lookupIsan(playerId, zoneId);
  results.push({
    provider: "isan_nickname_api",
    outcome: isan.kind,
    ...(Number.isInteger(isan.diagnostic?.statusCode) ? { upstreamStatus: isan.diagnostic.statusCode } : {}),
    durationMs: Math.round(performance.now() - isanStartedAt),
  });

  const rapidApiKey = process.env.RAPIDAPI_KEY?.trim() || process.env.RAPIDAPI_APP_TOKEN?.trim();
  if (rapidApiKey) {
    results.push(await probeHttp({
      provider: "rapidapi_id_game_checker",
      url: "https://id-game-checker.p.rapidapi.com/mlbb/" + encodeURIComponent(playerId) + "/" + encodeURIComponent(zoneId),
      init: {
        method: "GET",
        headers: {
          Accept: "application/json",
          "x-rapidapi-host": "id-game-checker.p.rapidapi.com",
          "x-rapidapi-key": rapidApiKey,
        },
      },
    }));
  } else {
    results.push({ provider: "rapidapi_id_game_checker", outcome: "skipped_missing_ci_secret" });
  }

  results.push(await probeHttp({
    provider: "elitedias_role_check",
    url: "https://api.elitedias.com/checkid",
    init: {
      method: "POST",
      headers: standardHeaders("https://elitedias.com", "https://elitedias.com/", "application/json; charset=UTF-8"),
      body: JSON.stringify({ userid: playerId, serverid: zoneId, game: "mlbb" }),
    },
  }));

  const smileForm = new URLSearchParams({
    user_id: playerId,
    zone_id: zoneId,
    pid: "216",
    checkrole: "1",
    pay_methond: "",
    channel_method: "",
  });
  results.push(await probeHttp({
    provider: "smileone_role_check",
    url: "https://www.smile.one/ph/merchant/mobilelegends/checkrole/",
    init: {
      method: "POST",
      headers: {
        ...standardHeaders(
          "https://www.smile.one",
          "https://www.smile.one/ph/merchant/mobilelegends?source=other",
          "application/x-www-form-urlencoded; charset=UTF-8",
        ),
        "X-Requested-With": "XMLHttpRequest",
      },
      body: smileForm.toString(),
    },
  }));

  const duniaFields = {
    productId: 1,
    itemId: 2,
    catalogId: 57,
    paymentId: 352,
    gameId: playerId,
    zoneId,
    product_ref: "REG",
    product_ref_denom: "AE",
  };

  // Compare production's form-encoded request against a JSON request for the same inquiry.
  // Both calls are identity inquiries only; neither places an order or submits a payment.
  results.push(await probeHttp({
    provider: "duniagames_role_check_form",
    url: "https://api.duniagames.co.id/api/transaction/v1/top-up/inquiry/store",
    init: {
      method: "POST",
      headers: standardHeaders(
        "https://www.duniagames.co.id",
        "https://www.duniagames.co.id/",
        "application/x-www-form-urlencoded; charset=UTF-8",
      ),
      body: new URLSearchParams(Object.fromEntries(
        Object.entries(duniaFields).map(([key, value]) => [key, String(value)]),
      )).toString(),
    },
  }));

  results.push(await probeHttp({
    provider: "duniagames_role_check_json",
    url: "https://api.duniagames.co.id/api/transaction/v1/top-up/inquiry/store",
    init: {
      method: "POST",
      headers: standardHeaders(
        "https://www.duniagames.co.id",
        "https://www.duniagames.co.id/",
        "application/json",
      ),
      body: JSON.stringify(duniaFields),
    },
  }));

  // Codashop's initPayment endpoint can create a checkout session, so this sweep
  // intentionally does not call it. No purchase or payment endpoint is exercised.

  const allowedOutcomes = new Set([
    "success", "not_found", "rate_limited", "upstream_unavailable",
    "http_error", "unrecognized_response", "network_or_timeout",
    "unavailable", "skipped_missing_ci_secret",
  ]);
  assert.ok(results.length >= 5);
  assert.ok(results.every((result) =>
    typeof result.provider === "string" &&
    allowedOutcomes.has(result.outcome) &&
    Number.isFinite(result.durationMs ?? 0)
  ));

  // Deliberately omit IDs, nickname values, raw payloads, URLs, headers, and credentials.
  console.log(JSON.stringify({
    event: "lookup.provider.sweep",
    testAccount: "known-valid-fixture",
    paymentEndpointsCalled: false,
    results,
  }));
});
