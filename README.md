# Eidren — MLBB IGN Lookup

Standalone Next.js + TypeScript API for resolving Mobile Legends: Bang Bang nicknames from a Player ID and Zone ID.

The service owns input validation, provider orchestration, response normalization, and deployment. It uses a primary community lookup and best-effort fallback providers, including RapidAPI's ID Game Checker when `RAPIDAPI_KEY` (or the legacy `RAPIDAPI_APP_TOKEN`) is configured.

These integrations are unofficial third-party endpoints, not an official Moonton API. Their contracts and availability can change. Provider failures and timeouts are **not** treated as proof that an account is invalid.

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


## Live fallback takeover smoke test

Run `npm run test:lookup:live` to simulate an unavailable primary and call the real Isan secondary adapter through the same resolver used by the API route. It reports the selected source, returned nickname, and elapsed time. This test requires network access and a working response from the third-party Isan service; it is separate from deterministic unit tests and does not modify production.
