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

`POST /api/lookup`

Request:

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

A success is returned only when a provider returns a plausible nickname in a recognized response field. Generic error text is rejected. Providers run concurrently after input validation, and the result uses a stable provider priority if multiple sources return different names.

## Production checklist

- Keep `RAPIDAPI_KEY` in Railway's server-side environment variables only. Never expose it in client-side code.
- Confirm provider terms, endpoint contracts, and request limits before relying on unofficial endpoints.
- Add distributed rate limiting (for example, Redis-backed) before broad public launch; in-process limits do not protect across replicas.
- Monitor upstream failures and test known-valid and known-invalid IDs at low volume.
- Do not treat a timeout or provider outage as an invalid player ID.

Not affiliated with or endorsed by MOONTON Games, Codashop, or any listed third-party provider.
