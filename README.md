# Eidren — MLBB IGN Lookup

Standalone Next.js + TypeScript API for resolving Mobile Legends: Bang Bang nicknames from a Player ID and Zone ID.

The service owns input validation, provider orchestration, response normalization, and deployment. It uses a primary community lookup and best-effort fallback providers, including RapidAPI's ID Game Checker when `RAPIDAPI_KEY` (or the legacy `RAPIDAPI_APP_TOKEN`) is configured.

These integrations are unofficial third-party endpoints, not an official Moonton API. Their contracts and availability can change. RapidAPI ID Game Checker uses its documented response body to distinguish an explicit `id_not_found` result from `no_content_0` (provider could not retrieve source data); an HTTP 404 without the documented body remains an upstream-unavailable result. Provider failures and timeouts are **not** treated as proof that an account is invalid.

## Run locally

Requires Node.js 20.9+.

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## API

`GET /api/lookup?playerId=123456789&zoneId=1234` or `POST /api/lookup`

Opening `/api/lookup` in a browser with no query parameters returns service status and usage examples. For a browser-based lookup, pass both IDs as query parameters:

```text
/api/lookup?playerId=1114917746&zoneId=13486
```

For server-to-server usage, send JSON with POST:

```json
{ "playerId": "123456789", "zoneId": "1234" }
```

Successful response:

```json
{
  "success": true,
  "data": {
    "nickname": "ExampleNickname",
    "playerId": "123456789",
    "zoneId": "1234",
    "source": "community_lookup"
  }
}
```

Error responses preserve a stable `{ success: false, error, code }` shape. Common codes include `INVALID_JSON`, `INVALID_INPUT`, `INVALID_ID`, `PLAYER_NOT_FOUND`, `UPSTREAM_RATE_LIMIT`, and `UPSTREAM_UNAVAILABLE`.

A success is returned only when a provider returns a plausible nickname in a recognized response field. Generic error text is rejected. The primary provider is attempted first. If it cannot confirm a nickname, fallbacks run concurrently and the result uses the configured provider priority if multiple sources return different names. A separate live smoke test can simulate primary unavailability while querying the real Isan secondary provider.

## Production checklist

- Keep `RAPIDAPI_KEY` in Railway's server-side environment variables only. Never expose it in client-side code.
- Confirm provider terms, endpoint contracts, and request limits before relying on unofficial endpoints.
- Add distributed rate limiting (for example, Redis-backed) before broad public launch; in-process limits do not protect across replicas.
- Monitor upstream failures and test known-valid and known-invalid IDs at low volume.
- Do not treat a timeout or provider outage as an invalid player ID.

Not affiliated with or endorsed by MOONTON Games, Codashop, or any listed third-party provider.


## Provider observability

Production logs emit structured JSON events for each provider attempt and each completed lookup. Provider events include a request correlation ID, provider label, outcome, latency in milliseconds, and the selected source only on success. Failed attempts may also include a bounded failure reason (`missing_config`, `http_error`, `network_or_timeout`, `unrecognized_response`, or `provider_error`) and an upstream HTTP status code. RapidAPI diagnostics may also include a low-cardinality response-shape label (such as a documented provider schema, gateway error object, or empty/non-JSON body); raw content is never logged. The summary records total duration and outcome counts. Player IDs, zone IDs, nicknames, upstream payloads, URLs, request headers, and credentials are intentionally excluded. Logging is best-effort and cannot change lookup results. Use Railway deployment logs to compare provider latency and availability over time; these are event logs, not a persistent metrics dashboard.

Run `npm run test:provider-adapters` to cover RapidAPI response classification, including structured 404 handling and `no_content_0`. Run `npm run test:observability` to check telemetry shape, verify identity fields and raw provider data are not logged, and ensure logging failures do not break lookups.

## Live fallback takeover smoke test

Run `npm run test:lookup:live` to simulate an unavailable primary and call the real Isan secondary adapter through the same resolver used by the API route. It reports the selected source, returned nickname, and elapsed time. This test requires network access and a working response from the third-party Isan service; it is separate from deterministic unit tests and does not modify production.


## Manual live provider sweep

Run `npm run test:provider-sweep:live` or trigger the **Live provider diagnostic sweep** workflow in GitHub Actions. It probes the known-valid test fixture against the Isan secondary adapter, EliteDias, Smile.One, and both the current form-encoded and JSON inquiry formats for Dunia Games. ID Game Checker is probed only when `RAPIDAPI_KEY` or `RAPIDAPI_APP_TOKEN` is configured in the workflow environment; production's Railway secret is not copied into GitHub Actions.

The sweep logs provider labels, sanitized outcome categories, HTTP status codes, durations, allowlisted response-shape/key names, and bounded provider-code/error-category fields. It never prints IDs, nicknames, response values, message text, URLs, request headers, or credentials. It intentionally skips Codashop's `initPayment` endpoint because that can create a checkout session.
